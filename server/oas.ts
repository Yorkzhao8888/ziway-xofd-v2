// ============================================================
// server/oas.ts — OAS（统一身份层）验签与身份映射
// 模式：OAS_MODE=off（默认，内测本地登录） | on（OAS RS256 验签，本地登录停用）
// 设计原则：
//  - fail-closed：on 模式下 OAS 未配置公钥或不可达 → 全部受保护路由拒绝
//  - 本地 hus 表作为「缓存层」：OAS identity_id 映射到本地 HU，OAS 短时不可达可降级用缓存
//  - 未知角色 fail-closed 拒绝（不静默放行）
// ============================================================
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { queries } from './db'
import type { HU } from './db'
import { resolveOrgMe } from './org-client'

// ---------------- 配置 ----------------
export const OAS_MODE: 'on' | 'off' =
  String(process.env.OAS_MODE || 'off').toLowerCase() === 'on' ? 'on' : 'off'
export const OAS_BASE_URL = process.env.OAS_BASE_URL || ''
export const OAS_PUBLIC_KEY = process.env.OAS_PUBLIC_KEY || ''   // PEM 公钥（二选一）
export const OAS_JWKS_URL = process.env.OAS_JWKS_URL || ''        // JWKS 地址（二选一，默认拼 ${BASE}/.well-known/jwks.json）
export const OAS_TIMEOUT_MS = Number(process.env.OAS_TIMEOUT_MS || 5000)
const OAS_ISS = process.env.OAS_ISS || ''                          // 可选：校验 issuer
const OAS_AUD = process.env.OAS_AUD || ''                          // 可选：校验 audience
const EXPECTED_KID = process.env.OAS_KID || 'oas-rsa-001'

// ---------------- 一键测试登录（发行门槛 NORM-LOGIN）----------------
// 独立开关，与 OAS_MODE 解耦：
//  - QUICK_LOGIN=on / off 显式指定（正式域可显式 on 保留能力）
//  - 未指定时按环境推导：开发/内测默认开，公测/正式默认关
//  关时端点返回 404（fail-closed，对齐百泰 OS v0.1 三关）；正式域能力保留可开
export const QUICK_LOGIN: 'on' | 'off' = (() => {
  const v = String(process.env.QUICK_LOGIN || '').toLowerCase()
  if (v === 'on') return 'on'
  if (v === 'off') return 'off'
  return (process.env.COZE_PROJECT_ENV || 'DEV').toUpperCase() === 'PROD' ? 'off' : 'on'
})()
// 测试账号：spec 规定 test123 直进工作台 → 落到默认演示身份
export const QUICK_LOGIN_TEST_ACCOUNT = String(process.env.QUICK_LOGIN_TEST_ACCOUNT || 'test123')

// ---------------- 启动告警：on 但未配公钥（不裸奔）----------------
export interface OasHealth {
  mode: 'on' | 'off'
  configured: boolean        // on 模式下是否配了公钥来源
  keySource: 'pem' | 'jwks' | 'none'
  baseUrl: string
  quickLogin: 'on' | 'off'   // 一键测试登录开关（发行门槛 NORM-LOGIN）
  testAccount: string
  warning?: string
}
export function oasHealth(): OasHealth {
  if (OAS_MODE === 'off') return { mode: 'off', configured: true, keySource: 'none', baseUrl: OAS_BASE_URL, quickLogin: QUICK_LOGIN, testAccount: QUICK_LOGIN_TEST_ACCOUNT }
  const hasPem = !!OAS_PUBLIC_KEY
  const hasJwks = !!(OAS_JWKS_URL || OAS_BASE_URL)
  const keySource: 'pem' | 'jwks' | 'none' = hasPem ? 'pem' : hasJwks ? 'jwks' : 'none'
  const warning = keySource === 'none'
    ? 'OAS_MODE=on 但未配置 OAS_PUBLIC_KEY / OAS_JWKS_URL / OAS_BASE_URL，受保护路由将全部 401（fail-closed）'
    : undefined
  if (warning) console.warn(`[OAS] ${warning}`)
  return { mode: 'on', configured: keySource !== 'none', keySource, baseUrl: OAS_BASE_URL, quickLogin: QUICK_LOGIN, testAccount: QUICK_LOGIN_TEST_ACCOUNT, warning }
}

// ---------------- OFD 角色 / DU 帽 ----------------
const OFD_ROLES = ['requester', 'assignee', 'duAdmin', 'operator', 'observer', 'sysAdmin'] as const
type OfdRole = typeof OFD_ROLES[number]
const DU_HATS = ['H', 'C', 'E', 'D', 'T', 'Y'] as const
type DuHat = typeof DU_HATS[number]

type Maybe<T> = T | null | undefined

// OFD 默认角色映射（按 DU 帽）。duId 归属于当前主体的组织身份（/org/me），
// 这里仅保留「帽→默认角色」的最小语义，组织信息不承载于 JWT（G3）。
const RESOLVE_HAT_TO_ROLE: Record<DuHat, OfdRole> = {
  H: 'duAdmin',   // 人力/经营户 → 部门管理员
  C: 'requester', // 客户 → 发单方
  E: 'assignee',  // 供给 → 接单
  D: 'assignee',  // 履约 → 接单
  T: 'operator',  // 技术 → 执行
  Y: 'operator',  // 智场 → 执行
}

// OAS role（12U 小写）→ OFD 角色/默认 DU 帽。未列出的角色 fail-closed。
// 注：具体 12U 角色码以 OAS 契约为准，这里提供 OFD 内常见映射 + 透传；
//     ms_access 中的 DU 帽优先级高于默认帽。
const ROLE_MAP: Record<string, { role: OfdRole; hat?: DuHat }> = {
  // OFD 原生角色透传
  requester: { role: 'requester' },
  assignee: { role: 'assignee' },
  duadmin: { role: 'duAdmin' },
  operator: { role: 'operator' },
  observer: { role: 'observer' },
  sysadmin: { role: 'sysAdmin' },
  // 12U 常见角色 → OFD（按业务语义）
  hr: { role: 'duAdmin', hat: 'H' },          // 人力
  customer: { role: 'requester', hat: 'C' },  // 客户/发单方
  supply: { role: 'assignee', hat: 'E' },     // 供给/供应
  delivery: { role: 'assignee', hat: 'D' },   // 履约/调度
  tech: { role: 'operator', hat: 'T' },       // 技术
  site: { role: 'operator', hat: 'Y' },       // 智场
  admin: { role: 'sysAdmin' },
  manager: { role: 'duAdmin' },
  staff: { role: 'operator' },
  guest: { role: 'observer' },
}

// 标准 OAS claims：仅定位"人"（identity_id/sub/name），不承载组织属性。
// 组织身份（hat/role/duId/orgId）一律经 GET /org/me 解析，JWT 不追加组织 claims（OFD-LINK-03 G3）。
export interface OasClaims {
  identity_id?: string        // 标准人标识（与 sub 二选一定人）
  sub?: string
  name?: string
  exp?: number
  iat?: number
  iss?: string
  aud?: string | string[]
  [k: string]: unknown        // 其余 claims 仅透传，不参与组织身份推导
}

// ---------------- JWKS：kid -> RSA PEM ----------------
interface Jwk { kid?: string; kty?: string; use?: string; n?: string; e?: string; alg?: string }
let jwksCache: { at: number; keys: Map<string, string> } = { at: 0, keys: new Map() }
const JWKS_TTL = 10 * 60 * 1000

function b64urlToBuf(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}
function jwkToPem(jwk: Jwk): string {
  if (jwk.kty !== 'RSA' || !jwk.n || !jwk.e) throw new Error('仅支持 RSA JWK')
  const n = b64urlToBuf(jwk.n)
  const e = b64urlToBuf(jwk.e)
  const pub = crypto.createPublicKey({ key: { kty: 'RSA', n: n.toString('base64url'), e: e.toString('base64url') } as any, format: 'jwk' })
  return pub.export({ type: 'spki', format: 'pem' }) as string
}
async function fetchJwksKeyPem(kid: string): Promise<string | null> {
  const now = Date.now()
  if (now - jwksCache.at < JWKS_TTL && jwksCache.keys.has(kid)) return jwksCache.keys.get(kid)!
  const url = OAS_JWKS_URL || `${OAS_BASE_URL.replace(/\/$/, '')}/.well-known/jwks.json`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), OAS_TIMEOUT_MS)
  try {
    const resp = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } })
    if (!resp.ok) throw new Error(`JWKS HTTP ${resp.status}`)
    const json = (await resp.json()) as { keys?: Jwk[] }
    const map = new Map<string, string>()
    for (const k of json.keys || []) {
      try { if (k.kid) map.set(k.kid, jwkToPem(k)) } catch { /* 跳过不支持的 key */ }
    }
    jwksCache = { at: now, keys: map }
    return map.get(kid) ?? null
  } finally { clearTimeout(timer) }
}

function getPemKey(): string {
  // PEM 可能被环境变量转义为 \n
  return OAS_PUBLIC_KEY.replace(/\\n/g, '\n')
}

// ---------------- 验签 ----------------
async function fetchSigningKey(token: string): Promise<string> {
  const decoded = jwt.decode(token, { complete: true })
  const kid = (decoded?.header as any)?.kid as string | undefined
  if (OAS_PUBLIC_KEY) return getPemKey()
  // JWKS 路径
  const wantKid = kid || EXPECTED_KID
  const pem = await fetchJwksKeyPem(wantKid)
  if (!pem) throw new Error(`JWKS 中未找到公钥 kid=${wantKid}`)
  return pem
}

export async function verifyOasToken(token: string): Promise<{ claims: OasClaims; keySource: 'pem' | 'jwks' }> {
  if (oasHealth().keySource === 'none') throw new Error('OAS 未配置公钥（fail-closed）')
  const pem = await fetchSigningKey(token)
  const verifyOpts: jwt.VerifyOptions = { algorithms: ['RS256'] }
  if (OAS_ISS) verifyOpts.issuer = OAS_ISS
  if (OAS_AUD) verifyOpts.audience = OAS_AUD
  const claims = jwt.verify(token, pem, verifyOpts) as OasClaims
  return { claims, keySource: OAS_PUBLIC_KEY ? 'pem' : 'jwks' }
}

// ---------------- claims -> OFD 身份 ----------------
function pickHatFromMsAccess(ms: unknown): DuHat | undefined {
  const arr = Array.isArray(ms) ? ms : (ms == null ? [] : [ms])
  for (const item of arr) {
    const s = String(item ?? '').toUpperCase()
    for (const hat of DU_HATS) {
      // 形如 "D:..." / "DU_D" / "HAT-D" / 直接 "D"
      if (s === hat || new RegExp(`(^|[^A-Z])${hat}([^A-Z]|$)`).test(s)) return hat
    }
  }
  return undefined
}

// 帽 → 本地 DU id：取该类型第一个 DU（DU 归属按类型）
function duIdForHat(hat: DuHat): string | undefined {
  const du = queries.dus().find((d) => d.type === hat)
  return du?.id
}

export interface ResolvedOasIdentity {
  hu: HU
  source: 'cache' | 'provisioned' | 'org-me' | 'cache-degraded'
}

/**
 * G3：由标准 claims 定人（仅 identity_id/name），组织身份（hat/role/duId）权威来自 /org/me（G2）。
 * 删除 ms_access/du_id/role/sub_role 自定义 claims 读取（G3），组织语义统一走底座。
 */
export async function resolveOrgIdentityAsync(
  token: string,
  claims: OasClaims,
  opts: { allowDegrade?: boolean } = {},
): Promise<ResolvedOasIdentity> {
  const identityId = String(claims.identity_id || '').trim()
  if (!identityId) throw new Error('OAS token 缺少 identity_id')

  // 1) 命中缓存（仅作本地资料底，非组织权威）
  const cached = queries.huByOasIdentity(identityId)

  // 2) 组织身份唯一权威 = /org/me（底座，禁加 claims）
  const orgMe = await resolveOrgMe(token)

  // 3) 组织语义映射（hat/role/duId 均来自 org-me；本地 DU 表用于 id↔type 语义对齐，写底座不可行故本地只读）
  const ofdRole: OfdRole =
    (RESOLVE_HAT_TO_ROLE[orgMe?.hat ?? DU_HATS[0]] as Maybe<OfdRole>) ?? 'operator'
  let duId: string | undefined
  if (orgMe?.duId) duId = queries.duById(orgMe.duId)?.id
  if (!duId && orgMe?.hat) duId = duIdForHat(orgMe.hat as DuHat)
  if (!duId) {
    // 无法定位 DU：有缓存则降级用缓存（仅内测 allowDegrade），否则 fail-closed
    if (cached) return { hu: cached, source: opts.allowDegrade ? 'cache-degraded' : 'cache' }
    throw new Error('无法从 /org/me 定位归属 DU（fail-closed）')
  }

  const name = String(orgMe?.name || claims.name || identityId).slice(0, 40)
  const title = String((orgMe as { title?: string } | null)?.title || '').slice(0, 40)
  const huId = `OAS-${identityId}`.slice(0, 48)

  if (cached) {
    queries.upsertOasHu({ id: cached.id, name, duId, title, role: ofdRole, oasIdentityId: identityId })
    const fresh = queries.huById(cached.id)!
    return { hu: fresh, source: orgMe ? 'org-me' : 'cache' }
  }
  queries.upsertOasHu({ id: huId, name, duId, title, role: ofdRole, oasIdentityId: identityId })
  return { hu: queries.huById(huId)!, source: orgMe ? 'org-me' : 'provisioned' }
}

/** 兼容旧同步签名：走 /org/me 不异步（仅内测/降级路径用纯缓存，不作为组织权威）。 */
export function resolveIdentity(claims: OasClaims, opts: { allowDegrade?: boolean } = {}): ResolvedOasIdentity {
  const identityId = String(claims.identity_id || '').trim()
  if (!identityId) throw new Error('OAS token 缺少 identity_id')
  const cached = queries.huByOasIdentity(identityId)
  if (cached) return { hu: cached, source: opts.allowDegrade ? 'cache-degraded' : 'cache' }
  const name = String(claims.name || identityId).slice(0, 40)
  const huId = `OAS-${identityId}`.slice(0, 48)
  queries.upsertOasHu({ id: huId, name, title: '', role: 'operator', oasIdentityId: identityId })
  return { hu: queries.huById(huId)!, source: 'provisioned' }
}
