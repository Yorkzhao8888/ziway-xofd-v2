// ABOUTME: 认证相关路由 — 当前用户信息、OAS 前端配置下发
import { Router } from 'express';
import { config, isAuthConfigured } from '../config';
import { requireOasAuth } from '../auth/middleware';

const router = Router();

/**
 * OAS 认证配置（前端引导用）：登录地址是否就绪、认证是否已配置。
 * 本系统不自建用户体系，前端据此决定跳转统一认证或提示未配置。
 */
router.get('/api/auth/config', (_req, res) => {
  res.json({
    configured: isAuthConfigured(),
    loginUrl: config.oas.loginUrl,
    tenantClaim: config.oas.claimTenantId,
  });
});

/** 当前登录用户（需 OAS 验签通过） */
router.get('/api/auth/me', requireOasAuth, (req, res) => {
  res.json({
    authenticated: true,
    user: req.user,
  });
});

export default router;
