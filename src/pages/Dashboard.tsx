import { Card, Col, Row, Statistic, Table, Tag, List, Alert } from 'antd'
import { Link, useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { DU_TYPE_META, JOB_STATUS, ORDER_STATUS, OFD_STATUS } from '../types'
import { duTag, huName } from '../components/common'
import { REDLIGHT_DEFS, jobRedLights } from '../core/redlights'
import { useIsMobile, MobileCard, MobileField, MobileList, StatusTag } from '../components/responsive'

/** 工作台：登录第一屏，行动指向明确（标准 §6.3 关键路径起点） */
export default function DashboardPage() {
  const st = useStore()
  const me = st.currentHu()
  const myDu = st.currentDu()
  const navigate = useNavigate()
  const isMobile = useIsMobile()

  const myJobs = st.jobs.filter((j) =>
    j.assigneeHuId === me.id ||
    (j.assigneeHuId === null && ((j.dispatchHuId === me.id) || (j.dispatchDuId === me.duId))),
  )
  const activeJobs = myJobs.filter((j) => !['closed', 'terminated', 'rejected', 'transferred'].includes(j.status))
  const mySent = st.orders.filter((o) => o.requesterHuId === me.id)
  const activeSent = mySent.filter((o) => !['closed', 'withdrawn', 'rejected'].includes(o.status))
  const toCheck = st.ofds.filter((f) => f.status === 'awaitAccept')
  const unreadMsgs = st.msgs.filter((m) => m.toHuId === me.id && !m.read)

  const dueSoon = activeJobs
    .filter((j) => j.assigneeHuId === me.id || myJobs.some((x) => x.id === j.id))
    .slice(0, 6)

  // 三红灯扫描（口径单点 core/redlights.ts；卡验收以 OFD.awaitSince 为准）
  const awaitSinceByOfd: Record<string, string | undefined> = {}
  st.ofds.forEach((f) => { if (f.awaitSince) awaitSinceByOfd[f.id] = f.awaitSince })
  const redRows = st.jobs
    .map((j) => ({
      job: j,
      lights: jobRedLights({
        status: j.status, createdAt: j.createdAt, assigneeHuId: j.assigneeHuId,
        progress: j.progress, trace: j.trace, ofdAwaitSince: j.ofdId ? awaitSinceByOfd[j.ofdId] : undefined,
      }),
    }))
    .filter((r) => r.lights.length > 0)
  const redStats = (['noAccept', 'idle', 'stuckCheck'] as const).map((k) => ({
    ...REDLIGHT_DEFS[k],
    count: redRows.filter((r) => r.lights.includes(k)).length,
  }))

  const statCards = [
    { title: '我手上在办的工单', value: activeJobs.filter((j) => j.assigneeHuId === me.id).length, suffix: '张' },
    { title: '我发出在途的需求', value: activeSent.length, suffix: '张' },
    { title: '待我验收的履约单', value: toCheck.filter((f) => f.ownerDuId === me.duId).length, suffix: '张' },
    { title: '未读消息', value: unreadMsgs.length, suffix: '条' },
  ]

  return (
    <div className="page">
      <h1 className="page-title">工作台</h1>
      <p className="page-sub">
        当前身份：<b>{me.name}</b>（{me.title}） · 归属 {myDu.name} —— 单据算 DU 的，操作与提醒落到你头上
      </p>

      <Row gutter={[12, 12]}>
        {statCards.map((c) => (
          <Col key={c.title} xs={12} sm={12} md={6}>
            <Card size="small"><Statistic title={c.title} value={c.value} suffix={c.suffix} /></Card>
          </Col>
        ))}
      </Row>

      {isMobile ? (
        <div className="stack" style={{ marginTop: 12 }}>
          <Card size="small" title="近期要动的工单" extra={<Link to="/todo">全部待办 →</Link>}
            styles={{ body: { padding: dueSoon.length ? 12 : 24 } }}>
            {dueSoon.length === 0 ? (
              <Alert type="info" showIcon message="暂时没有在办的工单" style={{ margin: 0 }} />
            ) : (
              <MobileList
                items={dueSoon}
                renderItem={(j: any) => (
                  <MobileCard
                    title={<>
                      <span className="mono" style={{ fontSize: 12, color: '#FF6B35' }}>{j.id}</span>
                      <div>{j.title}</div>
                    </>}
                    titleTo={`/job/${j.id}`}
                    badge={<StatusTag color={JOB_STATUS[j.status as keyof typeof JOB_STATUS]?.color}>{JOB_STATUS[j.status as keyof typeof JOB_STATUS]?.label}</StatusTag>}
                    fields={<MobileField label="承诺完成" mono>{j.promiseDate}</MobileField>}
                  />
                )}
              />
            )}
          </Card>

          <Card size="small" title="最新消息" extra={<Link to="/msgs">全部 →</Link>}
            styles={{ body: { padding: 12 } }}>
            {st.msgs.filter((m) => m.toHuId === me.id).slice(0, 5).length === 0 ? (
              <Alert type="info" showIcon message="暂无消息" style={{ margin: 0 }} />
            ) : (
              <List
                size="small"
                dataSource={st.msgs.filter((m) => m.toHuId === me.id).slice(0, 5)}
                renderItem={(m) => (
                  <List.Item
                    style={{ cursor: 'pointer', padding: '10px 2px', minHeight: 44, alignItems: 'center' }}
                    onClick={() => { st.markRead(m.id); navigate(m.link) }}
                  >
                    <div style={{ width: '100%' }}>
                      <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                        <span style={{ fontWeight: m.read ? 400 : 600, fontSize: 13 }}>{m.title}</span>
                        <span className="mono" style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', flexShrink: 0 }}>{m.at.slice(5)}</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.detail}</div>
                    </div>
                  </List.Item>
                )}
              />
            )}
          </Card>

          <Card size="small" title="三红灯 · 异常预警"
            extra={<span style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>未接48h · 空转24h · 卡验收48h</span>}
            styles={{ body: { padding: 12 } }}>
            <div className="stack" style={{ gap: 8 }}>
              {redStats.map((s) => (
                <div key={s.kind} style={{ background: s.count ? '#FFF1F0' : '#FAFAFA', borderRadius: 8, padding: '10px 12px', border: s.count ? '1px solid #FFA39E' : '1px solid rgba(5,5,5,0.06)' }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <Tag color={s.color} style={{ marginInlineEnd: 0 }}>{s.label}</Tag>
                    <span style={{ fontSize: 20, fontWeight: 700, color: s.count ? '#CF1322' : 'rgba(0,0,0,0.25)' }}>{s.count}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginTop: 4 }}>{s.desc}</div>
                </div>
              ))}
            </div>
            {redRows.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <MobileList
                  items={redRows}
                  renderItem={(r: any) => (
                    <MobileCard
                      title={<>
                        <span className="mono" style={{ fontSize: 12, color: '#FF6B35' }}>{r.job.id}</span>
                        <div>{r.job.title}</div>
                      </>}
                      titleTo={`/job/${r.job.id}`}
                      badge={<Tag color="red" style={{ marginInlineEnd: 0 }}>红灯 {r.lights.length}</Tag>}
                      fields={<MobileField label="触发">
                        {r.lights.map((k: keyof typeof REDLIGHT_DEFS) => (
                          <Tag key={k} color={REDLIGHT_DEFS[k].color} style={{ marginInlineEnd: 4 }}>{REDLIGHT_DEFS[k].label}</Tag>
                        ))}
                      </MobileField>}
                    />
                  )}
                />
              </div>
            )}
            {redRows.length === 0 && <Alert type="success" showIcon message="当前无红灯" style={{ marginTop: 8 }} />}
          </Card>

          <Card size="small" title="六 DU 全局概览" styles={{ body: { padding: 12 } }}>
            <MobileList
              items={st.dus}
              renderItem={(d: any) => {
                const active = st.jobs.filter((j) => (j.dispatchDuId === d.id || st.huById(j.assigneeHuId)?.duId === d.id) && !['closed', 'terminated', 'rejected'].includes(j.status)).length
                const closed = st.jobs.filter((j) => (j.dispatchDuId === d.id || st.huById(j.assigneeHuId)?.duId === d.id) && j.status === 'closed').length
                const red = redRows.filter((x) => {
                  const j = x.job
                  return j.dispatchDuId === d.id || st.huById(j.assigneeHuId)?.duId === d.id
                }).length
                return (
                  <MobileCard
                    title={<>{d.name} <Tag color={DU_TYPE_META[d.type as keyof typeof DU_TYPE_META]?.color} style={{ marginInlineStart: 6 }}>{DU_TYPE_META[d.type as keyof typeof DU_TYPE_META]?.label}</Tag></>}
                    badge={red ? <Tag color="red" style={{ marginInlineEnd: 0 }}>红{red}</Tag> : undefined}
                    fields={
                      <>
                        <MobileField label="在办工单">{active} 张</MobileField>
                        <MobileField label="累计关闭">{closed} 张</MobileField>
                      </>
                    }
                  />
                )
              }}
            />
          </Card>
        </div>
      ) : (
      <>
      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col span={14}>
          <Card
            size="small" title="近期要动的工单" extra={<Link to="/todo">全部待办 →</Link>}
            styles={{ body: { paddingTop: 0 } }}
          >
            <Table
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={dueSoon}
              locale={{ emptyText: '暂时没有在办的工单，去 <发单> 提一个需求' }}
              columns={[
                { title: '工单号', dataIndex: 'id', width: 150, render: (v: string, r: any) => <Link to={`/job/${r.id}`} className="mono">{v}</Link> },
                { title: '标题', dataIndex: 'title', ellipsis: true },
                { title: '状态', width: 90, render: (_v, r: any) => <Tag color={JOB_STATUS[r.status as keyof typeof JOB_STATUS]?.color}>{JOB_STATUS[r.status as keyof typeof JOB_STATUS]?.label}</Tag> },
                { title: '承诺完成', dataIndex: 'promiseDate', width: 110, className: 'mono' },
              ]}
            />
          </Card>
        </Col>
        <Col span={10}>
          <Card size="small" title="最新消息" extra={<Link to="/msgs">全部 →</Link>}>
            <List
              size="small"
              dataSource={st.msgs.filter((m) => m.toHuId === me.id).slice(0, 5)}
              locale={{ emptyText: '暂无消息' }}
              renderItem={(m) => (
                <List.Item
                  style={{ cursor: 'pointer', padding: '8px 4px' }}
                  onClick={() => { st.markRead(m.id); navigate(m.link) }}
                >
                  <div style={{ width: '100%' }}>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <span style={{ fontWeight: m.read ? 400 : 600, fontSize: 13 }}>{m.title}</span>
                      <span className="mono" style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>{m.at}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.detail}</div>
                  </div>
                </List.Item>
              )}
            />
          </Card>
        </Col>
      </Row>

      <Card size="small" style={{ marginTop: 16 }} title="三红灯 · 异常预警（口径见 PRD §7）" extra={<span style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>超时未接 48h · 空转 24h · 卡验收 48h</span>}
        styles={{ body: { paddingTop: 0 } }}>
        <Row gutter={16} style={{ marginTop: 4, marginBottom: 12 }}>
          {redStats.map((s) => (
            <Col span={8} key={s.kind}>
              <div style={{ background: s.count ? '#FFF1F0' : '#FAFAFA', borderRadius: 8, padding: '12px 16px', border: s.count ? '1px solid #FFA39E' : '1px solid rgba(5,5,5,0.06)' }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <Tag color={s.color} style={{ marginInlineEnd: 0 }}>{s.label}</Tag>
                  <span style={{ fontSize: 20, fontWeight: 700, color: s.count ? '#CF1322' : 'rgba(0,0,0,0.25)' }}>{s.count}</span>
                </div>
                <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginTop: 4 }}>{s.desc}</div>
              </div>
            </Col>
          ))}
        </Row>
        {redRows.length === 0 ? (
          <Alert type="success" showIcon message="当前无红灯 —— 三类异常均未触发" style={{ marginBottom: 12 }} />
        ) : (
          <Table
            size="small"
            rowKey="id"
            pagination={false}
            dataSource={redRows}
            columns={[
              { title: '工单号', dataIndex: 'id', width: 150, render: (v: string) => <Link to={`/job/${v}`} className="mono">{v}</Link> },
              { title: '标题', dataIndex: 'title', ellipsis: true },
              { title: '红灯', width: 220, render: (_v, r: any) => (
                <span>{r.lights.map((k: keyof typeof REDLIGHT_DEFS) => (
                  <Tag key={k} color={REDLIGHT_DEFS[k].color}>{REDLIGHT_DEFS[k].label}</Tag>
                ))}</span>
              ) },
            ]}
          />
        )}
      </Card>

      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col span={24}>
          <Card size="small" title="六 DU 全局概览（归属层视角 · 看板按 DU 聚合）">
            <Table
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={st.dus}
              columns={[
                { title: 'DU', dataIndex: 'name' },
                { title: '类型', dataIndex: 'type', width: 90, render: (t: keyof typeof DU_TYPE_META) => <Tag color={DU_TYPE_META[t].color}>{DU_TYPE_META[t].label}</Tag> },
                { title: '在办工单', width: 100, render: (_v, r) => st.jobs.filter((j) => (j.dispatchDuId === r.id || st.huById(j.assigneeHuId)?.duId === r.id) && !['closed', 'terminated', 'rejected'].includes(j.status)).length },
                { title: '累计关闭', width: 100, render: (_v, r) => st.jobs.filter((j) => (j.dispatchDuId === r.id || st.huById(j.assigneeHuId)?.duId === r.id) && j.status === 'closed').length },
                { title: '待验收（本 DU 发出）', width: 160, render: (_v, r) => st.ofds.filter((f) => f.ownerDuId === r.id && f.status === 'awaitAccept').length },
                { title: '红灯（本 DU 派出）', width: 120, render: (_v, r) => {
                  const n = redRows.filter((x) => {
                    const j = x.job
                    return j.dispatchDuId === r.id || st.huById(j.assigneeHuId)?.duId === r.id
                  }).length
                  return n ? <Tag color="red">{n}</Tag> : <span style={{ color: 'rgba(0,0,0,0.25)' }}>0</span>
                } },
              ]}
            />
          </Card>
        </Col>
      </Row>
      </>
      )}
    </div>
  )
}
