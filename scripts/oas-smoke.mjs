// OAS 双模式冒烟（off 回归 + on 验签/fail-closed）
// 用法：脚本内部以 child_process 起 PROD 服务（不同模式/端口），跑 HTTP 断言。
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'

const PORT = 5077
const BASE = `http://localhost:${PORT}`
let pass = 0, fail = 0
const ok = (cond, name) => { cond ? (pass++, console.log('✅', name)) : (fail++, console.log('❌', name)) }

async function http(path, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined })
  let json = null
  try { json = await res.json() } catch {}
  return { status: res.status, json }
}

function startServer(env) {
  return new Promise((resolve) => {
    const p = spawn('node', ['dist-server/server.js'], {
      env: { ...process.env, COZE_PROJECT_ENV: 'PROD', PORT: String(PORT), DEPLOY_RUN_PORT: String(PORT), ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    p.stdout.on('data', () => {})
    p.stderr.on('data', () => {})
    setTimeout(() => resolve(p), 1800)
  })
}
const stop = (p) => p.kill('SIGKILL')

// 生成 RS256 测试密钥对
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const pubPem = publicKey.export({ type: 'spki', format: 'pem' })
const sign = (payload, opts = {}) => jwt.sign(payload, privateKey, { algorithm: 'RS256', expiresIn: opts.expiresIn ?? '1h', keyid: opts.kid ?? 'oas-rsa-001' })

async function main() {
  // ---------- OFF 模式回归 ----------
  console.log('\n=== OAS_MODE=off（本地内测回归）===')
  let srv = await startServer({ OAS_MODE: 'off' })
  await new Promise(r => setTimeout(r, 800))
  let r = await http('/api/auth/mode'); ok(r.json?.data?.mode === 'off', 'off: /auth/mode mode=off')
  r = await http('/api/auth/login', { method: 'POST', body: { huId: 'HU-A01', password: 'ofd123456' } })
  ok(r.status === 200 && r.json?.data?.token, 'off: 本地账密登录成功')
  const localTok = r.json.data.token
  r = await http('/api/bootstrap', { token: localTok }); ok(r.status === 200 && r.json?.data?.dus?.length === 8, 'off: 带 token bootstrap 200')
  r = await http('/api/bootstrap'); ok(r.status === 401, 'off: 无 token 401')
  r = await http('/api/orders', { method: 'POST', token: localTok, body: { title: 'off回归单', desc: 'x', targetDuId: 'EDU01', expectDate: '2026-10-01 18:00' } })
  ok(r.json?.code === 0 && r.json?.data?.order?.id?.startsWith('O-'), 'off: 发单（写链路）正常')
  stop(srv)

  // ---------- ON 模式：配置公钥 ----------
  console.log('\n=== OAS_MODE=on（OAS RS256 验签）===')
  srv = await startServer({ OAS_MODE: 'on', OAS_PUBLIC_KEY: pubPem, OAS_BASE_URL: 'https://oas.example' })
  await new Promise(r => setTimeout(r, 800))
  r = await http('/api/auth/mode'); ok(r.json?.data?.mode === 'on' && r.json?.data?.configured === true, 'on: /auth/mode mode=on configured=true')
  // 本地登录停用
  r = await http('/api/auth/login', { method: 'POST', body: { huId: 'HU-A01', password: 'ofd123456' } })
  ok(r.status === 410, 'on: 本地账密登录已停用(410)')
  r = await http('/api/auth/quick-login', { method: 'POST', body: { huId: 'HU-A01' } })
  ok(r.status === 410, 'on: 一键登录已停用(410)')
  r = await http('/api/auth/quick-logins'); ok(Array.isArray(r.json?.data) && r.json.data.length === 0, 'on: quick-logins 返回空')
  // 合法 OAS token
  const goodTok = sign({ identity_id: 'id-0001', role: 'delivery', sub_role: '履约调度员', name: 'OAS张三', ms_access: ['D:fulfill'] })
  r = await http('/api/bootstrap', { token: goodTok })
  ok(r.status === 200 && r.json?.data?.dus?.length === 8, 'on: 合法 OAS token 验签通过 -> bootstrap 200')
  r = await http('/api/auth/me', { token: goodTok })
  ok(r.status === 200 && r.json?.data?.id === 'OAS-id-0001', `on: 身份推导 HU=${r.json?.data?.id} role=${r.json?.data?.role} duId=${r.json?.data?.duId}`)
  // 未知角色 fail-closed
  const badRoleTok = sign({ identity_id: 'id-0002', role: 'mystery_role', name: 'X' })
  r = await http('/api/bootstrap', { token: badRoleTok })
  ok(r.status === 401, 'on: 未知角色 fail-closed 401')
  // 伪造 token（用另一对密钥签）
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  const forged = jwt.sign({ identity_id: 'id-0003', role: 'admin' }, other.privateKey, { algorithm: 'RS256', keyid: 'oas-rsa-001' })
  r = await http('/api/bootstrap', { token: forged })
  ok(r.status === 401, 'on: 伪造 token（非公钥签名）401')
  // 过期 token
  const expired = sign({ identity_id: 'id-0004', role: 'tech', name: '过期' }, { expiresIn: -10 })
  r = await http('/api/bootstrap', { token: expired })
  ok(r.status === 401, 'on: 过期 token 401')
  // 本地签发的 HS256 token 不再被接受
  r = await http('/api/bootstrap', { token: localTok })
  ok(r.status === 401, 'on: 本地 JWT(HS256) 被拒 401')
  stop(srv)

  // ---------- ON 模式但未配公钥：fail-closed ----------
  console.log('\n=== OAS_MODE=on 但未配公钥（fail-closed 裸奔防护）===')
  srv = await startServer({ OAS_MODE: 'on', OAS_PUBLIC_KEY: '', OAS_BASE_URL: '', OAS_JWKS_URL: '' })
  await new Promise(r => setTimeout(r, 800))
  r = await http('/api/auth/mode'); ok(r.json?.data?.mode === 'on' && r.json?.data?.configured === false && !!r.json?.data?.warning, 'on-nokey: mode=on configured=false 且有告警')
  r = await http('/api/bootstrap', { token: goodTok })
  ok(r.status === 401, 'on-nokey: 即使携带 token 也 401（fail-closed）')
  r = await http('/api/dus', { token: goodTok }); ok(r.status === 401, 'on-nokey: 受保护路由 /dus 401')
  stop(srv)

  console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`)
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
