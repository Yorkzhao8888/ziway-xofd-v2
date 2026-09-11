import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 开发期由 Express 以 middleware 模式挂载（见 server/vite.ts），不单独监听端口；
// 下列 server 配置仅在独立运行 vite 时生效，HMR 走沙箱约定路径 /hot/vite-hmr。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5000,
    host: '0.0.0.0',
    allowedHosts: true,
    hmr: {
      overlay: true,
      path: '/hot/vite-hmr',
      port: 6000,
      clientPort: 443,
      timeout: 30000,
    },
    watch: {
      usePolling: true,
      interval: 100,
    },
  },
});
