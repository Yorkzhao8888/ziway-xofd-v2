import { useEffect, useState } from 'react'
import { Card, Form, Input, Button, Tabs, List, Avatar, Tag, Divider, App, Spin, Alert } from 'antd'
import { UserOutlined, LockOutlined, LoginOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import { useStore } from '../store'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api, type AuthMode } from '../services/api'

const ROLE_LABEL: Record<string, string> = {
  requester: '发单员', assignee: '接单员', duAdmin: 'DU管理员',
  operator: '平台运营', observer: '观察者', sysAdmin: '系统管理员',
}

const DU_AVATAR_BG: Record<string, string> = {
  H: '#722ED1', C: '#1677FF', E: '#52C41A', D: '#FA8C16', T: '#2F54EB', Y: '#13C2C2',
}

export default function LoginPage() {
  const { message } = App.useApp()
  const nav = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const quickLogin = useStore((s) => s.quickLogin)
  const quickLoginTest = useStore((s) => s.quickLoginTest)
  const login = useStore((s) => s.login)
  const acceptOasToken = useStore((s) => s.acceptOasToken)
  const [loading, setLoading] = useState(false)
  const [quick, setQuick] = useState<Array<{ id: string; name: string; duId: string; title?: string; role: string; duName: string }>>([])
  const [quickLoading, setQuickLoading] = useState(true)
  const [mode, setMode] = useState<AuthMode | null>(null)
  const [oasError, setOasError] = useState('')
  const isOas = mode?.mode === 'on'

  // 拉取身份模式
  useEffect(() => {
    api.authMode().then(setMode).catch(() => setMode({ mode: 'off', configured: true, keySource: 'none', baseUrl: '' }))
  }, [])

  // off 模式：拉一键登录名单
  useEffect(() => {
    if (mode === null) return
    if (mode.mode === 'off') {
      api.quickLogins().then(setQuick).catch(() => {}).finally(() => setQuickLoading(false))
    } else {
      setQuickLoading(false)
    }
  }, [mode])

  // on 模式：承接 OAS 登录回调 ?token=xxx 或 EMBED postMessage 下发的 token
  useEffect(() => {
    if (!isOas) return
    const consume = async (token: string, from: 'url' | 'embed') => {
      setLoading(true)
      setOasError('')
      try {
        await acceptOasToken(token)
        if (from === 'url') {
          searchParams.delete('token')
          setSearchParams(searchParams, { replace: true })
        }
        message.success('OAS 身份校验通过，已进入工作台')
        nav('/')
      } catch (e: any) {
        setTokenClr()
        setOasError(e?.message || 'OAS 登录失败')
      } finally {
        setLoading(false)
      }
    }
    // 1) URL 回调
    const t = searchParams.get('token')
    if (t) { consume(t, 'url'); return }
    // 2) EMBED 免登握手（ZiwayDS EMBED 基座协议预留）：监听基座 postMessage 下发 token
    //    消息形态（预留，不联调）：{ source:'ziway-ds-embed', type:'auth:token', token:string }
    const onMsg = (ev: MessageEvent) => {
      const d = ev.data as any
      if (d && d.source === 'ziway-ds-embed' && d.type === 'auth:token' && d.token) {
        consume(d.token, 'embed')
      }
    }
    window.addEventListener('message', onMsg)
    // 向基座回执「就绪」，请求下发已登录身份（预留）
    try { window.parent?.postMessage({ source: 'ofd-fulfillment', type: 'embed:ready' }, '*') } catch { /* 非嵌入环境 */ }
    return () => window.removeEventListener('message', onMsg)
  }, [isOas])

  // OAS 失败清登录态（本地）
  const setTokenClr = () => { try { localStorage.removeItem('ofd_token') } catch { /* ignore */ } }

  const onAccount = async (vals: { huId: string; password: string }) => {
    setLoading(true)
    try {
      await login(vals.huId.trim(), vals.password)
      message.success('登录成功')
      nav('/')
    } catch (e: any) {
      message.error(e?.message || '登录失败')
    } finally {
      setLoading(false)
    }
  }

  const onQuick = async (huId: string) => {
    setLoading(true)
    try {
      await quickLogin(huId)
      message.success('已进入工作台')
      nav('/')
    } catch (e: any) {
      message.error(e?.message || '登录失败')
    } finally {
      setLoading(false)
    }
  }

  const onQuickTest = async () => {
    setLoading(true)
    try {
      await quickLoginTest()
      message.success('已进入工作台')
      nav('/')
    } catch (e: any) {
      message.error(e?.message || '登录失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f6f8', padding: 16 }}>
      <Card style={{ width: 760, maxWidth: '100%' }} styles={{ body: { padding: 0 } }}>
        <div style={{ display: 'flex', flexWrap: 'wrap' }}>
          {/* 左侧品牌 */}
          <div style={{ flex: '1 1 260px', background: 'linear-gradient(160deg,#FF6B35,#F74902)', color: '#fff', padding: '36px 28px' }}>
            <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 1 }}>百业百态 OFD 履约中心</div>
            <div style={{ marginTop: 10, fontSize: 13, opacity: 0.92, lineHeight: 1.9 }}>
              知味生态履约协同平台 · O/F/J 三单闭环
              <br />需求单 → 履约单 → 工单，全程留痕可验收
              <br />六大 DU 归属 · 三类 HU 身份 · 角色权限驱动
            </div>
            <Divider style={{ borderColor: 'rgba(255,255,255,0.3)', margin: '20px 0' }} />
            {isOas ? (
              <div style={{ fontSize: 12, opacity: 0.9, lineHeight: 1.9 }}>
                <SafetyCertificateOutlined /> 已接入 <b>OAS 统一身份</b>
                <br />登录与权限由统一身份层签发，本地测试登录已关闭。
              </div>
            ) : (
              <div style={{ fontSize: 12, opacity: 0.85, lineHeight: 1.9 }}>
                内测账号密码统一为 <b style={{ fontFamily: 'monospace' }}>ofd123456</b>
                <br />也可使用右侧「一键测试登录」直接选择身份进入。
              </div>
            )}
          </div>

          {/* 右侧登录 */}
          <div style={{ flex: '1 1 360px', padding: '28px 28px 20px', minWidth: 300 }}>
            {mode === null ? (
              <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
            ) : isOas ? (
              <div style={{ marginTop: 8 }}>
                {oasError && <Alert style={{ marginBottom: 12 }} type="error" showIcon message="OAS 登录失败" description={oasError} />}
                {mode.configured ? (
                  <Alert
                    type="info" showIcon
                    style={{ marginBottom: 12 }}
                    message={loading ? '正在校验 OAS 身份…' : '请经统一身份登录'}
                    description={loading ? '' : '完成统一身份登录后将自动跳转回工作台。如未自动跳转，请从工作台门户重新进入。'}
                  />
                ) : (
                  <Alert
                    type="error" showIcon
                    style={{ marginBottom: 12 }}
                    message="身份服务未就绪（fail-closed）"
                    description={mode.warning || 'OAS 未配置公钥，当前所有受保护访问均被拒绝。'}
                  />
                )}
                {loading && <div style={{ textAlign: 'center', padding: 24 }}><Spin tip="身份校验中" /></div>}
              </div>
            ) : (
            <Tabs
              defaultActiveKey="quick"
              items={[
                {
                  key: 'account',
                  label: '账号登录',
                  children: (
                    <Form layout="vertical" onFinish={onAccount} style={{ marginTop: 8 }}>
                      <Form.Item name="huId" label="账号（HU 编号）" rules={[{ required: true, message: '输入账号，如 HU-C01' }]}>
                        <Input prefix={<UserOutlined />} placeholder="如 HU-C01" autoComplete="username" />
                      </Form.Item>
                      <Form.Item name="password" label="密码" rules={[{ required: true, message: '输入密码' }]}>
                        <Input.Password prefix={<LockOutlined />} placeholder="ofd123456" autoComplete="current-password" />
                      </Form.Item>
                      <Button type="primary" htmlType="submit" block loading={loading} icon={<LoginOutlined />}>登录</Button>
                    </Form>
                  ),
                },
                {
                  key: 'quick',
                  label: '一键测试登录',
                  children: (
                    <div style={{ marginTop: 8 }}>
                      <Button
                        type="primary" block icon={<LoginOutlined />}
                        onClick={onQuickTest} loading={loading}
                        style={{ marginBottom: 12 }}
                      >
                        <b>test123</b> 测试账号直进
                      </Button>
                      {quickLoading ? (
                        <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
                      ) : (
                        <List
                          size="small"
                          dataSource={quick}
                          style={{ maxHeight: 360, overflow: 'auto' }}
                          renderItem={(h) => {
                            const duType = h.duId[0]
                            return (
                              <List.Item
                                actions={[<Button key="go" type="link" size="small" loading={loading} onClick={() => onQuick(h.id)}>进入</Button>]}
                                style={{ cursor: 'pointer' }}
                                onClick={() => onQuick(h.id)}
                              >
                                <List.Item.Meta
                                  avatar={<Avatar style={{ background: DU_AVATAR_BG[duType] || '#FF6B35' }}>{h.name[0]}</Avatar>}
                                  title={<span><b>{h.name}</b> <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>{h.title}</span></span>}
                                  description={
                                    <span style={{ fontSize: 12 }}>
                                      <Tag color="orange" style={{ marginInlineEnd: 4 }}>{ROLE_LABEL[h.role] ?? h.role}</Tag>
                                      <span style={{ color: 'rgba(0,0,0,0.5)' }}>{h.duName}</span>
                                      <span style={{ color: 'rgba(0,0,0,0.3)', marginInlineStart: 6 }}>{h.id}</span>
                                    </span>
                                  }
                                />
                              </List.Item>
                            )
                          }}
                        />
                      )}
                    </div>
                  ),
                },
              ]}
            />
            )}
          </div>
        </div>
      </Card>
    </div>
  )
}
