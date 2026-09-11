// ABOUTME: 健康检查与骨架元信息接口（无需认证）
import { Router } from 'express';
import { config, isAuthConfigured } from '../config';
import { getDb } from '../db';

const router = Router();

router.get('/api/health', (_req, res) => {
  let dbOk = false;
  try {
    getDb().prepare('SELECT 1').get();
    dbOk = true;
  } catch (err) {
    console.error('[health] db check failed:', err);
  }

  res.json({
    status: 'ok',
    service: 'xoFD v2 履约中枢',
    env: config.env,
    authConfigured: isAuthConfigured(),
    db: dbOk ? 'ok' : 'error',
    timestamp: new Date().toISOString(),
  });
});

export default router;
