// ABOUTME: Express 服务入口 — 单端口同时提供 API 与前端（开发期 Vite middleware / 生产期静态产物）
import { createServer, type Server } from 'http';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import router from './routes/index';
import { setupVite } from './vite';
import { config } from './config';
import { closeDb, getDb } from './db';

const app = express();
// 使用 http.createServer 包装 Express app，以便支持 WebSocket 等协议升级
const server = createServer(app);

async function startServer(): Promise<Server> {
  // 初始化数据库（含迁移）
  getDb();
  console.log(`[db] ready at ${config.dbPath}`);

  // 请求日志（仅开发环境）
  if (!config.isProd) {
    app.use((req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        const ms = Date.now() - start;
        console.log(`${req.method} ${req.url} - ${res.statusCode} - ${ms}ms`);
      });
      next();
    });
  }

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // API 路由
  app.use(router);

  // 集成 Vite（开发模式）或静态文件服务（生产模式）
  await setupVite(app);

  // 全局错误处理（必须为 4 参数签名，Express 据此识别）
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Server error:', err);
    const status = 'status' in err ? (err as { status?: number }).status ?? 500 : 500;
    res.status(status).json({
      error: err.message || 'Internal server error',
    });
  });

  server.once('error', err => {
    console.error('Server error:', err);
    process.exit(1);
  });

  server.listen(config.port, '0.0.0.0', () => {
    console.log(`\n  X-OFD v2 履约中枢`);
    console.log(`  server:  http://localhost:${config.port}`);
    console.log(`  env:     ${config.env}\n`);
  });

  return server;
}

function shutdown(signal: string): void {
  console.log(`\n${signal} received, shutting down...`);
  server.close(() => {
    closeDb();
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
