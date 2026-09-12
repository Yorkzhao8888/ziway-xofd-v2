import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { Layout, Menu, Badge, Spin, Button, Drawer } from 'antd'
import {
  InboxOutlined, FileDoneOutlined, DeploymentUnitOutlined,
  BellOutlined, DashboardOutlined, TeamOutlined, StopOutlined, LogoutOutlined,
  MenuOutlined,
} from '@ant-design/icons'
import { useStore } from './store'
import { MENU_META, type MenuKey } from './types'
import DashboardPage from './pages/Dashboard'
import OrderList from './pages/OrderList'
import OrderDetail from './pages/OrderDetail'
import OfdList from './pages/OfdList'
import OfdDetail from './pages/OfdDetail'
import JobList from './pages/JobList'
import JobDetail from './pages/JobDetail'
import TodoPage from './pages/Todo'
import MsgCenter from './pages/MsgCenter'
import MasterData from './pages/MasterData'
import MeSwitch from './components/MeSwitch'
import LoginPage from './pages/Login'
import { useIsMobile } from './components/responsive'

const { Sider, Header, Content } = Layout

/** 底部主导航（高频动线）；其余菜单（履约单/用户管理）进抽屉 */
const TABBAR: { key: MenuKey; icon: React.ReactNode; label: string }[] = [
  { key: '/', icon: <DashboardOutlined />, label: '工作台' },
  { key: '/todo', icon: <InboxOutlined />, label: '待办' },
  { key: '/orders', icon: <FileDoneOutlined />, label: '需求单' },
  { key: '/jobs', icon: <DeploymentUnitOutlined />, label: '工单' },
  { key: '/msgs', icon: <BellOutlined />, label: '消息' },
]

export default function App() {
  const st = useStore()
  const init = useStore((s) => s.init)
  const booted = useStore((s) => s.booted)
  const authed = useStore((s) => s.authed)
  const logout = useStore((s) => s.logout)
  const [collapsed, setCollapsed] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const loc = useLocation()
  const nav = useNavigate()
  const isMobile = useIsMobile()

  useEffect(() => { void init() }, [init])
  // 路由切换后关闭抽屉
  useEffect(() => { setDrawerOpen(false) }, [loc.pathname])

  if (!booted) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin size="large" />
      </div>
    )
  }
  if (!authed) return <LoginPage />

  const currentHu = st.currentHu()
  const currentDu = st.currentDu()
  const unread = st.unread()

  const myMenus = st.roleMenuAccess[currentHu?.role] ?? []
  const allowed = (key: string) => myMenus.includes(key as MenuKey)

  const menuItems = [
    { key: '/', icon: <DashboardOutlined />, label: <NavLink to="/">工作台</NavLink> },
    ...(allowed('/todo') ? [{ key: '/todo', icon: <InboxOutlined />, label: <NavLink to="/todo">我的待办</NavLink> }] : []),
    ...(allowed('/orders') ? [{ key: '/orders', icon: <FileDoneOutlined />, label: <NavLink to="/orders">需求单</NavLink> }] : []),
    ...(allowed('/ofds') ? [{ key: '/ofds', icon: <FileDoneOutlined />, label: <NavLink to="/ofds">履约单</NavLink> }] : []),
    ...(allowed('/jobs') ? [{ key: '/jobs', icon: <DeploymentUnitOutlined />, label: <NavLink to="/jobs">工单</NavLink> }] : []),
    ...(allowed('/msgs') ? [{ key: '/msgs', icon: <BellOutlined />, label: (
      <NavLink to="/msgs"><Badge count={unread} size="small" offset={[6, -2]}>消息中心</Badge></NavLink>
    ) }] : []),
    ...(allowed('/master') ? [{ key: '/master', icon: <TeamOutlined />, label: <NavLink to="/master">用户管理</NavLink> }] : []),
  ]

  const activeKey = menuKey(loc.pathname)
  const tabs = TABBAR.filter((t) => allowed(t.key) || t.key === '/')

  /* ============ 移动端布局：顶栏（汉堡+标题+身份）+ 抽屉全量菜单 + 底部主导航 ============ */
  if (isMobile) {
    return (
      <Layout style={{ minHeight: '100vh' }}>
        <Header className="m-topbar">
          <Button type="text" className="m-hamburger" icon={<MenuOutlined />} onClick={() => setDrawerOpen(true)} aria-label="打开菜单" />
          <span className="m-topbar-title" onClick={() => nav('/')}>{MENU_META[activeKey as MenuKey]?.name ?? '百业百态 OFD'}</span>
          <div style={{ flex: 1 }} />
          <MeSwitch compact />
        </Header>
        <Drawer
          placement="left"
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          width={280}
          title={<span style={{ color: '#FF6B35', fontWeight: 700 }}>百业百态 OFD履约中心</span>}
          styles={{ body: { padding: 0 } }}
        >
          <div style={{ padding: '4px 16px 12px', borderBottom: '1px solid rgba(5,5,5,0.06)', marginBottom: 8 }}>
            <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.65)', marginBottom: 8 }}>
              当前：<b>{currentHu?.name}</b>（{currentHu?.title}）· {currentDu?.name}
            </div>
            <MeSwitch full />
          </div>
          <Menu
            className="m-drawer-menu"
            mode="inline"
            selectedKeys={[activeKey]}
            items={menuItems}
            onClick={({ key }) => { nav(key); setDrawerOpen(false) }}
          />
          <div style={{ padding: 16 }}>
            <Button block icon={<LogoutOutlined />} onClick={logout}>退出登录</Button>
          </div>
        </Drawer>

        <Content style={{ overflow: 'auto', background: '#F2F3F5' }}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<DashboardPage />} />
            <Route path="/todo" element={<Guard menuKey="/todo"><TodoPage /></Guard>} />
            <Route path="/order/new" element={<Guard menuKey="/orders"><Navigate to="/orders" replace /></Guard>} />
            <Route path="/orders" element={<Guard menuKey="/orders"><OrderList /></Guard>} />
            <Route path="/order/:id" element={<Guard menuKey="/orders"><OrderDetail /></Guard>} />
            <Route path="/ofds" element={<Guard menuKey="/ofds"><OfdList /></Guard>} />
            <Route path="/ofd/:id" element={<Guard menuKey="/ofds"><OfdDetail /></Guard>} />
            <Route path="/jobs" element={<Guard menuKey="/jobs"><JobList /></Guard>} />
            <Route path="/job/:id" element={<Guard menuKey="/jobs"><JobDetail /></Guard>} />
            <Route path="/msgs" element={<Guard menuKey="/msgs"><MsgCenter /></Guard>} />
            <Route path="/master" element={<Guard menuKey="/master"><MasterData /></Guard>} />
            <Route path="/about" element={<Navigate to="/" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Content>

        <nav className="m-tabbar">
          {tabs.map((t) => (
            <NavLink
              key={t.key}
              to={t.key}
              className={({ isActive }) => `m-tabbar-item ${isActive || (t.key !== '/' && activeKey === t.key) ? 'active' : ''}`}
            >
              {t.key === '/msgs' ? (
                <Badge count={unread} size="small" offset={[8, -2]}>{t.icon}</Badge>
              ) : (
                t.icon
              )}
              <span>{t.label}</span>
            </NavLink>
          ))}
        </nav>
      </Layout>
    )
  }

  /* ============ 桌面布局：Sider + Header（原样保留，零回退） ============ */
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider collapsible collapsed={collapsed} onCollapse={setCollapsed} width={208}>
        <div style={{ color: '#fff', fontWeight: 600, fontSize: 16, padding: '16px 16px 8px', letterSpacing: 1 }}>
          {collapsed ? '百态' : '百业百态 OFD履约中心'}
        </div>
        <Menu theme="dark" mode="inline" selectedKeys={[menuKey(loc.pathname)]} items={menuItems} />
      </Sider>
      <Layout>
        <Header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingInline: 24, borderBottom: '1px solid rgba(5,5,5,0.06)' }}>
          <div className="row" style={{ gap: 8, fontSize: 13, color: 'rgba(0,0,0,0.65)' }}>
            <span>百业百态 OFD履约中心 · 生态工单管控</span>
            <span style={{ color: 'rgba(0,0,0,0.25)' }}>|</span>
            <span>归属接口已预留 · 金额与结算模块不在本期</span>
          </div>
          <div className="row" style={{ gap: 12 }}>
            <MeSwitch />
            <Button size="small" type="text" icon={<LogoutOutlined />} onClick={logout}>退出</Button>
          </div>
        </Header>
        <Content style={{ overflow: 'auto' }}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<DashboardPage />} />
            <Route path="/todo" element={<Guard menuKey="/todo"><TodoPage /></Guard>} />
            {/* 发单入口已并入需求单列表页（抽屉）；/order/new 重定向防旧链接 404 */}
            <Route path="/order/new" element={<Guard menuKey="/orders"><Navigate to="/orders" replace /></Guard>} />
            <Route path="/orders" element={<Guard menuKey="/orders"><OrderList /></Guard>} />
            <Route path="/order/:id" element={<Guard menuKey="/orders"><OrderDetail /></Guard>} />
            <Route path="/ofds" element={<Guard menuKey="/ofds"><OfdList /></Guard>} />
            <Route path="/ofd/:id" element={<Guard menuKey="/ofds"><OfdDetail /></Guard>} />
            <Route path="/jobs" element={<Guard menuKey="/jobs"><JobList /></Guard>} />
            <Route path="/job/:id" element={<Guard menuKey="/jobs"><JobDetail /></Guard>} />
            <Route path="/msgs" element={<Guard menuKey="/msgs"><MsgCenter /></Guard>} />
            <Route path="/master" element={<Guard menuKey="/master"><MasterData /></Guard>} />
            <Route path="/about" element={<Navigate to="/" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  )
}

/** 路由守卫：当前身份角色未获该页面授权 → 无权限提示页（导航不可见 + 直敲 URL 双保险） */
function Guard({ menuKey: key, children }: { menuKey: MenuKey; children: React.ReactNode }) {
  const st = useStore()
  const hu = st.currentHu()
  const allowed = (st.roleMenuAccess[hu.role] ?? []).includes(key)
  if (allowed) return <>{children}</>
  return (
    <div className="page">
      <div className="card" style={{ background: '#fff', border: '1px solid rgba(5,5,5,0.06)', borderRadius: 8, padding: 48, textAlign: 'center' }}>
        <StopOutlined style={{ fontSize: 42, color: '#ffa940' }} />
        <h2 style={{ margin: '12px 0 4px' }}>无页面访问权限</h2>
        <p style={{ color: 'rgba(0,0,0,0.45)', marginBottom: 20 }}>
          当前身份 <b>{hu.name}</b>（{ROLE_LABEL[hu.role]}）未被授权访问「{MENU_META[key].name}」，请联系系统管理员调整角色权限。
        </p>
        <Link to="/" className="ant-btn ant-btn-primary" style={{ textDecoration: 'none' }}>返回工作台</Link>
      </div>
    </div>
  )
}

const ROLE_LABEL: Record<string, string> = {
  requester: '发单员', assignee: '接单员', duAdmin: 'DU管理员',
  operator: '平台运营', observer: '观察者', sysAdmin: '系统管理员',
}

function menuKey(path: string): string {
  if (path === '/' ) return '/'
  if (path.startsWith('/todo')) return '/todo'
  if (path.startsWith('/order')) return '/orders'
  if (path.startsWith('/ofd')) return '/ofds'
  if (path.startsWith('/job')) return '/jobs'
  if (path.startsWith('/msgs')) return '/msgs'
  if (path.startsWith('/master')) return '/master'
  return '/'
}
