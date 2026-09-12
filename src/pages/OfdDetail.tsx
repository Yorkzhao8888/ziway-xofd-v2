import { useState, useEffect } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { Card, Descriptions, Tag, Timeline, Button, Input, Table, Alert, message, Space, Modal, Select, DatePicker, Statistic } from 'antd'
import { CheckOutlined, CloseOutlined, PlusOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useStore } from '../store'
import { DU_TYPE_META, OFD_STATUS, ORDER_STATUS, JOB_STATUS } from '../types'
import { parseLocal } from '../core/time'
import { useIsMobile, MobileCard, MobileField, MobileList, StatusTag } from '../components/responsive'

/** 履约单详情：逐项验收（M6-1/2/3）+ 全部通过自动关单（M6-5） */
export default function OfdDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const st = useStore()
  const ofd = st.ofds.find((f) => f.id === id)
  const [msgApi, contextHolder] = message.useMessage()
  const [comments, setComments] = useState<Record<string, string>>({})
  const me = st.currentHu()
  const isMobile = useIsMobile()
  const [addJobOpen, setAddJobOpen] = useState(false)
  const [addJobDu, setAddJobDu] = useState<string | undefined>()
  const [addJobHu, setAddJobHu] = useState<string | undefined>()
  const [addJobScope, setAddJobScope] = useState<string>('')

  // 48h 自动验收倒计时（仅待验收状态显示）
  const awaitDue = ofd?.awaitSince
    ? parseLocal(ofd.awaitSince) + 48 * 3600 * 1000
    : null
  const hoursLeft = awaitDue ? Math.max(0, (awaitDue - Date.now()) / 3600 / 1000) : null
  // 48h 自动验收由服务端惰性触发；进入待验收履约单时刷新详情
  useEffect(() => {
    if (ofd?.status === 'awaitAccept') {
      st.refresh().catch(() => {})
    }
  }, [ofd?.id, ofd?.status])

  if (!ofd) {
    return (
      <div className="page"><Card><Alert type="error" showIcon message={`找不到履约单 ${id}`}
        action={<Button onClick={() => nav('/ofds')}>返回列表</Button>} /></Card></div>
    )
  }

  const order = st.orders.find((o) => o.id === ofd.orderId)
  const jobs = st.jobs.filter((j) => j.ofdId === ofd.id)
  const allPass = ofd.deliverables.length > 0 && ofd.deliverables.every((d) => d.result === 'pass')
  const anyFail = ofd.deliverables.some((d) => d.result === 'fail')
  const isOwner = ofd.ownerDuId === me.duId

  const check = async (delivId: string, result: 'pass' | 'fail') => {
    const comment = comments[delivId] ?? ''
    if (!comment.trim()) {
      msgApi.warning('验收意见必填 —— 防止随手点通过（PRD M6-2）')
      return
    }
    try {
      await st.checkDeliverable(ofd.id, delivId, result, comment)
      setComments({ ...comments, [delivId]: '' })
      if (result === 'fail') {
        msgApi.warning('已退回：关联工单进入返工，返工次数 +1')
      } else {
        msgApi.success('该项验收通过')
      }
    } catch (e: any) {
      msgApi.error(e?.message || '验收失败')
    }
  }

  return (
    <div className="page">
      {contextHolder}
      <Space style={{ marginBottom: 12 }}>
        <Button onClick={() => nav('/ofds')}>← 返回列表</Button>
      </Space>
      <div className="row detail-head" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <h1 className="page-title" style={{ margin: 0 }}>
          <span className="mono">{ofd.id}</span> · {ofd.title}
        </h1>
        <Tag color={OFD_STATUS[ofd.status].color} style={{ fontSize: 13, padding: '4px 12px' }}>{OFD_STATUS[ofd.status].label}</Tag>
      </div>

      <div className="stack">
        <Card size="small" title="履约要素" extra={
          ofd.status !== 'closed' && ofd.status !== 'revoked' && (
            <Button size="small" icon={<PlusOutlined />} onClick={() => setAddJobOpen(true)}>加派工单</Button>
          )
        }>
          <Descriptions column={isMobile ? 1 : 2} size="small">
            <Descriptions.Item label="来源需求单">
              {order ? <Link to={`/order/${order.id}`} className="mono">{order.id}</Link> : '—'}
            </Descriptions.Item>
            <Descriptions.Item label="编制DU">
              {(() => { const du = st.duById(ofd.ownerDuId); return du ? <Tag color={DU_TYPE_META[du.type].color}>{du.name}</Tag> : '—' })()}
            </Descriptions.Item>
            <Descriptions.Item label="承诺完成"><span className="mono">{ofd.promiseDate}</span></Descriptions.Item>
            <Descriptions.Item label="关联工单">
              {jobs.length ? <span className="mono">{jobs.length} 张</span> : '未派'}
            </Descriptions.Item>
          </Descriptions>
          {ofd.status === 'awaitAccept' && hoursLeft !== null && (
            <Alert
              type="warning" showIcon style={{ marginTop: 8 }}
              message={`48h 自动验收倒计时：剩余 ${hoursLeft.toFixed(1)} 小时（${ofd.awaitSince} 起计）。到期未验收，系统自动通过全部交付物并关单 —— 验收是义务非权力`}
            />
          )}
        </Card>

        {/* 派出的工单（M3：一张履约单可拆多张工单）—— 完整台账：接单/进度/交付物/红灯一屏看清 */}
        <Card size="small" title={`派出的工单（${jobs.length}）`}>
          {jobs.length === 0 ? (
            <div style={{ color: 'rgba(0,0,0,0.4)', fontSize: 13, padding: '8px 0' }}>
              还没有派出工单 —— 点右上角「加派工单」拆单派发
            </div>
          ) : isMobile ? (
            <MobileList
              items={jobs}
              renderItem={(r: any) => {
                const du = st.duById(r.dispatchDuId ?? st.huById(r.dispatchHuId)?.duId)
                return (
                  <MobileCard
                    title={<>
                      <span className="mono" style={{ fontSize: 12, color: '#FF6B35' }}>{r.id}</span>
                      <div>{r.title}</div>
                    </>}
                    titleTo={`/job/${r.id}`}
                    badge={<StatusTag color={JOB_STATUS[r.status as keyof typeof JOB_STATUS]?.color}>{JOB_STATUS[r.status as keyof typeof JOB_STATUS]?.label}</StatusTag>}
                    fields={
                      <>
                        <MobileField label="派给">{du ? <Tag color={DU_TYPE_META[du.type].color}>{du.name}</Tag> : '—'}</MobileField>
                        <MobileField label="责任人">{st.huById(r.assigneeHuId)?.name ?? <span style={{ color: 'rgba(0,0,0,0.35)' }}>未接单</span>}</MobileField>
                        <MobileField label="进度" mono>{r.progress}% · 交付物 {r.deliverables.length}</MobileField>
                      </>
                    }
                  />
                )
              }}
            />
          ) : (
            <Table
              size="small" rowKey="id" pagination={false}
              dataSource={jobs}
              columns={[
                {
                  title: '工单号', dataIndex: 'id', width: 150,
                  render: (v: string, r: any) => <Link to={`/job/${r.id}`} className="mono">{v}</Link>,
                },
                {
                  title: '标题', dataIndex: 'title', ellipsis: true,
                  render: (v: string, r: any) => <Link to={`/job/${r.id}`} style={{ color: 'inherit' }}>{v}</Link>,
                },
                {
                  title: '派给', key: 'dispatch', width: 190,
                  render: (_v, r: any) => {
                    const du = st.duById(r.dispatchDuId ?? st.huById(r.dispatchHuId)?.duId)
                    return du ? <Tag color={DU_TYPE_META[du.type].color}>{du.name}</Tag> : '—'
                  },
                },
                {
                  title: '责任人', key: 'assignee', width: 90,
                  render: (_v, r: any) => st.huById(r.assigneeHuId)?.name ?? <span style={{ color: 'rgba(0,0,0,0.35)' }}>未接单</span>,
                },
                { title: '进度', dataIndex: 'progress', width: 80, className: 'mono', render: (v: number) => `${v}%` },
                {
                  title: '交付物', key: 'dlv', width: 80,
                  render: (_v, r: any) => <span className="mono">{r.deliverables.length}</span>,
                },
                {
                  title: '状态', dataIndex: 'status', width: 100,
                  render: (v: keyof typeof JOB_STATUS) => <Tag color={JOB_STATUS[v]?.color}>{JOB_STATUS[v]?.label}</Tag>,
                },
              ] as any}
            />
          )}
        </Card>

        <Card size="small" title="交付物逐项验收">
          {ofd.status === 'awaitAccept' && isOwner && (
            <Alert
              type="warning" showIcon style={{ marginBottom: 12 }}
              message="验收意见必填；全部通过将自动关闭本单及关联工单；超 48 小时未验收系统自动通过"
            />
          )}
          {anyFail && (
            <Alert type="error" showIcon style={{ marginBottom: 12 }} message="存在退回项：关联工单已进入返工" />
          )}
          {isMobile ? (
            <MobileList
              items={ofd.deliverables}
              renderItem={(r: any) => (
                <MobileCard
                  title={r.name}
                  badge={r.result === 'pass' ? <StatusTag color="success">通过</StatusTag> : r.result === 'fail' ? <StatusTag color="error">退回</StatusTag> : <StatusTag>待验</StatusTag>}
                  fields={
                    <>
                      <MobileField label="标准">{r.standard}</MobileField>
                      <MobileField label="意见">{r.comment || '—'}</MobileField>
                      {ofd.status === 'awaitAccept' && isOwner && (
                        <div style={{ marginTop: 8 }}>
                          <Input.TextArea
                            rows={2}
                            placeholder="验收意见（必填）"
                            value={comments[r.id] ?? ''}
                            onChange={(e) => setComments({ ...comments, [r.id]: e.target.value })}
                            style={{ marginBottom: 8 }}
                          />
                          <Space style={{ width: '100%' }} className="op-actions">
                            <Button style={{ flex: 1, minHeight: 44 }} type="primary" icon={<CheckOutlined />} onClick={() => check(r.id, 'pass')}>通过</Button>
                            <Button style={{ flex: 1, minHeight: 44 }} danger icon={<CloseOutlined />} onClick={() => check(r.id, 'fail')}>退回</Button>
                          </Space>
                        </div>
                      )}
                    </>
                  }
                />
              )}
            />
          ) : (
          <Table
            size="small" rowKey="id" pagination={false}
            dataSource={ofd.deliverables}
            columns={[
              { title: '交付物', dataIndex: 'name', width: 200 },
              { title: '验收标准', dataIndex: 'standard', ellipsis: true },
              {
                title: '结果', dataIndex: 'result', width: 90,
                render: (v) => v === 'pass' ? <Tag color="success">通过</Tag> : v === 'fail' ? <Tag color="error">退回</Tag> : <Tag>待验</Tag>,
              },
              { title: '意见', dataIndex: 'comment', ellipsis: true, render: (v) => v || '—' },
              ...(ofd.status === 'awaitAccept' && isOwner ? [{
                title: '验收操作', width: 300, render: (_v: any, r: any) => (
                  <Space.Compact style={{ width: '100%' }}>
                    <Input
                      size="small" placeholder="验收意见（必填）"
                      value={comments[r.id] ?? ''}
                      onChange={(e) => setComments({ ...comments, [r.id]: e.target.value })}
                    />
                    <Button size="small" type="primary" icon={<CheckOutlined />} onClick={() => check(r.id, 'pass')} />
                    <Button size="small" danger icon={<CloseOutlined />} onClick={() => check(r.id, 'fail')} />
                  </Space.Compact>
                ),
              }] : []),
            ] as any}
          />
          )}
        </Card>

        <Card size="small" title="履约轨迹">
          <Timeline
            items={ofd.trace.map((t) => ({
              children: (
                <div>
                  <span className="mono" style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginRight: 8 }}>{t.time}</span>
                  <b style={{ fontSize: 13 }}>{t.actor}</b> · {t.action}
                  {t.detail && <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>{t.detail}</div>}
                </div>
              ),
            }))}
          />
        </Card>
      </div>

      {/* 加派工单弹窗（PRD M3：一张履约单可拆多张工单） */}
      <Modal
        title={`加派工单 · ${ofd.id}`}
        open={addJobOpen}
        onCancel={() => setAddJobOpen(false)}
        okText="派 出"
        okButtonProps={{ disabled: !addJobDu }}
        onOk={async () => {
          try {
            const job = await st.createJob({
              ofdId: ofd.id, orderId: ofd.orderId,
              title: addJobScope.trim() ? `${ofd.title.replace(/履约方案$/, '')} · ${addJobScope.trim()}` : `${ofd.title.replace(/履约方案$/, '')}（加派）`,
              desc: addJobScope.trim() ? `加派工单，范围：${addJobScope.trim()}。原需求：${order?.desc ?? ''}` : `加派工单（未填范围），原需求：${order?.desc ?? ''}`,
              dispatchDuId: addJobDu, dispatchHuId: addJobHu,
              promiseDate: ofd.promiseDate, dueHours: 24,
            })
            setAddJobOpen(false); setAddJobDu(undefined); setAddJobHu(undefined); setAddJobScope('')
            msgApi.success(`已加派 ${job.id}，对方接单后即可开工`)
          } catch (e: any) {
            msgApi.error(e?.message || '派单失败')
          }
        }}
      >
        <Alert type="info" showIcon style={{ marginBottom: 12 }}
          message="一张履约单可拆多张工单（如分区域 / 分批次执行）。各工单独立接单、独立交物，验收仍回到本履约单逐项过。" />
        <div style={{ marginBottom: 8, fontWeight: 600, fontSize: 13 }}>派给谁</div>
        <Select
          style={{ width: '100%', marginBottom: 12 }} placeholder="选择接单 DU"
          value={addJobDu}
          onChange={(v) => { setAddJobDu(v); setAddJobHu(undefined) }}
          options={st.dus.filter((d) => d.id !== ofd.ownerDuId).map((d) => ({ value: d.id, label: `${d.name}（${DU_TYPE_META[d.type].label}DU）` }))}
        />
        {addJobDu && (
          <Select
            style={{ width: '100%', marginBottom: 12 }} placeholder="指定到人（可选，留空则 DU 内先接先得）"
            allowClear value={addJobHu}
            onChange={setAddJobHu}
            showSearch optionFilterProp="label"
            options={st.hus.filter((h) => h.duId === addJobDu).map((h) => ({ value: h.id, label: `${h.name} · ${h.title}` }))}
          />
        )}
        <div style={{ marginBottom: 8, fontWeight: 600, fontSize: 13 }}>本单执行范围（可选）</div>
        <Input.TextArea rows={2} value={addJobScope} onChange={(e) => setAddJobScope(e.target.value)}
          placeholder="如：仅科技园 + 软件园两家门店 / 仅 10 月第一批次" />
        <div style={{ marginTop: 8, fontSize: 12, color: 'rgba(0,0,0,0.4)' }}>承诺时间默认继承履约单（{ofd.promiseDate}），接单方可反填协商。</div>
      </Modal>
    </div>
  )
}
