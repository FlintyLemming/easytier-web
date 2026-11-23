# 本地 Docker 测试环境

一个 `easytier-web` 容器（`web`）加三个 `easytier-core` 容器（`core1`、`core2`、`core3`）。

## 启动与停止

```sh
docker compose -f testenv/docker-compose.yml up -d     # 启动
docker compose -f testenv/docker-compose.yml down      # 停止（数据保留在 testenv/data）
```

## 切换标签

用环境变量选择镜像标签（默认 web 为新版，core 为旧版）：

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `ET_WEB_TAG` | `v2.7.1` | web 容器镜像标签 |
| `ET_CORE_TAG` | `v2.6.4` | core 容器镜像标签 |
| `ET_DATA_DIR` | `./data` | 挂载到 web 容器 `/app` 的目录（含 `et.db`） |

例如用旧版 web 播种旧数据，再升级到新版：

```sh
ET_WEB_TAG=v2.6.4 docker compose -f testenv/docker-compose.yml up -d
docker compose -f testenv/docker-compose.yml down
ET_WEB_TAG=v2.7.1 docker compose -f testenv/docker-compose.yml up -d
```

## 账号与地址

- 管理员账号：`admin` / `admin`（登录时密码先做 MD5，`21232f297a57a5a743894a0e4a801fc3`）
- 旧前端（内嵌）：http://localhost:11211/
- API：`http://localhost:11211/api/v1/...`，设备登记端口 `22020/udp`
- 固定 machine id：core1 `11111111-1111-4111-8111-111111111111`，core2 `22222222-2222-4222-8222-222222222222`，core3 `33333333-3333-4333-8333-333333333333`

## 升级、关卡与回滚

升级 web 并跑可行性关卡（只动 web，core1..3 不重启）：

```sh
bash testenv/upgrade.sh v2.6.4 v2.7.1   # 停止 web → 把 testenv/data/ 整个复制到 testenv/backups/<时间戳>/ → 用 v2.7.1 启动 web，最后打印备份路径
node testenv/gate-check.ts              # 报告写到 testenv/reports/gate-<日期>.md，第一行 GATE: PASS / GATE: FAIL；通过时退出码 0
```

同一天重跑会重新生成报告，但 `<!-- manual notes below are preserved by gate-check -->` 这一行及以下的人工补充内容会原样保留。

回滚：web v2.6.4 打不开 v2.7.1 迁移过的数据库（启动即 panic：`Migration file of version '...' is missing`），所以必须恢复升级前的备份，路径就是升级时打印的那个：

```sh
bash testenv/upgrade.sh v2.7.1 v2.6.4                                  # 切回 v2.6.4（会先把 v2.7.1 的数据再备份一份）
docker compose -f testenv/docker-compose.yml stop web                  # 先停止 web
rm -rf testenv/data && cp -a testenv/backups/<时间戳> testenv/data       # 再把备份复制回 testenv/data/（整个目录替换）
ET_WEB_TAG=v2.6.4 docker compose -f testenv/docker-compose.yml up -d web
node testenv/seed-legacy.ts                                            # 期望 skipped 4 existing / 3 running
```

要整个目录替换，不要把备份覆盖复制到旧目录上：`et.db-wal`、`et.db-shm` 必须和 `et.db` 是同一份，混入 v2.7.1 留下的 WAL 文件会损坏数据库。

## 重新抓取 v2.7.1 中央网络模式 fixtures

fixtures 是对真实 API 响应的原样抓取（已解析 JSON，2 空格缩进），放在 `tests/fixtures/v2.7.1/`，供 Playwright mock 和单元测试使用。要在全新的 v2.7.1 环境（web v2.7.1，core v2.6.4）上重新抓取：

```sh
docker compose -f testenv/docker-compose.yml down
rm -rf testenv/data-central                     # 要全新环境就删掉旧数据；脚本对已有 home-central 网络可重跑
ET_DATA_DIR=./data-central docker compose -f testenv/docker-compose.yml up -d
node testenv/capture-fixtures.ts                # 约 1~3 分钟；中间会临时起 et-core4 并拉黑，结束后自动删除
node --test testenv/capture-fixtures.test.ts
```

脚本会建网络 `home-central`（10.144.144.0/24），三台设备入网，core1 固定 `10.144.144.1` 并监听 11010，core3 带 `proxy_cidrs` 和 `hostname_override: lab-box`，写入一条 ACL 规则，并产生一条被拉黑设备的记录。

| 文件 | 对应接口 |
| --- | --- |
| `console-info.json` | `GET /console-info` |
| `summary.json` | `GET /summary` |
| `machines.json` | `GET /machines` |
| `networks.json` | `GET /networks` |
| `network.json` | `GET /networks/{id}` |
| `members.json` | `GET /networks/{id}/members` |
| `member-config-core3.json` | `GET /networks/{id}/members/{core3}/config` |
| `acl-policy.json` | `GET /networks/{id}/acl-policy` |
| `gateway-info.json` | `GET /networks/gateway-info` |
| `blocked-devices.json` | `GET /blocked-devices` |
| `list-route-core1.json` | `POST /machines/{core1}/proxy-rpc`，`PeerManageRpcService.list_route` |
| `list-peer-core1.json` | `POST /machines/{core1}/proxy-rpc`，`PeerManageRpcService.list_peer` |
| `show-node-info-core3.json` | `POST /machines/{core3}/proxy-rpc`，`PeerManageRpcService.show_node_info` |
| `logger-level.json` | `POST /machines/{core1}/proxy-rpc`，`api.logger.LoggerRpcService.get_logger_config` |
| `index.json` | 非接口：`{ networkId, machines: {core1, core2, core3} }` |
