import type { ThemeConfig } from 'antd'

/** 主题配置：主色 #FF6B35（用户 UI 偏好），全部色值集中在此文件，禁止组件内散落取色 */
export const BRAND = '#FF6B35'

export const themeConfig: ThemeConfig = {
  token: {
    colorPrimary: BRAND,
    colorInfo: BRAND,
    colorLink: BRAND,
    borderRadius: 6,
    fontSize: 14,
    // 语义色沿用 antd 默认（成功/警告/危险），保证可读性
  },
  components: {
    Table: { headerBg: '#FFF4EE', rowHoverBg: '#FFF9F5', cellPaddingBlockMD: 12 },
    Layout: { headerBg: '#fff', headerHeight: 56, siderBg: '#26262B' },
    Menu: { darkItemBg: '#26262B', darkItemSelectedBg: BRAND, darkItemColor: 'rgba(255,255,255,0.72)' },
    Card: { paddingLG: 20 },
  },
}
