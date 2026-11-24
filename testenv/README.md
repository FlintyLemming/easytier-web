# 本地 Docker 测试环境

一个 `easytier-web` 容器（`web`）加三个 `easytier-core` 容器（`core1`、`core2`、`core3`）。

## 前置条件

- Docker（compose v2）。
- Node.js ≥ 23.6（本项目用 26）：testenv 的脚本是 `.ts` 文件，直接用 `node 文件.ts` 运行（Node 自带的类型剥离，无需构建；所以 import 必须写 `.ts` 后缀，只能用可擦除的 TS 语法）。

不需要 Docker 的离线测试（API 辅助库、fixtures 检查）：

```sh
node --test testenv/lib/api.test.ts testenv/capture-fixtures.test.ts
```

## 启动与停止

```sh
docker compose -f testenv/docker-compose.yml up -d     # 启动
docker compose -f testenv/docker-compose.yml down      # 停止（数据保留在 testenv/data）
```

`docker ps` 里 web 会显示 `unhealthy`：镜像自带的 healthcheck 探测的是 core 的 RPC 端口，而 web 容器跑的是 `easytier-web-embed`，没有这个端口。API 正常，可以忽略；但这意味着 `docker compose up --wait` 会因为 web 不健康而报错退出，不要用 `--wait`。

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
node testenv/seed-legacy.ts
bash testenv/upgrade.sh v2.6.4 v2.7.1   # 先备份数据目录，再只把 web 换成 v2.7.1
```

**注意：** 不带 `ET_WEB_TAG` 的 `docker compose ... up` 默认用 web v2.7.1。它一启动就会把挂载的数据库迁移到 v2.7.1 的结构，web v2.6.4 之后再也打不开这个库（启动即 panic）。所以对 2.6.4 的数据目录（默认 `testenv/data`）不要直接 `up`：切换版本一律用 `upgrade.sh`（它会先备份），能恢复的只有备份。

## 账号与地址

- 管理员账号：`admin` / `admin`（登录时密码先做 MD5，`21232f297a57a5a743894a0e4a801fc3`）
- 旧前端（内嵌）：http://localhost:11211/
- API：`http://localhost:11211/api/v1/...`，设备登记端口 `22020/udp`
- 固定 machine id：core1 `11111111-1111-4111-8111-111111111111`，core2 `22222222-2222-4222-8222-222222222222`，core3 `33333333-3333-4333-8333-333333333333`

## 升级、关卡与回滚

先在 web v2.6.4 上播种（会顺便抓升级前快照），再升级 web 并跑可行性关卡（`upgrade.sh` 只动 web，core1..3 不重启）：

```sh
node testenv/seed-legacy.ts             # web v2.6.4 上运行；输出 seeded/skipped、<M> running、snapshot: ...
bash testenv/upgrade.sh v2.6.4 v2.7.1   # 停止 web → 把 testenv/data/ 整个复制到 testenv/backups/<时间戳>/ → 用 v2.7.1 启动 web，最后打印备份路径
node testenv/gate-check.ts              # 报告写到 testenv/reports/gate-<日期>.md，第一行 GATE: PASS / GATE: FAIL；通过时退出码 0
```

`seed-legacy.ts` 往 `testenv/data/` 写两个文件：`seed-state.json`（各设备的 home / lab 实例 id）和 `seed-snapshot.json`（升级前快照：每个实例的 `GET /machines/{id}/networks/config/{inst}`，运行中的实例再加上 core 实际运行的 TOML，即 `show_node_info` 的 `config`）。快照只在 web 是 2.6.4 时抓，已有的记录不会被覆盖。两个文件都在数据目录里，所以会跟着数据库一起进备份、一起恢复。

关卡里的 G4b 会 `docker compose restart core1 core2 core3`，要求 90s 内 v2.7.1 把三个 home 实例重新下发并运行（core1 能路由到 core2、core3），core2 的 lab 一直不运行，然后把 TOML 和配置与升级前快照逐项比较。注意 `GET .../networks/config/{inst}` 对正在运行的实例返回的是 core 当前的配置（经 RPC 取），只有实例没运行时才读数据库里存的那份。

`GET /machines/{id}/networks` 的两个列表：`running_inst_ids` 是 core 上正在运行的实例；`disabled_inst_ids` 是 web 已保存、但 core 上当前没有在运行的实例（上游按“已保存的配置减去正在运行的”算出来），所以它不等于“已停用”：core 刚重启、实例还没重新下发时，启用的实例也会出现在这里。

同一天重跑会重新生成报告，但 `<!-- manual notes below are preserved by gate-check -->` 这一行及以下的人工补充内容会原样保留。

回滚：web v2.6.4 打不开 v2.7.1 迁移过的数据库（启动即 panic：`Migration file of version '...' is missing`），所以必须恢复升级前的备份，路径就是升级时打印的那个：

```sh
bash testenv/upgrade.sh v2.7.1 v2.6.4                                  # 切回 v2.6.4（会先把 v2.7.1 的数据再备份一份）
docker compose -f testenv/docker-compose.yml stop web                  # 先停止 web
rm -rf testenv/data && cp -a testenv/backups/<时间戳> testenv/data       # 再把备份复制回 testenv/data/（整个目录替换）
ET_WEB_TAG=v2.6.4 docker compose -f testenv/docker-compose.yml up -d web
node testenv/seed-legacy.ts                                            # 期望 skipped 4 existing / 3 running / snapshot: kept 4 existing
```

要整个目录替换，不要把备份覆盖复制到旧目录上：`et.db-wal`、`et.db-shm` 必须和 `et.db` 是同一份，混入 v2.7.1 留下的 WAL 文件会损坏数据库。

## 重新抓取 v2.7.1 中央网络模式 fixtures

fixtures 是对真实 API 响应的抓取（已解析 JSON，2 空格缩进），放在 `tests/fixtures/v2.7.1/`，供 Playwright mock 和单元测试使用。写入前会脱敏（`testenv/lib/redact.ts`）：STUN 的 `public_ip`、`ip_list.public_ipv4` 等真实公网地址换成文档地址（203.0.113.10、198.51.100.20…），ACL 的 `group_secret` 换成 `redacted-group-secret`；`capture-fixtures.test.ts` 会检查没有漏网的公网 IPv4 和 group_secret。脚本先把所有响应都拿到，再写进临时目录、整体挪到位，中途失败不会留下新旧混杂的文件。要在全新的 v2.7.1 环境（web v2.7.1，core v2.6.4）上重新抓取：

```sh
docker compose -f testenv/docker-compose.yml down
rm -rf testenv/data-central                     # 要全新环境就删掉旧数据；脚本对已有 home-central 网络可重跑
ET_DATA_DIR=./data-central docker compose -f testenv/docker-compose.yml up -d
node testenv/capture-fixtures.ts                # 约 1~3 分钟；中间会临时起 et-core4（镜像标签取 ET_CORE_TAG，默认 v2.6.4）并拉黑，结束后自动删除
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

## 实例相关的 fixtures

```sh
node testenv/capture-instance-fixtures.ts
```

需要 testenv 在运行，且中央网络已经抓过（`index.json`）。脚本在 core2 上用固定 id `5eed0000-0000-4000-8000-000000000001` 临时新建手动实例 `lab-manual`（IP `10.88.0.3/24`），抓取实例列表、元信息、配置、运行信息、VPN Portal 信息、停用后的运行信息、成员配置（必须为 `{}`）、`generate-config` / `parse-config`，并在 `finally` 里删除实例。生成 `instances-core2.json`、`instance-metas-core2.json`、`instance-config-core2.json`、`instance-info-core2.json`、`instance-info-disabled.json`、`member-config-empty.json`、`parse-config-ok.json`、`parse-config-error.json`、`generate-config-ok.json`、`vpn-portal-info-core2.json`。

注意：testenv 的 core 是 v2.6.4，只认旧版 VPN Portal 字段（`enable_vpn_portal` 等），v2.7 的 `vpn_portal_config` 会被静默丢弃；因此 `vpn-portal-info-core2.json` 是旧版形状（`client_config` 文本）。web v2.7.1 的 `generate-config` 拒绝旧字段，脚本改用 `vpn_portal_config` 调用它。

## 网络相关的 fixtures

```sh
node testenv/capture-network-fixtures.ts
```

需要 testenv 在运行。脚本临时新建一个安全模式网络 `fixture-secure`（Standalone，网段 `10.201.0.0/24`，密钥 `fixture-secure-secret`），生成两个凭据（`fixture-cred` 和一个一次性的），把 core3 加为临时成员并等它运行，然后抓取：`network-created.json`、`networks-two.json`、`network-secure.json`、`acl-policy-empty.json`、`credential-created.json`、`members-secure.json`、`credentials.json`。`finally` 里删除这个网络，并等 core3 撤下它的实例（约 30 秒）。

凭据密钥换成确定的占位值（按出现顺序 `base64("fixture-cred-1")`、`…-2`、`…-3`），到期时间平移到 2030-01-01 起，保持彼此的差值，这样 fixtures 每次抓取都一样。

## 观察到的响应形状（v2.7.1 web + 2.6.4 core）

写前端和 mock 时容易踩的地方，均以 `tests/fixtures/v2.7.1/` 为准：

- 成员的 `runtime_virtual_ipv4` 带前缀长度：`"10.144.144.1/24"`；`virtual_ipv4`、`allocated_ipv4` 不带。
- 64 位计数器是 JSON 字符串：`list_peer` 里 `stats.latency_us`（微秒）、`rx_bytes`、`tx_bytes`、`rx_packets`、`tx_packets` 都是 `"527"` 这样的字符串，要 `Number()` 再用。
- IPv4 有两种写法：`list_route` 的 `ipv4_addr` 是 `{ "address": { "addr": <u32，大端序> }, "network_length": 24 }`（177246209 = 10.144.144.1）；`show_node_info` 的 `ipv4_addr` 是字符串 `"10.144.144.3/24"`。
- 连接的 `is_closed` 为 false 时不出现（字段缺失）；`list_route` 里没有子网代理的路由也没有 `proxy_cidrs` 字段。
- `logger-level.json` 是 `{}`：日志级别为 0（默认值）时字段被省略。
- `networking_method`（proto 枚举 PublicServer=0 / Manual=1 / Standalone=2）：v2.7.1 的 web 返回名字（`"Manual"`，如 `network.json`、`GET /machines/{id}/networks/config/{inst}`），v2.6.4 的 web 返回数字（`1`）。同一份旧配置经 `networks/config` 读出来时，v2.6.4 把未设置字段写成 null / []，v2.7.1 直接省略。
- `list_peer` 里连接的 `conn_id` 是字符串 UUID，而 `default_conn_id` 是 `{part1..part4}` 的 UUID 对象（用 `uuidToStr` 转）。
- `alias`：`/machines` 的条目里没设置别名时**没有这个键**（不是 null）；`/networks/{id}/members` 的成员里没设置时是 `"alias": null`。
- `/machines` 的顺序：在线的在前，然后按 `last_seen` 从新到旧。
- `hostname_override`（如 core3 的 `lab-box`）会同时出现在成员的 `hostname` 和 `list_route` 路由的 `hostname` 里；`/machines` 里 `info.hostname` 仍是系统主机名（`core3`）。
- `machines[].info.inst_id` 是 core 进程这次心跳会话的随机 id（core 重启就变），不是网络实例 id；设备上运行的网络实例在 `running_network_instances` 里。
