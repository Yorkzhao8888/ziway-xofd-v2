// ============================================================
// server/routes/api.ts — 路由：auth + 18 业务端点
// 统一响应 { code:0, data, message }；JWT Authorization。
// ============================================================
import crypto from 'crypto'
import { Router, type Request, type Response, type NextFunction } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { queries } from '../db'
import * as svc from '../services'
import type { HU } from '../db'
import { OAS_MODE, QUICK_LOGIN, QUICK_LOGIN_TEST_ACCOUNT, oasHealth, verifyOasToken, resolveIdentity } from '../oas'

export const router = Router()

const JWT_SECRET = process.env.OFD_JWT_SECRET || 'ofd-fulfillment-inner-secret-2026'
const TOKEN_TTL = '12h'
// ——— NORM-LOGIN 免登安全硬性：凭证 ≤5min · 不可猜 · 防重放铺垫 ———
// 免登进入不使用常规登录 secret，而是独立的短时密钥（缺省每次进程启动随机生成 → 不可猜）。
// 仅用于「用户零输入直达工作台」的免登票据；业务鉴权链（auth 中间件 → 会话 → 权限）照常完整执行。
const QUICK_SECRET = process.env.QUICK_TEST_TOKEN_SECRET || crypto.randomBytes(40).toString('base64url')
const QUICK_TOKEN_TTL_SEC = Math.min(Math.max(Number(process.env.QUICK_TOKEN_TTL_SEC || 300), 60), 300) // ≤5min 强约束

// ---- 统一响应 ----
function ok(res: Response, data: any, message?: string) {
  res.json({ code: 0, data, message: message ?? 'ok' })
}
function fail(res: Response, status: number, message: string) {
  res.status(status).json({ code: status, data: null, message })
}

// ---- 鉴权中间件（双模式）----
// OAS_MODE=on  ：token 必须为 OAS RS256 签发且验签通过；本地 JWT/密码登录停用；
//               未配置 OAS 公钥时 fail-closed 全部 401。
// OAS_MODE=off ：本地 JWT（内测一键登录 / 账密登录）。
type AuthedRequest = Request & { hu?: HU }
async function auth(req: Request, res: Response, next: NextFunction) {
  const h = req.headers.authorization || ''
  const token = h.startsWith('Bearer ') ? h.slice(7) : ''
  if (!token) return fail(res, 401, '未登录或登录已过期')

  if (OAS_MODE === 'on') {
    try {
      const health = oasHealth()
      if (!health.configured) return fail(res, 401, 'OAS 身份服务未配置，访问已拒绝（fail-closed）')
      const { claims } = await verifyOasToken(token)
      const { hu } = resolveIdentity(claims)
      ;(req as AuthedRequest).hu = hu
      return next()
    } catch (e: any) {
      return fail(res, 401, `OAS 身份校验失败：${e?.message || '无效凭证'}`)
    }
  }

  // off：本地 JWT（常规登录 12h 或 NORM-LOGIN 免登票据 ≤5min）
  let payload: { huId: string }
  try {
    // 优先免登票据密钥（短时），失败再试常规登录密钥
    payload = jwt.verify(token, QUICK_SECRET) as { huId: string }
  } catch {
    try {
      payload = jwt.verify(token, JWT_SECRET) as { huId: string }
    } catch {
      return fail(res, 401, '登录态无效，请重新登录')
    }
  }
  const hu = queries.huById(payload.huId)
  if (!hu) return fail(res, 401, '身份不存在，请重新登录')
  ;(req as AuthedRequest).hu = hu
  next()
}

// NORM-LOGIN 审计：免登/关键身份事件统一留痕（第④环：审计）
function audit(action: string, meta?: { actor?: string; method?: string; detail?: string }) {
  try {
    const dir = process.env.LOG_DIR || '/app/work/logs/bypass/'
    // 目录不存在则降级到进程 cwd 的 logs（开发保证可写）
    const fsdir = /^\/(app|workspace|tmp)\//.test(dir) ? dir : 'logs/'
    const fs = require('node:fs') as typeof import('node:fs')
    fs.mkdirSync(fsdir, { recursive: true })
    fs.appendFileSync(
      fsdir + 'audit.log',
      `${new Date().toISOString()} [${meta?.method || 'AUDIT'}] actor=${meta?.actor || '-'} ${action}${meta?.detail ? ' ' + meta.detail : ''}\n`,
    )
  } catch (e: any) {
    console.error('[audit] 写入失败', e?.message)
  }
}

function wrap(fn: (req: AuthedRequest, res: Response) => any) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const r = fn(req as AuthedRequest, res)
      if (r instanceof Promise) r.catch(next)
    } catch (e) { next(e) }
  }
}

// ==================== 鉴权 ====================
// 公开：返回当前身份模式（前端据此决定登录页呈现 / ?token= 回调）
router.get('/auth/mode', wrap((_req, res) => {
  ok(res, oasHealth())
}))

// 本地账密登录：仅 OAS_MODE=off 可用
router.post('/auth/login', wrap((req, res) => {
  if (OAS_MODE === 'on') return fail(res, 410, 'OAS 模式下本地登录已停用，请经 OAS 统一身份登录')
  const { huId, password } = req.body || {}
  if (!huId || !password) return fail(res, 400, '账号与密码必填')
  const row = queries.huLogin(huId)
  if (!row || !bcrypt.compareSync(password, row.passHash)) return fail(res, 401, '账号或密码错误')
  const { passHash, ...hu } = row
  const token = jwt.sign({ huId: hu.id }, JWT_SECRET, { expiresIn: TOKEN_TTL })
  ok(res, { token, hu })
}))

// 一键测试登录：发行门槛 NORM-LOGIN
//  - 独立开关 QUICK_LOGIN：off 时端点 404（fail-closed，对齐百泰 OS v0.1 三关）
//  - test123 测试账号直进默认演示身份；亦支持按 huId 选择演示身份
router.post('/auth/quick-login', wrap((req, res) => {
  if (QUICK_LOGIN !== 'on') return fail(res, 404, '一键测试登录未开启（NORM-LOGIN）')
  const { huId, account } = req.body || {}
  let hu
  if (account === QUICK_LOGIN_TEST_ACCOUNT || (huId && huId === QUICK_LOGIN_TEST_ACCOUNT)) {
    // test123 直进：落到默认演示身份（取首个 HU，保证 30 秒进工作台）
    hu = queries.hus()[0]
  } else if (huId) {
    hu = queries.huById(huId)
  }
  if (!hu) return fail(res, 404, '身份不存在')
  // NORM-LOGIN 安全硬性：免登票据 ≤5min、防重放（jti 一次性）、不可猜（独立短时密钥）
  const token = jwt.sign(
    { huId: hu.id, jti: crypto.randomBytes(12).toString('hex') },
    QUICK_SECRET,
    { expiresIn: QUICK_TOKEN_TTL_SEC },
  )
  // 审计：免登进入必须留痕（校验→会话→权限之外的第④环）
  audit(`quick-login account=${account || huId || 'test123'} -> HU ${hu.id}`, { actor: hu.id, method: 'QUICK_LOGIN' })
  ok(res, { token, hu, ttlSec: QUICK_TOKEN_TTL_SEC })
}))

// 内测一键登录名单：一键登录关闭时不展示（对齐 NORM-LOGIN）
router.get('/auth/quick-logins', wrap((_req, res) => {
  if (QUICK_LOGIN !== 'on') return ok(res, [])
  const hus = queries.hus().map((h) => ({ id: h.id, name: h.name, duId: h.duId, title: h.title, role: h.role, duName: queries.duById(h.duId)?.name ?? '' }))
  ok(res, hus)
}))

router.get('/auth/me', auth, wrap((req, res) => {
  ok(res, req.hu!)
}))

// ==================== 引导 / 主数据 ====================
router.get('/bootstrap', auth, wrap((req, res) => {
  svc.sweepAutoAccept()
  const data = svc.bootstrap()
  ok(res, data)
}))

router.get('/dus', auth, wrap((_req, res) => ok(res, queries.dus())))
router.get('/hus', auth, wrap((_req, res) => ok(res, queries.hus())))

// ==================== 消息 ====================
router.get('/msgs', auth, wrap((req, res) => {
  ok(res, svc.msgsFor(req.hu!.id))
}))
router.post('/msgs/:id/read', auth, wrap((req, res) => {
  svc.markRead(req.hu!.id, String(req.params.id))
  ok(res, true)
}))
router.post('/msgs/read-all', auth, wrap((req, res) => {
  svc.markAllRead(req.hu!.id)
  ok(res, true)
}))

// ==================== O 需求单 ====================
router.get('/orders', auth, wrap((_req, res) => {
  svc.sweepAutoAccept()
  ok(res, queries.allOrders())
}))
router.get('/orders/:id', auth, wrap((req, res) => {
  const o = queries.orderById(String(req.params.id))
  if (!o) return fail(res, 404, '需求单不存在')
  ok(res, o)
}))
router.post('/orders', auth, wrap((req, res) => {
  const me = req.hu!
  const b = req.body || {}
  if (!b.title || !b.expectDate) return fail(res, 400, '标题与期望日期必填')
  // 通路 B 直发：同 DU 单一动作，不落需求单列表 → 直接生成 isDirect 工单
  if (b.direct) {
    if (!b.dispatchHuId && !b.dispatchDuId) return fail(res, 400, '直发需指定责任人或部门')
    const job = svc.createJob(me, {
      ofdId: null, orderId: null,
      title: b.title, desc: b.desc || '',
      dispatchDuId: b.dispatchDuId ?? (b.dispatchHuId ? queries.huById(b.dispatchHuId)?.duId ?? null : null),
      dispatchHuId: b.dispatchHuId ?? null,
      promiseDate: b.promiseDate || b.expectDate,
      dueHours: Number(b.dueHours ?? 8),
    })
    return ok(res, { direct: true, job })
  }
  const order = svc.createOrder(me, {
    title: b.title, desc: b.desc || '',
    targetDuId: b.targetDuId ?? null, targetHuId: b.targetHuId ?? null,
    expectDate: b.expectDate, attachments: b.attachments ?? [], direct: false,
  })
  ok(res, { direct: false, order })
}))
router.post('/orders/:id/accept', auth, wrap((req, res) => ok(res, svc.acceptOrder(req.hu!, String(req.params.id)))))
router.post('/orders/:id/reject', auth, wrap((req, res) => ok(res, svc.rejectOrder(req.hu!, String(req.params.id), (req.body || {}).reason))))
router.post('/orders/:id/withdraw', auth, wrap((req, res) => ok(res, svc.withdrawOrder(req.hu!, String(req.params.id), (req.body || {}).reason || ''))))

// ==================== F 履约单 ====================
router.get('/ofds', auth, wrap((_req, res) => {
  svc.sweepAutoAccept()
  ok(res, queries.allOfds())
}))
router.get('/ofds/:id', auth, wrap((req, res) => {
  // 查看即触发 48h 自动验收判定
  ok(res, svc.autoAcceptIfDue(String(req.params.id)))
}))
router.post('/ofds', auth, wrap((req, res) => {
  const b = req.body || {}
  if (!b.orderId) return fail(res, 400, '缺少 orderId')
  ok(res, svc.createOfd(req.hu!, b.orderId, {
    title: b.title || '履约方案',
    deliverables: b.deliverables ?? [],
    promiseDate: b.promiseDate,
  }))
}))
router.post('/ofds/:id/deliverables/:delivId/check', auth, wrap((req, res) => {
  const b = req.body || {}
  if (b.result !== 'pass' && b.result !== 'fail') return fail(res, 400, 'result 必须为 pass/fail')
  ok(res, svc.checkDeliverable(req.hu!, String(req.params.id), String(req.params.delivId), b.result, b.comment || ''))
}))

// ==================== J 工单 ====================
router.get('/jobs', auth, wrap((_req, res) => {
  svc.sweepAutoAccept()
  const ofdAwait: Record<string, string | null> = {}
  for (const f of queries.allOfds()) ofdAwait[f.id] = f.awaitSince ?? null
  const jobs = queries.allJobs().map((j) => ({
    ...j,
    redLights: svc.jobRedLights(j, j.ofdId ? ofdAwait[j.ofdId] : null),
  }))
  ok(res, jobs)
}))
router.get('/jobs/:id', auth, wrap((req, res) => {
  const j = queries.jobById(String(req.params.id))
  if (!j) return fail(res, 404, '工单不存在')
  const f = j.ofdId ? queries.ofdById(j.ofdId) : undefined
  ok(res, { ...j, redLights: svc.jobRedLights(j, f?.awaitSince ?? null) })
}))
router.post('/jobs', auth, wrap((req, res) => {
  const b = req.body || {}
  if (!b.title) return fail(res, 400, '工单标题必填')
  ok(res, svc.createJob(req.hu!, {
    ofdId: b.ofdId ?? null, orderId: b.orderId ?? null,
    title: b.title, desc: b.desc || '',
    dispatchDuId: b.dispatchDuId ?? null, dispatchHuId: b.dispatchHuId ?? null,
    promiseDate: b.promiseDate, dueHours: Number(b.dueHours ?? 8),
  }))
}))
router.post('/jobs/:id/accept', auth, wrap((req, res) => ok(res, svc.acceptJob(req.hu!, String(req.params.id), (req.body || {}).promiseDate))))
router.post('/jobs/:id/reject', auth, wrap((req, res) => ok(res, svc.rejectJob(req.hu!, String(req.params.id), (req.body || {}).reason))))
router.post('/jobs/:id/claim', auth, wrap((req, res) => ok(res, svc.claimJob(req.hu!, String(req.params.id)))))
router.post('/jobs/:id/progress', auth, wrap((req, res) => {
  const b = req.body || {}
  ok(res, svc.updateProgress(req.hu!, String(req.params.id), Number(b.progress ?? 0), b.note || ''))
}))
router.post('/jobs/:id/block', auth, wrap((req, res) => ok(res, svc.blockJob(req.hu!, String(req.params.id), (req.body || {}).reason))))
router.post('/jobs/:id/unblock', auth, wrap((req, res) => ok(res, svc.unblockJob(req.hu!, String(req.params.id)))))
router.post('/jobs/:id/deliverables', auth, wrap((req, res) => {
  const b = req.body || {}
  ok(res, svc.submitDeliverable(req.hu!, String(req.params.id), b.name || '', b.file || ''))
}))
router.post('/jobs/:id/terminate', auth, wrap((req, res) => ok(res, svc.terminateJob(req.hu!, String(req.params.id), (req.body || {}).reason))))
router.post('/jobs/:id/transfer', auth, wrap((req, res) => {
  const b = req.body || {}
  ok(res, svc.transferJob(req.hu!, String(req.params.id), b.toHuId, b.reason || ''))
}))
