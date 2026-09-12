import { Table, Tag, Empty, Button } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { Link } from 'react-router-dom'
import { useStore } from '../store'
import { DU_TYPE_META, JOB_STATUS, type JobDoc } from '../types'

/** 公共列：DU 归属 tag + HU 操作人（双层模型的可视表达） */
export function duTag(duId: string | null | undefined) {
  const du = useStore.getState().duById(duId)
  if (!du) return <Tag color="default">—</Tag>
  const meta = DU_TYPE_META[du.type]
  return <Tag color={meta.color}>{du.name}</Tag>
}

export function huName(huId: any) {
  const hu = useStore.getState().huById(huId)
  return hu ? hu.name : '—'
}

export function jobStatusTag(s: JobDoc['status']) {
  const meta = JOB_STATUS[s]
  return <Tag color={meta.color}>{meta.label}</Tag>
}

export function EmptyState({ text, action }: { text: string; action?: { to: string; label: string } }) {
  return (
    <Empty description={text} style={{ padding: '40px 0' }}>
      {action && (
        <Link to={action.to}><Button type="primary">{action.label}</Button></Link>
      )}
    </Empty>
  )
}

/** 工单通用列（供列表页复用；页面级差异列由页面自带） */
export const jobColumns = (opts?: { showSource?: boolean }): ColumnsType<JobDoc> => {
  const cols: ColumnsType<JobDoc> = [
    {
      title: '工单号', dataIndex: 'id', width: 150,
      render: (v: string, r) => <Link to={`/job/${r.id}`} className="mono">{v}</Link>,
      sorter: (a, b) => a.id.localeCompare(b.id),
    },
    {
      title: '标题', dataIndex: 'title', ellipsis: true,
      render: (v: string, r) => (
        <Link to={`/job/${r.id}`} style={{ color: 'inherit' }}>
          {v}
          {r.isDirect && <Tag style={{ marginLeft: 8 }} color="default">直发</Tag>}
          {r.reworkCount > 0 && <Tag style={{ marginLeft: 4 }} color="volcano">返工{r.reworkCount}</Tag>}
        </Link>
      ),
    },
    { title: '派给', key: 'dispatch', width: 220, render: (_v, r) => { const duId = r.dispatchDuId ?? useStore.getState().huById(r.dispatchHuId)?.duId; return duTag(duId) } },
    { title: '责任人', key: 'assignee', width: 90, render: (_v, r) => huName(r.assigneeHuId) },
    { title: '承诺完成', dataIndex: 'promiseDate', width: 110, className: 'mono', sorter: (a, b) => a.promiseDate.localeCompare(b.promiseDate) },
    { title: '进度', dataIndex: 'progress', width: 140, render: (v: number) => `${v}%`, sorter: (a, b) => a.progress - b.progress },
    { title: '状态', key: 'status', width: 100, render: (_v, r) => jobStatusTag(r.status) },
  ]
  if (opts?.showSource) {
    cols.splice(2, 0, {
      title: '来源', key: 'source', width: 140,
      render: (_v, r) => (r.ofdId ? <Link to={`/ofd/${r.ofdId}`} className="mono">{r.ofdId}</Link> : <Tag>直发</Tag>),
    })
  }
  return cols
}
