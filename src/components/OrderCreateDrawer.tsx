import { useState } from 'react'
import {
  Drawer, Form, Input, Select, DatePicker, Upload, Button, Radio, Alert, Space, Result, message,
} from 'antd'
import { UploadOutlined, SendOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import { useStore } from '../store'
import { DU_TYPE_META } from '../types'

const msgApi = message

/** 发单抽屉（PRD M2）：入口挂在需求单列表页「发单」按钮上，系统按规则智能判别走 A（全链路）还是 B（直发），可手改（M2-2）
 *  说明：发单发的是需求单（跨 DU → 全链路）；同 DU 单一动作由系统判定直发工单（通路 B）。
 */
export default function OrderCreateDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const st = useStore()
  const me = st.currentHu()
  const navigate = useNavigate()
  const [form] = Form.useForm()
  const [mode, setMode] = useState<'auto' | 'chain' | 'direct'>('auto')
  const [targetKind, setTargetKind] = useState<'du' | 'hu'>('du')
  const [submitting, setSubmitting] = useState(false)
  const [created, setCreated] = useState<{ id: string; jobId?: string; direct: boolean } | null>(null)

  const others = st.dus.filter((d) => d.id !== me.duId)

  // auto 模式默认按全链路兜底；judgeHint 给出建议，用户可手动改
  const effective = mode === 'auto' ? 'chain' : mode

  // 表单值镜像：judgeHint 由此驱动，避免在成功页（表单已卸载）触碰 form 实例
  // （form.getFieldValue 对未挂载表单调用会触发 rc-field-form 的 console warning）
  const [targetDuVal, setTargetDuVal] = useState<string>()
  const [targetHuVal, setTargetHuVal] = useState<string>()

  // 系统判定提示（跟随表单值实时变化；跨 DU 走全链路、同 DU 建议直发）
  const judgeHint = (() => {
    const crossBody = targetKind === 'du' ? targetDuVal : targetHuVal
    if (!crossBody) return null
    const targetDuId = targetKind === 'du' ? targetDuVal : (st.huById(targetHuVal ?? '')?.duId ?? null)
    if (targetDuId === me.duId) {
      return { direct: true, text: '目标与你在同一 DU：建议「直发工单」（跳过需求单/履约单，派发即达）' }
    }
    return { direct: false, text: '跨 DU 协作：建议「全链路」（需求单 → 履约单 → 工单，全程留痕可验收）' }
  })()

  /** 关抽屉并重置全部表单状态（下次打开是干净表单） */
  const closeAndReset = () => {
    setCreated(null)
    setMode('auto')
    setTargetKind('du')
    setTargetDuVal(undefined)
    setTargetHuVal(undefined)
    form.resetFields()
    onClose()
  }

  const onFinish = async (vals: any) => {
    setSubmitting(true)
    try {
      const targetDuId = targetKind === 'du' ? vals.targetDuId : (st.huById(vals.targetHuId ?? '')?.duId ?? null)
      const targetHuId = targetKind === 'hu' ? vals.targetHuId : null
      const sameDu = targetDuId === me.duId
      const direct = effective === 'direct' || (mode === 'auto' && sameDu)
      const expectDate = vals.expectDate.format('YYYY-MM-DD')

      // 直发：后端不落需求单，直接生成 isDirect 工单（一次请求）
      const r = await st.createOrder({
        title: vals.title,
        desc: vals.desc,
        targetDuId: direct ? null : targetDuId,
        targetHuId: direct ? null : targetHuId,
        expectDate,
        attachments: (vals.attachments ?? []).map((f: any) => f.name),
        direct,
        // 直发所需的派单参数
        dispatchDuId: direct && !targetHuId ? targetDuId : null,
        dispatchHuId: direct ? targetHuId : null,
        promiseDate: expectDate,
        dueHours: 8,
      })
      if (direct) {
        setCreated({ id: r.job?.id ?? '', jobId: r.job?.id ?? '', direct })
      } else {
        setCreated({ id: r.order?.id ?? '', direct })
      }
    } catch (e: any) {
      msgApi.error(e?.message || '发单失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Drawer
      title="发单"
      open={open}
      onClose={closeAndReset}
      width={720}
      destroyOnClose={false}
    >
      {created ? (
        <Result
          status="success"
          title={`已提交 ${created.direct ? created.jobId : created.id}`}
          subTitle={created.direct
            ? '系统按「同 DU 单一动作」判定为直发：已直接生成工单，对方接单后即可开工。'
            : '已进入履约编排：接单方 DU 受理后将编制履约单（交付物清单 + 验收标准 + 承诺时间），再拆工单派发。'}
          extra={[
            <Button type="primary" key="view" onClick={() => { closeAndReset(); navigate(created.direct ? `/job/${created.jobId}` : `/order/${created.id}`) }}>
              {created.direct ? '查看工单' : '查看需求单'}
            </Button>,
            <Button key="again" onClick={() => { setCreated(null); form.resetFields(); setTargetDuVal(undefined); setTargetHuVal(undefined); setMode('auto') }}>再发一单</Button>,
            <Button key="list" type="text" onClick={closeAndReset}>返回列表</Button>,
          ]}
        />
      ) : (
        <>
          <Alert
            style={{ marginBottom: 20 }}
            type="info" showIcon
            message="发的是需求单：写清楚要什么 + 选准派给谁。附件、验收标准这些可以在履约阶段补。"
          />
          <Form
            form={form}
            layout="vertical"
            onFinish={onFinish}
            initialValues={{ mode: 'auto' }}
          >
            <Form.Item name="title" label="需求标题" rules={[{ required: true, message: '一句话说清要办什么事' }]}>
              <Input maxLength={40} showCount placeholder="如：科技园店收银机故障排查" />
            </Form.Item>

            <Form.Item name="desc" label="需求描述" rules={[{ required: true, message: '写清背景与要达到的效果，接单方按这个理解干活' }]}>
              <Input.TextArea rows={4} maxLength={500} showCount placeholder="背景：现在遇到什么问题 → 期望：做到什么程度算完成" />
            </Form.Item>

            <Form.Item label="派给谁" required>
              <Radio.Group value={targetKind} onChange={(e) => setTargetKind(e.target.value)}>
                <Radio.Button value="du">派给 DU（其内人员可接）</Radio.Button>
                <Radio.Button value="hu">指定到人</Radio.Button>
              </Radio.Group>
            </Form.Item>

            {targetKind === 'du' ? (
              <Form.Item
                name="targetDuId" label="接单 DU" rules={[{ required: true, message: '选择接单部门' }]} key="kind-du"
              >
                <Select
                  placeholder="选择接单 DU"
                  onChange={(v) => setTargetDuVal(v)}
                  options={others.map((d) => ({ value: d.id, label: `${d.name}（${DU_TYPE_META[d.type].label}DU）` }))}
                />
              </Form.Item>
            ) : (
              <Form.Item
                name="targetHuId" label="接单人（HU）" rules={[{ required: true, message: '选择具体接单人' }]} key="kind-hu"
              >
                <Select
                  showSearch optionFilterProp="label"
                  placeholder="输入姓名搜索"
                  onChange={(v) => setTargetHuVal(v)}
                  options={st.hus.map((h) => {
                    const du = st.dus.find((d) => d.id === h.duId)!
                    return { value: h.id, label: `${h.name} · ${du.name}` }
                  })}
                />
              </Form.Item>
            )}

            <Space size={24} align="start" style={{ display: 'flex', flexWrap: 'wrap' }}>
              <Form.Item name="expectDate" label="期望完成时间" rules={[{ required: true, message: '没有期限就无法判超时' }]}>
                <DatePicker disabledDate={(d) => d.isBefore(dayjs(), 'day')} />
              </Form.Item>
              <Form.Item name="attachments" label="附件（可选）" valuePropName="fileList" getValueFromEvent={(e) => (Array.isArray(e) ? e : e?.fileList)}>
                <Upload beforeUpload={() => false} maxCount={3}>
                  <Button icon={<UploadOutlined />}>上传附件</Button>
                </Upload>
              </Form.Item>
            </Space>

            {judgeHint && (
              <Alert
                style={{ marginBottom: 20 }}
                type={judgeHint.direct ? 'success' : 'info'}
                showIcon
                message={`系统判定：${judgeHint.text}`}
                description={
                  <Radio.Group
                    value={effective}
                    onChange={(e) => setMode(e.target.value)}
                    style={{ marginTop: 8 }}
                    options={[
                      { label: '按建议（自动）', value: 'auto' },
                      { label: '全链路（需求单→履约单→工单）', value: 'chain' },
                      { label: '直发工单', value: 'direct' },
                    ]}
                    optionType="button"
                    buttonStyle="solid"
                    size="small"
                  />
                }
              />
            )}

            <Space>
              <Button type="primary" htmlType="submit" icon={<SendOutlined />} loading={submitting}>
                提交
              </Button>
              <Button onClick={closeAndReset}>取消</Button>
              <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)' }}>
                归属字段由系统后台预留（可空），接入 V/X 模块后自动回填，无需你填写
              </span>
            </Space>
          </Form>
        </>
      )}
    </Drawer>
  )
}
