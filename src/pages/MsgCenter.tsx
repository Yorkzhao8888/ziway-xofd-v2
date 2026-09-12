import { Card, List, Badge, Button, Empty, Tooltip, Avatar } from 'antd'
import {
  SendOutlined, LinkOutlined, CheckCircleOutlined, ClockCircleOutlined,
  CloseCircleOutlined, NotificationOutlined, CarryOutOutlined, SyncOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'

/** 消息中心（PRD M7-1）：5 类节点推送，点消息直达单据
 *  视觉：类型图标 + 单号着色 + 未读底色区分；「点击直达」改为 hover 提示，不再每条挂 tag
 */

/** 消息类型图标与配色（按 title/单号前缀推断类型） */
function msgVisual(m: { title: string; link: string }): { icon: React.ReactNode; color: string; label: string } {
  const t = m.title
  if (t.includes('进度')) return { icon: <ClockCircleOutlined />, color: '#FA8C16', label: '进度' }
  if (t.includes('已接单')) return { icon: <CarryOutOutlined />, color: '#1677FF', label: '接单' }
  if (t.includes('履约中')) return { icon: <SyncOutlined />, color: '#1677FF', label: '履约中' }
  if (t.includes('完工') || t.includes('验收通过') || t.includes('已关闭')) return { icon: <CheckCircleOutlined />, color: '#52C41A', label: '完工/验收' }
  if (t.includes('驳回')) return { icon: <CloseCircleOutlined />, color: '#FF4D4F', label: '驳回' }
  if (t.includes('转派')) return { icon: <SendOutlined />, color: '#722ED1', label: '转派' }
  if (t.includes('收到新')) return { icon: <NotificationOutlined />, color: '#FF6B35', label: '新单' }
  if (t.includes('已受理')) return { icon: <CheckCircleOutlined />, color: '#13C2C2', label: '受理' }
  if (t.includes('撤回')) return { icon: <CloseCircleOutlined />, color: '#8C8C8C', label: '撤回' }
  return { icon: <LinkOutlined />, color: '#8C8C8C', label: '通知' }
}

const docIdOf = (m: { title: string; link: string }): string => {
  const fromTitle = m.title.match(/[OFGJ]-\d{6}-\d{4}/)
  if (fromTitle) return fromTitle[0]
  const fromLink = m.link.match(/[ofgj]\/([A-Z]-\d{6}-\d{4})/)
  return fromLink ? fromLink[1] : ''
}

export default function MsgCenter() {
  const st = useStore()
  const nav = useNavigate()
  const mine = st.msgs.filter((m) => m.toHuId === st.currentHuId)
  const unread = mine.filter((m) => !m.read).length

  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <h1 className="page-title">消息中心</h1>
      <p className="page-sub">派单 / 接单 / 进度 / 完工 / 验收 五类节点推送 —— 通知发给 HU，点开直达单据</p>
      <Card
        size="small"
        title={<span>未读 <Badge count={unread} style={{ marginLeft: 4 }} /></span>}
        extra={<Button size="small" onClick={() => st.markAllRead()} disabled={!unread}>全部已读</Button>}
        styles={{ body: { padding: '0' } }}
      >
        {mine.length === 0 ? (
          <div style={{ padding: '24px 0' }}>
            <Empty description="暂无消息 —— 系统会在关键节点主动通知你" />
          </div>
        ) : (
          <List
            dataSource={mine}
            renderItem={(m) => {
              const v = msgVisual(m)
              const docId = docIdOf(m)
              return (
                <List.Item
                  className="msg-item"
                  onClick={() => { st.markRead(m.id); nav(m.link) }}
                >
                  {/* 类型图标：未读带底色圆片，已读灰化 */}
                  <div
                    className="msg-icon"
                    style={m.read ? undefined : { background: `${v.color}14`, color: v.color }}
                  >
                    {v.icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
                      <span className="msg-title" style={{ fontWeight: m.read ? 400 : 600 }}>
                        {!m.read && <span className="msg-dot" />}
                        {m.title}
                      </span>
                      <span className="mono" style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)', flexShrink: 0 }}>{m.at}</span>
                    </div>
                    <div style={{ fontSize: 13, color: m.read ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.72)', marginTop: 2 }}>
                      {m.detail}
                    </div>
                    {docId && (
                      <Tooltip title="点击条目直达单据详情">
                        <span className={`mono msg-doc ${m.read ? 'is-read' : ''}`}>{docId}</span>
                      </Tooltip>
                    )}
                  </div>
                  <span className={`msg-go ${m.read ? 'is-read' : ''}`}>查看 →</span>
                </List.Item>
              )
            }}
          />
        )}
      </Card>
    </div>
  )
}
