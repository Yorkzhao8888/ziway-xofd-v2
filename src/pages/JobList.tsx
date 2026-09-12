import { useMemo, useState } from 'react'
import { Card, Table, Tag, Input, Select, Space, Button } from 'antd'
import { Link, useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { DU_TYPE_META, JOB_STATUS, type JobDoc } from '../types'
import JobCreate from '../components/JobCreate'
import { useIsMobile, MobileCard, MobileField, MobileList, StatusTag } from '../components/responsive'

/** 工单列表（PRD M4/M8）：排序/筛选/分页；直发工单标「直发」 */
export default function JobList() {
  const st = useStore()
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<string | undefined>()
  const [createOpen, setCreateOpen] = useState(false)
  const isMobile = useIsMobile()

  const data = useMemo(
    () => st.jobs.filter((j) =>
      (!q || j.title.includes(q) || j.id.includes(q)) &&
      (!status || j.status === status),
    ),
    [st.jobs, q, status],
  )

  const cols = [
    { title: '工单号', dataIndex: 'id', width: 150, sorter: (a: JobDoc, b: JobDoc) => a.id.localeCompare(b.id), render: (v: string, r: JobDoc) => <Link to={`/job/${r.id}`} className="mono">{v}</Link> },
    {
      title: '标题', dataIndex: 'title', ellipsis: true,
      render: (v: string, r: JobDoc) => (
        <Link to={`/job/${r.id}`} style={{ color: 'inherit' }}>
          {v}
          {r.isDirect && <Tag style={{ marginLeft: 8 }} color="default">直发</Tag>}
          {r.reworkCount > 0 && <Tag style={{ marginLeft: 4 }} color="volcano">返工{r.reworkCount}</Tag>}
        </Link>
      ),
    },
    {
      title: '来源', key: 'source', width: 140,
      render: (_v, r: JobDoc) => (r.ofdId ? <Link to={`/ofd/${r.ofdId}`} className="mono">{r.ofdId}</Link> : <Tag color="default">直发</Tag>),
    },
    {
      title: '派给DU', key: 'dispatchDu', width: 190,
      render: (_v, r: JobDoc) => {
        const duId = r.dispatchDuId ?? st.huById(r.dispatchHuId)?.duId ?? st.huById(r.assigneeHuId)?.duId
        const du = st.duById(duId)
        return du ? <Tag color={DU_TYPE_META[du.type].color}>{du.name}</Tag> : <Tag>—</Tag>
      },
    },
    { title: '责任人', key: 'assignee', width: 90, render: (_v, r: JobDoc) => st.huById(r.assigneeHuId)?.name ?? <span style={{ color: 'rgba(0,0,0,0.35)' }}>未接单</span> },
    { title: '进度', dataIndex: 'progress', width: 90, className: 'mono', sorter: (a: JobDoc, b: JobDoc) => a.progress - b.progress, render: (v: number) => `${v}%` },
    { title: '承诺完成', dataIndex: 'promiseDate', width: 110, className: 'mono', sorter: (a: JobDoc, b: JobDoc) => a.promiseDate.localeCompare(b.promiseDate) },
    {
      title: '状态', dataIndex: 'status', width: 100,
      filters: Object.entries(JOB_STATUS).map(([k, v]) => ({ text: v.label, value: k })),
      onFilter: (v: any, r: JobDoc) => r.status === v,
      render: (v: JobDoc['status']) => <Tag color={JOB_STATUS[v].color}>{JOB_STATUS[v].label}</Tag>,
    },
  ]

  return (
    <div className="page">
      <h1 className="page-title">工单（JOB）</h1>
      <p className="page-sub">最小派发单元 —— 一张工单只有一个接单方；接单后责任人锁定到 HU</p>
      {isMobile ? (
        <>
          <Space direction="vertical" style={{ width: '100%', marginBottom: 12 }} size={8}>
            <Space style={{ width: '100%' }} wrap>
              <Button type="primary" style={{ flex: 1, minHeight: 44 }} onClick={() => setCreateOpen(true)}>直发工单</Button>
              <Select placeholder="状态筛选" allowClear style={{ flex: 1, minWidth: 130 }} value={status} onChange={setStatus}
                options={Object.entries(JOB_STATUS).map(([k, v]) => ({ value: k, label: v.label }))} />
            </Space>
            <Input.Search placeholder="搜单号 / 标题" allowClear style={{ width: '100%' }} onSearch={setQ} onChange={(e) => !e.target.value && setQ('')} />
          </Space>
          <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginBottom: 8 }}>共 {data.length} 张</div>
          <MobileList
            items={data}
            locale={{ emptyText: '没有符合条件的工单' }}
            renderItem={(j: JobDoc) => {
              const duId = j.dispatchDuId ?? st.huById(j.dispatchHuId)?.duId ?? st.huById(j.assigneeHuId)?.duId
              const du = st.duById(duId)
              return (
                <MobileCard
                  title={<>
                    <span className="mono" style={{ fontSize: 12, color: '#FF6B35' }}>{j.id}</span>
                    <div>
                      {j.title}
                      {j.isDirect && <Tag style={{ marginLeft: 6 }} color="default">直发</Tag>}
                      {j.reworkCount > 0 && <Tag style={{ marginLeft: 4 }} color="volcano">返工{j.reworkCount}</Tag>}
                    </div>
                  </>}
                  titleTo={`/job/${j.id}`}
                  badge={<StatusTag color={JOB_STATUS[j.status].color}>{JOB_STATUS[j.status].label}</StatusTag>}
                  fields={
                    <>
                      <MobileField label="来源">{j.ofdId ? <Link to={`/ofd/${j.ofdId}`} className="mono">{j.ofdId}</Link> : <Tag color="default">直发</Tag>}</MobileField>
                      <MobileField label="派给">{du ? <Tag color={DU_TYPE_META[du.type].color}>{du.name}</Tag> : '—'}</MobileField>
                      <MobileField label="责任人">{st.huById(j.assigneeHuId)?.name ?? <span style={{ color: 'rgba(0,0,0,0.35)' }}>未接单</span>}</MobileField>
                      <MobileField label="进度" mono>{j.progress}%</MobileField>
                      <MobileField label="承诺完成" mono>{j.promiseDate}</MobileField>
                    </>
                  }
                  actions={<Button size="small" type="link" style={{ padding: 0 }} onClick={() => nav(`/job/${j.id}`)}>查看/处理 →</Button>}
                />
              )
            }}
          />
        </>
      ) : (
      <Card size="small">
        <Space style={{ marginBottom: 12 }} wrap>
          <Input.Search placeholder="搜单号 / 标题" allowClear style={{ width: 260 }} onSearch={setQ} onChange={(e) => !e.target.value && setQ('')} />
          <Select placeholder="状态筛选" allowClear style={{ width: 140 }} value={status} onChange={setStatus}
            options={Object.entries(JOB_STATUS).map(([k, v]) => ({ value: k, label: v.label }))} />
          <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>共 {data.length} 张</span>
          <Button type="primary" onClick={() => setCreateOpen(true)}>直发工单</Button>
        </Space>
        <Table
          size="middle" rowKey="id" columns={cols as any} dataSource={data}
          pagination={{ pageSize: 10, showTotal: (t) => `共 ${t} 条` }}
        />
      </Card>
      )}
      <JobCreate open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  )
}
