import { useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import {
  Card, Descriptions, Tag, Timeline, Button, Input, Modal, Space, Alert, message,
  Slider, Upload, Popconfirm, Steps, Select,
} from 'antd'
import { UploadOutlined } from '@ant-design/icons'
import { useStore } from '../store'
import { DU_TYPE_META, JOB_STATUS } from '../types'
import { useIsMobile } from '../components/responsive'

/** 工单详情：接单/拒单/认领/报进度/受阻/交物/转派/中止 —— 执行层全部操作（PRD M4/M5/M6）
 *  「认领」（claimJob，先到先得）由列表页后续版本按需启用，store 已备好动作
 */
export default function JobDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const st = useStore()
  const job = st.jobs.find((j) => j.id === id)
  const [msgApi, contextHolder] = message.useMessage()
  const me = st.currentHu()
  const myDu = st.currentDu()
  const isMobile = useIsMobile()

  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [acceptOpen, setAcceptOpen] = useState(false)
  const [promiseDate, setPromiseDate] = useState('')
  const [progOpen, setProgOpen] = useState(false)
  const [blockOpen, setBlockOpen] = useState(false)
  const [blockReason, setBlockReason] = useState('')
  const [dlvOpen, setDlvOpen] = useState(false)
  const [termOpen, setTermOpen] = useState(false)
  const [termReason, setTermReason] = useState('')
  const [transferOpen, setTransferOpen] = useState(false)
  const [transferTo, setTransferTo] = useState<string | undefined>()
  const [transferReason, setTransferReason] = useState('')

  if (!job) {
    return (
      <div className="page"><Card><Alert type="error" showIcon message={`找不到工单 ${id}`}
        action={<Button onClick={() => nav('/jobs')}>返回列表</Button>} /></Card></div>
    )
  }

  const order = st.orders.find((o) => o.id === job.orderId)
  const ofd = st.ofds.find((f) => f.id === job.ofdId)
  const dispatchDu = st.duById(job.dispatchDuId ?? st.huById(job.dispatchHuId)?.duId)
  const assigneeDu = st.duById(st.huById(job.assigneeHuId)?.duId)

  // 我能不能操作这张单
  const canAccept = job.status === 'waitAccept' && (job.dispatchHuId === me.id || job.dispatchDuId === me.duId)
  const isAssignee = job.assigneeHuId === me.id && ['working', 'blocked', 'rework', 'done'].includes(job.status)

  const stepIndex: Record<string, number> = {
    waitAccept: 0, accepted: 1, working: 2, blocked: 2, rework: 2, done: 3, waitCheck: 3, closed: 4,
  }

  return (
    <div className="page">
      {contextHolder}
      <Space style={{ marginBottom: 12 }}>
        <Button onClick={() => nav('/jobs')}>← 返回列表</Button>
      </Space>
      <div className="row detail-head" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <h1 className="page-title" style={{ margin: 0 }}>
          <span className="mono">{job.id}</span> · {job.title}
          {job.isDirect && <Tag style={{ marginLeft: 10 }} color="default">直发 · 通路B</Tag>}
        </h1>
        <Tag color={JOB_STATUS[job.status].color} style={{ fontSize: 13, padding: '4px 12px' }}>{JOB_STATUS[job.status].label}</Tag>
      </div>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Steps
          size="small"
          current={stepIndex[job.status] ?? 0}
          status={job.status === 'blocked' ? 'error' : job.status === 'rework' ? 'error' : undefined}
          items={[
            { title: '派单' },
            { title: '接单' },
            { title: '执行交付' },
            { title: '验收' },
            { title: '关闭' },
          ]}
        />
      </Card>

      <div className="stack">
        <Card size="small" title="工单要素">
          <Descriptions column={isMobile ? 1 : 2} size="small">
            <Descriptions.Item label="派给DU">{dispatchDu ? <Tag color={DU_TYPE_META[dispatchDu.type].color}>{dispatchDu.name}</Tag> : '—'}</Descriptions.Item>
            <Descriptions.Item label="责任人">{st.huById(job.assigneeHuId)?.name ?? <span style={{ color: 'rgba(0,0,0,0.35)' }}>待接单</span>}{assigneeDu ? `（${assigneeDu.name}）` : ''}</Descriptions.Item>
            <Descriptions.Item label="承诺完成">
              <span className="mono">{job.promiseDate}</span>
              {job.promiseOriginal && job.promiseOriginal !== job.promiseDate && (
                <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginTop: 2 }}>
                  接单反填，原承诺 <span className="mono">{job.promiseOriginal}</span> 留痕
                </div>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="进度"><span className="mono">{job.progress}%</span>{job.reworkCount > 0 && <Tag color="volcano" style={{ marginLeft: 8 }}>返工 {job.reworkCount} 次</Tag>}</Descriptions.Item>
            <Descriptions.Item label="来源" span={2}>
              {ofd ? <Link to={`/ofd/${ofd.id}`} className="mono">{ofd.id}</Link> : '直发（无上游单据）'}
              {order && <> · <Link to={`/order/${order.id}`} className="mono">{order.id}</Link></>}
            </Descriptions.Item>
          </Descriptions>
          {job.blockedReason && (
            <Alert style={{ marginTop: 8 }} type="error" showIcon message={`受阻：${job.blockedReason}`}
              description="受阻期间超时判定暂停，不计接单方责任" />
          )}
          <div style={{ background: '#FAFAFA', borderRadius: 6, padding: 12, marginTop: 8, whiteSpace: 'pre-wrap', fontSize: 13 }}>{job.desc}</div>
        </Card>

        {/* 操作区：按身份与状态显隐（权限矩阵的可视表达） */}
        <Card size="small" title="操作">
          {canAccept && (
            <Space wrap className="op-actions" style={isMobile ? { width: '100%' } : undefined}>
              <Button type="primary" onClick={() => { setPromiseDate(job.promiseDate); setAcceptOpen(true) }}>接单</Button>
              <Button danger onClick={() => setRejectOpen(true)}>拒单</Button>
              <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)', flex: '1 1 100%' }}>接单后你就是本单责任人（锁定到人），超时与考核计到你头上</span>
            </Space>
          )}
          {canAccept && job.status === 'waitAccept' && job.dispatchDuId === me.duId && !job.dispatchHuId && (
            <div style={{ marginTop: 8, fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>
              本单派给你所在 DU：任意成员先接先得，接单即锁定责任人
            </div>
          )}
          {isAssignee && (
            <Space wrap className="op-actions" style={isMobile ? { width: '100%' } : undefined}>
              {job.status === 'blocked' ? (
                <Button type="primary" onClick={() => { void st.unblockJob(job.id).catch((e) => msgApi.error(e?.message || '操作失败')) }}>解除受阻</Button>
              ) : (
                <Button type="primary" onClick={() => setProgOpen(true)}>报进度</Button>
              )}
              <Button onClick={() => setBlockOpen(true)}>报受阻</Button>
              <Button onClick={() => setDlvOpen(true)}>提交交付物</Button>
              <Button onClick={() => { setTransferTo(undefined); setTransferReason(''); setTransferOpen(true) }}>转派</Button>
              <Popconfirm title="确定申请中止？" description="中止需填理由留痕；已完工的单不能中止" onConfirm={() => setTermOpen(true)}>
                <Button danger type="text">申请中止</Button>
              </Popconfirm>
            </Space>
          )}
          {!canAccept && !isAssignee && (
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)' }}>
              当前身份（{me.name} · {myDu.name}）对本单无操作权限：操作区只对「被派单人/责任人」开放
            </div>
          )}
        </Card>

        <Card size="small" title={`交付物（${job.deliverables.length}）`}>
          {job.deliverables.length === 0 ? (
            <div style={{ color: 'rgba(0,0,0,0.4)', fontSize: 13, padding: '8px 0' }}>
              还没有交付物 —— 完工时由责任人提交，验收按此逐项过
            </div>
          ) : (
            <Space direction="vertical" style={{ width: '100%' }}>
              {job.deliverables.map((d, i) => (
                <div key={i} className="row dlv-item" style={{ justifyContent: 'space-between', background: '#FAFAFA', borderRadius: 6, padding: '8px 12px' }}>
                  <span>📎 {d.name} <span style={{ color: 'rgba(0,0,0,0.4)', fontSize: 12 }}>({d.file})</span></span>
                  <span className="mono" style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>{d.at}</span>
                </div>
              ))}
            </Space>
          )}
        </Card>

        <Card size="small" title="全链路轨迹">
          <Timeline
            items={job.trace.map((t) => ({
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

      {/* 接单弹窗：可反填承诺时间 */}
        <Modal title={`接单 · ${job.id}`} open={acceptOpen} onCancel={() => setAcceptOpen(false)}
        onOk={async () => {
          try {
            await st.acceptJob(job.id, promiseDate !== job.promiseDate ? promiseDate : undefined)
            setAcceptOpen(false)
            msgApi.success('已接单，你成为本单责任人；发单方已收到通知')
          } catch (e: any) { msgApi.error(e?.message || '接单失败') }
        }} okText="确认接单">
        <div style={{ marginBottom: 12, fontSize: 13 }}>承诺完成时间（认为期限不现实可在此反填，原值留痕）</div>
        {job.promiseOriginal && (
          <div style={{ marginBottom: 8, fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>当前承诺：<span className="mono">{job.promiseDate}</span>{job.promiseOriginal !== job.promiseDate && <>（原 {job.promiseOriginal}）</>}</div>
        )}
        <Input value={promiseDate} onChange={(e) => setPromiseDate(e.target.value)} style={{ width: 200 }} className="mono" />
      </Modal>

      <Modal title={`拒单 · ${job.id}`} open={rejectOpen} onCancel={() => setRejectOpen(false)}
        okText="确认拒单" okButtonProps={{ danger: true }} cancelText="取消"
        onOk={async () => {
          if (!rejectReason.trim()) { msgApi.warning('拒单理由必填（无理由拒单 = 路由规则永远学不会）'); return }
          try {
            await st.rejectJob(job.id, rejectReason)
            setRejectOpen(false)
            msgApi.info('已拒单，单据回到待派状态')
          } catch (e: any) { msgApi.error(e?.message || '操作失败') }
        }}>
        <Input.TextArea rows={3} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="如：本周产能已满 / 非本组职责范围" />
      </Modal>

      <Modal title={`报进度 · ${job.id}`} open={progOpen} onCancel={() => setProgOpen(false)} footer={null}>
        <ProgressForm jobId={job.id} onClose={() => setProgOpen(false)} />
      </Modal>

      <Modal title={`报受阻 · ${job.id}`} open={blockOpen} onCancel={() => setBlockOpen(false)}
        okText="提交受阻" cancelText="取消"
        onOk={async () => {
          if (!blockReason.trim()) { msgApi.warning('受阻原因必填'); return }
          try {
            await st.blockJob(job.id, blockReason)
            setBlockOpen(false)
            msgApi.warning('已报受阻：超时判定暂停，平台运营会看到此单')
          } catch (e: any) { msgApi.error(e?.message || '操作失败') }
        }}>
        <Input.TextArea rows={3} value={blockReason} onChange={(e) => setBlockReason(e.target.value)} placeholder="如：等客户提供门店网络权限 / 等供应商到货" />
      </Modal>

      <Modal title={`提交交付物 · ${job.id}`} open={dlvOpen} onCancel={() => setDlvOpen(false)} footer={null} width={520}>
        <DeliverForm jobId={job.id} onClose={() => { setDlvOpen(false); msgApi.success('交付物已提交，进入待验收') }} />
      </Modal>

      <Modal title={`转派工单 · ${job.id}`} open={transferOpen} onCancel={() => setTransferOpen(false)}
        okText="确认转派" okButtonProps={{ disabled: !transferTo }} cancelText="取消"
        onOk={async () => {
          if (!transferTo) return
          try {
            await st.transferJob(job.id, transferTo, transferReason)
            setTransferOpen(false)
            msgApi.success(`已转派给 ${st.huById(transferTo)?.name}，进度与承诺时间不变，对方已收到通知`)
          } catch (e: any) { msgApi.error(e?.message || '转派失败') }
        }}>
        <Alert type="info" showIcon style={{ marginBottom: 12 }}
          message="转派用于责任人请假 / 离职 / 工作调整：进度、承诺时间、轨迹全部保留，仅责任人切换。" />
        <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 600 }}>转给谁（限同 DU 成员）</div>
        <Select
          style={{ width: '100%', marginBottom: 12 }} placeholder="选择新责任人"
          showSearch optionFilterProp="label" value={transferTo} onChange={setTransferTo}
          options={st.hus.filter((h) => h.duId === (job.dispatchDuId ?? st.huById(job.assigneeHuId)?.duId) && h.id !== job.assigneeHuId).map((h) => ({ value: h.id, label: `${h.name} · ${h.title}` }))}
        />
        <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 600 }}>转派理由（必填，留痕）</div>
        <Input.TextArea rows={2} value={transferReason} onChange={(e) => setTransferReason(e.target.value)}
          placeholder="如：本周外出驻场，转给同组同事跟进" />
      </Modal>

      <Modal title={`中止工单 · ${job.id}`} open={termOpen} onCancel={() => setTermOpen(false)}
        okText="确认中止" okButtonProps={{ danger: true }} cancelText="取消"
        onOk={async () => {
          if (!termReason.trim()) { msgApi.warning('中止理由必填'); return }
          try {
            await st.terminateJob(job.id, termReason)
            setTermOpen(false)
            msgApi.info('已中止，理由留痕')
          } catch (e: any) { msgApi.error(e?.message || '操作失败') }
        }}>
        <Input.TextArea rows={3} value={termReason} onChange={(e) => setTermReason(e.target.value)} placeholder="如：需求已并入其他工单" />
      </Modal>
    </div>
  )
}

function ProgressForm({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const st = useStore()
  const [msgApi, holder] = message.useMessage()
  const job = st.jobs.find((j) => j.id === jobId)!
  const [val, setVal] = useState(job.progress >= 100 ? 100 : Math.max(job.progress, 10))
  const [note, setNote] = useState('')
  return (
    <div>
      {holder}
      <Slider value={val} onChange={setVal} min={5} max={100} step={5} marks={{ 25: '25%', 50: '50%', 75: '75%', 100: '完工' }} />
      <Input.TextArea rows={2} style={{ margin: '12px 0' }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="进展说明（如：已到场，复现死机 1 次）" />
      <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button onClick={onClose}>取消</Button>
        <Button type="primary" onClick={async () => { try { await st.updateProgress(jobId, val, note); onClose() } catch (e: any) { msgApi.error(e?.message || '提交失败') } }}>
          {val >= 100 ? '报完工' : '更新进度'}
        </Button>
      </Space>
    </div>
  )
}

function DeliverForm({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const st = useStore()
  const [msgApi, holder] = message.useMessage()
  const [name, setName] = useState('')
  const [file, setFile] = useState('')
  return (
    <div>
      {holder}
      <Input style={{ marginBottom: 12 }} placeholder="交付物名称（如：故障诊断报告）" value={name} onChange={(e) => setName(e.target.value)} />
      <Upload maxCount={1} beforeUpload={(f) => { setFile(f.name); return false }} >
        <Button icon={<UploadOutlined />}>选择文件（mock）</Button>
      </Upload>
      <Space style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <Button onClick={onClose}>取消</Button>
        <Button type="primary" disabled={!name.trim()}
          onClick={async () => { try { await st.submitDeliverable(jobId, name, file || '现场照片集.zip'); onClose() } catch (e: any) { msgApi.error(e?.message || '提交失败') } }}>
          提交并转待验收
        </Button>
      </Space>
    </div>
  )
}
