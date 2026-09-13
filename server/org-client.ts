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

const ORG_ME_URL =
  process.env.XOFD_ORG_ME_URL || `${process.env.OAS_BASE_URL || 'http://localhost:4001'}/api/v1/org/me`

const ORG_ME_TIMEOUT_MS = Number(process.env.XOFD_ORG_ME_TIMEOUT_MS || 5000)
// 内测 mock：底座不可达时用于本地自测（/org/me 语义对齐后由底座真源覆盖）
const ORG_ME_MOCK = process.env.XOFD_ORG_ME_MOCK === '1'

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
 * 不 throw，返回 Promise<OrgMeIdentity | null>。
 */
export async function resolveOrgMe(token: string): Promise<OrgMeIdentity | null> {
  if (ORG_ME_MOCK) {
    // 内测演示身份：六帽与本地种子映射，标注来自 mock，便于自测链路完整。
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
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), ORG_ME_TIMEOUT_MS)
    try {
      const res = await fetch(ORG_ME_URL, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: ctrl.signal,
      })
      if (!res.ok) return null
      const body = await res.json().catch(() => null)
      if (!body || body.code !== 0 || !body.data) return null
      const d = body.data
      if (!d.orgId && !d.code) return null
      return {
        orgId: d.orgId,
        code: d.code,
        name: d.name || '',
        hat: d.hat || hatsFromCode(d.code),
        role: d.role || 'operator',
        duId: d.duId,
        userId: d.userId,
        labels: d.labels,
      }
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return null
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
  return 'H'
}