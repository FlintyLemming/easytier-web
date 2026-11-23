# 本地测试环境与可行性关卡 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在本机用 Docker 搭一套可重复使用的 EasyTier 测试环境。先用 easytier-web 2.6.4 造出和生产环境同类型的旧实例，再把后端升级到 v2.7.1，验证 2.6.4 版的 easytier-core 能否在中央网络模式下正常工作（可行性关卡）。最后抓取真实的 API 响应，存成前端测试用的样本数据（fixtures）。

**Architecture:** 一个 `docker compose` 环境：1 个 `web` 服务（官方镜像，标签可以切换），加上 3 个 `core` 服务（官方 v2.6.4 镜像，各自用固定的 machine id）。在环境上运行的脚本都用 TypeScript 写，Node 26 可以直接执行，不需要编译。脚本通过 HTTP API 驱动后端，最后输出一份关卡报告和一组 fixtures。

**Tech Stack:** Docker Compose、`easytier/easytier:v2.6.4` 与 `:v2.7.1` 镜像、Node 26（原生运行 TypeScript）、`fetch`。

**Spec:** `docs/superpowers/specs/2026-11-23-easytier-web-console-design.md`（§5.10.1 第 1 步，§8 迁移演练）

## Global Constraints

- 后端版本：旧版 `easytier/easytier:v2.6.4`（生产环境当前版本 2.6.4-8428a89d），新版 `easytier/easytier:v2.7.1`（tag `0d9c52b1`）。
- web 容器的入口命令是 `easytier-web-embed`，镜像默认入口是 `/sbin/tini -- easytier-core`；工作目录 `/app`，数据库文件 `/app/et.db`（和生产环境的挂载方式一致）。
- 端口：API 和内嵌的旧前端都在 `11211/tcp`，设备登记用 `22020/udp`。
- 本地测试账号是 `admin` / `admin`，由上游的初始化迁移自动创建。登录时密码要先做 MD5：`md5("admin") = 21232f297a57a5a743894a0e4a801fc3`。
- 设备的 machine id 固定为：core1 `11111111-1111-4111-8111-111111111111`，core2 `22222222-2222-4222-8222-222222222222`，core3 `33333333-3333-4333-8333-333333333333`。
- 全程**不接触** `idc-ucloud` 生产环境。
- 包管理器用 npm，`pnpm` 未安装。

## Review Focus

- 脚本重复运行：在环境已经有数据时再执行 seed 或 gate，应该报出清楚的错误，或者以幂等的方式跳过，而不是产生重复实例。由 Task 2 的 `seed-legacy.ts` 负责：先查询已有实例，按网络名判断是否需要跳过。
- 容器刚启动时 API 还没就绪：所有脚本都要先轮询 `check_login_status`，超时后再失败，不能一启动就报错。由 Task 2 的 `waitForApi` 负责。
- 关卡里任何一项失败，报告都要写出失败项和原始响应，脚本退出码不为 0。由 Task 3 负责。
- fixtures 不能含真实密钥：测试环境用的网络密钥是固定的假值 `gate-secret`、`home-secret`。抓取脚本会断言输出文件里不包含 `/app` 以外的宿主机路径。由 Task 4 负责。

---

### Task 1: 仓库初始化与 Docker 测试环境

**Files:**
- Create: `.gitignore`、`LICENSE`（LGPL-3.0 全文，从 `/Users/flintylemming/Projects/EasyTier/LICENSE` 复制）
- Create: `testenv/docker-compose.yml`、`testenv/README.md`

**Interfaces:**
- Produces: `docker compose -f testenv/docker-compose.yml` 环境。环境变量 `ET_WEB_TAG`（默认 `v2.7.1`）、`ET_CORE_TAG`（默认 `v2.6.4`）、`ET_DATA_DIR`（默认 `./data`，挂载到 web 的 `/app`）。服务名为 `web`、`core1`、`core2`、`core3`，容器内主机名与服务名相同。

- [ ] **Step 1:** 在 `/Users/flintylemming/Projects/easytier-web` 下运行 `git init`。`.gitignore` 包含：`node_modules/`、`dist/`、`.superpowers/`、`testenv/data*/`、`testenv/backups/`、`test-results/`、`playwright-report/`、`.DS_Store`。
- [ ] **Step 2:** 编写 `testenv/docker-compose.yml`：
  - `web`：`image: easytier/easytier:${ET_WEB_TAG:-v2.7.1}`，`entrypoint: ["easytier-web-embed"]`，不加额外参数（保留默认的注册开关，方便测试），`volumes: ["${ET_DATA_DIR:-./data}:/app"]`，`ports: ["11211:11211", "22020:22020/udp"]`。
  - `core1`、`core2`、`core3`：`image: easytier/easytier:${ET_CORE_TAG:-v2.6.4}`，`command: ["--config-server", "udp://web:22020/admin", "--machine-id", "<对应的 id>"]`，`hostname` 与服务名相同，`cap_add: [NET_ADMIN]`，`devices: ["/dev/net/tun"]`，`depends_on: [web]`。
- [ ] **Step 3:** 运行 `docker compose -f testenv/docker-compose.yml up -d`，然后执行 `curl -s -o /dev/null -w '%{http_code}' localhost:11211/api/v1/auth/check_login_status`。
  Expected：`401`。
- [ ] **Step 4:** 在 `testenv/README.md` 里写明：启动和停止命令、怎么切换标签、admin 账号，以及旧前端的地址 `http://localhost:11211/`。
- [ ] **Step 5:** 提交：`git add .gitignore LICENSE testenv/ docs/ DESIGN-cursor.md && git commit -m "chore: init repo with design docs and docker test env"`

### Task 2: API 辅助模块与旧版数据 seed

**Files:**
- Create: `testenv/lib/api.ts`、`testenv/seed-legacy.ts`、`testenv/lib/api.test.ts`

**Interfaces:**
- Produces（`testenv/lib/api.ts`）：
  - `class EtApi { constructor(base = 'http://localhost:11211'); login(user: string, pass: string): Promise<void>; get<T>(path: string): Promise<T>; post<T>(path: string, body?: unknown): Promise<T>; put<T>(path, body?); patch<T>(path, body?); del<T>(path): Promise<T> }`。路径都相对于 `/api/v1`。客户端自己保存服务器返回的 `Set-Cookie`，在后续请求里带上。HTTP 状态不是 2xx 时，抛出 `EtApiError { status: number; body: string }`。
  - `waitForApi(api: EtApi, timeoutMs = 60_000): Promise<void>`：轮询 `/auth/check_login_status`，收到 401 或 200 都说明 API 已就绪。
  - `waitFor<T>(fn: () => Promise<T | undefined>, timeoutMs: number, label: string): Promise<T>`：每 2 秒调用一次，返回值不是 `undefined` 就返回。超时则抛错，错误信息带上 `label`。
  - `MACHINES = { core1: '1111…', core2: '2222…', core3: '3333…' }`。

- [ ] **Step 1: 写失败的测试**（`node --test testenv/lib/api.test.ts`，用 `node:test` 和一个本地 `http.createServer` 模拟后端）：
  - `login posts md5 password and stores cookie`：断言请求体是 `{"username":"admin","password":"21232f297a57a5a743894a0e4a801fc3"}`，并且下一次请求的 `cookie` 头里带着服务器返回的会话 cookie；
  - `non-2xx throws EtApiError with status`：服务器返回 409，捕获到的错误满足 `status === 409`；
  - `waitFor times out with label`：fn 一直返回 `undefined`，`timeoutMs = 50`，错误信息包含 `label`。
- [ ] **Step 2:** 运行 `node --test testenv/lib/api.test.ts`。Expected：FAIL，因为模块还不存在。
- [ ] **Step 3:** 实现 `testenv/lib/api.ts`。MD5 用 `node:crypto` 的 `createHash('md5')`。
- [ ] **Step 4:** 运行同一条命令。Expected：PASS。
- [ ] **Step 5:** 实现 `testenv/seed-legacy.ts`，在 `ET_WEB_TAG=v2.6.4` 的环境上运行。步骤如下：
  1. `waitForApi`，然后 `login('admin','admin')`；
  2. `waitFor` 等到 `GET /machines` 里三台设备都出现。用 `info.machine_id`（UUID 对象，按 part1..4 转成字符串）和 `MACHINES` 比对；
  3. 对每台设备调用 `GET /machines/{id}/networks`，如果已经有 `network_name` 为 `home` 的实例，就跳过这台设备的创建步骤（保证可以重复运行）；
  4. 调用 `POST /machines/{id}/networks`，请求体是 `{ config, save: true }`。`config` 的公共字段：`instance_id`（新生成的 uuid v4）、`network_name: "home"`、`network_secret: "home-secret"`、`dhcp: false`、`network_length: 24`、`listener_urls: ["tcp://0.0.0.0:11010","udp://0.0.0.0:11010"]`。各设备不同的部分：
     - core1：`virtual_ipv4 "10.144.144.1"`，`networking_method: 1`（Manual），`peer_urls: ["tcp://core2:11010"]`；
     - core2：`virtual_ipv4 "10.144.144.2"`，`networking_method: 0`（PublicServer），`public_server_url: "tcp://core1:11010"`；
     - core3：`virtual_ipv4 "10.144.144.3"`，`networking_method: 0`，`public_server_url: "tcp://core1:11010"`，`proxy_cidrs: ["192.168.77.0/24"]`，`mtu: 1300`，`enable_socks5: true`，`socks5_port: 1080`。
  5. 给 core2 再建一个实例：`network_name: "lab"`、`network_secret: "lab-secret"`、`dhcp: true`、`networking_method: 2`（Standalone）、`listener_urls: ["tcp://0.0.0.0:11020"]`。建好后调用 `PUT /machines/{core2}/networks/{inst}`，请求体 `{ disabled: true }`，把它停用；
  6. `waitFor` 等到三台设备的 `home` 实例在 `GET /machines/{id}/networks/info/{inst}` 的返回中 `info.map[inst].running === true`，并且 core1 的 `routes` 里能看到另外两台设备；
  7. 把 `{machine_id → {home: inst_id, lab?: inst_id}}` 写入 `testenv/data/seed-state.json`，供后面的任务读取。
- [ ] **Step 6:** 验证：`ET_WEB_TAG=v2.6.4 ET_DATA_DIR=./data docker compose -f testenv/docker-compose.yml up -d`，然后 `node testenv/seed-legacy.ts`。
  Expected：输出 `seeded 4 instances, 3 running`，退出码 0。打开 `http://localhost:11211/` 上的旧前端，能看到这些实例。
- [ ] **Step 7:** 提交：`git add testenv/lib testenv/seed-legacy.ts && git commit -m "test(env): api helper and 2.6.4 legacy seed"`

### Task 3: 升级到 v2.7.1 与可行性关卡

**Files:**
- Create: `testenv/upgrade.sh`、`testenv/gate-check.ts`
- Output: `testenv/reports/gate-<YYYY-MM-DD>.md`（需要提交）

**Interfaces:**
- Consumes: Task 2 的 `EtApi`、`waitForApi`、`waitFor`、`MACHINES`，以及 `testenv/data/seed-state.json`。
- Produces: 关卡报告，第一行是 `GATE: PASS` 或 `GATE: FAIL`。`gate-check.ts` 的退出码：通过时为 0，失败时为 1。

- [ ] **Step 1:** 编写 `testenv/upgrade.sh <from_tag> <to_tag>`：
  1. `docker compose stop web`；
  2. 把 `testenv/data/` 整个复制到 `testenv/backups/<时间戳>/`；
  3. 用 `ET_WEB_TAG=<to_tag> docker compose up -d web` 启动新版本；
  4. 打印备份所在的路径。

  脚本使用 `set -euo pipefail`。
- [ ] **Step 2:** 实现 `testenv/gate-check.ts`。逐项执行下面的检查，每一项都把结果（PASS 或 FAIL，以及证据）写进报告：
  - **G1 登录**：`login('admin','admin')` 成功。
  - **G2 模式**：`GET /console-info` 返回的 `webhook_auth === false`。
  - **G3 设备登记**：90 秒内，`GET /machines` 返回的三台设备都满足 `online === true`。
  - **G4 旧实例保留**：读取 `seed-state.json`，检查每台设备的 `GET /machines/{id}/networks` 都包含种下的实例 id。三台设备的 `home` 实例都在运行（`networks/info/{inst}` 返回 `running === true`）。core2 的 `lab` 实例仍是停用状态（这个字段在 `GET /machines/{id}/networks` 的返回里，字段名以实际响应为准，并写进报告）。
  - **G5 中央网络能在 2.6.4 core 上运行**：
    1. 调用 `POST /networks`，请求体 `{ settings: { display_name: "gate", network_name: "gate", networking_method: "Manual", peer_urls: ["tcp://core2:11030"], virtual_cidr: "10.155.0.0/24" }, network_secret: "gate-secret" }`；
    2. 调用 `POST /networks/{id}/members`，请求体 `{ device_ids: [core2, core3] }`；
    3. 为避免和旧实例的 11010 端口冲突，分别调用 `PUT /networks/{id}/members/{dev}/config` 覆盖监听地址：core2 用 `{ config: { listener_urls: ["tcp://0.0.0.0:11030","udp://0.0.0.0:11030"] } }`，core3 用 `{ config: { listener_urls: ["tcp://0.0.0.0:11040","udp://0.0.0.0:11040"] } }`；
    4. 在 120 秒内，`GET /networks/{id}/members` 里两个成员都满足 `running === true`；
    5. 在 120 秒内，调用 `POST /machines/{core2}/proxy-rpc`，请求体 `{ service_name: "api.instance.PeerManageRpcService", method_name: "list_route", payload: { instance: { id: <network id 转成 UUID 对象> } } }`，返回的路由里有 `hostname === "core3"` 的条目。
  - **G6 清理和回归**：调用 `DELETE /networks/{id}`。60 秒内，core2 和 core3 上 instance id 等于这个网络 id 的实例消失；三台设备的 `home` 实例仍在运行。
  - 报告第一行：所有检查都通过时写 `GATE: PASS`，否则写 `GATE: FAIL`。对每一项失败，附上最后一次的原始响应（截断到 2KB）。
- [ ] **Step 3:** 运行：`bash testenv/upgrade.sh v2.6.4 v2.7.1 && node testenv/gate-check.ts`。
  Expected：报告第一行是 `GATE: PASS`，退出码 0。
- [ ] **Step 4:** 如果结果是 **FAIL**：**停止执行整个路线图**，把报告交给用户，等用户决定（是否先升级设备端的 core）。不要尝试修改后端或绕过失败。
- [ ] **Step 5:** 如果结果是 PASS：验证回滚。运行 `bash testenv/upgrade.sh v2.7.1 v2.6.4`，用第 1 步打印出的路径恢复备份（README 里要写明恢复命令：先停止 web，再把备份复制回 `testenv/data/`），然后重新运行 `node testenv/seed-legacy.ts`。
  Expected：输出 `skipped`（实例都还在），三个实例都在运行。把回滚的结果追加写进报告。
- [ ] **Step 6:** 提交：`git add testenv/upgrade.sh testenv/gate-check.ts testenv/reports && git commit -m "test(env): v2.7.1 upgrade gate check and report"`

### Task 4: 抓取 v2.7.1 中央网络模式下的 API 样本

**Files:**
- Create: `testenv/capture-fixtures.ts`、`testenv/capture-fixtures.test.ts`
- Output: `tests/fixtures/v2.7.1/*.json`（需要提交）

**Interfaces:**
- Consumes: Task 2 的 `EtApi`。
- Produces（供计划 2 及以后的 Playwright mock 和单元测试使用）：在 `tests/fixtures/v2.7.1/` 下生成以下文件：`console-info.json`、`summary.json`、`machines.json`、`networks.json`、`network.json`（网络详情）、`members.json`、`member-config-core3.json`、`acl-policy.json`、`gateway-info.json`、`blocked-devices.json`、`list-route-core1.json`、`list-peer-core1.json`、`show-node-info-core3.json`、`logger-level.json`。每个文件的内容都是对应接口原样返回的 JSON（已解析）。另外生成一个 `index.json`，内容为 `{ networkId, machines: {core1, core2, core3} }`。

- [ ] **Step 1:** 实现 `testenv/capture-fixtures.ts`，在一个**全新的 v2.7.1 环境**上运行：`ET_DATA_DIR=./data-central ET_WEB_TAG=v2.7.1`，core 仍用 v2.6.4（和升级后的生产环境保持一致）。步骤如下：
  1. 登录；
  2. 等三台设备都上线；
  3. 调用 `POST /networks` 新建网络，请求体 `{ settings: { display_name: "home-central", network_name: "home-central", networking_method: "Manual", peer_urls: ["tcp://core1:11010"], virtual_cidr: "10.144.144.0/24" }, network_secret: "home-secret" }`；
  4. 把三台设备都加为成员；
  5. 设置成员属性：core1 `PATCH { virtual_ipv4: "10.144.144.1" }`；core3 `PATCH { proxy_cidrs: ["192.168.77.0/24"], hostname_override: "lab-box" }`；
  6. 写入 ACL：`PUT /networks/{id}/acl-policy`，请求体 `{ default_action: "allow", rules: [{ id: "r1", name: "deny-lab-ssh", enabled: true, action: "deny", sources: [{ type: "all" }], destinations: [{ type: "member", member_id: <core3 成员的 member_id> }], protocols: [{ protocol: "tcp", ports: ["22"], stateful: true }] }] }`；
  7. 拉黑设备：用 `docker run -d --name et-core4 --network <compose 项目的默认网络，通过 docker compose ps --format json 查得> --cap-add NET_ADMIN --device /dev/net/tun easytier/easytier:v2.6.4 --config-server udp://web:22020/admin --machine-id 44444444-4444-4444-8444-444444444444` 启动一个临时 core。等它登记后，调用 `DELETE /machines/{id}?block=true` 拉黑，再执行 `docker restart et-core4` 让它尝试重连一次。等到 `GET /blocked-devices` 里这台设备的 `attempt_count >= 1`，然后执行 `docker rm -f et-core4`；
  8. 等所有成员都在运行，并且 core1 的路由里能看到另外两台设备；
  9. 依次请求上面列出的接口，把响应写成文件。
- [ ] **Step 2:** 写测试 `testenv/capture-fixtures.test.ts`（`node --test`）。它读取生成出来的文件并断言：
  - `machines.json` 的 `machines` 有 3 个或以上元素，每个都有 `info.machine_id`、`online`、`networks`；
  - `members.json` 的 `members.length === 3`，其中有一个成员满足 `virtual_ipv4 === "10.144.144.1"`；
  - `list-route-core1.json` 的 `routes` 里，至少有 2 个元素带 `next_hop_peer_id` 和 `path_latency` 字段；
  - `blocked-devices.json` 的 `blocked` 至少有 1 个元素；
  - 所有 fixture 文件的文本里，都不包含 `/Users/` 这个字符串。
- [ ] **Step 3:** 运行：`docker compose -f testenv/docker-compose.yml down && ET_DATA_DIR=./data-central docker compose -f testenv/docker-compose.yml up -d && node testenv/capture-fixtures.ts && node --test testenv/capture-fixtures.test.ts`。
  Expected：测试全部 PASS。
- [ ] **Step 4:** 在 `testenv/README.md` 里补充说明：如何重新抓取 fixtures，以及每个 fixture 文件对应哪个接口。
- [ ] **Step 5:** 提交：`git add testenv/capture-fixtures*.ts tests/fixtures testenv/README.md && git commit -m "test(fixtures): capture v2.7.1 central-mode api responses"`
