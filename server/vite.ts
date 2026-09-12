// ABOUTME: Vite integration for Express server
// ABOUTME: Handles dev middleware and production static file serving

import type { Application, Request, Response } from 'express';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer, type UserConfig } from 'vite';

const isDev = process.env.COZE_PROJECT_ENV !== 'PROD';

/**
 * 集成 Vite 开发服务器（中间件模式）
 *
 * 注意：vite.config（含 @vitejs/plugin-react，其下游依赖 @babel/core）仅在 dev 环境需要。
 * 因此在函数内部动态 import（生产 tsup 打包走 setupStaticServer，不触发本函数，
 * 不会把 babel 链打进 server bundle，从而规避 esbuild 解析
 * `@babel/preset-typescript/package.json` 失败的部署报错）。
 */
export async function setupViteMiddleware(app: Application) {
  const { default: viteConfig } = await import('../vite.config');

  const vite = await createViteServer({
    ...viteConfig,
    // 内联配置已通过 viteConfig 带入 plugins（含 @vitejs/plugin-react），
    // 必须禁止 Vite 再次按 root 加载 vite.config.ts：否则 mergeConfig 会把 plugins
    // 数组拼接成两份，React refresh preamble 被注入两次，导致 .tsx 转换报错
    // （$RefreshReg$ / inWebWorker 重复声明）。
    configFile: false,
    root: process.cwd(),
    server: {
      ...viteConfig.server,
      middlewareMode: true,
    },
    appType: 'spa',
  } as UserConfig);

  // 使用 Vite middleware
  app.use(vite.middlewares);

  console.log('🚀 Vite dev server initialized');
}

/**
 * 设置生产环境静态文件服务
 */
export function setupStaticServer(app: Application) {
  const distPath = path.resolve(process.cwd(), 'dist');

  if (!fs.existsSync(distPath)) {
    console.error('❌ dist folder not found. Please run "pnpm build" first.');
    process.exit(1);
  }

  // 1. 服务静态文件（如果存在对应文件则直接返回）
  app.use(express.static(distPath));

  // 2. SPA fallback - 所有未处理的请求返回 index.html
  // 到达这里的请求说明：
  //   - 不是 API 请求（已被前面注册的路由处理）
  //   - 不是静态文件（express.static 未找到对应文件）
  //   - 需要返回 index.html 让前端路由处理
  app.use((_req: Request, res: Response) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });

  console.log('📦 Serving static files from dist/');
}

/**
 * 根据环境设置 Vite
 */
export async function setupVite(app: Application) {
  if (isDev) {
    await setupViteMiddleware(app);
  } else {
    setupStaticServer(app);
  }
}
