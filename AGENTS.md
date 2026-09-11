# AGENTS.md — 知味生态 X-OFD v2 履约中枢

## 项目概览

O/F/J 三单闭环的全栈履约中枢：前端 React 18 + Ant Design 5 + Vite + TypeScript + Zustand；后端 Node + TypeScript + Express + better-sqlite3。身份接入生态统一认证 **OAS（RS256 JWT 验签）**，**不自建任何用户/登录/注册体系**。

当前为**项目骨架（基座）阶段**：单端口全栈框架、OAS 认证管线、数据库迁移机制、三单菜单布局均已就位并跑通；业务表与业务页面等发单方下发执行指令后追加。

> 需求单原文在外部 Drive（/Coze/Drive/ziway-bos/ofd_v2/建站需求单_XOFD_v2_20260911.md），沙箱内不可达；以下待确认项需发单方补充。

## 技术栈

- 前端：React 18、Ant Design 5（zhCN locale，自定义生态绿主题）、React Router 6、Zustand 5（persist）、axios、dayjs、Vite 7
- 后端：Express 4、better-sqlite3（WAL + foreign_keys）、jsonwebtoken、jwks-rsa、tsx（开发）/ tsup（打包）
- 包管理：**仅允许 pnpm**，禁止 npm/yarn
- 设计规范见 `DESIGN.md`

## 构建与运行（由 .coze 驱动，单端口 5000）

- 开发：`pnpm dev` → `scripts/dev.sh`（`PORT=$DEPLOY_RUN_PORT tsx watch server/server.ts`），Express 以 Vite middleware 模式挂载前端，HMR 路径 `/hot/vite-hmr`，**API 与页面同源无跨域**
- 构建：`pnpm build` → `scripts/build.sh`（`pnpm install` → `vite build` 前端 → `tsup` 打包服务端到 `dist-server/`，vite/express 等运行时依赖保持 external）
- 生产：`pnpm start` → `scripts/start.sh`（`PORT=$DEPLOY_RUN_PORT node dist-server/server.js`，Express 托管 `dist/` 静态产物 + SPA fallback）
- 检查：`pnpm ts-check`（tsc）、`pnpm lint --quiet`（eslint，含 import/no-cycle）

## 目录结构

```
├── server/
│   ├── config.ts          # 环境变量集中读取（端口/DB/OAS），禁止业务代码硬编码
│   ├── db.ts              # better-sqlite3 单例（WAL、外键、启动迁移）
│   ├── migrations/
│   │   └── index.ts       # 顺序迁移框架：迁移对象追加到 migrations 数组，id 递增，禁止改已发布迁移
│   ├── auth/
│   │   ├── oas.ts         # OAS RS256 验签（JWKS 或 PEM 公钥二选一）+ claim → OasUser 映射
│   │   └── middleware.ts  # requireOasAuth：Bearer 提取，失败统一 401（无 Mock 放行）
│   ├── routes/
│   │   ├── health.ts      # GET /api/health（无需认证）
│   │   ├── auth.ts        # GET /api/auth/config、GET /api/auth/me（需认证）
│   │   └── index.ts
│   ├── server.ts          # 入口：DB 初始化 → 中间件 → API → Vite/静态 → 错误处理
│   └── vite.ts            # 开发 middleware / 生产静态托管（模板自带，勿改端口约定）
├── src/
│   ├── App.tsx            # ConfigProvider 主题（#159947）+ 路由 + AuthGate
│   ├── layout/MainLayout.tsx  # 深色 Sider（O/F/J 菜单）+ Header + Content
│   ├── store/auth.ts      # Zustand 认证态：hash token 回跳、localStorage、bootstrap 验签
│   ├── lib/http.ts        # axios 实例；token/401 处理通过 setAuthHandlers 注册（防循环依赖）
│   ├── api/auth.ts        # 认证/健康 API 封装
│   ├── pages/             # Dashboard、LoginRequired、OrderPlaceholder（O/F/J 占位）
│   └── types/index.ts
└── scripts/               # dev/build/start 脚本（.coze 引用，勿改端口约定）
```

## 关键约定

### 端口与环境变量
- 服务端口从 `PORT` 读（脚本由 `DEPLOY_RUN_PORT` 注入），禁止硬编码。
- 配置项（均在 `server/config.ts` 读取，支持 `.env`）：
  - `DB_PATH`：SQLite 路径；默认开发 `./data/xofd-v2.db`、生产 `/tmp/xofd-v2.db`（/tmp 会被定期清理，**持久化卷待确认**）
  - OAS 认证（二选一）：`OAS_JWKS_URI`（JWKS 端点，推荐）或 `OAS_PUBLIC_KEY_PEM`（PEM，换行可写 `\n`）
  - 可选：`OAS_ISSUER`、`OAS_AUDIENCE`、`OAS_LOGIN_URL`（统一认证登录页）
  - claim 映射：`OAS_CLAIM_USER_ID`(sub)、`OAS_CLAIM_USERNAME`(preferred_username)、`OAS_CLAIM_DISPLAY_NAME`(name)、`OAS_CLAIM_TENANT_ID`(tenant_id)

### 认证铁律
- 所有受保护接口必须挂 `requireOasAuth`；OAS 未配置/无 token/验签失败一律 **401**，严禁 Mock 用户或匿名放行。
- 前端无自建登录/注册表单；未认证展示 `LoginRequired`（「前往统一认证登录」按钮，地址取 `/api/auth/config` 的 `loginUrl`）。
- token 回跳约定：前端暂从 URL hash 的 `access_token`/`token` 读取（`store/auth.ts`），**实际回跳参数名/位置待发单方确认**。

### 新增业务（后续执行指令落地时）
1. 数据表：在 `server/migrations/index.ts` 的 `migrations` 数组追加新对象（id 递增），启动自动迁移。
2. 接口：`server/routes/` 新建路由模块，挂到 `routes/index.ts`；受保护路由用 `requireOasAuth`。
3. 页面：`src/pages/` 新增页面，在 `App.tsx` 注册路由、在 `MainLayout.tsx` 菜单项登记。
4. 数据流：`src/api/*.ts`（axios 封装）→ `src/store/*.ts`（Zustand）→ 页面；组件全部 TS 严格类型，禁止 any。

## 待发单方确认清单

1. 完整建站需求单原文（O/F/J 三单的字段、状态机、闭环规则、页面清单）
2. OAS 对接参数：JWKS URI / 公钥、issuer、audience、登录页 URL、回跳方式与 claim 字段名
3. O/F/J 三单的中文业务全称与色标语义（当前 O=订单/绿、F=履约/蓝、J=结算/琥珀黄为占位）
4. 生产环境 SQLite 持久化方案（/tmp 为临时目录，是否挂载持久卷或换外部数据库）
5. 是否需要生态侧其他角色/权限分级、操作审计日志要求
