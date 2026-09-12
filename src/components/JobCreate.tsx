import { useState } from 'react'
import { Modal, Form, Input, Select, DatePicker, Radio, InputNumber, message } from 'antd'
import dayjs from 'dayjs'
import { useStore } from '../store'
import { DU_TYPE_META } from '../types'

/** 直发工单（通路 B）：跳过 ORDER/OFD，派发即达 —— 同 DU 单一动作的高频场景 */
export default function JobCreate({ open, onClose }: { open: boolean; onClose: () => void }) {
  const st = useStore()
  const [form] = Form.useForm()
  const [msgApi, contextHolder] = message.useMessage()
  const [targetKind, setTargetKind] = useState<'du' | 'hu'>('du')

  const submit = async () => {
    const vals = await form.validateFields()
    try {
      await st.createJob({
        ofdId: null, orderId: null,
        title: vals.title, desc: vals.desc,
        dispatchDuId: targetKind === 'du' ? vals.dispatchDuId : undefined,
        dispatchHuId: targetKind === 'hu' ? vals.dispatchHuId : undefined,
        promiseDate: vals.promiseDate.format('YYYY-MM-DD'),
        dueHours: vals.dueHours,
      })
      msgApi.success('直发工单已派出（通路 B：跳过需求单/履约单）')
      form.resetFields()
      onClose()
    } catch (e: any) {
      msgApi.error(e?.message || '派单失败')
    }
  }

  return (
    <Modal title="直发工单（通路 B）" open={open} onCancel={onClose} onOk={submit} okText="派出" width={620}>
      {contextHolder}
      <AlertNote />
      <Form form={form} layout="vertical">
        <Form.Item name="title" label="工单标题" rules={[{ required: true, message: '一句话说清要办什么事' }]}>
          <Input maxLength={40} showCount placeholder="如：周五消防演练场地布置" />
        </Form.Item>
        <Form.Item name="desc" label="任务说明" rules={[{ required: true }]}>
          <Input.TextArea rows={3} maxLength={300} showCount placeholder="做到什么程度算完成" />
        </Form.Item>
        <Form.Item label="派给谁" required>
          <Radio.Group value={targetKind} onChange={(e) => setTargetKind(e.target.value)}>
            <Radio.Button value="du">派给 DU（其内人员可认领）</Radio.Button>
            <Radio.Button value="hu">指定到人</Radio.Button>
          </Radio.Group>
        </Form.Item>
        {targetKind === 'du' ? (
          <Form.Item name="dispatchDuId" label="接单 DU" rules={[{ required: true, message: '选择接单部门' }]}>
            <Select
              placeholder="选择接单 DU"
              options={st.dus.map((d) => ({ value: d.id, label: `${d.name}（${DU_TYPE_META[d.type].label}DU）` }))}
            />
          </Form.Item>
        ) : (
          <Form.Item name="dispatchHuId" label="接单人（HU）" rules={[{ required: true, message: '选择具体接单人' }]}>
            <Select
              showSearch optionFilterProp="label" placeholder="输入姓名搜索"
              options={st.hus.map((h) => {
                const du = st.dus.find((d) => d.id === h.duId)!
                return { value: h.id, label: `${h.name} · ${du.name}` }
              })}
            />
          </Form.Item>
        )}
        <Form.Item name="promiseDate" label="承诺完成时间" rules={[{ required: true, message: '承诺时间是超时判定基准' }]} initialValue={dayjs().add(2, 'day')}>
          <DatePicker style={{ width: 200 }} />
        </Form.Item>
        <Form.Item name="dueHours" label="预计工时（小时）" initialValue={8} rules={[{ required: true }]}>
          <InputNumber min={1} max={160} style={{ width: 140 }} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

function AlertNote() {
  return (
    <div style={{ background: '#F6F6F6', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: 'rgba(0,0,0,0.6)', marginBottom: 16 }}>
      直发适用：单一动作、派发人自己验收、无需第三方看承诺。派给 DU 的单由其内 HU 认领（先到先得）。
    </div>
  )
}
