import { useMemo, useState } from 'react'
import { Card, Table, Tag, Tabs, Select, Input, Switch, Space, Tooltip, Alert, Typography, Segmented, Avatar } from 'antd'
import { UserOutlined, SafetyCertificateOutlined, ApartmentOutlined, SearchOutlined } from '@ant-design/icons'
import { useStore } from '../store'
import { DU_TYPE_META, ROLE_META, ROLE_DESC, MENU_META, type MenuKey, type Role } from '../types'

const { Text } = Typography

/** 用户管理：用户清单（分组织）+ 角色管理（页面权限矩阵）+ 组织台账
 *  口径说明：角色矩阵只管「左侧导航可见性」；单据页内的操作权仍由「归属 DU + 单据关系」动态判定（PRD 原口径）
 */
export default function MasterData() {
  const st = useStore()
  const [orgFilter, setOrgFilter] = useState<string>('all')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [kw, setKw] = useState('')
  const [view, setView] = useState<'grouped' | 'flat'>('grouped')

  const menuKeys = Object.keys(MENU_META) as MenuKey[]
  const roles = Object.keys(ROLE_META) as Role[]

  /** 用户清单（分组视图）：按组织 DU 分组展示，带组内统计 */
  const groupedByDu = useMemo(() => {
    return st.dus
      .filter((d) => orgFilter === 'all' || d.id === orgFilter)
      .map((du) => {
        const members = st.hus.filter((h) => h.duId === du.id)
          .filter((h) => roleFilter === 'all' || h.role === roleFilter)
          .filter((h) => !kw || h.name.includes(kw) || h.id.toLowerCase().includes(kw.toLowerCase()) || h.title.includes(kw))
        return { du, members }
      })
      .filter((g) => g.members.length > 0)
  }, [st.dus, st.hus, orgFilter, roleFilter, kw])

  const huCols = [
    {
      title: '用户', dataIndex: 'name', width: 170,
      render: (_v, r) => (
        <Space size={8}>
          <Avatar style={{ background: '#FF6B35' }} size={26} icon={<UserOutlined />} />
          <div>
            <div style={{ fontWeight: 600, lineHeight: 1.2 }}>{r.name}</div>
            <Text type="secondary" style={{ fontSize: 12 }}>{r.title}</Text>
          </div>
        </Space>
      ),
    },
    { title: '工号', dataIndex: 'id', width: 100, className: 'mono', render: (v) => <span className="mono">{v}</span> },
    {
      title: '组织', dataIndex: 'duId', width: 180,
      render: (v) => { const du = st.dus.find((d) => d.id === v); return du
        ? <Tag color={DU_TYPE_META[du.type].color}>{du.name}</Tag>
        : <Tag>未分配</Tag> } },
    {
      title: '平台角色', dataIndex: 'role', width: 130,
      render: (_v, r) => {
        const opt = (
          <Tooltip title="角色由服务端统一管理，本期内测不在页面变更">
            <Select
              size="small" value={r.role} style={{ width: 116 }} disabled
              options={roles.map((ro) => ({ value: ro, label: ROLE_META[ro] }))}
            />
          </Tooltip>
        )
        // 系统管理员角色受保护：切换需二次确认（防误操作自锁权限体系）
        return r.role === 'sysAdmin'
          ? <Tooltip title="系统管理员可配置全部角色权限，调整前请确认"><span>{opt}</span></Tooltip>
          : opt
      },
    },
    {
      title: '可访问页面', key: 'pages', render: (_v, r) => {
        const menus = st.roleMenuAccess[r.role] ?? []
        return (
          <Space size={4} wrap>
            {menus.map((m) => <Tag key={m} style={{ marginInlineEnd: 0 }}>{MENU_META[m].name}</Tag>)}
          </Space>
        )
      },
    },
  ]

  const duCols = [
    { title: '编号', dataIndex: 'id', width: 100, className: 'mono' },
    { title: '名称', dataIndex: 'name' },
    { title: '类型', dataIndex: 'type', width: 90, render: (t: keyof typeof DU_TYPE_META) => <Tag color={DU_TYPE_META[t].color}>{DU_TYPE_META[t].label}DU</Tag> },
    { title: '在编用户', key: 'hus', width: 100, render: (_v, r) => st.hus.filter((h) => h.duId === r.id).length },
    {
      title: '归属接口', dataIndex: 'vcaseId', width: 140,
      render: (v) => v ? <span className="mono">{v}</span> : <Tag color="default">预留 · 未接入</Tag>,
    },
  ]

  return (
    <div className="page">
      <h1 className="page-title">用户管理</h1>
      <p className="page-sub">双层主体：DU 是归属层（统计与挂靠），HU 是操作层（登录、发单/接单/交物/验收）。角色决定页面可见范围，可在此配置。</p>

      <Alert
        type="info" showIcon style={{ marginBottom: 16 }}
        message="角色矩阵管「页面可见性」；单据页内的操作权仍按「归属 DU + 单据关系」判定 —— 两层权限互不替代"
      />

      <Card size="small">
        <Tabs
          items={[
            {
              key: 'users', label: (
                <span><UserOutlined style={{ marginInlineEnd: 4 }} />用户清单（{st.hus.length}）</span>
              ),
              children: (
                <>
                  <Space style={{ marginBottom: 12 }} wrap>
                    <Segmented
                      value={view}
                      onChange={(v) => setView(v as 'grouped' | 'flat')}
                      options={[
                        { label: '按组织分组', value: 'grouped' },
                        { label: '全部平铺', value: 'flat' },
                      ]}
                    />
                    <Select
                      value={orgFilter} style={{ width: 200 }} onChange={setOrgFilter}
                      options={[{ value: 'all', label: '全部组织' }, ...st.dus.map((d) => ({ value: d.id, label: d.name }))]}
                    />
                    <Select
                      value={roleFilter} style={{ width: 130 }} onChange={setRoleFilter}
                      options={[{ value: 'all', label: '全部角色' }, ...roles.map((r) => ({ value: r, label: ROLE_META[r] }))]}
                    />
                    <Input
                      allowClear prefix={<SearchOutlined />} placeholder="搜姓名 / 工号 / 职务"
                      style={{ width: 200 }} value={kw} onChange={(e) => setKw(e.target.value)}
                    />
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      共 {groupedByDu.reduce((n, g) => n + g.members.length, 0)} 人
                    </Text>
                    <Text type="secondary" style={{ fontSize: 12, marginLeft: 'auto' }}>
                      <ApartmentOutlined style={{ marginInlineEnd: 4 }} />角色下拉即改即生效
                    </Text>
                    <span style={{ flex: 1 }} />
                  </Space>
                  {view === 'grouped' ? (
                    groupedByDu.map(({ du, members }) => (
                      <div key={du.id} style={{ marginBottom: 4 }}>
                        <div style={{
                          display: 'flex', alignItems: 'baseline', gap: 8,
                          padding: '10px 4px 4px', borderBottom: '1px solid #f0f0f0',
                        }}>
                          <Tag color={DU_TYPE_META[du.type].color} style={{ marginInlineEnd: 0 }}>{DU_TYPE_META[du.type].label}DU</Tag>
                          <b>{du.name}</b>
                          <Text type="secondary" style={{ fontSize: 12 }}>{members.length} 人</Text>
                        </div>
                        <Table
                          size="small" rowKey="id" columns={huCols as any} dataSource={members}
                          pagination={false} showHeader={true}
                        />
                      </div>
                    ))
                  ) : (
                    <Table
                      size="small" rowKey="id" columns={huCols as any}
                      dataSource={st.hus
                        .filter((h) => orgFilter === 'all' || h.duId === orgFilter)
                        .filter((h) => roleFilter === 'all' || h.role === roleFilter)
                        .filter((h) => !kw || h.name.includes(kw) || h.id.toLowerCase().includes(kw.toLowerCase()) || h.title.includes(kw))}
                      pagination={false}
                    />
                  )}
                </>
              ),
            },
            {
              key: 'roles', label: (
                <span><SafetyCertificateOutlined style={{ marginInlineEnd: 4 }} />角色管理</span>
              ),
              children: (
                <>
                  <Alert
                    type="warning" showIcon style={{ marginBottom: 12 }}
                    message="开关即改即生效：影响该角色全部用户的左侧导航与页面访问；刷新页面后重置为默认矩阵（原型为内存态）"
                  />
                  <div style={{ overflowX: 'auto' }}>
                    <table className="perm-matrix">
                      <thead>
                        <tr>
                          <th style={{ textAlign: 'left', minWidth: 220 }}>角色</th>
                          <th style={{ minWidth: 90 }}>人数</th>
                          {menuKeys.map((m) => (
                            <th key={m} style={{ minWidth: 76 }}>{MENU_META[m].name}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {roles.map((r) => {
                          const count = st.hus.filter((h) => h.role === r).length
                          return (
                            <tr key={r}>
                              <td>
                                <div style={{ fontWeight: 600 }}>{ROLE_META[r]}</div>
                                <Text type="secondary" style={{ fontSize: 12 }}>{ROLE_DESC[r]}</Text>
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                {count > 0
                                  ? <Tag color={r === 'sysAdmin' ? 'red' : 'blue'}>{count}</Tag>
                                  : <Text type="secondary">0</Text>}
                              </td>
                              {menuKeys.map((m) => {
                                const on = (st.roleMenuAccess[r] ?? []).includes(m)
                                return (
                                  <td key={m} style={{ textAlign: 'center' }}>
                                    {m === '/'
                                      ? <Tag color="green" style={{ marginInlineEnd: 0 }}>常显</Tag>
                                      : <Switch size="small" checked={on} disabled />}
                                  </td>
                                )
                              })}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              ),
            },
            {
              key: 'dus', label: (
                <span><ApartmentOutlined style={{ marginInlineEnd: 4 }} />组织（{st.dus.length}）</span>
              ),
              children: (
                <Table size="middle" rowKey="id" columns={duCols as any} dataSource={st.dus} pagination={false} />
              ),
            },
          ]}
        />
      </Card>
    </div>
  )
}
