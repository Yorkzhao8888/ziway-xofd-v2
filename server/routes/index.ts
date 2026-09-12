import { Router, type Request, type Response } from 'express'
import { router as apiRouter } from './api'
import { oasHealth } from '../oas'

const router = Router()

// 启动即评估 OAS 配置（on 模式未配公钥时打印 fail-closed 告警）
oasHealth()

// 健康检查（无需鉴权）：附带身份模式状态，便于部署侧探活确认
router.get('/health', (_req: Request, res: Response) => {
  res.json({
    code: 0,
    data: { status: 'ok', env: process.env.COZE_PROJECT_ENV, auth: oasHealth(), ts: Date.now() },
    message: 'ok',
  })
})

// 业务 + 鉴权路由（挂在 /api 下）
router.use('/', apiRouter)

export default router
