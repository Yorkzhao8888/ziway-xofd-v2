import { useMemo, useState } from 'react';
import { Layout, Menu, Tag, Avatar, Dropdown, Typography } from 'antd';
import {
  DashboardOutlined,
  FileTextOutlined,
  ContainerOutlined,
  AuditOutlined,
  UserOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth';

const { Header, Sider, Content } = Layout;

const MENU_ITEMS = [
  { key: '/', icon: <DashboardOutlined />, label: '履约概览' },
  {
    key: 'orders',
    icon: <FileTextOutlined />,
    label: '单据中心',
    children: [
      { key: '/orders/o', icon: <ContainerOutlined />, label: 'O 单（订单）' },
      { key: '/orders/f', icon: <ContainerOutlined />, label: 'F 单（履约单）' },
      { key: '/orders/j', icon: <AuditOutlined />, label: 'J 单（结算单）' },
    ],
  },
];

/** 三单色标（与 DESIGN.md 一致，业务语义待发单方确认） */
const ROUTE_BADGE: Record<string, { color: string; text: string }> = {
  '/orders/o': { color: '#159947', text: 'O' },
  '/orders/f': { color: '#2f6fed', text: 'F' },
  '/orders/j': { color: '#d48806', text: 'J' },
};

export default function MainLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore(s => s.user);
  const clearAuth = useAuthStore(s => s.clearAuth);

  const selectedKeys = useMemo(() => [location.pathname], [location.pathname]);
  const badge = ROUTE_BADGE[location.pathname];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        theme="dark"
        width={208}
        collapsedWidth={72}
        collapsible
        collapsed={collapsed}
        trigger={null}
        style={{ background: '#1f3d2b' }}
      >
        <div
          style={{
            height: 56,
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'flex-start',
            padding: collapsed ? '0' : '0 18px',
            gap: 10,
            color: '#fff',
            fontWeight: 700,
            letterSpacing: 0.5,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
          }}
        >
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              borderRadius: 6,
              background: '#159947',
              fontSize: 13,
              flexShrink: 0,
            }}
          >
            OFD
          </span>
          {!collapsed && <span style={{ fontSize: 14 }}>X-OFD v2 履约中枢</span>}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={selectedKeys}
          defaultOpenKeys={['orders']}
          items={MENU_ITEMS}
          onClick={({ key }) => {
            if (key.startsWith('/')) navigate(key);
          }}
          style={{ background: 'transparent' }}
        />
      </Sider>

      <Layout>
        <Header
          style={{
            height: 56,
            lineHeight: '56px',
            padding: '0 16px',
            background: '#fff',
            borderBottom: '1px solid #e8ece8',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span
              style={{ cursor: 'pointer', color: '#5b6b5f', fontSize: 16 }}
              onClick={() => setCollapsed(c => !c)}
            >
              {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            </span>
            {badge && <Tag color={badge.color} style={{ marginInlineEnd: 0 }}>{badge.text} 单</Tag>}
          </div>

          <Dropdown
            menu={{
              items: [
                { key: 'user', icon: <UserOutlined />, label: user?.displayName ?? user?.username ?? '未登录', disabled: true },
                { type: 'divider' },
                {
                  key: 'logout',
                  icon: <LogoutOutlined />,
                  label: '清除登录态',
                  onClick: () => clearAuth(),
                },
              ],
            }}
          >
            <span style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <Avatar size="small" icon={<UserOutlined />} style={{ background: '#159947' }} />
              <Typography.Text style={{ maxWidth: 180 }} ellipsis>
                {user?.displayName ?? user?.username ?? '未登录'}
              </Typography.Text>
            </span>
          </Dropdown>
        </Header>

        <Content style={{ padding: 16 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
