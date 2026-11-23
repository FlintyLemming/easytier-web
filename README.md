# EasyTier Web Console

EasyTier 的新 Web 控制台前端（Vue 3 + Vite + Tailwind）：登录、设备列表、设备详情（连接、此网络中的设置）。它直接对接 `easytier-web` v2.7.1 的 REST API（`/api/v1`）和 proxy-rpc，不引入任何第三方运行时请求（字体已打包）。

## 要求

- Node.js ≥ 23.6，npm
- Docker（仅用于本地测试环境）

## 开发

```sh
npm install
npm run dev          # http://localhost:5173，/api 代理到 easytier-web
ET_API=http://host:11211 npm run dev   # 指定后端（默认 http://localhost:11211）
```

## 测试

```sh
npm test             # 单元测试（vitest）
npm run typecheck    # vue-tsc
npm run e2e          # 带 mock 后端的 Playwright e2e（tests/e2e，端口 5198）
npm run codegen      # 由 proto/ 重新生成 TypeScript 类型
# 对接本地真实后端的冒烟测试（端口 5199）。首次需 `npx playwright install chromium`；
# 需要 ET_DATA_DIR=./data-central 的测试环境（其中已有 home-central 网络，见 testenv/README.md 的 capture 一节）：
ET_DATA_DIR=./data-central docker compose -f testenv/docker-compose.yml up -d
npx playwright test -c playwright.live.config.ts   # 后端地址默认 http://localhost:11211，可用 ET_LIVE_API 覆盖
```

## 测试环境

本地 Docker 测试环境（easytier-web v2.7.1 + 三个 easytier-core）的启动、账号、数据目录与返回结构说明见 [`testenv/README.md`](testenv/README.md)。

## 部署

见 Plan 6（尚未编写）：同源反向代理，把 `/api` 转发到 easytier-web。设计见 [`docs/superpowers/specs/`](docs/superpowers/specs/)。

## 许可证

LGPL-3.0-or-later，见 [`LICENSE`](LICENSE)。部分文件移植自 [EasyTier](https://github.com/EasyTier/EasyTier) v2.7.1，文件开头有标注。
