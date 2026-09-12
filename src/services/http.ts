/**
 * HTTP 客户端（真实后端）
 * - token 存 localStorage，请求带 Authorization: Bearer
 * - 统一解包 { code, data, message }；code !== 0 抛错
 */

export const API_BASE = '/api'
const TOKEN_KEY = 'ofd_token'

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
}
export function setToken(t: string | null) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t)
    else localStorage.removeItem(TOKEN_KEY)
  } catch { /* ignore */ }
}

export class ApiError extends Error {
  code: number
  constructor(message: string, code: number) { super(message); this.code = code }
}

interface RequestOpts {
  method?: 'GET' | 'POST'
  body?: any
  auth?: boolean   // 默认 true 带 token
}

export async function request<T = any>(path: string, opts: RequestOpts = {}): Promise<T> {
  const { method = 'GET', body, auth = true } = opts
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (auth) {
    const t = getToken()
    if (t) headers['Authorization'] = `Bearer ${t}`
  }
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch (e) {
    throw new ApiError('网络异常，无法连接服务', -1)
  }
  let json: any = null
  try { json = await res.json() } catch { /* non-json */ }
  if (!res.ok || !json || (json.code !== undefined && json.code !== 0)) {
    const msg = json?.message || `请求失败（${res.status}）`
    if (res.status === 401) setToken(null)
    throw new ApiError(msg, json?.code ?? res.status)
  }
  return json.data as T
}

/** 统一响应包装（契约） */
export interface ApiResult<T> {
  code: 0 | number
  data: T
  message?: string
}
