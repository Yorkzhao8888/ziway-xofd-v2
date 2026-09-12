import { create } from 'zustand'
import { message } from 'antd'
import type { DU, HU, OrderDoc, OfdDoc, JobDoc, Msg, Role, MenuKey } from './types'
import { DEFAULT_ROLE_MENU } from './types'
import { api } from './services/api'
import { getToken, setToken } from './services/http'

/** 统一异步动作包装：失败时弹错误提示，避免未捕获 rejection（事件回调里 fire-and-forget） */
export function act<T>(p: Promise<T>, okMsg?: string): Promise<T | undefined> {
  return p
    .then((v) => { if (okMsg) message.success(okMsg); return v })
    .catch((e: any) => { message.error(e?.message || '操作失败'); return undefined })
}

/**
 * 全局状态（真实后端版）
 * - 数据由后端 SQLite 持久化，前端 store 仅作缓存
 * - 写动作：调后端 API → 成功后 refresh() 重拉全量（登录态/身份切换后）
 * - 读接口（currentHu/currentDu/huById/各列表）保持同步签名，页面零改动
 */

interface State {
  booted: boolean
  authed: boolean
  dus: DU[]
  hus: HU[]
  orders: OrderDoc[]
  ofds: OfdDoc[]
  jobs: JobDoc[]
  msgs: Msg[]
  roleMenuAccess: Record<Role, MenuKey[]>
  currentHuId: string

  // 生命周期 / 鉴权
  init: () => Promise<void>
  login: (huId: string, password: string) => Promise<void>
  quickLogin: (huId: string) => Promise<void>
  acceptOasToken: (token: string) => Promise<HU>
  logout: () => void
  refresh: () => Promise<void>
  switchHu: (id: string) => void

  // 读助手
  currentHu: () => HU
  currentDu: () => DU
  huById: (id: string | null | undefined) => HU | undefined
  duById: (id: string | null | undefined) => DU | undefined
  unread: () => number

  // 角色矩阵（前端本地配置，原型管理用）
  toggleRoleMenu: (role: Role, menu: MenuKey) => void
  setHuRole: (huId: string, role: Role) => void

  // 消息
  markRead: (id: string) => void
  markAllRead: () => void

  // 业务写动作（异步，调后端后刷新）
  createOrder: (input: any) => Promise<{ direct: boolean; order?: OrderDoc; job?: JobDoc }>
  acceptOrder: (orderId: string) => Promise<void>
  rejectOrder: (orderId: string, reason: string) => Promise<void>
  withdrawOrder: (orderId: string, reason: string) => Promise<void>
  createOfd: (orderId: string, input: any) => Promise<OfdDoc>
  createJob: (input: any) => Promise<JobDoc>
  acceptJob: (jobId: string, promiseDate?: string) => Promise<void>
  rejectJob: (jobId: string, reason: string) => Promise<void>
  claimJob: (jobId: string) => Promise<void>
  updateProgress: (jobId: string, progress: number, note: string) => Promise<void>
  blockJob: (jobId: string, reason: string) => Promise<void>
  unblockJob: (jobId: string) => Promise<void>
  submitDeliverable: (jobId: string, name: string, file: string) => Promise<void>
  checkDeliverable: (ofdId: string, delivId: string, result: 'pass' | 'fail', comment: string) => Promise<void>
  autoCloseIfDone: (ofdId: string) => Promise<void>
  terminateJob: (jobId: string, reason: string) => Promise<void>
  transferJob: (jobId: string, toHuId: string, reason: string) => Promise<void>
  autoAcceptIfDue: (ofdId: string) => Promise<void>
}

export const useStore = create<State>((set, get) => ({
  booted: false,
  authed: false,
  dus: [],
  hus: [],
  orders: [],
  ofds: [],
  jobs: [],
  msgs: [],
  roleMenuAccess: JSON.parse(JSON.stringify(DEFAULT_ROLE_MENU)),
  currentHuId: '',

  init: async () => {
    if (get().booted) return
    if (!getToken()) { set({ booted: true, authed: false }); return }
    try {
      await get().refresh()
      set({ authed: true })
    } catch {
      setToken(null)
      set({ authed: false })
    } finally {
      set({ booted: true })
    }
  },

  login: async (huId, password) => {
    const { token, hu } = await api.login(huId, password)
    setToken(token)
    set({ currentHuId: hu.id })
    await get().refresh()
    set({ authed: true })
  },

  quickLogin: async (huId) => {
    const { token, hu } = await api.quickLogin(huId)
    setToken(token)
    set({ currentHuId: hu.id })
    await get().refresh()
    set({ authed: true })
  },

  // OAS 模式：承接外部（统一身份登录回调 ?token= 或 EMBED 握手）下发的 OAS JWT
  // token 即 OAS RS256 凭证，直接存 localStorage，由后端验签并推导身份
  acceptOasToken: async (token: string) => {
    setToken(token)
    const me = await api.me()
    set({ currentHuId: me.id })
    await get().refresh()
    set({ authed: true })
    return me
  },

  logout: () => {
    setToken(null)
    set({ authed: false, currentHuId: '', orders: [], ofds: [], jobs: [], msgs: [], dus: [], hus: [] })
  },

  refresh: async () => {
    const data = await api.bootstrap()
    const msgs = await api.msgs().catch(() => [])
    set((s) => ({
      dus: data.dus,
      hus: data.hus,
      orders: data.orders,
      ofds: data.ofds,
      jobs: data.jobs as any,
      msgs,
      currentHuId: s.currentHuId || data.hus[0]?.id || '',
    }))
  },

  switchHu: (id) => set({ currentHuId: id }),

  currentHu: () => {
    const s = get()
    return s.hus.find((h) => h.id === s.currentHuId) ?? s.hus[0] ?? ({} as HU)
  },
  currentDu: () => {
    const s = get()
    const hu = s.currentHu()
    return s.dus.find((d) => d.id === hu?.duId) ?? ({} as DU)
  },
  huById: (id) => get().hus.find((h) => h.id === id),
  duById: (id) => (id ? get().dus.find((d) => d.id === id) : undefined),
  unread: () => get().msgs.filter((m) => m.toHuId === get().currentHuId && !m.read).length,

  toggleRoleMenu: (role, menu) =>
    set((s) => {
      if (menu === '/') return s
      const cur = s.roleMenuAccess[role]
      const next = cur.includes(menu) ? cur.filter((m) => m !== menu) : [...cur, menu]
      return { roleMenuAccess: { ...s.roleMenuAccess, [role]: next } }
    }),

  setHuRole: (huId, role) =>
    set((s) => ({ hus: s.hus.map((h) => (h.id === huId ? { ...h, role } : h)) })),

  markRead: (id) => {
    set((s) => ({ msgs: s.msgs.map((m) => (m.id === id ? { ...m, read: true } : m)) }))
    void api.markRead(id).catch(() => {})
  },
  markAllRead: () => {
    set((s) => ({ msgs: s.msgs.map((m) => (m.toHuId === s.currentHuId ? { ...m, read: true } : m)) }))
    void api.markAllRead().catch(() => {})
  },

  // ---------------- 业务写动作：调后端 → 刷新 ----------------
  createOrder: async (input) => {
    const r = await api.createOrder(input)
    await get().refresh()
    return r
  },
  acceptOrder: async (orderId) => { await api.acceptOrder(orderId); await get().refresh() },
  rejectOrder: async (orderId, reason) => { await api.rejectOrder(orderId, reason); await get().refresh() },
  withdrawOrder: async (orderId, reason) => { await api.withdrawOrder(orderId, reason); await get().refresh() },

  createOfd: async (orderId, input) => {
    const ofd = await api.createOfd(orderId, input)
    await get().refresh()
    return ofd
  },
  createJob: async (input) => {
    const job = await api.createJob(input)
    await get().refresh()
    return job
  },
  acceptJob: async (jobId, promiseDate) => { await api.acceptJob(jobId, promiseDate); await get().refresh() },
  rejectJob: async (jobId, reason) => { await api.rejectJob(jobId, reason); await get().refresh() },
  claimJob: async (jobId) => { await api.claimJob(jobId); await get().refresh() },
  updateProgress: async (jobId, progress, note) => { await api.updateProgress(jobId, progress, note); await get().refresh() },
  blockJob: async (jobId, reason) => { await api.blockJob(jobId, reason); await get().refresh() },
  unblockJob: async (jobId) => { await api.unblockJob(jobId); await get().refresh() },
  submitDeliverable: async (jobId, name, file) => { await api.submitDeliverable(jobId, name, file); await get().refresh() },
  checkDeliverable: async (ofdId, delivId, result, comment) => {
    await api.checkDeliverable(ofdId, delivId, result, comment); await get().refresh()
  },
  autoCloseIfDone: async (_ofdId) => { await get().refresh() },
  terminateJob: async (jobId, reason) => { await api.terminateJob(jobId, reason); await get().refresh() },
  transferJob: async (jobId, toHuId, reason) => { await api.transferJob(jobId, toHuId, reason); await get().refresh() },
  autoAcceptIfDue: async (ofdId) => { await api.autoAcceptIfDue(ofdId); await get().refresh() },
}))
