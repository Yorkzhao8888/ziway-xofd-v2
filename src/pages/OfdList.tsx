import { useMemo } from 'react'
import { Card, Table, Tag, Empty, List } from 'antd'
import { Link } from 'react-router-dom'
import { useStore } from '../store'
import { OFD_STATUS, DU_TYPE_META, type OfdDoc } from '../types'
import { useIsMobile, MobileCard, MobileField, StatusTag } from '../components/responsive'

/** 履约单列表 */
export default function OfdList() {
  const st = useStore()
  const isMobile = useIsMobile()

  const cols = useMemo(
    () => [
      { title: '履约单号', dataIndex: 'id', width: 150, sorter: (a: OfdDoc, b: OfdDoc) => a.id.localeCompare(b.id), render: (v: string, r: OfdDoc) => <Link to={`/ofd/${r.id}`} className="mono">{v}</Link> },
      { title: '标题', dataIndex: 'title', ellipsis: true, render: (v: string, r: OfdDoc) => <Link to={`/ofd/${r.id}`} style={{ color: 'inherit' }}>{v}</Link> },
      { title: '来源需求单', dataIndex: 'orderId', width: 150, render: (v: string) => v ? <Link to={`/order/${v}`} className="mono">{v}</Link> : '—' },
      { title: '编制DU', dataIndex: 'ownerDuId', width: 190, render: (v: string) => { const du = st.dus.find((d) => d.id === v); return du ? <Tag color={(DU_TYPE_META as any)[du.type].color}>{du.name}</Tag> : '—' } },
      { title: '交付物', key: 'dlv', width: 110, render: (_v, r: OfdDoc) => {
        const pass = r.deliverables.filter((d) => d.result === 'pass').length
        return <span className="mono">{pass}/{r.deliverables.length} 项通过</span>
      } },
      { title: '承诺完成', dataIndex: 'promiseDate', width: 110, className: 'mono', sorter: (a: OfdDoc, b: OfdDoc) => a.promiseDate.localeCompare(b.promiseDate) },
      {
        title: '状态', dataIndex: 'status', width: 100,
        filters: Object.entries(OFD_STATUS).map(([k, v]) => ({ text: v.label, value: k })),
        onFilter: (v: any, r: OfdDoc) => r.status === v,
        render: (v: OfdDoc['status']) => <Tag color={OFD_STATUS[v].color}>{OFD_STATUS[v].label}</Tag>,
      },
    ],
    [st],
  )

  return (
    <div className="page">
      <h1 className="page-title">履约单（OFD）</h1>
      <p className="page-sub">「承诺怎么交」—— 交付物清单 + 承诺时间 + 验收标准，验收按清单逐项过</p>
      <Card size="small">
        {isMobile ? (
          st.ofds.length === 0 ? <Empty description="暂无履约单" style={{ padding: '32px 0' }} /> : (
            <List dataSource={st.ofds} renderItem={(o) => {
              const pass = o.deliverables.filter((d) => d.result === 'pass').length
              const du = st.dus.find((d) => d.id === o.ownerDuId)
              return (
                <MobileCard
                  titleTo={`/ofd/${o.id}`}
                  title={<span className="mono">{o.id}</span>}
                  badge={<StatusTag color={OFD_STATUS[o.status].color}>{OFD_STATUS[o.status].label}</StatusTag>}
                  fields={<>
                    <MobileField label="标题">{o.title}</MobileField>
                    <MobileField label="编制DU">{du ? du.name : '—'}</MobileField>
                    <MobileField label="交付">验收 {pass}/{o.deliverables.length} 项</MobileField>
                    <MobileField label="承诺完成" mono>{o.promiseDate}</MobileField>
                  </>}
                />
              )
            }} />
          )
        ) : (
        <Table
          size="middle" rowKey="id" columns={cols as any} dataSource={st.ofds}
          pagination={{ pageSize: 10, showTotal: (t) => `共 ${t} 条` }}
        />
        )}
      </Card>
    </div>
  )
}
