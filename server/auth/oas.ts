// ABOUTME: OAS 生态统一认证 — RS256 JWT 验签（支持 JWKS 端点或 PEM 公钥），本系统不自建用户体系
import jwt, { type JwtHeader, type SigningKeyCallback } from 'jsonwebtoken';
import jwksClient, { type JwksClient } from 'jwks-rsa';
import { oasConfig } from '../config';

/** 经 OAS 验签后落到系统内的用户上下文 */
export interface OasUser {
  userId: string;
  username: string;
  displayName: string;
  tenantId: string;
}

export class OasAuthError extends Error {
  constructor(
    public readonly code: 'auth_not_configured' | 'token_invalid' | 'token_verification_failed',
    message: string,
  ) {
    super(message);
    this.name = 'OasAuthError';
  }
}

let client: JwksClient | null = null;

function getJwksClient(): JwksClient {
  if (client) return client;
  client = jwksClient({
    jwksUri: oasConfig.jwksUri,
    cache: true,
    cacheMaxAge: 3600_000, // 1h
    rateLimit: true,
  });
  return client;
}

function getSigningKey(header: JwtHeader): Promise<string> {
  // JWKS 模式：按 kid 从 OAS 端点获取公钥（带缓存）
  if (oasConfig.jwksUri) {
    return new Promise<string>((resolve, reject) => {
      getJwksClient().getSigningKey(header.kid, (err, key) => {
        if (err || !key) {
          reject(err ?? new Error('未能从 OAS JWKS 获取验签公钥'));
          return;
        }
        resolve(key.getPublicKey());
      });
    });
  }
  // PEM 模式：直接使用配置的公钥
  return Promise.resolve(oasConfig.publicKeyPem);
}

function pickClaim(payload: jwt.JwtPayload, claim: string): string {
  const value = payload[claim];
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return String(value[0] ?? '');
  return String(value);
}

/**
 * 验证 Bearer JWT 并映射为系统用户。
 * 验签失败/过期/claim 缺失均抛出 OasAuthError，由上层中间件转 401。
 */
export async function verifyOasToken(token: string): Promise<OasUser> {
  if (!oasConfig.jwksUri && !oasConfig.publicKeyPem) {
    throw new OasAuthError('auth_not_configured', 'OAS 认证未配置（缺少 OAS_JWKS_URI 或 OAS_PUBLIC_KEY_PEM）');
  }

  let payload: jwt.JwtPayload;
  try {
    const decoded = await new Promise<jwt.JwtPayload>((resolve, reject) => {
      jwt.verify(
        token,
        (header: JwtHeader, cb: SigningKeyCallback) => {
          getSigningKey(header)
            .then(publicKey => cb(null, publicKey))
            .catch(err => cb(err instanceof Error ? err : new Error(String(err))));
        },
        {
          algorithms: ['RS256'],
          ...(oasConfig.issuer ? { issuer: oasConfig.issuer } : {}),
          ...(oasConfig.audience ? { audience: oasConfig.audience } : {}),
        },
        (err, decodedToken) => {
          if (err) {
            reject(err);
            return;
          }
          if (typeof decodedToken === 'string' || decodedToken === undefined) {
            reject(new Error('token payload 无效'));
            return;
          }
          resolve(decodedToken);
        },
      );
    });
    payload = decoded;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new OasAuthError('token_verification_failed', `Token 验签失败: ${message}`);
  }

  const userId = pickClaim(payload, oasConfig.claimUserId);
  if (!userId) {
    throw new OasAuthError('token_invalid', `Token 缺少用户标识 claim: ${oasConfig.claimUserId}`);
  }

  return {
    userId,
    username: pickClaim(payload, oasConfig.claimUsername) || userId,
    displayName: pickClaim(payload, oasConfig.claimDisplayName) || userId,
    tenantId: pickClaim(payload, oasConfig.claimTenantId),
  };
}
