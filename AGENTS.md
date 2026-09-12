# 项目上下文

## 项目定位

**百业百态 OFD 履约中心**：知味生态履约协同平台，覆盖 **O 需求单 / F 履约单 / J 工单** 三单闭环。
业务范围：发单（O→F）→ 受理/执行/验收（F）→ 质检/确认（J 工单）→ 48 小时自动验收回写；
由六大 **DU（部门单元）** 归属数据、三类 **HU（操作层身份）** 切换与角色权限矩阵驱动。
对接资源底座（ERP 管资源账、不吸业务流），通过 Station 接口部署业务。

## 技术栈

- **前端**: Vite 7, React 18, TypeScript, Ant Design 5 + @ant-design/icons（品牌主色 `#FF6B35`，见 DESIGN.md）
- **状态**: Zustand 5（前端缓存 store；写动作调后端 API 成功后 refresh 重拉）
- **路由**: React Router 6（`BrowserRouter`，服务端 SPA fallback）
- **后端**: Express 4 + TypeScript + better-sqlite3（SQLite 持久化）+ JWT(jsonwebtoken) + bcryptjs
- **数据**: 统一响应 `{ code:0, data, message }`；token 走 `Authorization: Bearer`；前端 `src/services/http.ts` 注入

## 目录结构

```
├── scripts/                # 构建与启动脚本（脚手架内置）
│   ├── build.sh            # 生产构建（vite build + tsup server；--external better-sqlite3/vite/plugin-react）
│   ├── dev.sh              # 开发环境启动（Express + tsx watch + Vite 中间件）
│   └── start.sh            # 生产环境启动（node dist-server/server.js）
├── server/                 # Express 后端
│   ├── db.ts               # SQLite 数据层：建表 + 单号 O/F/J-YYYYMM-NNNN + 种子播种（8 DU/13 HU）
│   ├── services.ts         # 业务规则内核（三单状态机/三红灯/48h自动验收/直发/留痕/返工/自动关单）
│   ├── routes/api.ts       # 4 鉴权端点 + 18 业务端点（/api/auth/* /api/orders|ofds|jobs|msgs...）
│   ├── routes/index.ts     # 挂载 /api/health 与 api 路由
│   ├── server.ts           # Express 入口（4 参错误中间件 + JSON body + SPA fallback）
│   └── vite.ts             # Vite 中间件集成（dev/prod，configFile:false）
├── src/                    # 前端源码（React + AntD5）
│   ├── components/         # 通用组件（MeSwitch 身份切换、OrderCreateDrawer 发单、OfdCreate、JobCreate）
│   ├── core/               # 时间/三灯口径（time.ts / redlights.ts，与后端 services 对齐）
│   ├── pages/              # 路由页面（Login 登录、工作台/待办/订单/履约/工单/消息/人员）
│   ├── services/http.ts    # fetch 封装：token 注入、统一解包、401 清登录态
│   ├── services/api.ts     # API 单点接缝（所有方法走 /api/* HTTP）
│   ├── store.ts            # Zustand 缓存 + 异步写动作（login/quickLogin/refresh + 三单动作）
│   ├── types.ts            # 业务类型契约
│   ├── App.tsx             # 布局壳 + 路由 + 菜单权限 + 登录门禁
│   ├── main.tsx            # React Root 挂载（#root）
│   ├── theme.ts            # AntD ConfigProvider 主题（主色 #FF6B35）
│   └── styles.css          # 全局样式（覆盖 AntD 细节 + 通用工具类）
├── index.html              # 入口 HTML（#root + <title>百业百态 OFD履约中心</title>）
├── DESIGN.md               # 设计规范（活力橙工作台）
├── package.json            # 依赖（React18/AntD5/Zustand5/Router6/dayjs）
└── vite.config.ts          # Vite 配置（React 插件）
```

## 核心业务模型

- **三单闭环**: O(需求单)→F(履约单)→J(工单)；F 单有受理/执行/验收，J 单有质检/确认
- **组织模型**: 六大 DU（部门/归属）+ HU（操作层身份，三类）；菜单与动作按 角色权限矩阵 过滤
- **预警机制**: 三红灯（履约风险红灯/黄灯/待办）用于顶部指标与工单卡片
- **验收**: 48 小时超时自动验收回写
- **结算边界**: 履约完成后仅回写状态/结算单，系统不持仓、不经手资金

## 后端与数据

- **数据库**: SQLite（better-sqlite3，同步 API）。文件优先持久化目录 `/app/data/ofd.db`，不可写回退 `/tmp`；开发环境用项目 `data/ofd.db`（已 gitignore）。
- **表**: `dus/hus/orders/ofds/jobs/msgs`；`deliverables`/`trace`/`attachments` 以 JSON 文本列内嵌，读写经 `orderFromRow/ofdFromRow/jobFromRow` 反序列化。
- **单号**: `nextDocNo('O'|'F'|'J')` 生成 `前缀-YYYYMM-NNNN`（按月重置序列，存 `doc_seq` 表）。
- **种子**: `seedIfEmpty()` 仅在空库播种 8 DU + 13 名可登录 HU（密码 bcrypt，内测统一 `ofd123456`）+ 演示单据；重复启动不覆盖。
- **业务规则统一收口在 `server/services.ts`**（前端 store 只做缓存 + 调 API）：
  - 三红灯口径同 `src/core/redlights.ts`：`noAccept`（waitAccept 超 48h）、`idle`（working/blocked 有责任人且距上次进度/接单超 24h）、`stuckCheck`（ofd.awaitSince 超 48h）。
  - 48h 自动验收：`sweepAutoAccept()`（列表/引导时）与 `autoAcceptIfDue(ofdId)`（查详情时）惰性触发，未决交付物系统判 pass 并自动关单。
  - 直发通路 B：同 DU 单一动作 → `POST /api/orders {direct:true}` 直接生成 `isDirect` 工单（ofdId/orderId 为 null），**不落需求单列表**。
  - 接单反填承诺：`promiseOriginal` 留痕；验收意见必填；退回一项 → 关联工单 `rework` 且 `reworkCount+1`；交付物全 pass → F/J/O 自动 closed；撤回仅 `submitted`。

## 鉴权

- `POST /api/auth/login`（huId + bcrypt 密码）、`POST /api/auth/quick-login`（内测一键登录）返回 `{token, hu}`；`GET /api/auth/me`、`GET /api/auth/quick-logins`。
- 业务端点全部经 `auth` 中间件校验 JWT；前端 token 存 localStorage（`ofd_token`），`src/services/http.ts` 自动带 `Authorization`，401 清登录态。
- 身份切换（MeSwitch）= 调 quick-login 换发目标身份 token。

## 包管理规范

**仅允许使用 pnpm**，严禁 npm/yarn。安装：`pnpm add <pkg>` / `pnpm add -D <pkg>`。

## 开发规范

- 使用 AntD5 组件与 `@ant-design/icons`；样式细节在 `styles.css` 覆盖。
- 遵循《DESIGN.md》设计规范（活力橙主色、AntD 语义状态色、克制动效）。
- 默认按 TypeScript `strict` 心智写代码；新增业务先补 `types.ts` 契约，再写 `store.ts` 动作。
- UI 通用封装放 `src/components/common.tsx`，页面放 `src/pages/`，数据接缝统一走 `services/api.ts`。

### 关键排障约定（勿改）

- **Vite 中间件模式必须 `configFile: false`**（见 `server/vite.ts`）：`createViteServer` 内联配置已带入
  `vite.config.ts` 的 `plugins:[react()]`，同时置为 `configFile:false`，禁止 Vite 二次加载配置文件，
  否则 `mergeConfig` 会把插件数组拼成两份，导致 @vitejs/plugin-react 的 HMR refresh preamble 重复注入，
  所有 `.tsx` 转换报 `$RefreshReg$ / inWebWorker has already been declared`。
- **Express 错误处理中间件必须 4 参** `(err, req, res, next)`：Express 靠参数个数识别错误处理器，
  写成 3 参会被当普通中间件，形参错位使 `res` 实为 `next`，抛 `res.status is not a function`。
- **tsup 打包 server 时 `vite.config` 不应被静态 import**：`server/vite.ts` 内联配置（不 import
  `vite.config`），并保持 tsup `--external vite --external @vitejs/plugin-react --external better-sqlite3`，
  阻断 babel 链进 bundle，且让 better-sqlite3 原生模块在运行时从 node_modules 加载（不打进 CJS）。
- **SPA fallback**：React Router 用 `BrowserRouter`，生产静态服务必须将非 `/api`、非静态资源路径
  fallback 到 `index.html`，否则 `/todo`、`/orders` 等深链刷新会 404。