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

// ---------------- 启动告警：on 但未配公钥（不裸奔）----------------
export interface OasHealth {
  mode: 'on' | 'off'
  configured: boolean        // on 模式下是否配了公钥来源
  keySource: 'pem' | 'jwks' | 'none'
  baseUrl: string
  warning?: string
}
export function oasHealth(): OasHealth {
  if (OAS_MODE === 'off') return { mode: 'off', configured: true, keySource: 'none', baseUrl: OAS_BASE_URL }
  const hasPem = !!OAS_PUBLIC_KEY
  const hasJwks = !!(OAS_JWKS_URL || OAS_BASE_URL)
  const keySource: 'pem' | 'jwks' | 'none' = hasPem ? 'pem' : hasJwks ? 'jwks' : 'none'
  const warning = keySource === 'none'
    ? 'OAS_MODE=on 但未配置 OAS_PUBLIC_KEY / OAS_JWKS_URL / OAS_BASE_URL，受保护路由将全部 401（fail-closed）'
    : undefined
  if (warning) console.warn(`[OAS] ${warning}`)
  return { mode: 'on', configured: keySource !== 'none', keySource, baseUrl: OAS_BASE_URL, warning }
}

// ---------------- OFD 角色 / DU 帽 ----------------
const OFD_ROLES = ['requester', 'assignee', 'duAdmin', 'operator', 'observer', 'sysAdmin'] as const
type OfdRole = typeof OFD_ROLES[number]
const DU_HATS = ['H', 'C', 'E', 'D', 'T', 'Y'] as const
type DuHat = typeof DU_HATS[number]

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

export interface OasClaims {
  identity_id?: string
  role?: string
  sub_role?: string
  ms_access?: unknown         // 帽/权限数组
  name?: string
  du_id?: string              // 可选：明确 DU
  exp?: number
  iat?: number
  [k: string]: unknown
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
  source: 'cache' | 'provisioned' | 'cache-degraded'
}

/** 由 claims 推导并落本地 HU（缓存层）。未知角色抛错（fail-closed）。 */
export function resolveIdentity(claims: OasClaims, opts: { allowDegrade?: boolean } = {}): ResolvedOasIdentity {
  const identityId = String(claims.identity_id || '').trim()
  if (!identityId) throw new Error('OAS token 缺少 identity_id')

  // 1) 命中缓存（OAS 已验签，缓存仅用于取本地资料/降级）
  const cached = queries.huByOasIdentity(identityId)

  // 2) 解析角色（未知角色 fail-closed）
  const rawRole = String(claims.role || '').toLowerCase().trim()
  const mapped = ROLE_MAP[rawRole]
  if (!mapped) throw new Error(`未知 OAS 角色：${claims.role}（fail-closed）`)
  const ofdRole: OfdRole = mapped.role

  // 3) 解析 DU 帽：ms_access 优先 → claims.du_id → 角色默认帽
  let duId: string | undefined
  const hat = pickHatFromMsAccess(claims.ms_access)
  if (hat) duId = duIdForHat(hat)
  if (!duId && claims.du_id) {
    duId = queries.duById(String(claims.du_id))?.id ?? duIdForHat(String(claims.du_id).toUpperCase() as DuHat)
  }
  if (!duId && mapped.hat) duId = duIdForHat(mapped.hat)
  if (!duId) {
    // 无法定位 DU：有缓存则降级用缓存，否则拒绝
    if (cached) return { hu: cached, source: opts.allowDegrade ? 'cache-degraded' : 'cache' }
    throw new Error('无法从 claims 定位归属 DU（fail-closed）')
  }

  const name = String(claims.name || claims.sub_role || identityId).slice(0, 40)
  const title = String(claims.sub_role || '').slice(0, 40)
  // 本地 HU id：稳定映射 OAS-<identityId>
  const huId = `OAS-${identityId}`.slice(0, 48)

  if (cached) {
    // 更新缓存（角色/DU 以 OAS 最新为准）
    queries.upsertOasHu({ id: cached.id, name, duId, title, role: ofdRole, oasIdentityId: identityId })
    const fresh = queries.huById(cached.id)!
    return { hu: fresh, source: 'cache' }
  }
  queries.upsertOasHu({ id: huId, name, duId, title, role: ofdRole, oasIdentityId: identityId })
  const hu = queries.huById(huId)!
  return { hu, source: 'provisioned' }
}
