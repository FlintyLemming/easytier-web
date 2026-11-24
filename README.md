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

## 概览页

登录后的首页（`/`）是整个设备群的概览：

- 四个统计数字：在线设备、网络、直连率、可更新设备（webhook 模式下只有在线设备和可更新设备两格）。
- 节点地图：按位置聚合设备，自动聚焦到设备集中的区域，远处的位置显示在两侧的边缘标记上，点击可切换到世界视图；悬停查看该位置的设备，点击跳到按城市筛选后的设备列表。
- 位置排行、需要关注（被拉黑后仍在尝试连接、未加入网络、长时间离线、可更新）和连接质量（最慢的中继连接）。

**位置精度。** easytier-web 内置的 GeoIP 库只能定位到国家，所以默认情况下地图上的点落在国家级位置（页面会给出提示）。要精确到城市：

1. 在 MaxMind 注册免费账号，下载 GeoLite2-City（`GeoLite2-City.mmdb`）。
2. 把它挂载进 easytier-web 容器，例如 `-v ./GeoLite2-City.mmdb:/app/GeoLite2-City.mmdb:ro`。
3. 在启动参数里加上 `--geoip-db /app/GeoLite2-City.mmdb`。

**数据来源。** 世界地图使用 [Natural Earth](https://www.naturalearthdata.com/)（公有领域）和 [world-atlas](https://github.com/topojson/world-atlas)（ISC）。城市坐标表用 `npm run geo` 重新生成。

## 测试环境

本地 Docker 测试环境（easytier-web v2.7.1 + 三个 easytier-core）的启动、账号、数据目录与返回结构说明见 [`testenv/README.md`](testenv/README.md)。

## 部署

见 Plan 6（尚未编写）：同源反向代理，把 `/api` 转发到 easytier-web。设计见 [`docs/superpowers/specs/`](docs/superpowers/specs/)。

## 许可证

LGPL-3.0-or-later，见 [`LICENSE`](LICENSE)。部分文件移植自 [EasyTier](https://github.com/EasyTier/EasyTier) v2.7.1，文件开头有标注。
