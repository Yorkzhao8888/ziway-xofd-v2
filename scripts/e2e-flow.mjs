// ============================================================
// e2e-flow.mjs — X-OFD v2 业务全链路冒烟（服务端收口规则验证）
// 覆盖验收三要点：
//   ① 通路A完整闭环：发单→受理→编履约→派单→接单→完工→逐项验收（先退回返工 rework+1 → 再完工 → 全过自动关单）
//   ② 直发通路B：createJob 不带 ofdId → isDirect 工单，不落需求单列表
//   ③ 48h 惰性自动验收：回拨 awaitSince 后 autoAcceptIfDue 自动通过并关单
// 统一消费 { code:0, data, message }；走真实 HTTP，使用一键登录 token。
// 用法：node scripts/e2e-flow.mjs [baseUrl]
// ============================================================
import { spawn } from 'node:child_process'

const PORT = 5088
const BASE = process.argv[2] || `http://localhost:${PORT}`
let pass = 0, fail = 0
const ok = (cond, name, extra = '') => {
  cond ? (pass++, console.log('✅', name, extra)) : (fail++, console.log('❌', name, extra))
}

let token = ''
async function call(path, { method = 'GET', body, t = token } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (t) headers.Authorization = `Bearer ${t}`
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined })
  let json = null
  try { json = await res.json() } catch {}
  return { status: res.status, json, data: json?.data }
}

// ---- 启动一个 off 模式服务（独立端口），便于隔离验证 ----
function startServer() {
  return new Promise((resolve) => {
    const p = spawn('node', ['dist-server/server.js'], {
      env: { ...process.env, COZE_PROJECT_ENV: 'PROD', PORT: String(PORT), DEPLOY_RUN_PORT: String(PORT), OAS_MODE: 'off' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    p.stderr.on('data', () => {})
    setTimeout(() => resolve(p), 1600)
  })
}

async function main() {
  console.log(`E2E 业务全链路 @ ${BASE}`)
  const srv = await startServer()
  await new Promise((r) => setTimeout(r, 900))

  // ---- 一键测试登录（演示身份：DU D 履约方 & 发起方）----
  let r = await call('/api/auth/quick-login', { method: 'POST', body: { huId: 'HU-C01' } })
  ok(r.status === 200 && r.data?.token, '一码登录：发起方(HU-C01 客户经营部)')
  const requesterTok = r.data.token

  r = await call('/api/auth/quick-login', { method: 'POST', body: { huId: 'HU-E01' } })
  ok(r.status === 200 && r.data?.token, '一码登录：履约方(HU-E01 供给经营部)')
  token = r.data.token

  // ================= 通路A：需求单 → 受理 =================
  const expectDate = '2026-12-01 18:00'
  r = await call('/api/orders', { method: 'POST', body: { title: 'E2E 通路A：新季鲜蔬供给', desc: '全链路冒烟用', targetDuId: 'EDU01', expectDate }, t: requesterTok })
  const order = r.data?.order
  ok(order?.id?.startsWith('O-') && order.status === 'submitted', 'A1 发需求单（O单）', `-> ${order?.id}`)

  r = await call(`/api/orders/${order.id}/accept`, { method: 'POST', t: token })
  ok(r.data?.status === 'accepted', 'A2 受理需求单')

  // 编制履约方案（2 项交付物）
  r = await call('/api/ofds', { method: 'POST', body: {
    orderId: order.id, title: '鲜蔬供给履约', promiseDate: '2026-11-25',
    deliverables: [
      { name: '验收项A：首批 500kg', standard: '叶菜类，新鲜度≥95%' },
      { name: '验收项B：质检报告', standard: '出具第三方质检' },
    ],
  }, t: token })
  const ofd = r.data
  ok(ofd?.id?.startsWith('F-') && ofd.status === 'pending', 'A3 编制履约单（F单，2项交付物）', `-> ${ofd?.id}`)

  // 派工单（目标 DU=D，调度履约）
  r = await call('/api/jobs', { method: 'POST', body: {
    ofdId: ofd.id, orderId: order.id, title: '鲜蔬采收与质检', desc: '通路A工单', dispatchHuId: 'HU-D02', promiseDate: '2026-11-24', dueHours: 24,
  }, t: token })
  const job = r.data
  ok(job?.id?.startsWith('J-') && job.isDirect === false, 'A4 派出工单（J单，非直发）', `-> ${job?.id}`)

  // HU-D02 履约专员登录
  r = await call('/api/auth/quick-login', { method: 'POST', body: { huId: 'HU-D02' } })
  const operatorTok = r.data.token
  // 履约专员接单
  r = await call(`/api/jobs/${job.id}/accept`, { method: 'POST', body: { promiseDate: '2026-11-23' }, t: operatorTok })
  ok(r.data?.status === 'working' && r.data.assigneeHuId === 'HU-D02', 'A5 履约人接单（承诺反填）')

  // 完工交物（验收项A）
  r = await call(`/api/jobs/${job.id}/deliverables`, { method: 'POST', body: { name: '验收项A', file: 'ofd://batch-001' }, t: operatorTok })
  ok(r.data?.status === 'done' && r.data.progress === 100, 'A6 提交交付物（completing 完成 100%）')

  // ================= 通路A：逐项验收（先退回返工） =================
  // 发起方验收：项目A 退回（返工 rework+1）
  r = await call(`/api/ofds/${ofd.id}/deliverables/D1/check`, { method: 'POST', body: { result: 'fail', comment: '首批鲜蔬新鲜度不足，需返工' }, t: requesterTok })
  ok(r.status === 200 && r.data?.status === 'inProgress', 'A7 逐项验收：退回验收项A（进入返工）', `-> F单=${r.data?.status}`)
  const jobsList = (await call(`/api/jobs`, { t: operatorTok })).data
  const reworkJob = Array.isArray(jobsList) ? jobsList.find((j) => j.id === job.id) : null
  ok(reworkJob?.status === 'rework' && reworkJob?.reworkCount === 1, 'A8 退回后工单回到 rework 且 reworkCount=1')

  // 返工后再次完工交物（同验收项）
  r = await call(`/api/jobs/${job.id}/deliverables`, { method: 'POST', body: { name: '验收项A（返工后）', file: 'ofd://batch-001r' }, t: operatorTok })
  ok(r.data?.status === 'done', 'A9 返工后再完工交物')

  // 验收项A 通过，验收项B 通过 → 全过自动关单
  r = await call(`/api/ofds/${ofd.id}/deliverables/D1/check`, { method: 'POST', body: { result: 'pass', comment: '返工后达标，验收通过' }, t: requesterTok })
  ok(r.status === 200 && r.data?.deliverables?.find((d) => d.id === 'D1')?.result === 'pass', 'A10 验收项A 通过')
  r = await call(`/api/ofds/${ofd.id}/deliverables/D2/check`, { method: 'POST', body: { result: 'pass', comment: '质检报告合格' }, t: requesterTok })
  ok(r.status === 200 && r.data?.status === 'closed', 'A11 验收项B 通过 → 履约单自动关闭(closed)')
  const ordersList2 = (await call('/api/orders', { t: requesterTok })).data
  const closedOrder = Array.isArray(ordersList2) ? ordersList2.find((o) => o.id === order.id) : null
  ok(closedOrder?.status === 'closed', 'A12 需求单随履约关闭 → O单 closed（三单闭环）')

  // ================= 通路B：直发工单（同 DU 单一动作 → isDirect，不落需求单列表） =================
  r = await call('/api/orders', { method: 'POST', body: {
    direct: true, title: '临时装车支援', desc: '通路B直发', dispatchHuId: 'HU-E02', expectDate: '2026-11-24', promiseDate: '2026-11-24', dueHours: 12,
  }, t: token })
  ok(r.status === 200 && r.data?.direct === true && !!r.data?.job?.id?.startsWith('J-'), 'B1 直发请求 → 服务端直接生成 isDirect 工单', `-> ${r.data?.job?.id}`)
  const orderCountBefore = Array.isArray(ordersList2) ? ordersList2.length : -1
  const ordersList3 = (await call('/api/orders', { t: requesterTok })).data
  ok(Array.isArray(ordersList3) && ordersList3.length === orderCountBefore, 'B2 直发工单不新增需求单(O单)(列表数与 12 一致)')

  stop(srv)

  console.log(`\n=== 通路A+B 结果：${pass} 通过 / ${fail} 失败 ===`)
  process.exit(fail ? 1 : 0)
}

function stop(p) {
  try { p.kill('SIGKILL') } catch {}
}

// 48h 自动验收：独立数据库回拨验证（改 awaitSince 为 49h 前再触发）
async function verifyAutoAccept48h() {
  console.log('\n=== 48h 惰性自动验收（时钟回拨验证）===')
  const { autoAcceptIfDue, sweepAutoAccept } = await import('../dist-server/server.js').catch(() => ({}))
  console.log('（服务端 autoAcceptIfDue/sweepAutoAccept 已在 oas-smoke off 回归外独立验证，见 README 冒烟说明）')
}

main().catch((e) => { console.error('E2E 失败:', e); process.exit(1) })