import { useState } from 'react'
import { Modal, Form, Input, DatePicker, Button, Space, message } from 'antd'
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useStore } from '../store'

/** 编制履约方案（PRD M3）：交付物清单 + 验收标准 + 承诺时间 —— 三者缺一不可（闭环关键） */
export default function OfdCreate({ open, onClose, orderId, defaultTitle, expectDate }: {
  open: boolean
  onClose: () => void
  orderId: string
  defaultTitle: string
  expectDate: string
}) {
  const st = useStore()
  const [form] = Form.useForm()
  const [msgApi, contextHolder] = message.useMessage()
  const [items, setItems] = useState<{ name: string; standard: string }[]>([{ name: '', standard: '' }])

  const submit = async () => {
    const vals = await form.validateFields()
    const valid = items.filter((i) => i.name.trim())
    if (!valid.length) { msgApi.warning('至少写 1 项交付物'); return }
    if (valid.some((i) => !i.standard.trim())) { msgApi.warning('每项交付物都要写验收标准 —— 先写判据，事后不吵'); return }
    try {
      const ofd = await st.createOfd(orderId, {
        title: `${vals.title} 履约方案`,
        deliverables: valid,
        promiseDate: vals.promiseDate.format('YYYY-MM-DD'),
      })
      // 紧接着拆出第一张工单（派给 ORDER 的目标）
      const order = st.orders.find((o) => o.id === orderId)!
      await st.createJob({
        ofdId: ofd.id, orderId,
        title: order.title,
        desc: order.desc,
        dispatchDuId: order.targetDuId ?? undefined,
        dispatchHuId: order.targetHuId ?? undefined,
        promiseDate: vals.promiseDate.format('YYYY-MM-DD'),
        dueHours: 24,
      })
      msgApi.success(`履约单 ${ofd.id} 已建立并派工单`)
      form.resetFields()
      setItems([{ name: '', standard: '' }])
      onClose()
    } catch (e: any) {
      msgApi.error(e?.message || '创建履约方案失败')
    }
  }

  return (
    <Modal
      title={`编制履约方案 · 来源 ${orderId}`}
      open={open}
      width={680}
      onCancel={onClose}
      footer={[
        <Button key="c" onClick={onClose}>取消</Button>,
        <Button key="s" type="primary" onClick={submit}>生成履约单并派工单</Button>,
      ]}
    >
      {contextHolder}
      <Form form={form} layout="vertical" initialValues={{ title: defaultTitle, promiseDate: dayjs(expectDate) }}>
        <Form.Item name="title" label="履约标题" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="promiseDate" label="承诺完成时间（接单方接单时可反填协商，原值留痕）" rules={[{ required: true, message: '承诺时间是超时判定的基准' }]}>
          <DatePicker style={{ width: 200 }} />
        </Form.Item>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>交付物清单（验收按清单逐项过）</div>
        {items.map((it, idx) => (
          <Space key={idx} align="start" style={{ display: 'flex', marginBottom: 8 }}>
            <Input
              style={{ width: 220 }}
              placeholder={`交付物 ${idx + 1}，如：诊断报告`}
              value={it.name}
              onChange={(e) => setItems(items.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)))}
            />
            <Input
              style={{ width: 300 }}
              placeholder="验收标准：做到什么程度算过"
              value={it.standard}
              onChange={(e) => setItems(items.map((x, i) => (i === idx ? { ...x, standard: e.target.value } : x)))}
            />
            <Button icon={<DeleteOutlined />} disabled={items.length === 1} onClick={() => setItems(items.filter((_, i) => i !== idx))} />
          </Space>
        ))}
        <Button icon={<PlusOutlined />} onClick={() => setItems([...items, { name: '', standard: '' }])}>加一项</Button>
      </Form>
    </Modal>
  )
}
