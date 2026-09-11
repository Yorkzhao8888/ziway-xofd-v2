// ABOUTME: 运行时配置集中读取（环境变量），禁止在业务代码中硬编码
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

const isProd = process.env.COZE_PROJECT_ENV === 'PROD';

/**
 * OAS（生态统一认证）配置。
 * 验签方式二选一：OAS_JWKS_URI（JWKS 端点，推荐）或 OAS_PUBLIC_KEY_PEM（PEM 公钥）。
 * 两者均未配置时，受保护接口返回 401 auth_not_configured，不做任何 Mock 放行。
 */
export const oasConfig = {
  jwksUri: process.env.OAS_JWKS_URI ?? '',
  publicKeyPem: (process.env.OAS_PUBLIC_KEY_PEM ?? '').replace(/\\n/g, '\n'),
  issuer: process.env.OAS_ISSUER ?? '',
  audience: process.env.OAS_AUDIENCE ?? '',
  /** 统一认证登录页地址，用于前端未登录时跳转 */
  loginUrl: process.env.OAS_LOGIN_URL ?? '',
  /** JWT claim 字段映射（不同 IdP 字段名可能不同） */
  claimUserId: process.env.OAS_CLAIM_USER_ID ?? 'sub',
  claimUsername: process.env.OAS_CLAIM_USERNAME ?? 'preferred_username',
  claimDisplayName: process.env.OAS_CLAIM_DISPLAY_NAME ?? 'name',
  claimTenantId: process.env.OAS_CLAIM_TENANT_ID ?? 'tenant_id',
};

export const config = {
  env: (isProd ? 'production' : 'development') as 'production' | 'development',
  isProd,
  /** 服务端口；scripts/dev.sh 与 start.sh 会把 DEPLOY_RUN_PORT 注入 PORT */
  port: envInt('PORT', 5000),
  /**
   * SQLite 数据库文件路径。
   * 生产环境默认 /tmp（沙箱唯一可写目录，但会被定期清理，持久化卷待发单方确认）；
   * 开发环境默认工作区 data/ 目录。可用 DB_PATH 覆盖。
   */
  dbPath:
    process.env.DB_PATH ??
    (isProd ? '/tmp/xofd-v2.db' : path.resolve(process.cwd(), 'data', 'xofd-v2.db')),
  oas: oasConfig,
};

export function isAuthConfigured(): boolean {
  return Boolean(oasConfig.jwksUri || oasConfig.publicKeyPem);
}
