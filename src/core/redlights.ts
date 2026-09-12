/** 三红灯判定（PRD §7：空转 / 超时未接 / 卡验收）
 *  口径单点收敛：所有红灯展示（看板、列表标记）必须引用此处，不得在组件里各自算。
 *  - 空转：接单后超 24h 无任何进度更新（进度 0 或距上次轨迹超 24h）—— 占了活不动
 *  - 超时未接：派发超 48h 仍无人接单（waitAccept）—— 供给侧无响应
 *  - 卡验收：完工交物后超 48h 未验收 —— 验收是义务非权力
 */

export type RedLightKind = 'idle' | 'noAccept' | 'stuckCheck'

export interface RedLightDef {
  kind: RedLightKind
  label: string
  color: string          // antd Tag color
  desc: string
  hours: number          // 阈值（小时）
}

export const REDLIGHT_DEFS: Record<RedLightKind, RedLightDef> = {
  noAccept: { kind: 'noAccept', label: '超时未接', color: 'red', desc: '派发超 48h 无人接单', hours: 48 },
  idle: { kind: 'idle', label: '空转', color: 'volcano', desc: '接单后超 24h 无进度更新', hours: 24 },
  stuckCheck: { kind: 'stuckCheck', label: '卡验收', color: 'gold', desc: '交物后超 48h 未验收', hours: 48 },
}

const HOUR = 3600 * 1000

/** 解析「YYYY-MM-DD HH:mm」为本地时间戳（统一走 core/time，禁止散落 replace 写法） */
import { parseLocal } from './time'
const ts = (s: string) => parseLocal(s)

/** 单张工单命中的红灯列表（可能多条） */
export function jobRedLights(job: {
  status: string
  createdAt: string
  assigneeHuId: string | null
  progress: number
  trace: { time: string; action: string }[]
  ofdAwaitSince?: string
}): RedLightKind[] {
  const out: RedLightKind[] = []
  const nowT = Date.now()

  // ① 超时未接：待接单且距派发超 48h
  if (job.status === 'waitAccept' && nowT - ts(job.createdAt) > 48 * HOUR) {
    out.push('noAccept')
  }

  // ② 空转：执行中/受阻中，接单后超 24h 无进度更新
  if ((job.status === 'working' || job.status === 'blocked') && job.assigneeHuId) {
    const progTimes = job.trace.filter((t) => t.action.startsWith('更新进度')).map((t) => ts(t.time))
    const lastProg = progTimes.length ? Math.max(...progTimes) : null
    const acceptTime = job.trace.find((t) => t.action === '接单' || t.action.startsWith('认领'))?.time
    const base = lastProg ?? (acceptTime ? ts(acceptTime) : null)
    if (base && nowT - base > 24 * HOUR) out.push('idle')
  }

  // ③ 卡验收：其所属履约单 awaitSince 超 48h 且本单已完工（原型简化：看 OFD 维度，由 OFD 调用方聚合）
  if (job.ofdAwaitSince && nowT - ts(job.ofdAwaitSince) > 48 * HOUR) {
    out.push('stuckCheck')
  }

  return out
}

/** 供 Dashboard 直接使用的全量红灯扫描结果 */
export interface RedLightRow {
  id: string
  title: string
  lights: RedLightKind[]
}

export function scanRedLights(
  jobs: Parameters<typeof jobRedLights>[0][],
  ofdAwaitSinceById: Record<string, string | undefined>,
  titleOf: (id: string) => string,
): RedLightRow[] {
  return jobs
    .map((j) => ({
      id: (j as any).id as string,
      title: titleOf((j as any).id as string),
      lights: jobRedLights({ ...j, ofdAwaitSince: (j as any).ofdId ? ofdAwaitSinceById[(j as any).ofdId] : undefined }),
    }))
    .filter((r) => r.lights.length > 0)
}
