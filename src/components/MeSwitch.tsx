import { useEffect, useMemo, useState } from 'react'
import { Select, Tag, App, Modal, Button } from 'antd'
import { DownOutlined, SwapOutlined, UserOutlined } from '@ant-design/icons'
import { useStore } from '../store'
import { DU_TYPE_META, ROLE_META } from '../types'
import { api } from '../services/api'

/**
 * 身份基地切换器
 * 支持：1) 同 DU 内 HU 切换；2) 跨 DU 身份切换（切换到该 DU 下第一个身份）
 * 切换 = 以后端一键登录换发该身份 token（内测规则）。
 * - 桌面（默认）：顶栏内联 Select（minWidth 220）
 * - full：抽屉/弹层内的全宽 Select
 * - compact：移动端顶栏按钮，点击弹 Modal 切换
 */
export default function MeSwitch({ compact, full }: { compact?: boolean; full?: boolean }) {
  const { message } = App.useApp()
  const currentHuId = useStore((s) => s.currentHuId)
  const dus = useStore((s) => s.dus)
  const hus = useStore((s) => s.hus)
  const quickLogin = useStore((s) => s.quickLogin)
  const [busy, setBusy] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [isOas, setIsOas] = useState(false)

  useEffect(() => { api.authMode().then((m) => setIsOas(m.mode === 'on')).catch(() => {}) }, [])

  const me = useMemo(() => hus.find((x) => x.id === currentHuId), [hus, currentHuId])
  const du = useMemo(() => dus.find((x) => x.id === me?.duId), [dus, me])
  const meta = DU_TYPE_META[du?.type ?? '']

  const sameDuHus = useMemo(
    () => hus.filter((h) => h.duId === me?.duId && h.id !== me?.id) as typeof hus,
    [hus, me],
  )

  const doSwitch = async (huId: string) => {
    if (!huId) return
    setBusy(true)
    try {
      await quickLogin(huId)
      message.success('已切换身份')
      setModalOpen(false)
    } catch (e: any) {
      message.error(e?.message || '切换失败')
    } finally {
      setBusy(false)
    }
  }

  // OAS 模式：身份由统一身份层决定，不支持前端随意切身份（在所有 hook 之后返回）
  if (isOas) {
    const label = me ? `${du ? du.name + ' · ' : ''}${me.name}` : 'OAS 身份'
    return (
      <Tag color={meta?.color || 'orange'} icon={<UserOutlined />} style={{ marginInlineEnd: 0 }}>
        {label}
      </Tag>
    )
  }

  if (!me || !du) return null

  const options = [
    { label: <Opt huId={me.id} />, value: me.id, title: `${me.name}（当前）` },
    ...sameDuHus.map((h) => ({
      label: <Opt huId={h.id} />,
      value: h.id,
      title: `${h.name} · ${ROLE_META[h.role]}`,
    })),
    ...dus.filter((d) => d.id !== me.duId).map((d) => {
      const h = hus.find((x) => x.duId === d.id)
      return { label: <Opt huId={h?.id ?? ''} duTag />, value: h?.id ?? '', disabled: !h, title: `切换到${d.name}` }
    }),
  ]

  const selectEl = (
    <Select
      size={full ? 'middle' : 'small'}
      style={full ? { width: '100%' } : { minWidth: 220 }}
      value={me.id}
      loading={busy}
      suffixIcon={<DownOutlined style={{ fontSize: 10 }} />}
      onChange={(v) => { void doSwitch(v) }}
      options={options}
    />
  )

  if (compact) {
    return (
      <>
        <Button
          type="text"
          size="small"
          icon={<UserOutlined />}
          onClick={() => setModalOpen(true)}
          style={{ minHeight: 40, fontWeight: 600, paddingInline: 8 }}
        >
          <span style={{ maxWidth: 88, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{me.name}</span>
          <SwapOutlined style={{ fontSize: 12, marginLeft: 4, color: '#FF6B35' }} />
        </Button>
        <Modal
          open={modalOpen}
          title="切换操作身份（HU）"
          onCancel={() => setModalOpen(false)}
          footer={null}
          width={340}
        >
          <div style={{ marginBottom: 12 }}>
            <Tag color={meta?.color ?? 'orange'} style={{ fontSize: 12, margin: 0, padding: '2px 10px' }}>
              {du.name}
            </Tag>
          </div>
          {selectEl}
          <p style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginTop: 12, marginBottom: 0 }}>
            内测环境：切换身份 = 一键登录换发该身份令牌。
          </p>
        </Modal>
      </>
    )
  }

  return (
    <div className="row" style={{ gap: 10, ...(full ? { flexDirection: 'column', alignItems: 'stretch', width: '100%' } : {}) }}>
      {full && (
        <Tag color={meta?.color ?? 'orange'} style={{ fontSize: 12, margin: 0, padding: '2px 10px' }}>
          {du.name} · {meta?.short ?? du.name.slice(0, 1)}
        </Tag>
      )}
      {!full && (
        <Tag color={meta?.color ?? 'orange'} style={{ fontSize: 12, margin: 0, padding: '2px 10px' }}>
          {du.name} · {meta?.short ?? du.name.slice(0, 1)}
        </Tag>
      )}
      {!full && <span className="me-switch-label">当前身份</span>}
      {selectEl}
    </div>
  )
}

function Opt({ huId, duTag }: { huId: string; duTag?: boolean }) {
  const h = useStore((s) => s.hus.find((x) => x.id === huId))
  const d = useStore((s) => s.dus.find((x) => x.id === h?.duId))
  if (!h) return null
  const duMeta = DU_TYPE_META[d?.type ?? '']
  return (
    <span>
      {duTag && <Tag color={duMeta?.color ?? 'default'} style={{ marginInlineEnd: 6 }}>{duMeta?.short ?? d?.type}跨</Tag>}
      <b>{h.name}</b> <span style={{ color: 'rgba(0,0,0,0.45)', marginInlineStart: 4 }}>{ROLE_META[h.role]}</span>
    </span>
  )
}
