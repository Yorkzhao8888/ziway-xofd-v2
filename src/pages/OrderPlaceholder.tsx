import { Card, Col, Row, Statistic, Table, Tag, Typography, Empty } from 'antd';
import type { ColumnsType } from 'antd/es/table';

interface OrderPlaceholderProps {
  /** 单据类型标识：O / F / J */
  code: 'O' | 'F' | 'J';
  title: string;
  subtitle: string;
  color: string;
}

interface EmptyRow {
  key: string;
  placeholder: string;
}

const COLUMNS: ColumnsType<EmptyRow> = [
  { title: '单据编号', dataIndex: 'placeholder' },
  { title: '状态', dataIndex: 'placeholder' },
  { title: '创建时间', dataIndex: 'placeholder' },
  { title: '操作', dataIndex: 'placeholder' },
];

export default function OrderPlaceholder({ code, title, subtitle, color }: OrderPlaceholderProps) {
  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
        <Tag color={color} style={{ fontSize: 14, padding: '2px 10px', borderRadius: 6 }}>{code} 单</Tag>
        {title}
      </Typography.Title>
      <Typography.Paragraph type="secondary">{subtitle}</Typography.Paragraph>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card>
            <Statistic title="今日单据" value={0} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="进行中" value={0} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="待处理" value={0} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="异常" value={0} valueStyle={{ color: '#ff4d4f' }} />
          </Card>
        </Col>
      </Row>

      <Card
        title="单据列表"
        extra={<Tag>骨架占位</Tag>}
      >
        <Empty
          description="业务字段与流程待发单方下发执行指令后实现（O/F/J 三单闭环）"
          style={{ padding: '32px 0' }}
        />
        <Table<EmptyRow>
          rowKey="key"
          columns={COLUMNS}
          dataSource={[]}
          size="middle"
          pagination={false}
          locale={{ emptyText: '暂无数据' }}
        />
      </Card>
    </div>
  );
}
