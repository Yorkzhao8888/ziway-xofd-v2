// ABOUTME: axios 实例 — 同源 API、Bearer token 注入、401 统一处理
// token 与 401 回调通过 provider 注册，避免 http → store → api → http 循环依赖
import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import type { ApiErrorBody } from '../types';

interface AuthHandlers {
  getToken: () => string | null;
  onUnauthorized: () => void;
}

let authHandlers: AuthHandlers | null = null;

export function setAuthHandlers(handlers: AuthHandlers): void {
  authHandlers = handlers;
}

export const http = axios.create({
  baseURL: '/api',
  timeout: 15000,
});

http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = authHandlers?.getToken();
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  return config;
});

http.interceptors.response.use(
  response => response,
  (error: AxiosError<ApiErrorBody>) => {
    if (error.response?.status === 401) {
      authHandlers?.onUnauthorized();
    }
    return Promise.reject(error);
  },
);

/** 从 AxiosError 中提取后端错误消息 */
export function extractErrorMessage(err: unknown, fallback = '请求失败'): string {
  if (axios.isAxiosError(err)) {
    const body = err.response?.data as ApiErrorBody | undefined;
    return body?.message || err.message || fallback;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}
