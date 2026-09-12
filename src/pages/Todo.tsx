import { useMemo } from 'react'
import { Card, Table, Tag, Tabs, Alert } from 'antd'
import { Link } from 'react-router-dom'
import { useStore } from '../store'
import { DU_TYPE_META, JOB_STATUS, OFD_STATUS, ORDER_STATUS } from '../types'
import { useIsMobile, MobileCard, MobileField, MobileList, StatusTag } from '../components/responsive'

/** 我的待办：按角色聚合（PRD M8-1），Tabs 分「要接的 / 在办的 / 待验收 / 我发的」 */
export default function TodoPage() {
  const st = useStore()
  const me = st.currentHu()
  const myDu = st.currentDu()
  const isMobile = useIsMobile()

  // 待接：派给我 / 派给我 DU 且无人认领
  const toAccept = useMemo(
    () => st.jobs.filter((j) => j.status === 'waitAccept' && (j.dispatchHuId === me.id || j.dispatchDuId === me.duId)),
    [st.jobs, me],
  )
  // 在办：我责任人的
  const working = useMemo(
    () => st.jobs.filter((j) => j.assigneeHuId === me.id && ['working', 'blocked', 'rework'].includes(j.status)),
    [st.jobs, me],
  )
  // 待验收：本 DU 是履约编制方且 OFD 待验收
  const toCheck = useMemo(() => st.ofds.filter((f) => f.status === 'awaitAccept' && f.ownerDuId === me.duId), [st.ofds, me])
  // 我发的在途需求
  const myOrders = useMemo(
    () => st.orders.filter((o) => o.requesterHuId === me.id && !['closed', 'withdrawn', 'rejected'].includes(o.status)),
    [st.orders, me],
  )

  const jobCols = [
    { title: '工单号', dataIndex: 'id', width: 150, render: (v: string, r: any) => <Link to={`/job/${r.id}`} className="mono">{v}</Link> },
    { title: '标题', dataIndex: 'title', ellipsis: true, render: (v: string, r: any) => (
      <span>{v}{r.isDirect ? <Tag style={{ marginLeft: 8 }}>直发</Tag> : null}</span>
    ) },
    { title: '来自', key: 'from', width: 230, render: (_v, r: any) => {
      const order = st.orders.find((o) => o.id === r.orderId)
      if (order) return duTagOf(order.requesterDuId)
      // 直发无来源单，找派单人
      const t = r.trace[0]?.actor
      return <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>{t ? `${t} 直发` : '—'}</span>
    } },
    { title: '承诺完成', dataIndex: 'promiseDate', width: 110, className: 'mono' },
    { title: '状态', key: 'status', width: 90, render: (_v, r: any) => <Tag color={JOB_STATUS[r.status as keyof typeof JOB_STATUS]?.color}>{JOB_STATUS[r.status as keyof typeof JOB_STATUS]?.label}</Tag> },
  ]

  const jobMobile = (list: any[], empty: string) => (
    <MobileList
      items={list}
      locale={{ emptyText: empty }}
      renderItem={(r: any) => {
        const order = st.orders.find((o) => o.id === r.orderId)
        return (
          <MobileCard
            title={<>
              <span className="mono" style={{ fontSize: 12, color: '#FF6B35' }}>{r.id}</span>
              <div>{r.title}{r.isDirect ? <Tag style={{ marginLeft: 6 }}>直发</Tag> : null}</div>
            </>}
            titleTo={`/job/${r.id}`}
            badge={<StatusTag color={JOB_STATUS[r.status as keyof typeof JOB_STATUS]?.color}>{JOB_STATUS[r.status as keyof typeof JOB_STATUS]?.label}</StatusTag>}
            fields={
              <>
                <MobileField label="来自">{order ? duTagOf(order.requesterDuId) : <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>{r.trace[0]?.actor ? `${r.trace[0].actor} 直发` : '—'}</span>}</MobileField>
                <MobileField label="承诺完成" mono>{r.promiseDate}</MobileField>
              </>
            }
          />
        )
      }}
    />
  )

  const ofdMobile = (
    <MobileList
      items={toCheck}
      locale={{ emptyText: '没有待验收的履约单 —— 注意：验收超 48 小时将自动通过' }}
      renderItem={(r: any) => {
        const o = st.orders.find((x) => x.id === r.orderId)
        return (
          <MobileCard
            title={<>
              <span className="mono" style={{ fontSize: 12, color: '#FF6B35' }}>{r.id}</span>
              <div>{r.title}</div>
            </>}
            titleTo={`/ofd/${r.id}`}
            badge={<StatusTag color={OFD_STATUS[r.status as keyof typeof OFD_STATUS]?.color}>{OFD_STATUS[r.status as keyof typeof OFD_STATUS]?.label}</StatusTag>}
            fields={
              <>
                <MobileField label="需求方">{o ? duTagOf(o.requesterDuId) : '—'}</MobileField>
                <MobileField label="承诺完成" mono>{r.promiseDate}</MobileField>
              </>
            }
          />
        )
      }}
    />
  )

  const orderMobile = (
    <MobileList
      items={myOrders}
      locale={{ emptyText: '还没发过需求单' }}
      renderItem={(r: any) => (
        <MobileCard
          title={<>
            <span className="mono" style={{ fontSize: 12, color: '#FF6B35' }}>{r.id}</span>
            <div>{r.title}</div>
          </>}
          titleTo={`/order/${r.id}`}
          badge={<StatusTag color={ORDER_STATUS[r.status as keyof typeof ORDER_STATUS]?.color}>{ORDER_STATUS[r.status as keyof typeof ORDER_STATUS]?.label}</StatusTag>}
          fields={
            <>
              <MobileField label="派给">{r.targetDuId ? duTagOf(r.targetDuId) : <span>{st.huById(r.targetHuId)?.name}（指定到人）</span>}</MobileField>
              <MobileField label="期望完成" mono>{r.expectDate}</MobileField>
            </>
          }
        />
      )}
    />
  )

  return (
    <div className="page">
      <h1 className="page-title">我的待办</h1>
      <p className="page-sub">{me.name} · {myDu.name} —— 每天从这里开始，每条都有明确动作</p>

      {toAccept.length > 0 && (
        <Alert
          style={{ marginBottom: 16 }}
          type="warning" showIcon
          message={`有 ${toAccept.length} 张工单等你接单（超 4 小时未接将升级提醒 DU 负责人）`}
        />
      )}

      <Tabs
        defaultActiveKey="accept"
        items={[
          {
            key: 'accept', label: `要接的（${toAccept.length}）`,
            children: isMobile ? jobMobile(toAccept, '没有待接的工单 —— 派给你 DU 的单会出现在这里') : (
              <Table
                size="middle" rowKey="id" columns={jobCols} dataSource={toAccept} pagination={false}
                locale={{ emptyText: '没有待接的工单 —— 派给你 DU 的单会出现在这里' }}
              />
            ),
          },
          {
            key: 'working', label: `在办的（${working.length}）`,
            children: isMobile ? jobMobile(working, '暂无在办工单') : (
              <Table
                size="middle" rowKey="id" columns={jobCols} dataSource={working} pagination={false}
                locale={{ emptyText: '暂无在办工单' }}
              />
            ),
          },
          {
            key: 'check', label: `待验收（${toCheck.length}）`,
            children: isMobile ? ofdMobile : (
              <Table
                size="middle" rowKey="id" pagination={false}
                locale={{ emptyText: '没有待验收的履约单 —— 注意：验收超 48 小时将自动通过' }}
                dataSource={toCheck}
                columns={[
                  { title: '履约单号', dataIndex: 'id', width: 150, render: (v: string, r: any) => <Link to={`/ofd/${r.id}`} className="mono">{v}</Link> },
                  { title: '标题', dataIndex: 'title', ellipsis: true },
                  { title: '需求方', key: 'req', width: 220, render: (_v, r: any) => { const o = st.orders.find((x) => x.id === r.orderId); return o ? duTagOf(o.requesterDuId) : '—' } },
                  { title: '承诺完成', dataIndex: 'promiseDate', width: 110, className: 'mono' },
                  { title: '状态', key: 's', width: 90, render: (_v, r: any) => <Tag color={OFD_STATUS[r.status as keyof typeof OFD_STATUS]?.color}>{OFD_STATUS[r.status as keyof typeof OFD_STATUS]?.label}</Tag> },
                ]}
              />
            ),
          },
          {
            key: 'sent', label: `我发的（${myOrders.length}）`,
            children: isMobile ? orderMobile : (
              <Table
                size="middle" rowKey="id" pagination={false}
                locale={{ emptyText: '还没发过需求单，点左侧「发单」提一个' }}
                dataSource={myOrders}
                columns={[
                  { title: '需求单号', dataIndex: 'id', width: 150, render: (v: string, r: any) => <Link to={`/order/${r.id}`} className="mono">{v}</Link> },
                  { title: '标题', dataIndex: 'title', ellipsis: true },
                  { title: '派给', key: 'to', width: 220, render: (_v, r: any) => r.targetDuId ? duTagOf(r.targetDuId) : <span>{st.huById(r.targetHuId)?.name}（指定到人）</span> },
                  { title: '期望完成', dataIndex: 'expectDate', width: 110, className: 'mono' },
                  { title: '状态', key: 's', width: 90, render: (_v, r: any) => <Tag color={ORDER_STATUS[r.status as keyof typeof ORDER_STATUS]?.color}>{ORDER_STATUS[r.status as keyof typeof ORDER_STATUS]?.label}</Tag> },
                ]}
              />
            ),
          },
        ]}
      />
    </div>
  )
}

function duTagOf(duId: string) {
  const du = useStore.getState().duById(duId)
  if (!du) return <Tag>—</Tag>
  return <Tag color={DU_TYPE_META[du.type].color}>{du.name}</Tag>
}
