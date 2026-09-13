// ============================================================
// server/db.ts — SQLite 数据层（better-sqlite3）
// 数据契约对齐 src/types.ts；deliverables / trace / attachments 以 JSON 列内嵌。
// 单号 O/F/J-YYYYMM-NNNN 由服务端按月序列生成。
// ============================================================
import Database from 'better-sqlite3'
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs'
import path from 'path'
import bcrypt from 'bcryptjs'

// ---- SQLite 文件路径（优先持久化目录 /app/data；不可写时回退 /tmp；开发环境用项目 data/）----
function dbFilePath(): string {
  const env = process.env.COZE_PROJECT_ENV
  const candidates =
    env === 'PROD'
      ? ['/app/data', '/tmp']
      : [path.join(process.cwd(), 'data'), '/app/data', '/tmp']
  for (const dir of candidates) {
    try {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      const p = path.join(dir, 'ofd.db')
      // 可写性探测
      const probe = path.join(dir, '.ofd-write-test')
      writeFileSync(probe, '1'); unlinkSync(probe)
      return p
    } catch { /* 尝试下一个候选 */ }
  }
  return path.join('/tmp', 'ofd.db')
}

export const db = new Database(dbFilePath())
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// ---------------- 建表 ----------------
db.exec(`
CREATE TABLE IF NOT EXISTS dus (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  vcaseId TEXT
);

CREATE TABLE IF NOT EXISTS hus (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  duId TEXT NOT NULL,
  title TEXT,
  role TEXT NOT NULL,
  passHash TEXT NOT NULL,
  oas_identity_id TEXT
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  desc TEXT,
  requesterHuId TEXT NOT NULL,
  requesterDuId TEXT NOT NULL,
  targetDuId TEXT,
  targetHuId TEXT,
  expectDate TEXT,
  status TEXT NOT NULL,
  attachments TEXT,        -- JSON string[]
  vcaseId TEXT,
  ofdId TEXT,
  createdAt TEXT NOT NULL,
  trace TEXT               -- JSON TraceItem[]
);

CREATE TABLE IF NOT EXISTS ofds (
  id TEXT PRIMARY KEY,
  orderId TEXT,
  title TEXT NOT NULL,
  deliverables TEXT,       -- JSON Deliverable[]（验收项）
  promiseDate TEXT,
  promiseOriginal TEXT,
  ownerDuId TEXT NOT NULL,
  status TEXT NOT NULL,
  caseId TEXT,
  createdAt TEXT NOT NULL,
  awaitSince TEXT,
  trace TEXT
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  ofdId TEXT,
  orderId TEXT,
  title TEXT NOT NULL,
  desc TEXT,
  isDirect INTEGER NOT NULL DEFAULT 0,
  dispatchDuId TEXT,
  dispatchHuId TEXT,
  assigneeHuId TEXT,
  promiseDate TEXT,
  status TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  reworkCount INTEGER NOT NULL DEFAULT 0,
  blockedReason TEXT,
  deliverables TEXT,       -- JSON 交物 {name,file,at}[]
  dueHours INTEGER,
  vcaseId TEXT,
  createdAt TEXT NOT NULL,
  trace TEXT
);

CREATE TABLE IF NOT EXISTS msgs (
  id TEXT PRIMARY KEY,
  toHuId TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  at TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  link TEXT
);

-- 单号月序列：prefix(O/F/J/M) + yyyymm -> seq
CREATE TABLE IF NOT EXISTS id_seq (
  key TEXT PRIMARY KEY,
  seq INTEGER NOT NULL
);
`)

// ---------------- 轻量迁移：旧库补列（hus.oas_identity_id，OAS 身份外键预留）----------------
function ensureColumn(table: string, column: string, ddl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`)
  }
}
ensureColumn('hus', 'oas_identity_id', 'TEXT')
db.exec('CREATE INDEX IF NOT EXISTS idx_hus_oas_identity ON hus(oas_identity_id)')

// ---------------- 事件出站（outbox）：为二期结算/跨窗投递预留 at-least-once 通道 ----------------
// demean：本表仅承载「已发生业务事件」的持久待投递记录，不参与业务状态机。
db.exec(`
CREATE TABLE IF NOT EXISTS outbox_events (
  event_id TEXT PRIMARY KEY,          -- 幂等键：全局唯一（含请求 Idempotency-Key 派生链）
  type TEXT NOT NULL,                 -- order.created / ofd.handled / job.accepted / receipt.issued ...
  subject_hu_id TEXT NOT NULL,        -- 主体（凭证归属 HU）
  aggregate_type TEXT,                -- order|ofd|job
  aggregate_id TEXT,                  -- 对应单号 O-.../F-.../J-...
  payload TEXT,                       -- JSON 事件载荷（含三号凭证链快照）
  status TEXT NOT NULL DEFAULT 'pending',  -- pending|delivered|failed
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  delivered_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_outbox_subject ON outbox_events(subject_hu_id, status);
CREATE INDEX IF NOT EXISTS idx_outbox_agg ON outbox_events(aggregate_type, aggregate_id);
`)

/** outbox 幂等入队：event_id 已存在则忽略（at-least-once 语义），否则落 pending。 */
export function enqueueOutbox(e: {
  eventId: string; type: string; subjectHuId: string
  aggregateType?: string; aggregateId?: string; payload: unknown
}): { enqueued: boolean } {
  const exists = db.prepare('SELECT 1 FROM outbox_events WHERE event_id=?').get(e.eventId)
  if (exists) return { enqueued: false }
  db.prepare(`INSERT INTO outbox_events (event_id,type,subject_hu_id,aggregate_type,aggregate_id,payload,status,created_at)
    VALUES (@eventId,@type,@subjectHuId,@aggregateType,@aggregateId,@payload,'pending',@createdAt)`).run({
    eventId: e.eventId, type: e.type, subjectHuId: e.subjectHuId,
    aggregateType: e.aggregateType ?? null, aggregateId: e.aggregateId ?? null,
    payload: JSON.stringify(e.payload), createdAt: new Date().toISOString(),
  })
  return { enqueued: true }
}

/** 出站投递扫描（供后台/定时触发，at-least-once：标记 delivered 但允许重发同一 event_id 由下游幂等去重）。 */
export function selectPendingOutbox(limit = 50): Array<{
  eventId: string; type: string; subjectHuId: string; payload: string; createdAt: string
}> {
  return db.prepare(`SELECT event_id AS eventId,type,subject_hu_id AS subjectHuId,payload,created_at AS createdAt
    FROM outbox_events WHERE status='pending' ORDER BY created_at LIMIT ?`).all(limit) as any[]
}
export function markOutbox(status: 'delivered' | 'failed', eventId: string) {
  const at = new Date().toISOString()
  db.prepare(`UPDATE outbox_events SET status=?, attempts=attempts+1, delivered_at=? WHERE event_id=?`).run(status, status === 'delivered' ? at : null, eventId)
}

// ---------------- 凭证链台账查询（按主体查名下 O/F/J 三号+状态，供二期结算取数）----------------
export interface CredentialVoucher {
  subjectHuId: string
  orderId: string | null; orderStatus: string | null; orderAt: string | null
  ofdId: string | null; ofdStatus: string | null; ofdAt: string | null
  jobId: string | null; jobStatus: string | null; jobAt: string | null
  chainClosed: boolean
}
/**
 * 凭证查询：以 order 为主链起点，左连 ofd/job 展开三号凭证链。
 * orderId 缺失时可按 F→J 反查（直发工单链），故支持按 ofdId/jobId 反推。
 */
export function credentialLedgerOf(subjectHuId: string): CredentialVoucher[] {
  const rows = db.prepare(`
    SELECT o.id AS oid,o.status AS ost,o.createdAt AS oat,
           f.id AS fid,f.status AS fst,f.createdAt AS fat,
           j.id AS jid,j.status AS jst,j.createdAt AS jat
    FROM orders o
    LEFT JOIN ofds f ON f.orderId=o.id
    LEFT JOIN jobs j ON j.ofdId=f.id OR j.orderId=o.id
    WHERE o.requesterHuId=? OR o.targetHuId=? OR j.assigneeHuId=?
    ORDER BY o.createdAt DESC
  `).all(subjectHuId, subjectHuId, subjectHuId) as Array<{
    oid: string | null; ost: string | null; oat: string | null
    fid: string | null; fst: string | null; fat: string | null
    jid: string | null; jst: string | null; jat: string | null
  }>
  return rows.map((r) => ({
    subjectHuId,
    orderId: r.oid, orderStatus: r.ost, orderAt: r.oat,
    ofdId: r.fid, ofdStatus: r.fst, ofdAt: r.fat,
    jobId: r.jid, jobStatus: r.jst, jobAt: r.jat,
    chainClosed: !!(r.ost === 'closed' && r.fid && r.fst === 'closed' && r.jid && r.jst === 'closed'),
  }))
}

// ---------------- 行映射（JSON 列解析）----------------
function parse<T>(s: string | null | undefined, fallback: T): T {
  if (s == null) return fallback
  try { return JSON.parse(s) as T } catch { return fallback }
}

export type OrderRow = {
  id: string; title: string; desc: string | null
  requesterHuId: string; requesterDuId: string
  targetDuId: string | null; targetHuId: string | null
  expectDate: string | null; status: string
  attachments: string | null; vcaseId: string | null; ofdId: string | null
  createdAt: string; trace: string | null
}
export type OfdRow = {
  id: string; orderId: string | null; title: string; deliverables: string | null
  promiseDate: string | null; promiseOriginal: string | null; ownerDuId: string
  status: string; caseId: string | null; createdAt: string; awaitSince: string | null; trace: string | null
}
export type JobRow = {
  id: string; ofdId: string | null; orderId: string | null; title: string; desc: string | null
  isDirect: number; dispatchDuId: string | null; dispatchHuId: string | null; assigneeHuId: string | null
  promiseDate: string | null; status: string; progress: number; reworkCount: number
  blockedReason: string | null; deliverables: string | null; dueHours: number | null
  vcaseId: string | null; createdAt: string; trace: string | null
}

export interface OrderDoc extends Omit<OrderRow, 'attachments' | 'trace'> {
  attachments: string[]; trace: TraceItem[]
}
export interface OfdDoc extends Omit<OfdRow, 'deliverables' | 'trace'> {
  deliverables: Deliverable[]; trace: TraceItem[]
}
export interface JobDoc extends Omit<JobRow, 'isDirect' | 'deliverables' | 'trace'> {
  isDirect: boolean; deliverables: JobDeliverable[]; trace: TraceItem[]; promiseOriginal?: string
}
export interface Deliverable { id: string; name: string; standard: string; result?: 'pass' | 'fail'; comment?: string }
export interface JobDeliverable { name: string; file?: string; at: string }
export interface TraceItem { time: string; actor: string; action: string; detail?: string }
export interface Msg { id: string; toHuId: string; title: string; detail?: string; at: string; read: boolean; link?: string }
export interface DU { id: string; type: string; name: string; vcaseId: string | null }
export interface HU { id: string; name: string; duId: string; title?: string; role: string; passHash?: string; oasIdentityId?: string | null }

export function orderFromRow(r: OrderRow): OrderDoc {
  return { ...r, attachments: parse<string[]>(r.attachments, []), trace: parse<TraceItem[]>(r.trace, []) }
}
export function ofdFromRow(r: OfdRow): OfdDoc {
  return { ...r, deliverables: parse<Deliverable[]>(r.deliverables, []), trace: parse<TraceItem[]>(r.trace, []) }
}
export function jobFromRow(r: JobRow): JobDoc {
  return { ...r, isDirect: !!r.isDirect, deliverables: parse<JobDeliverable[]>(r.deliverables, []), trace: parse<TraceItem[]>(r.trace, []) }
}
export function msgFromRow(r: any): Msg {
  return { id: r.id, toHuId: r.toHuId, title: r.title, detail: r.detail ?? undefined, at: r.at, read: !!r.read, link: r.link ?? undefined }
}

// ---------------- 查询助手 ----------------
export const queries = {
  dus: (): DU[] => db.prepare('SELECT * FROM dus ORDER BY id').all() as DU[],
  hus: (): HU[] => (db.prepare('SELECT id,name,duId,title,role,oas_identity_id AS oasIdentityId FROM hus ORDER BY id').all() as HU[]),
  huById: (id: string): HU | undefined => (db.prepare('SELECT id,name,duId,title,role,oas_identity_id AS oasIdentityId FROM hus WHERE id=?').get(id) as HU | undefined),
  huByOasIdentity: (identityId: string): HU | undefined =>
    (db.prepare('SELECT id,name,duId,title,role,oas_identity_id AS oasIdentityId FROM hus WHERE oas_identity_id=?').get(identityId) as HU | undefined),
  // OAS 缓存层：按 OAS identity 落本地 HU（首次见自动建缓存行，便于 OAS 短时不可达时降级）
  upsertOasHu: (h: { id: string; name: string; duId?: string; title: string; role: string; oasIdentityId: string }) => {
    db.prepare(`INSERT INTO hus (id,name,duId,title,role,passHash,oas_identity_id)
      VALUES (@id,@name,COALESCE(@duId,''),@title,@role,'',@oasIdentityId)
      ON CONFLICT(id) DO UPDATE SET name=@name,duId=COALESCE(@duId,''),title=@title,role=@role,oas_identity_id=@oasIdentityId`).run(h)
  },
  huLogin: (id: string): (HU & { passHash: string }) | undefined =>
    db.prepare('SELECT * FROM hus WHERE id=?').get(id) as any,
  duById: (id: string): DU | undefined => db.prepare('SELECT * FROM dus WHERE id=?').get(id) as DU | undefined,

  orderById: (id: string): OrderDoc | undefined => {
    const r = db.prepare('SELECT * FROM orders WHERE id=?').get(id) as OrderRow | undefined
    return r ? orderFromRow(r) : undefined
  },
  allOrders: (): OrderDoc[] => (db.prepare('SELECT * FROM orders ORDER BY createdAt DESC').all() as OrderRow[]).map(orderFromRow),

  ofdById: (id: string): OfdDoc | undefined => {
    const r = db.prepare('SELECT * FROM ofds WHERE id=?').get(id) as OfdRow | undefined
    return r ? ofdFromRow(r) : undefined
  },
  allOfds: (): OfdDoc[] => (db.prepare('SELECT * FROM ofds ORDER BY createdAt DESC').all() as OfdRow[]).map(ofdFromRow),

  jobById: (id: string): JobDoc | undefined => {
    const r = db.prepare('SELECT * FROM jobs WHERE id=?').get(id) as JobRow | undefined
    return r ? jobFromRow(r) : undefined
  },
  allJobs: (): JobDoc[] => (db.prepare('SELECT * FROM jobs ORDER BY createdAt DESC').all() as JobRow[]).map(jobFromRow),
  jobsByOfd: (ofdId: string): JobDoc[] =>
    (db.prepare('SELECT * FROM jobs WHERE ofdId=? ORDER BY createdAt').all(ofdId) as JobRow[]).map(jobFromRow),

  msgsFor: (huId: string): Msg[] =>
    (db.prepare('SELECT * FROM msgs WHERE toHuId=? ORDER BY at DESC').all(huId) as any[]).map(msgFromRow),
  // ===== OFD-LINK-03：outbox + 凭证台账（G5 / 凭证链）=====
  enqueueOutbox,
  selectPendingOutbox,
  markOutbox,
  credentialLedgerOf: (subjectHuId: string) => credentialLedgerOf(subjectHuId),
}

// ---------------- 写入助手 ----------------
export function saveOrder(o: OrderDoc) {
  db.prepare(`INSERT INTO orders (id,title,desc,requesterHuId,requesterDuId,targetDuId,targetHuId,expectDate,status,attachments,vcaseId,ofdId,createdAt,trace)
    VALUES (@id,@title,@desc,@requesterHuId,@requesterDuId,@targetDuId,@targetHuId,@expectDate,@status,@attachments,@vcaseId,@ofdId,@createdAt,@trace)
    ON CONFLICT(id) DO UPDATE SET title=@title,desc=@desc,status=@status,attachments=@attachments,ofdId=@ofdId,trace=@trace,targetDuId=@targetDuId,targetHuId=@targetHuId,expectDate=@expectDate`).run({
    ...o, desc: o.desc ?? null, targetDuId: o.targetDuId ?? null, targetHuId: o.targetHuId ?? null,
    expectDate: o.expectDate ?? null, attachments: JSON.stringify(o.attachments ?? []),
    vcaseId: o.vcaseId ?? null, ofdId: o.ofdId ?? null, trace: JSON.stringify(o.trace ?? []),
  } as any)
}
export function saveOfd(f: OfdDoc) {
  db.prepare(`INSERT INTO ofds (id,orderId,title,deliverables,promiseDate,promiseOriginal,ownerDuId,status,caseId,createdAt,awaitSince,trace)
    VALUES (@id,@orderId,@title,@deliverables,@promiseDate,@promiseOriginal,@ownerDuId,@status,@caseId,@createdAt,@awaitSince,@trace)
    ON CONFLICT(id) DO UPDATE SET title=@title,deliverables=@deliverables,promiseDate=@promiseDate,promiseOriginal=@promiseOriginal,status=@status,awaitSince=@awaitSince,trace=@trace`).run({
    ...f, orderId: f.orderId ?? null, deliverables: JSON.stringify(f.deliverables ?? []),
    promiseDate: f.promiseDate ?? null, promiseOriginal: f.promiseOriginal ?? null,
    caseId: f.caseId ?? null, awaitSince: (f as any).awaitSince ?? null, trace: JSON.stringify(f.trace ?? []),
  } as any)
}
export function saveJob(j: JobDoc) {
  db.prepare(`INSERT INTO jobs (id,ofdId,orderId,title,desc,isDirect,dispatchDuId,dispatchHuId,assigneeHuId,promiseDate,status,progress,reworkCount,blockedReason,deliverables,dueHours,vcaseId,createdAt,trace)
    VALUES (@id,@ofdId,@orderId,@title,@desc,@isDirect,@dispatchDuId,@dispatchHuId,@assigneeHuId,@promiseDate,@status,@progress,@reworkCount,@blockedReason,@deliverables,@dueHours,@vcaseId,@createdAt,@trace)
    ON CONFLICT(id) DO UPDATE SET assigneeHuId=@assigneeHuId,promiseDate=@promiseDate,status=@status,progress=@progress,reworkCount=@reworkCount,blockedReason=@blockedReason,deliverables=@deliverables,trace=@trace,dispatchHuId=@dispatchHuId`).run({
    ...j, desc: j.desc ?? null, ofdId: j.ofdId ?? null, orderId: j.orderId ?? null,
    isDirect: j.isDirect ? 1 : 0, dispatchDuId: j.dispatchDuId ?? null, dispatchHuId: j.dispatchHuId ?? null,
    assigneeHuId: j.assigneeHuId ?? null, promiseDate: j.promiseDate ?? null,
    blockedReason: j.blockedReason ?? null, deliverables: JSON.stringify(j.deliverables ?? []),
    dueHours: j.dueHours ?? null, vcaseId: j.vcaseId ?? null, trace: JSON.stringify(j.trace ?? []),
  } as any)
}
export function saveMsg(m: Msg) {
  db.prepare(`INSERT INTO msgs (id,toHuId,title,detail,at,read,link)
    VALUES (@id,@toHuId,@title,@detail,@at,@read,@link)
    ON CONFLICT(id) DO UPDATE SET read=@read`).run({
    ...m, detail: m.detail ?? null, read: m.read ? 1 : 0, link: m.link ?? null,
  } as any)
}
export function markMsgRead(id: string) {
  db.prepare('UPDATE msgs SET read=1 WHERE id=?').run(id)
}

// ---------------- 单号生成：prefix-YYYYMM-NNNN ----------------
export function nextDocNo(prefix: 'O' | 'F' | 'J'): string {
  const now = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const ym = `${now.getFullYear()}${p(now.getMonth() + 1)}`
  const key = `${prefix}-${ym}`
  const row = db.prepare('SELECT seq FROM id_seq WHERE key=?').get(key) as { seq: number } | undefined
  const seq = (row?.seq ?? 0) + 1
  db.prepare('INSERT INTO id_seq (key,seq) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET seq=?').run(key, seq, seq)
  return `${prefix}-${ym}-${String(seq).padStart(4, '0')}`
}
export function nextMsgId(): string {
  const key = 'M'
  const row = db.prepare('SELECT seq FROM id_seq WHERE key=?').get(key) as { seq: number } | undefined
  const seq = (row?.seq ?? 0) + 1
  db.prepare('INSERT INTO id_seq (key,seq) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET seq=?').run(key, seq, seq)
  return `M${Date.now()}${seq}`
}

// ---------------- 时间工具（本地串，禁用 toISOString）----------------
export function fmtLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
export function nowLocal(): string { return fmtLocal(new Date()) }
export function parseLocal(s: string): number { return new Date(s.replace(' ', 'T')).getTime() }

// ============================================================
// 种子数据（仅首次空库播种；密码统一 ofd123456，内测规则）
// ============================================================
const SEED_PASS = 'ofd123456'

export function seedIfEmpty() {
  const count = (db.prepare('SELECT COUNT(*) c FROM hus').get() as any).c
  if (count > 0) return

  const passHash = bcrypt.hashSync(SEED_PASS, 8)
  const insHu = db.prepare('INSERT INTO hus (id,name,duId,title,role,passHash) VALUES (?,?,?,?,?,?)')

  // 8 个 DU
  const dus: Array<[string, string, string]> = [
    ['HDU01', 'H', '人力事业部'],
    ['CDU01', 'C', '客户经营部（清安知味）'],
    ['CDU02', 'C', '客户经营部（菜亿家）'],
    ['EDU01', 'E', '供给经营部（食材供给）'],
    ['EDU02', 'E', '供给经营部（包材供给）'],
    ['DDU01', 'D', '履约调度中心'],
    ['TDU01', 'T', '技术研发部'],
    ['YDU01', 'Y', '智场运营部'],
  ]
  const insDu = db.prepare('INSERT INTO dus (id,type,name,vcaseId) VALUES (?,?,?,NULL)')
  for (const [id, type, name] of dus) insDu.run(id, type, name)

  // 13 名可一键登录的种子 HU
  const hus: Array<[string, string, string, string, string]> = [
    ['HU-C01', '陈嘉铭', 'CDU01', '客户经理', 'requester'],
    ['HU-C02', '周静怡', 'CDU01', '大客户主管', 'duAdmin'],
    ['HU-C11', '林伟诚', 'CDU02', '客户经理', 'requester'],
    ['HU-E01', '苏婉清', 'EDU01', '供给调度员', 'duAdmin'],
    ['HU-E02', '郑立群', 'EDU01', '仓储组长', 'assignee'],
    ['HU-D01', '吴启航', 'DDU01', '履约调度主管', 'duAdmin'],
    ['HU-D02', '许安然', 'DDU01', '履约专员', 'assignee'],
    ['HU-H01', '何晓芸', 'HDU01', '人事专员', 'duAdmin'],
    ['HU-H02', '罗俊杰', 'HDU01', '招聘主管', 'assignee'],
    ['HU-T01', '高梓轩', 'TDU01', '前端工程师', 'assignee'],
    ['HU-T02', '叶芷晴', 'TDU01', '测试工程师', 'assignee'],
    ['HU-Y01', '冯俊杰', 'YDU01', '场务主管', 'duAdmin'],
    ['HU-A01', '谢文博', 'TDU01', '系统管理员', 'sysAdmin'],
  ]
  for (const [id, name, duId, title, role] of hus) insHu.run(id, name, duId, title, role, passHash)

  // 单号序列对齐演示单号（下一号从高位起）
  const setSeq = db.prepare('INSERT INTO id_seq (key,seq) VALUES (?,?)')
  setSeq.run('O-202609', 89)
  setSeq.run('F-202609', 41)
  setSeq.run('J-202609', 102)
  setSeq.run('M', 100)

  // ---- 演示单据：以当前时间为基准回溯，保证三红灯/在途态可见 ----
  const d = (off: number) => {
    const b = new Date(); b.setDate(b.getDate() + off)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${b.getFullYear()}-${p(b.getMonth() + 1)}-${p(b.getDate())}`
  }
  const dt = (off: number, hm: string) => `${d(off)} ${hm}`

  // --- O 需求单 ---
  const orders: OrderDoc[] = [
    {
      id: 'O-202609-0089', title: '科技园店收银机故障排查',
      desc: '科技园店收银机早高峰死机两次，影响出餐开票。需要技术部上门排查，必要时更换备机。期望明午市前恢复。',
      requesterHuId: 'HU-C01', requesterDuId: 'CDU01', targetDuId: 'TDU01', targetHuId: null,
      expectDate: d(1), status: 'converted', attachments: ['收银机报错截图.png'], vcaseId: null,
      ofdId: 'F-202609-0041', createdAt: dt(0, '08:12'),
      trace: [
        { time: dt(0, '08:12'), actor: '陈嘉铭', action: '提交需求单', detail: '跨主体协作 → 进入履约编排' },
        { time: dt(0, '08:40'), actor: '吴启航', action: '受理需求' },
        { time: dt(0, '09:05'), actor: '吴启航', action: '转履约 F-202609-0041' },
      ],
    },
    {
      id: 'O-202609-0088', title: '9 月第二周酱料包补货',
      desc: '科技园、南头、西丽三店酱料包库存低于安全线（余量 2.5 天）。按标准补货清单补齐，周三前到仓。',
      requesterHuId: 'HU-C02', requesterDuId: 'CDU01', targetDuId: 'EDU01', targetHuId: null,
      expectDate: d(2), status: 'accepted', attachments: [], vcaseId: null, ofdId: null,
      createdAt: dt(-1, '15:47'),
      trace: [
        { time: dt(-1, '15:47'), actor: '周静怡', action: '提交需求单', detail: '跨主体协作 → 进入履约编排' },
        { time: dt(-1, '17:20'), actor: '苏婉清', action: '受理需求' },
      ],
    },
    {
      id: 'O-202609-0086', title: '门店月度经营简报模板更新',
      desc: '现用简报模板缺少「客诉关闭时长」与「供给达成率」两栏，需更新模板并在 8 家门店推广使用。',
      requesterHuId: 'HU-D01', requesterDuId: 'DDU01', targetDuId: 'TDU01', targetHuId: 'HU-T01',
      expectDate: d(5), status: 'submitted', attachments: ['现用简报模板.docx'], vcaseId: null, ofdId: null,
      createdAt: dt(-1, '10:31'),
      trace: [{ time: dt(-1, '10:31'), actor: '吴启航', action: '提交需求单', detail: '跨主体协作 → 进入履约编排' }],
    },
  ]
  for (const o of orders) saveOrder(o)

  // --- F 履约单 ---
  const ofds: OfdDoc[] = [
    {
      id: 'F-202609-0041', orderId: 'O-202609-0089', title: '科技园店收银机故障排查履约方案',
      deliverables: [
        { id: 'D1', name: '故障诊断报告', standard: '写明死机原因、影响面、处置建议' },
        { id: 'D2', name: '收银机恢复可用', standard: '午市开票连续 2 小时无故障' },
        { id: 'D3', name: '防复发措施清单', standard: '含巡检项与责任分工' },
      ],
      promiseDate: d(1), promiseOriginal: d(2), ownerDuId: 'DDU01', status: 'inProgress',
      caseId: null, createdAt: dt(0, '09:05'), awaitSince: null,
      trace: [
        { time: dt(0, '09:05'), actor: '吴启航', action: '编制履约方案', detail: '交付物 3 项 · 承诺 ' + d(1) },
        { time: dt(0, '09:30'), actor: '吴启航', action: '派工单 J-202609-0102' },
        { time: dt(0, '10:02'), actor: '高梓轩', action: 'J-202609-0102 已接单' },
      ],
    },
  ]
  for (const f of ofds) saveOfd(f)

  // --- J 工单 ---
  const jobs: JobDoc[] = [
    {
      id: 'J-202609-0102', ofdId: 'F-202609-0041', orderId: 'O-202609-0089',
      title: '科技园店收银机上门排查', desc: '携带备机上门，先恢复营业再排查根因；诊断报告当日回传。',
      isDirect: false, dispatchDuId: 'TDU01', dispatchHuId: null, assigneeHuId: 'HU-T01',
      promiseDate: d(1), status: 'working', progress: 45, reworkCount: 0, blockedReason: null,
      deliverables: [], dueHours: 8, vcaseId: null, createdAt: dt(0, '09:30'),
      trace: [
        { time: dt(0, '09:30'), actor: '吴启航', action: '从 F-202609-0041 派出工单' },
        { time: dt(0, '10:02'), actor: '高梓轩', action: '接单', detail: '承诺时间协商为 ' + d(1) },
        { time: dt(0, '11:40'), actor: '高梓轩', action: '更新进度 45%', detail: '已到场，复现死机 1 次，初步判断为主板电容鼓包' },
      ],
    },
    {
      id: 'J-202609-0090', ofdId: null, orderId: null,
      title: '周五全员消防演练场地布置', desc: '本期演练改在仓库外空地，需提前布置警戒线、疏散指引牌与签到台。',
      isDirect: true, dispatchDuId: null, dispatchHuId: 'HU-Y01', assigneeHuId: 'HU-Y01',
      promiseDate: d(3), status: 'working', progress: 20, reworkCount: 0, blockedReason: null,
      deliverables: [], dueHours: 4, vcaseId: null, createdAt: dt(0, '08:55'),
      trace: [
        { time: dt(0, '08:55'), actor: '何晓芸', action: '直发工单（通路B）' },
        { time: dt(0, '09:15'), actor: '冯俊杰', action: '接单' },
      ],
    },
    {
      id: 'J-202609-0079', ofdId: null, orderId: null,
      title: '9 月门店排班表汇总核对', desc: '收集 12 店 9 月排班表，核对工时口径后归档。',
      isDirect: true, dispatchDuId: null, dispatchHuId: 'HU-H02', assigneeHuId: null,
      promiseDate: d(4), status: 'waitAccept', progress: 0, reworkCount: 0, blockedReason: null,
      deliverables: [], dueHours: 8, vcaseId: null, createdAt: dt(0, '09:12'),
      trace: [{ time: dt(0, '09:12'), actor: '何晓芸', action: '直发工单（通路B）' }],
    },
  ]
  for (const j of jobs) saveJob(j)

  // --- 消息 ---
  const msgs: Msg[] = [
    { id: 'M1', toHuId: 'HU-C01', title: 'J-202609-0102 进度 45%', detail: '高梓轩：已到场，初步判断为主板电容鼓包', at: dt(0, '11:40'), read: false, link: '/job/J-202609-0102' },
    { id: 'M3', toHuId: 'HU-T01', title: '收到新工单 J-202609-0102', detail: '履约调度中心 · 吴启航 派出「科技园店收银机上门排查」', at: dt(0, '09:30'), read: false, link: '/job/J-202609-0102' },
    { id: 'M4', toHuId: 'HU-H02', title: '收到新工单 J-202609-0079', detail: '人力事业部 · 何晓芸 直发「9 月门店排班表汇总核对」', at: dt(0, '09:12'), read: false, link: '/job/J-202609-0079' },
  ]
  for (const m of msgs) saveMsg(m)
}

seedIfEmpty()
