/** OAS 认证后的系统用户 */
export interface OasUser {
  userId: string;
  username: string;
  displayName: string;
  tenantId: string;
}

/** /api/auth/config 响应 */
export interface AuthConfigResponse {
  configured: boolean;
  loginUrl: string;
  tenantClaim: string;
}

/** /api/health 响应 */
export interface HealthResponse {
  status: string;
  service: string;
  env: string;
  authConfigured: boolean;
  db: string;
  timestamp: string;
}

/** 后端统一错误体 */
export interface ApiErrorBody {
  error: string;
  code?: string;
  message?: string;
}
