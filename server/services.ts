// ============================================================
// server/services.ts — 业务规则服务层（状态机 + 规则收口）
// 逻辑对照 src/store.ts；三红灯口径对照 src/core/redlights.ts；时间本地串。
// ============================================================
import {
  db, queries, saveOrder, saveOfd, saveJob, saveMsg, markMsgRead,
  nextDocNo, nextMsgId, nowLocal, parseLocal,
  type OrderDoc, type OfdDoc, type JobDoc, type Msg, type HU,
} from './db'

const HOUR = 3600 * 1000

export class BizError extends Error {
  status: number
  constructor(message: string, status = 400) { super(message); this.status = status }
}

// ---------------- 通知 ----------------
function notify(toHuIds: string[], title: string, detail: string, link: string) {
  const ids = Array.from(new Set(toHuIds.filter(Boolean)))
  for (const huId of ids) {
    const m: Msg = { id: nextMsgId(), toHuId: huId, title, detail, at: nowLocal(), read: false, link }
    saveMsg(m)
  }
}
function huName(id: string | null | undefined): string {
  if (!id) return '系统'
  return queries.huById(id)?.name ?? id
}
function duName(id: string | null | undefined): string {
  if (!id) return ''
  return queries.duById(id)?.name ?? ''
}
function tr(actor: string, action: string, detail?: string) {
  return { time: nowLocal(), actor, action, detail }
}

// ================= 引导数据 =================
export function bootstrap() {
  return {
    dus: queries.dus(),
    hus: queries.hus(),
    orders: queries.allOrders(),
    ofds: queries.allOfds(),
    jobs: queries.allJobs(),
    msgs: [], // 登录后按 HU 拉取
  }
}

export function msgsFor(huId: string) {
  return queries.msgsFor(huId)
}
export function markRead(huId: string, msgId: string) {
  const m = queries.msgsFor(huId).find((x) => x.id === msgId)
  if (m) markMsgRead(msgId)
}
export function markAllRead(huId: string) {
  for (const m of queries.msgsFor(huId)) if (!m.read) markMsgRead(m.id)
}

// ================= O 需求单 =================
export function createOrder(me: HU, input: {
  title: string; desc: string; targetDuId?: string | null; targetHuId?: string | null
  expectDate: string; attachments?: string[]; direct?: boolean
}) {
  const order: OrderDoc = {
    id: nextDocNo('O'),
    title: input.title,
    desc: input.desc,
    requesterHuId: me.id,
    requesterDuId: me.duId,
    targetDuId: input.targetDuId ?? null,
    targetHuId: input.targetHuId ?? null,
    expectDate: input.expectDate,
    status: 'submitted',
    attachments: input.attachments ?? [],
    vcaseId: null,
    ofdId: null,
    createdAt: nowLocal(),
    trace: [tr(me.name, '提交需求单', input.direct ? '系统判定：单一动作 → 直发工单' : '跨主体协作 → 进入履约编排')],
  }
  saveOrder(order)
  const targetIds = input.targetHuId
    ? [input.targetHuId]
    : queries.hus().filter((h) => h.duId === input.targetDuId).map((h) => h.id)
  notify(targetIds, `收到新需求 ${order.id}`, `${duName(me.duId)} · ${me.name} 提交了「${input.title}」`, `/order/${order.id}`)
  return order
}

export function acceptOrder(me: HU, orderId: string) {
  const o = mustOrder(orderId)
  if (o.status !== 'submitted') throw new BizError('当前状态不可受理（仅待受理可受理）')
  o.status = 'accepted'
  o.trace.push(tr(me.name, '受理需求'))
  saveOrder(o)
  notify([o.requesterHuId], `${o.id} 已受理`, `${duName(me.duId)} · ${me.name} 受理了你的需求，将编制履约方案`, `/order/${o.id}`)
  return o
}

export function rejectOrder(me: HU, orderId: string, reason: string) {
  if (!reason) throw new BizError('驳回理由必填')
  const o = mustOrder(orderId)
  if (o.status !== 'submitted' && o.status !== 'accepted') throw new BizError('当前状态不可驳回')
  o.status = 'rejected'
  o.trace.push(tr(me.name, '驳回需求', reason))
  saveOrder(o)
  notify([o.requesterHuId], `${o.id} 已驳回`, `${me.name} 驳回了需求：${reason}`, `/order/${o.id}`)
  return o
}

export function withdrawOrder(me: HU, orderId: string, reason: string) {
  const o = mustOrder(orderId)
  if (o.requesterHuId !== me.id) throw new BizError('仅发单人可撤回', 403)
  if (o.status !== 'submitted') throw new BizError('仅待受理状态可撤回（受理/转履约后已进入对方工作流）')
  o.status = 'withdrawn'
  o.trace.push(tr(me.name, '撤回需求', reason || undefined))
  saveOrder(o)
  const notifyIds = o.targetHuId ? [o.targetHuId] : queries.hus().filter((h) => h.duId === o.targetDuId).map((h) => h.id)
  notify(notifyIds, `${o.id} 已被发单人撤回`, `${me.name} 撤回了需求（${reason || '未填理由'}），本单无需处理`, `/order/${o.id}`)
  return o
}

// ================= F 履约单 =================
export function createOfd(me: HU, orderId: string, input: {
  title: string; deliverables: { name: string; standard: string }[]; promiseDate: string
}) {
  if (!input.deliverables?.length) throw new BizError('履约方案至少 1 项交付物')
  const o = mustOrder(orderId)
  if (o.status !== 'accepted' && o.status !== 'submitted') throw new BizError('需求单当前状态不可编制履约方案')
  const ofd: OfdDoc = {
    id: nextDocNo('F'),
    orderId,
    title: input.title,
    deliverables: input.deliverables.map((d, i) => ({ id: `D${i + 1}`, name: d.name, standard: d.standard })),
    promiseDate: input.promiseDate,
    promiseOriginal: input.promiseDate,
    ownerDuId: me.duId,
    status: 'pending',
    caseId: null,
    createdAt: nowLocal(),
    awaitSince: null,
    trace: [tr(me.name, '编制履约方案', `交付物 ${input.deliverables.length} 项 · 承诺 ${input.promiseDate}`)],
  }
  saveOfd(ofd)
  o.status = 'converted'
  o.ofdId = ofd.id
  o.trace.push(tr(me.name, `转履约 ${ofd.id}`))
  saveOrder(o)
  return ofd
}

// ================= J 工单 =================
export function createJob(me: HU, input: {
  ofdId: string | null; orderId: string | null; title: string; desc: string
  dispatchDuId?: string | null; dispatchHuId?: string | null; promiseDate: string; dueHours: number
}) {
  const job: JobDoc = {
    id: nextDocNo('J'),
    ofdId: input.ofdId,
    orderId: input.orderId,
    title: input.title,
    desc: input.desc,
    isDirect: !input.ofdId,
    dispatchDuId: input.dispatchDuId ?? null,
    dispatchHuId: input.dispatchHuId ?? null,
    assigneeHuId: null,
    promiseDate: input.promiseDate,
    status: 'waitAccept',
    progress: 0,
    reworkCount: 0,
    blockedReason: null,
    deliverables: [],
    dueHours: input.dueHours,
    vcaseId: null,
    createdAt: nowLocal(),
    trace: [tr(me.name, input.ofdId ? `从 ${input.ofdId} 派出工单` : '直发工单（通路B）')],
  }
  saveJob(job)
  if (input.ofdId) {
    const f = mustOfd(input.ofdId)
    f.status = 'dispatched'
    f.trace.push(tr(me.name, `派工单 ${job.id}`))
    saveOfd(f)
  }
  const targetIds = input.dispatchHuId
    ? [input.dispatchHuId]
    : queries.hus().filter((h) => h.duId === input.dispatchDuId).map((h) => h.id)
  notify(targetIds, `收到新工单 ${job.id}`, `${duName(me.duId)} · ${me.name} 派出「${input.title}」`, `/job/${job.id}`)
  return job
}

export function acceptJob(me: HU, jobId: string, promiseDate?: string) {
  const j = mustJob(jobId)
  if (j.status !== 'waitAccept') throw new BizError('仅待接单工单可接单')
  j.status = 'working'
  j.assigneeHuId = me.id
  j.progress = 5
  // 承诺时间协商：反填原值留痕
  if (promiseDate && promiseDate !== j.promiseDate) {
    if (!j.promiseOriginal) j.promiseOriginal = j.promiseDate ?? undefined
    j.promiseDate = promiseDate
  }
  j.trace.push(tr(me.name, '接单', promiseDate ? `承诺时间协商为 ${promiseDate}` : undefined))
  saveJob(j)
  if (j.ofdId) {
    const f = mustOfd(j.ofdId)
    f.status = 'inProgress'
    f.trace.push(tr(me.name, `${j.id} 已接单`))
    saveOfd(f)
  }
  if (j.orderId) {
    const o = queries.orderById(j.orderId)
    if (o) notify([o.requesterHuId], `${j.id} 已接单`, `${duName(me.duId)} · ${me.name} 接单，承诺 ${j.promiseDate} 完成`, `/job/${j.id}`)
  }
  return j
}

export function rejectJob(me: HU, jobId: string, reason: string) {
  if (!reason) throw new BizError('拒单理由必填')
  const j = mustJob(jobId)
  if (j.status !== 'waitAccept') throw new BizError('仅待接单工单可拒单')
  j.status = 'rejected'
  j.trace.push(tr(me.name, '拒单', reason))
  saveJob(j)
  return j
}

export function claimJob(me: HU, jobId: string) {
  const j = mustJob(jobId)
  if (j.status !== 'waitAccept') throw new BizError('仅待接单工单可认领')
  j.status = 'working'
  j.assigneeHuId = me.id
  j.progress = 5
  j.trace.push(tr(me.name, '认领工单（先到先得）'))
  saveJob(j)
  return j
}

export function updateProgress(me: HU, jobId: string, progress: number, note: string) {
  const j = mustJob(jobId)
  if (j.assigneeHuId !== me.id) throw new BizError('仅责任人可更新进度', 403)
  if (j.status !== 'working' && j.status !== 'blocked' && j.status !== 'rework') throw new BizError('执行中工单才可更新进度')
  const p = Math.max(0, Math.min(100, Math.round(progress)))
  j.progress = p
  j.status = p >= 100 ? 'done' : 'working'
  j.trace.push(tr(me.name, `更新进度 ${p}%`, note || undefined))
  saveJob(j)
  if (j.orderId) {
    const o = queries.orderById(j.orderId)
    if (o) notify([o.requesterHuId], `${j.id} 进度 ${p}%`, note || `${me.name} 更新了进度`, `/job/${j.id}`)
  }
  return j
}

export function blockJob(me: HU, jobId: string, reason: string) {
  if (!reason) throw new BizError('受阻原因必填')
  const j = mustJob(jobId)
  if (j.assigneeHuId !== me.id) throw new BizError('仅责任人可报受阻', 403)
  if (j.status !== 'working') throw new BizError('执行中工单才可报受阻')
  j.status = 'blocked'
  j.blockedReason = reason
  j.trace.push(tr(me.name, '报受阻', reason))
  saveJob(j)
  return j
}

export function unblockJob(me: HU, jobId: string) {
  const j = mustJob(jobId)
  if (j.status !== 'blocked') throw new BizError('仅受阻工单可解除')
  j.status = 'working'
  j.blockedReason = null
  j.trace.push(tr(me.name, '解除受阻'))
  saveJob(j)
  return j
}

export function submitDeliverable(me: HU, jobId: string, name: string, file: string) {
  if (!name) throw new BizError('交付物名称必填')
  const j = mustJob(jobId)
  if (j.assigneeHuId !== me.id) throw new BizError('仅责任人可提交交付物', 403)
  if (j.status !== 'working' && j.status !== 'blocked' && j.status !== 'rework' && j.status !== 'done')
    throw new BizError('当前状态不可提交交付物')
  j.status = 'done'
  j.progress = 100
  j.deliverables.push({ name, file: file || '', at: nowLocal() })
  j.trace.push(tr(me.name, '提交交付物', name))
  saveJob(j)
  if (j.ofdId) {
    const f = mustOfd(j.ofdId)
    f.status = 'awaitAccept'
    if (!f.awaitSince) f.awaitSince = nowLocal()
    f.trace.push(tr(me.name, `${j.id} 完工交物`))
    saveOfd(f)
  }
  if (j.orderId) {
    const o = queries.orderById(j.orderId)
    if (o) notify([o.requesterHuId], `${j.id} 已完工待验收`, `交付物：${name}`, `/job/${j.id}`)
  }
  return j
}

// ---- 验收一项：意见必填；退回一项 → 返工计数+1、工单回 rework；全过 → 自动关 F/J/O ----
export function checkDeliverable(me: HU, ofdId: string, delivId: string, result: 'pass' | 'fail', comment: string) {
  if (!comment || !comment.trim()) throw new BizError('验收意见必填')
  const f = mustOfd(ofdId)
  if (f.status !== 'awaitAccept' && f.status !== 'inProgress') throw new BizError('履约单当前状态不可验收')
  const d = f.deliverables.find((x) => x.id === delivId)
  if (!d) throw new BizError('交付物不存在')
  d.result = result
  d.comment = comment
  f.trace.push(tr(me.name, result === 'pass' ? '验收通过一项' : '退回一项', `${d.name} · ${comment}`))
  saveOfd(f)

  if (result === 'fail') {
    // 退回：关联工单返工计数 +1，回到 rework 待整改
    const jobs = queries.jobsByOfd(ofdId)
    for (const j of jobs) {
      if (j.status === 'done' || j.status === 'waitCheck' || j.status === 'working') {
        j.reworkCount += 1
        j.status = 'rework'
        j.trace.push(tr(me.name, '验收退回，返工整改', `${d.name}：${comment}`))
        saveJob(j)
        if (j.assigneeHuId) notify([j.assigneeHuId], `${j.id} 验收退回需返工`, `${d.name}：${comment}`, `/job/${j.id}`)
      }
    }
    // 履约单回到执行中，等待返工补交
    f.status = 'inProgress'
    f.awaitSince = null
    saveOfd(f)
  } else {
    // 通过一项后尝试自动关单
    autoCloseIfDone(ofdId)
  }
  return mustOfd(ofdId)
}

function autoCloseIfDone(ofdId: string) {
  const f = queries.ofdById(ofdId)
  if (!f) return
  const allPass = f.deliverables.length > 0 && f.deliverables.every((d) => d.result === 'pass')
  if (!allPass) return
  f.status = 'closed'
  f.trace.push(tr('系统', '全部交付物验收通过，关闭履约单'))
  saveOfd(f)
  const assignees: string[] = []
  for (const j of queries.jobsByOfd(ofdId)) {
    if (j.status !== 'closed' && j.status !== 'terminated' && j.status !== 'rejected') {
      j.status = 'closed'
      j.progress = 100
      j.trace.push(tr('系统', '履约单关闭，工单随之关闭'))
      saveJob(j)
      if (j.assigneeHuId) assignees.push(j.assigneeHuId)
    }
  }
  if (f.orderId) {
    const o = queries.orderById(f.orderId)
    if (o && o.status !== 'closed') {
      o.status = 'closed'
      o.trace.push(tr('系统', '履约关闭，需求单归档'))
      saveOrder(o)
    }
  }
  notify(assignees, `${f.id} 验收通过已关闭`, '全部交付物验收通过，本单闭环', `/ofd/${f.id}`)
}

export function terminateJob(me: HU, jobId: string, reason: string) {
  if (!reason) throw new BizError('中止原因必填')
  const j = mustJob(jobId)
  if (j.status === 'closed' || j.status === 'terminated') throw new BizError('工单已结束，不可中止')
  j.status = 'terminated'
  j.trace.push(tr(me.name, '中止工单', reason))
  saveJob(j)
  return j
}

export function transferJob(me: HU, jobId: string, toHuId: string, reason: string) {
  const toHu = queries.huById(toHuId)
  if (!toHu) throw new BizError('目标责任人不存在')
  const j = mustJob(jobId)
  if (j.status === 'closed' || j.status === 'terminated') throw new BizError('工单已结束，不可转派')
  j.assigneeHuId = toHuId
  j.trace.push(tr(me.name, `转派给 ${toHu.name}`, reason || undefined))
  saveJob(j)
  notify([toHuId], `工单 ${jobId} 转派给你`, `${me.name} 转派（${reason || '未填理由'}），你成为新责任人`, `/job/${jobId}`)
  return j
}

// ---- 48h 自动验收（惰性触发：查看履约单/列表时调用）----
export function autoAcceptIfDue(ofdId: string): OfdDoc {
  const f = queries.ofdById(ofdId)
  if (!f) throw new BizError('履约单不存在', 404)
  if (f.status === 'awaitAccept' && f.awaitSince) {
    const due = parseLocal(f.awaitSince) + 48 * HOUR
    if (Date.now() >= due) {
      for (const d of f.deliverables) {
        if (!d.result) {
          d.result = 'pass'
          d.comment = '超 48 小时未验收，系统自动通过（验收是义务非权力）'
        }
      }
      f.trace.push(tr('系统', '48h 未验收，自动通过全部交付物'))
      saveOfd(f)
      autoCloseIfDone(ofdId)
    }
  }
  return mustOfd(ofdId)
}

/** 全量惰性扫描（列表/看板拉取时触发一次，保证红灯与自动验收新鲜） */
export function sweepAutoAccept() {
  for (const f of queries.allOfds()) {
    if (f.status === 'awaitAccept' && f.awaitSince) {
      const due = parseLocal(f.awaitSince) + 48 * HOUR
      if (Date.now() >= due) autoAcceptIfDue(f.id)
    }
  }
}

// ================= 三红灯（口径同 redlights.ts）=================
export function jobRedLights(job: JobDoc, ofdAwaitSince?: string | null): Array<'idle' | 'noAccept' | 'stuckCheck'> {
  const out: Array<'idle' | 'noAccept' | 'stuckCheck'> = []
  const nowT = Date.now()
  if (job.status === 'waitAccept' && nowT - parseLocal(job.createdAt) > 48 * HOUR) out.push('noAccept')
  if ((job.status === 'working' || job.status === 'blocked') && job.assigneeHuId) {
    const progTimes = job.trace.filter((t) => t.action.startsWith('更新进度')).map((t) => parseLocal(t.time))
    const lastProg = progTimes.length ? Math.max(...progTimes) : null
    const acceptTime = job.trace.find((t) => t.action === '接单' || t.action.startsWith('认领'))?.time
    const base = lastProg ?? (acceptTime ? parseLocal(acceptTime) : null)
    if (base && nowT - base > 24 * HOUR) out.push('idle')
  }
  if (ofdAwaitSince && nowT - parseLocal(ofdAwaitSince) > 48 * HOUR) out.push('stuckCheck')
  return out
}

// ---------------- 内部 ----------------
function mustOrder(id: string): OrderDoc {
  const o = queries.orderById(id)
  if (!o) throw new BizError('需求单不存在', 404)
  return o
}
function mustOfd(id: string): OfdDoc {
  const f = queries.ofdById(id)
  if (!f) throw new BizError('履约单不存在', 404)
  return f
}
function mustJob(id: string): JobDoc {
  const j = queries.jobById(id)
  if (!j) throw new BizError('工单不存在', 404)
  return j
}
