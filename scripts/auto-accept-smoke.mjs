// ============================================================
// auto-accept-smoke.mjs — 48h 惰性自动验收验证
// 原理：直接对数据库回拨 ofds.awaitSince 到 49 小时前（awaitAccept 态），
//       再通过 GET /api/ofds/:id（服务端 autoAcceptIfDue 惰性触发）验证自动通过全部交付物并关单。
// 说明：48h 是「验收是义务」——超时未验收系统自动通过并关闭履约单/需求单。
// ============================================================
import { spawn } from 'node:child_process'
import Database from 'better-sqlite3'
import { existsSync } from 'node:fs'

const PORT = 5099
const BASE = `http://localhost:${PORT}`
let pass = 0, fail = 0
const ok = (cond, name, extra = '') => { cond ? (pass++, console.log('✅', name, extra)) : (fail++, console.log('❌', name, extra)) }

async function call(path, { method = 'GET', body, token } = {}) {
  const h = { 'Content-Type': 'application/json' }
  if (token) h.Authorization = `Bearer ${token}`
  const res = await fetch(BASE + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined })
  let json = null
  try { json = await res.json() } catch {}
  return { status: res.status, json, data: json?.data }
}

function startServer() {
  return new Promise((resolve) => {
    const p = spawn('node', ['dist-server/server.js'], {
      env: { ...process.env, COZE_PROJECT_ENV: 'PROD', PORT: String(PORT), DEPLOY_RUN_PORT: String(PORT), OAS_MODE: 'off', DB_PERSIST: '/tmp/ofd-autocheck.db' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    p.stderr.on('data', () => {})
    setTimeout(() => resolve(p), 1500)
  })
}

async function main() {
  console.log('48h 自动验收冒烟 @', BASE)
  const srv = await startServer()
  await new Promise((r) => setTimeout(r, 800))

  // 履约方登录（EDU01 duAdmin）→ 快速建一条走 awaitAccept 的链路
  let r = await call('/api/auth/quick-login', { method: 'POST', body: { huId: 'HU-E01' } })
  const duTok = r.data.token
  r = await call('/api/auth/quick-login', { method: 'POST', body: { huId: 'HU-C01' } })
  const reqTok = r.data.token

  // 发需求 → 受理 → 编履约(1项) → 派单 → 接单 → 交货 → 回到 awaitAccept 且不立即验收
  let rr = await call('/api/orders', { method: 'POST', body: { title: '48h自动验收单', desc: '验证自动通过', targetDuId: 'EDU01', expectDate: '2026-12-01 18:00' }, token: reqTok })
  const order = rr.data.order
  await call(`/api/orders/${order.id}/accept`, { method: 'POST', token: duTok })
  rr = await call('/api/ofds', { method: 'POST', body: { orderId: order.id, title: '48h履约', promiseDate: '2026-12-02', deliverables: [{ name: '交付项', standard: '合格' }] }, token: duTok })
  const ofd = rr.data
  rr = await call('/api/jobs', { method: 'POST', body: { ofdId: ofd.id, orderId: order.id, title: '48h工单', dispatchHuId: 'HU-E02', promiseDate: '2026-12-02', dueHours: 72 }, token: duTok })
  const job = rr.data
  let token = (await call('/api/auth/quick-login', { method: 'POST', body: { huId: 'HU-E02' } })).data.token
  rr = await call(`/api/jobs/${job.id}/accept`, { method: 'POST', token })
  rr = await call(`/api/jobs/${job.id}/deliverables`, { method: 'POST', body: { name: '交付项', file: 'x' }, token })
  ok(rr.data?.status === 'done', '前置：交付完成，F单进入 awaitAccept')

  // 确认当前 F 单状态
  let f0 = (await call(`/api/ofds/${ofd.id}`, { token: reqTok })).data
  ok(f0?.status === 'awaitAccept', `前置：F单 awaitAccept（此时不自动通过，未超48h）`, `status=${f0?.status}`)

  // ---- 回拨 awaitSince 到 49 小时前（模拟超时）----
  const now = new Date()
  const past = new Date(now.getTime() - 49 * 60 * 60 * 1000)
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  // 定位数据库：DB_PERSIST 未被服务端读取时回退到默认路径；服务端于 /app/data 或 /tmp 建库。
  // 因 db.ts 固定文件名 ofd.db 且不走 DB_PERSIST，这里按默认候选路径回拨——用服务端同一套数据库。
  const candidates = [process.env.COZE_PROJECT_ENV === 'PROD' ? '/tmp' : '/app/data', '/tmp', 'data']
  let dbPath = null
  for (const dir of candidates) {
    const p = dir + '/ofd.db'
    if (existsSync(p)) { dbPath = p; break }
  }
  if (!dbPath) { console.error('⚠ 未找到 SQLite 数据库文件，跳过回拨'); stop(srv); process.exit(1) }
  console.log('回拨数据库:', dbPath)
  const db = new Database(dbPath)
  db.prepare('UPDATE ofds SET awaitSince=? WHERE id=?').run(fmt(past), ofd.id)
  db.close()

  // ---- 惰性触发：GET /api/ofds/:id → autoAcceptIfDue 判定 48h 到期 → 自动通过 ----
  const fAfter = (await call(`/api/ofds/${ofd.id}`, { token: reqTok })).data
  const allPass = fAfter?.deliverables?.every((d) => d.result === 'pass')
  ok(fAfter?.status === 'closed' && allPass, '48h到期后惰性触发：交付物自动通过且履约单 closed', `status=${fAfter?.status}`)
  const orderAfter = (await call('/api/orders', { token: reqTok })).data.find((o) => o.id === order.id)
  ok(orderAfter?.status === 'closed', '伴随：需求单自动关闭（三单闭环）', `O=${orderAfter?.status}`)

  stop(srv)
  console.log(`\n=== 48h 自动验收结果：${pass} 通过 / ${fail} 失败 ===`)
  process.exit(fail ? 1 : 0)
}
function stop(p) { try { p.kill('SIGKILL') } catch {} }
main().catch((e) => { console.error('失败:', e); process.exit(1) })