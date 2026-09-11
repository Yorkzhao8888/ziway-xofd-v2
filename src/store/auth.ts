// ABOUTME: 认证状态（Zustand）— 仅保存 OAS 颁发的 JWT 与验签后的用户信息，不自建账号体系
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { OasUser } from '../types';
import { setAuthHandlers } from '../lib/http';
import { fetchMe } from '../api/auth';

const TOKEN_STORAGE_KEY = 'xoFD.oas.token';

/** 从 URL hash 读取统一认证回跳携带的 token（生态网关回跳约定，待发单方最终确认） */
export function extractTokenFromHash(): string | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
  const params = new URLSearchParams(hash);
  const token = params.get('access_token') ?? params.get('token');
  if (token) {
    // 消费后清理 URL，避免 token 残留在地址栏
    params.delete('access_token');
    params.delete('token');
    const cleanHash = params.toString();
    window.history.replaceState(null, '', cleanHash ? `${window.location.pathname}#${cleanHash}` : window.location.pathname);
  }
  return token;
}

interface AuthState {
  token: string | null;
  user: OasUser | null;
  loading: boolean;
  error: string | null;
  /** 启动引导：取 hash token / localStorage token，向后端验签换用户信息 */
  bootstrap: () => Promise<void>;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      loading: false,
      error: null,

      bootstrap: async () => {
        const hashToken = extractTokenFromHash();
        const token = hashToken ?? (typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_STORAGE_KEY) : null);
        if (!token) {
          set({ token: null, user: null, loading: false });
          return;
        }
        if (hashToken) {
          localStorage.setItem(TOKEN_STORAGE_KEY, hashToken);
        }
        set({ token, loading: true, error: null });
        try {
          const user = await fetchMe();
          set({ user, loading: false });
        } catch (err) {
          console.error('[auth] bootstrap failed:', err);
          get().clearAuth();
          set({ loading: false, error: '登录态无效或已过期，请重新登录' });
        }
      },

      clearAuth: () => {
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem(TOKEN_STORAGE_KEY);
        }
        set({ token: null, user: null, error: null });
      },
    }),
    {
      name: 'xoFD-auth',
      storage: createJSONStorage(() => localStorage),
      // 仅持久化用户展示信息用于快速渲染；token 以独立 key 管理，不进 persist
      partialize: state => ({ user: state.user }),
    },
  ),
);

// 注册 axios 认证处理器（此处单向依赖，不构成循环）
setAuthHandlers({
  getToken: () => useAuthStore.getState().token,
  onUnauthorized: () => useAuthStore.getState().clearAuth(),
});
