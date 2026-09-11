// ABOUTME: Express 认证中间件 — 从 Authorization: Bearer 提取 OAS JWT，验签后挂载 req.user
import type { NextFunction, Request, Response } from 'express';
import { OasAuthError, verifyOasToken, type OasUser } from './oas';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: OasUser;
    }
  }
}

function extractBearerToken(req: Request): string | null {
  const header = req.header('authorization') ?? req.header('Authorization');
  if (!header || !header.toLowerCase().startsWith('bearer ')) {
    return null;
  }
  const token = header.slice(7).trim();
  return token || null;
}

/** 强制认证：无 token 或验签失败一律 401，禁止匿名/ Mock 放行 */
export async function requireOasAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({
      error: 'unauthorized',
      code: 'token_missing',
      message: '缺少认证令牌（Authorization: Bearer <token>）',
    });
    return;
  }

  try {
    req.user = await verifyOasToken(token);
    next();
  } catch (err) {
    const code = err instanceof OasAuthError ? err.code : 'token_verification_failed';
    const message = err instanceof Error ? err.message : '认证失败';
    res.status(401).json({
      error: 'unauthorized',
      code,
      message,
    });
  }
}
