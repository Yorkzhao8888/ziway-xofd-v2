/** 数据字典与状态机常量 —— 对齐 PRD_OFD履约系统_MVP v0.3
 *  归属接口预留：vcaseId / caseId 可空字段，UI 不出现「VCASE/XCASE」字样
 */

/** 六类 DU（归属层，不登录） */
export type DUType = 'H' | 'C' | 'E' | 'D' | 'T' | 'Y'

export interface DU {
  id: string            // 如 HDU01
  type: DUType
  name: string
  vcaseId: string | null  // 🔴 归属接口预留（VCASE），MVP 恒为 null，不渲染
}

export const DU_TYPE_META: Record<DUType, { label: string; color: string }> = {
  H: { label: '人力', color: 'purple' },
  C: { label: '客户', color: 'blue' },
  E: { label: '供给', color: 'green' },
  D: { label: '履约', color: 'orange' },
  T: { label: '技术', color: 'geekblue' },
  Y: { label: '智场', color: 'cyan' },
}

/** HU（操作层，登录） */
export interface HU {
  id: string
  name: string
  duId: string
  title: string
  role: Role             // 平台角色 → 决定左侧导航可见范围（用户管理·角色管理矩阵可配）
}

/** 平台角色（6 个，PRD M1-4）：页面可见性 = 角色权限矩阵（用户管理可配）+「归属 DU + 单据关系」动态判定（各业务页内部） */
export type Role = 'requester' | 'assignee' | 'duAdmin' | 'operator' | 'observer' | 'sysAdmin'
export const ROLE_META: Record<Role, string> = {
  requester: '发单员',
  assignee: '接单员',
  duAdmin: 'DU管理员',
  operator: '平台运营',
  observer: '观察者',
  sysAdmin: '系统管理员',
}

/** 左侧页面/菜单清单（权限矩阵的列，与导航一一对应） */
export type MenuKey = '/' | '/todo' | '/orders' | '/ofds' | '/jobs' | '/msgs' | '/master'

export const MENU_META: Record<MenuKey, { name: string; desc: string }> = {
  '/': { name: '工作台', desc: '经营概览看板' },
  '/todo': { name: '我的待办', desc: '名下单据的待处理事项' },
  '/orders': { name: '需求单', desc: '发单 / 受理 / 转履约' },
  '/ofds': { name: '履约单', desc: '方案编制 / 派工 / 验收' },
  '/jobs': { name: '工单', desc: '接单 / 执行 / 交物' },
  '/msgs': { name: '消息中心', desc: '站内通知' },
  '/master': { name: '用户管理', desc: '用户清单与角色权限配置' },
}

/** 角色 → 默认可见页面（用户管理·角色管理矩阵的初始值；工作台对所有角色常显）
 *  说明：矩阵只管「左侧导航可见性」；单据页内的操作权仍由「归属 DU + 单据关系」动态判定（PRD 原口径）。
 *  requester 含 /jobs：直发（通路 B）的单据落在工单列表，必须给跟踪入口。 */
export const DEFAULT_ROLE_MENU: Record<Role, MenuKey[]> = {
  requester: ['/', '/todo', '/orders', '/jobs', '/msgs'],
  assignee: ['/', '/todo', '/jobs', '/msgs'],
  duAdmin: ['/', '/todo', '/orders', '/ofds', '/jobs', '/msgs', '/master'],
  operator: ['/', '/todo', '/orders', '/ofds', '/jobs', '/msgs', '/master'],
  observer: ['/', '/orders', '/ofds', '/jobs'],
  sysAdmin: ['/', '/todo', '/orders', '/ofds', '/jobs', '/msgs', '/master'],
}

/** 角色职责一句话说明（用户管理展示用） */
export const ROLE_DESC: Record<Role, string> = {
  requester: '发起需求单、撤回自己的单',
  assignee: '接单执行，交物与更新进度',
  duAdmin: '受理、编方案、派工与验收，管本 DU',
  operator: '平台层：跨 DU 协调与督办',
  observer: '只读旁观全部单据，无操作权限',
  sysAdmin: '用户、角色与页面权限配置',
}

/** 三单状态机 */
export type OrderStatus = 'submitted' | 'accepted' | 'converted' | 'rejected' | 'withdrawn' | 'closed'
export type OfdStatus = 'pending' | 'dispatched' | 'inProgress' | 'awaitAccept' | 'closed' | 'revoked'
export type JobStatus =
  | 'waitAccept' | 'accepted' | 'working' | 'blocked' | 'done'
  | 'rework' | 'waitCheck' | 'closed' | 'rejected' | 'transferred' | 'terminated'

export const ORDER_STATUS: Record<OrderStatus, { label: string; color: string }> = {
  submitted: { label: '已提交', color: 'blue' },
  accepted: { label: '已受理', color: 'cyan' },
  converted: { label: '已转履约', color: 'green' },
  rejected: { label: '已驳回', color: 'red' },
  withdrawn: { label: '已撤回', color: 'default' },
  closed: { label: '已关闭', color: 'default' },
}

export const OFD_STATUS: Record<OfdStatus, { label: string; color: string }> = {
  pending: { label: '待派单', color: 'orange' },
  dispatched: { label: '已派单', color: 'blue' },
  inProgress: { label: '履约中', color: 'processing' },
  awaitAccept: { label: '待验收', color: 'purple' },
  closed: { label: '已关闭', color: 'default' },
  revoked: { label: '已撤销', color: 'red' },
}

export const JOB_STATUS: Record<JobStatus, { label: string; color: string }> = {
  waitAccept: { label: '待接单', color: 'orange' },
  accepted: { label: '已接单', color: 'blue' },
  working: { label: '执行中', color: 'processing' },
  blocked: { label: '受阻中', color: 'volcano' },
  done: { label: '已完工', color: 'purple' },
  rework: { label: '返工中', color: 'volcano' },
  waitCheck: { label: '待验收', color: 'purple' },
  closed: { label: '已关闭', color: 'success' },
  rejected: { label: '已拒单', color: 'red' },
  transferred: { label: '已转派', color: 'default' },
  terminated: { label: '已中止', color: 'default' },
}

/** 单据公共字段（三单共享的轨迹与审计） */
export interface TraceItem {
  time: string
  actor: string       // HU 名
  action: string
  detail?: string
}

/** ORDER 需求单 */
export interface OrderDoc {
  id: string                 // O-202609-0001
  title: string
  desc: string
  requesterHuId: string
  requesterDuId: string      // = 发单人 HU 主DU
  targetDuId: string | null  // 派给 DU（与 targetHuId 二选一）
  targetHuId: string | null  // 直接指定到人
  expectDate: string         // 期望完成时间
  status: OrderStatus
  attachments: string[]
  vcaseId: string | null     // 🔴 归属接口预留，恒 null，UI 不出现
  createdAt: string
  trace: TraceItem[]
  ofdId?: string
}

/** OFD 履约单 */
export interface Deliverable {
  id: string
  name: string
  standard: string     // 验收标准
  result?: 'pass' | 'fail'   // 逐项验收结果
  comment?: string
}

export interface OfdDoc {
  id: string                 // F-202609-0001
  orderId: string
  title: string
  deliverables: Deliverable[]
  promiseDate: string        // 承诺完成时间（接单方可反填协商）
  promiseOriginal?: string   // 原承诺，留痕
  ownerDuId: string          // 履约编制方（需求侧 DU管理员/发单人）
  status: OfdStatus
  caseId: string | null      // 🔴 归属接口预留（XCASE），恒 null，UI 不出现
  createdAt: string
  trace: TraceItem[]
  awaitSince?: string        // 转入「待验收」的时刻（48h 自动验收计时起点）
}

/** JOB 工单 */
export interface JobDoc {
  id: string                 // J-202609-0001
  ofdId: string | null       // 直发时为 null（通路 B）
  orderId: string | null     // 直发时为 null
  title: string
  desc: string
  isDirect: boolean          // 直发（通路 B）
  dispatchDuId: string | null   // 派给 DU
  dispatchHuId: string | null   // 或指定 HU
  assigneeHuId: string | null   // 接单后锁定的责任人
  promiseDate: string
  promiseOriginal?: string      // 接单反填承诺时间时的原值留痕（M4：反填协商，原值留痕）
  status: JobStatus
  progress: number           // 0-100
  reworkCount: number
  blockedReason?: string
  deliverables: { name: string; file: string; at: string }[]
  dueHours: number           // 承诺工时（用于超时演示）
  createdAt: string
  vcaseId: string | null     // 🔴 归属接口预留（供给侧 VCASE），恒 null
  trace: TraceItem[]
}

/** 站内消息 */
export interface Msg {
  id: string
  toHuId: string
  title: string
  detail: string
  at: string
  read: boolean
  link: string               // 点击直达单据
}
