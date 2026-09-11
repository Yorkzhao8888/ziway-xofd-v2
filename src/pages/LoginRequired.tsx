import { useEffect, useState } from 'react';
import { Button, Result, Spin, Alert } from 'antd';
import { LoginOutlined } from '@ant-design/icons';
import { fetchAuthConfig } from '../api/auth';
import type { AuthConfigResponse } from '../types';

export default function LoginRequired() {
  const [cfg, setCfg] = useState<AuthConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    fetchAuthConfig()
      .then(setCfg)
      .catch(() => setErrMsg('无法获取认证配置，请稍后重试'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin size="large" tip="正在加载认证配置..." />
      </div>
    );
  }

  const notConfigured = !cfg?.configured;

  return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f6f4' }}>
      <Result
        status={notConfigured ? 'warning' : '403'}
        title={notConfigured ? '统一认证尚未接入' : '需要登录'}
        subTitle={
          notConfigured
            ? 'X-OFD v2 履约中枢使用生态统一认证（OAS）。服务端尚未配置 OAS 公钥/JWKS，等发单方下发认证参数后即可登录。'
            : '请通过生态统一认证（OAS）登录，本系统不提供独立注册。'
        }
        extra={
          <>
            {errMsg && <Alert type="error" message={errMsg} style={{ marginBottom: 16 }} showIcon />}
            <Button
              type="primary"
              size="large"
              icon={<LoginOutlined />}
              disabled={notConfigured || !cfg?.loginUrl}
              href={cfg?.loginUrl || undefined}
            >
              {cfg?.loginUrl ? '前往统一认证登录' : '登录地址未配置'}
            </Button>
          </>
        }
      />
    </div>
  );
}
