#!/bin/bash
set -Eeuo pipefail

COZE_WORKSPACE_PATH="${COZE_WORKSPACE_PATH:-$(pwd)}"

cd "${COZE_WORKSPACE_PATH}"

echo "Installing dependencies..."
pnpm install --prefer-frozen-lockfile --prefer-offline --loglevel debug --reporter=append-only

echo "Building frontend with Vite..."
pnpm vite build

echo "Bundling server with tsup..."
# external：
#  - vite / @vitejs/plugin-react：vite.config（含 plugin-react/babel）仅 dev 需要，生产走静态服务；
#    不 external 会把 babel 链打进 bundle，esbuild 解析 @babel/preset-typescript/package.json 失败。
#  - better-sqlite3：原生模块（.node），不能被 esbuild 打包，运行时从 node_modules 加载。
pnpm tsup server/server.ts --format cjs --platform node --target node20 --outDir dist-server --no-splitting --no-minify \
  --external vite --external @vitejs/plugin-react --external better-sqlite3

echo "Build completed successfully!"
