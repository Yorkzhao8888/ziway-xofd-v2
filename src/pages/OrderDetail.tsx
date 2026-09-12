import { useParams, Link, useNavigate } from 'react-router-dom'
import { Card, Descriptions, Tag, Timeline, Button, Input, Modal, Space, Alert, message, Popconfirm } from 'antd'
import { useState } from 'react'
import { useStore } from '../store'
import { DU_TYPE_META, ORDER_STATUS } from '../types'
import OfdCreate from '../components/OfdCreate'

/** 需求单详情：Descriptions + 轨迹 Timeline + 受理/编制方案/驳回/撤回操作（受理权=接单方，M2-3）
 *  状态机：submitted →（受理）accepted →（编方案转履约）converted；submitted →（驳回）rejected /（撤回）withdrawn
 */
export default function OrderDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const st = useStore()
  const order = st.orders.find((o) => o.id === id)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  const [withdrawReason, setWithdrawReason] = useState('')
  const [ofdOpen, setOfdOpen] = useState(false)
  const [msgApi, contextHolder] = message.useMessage()
  const me = st.currentHu()

  if (!order) {
    return (
      <div className="page">
        <Card>
          <Alert type="error" showIcon message={`找不到单据 ${id}`} description="可能已被删除或链接有误"
            action={<Button onClick={() => nav('/orders')}>返回列表</Button>} />
        </Card>
      </div>
    )
  }

  const requester = st.huById(order.requesterHuId)
  const reqDu = st.duById(order.requesterDuId)
  const ofd = st.ofds.find((f) => f.id === order.ofdId)
  const jobs = st.jobs.filter((j) => j.orderId === order.id)
  const myDuText = st.currentDu().name
  // 受理处置权限：目标 DU 成员（接单方编制履约方案），或履约调度中心成员。
  // 🔴 发单方所在 DU ≠ 受理方：需求发出去就是请别人履约，发单人不能自己受理自己（权限矩阵 M2-3）
  const isTargetDu = !!order.targetDuId && order.targetDuId === me.duId
  const isTargetHu = !!order.targetHuId && order.targetHuId === me.id
  const isDispatch = me.duId === 'DDU01' // 履约调度中心兜底受理
  const isRequester = order.requesterHuId === me.id
  const canHandle = order.status === 'submitted' && (isTargetDu || isTargetHu || isDispatch)
  const canWithdraw = order.status === 'submitted' && isRequester // 撤回：仅发单人、仅待受理时

  return (
    <div className="page">
      {contextHolder}
      <Space style={{ marginBottom: 12 }}>
        <Button onClick={() => nav('/orders')}>← 返回列表</Button>
      </Space>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <h1 className="page-title" style={{ margin: 0 }}>
          <span className="mono">{order.id}</span> · {order.title}
        </h1>
        <Tag color={ORDER_STATUS[order.status].color} style={{ fontSize: 13, padding: '4px 12px' }}>
          {ORDER_STATUS[order.status].label}
        </Tag>
      </div>

      <div className="stack">
        <Card size="small" title="需求内容">
          <Descriptions column={2} size="small">
            <Descriptions.Item label="发单人">{requester?.name}（{requester?.title}）</Descriptions.Item>
            <Descriptions.Item label="发单DU">{reqDu && <Tag color={DU_TYPE_META[reqDu.type].color}>{reqDu.name}</Tag>}</Descriptions.Item>
            <Descriptions.Item label="派给">
              {order.targetDuId
                ? duTagOf(order.targetDuId)
                : <span>{st.huById(order.targetHuId)?.name}（指定到人）</span>}
            </Descriptions.Item>
            <Descriptions.Item label="期望完成"><span className="mono">{order.expectDate}</span></Descriptions.Item>
            <Descriptions.Item label="附件" span={2}>
              {order.attachments.length ? order.attachments.join('、') : '无'}
            </Descriptions.Item>
          </Descriptions>
          <div style={{ background: '#FAFAFA', borderRadius: 6, padding: 12, marginTop: 8, whiteSpace: 'pre-wrap', fontSize: 13 }}>
            {order.desc}
          </div>
        </Card>

        {ofd && (
          <Card size="small" title="关联履约单" extra={<Link to={`/ofd/${ofd.id}`}>查看 →</Link>}>
            <Space wrap>
              <span className="mono">{ofd.id}</span>
              <Tag>{ofd.deliverables.length} 项交付物</Tag>
              <Tag>承诺 {ofd.promiseDate}</Tag>
              {jobs.map((j) => (
                <Link key={j.id} to={`/job/${j.id}`} className="mono">{j.id}</Link>
              ))}
            </Space>
          </Card>
        )}

        {order.status === 'submitted' && !canHandle && (
          <Card size="small" title="受理处置">
            <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.45)' }}>
              本单待接单方（{order.targetDuId ? st.duById(order.targetDuId)?.name ?? '目标 DU' : st.huById(order.targetHuId)?.name ?? '指定接单人'}）受理，你（{me.name} · {myDuText}）暂无受理权限
            </div>
          </Card>
        )}

        {order.status === 'submitted' && canHandle && (
          <Card size="small" title="受理处置（接单方 DU / 履约调度）">
            <Alert
              type="info" showIcon style={{ marginBottom: 12 }}
              message="受理 = 明确接下这单（发单人会收到通知）；随后再编履约方案定「交付什么、何时交、按什么标准验收」。驳回 = 明确不接，须填理由。"
            />
            <Space>
              <Button type="primary" onClick={async () => { try { await st.acceptOrder(order.id); msgApi.success('已受理，发单人已收到通知；接下来编制履约方案') } catch (e:any) { msgApi.error(e?.message || '受理失败') } }}>受理</Button>
              <Button danger onClick={() => setRejectOpen(true)}>驳回</Button>
            </Space>
          </Card>
        )}

        {order.status === 'accepted' && (isTargetDu || isTargetHu || isDispatch) && (
          <Card size="small" title="编制履约方案（已受理，进入履约编排）">
            <Alert
              type="info" showIcon style={{ marginBottom: 12 }}
              message="先定「交付物清单 + 验收标准 + 承诺时间」，生成履约单后自动拆第一张工单派发，本需求单随之转为「已转履约」。"
            />
            <Button type="primary" onClick={() => setOfdOpen(true)}>编制履约方案并转履约</Button>
          </Card>
        )}

        {/* 已受理但当前身份无操作权：显示等待态（方案由受理方编） */}
        {order.status === 'accepted' && !(isTargetDu || isTargetHu || isDispatch) && (
          <Card size="small" title="履约编排中">
            <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.45)' }}>
              接单方已受理，正在编制履约方案（交付物清单 + 验收标准 + 承诺时间），编好后本单转为「已转履约」。
            </div>
          </Card>
        )}

        {/* 发单人撤回：仅待受理状态可撤 */}
        {canWithdraw && (
          <Card size="small" title="发单人操作">
            <Space>
              <Button onClick={() => { setWithdrawReason(''); setWithdrawOpen(true) }}>撤回需求</Button>
              <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)' }}>对方受理/驳回后不可撤；撤回须填理由，目标方会收到通知</span>
            </Space>
          </Card>
        )}

        <Card size="small" title="全链路轨迹">
          <Timeline
            items={order.trace.map((t) => ({
              children: (
                <div>
                  <span className="mono" style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginRight: 8 }}>{t.time}</span>
                  <b style={{ fontSize: 13 }}>{t.actor}</b> · {t.action}
                  {t.detail && <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)', marginLeft: 2 }}>{t.detail}</div>}
                </div>
              ),
            }))}
          />
        </Card>
      </div>

      <Modal
        title={`驳回 ${order.id}`}
        open={rejectOpen}
        onOk={async () => {
          if (!rejectReason.trim()) { msgApi.warning('驳回必须填写理由'); return }
          try {
            await st.rejectOrder(order.id, rejectReason)
            setRejectOpen(false)
            msgApi.success('已驳回，理由已留痕')
          } catch (e: any) { msgApi.error(e?.message || '操作失败') }
        }}
        okText="确认驳回" okButtonProps={{ danger: true }}
        cancelText="取消"
      >
        <Input.TextArea rows={3} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="驳回理由必填（无理由驳回 = 路由规则永远学不会）" />
      </Modal>

      <Modal
        title={`撤回 ${order.id}`}
        open={withdrawOpen}
        onOk={async () => {
          if (!withdrawReason.trim()) { msgApi.warning('撤回必须填写理由'); return }
          try {
            await st.withdrawOrder(order.id, withdrawReason)
            setWithdrawOpen(false)
            msgApi.info('已撤回，目标方已收到通知')
          } catch (e: any) { msgApi.error(e?.message || '操作失败') }
        }}
        okText="确认撤回"
        cancelText="取消"
      >
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="撤回后本单终结为「已撤回」，对方无需处理；重新需要时请另发新单。" />
        <Input.TextArea rows={3} value={withdrawReason} onChange={(e) => setWithdrawReason(e.target.value)} placeholder="如：需求描述有误，重新梳理后再发 / 此事已线下解决" />
      </Modal>

      <OfdCreate
        open={ofdOpen}
        onClose={() => setOfdOpen(false)}
        orderId={order.id}
        defaultTitle={order.title}
        expectDate={order.expectDate}
      />
    </div>
  )
}

function duTagOf(duId: string) {
  const du = useStore.getState().duById(duId)
  return du ? <Tag color={DU_TYPE_META[du.type].color}>{du.name}</Tag> : <Tag>—</Tag>
}
