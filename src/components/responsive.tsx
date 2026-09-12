import type { ReactNode } from 'react'
import { List, Tag } from 'antd'
import { Link } from 'react-router-dom'
import { Grid } from 'antd'

/**
 * 移动端响应式基础设施（纯 UI 层，不动业务逻辑/接口/类型）。
 * - useIsMobile：AntD 断点，<768（md 边界）判定为手机；768+ 平板/桌面用桌面布局。
 * - MobileCard / MobileField：手机上替代数据表格的卡片与键值行。
 * - MobileList：卡片流容器。
 * 页面用法：const isMobile = useIsMobile(); isMobile ? <MobileList .../> : <Table .../>
 */
export function useIsMobile(): boolean {
  const screens = Grid.useBreakpoint()
  // screens.md = 宽度 >=768；手机（375）与小平板竖屏为 false
  return screens.md === false
}

export function MobileField({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="m-field">
      <span className="m-field-k">{label}</span>
      <span className={`m-field-v ${mono ? 'mono' : ''}`}>{children}</span>
    </div>

)
}

/** 一张移动卡片：标题行（可点）+ 状态角标 + 字段区 + 可选操作区 */
export function MobileCard({
  title,
  titleTo,
  badge,
  fields,
  actions,
  extra,
}: {
  title: ReactNode
  titleTo?: string
  badge?: ReactNode
  fields: ReactNode
  actions?: ReactNode
  extra?: ReactNode
}) {
  return (
    <div className="m-card">
      <div className="m-card-head">
        {titleTo ? (
          <Link to={titleTo} className="m-card-title">{title}</Link>
        ) : (
          <span className="m-card-title">{title}</span>
        )}
        {badge}
      </div>
      {extra}
      <div className="m-card-body">{fields}</div>
      {actions && <div className="m-card-actions">{actions}</div>}
    </div>
  )
}

/** 手机卡片流容器 */
export function MobileList<T>({
  items,
  locale,
  renderItem,
}: {
  items: T[]
  locale?: { emptyText: ReactNode }
  renderItem: (item: T) => ReactNode
}) {
  return (
    <div className="m-card-list">
      <List
        dataSource={items}
        locale={locale}
        split={false}
        renderItem={(item) => <List.Item style={{ padding: 0, border: 'none', marginBottom: 12 }}>{renderItem(item as T)}</List.Item>}
      />
    </div>
  )
}

/** 手机端状态角标 Tag（统一放在卡片右上，不被挤压） */
export function StatusTag({ color, children }: { color?: string; children: ReactNode }) {
  return <Tag color={color} style={{ marginInlineEnd: 0, flexShrink: 0, whiteSpace: 'nowrap' }}>{children}</Tag>
}
