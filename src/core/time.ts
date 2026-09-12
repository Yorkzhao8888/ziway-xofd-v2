/** 时间工具（单点收敛）
 *  原型所有时间串统一「YYYY-MM-DD HH:mm」本地时间。
 *  🔴 禁用 new Date().toISOString() —— 那是 UTC 串，与 Date.now() 混用会让
 *  三红灯时间窗 / 48h 自动验收倒计时整体偏移 8 小时。
 */
export function fmtLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 「YYYY-MM-DD HH:mm」→ 本地时间戳（与 fmtLocal 互逆） */
export function parseLocal(s: string): number {
  return new Date(s.replace(' ', 'T')).getTime()
}
