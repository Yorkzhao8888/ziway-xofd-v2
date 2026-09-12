import { useMemo, useState } from 'react'
import { Card, Table, Tag, Input, Select, Space, Button, Empty, List } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { Link } from 'react-router-dom'
import { useStore } from '../store'
import { DU_TYPE_META, ORDER_STATUS, type OrderDoc } from '../types'
import OrderCreateDrawer from '../components/OrderCreateDrawer'
import { useIsMobile, MobileCard, MobileField, StatusTag } from '../components/responsive'

/** 需求单列表（PRD M8-3）：排序/筛选/分页 + 状态 tag 语义色；发单入口并入本页（抽屉） */
export default function OrderList() {
  const st = useStore()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<string | undefined>()
  const [createOpen, setCreateOpen] = useState(false)
  const isMobile = useIsMobile()

  const data = useMemo(
    () => st.orders.filter((o) =>
      (!q || o.title.includes(q) || o.id.includes(q)) &&
      (!status || o.status === status),
    ),
    [st.orders, q, status],
  )

  const duTagOf = (duId: string) => {
    const du = st.dus.find((d) => d.id === duId)
    return du ? <Tag color={DU_TYPE_META[du.type].color}>{du.name}</Tag> : <Tag>—</Tag>
  }

  const cols = [
    { title: '需求单号', dataIndex: 'id', width: 150, sorter: (a: OrderDoc, b: OrderDoc) => a.id.localeCompare(b.id), render: (v: string, r: OrderDoc) => <Link to={`/order/${r.id}`} className="mono">{v}</Link> },
    { title: '标题', dataIndex: 'title', ellipsis: true, render: (v: string, r: OrderDoc) => <Link to={`/order/${r.id}`} style={{ color: 'inherit' }}>{v}</Link> },
    { title: '发单人', dataIndex: 'requesterHuId', width: 90, render: (v: string) => st.huById(v)?.name ?? '—' },
    { title: '发单DU', dataIndex: 'requesterDuId', width: 200, render: (v: string) => duTagOf(v) },
    { title: '派给', key: 'target', width: 200, render: (_v, r: OrderDoc) => r.targetDuId ? duTagOf(r.targetDuId) : <span>{st.huById(r.targetHuId)?.name}（到人）</span> },
    { title: '期望完成', dataIndex: 'expectDate', width: 110, className: 'mono', sorter: (a: OrderDoc, b: OrderDoc) => a.expectDate.localeCompare(b.expectDate) },
    {
      title: '状态', dataIndex: 'status', width: 100,
      filters: Object.entries(ORDER_STATUS).map(([k, v]) => ({ text: v.label, value: k })),
      onFilter: (v: any, r: OrderDoc) => r.status === v,
      render: (v: OrderDoc['status']) => <Tag color={ORDER_STATUS[v].color}>{ORDER_STATUS[v].label}</Tag>,
    },
  ]

  return (
    <div className="page">
      <h1 className="page-title">需求单（ORDER）</h1>
      <p className="page-sub">需求方的原始诉求 —— 全链路单据的起点；直发工单不在此列</p>
      <Card size="small">
        <Space style={{ marginBottom: 12 }} wrap>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>发单</Button>
          <Input.Search placeholder="搜单号 / 标题" allowClear style={{ width: 260 }} onSearch={setQ} onChange={(e) => !e.target.value && setQ('')} />
          <Select placeholder="状态筛选" allowClear style={{ width: 140 }} value={status} onChange={setStatus}
            options={Object.entries(ORDER_STATUS).map(([k, v]) => ({ value: k, label: v.label }))} />
          <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>共 {data.length} 张</span>
        </Space>
        {isMobile ? (
          data.length === 0 ? <Empty description="暂无需求单" style={{ padding: '32px 0' }} /> : (
            <List dataSource={data} renderItem={(o) => (
              <MobileCard
                titleTo={`/order/${o.id}`}
                title={<span className="mono">{o.id}</span>}
                badge={<StatusTag color={ORDER_STATUS[o.status].color}>{ORDER_STATUS[o.status].label}</StatusTag>}
                fields={<>
                  <MobileField label="标题">{o.title}</MobileField>
                  <MobileField label="发单人">{st.huById(o.requesterHuId)?.name ?? '—'}</MobileField>
                  <MobileField label="派给">{o.targetDuId ? (st.dus.find((d) => d.id === o.targetDuId)?.name ?? '—') : `${st.huById(o.targetHuId)?.name ?? ''}（到人）`}</MobileField>
                  <MobileField label="期望完成" mono>{o.expectDate || '—'}</MobileField>
                </>}
              />
            )} />
          )
        ) : (
        <Table
          size="middle" rowKey="id" columns={cols as any} dataSource={data}
          pagination={{ pageSize: 10, showTotal: (t) => `共 ${t} 条` }}
        />
        )}
      </Card>
      <OrderCreateDrawer open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  )
}
