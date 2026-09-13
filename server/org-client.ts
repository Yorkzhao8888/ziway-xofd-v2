/**
 * @file org-client.ts — 底座 OAS `/org/me` 出站客户端（G2）
 *
 * 用途：在用 OAS JWT 定人（G3 只依赖标准 claims）之后，调用底座 OAS 的
 *       `GET /api/v1/org/me` 解析「组织身份」——当前 HU 归属的对象组织、帽/角色、任职。
 * 本仓**只读取组织身份，不写底座**（G1 纪律：本地 hus 仅作只读缓存）。
 *
 * 契约（严格按百泰OS 统一口径，禁加 JWT claims）：
 *   - 入参：OAS Bearer token（zhdjcdwnhv 签发）
 *   - 出参：{ orgId, code, name, hat, role, duId, userId } 或 fail（fail-closed）
 *   - 超时：5s（AbortSignal.timeout，对齐 STAB-01 跨窗 5s 互调口径）
 *   - 降级：由调用方决定——校验期 fail-closed；内测模式无底座位时可落入种子缓存
 *   - 幂等：本客户端无副作用，查询天然幂等
 */
import { mkdirSync, appendFileSync } from 'node:fs'

// 出站 URL：{OAS_BASE_URL}/api/v1/org/me（去尾斜杠防双 //），可被 XOFD_ORG_ME_URL 显式覆盖
const ORG_ME_URL =
  process.env.XOFD_ORG_ME_URL ||
  `${String(process.env.OAS_BASE_URL || 'http://localhost:4001').replace(/\/+$/, '')}/api/v1/org/me`

const ORG_ME_TIMEOUT_MS = Number(process.env.XOFD_ORG_ME_TIMEOUT_MS || 5000)
// 内测 mock：底座不可达时用于本地自测（/org/me 语义对齐后由底座真源覆盖）
const ORG_ME_MOCK = process.env.XOFD_ORG_ME_MOCK === '1'

// 出站诊断：失败时把实际请求 URL + HTTP 状态码 + 响应前 200 字符打进 app.log，便于线上直接定位（G2 诊断）
function logOrgMeDiag(tag: string, info: { url?: string; status?: number; snippet?: string; err?: string }) {
  try {
    const dir = process.env.LOG_DIR || '/app/work/logs/bypass/'
    const fsdir = /^\/(app|workspace|tmp)\//.test(dir) ? dir : 'logs/'
    mkdirSync(fsdir, { recursive: true })
    appendFileSync(
      fsdir + 'app.log',
      `${new Date().toISOString()} [org-me:${tag}] url=${info.url || '-'} status=${info.status ?? '-'} snippet=${(info.snippet || '').slice(0, 200)}${info.err ? ' err=' + info.err : ''}\n`,
    )
  } catch {
    /* 诊断日志失败不阻断主流程 */
  }
}

/** 对同一 (tag, token尾16位, status) 只诊断一次，避免高频下刷爆日志 */
let lastDiagKey = ''
function diagOnce(tag: string, info: { url?: string; status?: number; snippet?: string; err?: string }, token: string) {
  const key = `${tag}:${token.slice(-16)}:${info.status ?? '-'}`
  if (key === lastDiagKey) return
  lastDiagKey = key
  logOrgMeDiag(tag, info)
}

export interface OrgMeIdentity {
  orgId: string
  code: string // 容器/组织编码，如 XHPZ#CU-xxxxxx / XDPZ#DU
  name: string
  hat: string // 六帽：H/C/E/D/T/Y
  role: string // requester | assignee | duAdmin | operator | observer | sysAdmin ...
  duId?: string
  userId?: string
  labels?: Record<string, string>
}

/**
 * 出站调用底座 /org/me。
 * - ORG_ME_MOCK=1 时返回本地演示组织身份（内测/自测，不触网）。
 * - 真实模式：底座不可达 / 超时 / 非 2xx → resolve(null) 交由调用方 fail-closed 降级。
 * 失败时会写诊断日志（URL/status/响应用前 200 字符）。
 * 不 throw，返回 Promise<OrgMeIdentity | null>。
 */
export async function resolveOrgMe(token: string): Promise<OrgMeIdentity | null> {
  if (ORG_ME_MOCK) {
    const demo: OrgMeIdentity = {
      orgId: 'org-demo-bybt',
      code: 'XDPZ#DU-demo',
      name: '百泰演示履约组织',
      hat: 'D',
      role: 'operator',
      duId: 'DDU01',
    }
    return demo
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ORG_ME_TIMEOUT_MS)
  try {
    const res = await fetch(ORG_ME_URL, {
      method: 'GET', // 无多余头：仅 Authorization（Bearer）与 Accept
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: ctrl.signal,
    })
    if (!res.ok) {
      diagOnce('http', { url: ORG_ME_URL, status: res.status, snippet: await res.text().catch(() => '') }, token)
      return null
    }
    const body = await res.json().catch(() => null)
    if (!body || body.code !== 0 || !body.data) {
      diagOnce('badbody', { url: ORG_ME_URL, status: res.status, snippet: JSON.stringify(body ?? '').slice(0, 200) }, token)
      return null
    }
    const d = body.data
    // 兼容底座两种返回：顶层 orgId/code（D/X 域）与嵌套 hdu.code（个人/经营，62域）
    const hdu = d.hdu || {}
    const rawCode = String(d.code || hdu.code || '').trim()
    if (!d.orgId && !rawCode && !d.userId) {
      diagOnce('noidentity', { url: ORG_ME_URL, status: res.status, snippet: JSON.stringify(d).slice(0, 200) }, token)
      return null
    }
    const hat =
      d.hat || hdu.hat || hatsFromCode(rawCode) || hatsFromHdu(hdu) || duForHduCode(rawCode)?.hat || undefined
    return {
      orgId: String(d.orgId || ''),
      code: rawCode,
      name: String(d.name || hdu.name || ''),
      hat,
      role: String(d.role || hdu.role || 'operator'),
      duId: d.duId || hdu.duId,
      userId: String(d.userId || hdu.userId || ''),
      labels: d.labels || hdu.labels,
    }
  } catch (e: any) {
    diagOnce('fetch', { url: ORG_ME_URL, status: undefined, err: String(e?.message || e).slice(0, 200) }, token)
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** 根据组织编码推断六帽（兼容底座未显式返回 hat 的情况）：XHPZ#CU→H… 语义见生态口径。 */
function hatsFromCode(code: string): string {
  const c = code || ''
  if (c.includes('XHPZ')) return 'H' // 个人用户 → 人力帽（也可 C 依场景）
  if (c.includes('XEPZ')) return 'E'
  if (c.includes('XDPZ')) return 'D'
  if (c.includes('XVPZ')) return 'T'
  if (c.includes('XOPZ')) return 'Y'
  if (c.includes('XGPZ')) return 'C'
  return ''
}

/** 从 hdu 结构推断六帽：捷才智通=个人默认(人力帽)；eorg-*=企业(供给帽 E)。未知返回空串。 */
function hatsFromHdu(hdu: Record<string, any>): string {
  const code = String(hdu.code || '').toLowerCase()
  if (!code) return ''
  if (code.includes('jiecai') || code.includes('zhitong')) return 'H'  // 捷才智通/直通 → 个人默认
  if (code.startsWith('eorg') || code.includes('eorg')) return 'E'      // 企业 → Domain=E
  return ''
}

/** 按 hdu.code 定位默认 DU 域（个人默认域 HDU01；企业默认供给域 EDU01）。 */
export function duForHduCode(code: string): { hat: string; duHint: string } | null {
  const c = String(code || '').toLowerCase()
  if (!c) return null
  if (c.includes('jiecai') || c.includes('zhitong')) return { hat: 'H', duHint: 'HDU01' } // 捷才智通=个人默认
  if (c.startsWith('eorg') || c.includes('eorg')) return { hat: 'E', duHint: 'EDU01' }   // 企业=供给域
  return null
}