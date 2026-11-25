# 部署示例

原版 easytier-web（API 和设备登记）加上托管本控制台的 Caddy，前后端同源。

| 文件 | 作用 |
| --- | --- |
| `docker-compose.yml` | 服务 `easytier-web`（`easytier/easytier:v2.7.1`，`--disable-registration`）和 `caddy`（`caddy:2`） |
| `Caddyfile` | `/api/*` 反向代理到 `easytier-web:11211`；其余路径托管 `dist/`；`/config.js` 不存在时返回空脚本 |
| `config.js.example` | 只有前端和 API 在同一注册域名的不同子域时才需要（[docs/guide.md](../docs/guide.md)「部署」） |

## 用法

在仓库根目录：

```sh
npm ci && npm run build                     # 生成 dist/
SITE_ADDRESS=console.example.com docker compose -f deploy/docker-compose.yml up -d
```

- `SITE_ADDRESS`：域名（Caddy 自动申请 HTTPS 证书）、`localhost`（默认，Caddy 本地 CA）或 `:80`（纯 HTTP，放在别的 TLS 终结之后时用）。
- 端口和路径可以用环境变量改：`ET_HTTP_PORT`（默认 80）、`ET_HTTPS_PORT`（443）、`ET_UDP_PORT`（设备登记，22020/udp）、`ET_DATA_DIR`（easytier-web 的数据目录，默认 `deploy/data`）、`ET_DIST_DIR`（默认 `dist`）。
- 原版内嵌前端默认不对外发布；需要保留作对照时，在 compose 里取消 `127.0.0.1:11211:11211` 那一行的注释。
- **全新的数据目录里有默认账号 `admin` / `admin`**（easytier-web 自带），第一次登录后立即在右上角菜单里修改密码。已有的数据目录（比如从旧版升级）沿用原来的账号。
- 已经在跑 easytier-web 的机器：不要用这个 compose 再起一个，只需要按 `Caddyfile` 的两条规则配置现有的反向代理（`/api/*` → easytier-web 的 11211 端口，其余 → `dist/`）。生产升级见 [`docs/upgrade-runbook.md`](../docs/upgrade-runbook.md)。

## 已验证

2026-11-24 在本机冒烟（`caddy:2`、`easytier/easytier:v2.7.1`、空的数据目录、改过的端口）：

```sh
npm run build
SITE_ADDRESS=:80 ET_HTTP_PORT=8088 ET_HTTPS_PORT=8443 ET_UDP_PORT=22120 ET_DATA_DIR=<空目录> \
  docker compose -f deploy/docker-compose.yml -p et-deploy-smoke up -d
```

| 检查 | 结果 |
| --- | --- |
| `caddy validate`（`SITE_ADDRESS=:80`） | `Valid configuration` |
| `curl -s localhost:8088/` | 200，含 `<div id="app">`，`Cache-Control: no-cache` |
| `curl localhost:8088/config.js` | 200 `text/javascript`；把 `dist/config.js` 临时移走后仍是 200、空内容 |
| `curl localhost:8088/api/v1/auth/check_login_status` | 401（经 Caddy 到达后端） |
| `/assets/*.js`（`Accept-Encoding: gzip`） | `Content-Encoding: gzip`，`Cache-Control: public, max-age=31536000, immutable` |
| `POST /api/v1/auth/register` | 403（`--disable-registration` 生效） |
| 浏览器打开 `http://localhost:8088/`，用默认的 `admin` / `admin` 登录 | 进入概览页 |

之后 `docker compose -p et-deploy-smoke down -v`，删除临时数据目录。
