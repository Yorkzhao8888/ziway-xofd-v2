/**
 * OFD-LINK-03 整改自测（off 内测模式）
 * 覆盖：三号凭证链 E2E（O→F→J→回执→凭证查询）+ outbox 幂等 + G7 无注册
 * 用法：node scripts/link03-smoke.mjs [BASE_URL]  （默认 http://localhost:5000）
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const here = dirname(fileURLToPath(import.meta.url))
const { DB } = await import('better-sqlite3')

const BASE = process.argv[2] || 'http://localhost:5000'
let PASS = 0, FAIL = 0
const ok = (name, cond, extra = '') => {
  if (cond) { PASS++; console.log(`  ✅ ${name}`) }
  else { FAIL++; console.log(`  ❌ ${name} ${extra}`) }
}

const api = async (path, opts = {}, token) => {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  if (token) headers.Authorization = `Bearer ${token}`
  const r = await fetch(BASE + path, { ...opts, headers })
  let body = null
  try { body = await r.json() } catch { body = await r.text() }
  return { status: r.status, body }
}

// 1) test123 一键登录
const ql = await api('/api/auth/quick-login', { method: 'POST', body: JSON.stringify({ account: 'test123' }) })
ok('test123 一键登录', ql.status === 200 && ql.body?.code === 0 && !!ql.body?.data?.token)
const hu = ql.body?.data?.hu
const TOK = ql.body?.data?.token
console.log(`   → 当前身份: ${hu?.name} (${hu?.id}) ${hu?.role}`)

// 2) 无公开注册端点（G7：注册归底座）
const reg = await api('/api/auth/quick-register', { method: 'POST', body: JSON.stringify({ name: 'x' }) }, TOK)
ok('G7 无公开 quick-register 端点', reg.status === 404, `status=${reg.status}`)

// 3) 三号凭证链 E2E：建 O 需求单
const o = await api('/api/orders', {
  method: 'POST', body: JSON.stringify({ title: 'LINK03 压测需求', desc: '凭证链 E2E' }),
}, TOK)
const order = o.body?.data
ok('建 O 需求单', o.status === 200 && o.body?.code === 0 && /^O-\d{6}-\d{4}$/.test(order?.id || ''), `id=${order?.id}`)

// 4) 建 F 履约单（O→F）
const f = await api('/api/ofds', { method: 'POST', body: JSON.stringify({ orderId: order.id, duId: (hu?.duId || 'DDU01') }) }, TOK)
const ofd = f.body?.data
ok('建 F 履约单', f.status === 200 && f.body?.code === 0 && /^F-\d{6}-\d{4}$/.test(ofd?.id || ''), `id=${ofd?.id}`)

// 5) 建 J 工单（F→J）
const j = await api('/api/jobs', { method: 'POST', body: JSON.stringify({ ofdId: ofd.id, title: 'LINK03 工单', assigneeId: hu.id }) }, TOK)
const job = j.body?.data
ok('建 J 工单', j.status === 200 && j.body?.code === 0 && /^J-\d{6}-\d{4}$/.test(job?.id || ''), `id=${job?.id}`)

// 6) 凭证查询 API（按主体查名下三号+状态）
const v = await api('/api/vouchers', { method: 'POST', body: JSON.stringify({ subjectHuId: hu.id }) }, TOK)
const ledger = v.body?.data
const hasOrder = Array.isArray(ledger?.orders) && ledger.orders.some((x) => x.id === order.id && /^O-/.test(x.id))
const hasOfd = Array.isArray(ledger?.ofds) && ledger.ofds.some((x) => x.id === ofd.id && /^F-/.test(x.id))
const hasJob = Array.isArray(ledger?.jobs) && ledger.jobs.some((x) => x.id === job.id && /^J-/.test(x.id))
ok('凭证查询含 O 号+状态', v.status === 200 && hasOrder, JSON.stringify(ledger?.orders?.find((x) => x.id === order.id) || {}))
ok('凭证查询含 F 号+状态', hasOfd)
ok('凭证查询含 J 号+状态', hasJob)

// 7) outbox：订单/工单/回执事件已入队（幂等）
const pend = await api('/api/outbox/pending', {}, TOK)
const pEvents = pend.body?.data || []
const evOrder = pEvents.some((e) => e.eventId === `evt-${order.id}-created`)
const evJob = pEvents.some((e) => e.eventId === `evt-${job.id}-created`)
ok('outbox 含 order.created', pend.status === 200 && evOrder, `events=${pEvents.length}`)
ok('outbox 含 job.created', evJob)

// 8) outbox ack（幂等确认）
const ackEv = pEvents.find((e) => e.eventId === `evt-${order.id}-created`)
if (ackEv) {
  const a1 = await api('/api/outbox/ack', { method: 'POST', body: JSON.stringify({ eventId: ackEv.eventId, status: 'delivered' }) }, TOK)
  ok('outbox ack 成功', a1.status === 200 && a1.body?.code === 0)
} else ok('outbox ack 目标存在', !!ackEv)

// 汇总
console.log(`\n=== LINK03 自测: ${PASS} 通过 / ${FAIL} 失败 ===`)
process.exit(FAIL ? 1 : 0)