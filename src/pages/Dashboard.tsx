import { useEffect, useState } from 'react';
import { Card, Col, Descriptions, Row, Statistic, Tag, Spin } from 'antd';
import { fetchHealth } from '../api/auth';
import { useAuthStore } from '../store/auth';
import type { HealthResponse } from '../types';

const ORDER_CARDS = [
  { code: 'O', title: 'O 单', desc: '订单源单', color: '#159947' },
  { code: 'F', title: 'F 单', desc: '履约执行单', color: '#2f6fed' },
  { code: 'J', title: 'J 单', desc: '结算/作业单', color: '#d48806' },
] as const;

export default function Dashboard() {
  const user = useAuthStore(s => s.user);
  const [health, setHealth] = useState<HealthResponse | null>(null);

  useEffect(() => {
    fetchHealth()
      .then(setHealth)
      .catch(err => console.error('[dashboard] health check failed:', err));
  }, []);

  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <Descriptions title="履约概览" column={{ xs: 1, sm: 2, md: 4 }}>
          <Descriptions.Item label="当前用户">{user?.displayName ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="账号">{user?.username ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="服务状态">
            {health ? <Tag color="success">{health.status}</Tag> : <Spin size="small" />}
          </Descriptions.Item>
          <Descriptions.Item label="统一认证">
            <Tag color={health?.authConfigured ? 'success' : 'warning'}>
              {health?.authConfigured ? 'OAS 已配置' : 'OAS 未配置'}
            </Tag>
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Row gutter={16}>
        {ORDER_CARDS.map(card => (
          <Col span={8} key={card.code}>
            <Card hoverable>
              <Statistic
                title={
                  <span>
                    <Tag color={card.color} style={{ marginInlineEnd: 6 }}>{card.code}</Tag>
                    {card.desc}
                  </span>
                }
                value={0}
                suffix="单"
              />
              <div style={{ color: 'rgba(0,0,0,0.45)', fontSize: 12, marginTop: 8 }}>
                闭环链路：O → F → J（业务规则待执行指令）
              </div>
            </Card>
          </Col>
        ))}
      </Row>
    </div>
  );
}
