# 前端基础与设备 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建新前端的工程骨架，并做出第一批真正可用的页面：登录和注册、顶部导航外壳（添加设备、拉黑提示、账户菜单）、Tailscale 风格的设备列表，以及整页的设备详情（默认网络、连接、成员设置、诊断、危险操作）。

**Architecture:** Vue 3 单页应用，用 hash 路由。数据分三层：
- `src/api/` 是一层很薄的 fetch 客户端，按 v2.7.1 的接口编写；
- `src/domain/` 是不依赖框架的纯函数，负责把原始数据算成「设备视图」、判断连接方式、处理默认网络等规则，全部用单元测试覆盖；
- `src/stores/` 用 Pinia 管理轮询和缓存。

页面只组合 `src/components/ui/` 里的基础组件。这些组件基于 Reka UI 的无样式原语，外观按 Cursor 设计规范自己实现。

**Tech Stack:** Vue 3.5、Vite、TypeScript、vue-router（hash）、Pinia、vue-i18n v10、Tailwind CSS v4（`@tailwindcss/vite`）、Reka UI、`@fontsource-variable/inter`、`@fontsource/jetbrains-mono`、`ts-md5`、`uuid`、`@protobuf-ts/runtime` 2.11.1（开发依赖 `@protobuf-ts/plugin`、`@protobuf-ts/protoc` 2.11.1）、Vitest + `@vue/test-utils` + jsdom、`@playwright/test`。包管理器用 npm。

**Spec:** `docs/superpowers/specs/2026-11-23-easytier-web-console-design.md`（§3、§5.1–5.4、§5.6、§5.7、§5.9、§6.1、§6.3–6.5、§6.8、§6.9）

## Global Constraints

- 接口以 easytier-web **v2.7.1** 为准，基础路径是 `${apiBase}/api/v1`。`apiBase` 取自 `window.__ET_CONFIG__?.apiBase`，没有配置时为 `''`（同源）。所有请求都带 `credentials: 'include'`。
- `console-info.config_server_host` 是可选字段（main 分支新增），可能不存在。
- 调用 `/auth/login`、`/auth/register`、`/auth/password` 时，密码一律先做 MD5（`ts-md5` 的 `Md5.hashStr`）再提交。
- 运行时**不能向第三方发任何请求**：字体通过 `@fontsource` 打包进产物，不使用 CDN。
- 颜色、字号等 token 的值，严格照搬 `DESIGN-cursor.md`：canvas `#f7f7f4`、canvas-soft `#fafaf7`、surface-card `#ffffff`、ink `#26251e`、body `#5a5852`、muted `#807d72`、muted-soft `#a09c92`、hairline `#e6e5e0`、hairline-soft `#efeee8`、hairline-strong `#cfcdc4`、surface-strong `#e6e5e0`、primary `#f54e00`、primary-active `#d04200`、success `#1f8a65`、error `#cf2d56`；圆角：卡片 12px，按钮和输入框 8px，标签 9999px；不使用阴影；标题字重 400，字距收紧（display-lg 36px 对应 -0.72px，display-md 26px 对应 -0.325px，display-sm 22px 对应 -0.11px）；caption-uppercase 为 11px、字重 600、字距 0.88px。
- 橙色 `#f54e00` 每页只用于一个主操作，以及 Logo 上的 ◆。**不使用**设计规范里的五种 timeline 粉彩色。
- IP、版本、ID、CIDR、TOML 一律用 JetBrains Mono。
- 轮询间隔：设备列表和设备详情 5 秒，peer 和路由 15 秒。页面不可见时暂停，重新可见时立刻刷新。同一类请求同一时刻只能有一个在执行。proxy-rpc 的并发上限是 4。
- 修改成员时只提交变化了的字段（`PATCH`）。网络配置对象的读写必须经过移植过来的 `normalizeNetworkConfig` 和 `toBackendNetworkConfig`。
- 支持中文和英文两种语言（zh-CN / en）。浏览器语言以 `zh` 开头时默认中文，用户的选择保存在 `localStorage['et.locale']`。
- 从上游复制过来的文件，开头要加注释：`// Ported from EasyTier v2.7.1 (https://github.com/EasyTier/EasyTier), LGPL-3.0-or-later`。
- 测试用的 fixtures 来自计划 1：`tests/fixtures/v2.7.1/*.json`。在开发服务器里，`/api` 代理到 `process.env.ET_API ?? 'http://localhost:11211'`。

## Review Focus

1. **位置缺失或特殊**：`location` 为 `null`、country 是「本地网络」或「海外」、没有 city、hostname 为空字符串时，设备行要正常显示：位置显示「—」或者原文，名字依次退回到 hostname、machine id。测试放在 Task 4（`buildDeviceViews`）和 Task 8（e2e）。
2. **离线设备的详情页**：连接卡片显示「设备离线，恢复连接后显示」，并且**不发起任何 proxy-rpc 请求**；成员设置仍然可以编辑。测试放在 Task 10。
3. **proxy-rpc 失败或超时**：连接卡片显示错误信息和「重试」按钮，其他卡片和轮询照常工作。测试放在 Task 10。
4. **轮询过程中会话过期（401）**：只跳转一次到 `/login?next=<当前路径>`，登录后回到原来的页面。测试放在 Task 7。
5. **超长名字或 emoji 别名**：在 390px 宽的屏幕上，名字截断显示，鼠标悬停时 `title` 里有完整名字，页面不出现横向滚动。测试放在 Task 8。

---

### Task 1: 工程骨架与设计 token

**Files:**
- Create: `package.json`、`vite.config.ts`、`tsconfig.json`、`tsconfig.node.json`、`index.html`、`public/config.js`、`src/main.ts`、`src/App.vue`、`src/styles/tokens.css`、`src/styles/base.css`、`src/env.d.ts`、`vitest.config.ts`、`playwright.config.ts`、`tests/unit/smoke.test.ts`

**Interfaces:**
- Produces：npm 脚本 `dev`、`build`、`preview`、`typecheck`（`vue-tsc --noEmit`）、`test`（`vitest run`）、`e2e`（`playwright test tests/e2e`）、`codegen`（Task 2 提供）。全局类型 `interface Window { __ET_CONFIG__?: { apiBase?: string } }`。Tailwind 主题里的颜色名和 spec token 同名，例如 `bg-canvas`、`text-ink`、`border-hairline`、`bg-primary`、`text-muted`；字体为 `font-sans`（Inter）、`font-mono`（JetBrains Mono）。

- [ ] **Step 1:** 用 npm 初始化，安装 Tech Stack 里列出的依赖。`vite.config.ts` 中：`base: './'`；`server.proxy['/api']` 指向 `process.env.ET_API ?? 'http://localhost:11211'`，并设置 `changeOrigin: true`；插件 `@vitejs/plugin-vue`、`@tailwindcss/vite`。
- [ ] **Step 2:** `index.html` 在应用脚本之前，先加载 `<script src="./config.js"></script>`。`public/config.js` 的内容是 `window.__ET_CONFIG__ = window.__ET_CONFIG__ || {};`。
- [ ] **Step 3:** `src/styles/tokens.css` 用 Tailwind v4 的 `@theme` 定义 Global Constraints 中的全部颜色、圆角和字体。`base.css` 设置：`body` 背景 canvas、文字 ink、字体 Inter；`h1`–`h3` 字重 400，并按对应字号设置字距；`code, .mono` 使用 JetBrains Mono。
- [ ] **Step 4:** 写 `tests/unit/smoke.test.ts`：断言 `src/styles/tokens.css` 的文本里包含 `#f7f7f4`、`#26251e`、`#f54e00`、`#cfcdc4`，并且不包含 `box-shadow`。
- [ ] **Step 5:** 运行 `npm test && npm run typecheck && npm run build`。Expected：全部通过，生成 `dist/index.html`。
- [ ] **Step 6:** 提交：`git commit -am "feat: scaffold vue app with cursor design tokens"`（新文件要先 `git add`）。

### Task 2: protobuf 类型与移植的配置工具

**Files:**
- Create: `proto/*.proto`（从 EasyTier tag `v2.7.1` 的 `easytier-proto/proto/` 复制，`tests.proto` 除外）、`proto/SOURCE.md`（写明 tag 和 commit `0d9c52b1`）、`scripts/codegen-proto.mjs`、`src/generated/proto/**`（生成后提交进仓库）
- Create: `src/lib/networkConfig.ts`（移植自 `easytier-web/frontend-lib/src/types/network.ts`）、`src/lib/networkCompat.ts`（移植自 `networkCompat.ts`）、`src/lib/uuid.ts`（移植自 `frontend-lib/src/modules/utils.ts` 中的 `UuidToStr`、`StrToUuid` 及其依赖函数）
- Test: `tests/unit/uuid.test.ts`、`tests/unit/networkConfig.test.ts`

**Interfaces:**
- Produces：`uuidToStr(u: { part1?: number; part2?: number; part3?: number; part4?: number } | null | undefined): string`、`strToUuid(s: string): { part1: number; part2: number; part3: number; part4: number }`。`networkConfig.ts` 保留上游导出的名字：`NetworkConfig`、`DEFAULT_NETWORK_CONFIG`、`normalizeNetworkConfig`、`toBackendNetworkConfig`、`NetworkingMethod`，以及相关的 ACL 和 VPN Portal 类型。

- [ ] **Step 1:** 复制 proto 文件和上游 `frontend-lib/scripts/codegen-proto.mjs`。把脚本里的 `protoRoot` 改为 `<repo>/proto`，输出目录改为 `src/generated/proto`。生成的文件列表和上游保持一致：annotations、common、core_config、acl、api_instance、api_manage、peer_rpc、error。在 package.json 里加入 `"codegen": "node scripts/codegen-proto.mjs"`。
- [ ] **Step 2:** 运行 `npm run codegen`。Expected：生成 `src/generated/proto/api_manage.ts` 等文件。
- [ ] **Step 3:** 写失败的测试：
  - `uuid.test.ts`：`strToUuid('11111111-1111-4111-8111-111111111111')` 再经过 `uuidToStr` 转回来，结果和原字符串相同；`uuidToStr(null) === ''`；`strToUuid('bad')` 抛错。
  - `networkConfig.test.ts`：`round trip keeps fields the form never shows`。读取 fixture `member-config-core3.json`，在它的基础上加入 `routes: ['10.9.0.0/16']`、`port_forwards: [{ bind_ip: '0.0.0.0', bind_port: 8080, dst_ip: '10.144.144.2', dst_port: 80, proto: 'tcp' }]`、`relay_network_whitelist: ['a', 'b']`。经过 `toBackendNetworkConfig(normalizeNetworkConfig(x))` 处理后，这三个字段和 `proxy_cidrs` 都和输入完全相等（`toEqual`）。
- [ ] **Step 4:** 运行 `npx vitest run tests/unit/uuid.test.ts tests/unit/networkConfig.test.ts`。Expected：FAIL。
- [ ] **Step 5:** 移植这三个文件，导入路径改到 `src/generated/proto/...`，每个文件开头加上 LGPL 注释。
- [ ] **Step 6:** 运行同一条命令。Expected：PASS。如果 round-trip 测试失败，说明上游的转换会丢字段：在 `networkConfig.ts` 中修复，并在注释里说明原因。不能删掉这个测试。
- [ ] **Step 7:** 提交：`git add proto scripts src/generated src/lib tests/unit && git commit -m "feat: proto types and ported network config helpers"`

### Task 3: API 客户端

**Files:**
- Create: `src/api/http.ts`、`src/api/types.ts`、`src/api/client.ts`
- Test: `tests/unit/api.test.ts`

**Interfaces:**
- Produces（`http.ts`）：`class ApiError extends Error { status: number; body: unknown }`；`request<T>(method: 'GET'|'POST'|'PUT'|'PATCH'|'DELETE', path: string, opts?: { body?: unknown; query?: Record<string, string | boolean> }): Promise<T>`；`onUnauthorized(handler: () => void): void`；`apiUrl(path: string): string`。`ApiError` 的 message 取响应 JSON 里的 `message` 字段，没有就用响应文本。
- Produces（`types.ts`）：从上游 v2.7.1 的 `frontend/src/modules/api.ts` 复制这些接口：`ConsoleInfo`（其中 `config_server_host?: string | null`）、`Summary`、`CentralNetworkSummary`、`CentralNetworkDetail`、`CentralNetworkMember`、`TemporaryPeer`、`BlockedDevice`、`NodeRouteInfo`、`NodePeerConn`、`NodePeerInfo`、`NodeAclRuleStat`。另外新增：
  - `interface RawMachine { client_url?: string | null; info?: HeartbeatInfo | null; location?: GeoText | null; alias?: string | null; networks?: { network_id: string; display_name: string; network_name: string }[]; online?: boolean; last_seen?: string | null }`
  - `interface HeartbeatInfo { machine_id?: UuidParts; hostname?: string; easytier_version?: string; report_time?: string; running_network_instances?: UuidParts[]; device_os?: unknown }`
  - `interface GeoText { country: string; region?: string | null; city?: string | null }`
  - `type MemberPatch = { hostname_override?: string | null; virtual_ipv4?: string | null; proxy_cidrs?: string[] }`
- Produces（`client.ts`，具名导出的函数）：
  - 认证：`login(username, password)`、`register(username, password, captcha)`、`logout()`、`checkLogin(): Promise<boolean>`、`changePassword(newPassword)`、`getOidcConfig(): Promise<{ enabled: boolean }>`（失败时返回 `{ enabled: false }`）、`captchaUrl(): string`、`oidcLoginUrl(): string`；
  - 控制台：`getConsoleInfo()`；
  - 设备：`listMachines(): Promise<RawMachine[]>`、`deleteMachine(id: string, block: boolean)`、`setMachineAlias(id: string, alias: string)`、`listBlockedDevices(): Promise<BlockedDevice[]>`、`unblockDevice(id: string)`；
  - 网络和成员：`listNetworks()`、`listMembers(networkId): Promise<{ members: CentralNetworkMember[]; temporary_peers: TemporaryPeer[] }>`、`addMembers(networkId, deviceIds: string[])`、`updateMember(networkId, deviceId, patch: MemberPatch)`、`removeMember(networkId, deviceId)`、`getMemberConfig(networkId, deviceId): Promise<Record<string, unknown>>`、`setMemberConfig(networkId, deviceId, config: object)`、`clearMemberConfig(networkId, deviceId)`；
  - proxy-rpc：`proxyRpc<T>(machineId, service, method, payload): Promise<T>`、`nodeRoutes(machineId, instId): Promise<NodeRouteInfo[]>`、`nodePeers(machineId, instId): Promise<NodePeerInfo[]>`、`nodeAclStats(machineId, instId): Promise<NodeAclRuleStat[]>`、`nodeInfo(machineId, instId): Promise<{ config: string; interfaceIpv4s: string[] }>`、`getLoggerLevel(machineId): Promise<number>`、`setLoggerLevel(machineId, level: number)`。
  - 每个接口的路径和请求体，都和上游 `api.ts` 中的同名方法一致。proxy-rpc 调用中的 `instance.id` 用 `strToUuid(instId)` 转换。

- [ ] **Step 1:** 写失败的测试（用 `vi.stubGlobal('fetch', …)` 记录每次请求）：
  - `login sends md5 password`：请求体等于 `{ username: 'admin', password: '21232f297a57a5a743894a0e4a801fc3' }`，方法 POST，URL 以 `/api/v1/auth/login` 结尾；
  - `apiBase from window config`：设置 `window.__ET_CONFIG__ = { apiBase: 'https://api.example.com/' }` 后，`apiUrl('/machines') === 'https://api.example.com/api/v1/machines'`；
  - `401 calls unauthorized handler and throws ApiError`：注册的处理函数被调用 1 次，抛出的错误满足 `status === 401`；
  - `nodeRoutes wraps proxy-rpc`：请求体是 `{ service_name: 'api.instance.PeerManageRpcService', method_name: 'list_route', payload: { instance: { id: strToUuid(net) } } }`；响应里没有 `routes` 时返回 `[]`；
  - `deleteMachine with block adds query`：URL 以 `/machines/abc?block=true` 结尾；
  - `nodeInfo decodes interface ips`：响应 `{ node_info: { config: 'x', ip_list: { interface_ipv4s: [{ addr: 3232235777 }] } } }` 被解析为 `{ config: 'x', interfaceIpv4s: ['192.168.1.1'] }`。
- [ ] **Step 2:** 运行 `npx vitest run tests/unit/api.test.ts`。Expected：FAIL。
- [ ] **Step 3:** 实现这三个文件。uint32 转点分十进制 IP 的工具函数 `ipv4FromU32(n: number): string` 放在 `src/domain/format.ts` 里（Task 4 还会扩充这个文件）。
- [ ] **Step 4:** 运行同一条命令。Expected：PASS。
- [ ] **Step 5:** 提交：`git add src/api src/domain/format.ts tests/unit/api.test.ts && git commit -m "feat: v2.7.1 api client"`

### Task 4: 设备视图的领域逻辑

**Files:**
- Create: `src/domain/devices.ts`、`src/domain/version.ts`；修改 `src/domain/format.ts`
- Test: `tests/unit/devices.test.ts`、`tests/unit/version.test.ts`、`tests/unit/format.test.ts`

**Interfaces:**
- Consumes：Task 3 的类型。
- Produces：
  - `version.ts`：`parseVersion(v: string): [number, number, number] | null`（只取 `-` 之前的 `x.y.z`）、`compareVersions(a: string, b: string): number`、`latestVersion(vs: string[]): string | null`、`isOutdated(v: string, latest: string | null): boolean`；
  - `format.ts`：`ipv4FromU32(n: number): string`、`publicIpFromClientUrl(url?: string | null): string | null`（取 URL 的 host 部分，IPv6 去掉方括号）、`osLabel(deviceOs: unknown): string`（具体字段以 fixture `machines.json` 中 `info.device_os` 的实际结构为准，无法识别时返回 `''`）、`relativeTime(iso: string, now: Date, locale: 'zh-CN' | 'en'): string`、`formatBytes(n: number): string`、`locationText(g: GeoText | null | undefined): string | null`（优先 city，没有则 region，再没有则 country；`null` 时返回 `null`）；
  - `devices.ts`：
    ```ts
    export interface DeviceView {
      id: string; name: string; hostname: string; alias: string | null; os: string;
      online: boolean; lastSeen: string | null; version: string; outdated: boolean;
      publicIp: string | null; location: GeoText | null;
      networks: { id: string; name: string }[];
      defaultNetworkId: string | null;
      member: CentralNetworkMember | null;   // 设备在默认网络中的成员记录
      ip: string | null;                     // 默认网络中的 IP
    }
    export function primaryNetworkId(networks: CentralNetworkSummary[]): string | null
    export function defaultNetworkId(deviceNetworkIds: string[], primaryId: string | null): string | null
    export function memberIp(m: CentralNetworkMember): string | null
    export function buildDeviceViews(machines: RawMachine[], networks: CentralNetworkSummary[],
      membersByNetwork: Record<string, CentralNetworkMember[]>): DeviceView[]
    ```

- [ ] **Step 1:** 写失败的测试：
  - `primaryNetworkId`：成员数为 `[3, 5, 5]` 时，返回第一个成员数为 5 的网络；空数组返回 `null`；
  - `defaultNetworkId`：`(['b', 'a'], 'a')` 返回 `'a'`；`(['b', 'c'], 'a')` 返回 `'b'`；`([], 'a')` 返回 `null`；
  - `memberIp`：优先级是 `runtime_virtual_ipv4`，然后 `virtual_ipv4`，然后 `allocated_ipv4`，都没有时返回 `null`；
  - `buildDeviceViews` 基于 fixture `machines.json`、`networks.json`、`members.json`：core1 的 `ip === '10.144.144.1'`；`name` 依次退回 alias、hostname、id；设备不在任何网络时，`defaultNetworkId === null` 并且 `ip === null`；`location === null` 时不会抛错；hostname 为 `''` 时 `name` 等于 id；
  - `version`：`isOutdated('2.6.4-8428a89d', '2.7.1') === true`，`isOutdated('2.7.1-abc', '2.7.1') === false`，`latestVersion(['2.6.4-x', '2.7.1', 'garbage']) === '2.7.1'`；
  - `format`：`publicIpFromClientUrl('udp://1.2.3.4:5678') === '1.2.3.4'`，`publicIpFromClientUrl('tcp://[2001:db8::1]:11010') === '2001:db8::1'`；`locationText({ country: '中国', region: '浙江', city: '杭州' }) === '杭州'`；`locationText({ country: '本地网络' }) === '本地网络'`；`relativeTime` 输入 2 天前的时间，在 zh-CN 下返回 `'2 天前'`；`formatBytes(1536) === '1.5 KB'`。
- [ ] **Step 2:** 运行 `npx vitest run tests/unit/devices.test.ts tests/unit/version.test.ts tests/unit/format.test.ts`。Expected：FAIL。
- [ ] **Step 3:** 实现。`buildDeviceViews` 计算 `outdated` 时，和所有设备里的最高版本做比较（spec §6.3）。
- [ ] **Step 4:** 运行同一条命令。Expected：PASS。
- [ ] **Step 5:** 提交：`git commit -m "feat(domain): device views, default network, versions"`（新文件要先 `git add`）。

### Task 5: 会话和设备清单 store，以及轮询

**Files:**
- Create: `src/stores/session.ts`、`src/stores/inventory.ts`、`src/composables/usePolling.ts`
- Test: `tests/unit/inventory.test.ts`、`tests/unit/usePolling.test.ts`

**Interfaces:**
- Consumes：Task 3 的 client、Task 4 的 `buildDeviceViews`、`primaryNetworkId`。
- Produces：
  - `useSession()`：state 有 `info: ConsoleInfo | null`；getter 有 `centralEnabled`（`info?.webhook_auth === false`）、`username`；actions 有 `load(): Promise<void>`、`reset(): void`；
  - `useInventory()`：state 有 `machines`、`networks`、`membersByNetwork`、`blocked: BlockedDevice[]`、`loaded: boolean`、`error: string | null`；getter 有 `devices: DeviceView[]`、`primaryNetwork: CentralNetworkSummary | null`、`deviceById(id): DeviceView | undefined`；actions 有 `refresh(): Promise<void>`（单飞：执行期间重复调用，返回同一个 Promise）；
  - `usePolling(fn: () => Promise<unknown>, intervalMs: number): { start(): void; stop(): void }`：`document.hidden` 为真时暂停；收到 `visibilitychange` 并且页面变为可见时，立刻执行一次；组件卸载时自动停止。

- [ ] **Step 1:** 写失败的测试：
  - `refresh is single-flight`：同时调用两次 `refresh()`，`listMachines` 只被调用 1 次；
  - `refresh loads members for every network`：有 2 个网络时，`listMembers` 被调用 2 次，`devices` 中能拿到 IP；
  - `refresh error keeps last good data`：第二次刷新时 `listMachines` 抛错，`devices` 保持上一次的结果，`error` 不为 `null`；
  - `usePolling pauses when hidden`：使用假定时器，把 `document.hidden` 设为 true 后，经过 3 个间隔，fn 一次都没被调用；派发 `visibilitychange` 并设为可见后，fn 立刻被调用 1 次。
- [ ] **Step 2:** 运行 `npx vitest run tests/unit/inventory.test.ts tests/unit/usePolling.test.ts`。Expected：FAIL。
- [ ] **Step 3:** 实现。`refresh` 中 `listMachines`、`listNetworks`、`listBlockedDevices` 并行请求；`listMembers` 并行请求，每个网络调用一次。
- [ ] **Step 4:** 运行同一条命令。Expected：PASS。
- [ ] **Step 5:** 提交：`git commit -m "feat: session and inventory stores with polling"`

### Task 6: 基础 UI 组件

**Files:**
- Create（`src/components/ui/`）：`UiButton.vue`、`UiBadge.vue`、`StatusDot.vue`、`CopyButton.vue`、`UiInput.vue`、`UiDialog.vue`、`UiMenu.vue`、`UiPopover.vue`、`SectionCard.vue`、`KeyValueList.vue`、`EmptyState.vue`、`SkeletonRows.vue`、`ToastHost.vue`、`ConfirmHost.vue`
- Create：`src/composables/useToast.ts`、`src/composables/useConfirm.ts`
- Test：`tests/unit/ui.test.ts`

**Interfaces:**
- Produces（props 和用法）：
  - `UiButton`：`variant: 'primary' | 'secondary' | 'text' | 'danger' = 'secondary'`、`size: 'md' | 'sm' = 'md'`、`loading?: boolean`、`disabled?: boolean`、`type?: 'button' | 'submit'`。md 高 40px，sm 高 30px；primary 为橙底白字，按下时用 `#d04200`；secondary 为白底，加 1px hairline-strong 边框；danger 为文字和边框使用 error 色。
  - `UiBadge`：`tone: 'neutral' | 'outline' | 'success' | 'danger' = 'neutral'`，胶囊形，caption 字号。
  - `StatusDot`：`online: boolean`。在线用 success 色，离线用 muted-soft 色，直径 7px。
  - `CopyButton`：`text: string`，可选 `label`。点击后写入剪贴板，图标切换为 ✓ 并保持 1.5 秒。
  - `UiInput`：`v-model`，可选 `label`、`error`、`mono`、`placeholder`。
  - `UiDialog`：`v-model:open`、`title`，提供 `default` 和 `footer` 插槽。基于 Reka 的 `DialogRoot`。
  - `UiMenu`：`items: { label: string; onSelect?: () => void; danger?: boolean; disabled?: boolean; separator?: boolean; hint?: string }[]`，加上 `trigger` 插槽。基于 Reka 的 `DropdownMenu`。
  - `UiPopover`：`trigger` 和 `default` 插槽。
  - `SectionCard`：`title`（caption-uppercase 样式）、可选 `meta`（标题右侧的小字），加上 `action` 插槽。
  - `KeyValueList`：`items: { label: string; value: string | null; mono?: boolean; copy?: boolean }[]`、`columns: 1 | 2`。
  - `EmptyState`：`title`、`body?`，加上 `action` 插槽。
  - `useToast()` 返回 `{ success(msg: string), error(msg: string) }`；`useConfirm()` 返回 `{ confirm(o: { title: string; body?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean> }`。在 `App.vue` 中挂载 `ToastHost` 和 `ConfirmHost`。

- [ ] **Step 1:** 写失败的测试：
  - `primary button uses brand background`：渲染后的 class 包含 `bg-primary`；
  - `confirm resolves true/false`：挂载 `ConfirmHost` 并调用 `confirm(...)`，点击确认按钮后 resolve 为 `true`；再调用一次，点击取消后 resolve 为 `false`；
  - `CopyButton writes clipboard`：桩函数 `navigator.clipboard.writeText` 收到的参数是 `'10.144.144.1'`；
  - `no component uses shadow`：用 glob 读取 `src/components/ui/*.vue` 的文本，都不包含 `shadow`。
- [ ] **Step 2:** 运行 `npx vitest run tests/unit/ui.test.ts`。Expected：FAIL。
- [ ] **Step 3:** 实现这些组件。
- [ ] **Step 4:** 运行同一条命令。Expected：PASS。
- [ ] **Step 5:** 提交：`git commit -m "feat(ui): base components on reka-ui"`

### Task 7: 多语言、路由、外壳与登录

**Files:**
- Create：`src/i18n/index.ts`、`src/i18n/zh-CN.ts`、`src/i18n/en.ts`、`src/router.ts`、`src/lib/enroll.ts`（移植自上游 `frontend/src/modules/enroll.ts`，`getApiBase` 改为使用 `apiUrl` 的 base）
- Create：`src/components/shell/AppShell.vue`、`TopNav.vue`、`AddDevicePopover.vue`、`BlockedBell.vue`、`UserMenu.vue`、`ChangePasswordDialog.vue`、`WebhookBanner.vue`
- Create：`src/pages/LoginPage.vue`、`src/pages/RegisterPage.vue`
- Test：`tests/unit/enroll.test.ts`、`tests/e2e/mockApi.ts`、`tests/e2e/auth.spec.ts`、`tests/e2e/shell.spec.ts`

**Interfaces:**
- Consumes：Task 5 的 stores、Task 6 的组件。
- Produces：
  - 路由（hash 模式）：`/login`（name `login`）、`/register`（`register`）；`/`（`overview`，在计划 3 完成之前先重定向到 `/devices`）；`/devices`（`devices`）；`/devices/:machineId`（`device`）；`/devices/:machineId/networks/:networkId`（`device-network`）。除登录和注册外，所有路由都放在 `AppShell` 下。
  - 路由守卫：`session.info` 为空时先调用 `session.load()`；如果返回 401，就重定向到 `/login?next=<fullPath>`。`onUnauthorized` 注册的处理函数会执行同样的跳转，但要去重：正在跳往登录页时，不再重复跳转。
  - `enrollEndpoint(info: ConsoleInfo): string`、`enrollCommand(info: ConsoleInfo): string`，逻辑和上游一致。
  - `tests/e2e/mockApi.ts`：`mockApi(page: Page, overrides?: Record<string, (req: Request) => unknown | Promise<unknown>>): Promise<{ requests: { method: string; path: string; body: unknown }[] }>`。它拦截 `**/api/v1/**` 的请求：先看 `overrides`（键的格式为 `'METHOD /path'`，路径支持 `*` 通配），否则按照固定的映射表返回 `tests/fixtures/v2.7.1` 下的文件；proxy-rpc 请求按 `method_name` 分发：`list_route` 对应 `list-route-core1.json`，`list_peer` 对应 `list-peer-core1.json`，`show_node_info` 对应 `show-node-info-core3.json`，`get_logger_config` 对应 `logger-level.json`。所有设备共用同一个文件，测试需要不同数据时用 override 覆盖。写类请求（POST/PUT/PATCH/DELETE）默认返回 `{}`。

- [ ] **Step 1:** 写失败的测试：
  - `enroll.test.ts`：`config_server_host` 为空时，端点使用浏览器的 host 和 `config_server_port`；为 `'et.example.com:443'` 时保留其中的端口；为 `'tcp://h'` 时使用 tcp 协议；生成的命令是 `easytier-core --config-server udp://<host>:22020/admin`；
  - `auth.spec.ts`：
    - 登录时提交的密码是 MD5，成功后跳转到 `/#/devices`；
    - 后端返回 401 时，页面显示「用户名或密码错误」（英文为 "Invalid username or password"）；
    - OIDC 已启用时显示 OIDC 按钮，其 `href` 以 `/api/v1/auth/oidc/login` 结尾；
    - **Review Focus 4**：用户停留在 `/#/devices/<id>` 时，下一次轮询的 `GET /machines` 返回 401，页面跳转到 `/#/login?next=%2Fdevices%2F<id>`，并且 `requests` 中只发生过 1 次到登录页的跳转（检查 URL 的变化记录）；重新登录后，回到 `/#/devices/<id>`；
  - `shell.spec.ts`：
    - 顶部导航显示「设备」标签（这一阶段不显示「网络」）；
    - 「添加设备」是页面上唯一一个计算出的背景色为 `rgb(245, 78, 0)` 的元素，点击后弹出的命令文本等于 `enrollCommand(fixture console-info)`；
    - 有设备满足 `attempt_count > 0` 时，铃铛显示数量角标，点击「解除拉黑」后发起 `DELETE /blocked-devices/<id>`；
    - console-info 的 `webhook_auth` 为 `true` 时，显示 webhook 横幅。
- [ ] **Step 2:** 运行 `npx vitest run tests/unit/enroll.test.ts && npx playwright test tests/e2e/auth.spec.ts tests/e2e/shell.spec.ts`。Expected：FAIL。
- [ ] **Step 3:** 实现。`TopNav` 高度为 56px，背景 canvas，底部有一条 hairline；当前所在的标签用 ink 色文字，下方加 2px ink 色下划线。语言切换和修改密码都放在 `UserMenu` 里。`RegisterPage` 的验证码图片地址是 `captchaUrl()` 加上 `?t=<时间戳>`，点击图片可以刷新。
- [ ] **Step 4:** 运行同一条命令。Expected：PASS。
- [ ] **Step 5:** 提交：`git commit -m "feat: i18n, router, shell and login"`

### Task 8: 设备列表页

**Files:**
- Create：`src/domain/deviceFilter.ts`、`src/pages/DevicesPage.vue`、`src/components/devices/DeviceTable.vue`、`DeviceRow.vue`、`DeviceCard.vue`（窄屏使用）、`DeviceFilters.vue`、`RenameDialog.vue`、`DeleteDeviceDialog.vue`
- Test：`tests/unit/deviceFilter.test.ts`、`tests/e2e/devices.spec.ts`

**Interfaces:**
- Consumes：`useInventory().devices`、`primaryNetwork`；client 的 `addMembers`、`setMachineAlias`、`deleteMachine`。
- Produces：
  - `type StatusFilter = 'all' | 'online' | 'offline' | 'unjoined'`；
  - `filterDevices(ds: DeviceView[], f: { query: string; status: StatusFilter; city?: string | null }): DeviceView[]`：query 不区分大小写，匹配 name、hostname、ip、publicIp、`locationText`；
  - `sortDevices(ds, key?: 'name' | 'ip' | 'version' | 'lastSeen', dir?: 'asc' | 'desc')`：不传 key 时，在线的排在前面，然后按 name 用 `localeCompare(…, 'zh-CN')` 排序；
  - `statusCounts(ds): Record<StatusFilter, number>`；
  - 路由的查询参数 `?city=<name>` 会预先设置位置筛选（计划 3 的地图会用到）。

- [ ] **Step 1:** 写失败的测试：
  - `deviceFilter.test.ts`：查询 `'10.144.144.3'` 只返回 core3；查询 `'杭州'` 能匹配城市；`status: 'unjoined'` 只返回 `defaultNetworkId === null` 的设备；默认排序时，离线设备排在所有在线设备之后；`statusCounts` 的结果和 fixture 一致。
  - `devices.spec.ts`：
    - 表头依次是「设备 / 内网 IP / 位置 · 公网 IP / 版本 / 最后在线」；
    - core1 这一行显示 `10.144.144.1`，下方小字是网络名；
    - 点击这一行的任意位置，跳转到 `/#/devices/11111111-1111-4111-8111-111111111111`；
    - 用 override 加入一台不在任何网络中的设备：这一行显示「加入 home-central」，点击后发起 `POST /networks/<primary>/members`，请求体为 `{ device_ids: [<id>] }`；
    - 版本为 2.6.4 的设备，显示「可更新」标签；
    - 通过 ⋯ 菜单重命名时，发起 `PUT /machines/<id>/alias`，请求体为 `{ alias }`；删除时勾选「同时拉黑」，发起 `DELETE /machines/<id>?block=true`；
    - **Review Focus 1**：location 为 `null` 时，这一列显示「—」；country 为「本地网络」时显示「本地网络」；
    - **Review Focus 5**：别名设为 80 个字符并包含 emoji，在 390px 宽的视口下，`document.documentElement.scrollWidth <= 390`，名字元素的 `title` 属性等于完整的别名；
    - 390px 宽的视口下显示卡片列表，不显示表格。
- [ ] **Step 2:** 运行 `npx vitest run tests/unit/deviceFilter.test.ts && npx playwright test tests/e2e/devices.spec.ts`。Expected：FAIL。
- [ ] **Step 3:** 实现。页面挂载时调用 `usePolling(inventory.refresh, 5000)`。各列的内容和顺序按 spec §5.6 实现。整行都可以点击，⋯ 菜单的点击要阻止冒泡。⋯ 菜单依次包含：重命名、复制内网 IP（设备没有 IP 时禁用）、复制设备 ID、分隔线、删除设备…（danger 样式）。标题和副标题的文案格式是：「设备」，「N 台设备 · M 台在线 · K 台待加入网络」。
- [ ] **Step 4:** 运行同一条命令。Expected：PASS。
- [ ] **Step 5:** 提交：`git commit -m "feat: tailscale-style device list"`

### Task 9: 连接判断的领域逻辑

**Files:**
- Create：`src/domain/connections.ts`
- Test：`tests/unit/connections.test.ts`

**Interfaces:**
- Consumes：`NodeRouteInfo`、`NodePeerInfo`、`CentralNetworkMember`、`TemporaryPeer`，以及 `ipv4FromU32`、`memberIp`。
- Produces（计划 3 的 Dashboard 也会用到）：
  ```ts
  export type LinkMode = { type: 'p2p'; tunnel: string } | { type: 'relay'; via: string }
  export interface PeerLink {
    peerId: number; name: string; ip: string | null;
    kind: 'member' | 'temporary' | 'infra'; deviceId: string | null;
    mode: LinkMode; latencyMs: number | null; rxBytes: number | null; txBytes: number | null;
  }
  export function classifyPeers(i: { routes: NodeRouteInfo[]; peers: NodePeerInfo[];
    members: CentralNetworkMember[]; temporaryPeers: TemporaryPeer[] }): PeerLink[]
  export function pairStats(linksByDevice: Record<string, PeerLink[]>):
    { direct: number; relayed: number; rate: number | null }
  ```
  规则见 spec §6.4：
  - 只要在 peers 中存在至少一条 `!is_closed` 的连接，就判定为 p2p。`tunnel` 取第一条连接的 `tunnel.tunnel_type`，转成小写，没有时为 `'unknown'`。延迟取所有打开的连接中最小的 `stats.latency_us / 1000`。rx 和 tx 是所有打开连接的总和。
  - 否则判定为 relay。`via` 是 `next_hop_peer_id` 对应路由解析出来的名字，解析不到时用 `#<id>`。延迟取 `path_latency`，单位以上游 `Status.vue` 的渲染方式为准，并对照 fixture `list-route-core1.json` 确认。
  - 区分 kind：路由的 `ipv4_addr` 能和成员的 `memberIp` 对上，就是 member；否则 `hostname` 等于成员的 `hostname`，也是 member；`peer_id` 或 IP 能和 `temporaryPeers` 对上，就是 temporary；其余都是 infra。名字取值的顺序：成员的 `alias`、`hostname_override`、`hostname`，最后用路由里的 `hostname`。
  - `pairStats` 只统计 kind 为 member 的链接。设备对以排好序的 `[a, b]` 去重，任意一方报告了 p2p，这一对就算直连。`rate = direct / (direct + relayed)`，没有任何设备对时为 `null`。

- [ ] **Step 1:** 写失败的测试（用 fixture 加上手工构造的数据）：
  - `fixture: core1 sees core2 and core3 as members`：基于 `list-route-core1.json`、`list-peer-core1.json`、`members.json`，结果的 kind 都是 `member`，名字和 `members.json` 一致；
  - `relay via next hop`：路由 `{ peer_id: 3, next_hop_peer_id: 2, path_latency: 40 }`，peers 里只有 2 → `mode` 为 `{ type: 'relay', via: <2 的名字> }`，`latencyMs === 40`；
  - `closed conns are not p2p`：peer 3 只有一条连接，且 `is_closed: true` → 判定为 relay；
  - `unknown peer is infra; temporary matched by peer_id`；
  - `pairStats dedups and prefers direct`：A 看到 B 是 p2p，B 看到 A 是 relay，A 和 C 之间是 relay → `{ direct: 1, relayed: 1, rate: 0.5 }`；infra 链接不计入统计；输入为空时 `rate === null`。
- [ ] **Step 2:** 运行 `npx vitest run tests/unit/connections.test.ts`。Expected：FAIL。
- [ ] **Step 3:** 实现。
- [ ] **Step 4:** 运行同一条命令。Expected：PASS。
- [ ] **Step 5:** 提交：`git commit -m "feat(domain): p2p/relay link classification"`

### Task 10: 设备详情页

**Files:**
- Create：`src/domain/memberOverride.ts`、`src/composables/useDeviceRuntime.ts`、`src/pages/DeviceDetailPage.vue`
- Create（`src/components/device-detail/`）：`DetailHeader.vue`、`NetworkSwitcher.vue`、`JoinNetworkDialog.vue`、`OverviewCard.vue`、`ConnectionsCard.vue`、`MemberSettingsCard.vue`、`ProxyCidrEditor.vue`、`DiagnosticsCard.vue`、`DangerZone.vue`、`NotInNetworkState.vue`
- Test：`tests/unit/memberOverride.test.ts`、`tests/e2e/device-detail.spec.ts`

**Interfaces:**
- Consumes：`useInventory().deviceById`、client 中成员相关和 proxy-rpc 相关的函数、`classifyPeers`、`usePolling`。
- Produces：
  - `CENTRAL_OWNED_FIELDS: readonly string[]` 包含：`instance_id`、`dhcp`、`dhcp_ipv4_cidr`、`dhcpv6`、`dhcp_ipv6_cidr`、`virtual_ipv4`、`network_length`、`hostname`、`network_name`、`network_secret`、`networking_method`、`public_server_url`、`peer_urls`、`peers`、`secure_mode`、`managed_credentials`、`acl`、`credential_file`（依据：上游 `central_network/compiler.rs` 中的 `apply_member_override`）。计划 6 的迁移向导也会使用这个常量；
  - `overrideState(config: Record<string, unknown> | null | undefined): 'default' | 'overridden'`：去掉 `CENTRAL_OWNED_FIELDS` 和 `proxy_cidrs` 之后，只要有任意字段的值不属于 `null`、`undefined`、`[]`、`''`，就返回 overridden；
  - `resetOverridePlan(config): { kind: 'delete' } | { kind: 'put'; config: { proxy_cidrs: string[] } }`：`proxy_cidrs` 不为空时返回 put，否则返回 delete；
  - `useDeviceRuntime(deviceId: Ref<string>, networkId: Ref<string | null>, online: Ref<boolean>): { links: Ref<PeerLink[] | null>; error: Ref<string | null>; loading: Ref<boolean>; retry(): void }`：每 15 秒轮询一次。`online` 为 false 或 `networkId` 为空时，不发任何请求，`links` 保持为 `null`。
  - 页面路由参数：`machineId`，以及可选的 `networkId`（不传时使用设备的 `defaultNetworkId`）。

- [ ] **Step 1:** 写失败的测试：
  - `memberOverride.test.ts`：fixture `member-config-core3.json`（只通过 PATCH 设置过 proxy_cidrs）返回 `'default'`；加入 `{ mtu: 1300 }` 后返回 `'overridden'`；只加入 `{ hostname: 'x', acl: {...} }`（都属于中央网络掌管的字段）仍返回 `'default'`；`resetOverridePlan` 对 fixture 返回 `{ kind: 'put', config: { proxy_cidrs: ['192.168.77.0/24'] } }`，对 `null` 返回 `{ kind: 'delete' }`；
  - `device-detail.spec.ts`：
    1. 从设备列表点击 core1，到详情页显示出连接表，中间没有出现任何包含「选择网络」或「选择实例」字样的元素；面包屑是「设备 / core1」；
    2. 网络切换器展开后，`home-central` 旁边有「默认 ✓」，并且有「加入其他网络…」这一项；在加入其他网络的对话框里选择网络 X，发起 `POST /networks/X/members`；
    3. 连接表显示 core2、core3，方式标签以 `P2P ·` 或 `中继 · 经` 开头；
    4. 「设为固定」把 IP 设为 `10.144.144.9`，发起的 `PATCH /networks/<n>/members/<core1>` 请求体**正好是** `{ virtual_ipv4: '10.144.144.9' }`；「改回自动」时请求体是 `{ virtual_ipv4: '' }`；把主机名覆盖设为 `nas` 时，请求体正好是 `{ hostname_override: 'nas' }`；
    5. 子网代理：根据 `show-node-info` 返回的网卡 IP，出现 `/24` 网段的候选项；添加后，PATCH 请求体正好是 `{ proxy_cidrs: [...] }`；
    6. 在 core3 上点「恢复默认」，确认弹窗里写着「子网代理会保留」，确认后发起 `PUT …/members/<core3>/config`，请求体是 `{ config: { proxy_cidrs: ['192.168.77.0/24'] } }`，而不是 DELETE；
    7. 诊断卡片（默认折叠）展开后：日志级别下拉框改为 DEBUG（值为 4），发起 proxy-rpc `set_logger_config`，payload 为 `{ level: 4 }`；运行中的 TOML 能复制；
    8. 「移出此网络」确认后发起 `DELETE /networks/<n>/members/<id>`；「删除设备…」确认后跳回 `/#/devices`；
    9. 设备不在任何网络时，显示 `NotInNetworkState`，主按钮的文字是「加入 home-central」；
    10. **Review Focus 2**：离线设备的连接卡片显示「设备离线，恢复连接后显示」；在页面上等待 20 秒（使用 Playwright 的 `page.clock`），`requests` 里没有任何 proxy-rpc 请求；「设为固定」按钮仍然可以点击；
    11. **Review Focus 3**：proxy-rpc 的 `list_route` 返回 500，连接卡片显示错误信息和「重试」按钮，概览卡片和设置卡片照常显示；点击重试后再次请求。
- [ ] **Step 2:** 运行 `npx vitest run tests/unit/memberOverride.test.ts && npx playwright test tests/e2e/device-detail.spec.ts`。Expected：FAIL。
- [ ] **Step 3:** 实现。布局：左栏宽 1.7fr，依次是连接、此网络中的设置、诊断、危险操作；右栏宽 1fr，是概览。窄屏（640px 以下）改为单栏，概览放在最前面。高级配置这一行在本计划中只显示状态（默认或已覆盖）和「恢复默认」；「编辑」按钮由计划 4 加上。概览卡片的字段按 spec §5.7。页头的名字点击后可以直接修改别名（调用 `setMachineAlias`）。页头的 ⋯ 菜单包含：复制设备 ID、删除设备…。网络切换器中的「手动实例（高级）…」这一项由计划 4 加上。设置卡片里的「主机名覆盖」行可以编辑和清空，提交的 PATCH 请求体正好是 `{ hostname_override: '<值>' }`，清空时值为 `''`。
- [ ] **Step 4:** 运行同一条命令。Expected：PASS。
- [ ] **Step 5:** 提交：`git commit -m "feat: full-page device detail on default network"`

### Task 11: 对接本地真实后端的冒烟测试

**Files:**
- Create：`tests/live/smoke.spec.ts`、`playwright.live.config.ts`；修改 `README.md`（新建：开发方式、各项测试命令、怎么连接 testenv）

**Interfaces:**
- Consumes：计划 1 的 `testenv`（`ET_DATA_DIR=./data-central`，其中已有 `home-central` 网络）。

- [ ] **Step 1:** 编写 `playwright.live.config.ts`：`webServer` 执行 `ET_API=http://localhost:11211 npm run dev -- --port 5199`，`baseURL` 为 `http://localhost:5199`，`testDir` 为 `tests/live`。
- [ ] **Step 2:** 编写 `tests/live/smoke.spec.ts`：
  1. 用 admin/admin 登录；
  2. 设备列表中出现 core1、core2、core3，IP 都匹配 `/^10\.144\.144\.\d+$/`；
  3. 点开 core1，30 秒内连接表中出现 core2 和 core3；
  4. 对 core2 执行「设为固定」，IP 设为 `10.144.144.20`，然后通过 `GET /networks/<id>/members` 确认已生效；最后执行「改回自动」恢复原状。
- [ ] **Step 3:** 运行：`ET_DATA_DIR=./data-central docker compose -f testenv/docker-compose.yml up -d && npx playwright test -c playwright.live.config.ts`。Expected：PASS。
- [ ] **Step 4:** 运行全部检查：`npm test && npm run typecheck && npm run build && npm run e2e`。Expected：全部通过。
- [ ] **Step 5:** 提交：`git commit -m "test: live smoke against local v2.7.1 testenv"`
