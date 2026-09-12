/**
 * API 层单点接缝 —— 真实后端版本
 *
 * 所有方法走 HTTP（/api/*），token 由 http 客户端自动注入。
 * 写方法返回后端最新对象；store 调用后会重拉 bootstrap 刷新本地缓存。
 *
 * 约定：
 * 1. 页面只 import { api } from './services/api'（或 useStore 的写动作，内部转调 api）
 * 2. 归属字段 vcaseId/caseId 只透传不构造 —— 由后端根据登录身份回填
 */

import { request } from './http'
import type {
  DU, HU, OrderDoc, OfdDoc, JobDoc, Msg,
} from '../types'

export const API_BASE = '/api'
export interface ApiResult<T> { code: 0 | number; data: T; message?: string }

export interface BootstrapData {
  dus: DU[]
  hus: HU[]
  orders: OrderDoc[]
  ofds: OfdDoc[]
  jobs: JobDoc[]
  msgs: Msg[]
}

export interface QuickLoginHu extends HU { duName: string }

export interface AuthMode {
  mode: 'on' | 'off'        // on=OAS 统一身份；off=本地内测登录
  configured: boolean
  keySource: 'pem' | 'jwks' | 'none'
  baseUrl: string
  warning?: string
}

export const api = {
  // ---------------- 鉴权 ----------------
  authMode: () => request<AuthMode>('/auth/mode', { auth: false }),

  login: (huId: string, password: string) =>
    request<{ token: string; hu: HU }>('/auth/login', { method: 'POST', body: { huId, password }, auth: false }),

  // test123 测试账号直进（NORM-LOGIN），或按 huId 选演示身份
  quickLogin: (huId: string) =>
    request<{ token: string; hu: HU }>('/auth/quick-login', { method: 'POST', body: { huId }, auth: false }),
  quickLoginTest: () =>
    request<{ token: string; hu: HU }>('/auth/quick-login', { method: 'POST', body: { account: 'test123' }, auth: false }),

  quickLogins: () =>
    request<QuickLoginHu[]>('/auth/quick-logins', { auth: false }),

  me: () => request<HU>('/auth/me'),

  bootstrap: () => request<BootstrapData>('/bootstrap'),

  // ---------------- 主数据 / 消息 ----------------
  dus: () => request<DU[]>('/dus'),
  hus: () => request<HU[]>('/hus'),
  msgs: () => request<Msg[]>('/msgs'),
  markRead: (id: string) => request<boolean>(`/msgs/${id}/read`, { method: 'POST' }),
  markAllRead: () => request<boolean>('/msgs/read-all', { method: 'POST' }),

  // ---------------- O 需求单 ----------------
  createOrder: (input: {
    title: string; desc: string; targetDuId?: string | null; targetHuId?: string | null
    expectDate: string; attachments?: string[]; direct?: boolean
    dispatchDuId?: string | null; dispatchHuId?: string | null; promiseDate?: string; dueHours?: number
  }) =>
    request<{ direct: boolean; order?: OrderDoc; job?: JobDoc }>('/orders', { method: 'POST', body: input }),

  acceptOrder: (orderId: string) =>
    request<OrderDoc>(`/orders/${orderId}/accept`, { method: 'POST' }),

  rejectOrder: (orderId: string, reason: string) =>
    request<OrderDoc>(`/orders/${orderId}/reject`, { method: 'POST', body: { reason } }),

  withdrawOrder: (orderId: string, reason: string) =>
    request<OrderDoc>(`/orders/${orderId}/withdraw`, { method: 'POST', body: { reason } }),

  // ---------------- F 履约单 ----------------
  createOfd: (orderId: string, input: { title: string; deliverables: { name: string; standard: string }[]; promiseDate: string }) =>
    request<OfdDoc>('/ofds', { method: 'POST', body: { orderId, ...input } }),

  getOfd: (ofdId: string) => request<OfdDoc>(`/ofds/${ofdId}`),

  checkDeliverable: (ofdId: string, delivId: string, result: 'pass' | 'fail', comment: string) =>
    request<OfdDoc>(`/ofds/${ofdId}/deliverables/${delivId}/check`, { method: 'POST', body: { result, comment } }),

  // ---------------- J 工单 ----------------
  createJob: (input: {
    ofdId?: string | null; orderId?: string | null; title: string; desc: string
    dispatchDuId?: string | null; dispatchHuId?: string | null; promiseDate: string; dueHours: number
  }) =>
    request<JobDoc>('/jobs', { method: 'POST', body: input }),

  acceptJob: (jobId: string, promiseDate?: string) =>
    request<JobDoc>(`/jobs/${jobId}/accept`, { method: 'POST', body: { promiseDate } }),

  rejectJob: (jobId: string, reason: string) =>
    request<JobDoc>(`/jobs/${jobId}/reject`, { method: 'POST', body: { reason } }),

  claimJob: (jobId: string) =>
    request<JobDoc>(`/jobs/${jobId}/claim`, { method: 'POST' }),

  updateProgress: (jobId: string, progress: number, note: string) =>
    request<JobDoc>(`/jobs/${jobId}/progress`, { method: 'POST', body: { progress, note } }),

  blockJob: (jobId: string, reason: string) =>
    request<JobDoc>(`/jobs/${jobId}/block`, { method: 'POST', body: { reason } }),

  unblockJob: (jobId: string) =>
    request<JobDoc>(`/jobs/${jobId}/unblock`, { method: 'POST' }),

  submitDeliverable: (jobId: string, name: string, file: string) =>
    request<JobDoc>(`/jobs/${jobId}/deliverables`, { method: 'POST', body: { name, file } }),

  terminateJob: (jobId: string, reason: string) =>
    request<JobDoc>(`/jobs/${jobId}/terminate`, { method: 'POST', body: { reason } }),

  transferJob: (jobId: string, toHuId: string, reason: string) =>
    request<JobDoc>(`/jobs/${jobId}/transfer`, { method: 'POST', body: { toHuId, reason } }),

  /** GET /api/ofds/:id 触发后端 48h 自动验收判定（返回最新履约单） */
  autoAcceptIfDue: (ofdId: string) => request<OfdDoc>(`/ofds/${ofdId}`),
}

export type Api = typeof api
