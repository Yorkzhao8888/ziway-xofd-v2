import { useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { App as AntdApp, ConfigProvider, Spin } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import MainLayout from './layout/MainLayout';
import LoginRequired from './pages/LoginRequired';
import Dashboard from './pages/Dashboard';
import OrderPlaceholder from './pages/OrderPlaceholder';
import { useAuthStore } from './store/auth';

function AuthGate({ children }: { children: ReactNode }) {
  const token = useAuthStore(s => s.token);
  const user = useAuthStore(s => s.user);
  const loading = useAuthStore(s => s.loading);

  if (loading) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin size="large" tip="正在验证登录态..." />
      </div>
    );
  }

  if (!token || !user) {
    return <LoginRequired />;
  }

  return <>{children}</>;
}

export default function App() {
  const bootstrap = useAuthStore(s => s.bootstrap);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#159947',
          borderRadius: 6,
          colorBgLayout: '#f5f6f4',
        },
        components: {
          Layout: {
            siderBg: '#1f3d2b',
            headerBg: '#ffffff',
          },
          Menu: {
            darkItemBg: '#1f3d2b',
            darkSubMenuItemBg: '#173021',
            darkItemSelectedBg: '#159947',
          },
        },
      }}
    >
      <AntdApp>
        <BrowserRouter>
          <Routes>
            <Route
              element={
                <AuthGate>
                  <MainLayout />
                </AuthGate>
              }
            >
              <Route path="/" element={<Dashboard />} />
              <Route
                path="/orders/o"
                element={<OrderPlaceholder code="O" title="订单源单" subtitle="生态侧客户订单（Order），履约链路的起点" color="#159947" />}
              />
              <Route
                path="/orders/f"
                element={<OrderPlaceholder code="F" title="履约执行单" subtitle="仓配履约单据（Fulfillment），承接 O 单分解执行" color="#2f6fed" />}
              />
              <Route
                path="/orders/j"
                element={<OrderPlaceholder code="J" title="结算作业单" subtitle="结算/对账单据（J），三单闭环终点" color="#d48806" />}
              />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AntdApp>
    </ConfigProvider>
  );
}
