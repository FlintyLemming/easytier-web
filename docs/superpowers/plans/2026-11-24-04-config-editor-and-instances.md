# 高级配置编辑器与手动实例 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做出两样东西。第一是高级配置编辑器，有「表单 / TOML」两种模式，用来编辑设备在中央网络里的成员配置覆盖。第二是设备上的「手动实例」页面，可以新建、编辑、启用/停用、删除实例，导入和导出 TOML，并管理 VPN Portal 客户端。全过程不能丢失任何配置字段。

**Architecture:**
- **API 层：**`src/api/client.ts` 补上按设备操作实例的接口、TOML 互转接口和 VPN Portal 接口。返回结构以 Task 1 从本地 testenv 抓到的 fixtures 为准。
- **纯函数：**放在 `src/domain/` 下，全部用单元测试覆盖：
  - 字段默认值判断；
  - 成员覆盖的保存规则；
  - 实例列表的整理；
  - VPN Portal 的地址计算。
- **编辑器：**`ConfigEditor` 是一个组件，内部把配置对象当作草稿来编辑。
  - 读进来的对象先经过已移植的 `normalizeNetworkConfig`，保存前再经过 `toBackendNetworkConfig`。表单没有展示的字段原样保留。
  - 成员覆盖和手动实例共用这一个组件，用 `mode` 参数区分要显示哪些部分。
- **手动实例面板：**`InstancesPanel` 是一个组件，同时用在 `/devices/:machineId/instances` 页面和 webhook 模式的设备详情里。

**Tech Stack:** 不新增依赖。沿用计划 2、3 的技术栈：Vue 3.5、Pinia、vue-router、vue-i18n、Tailwind v4、Reka UI、`@protobuf-ts`，以及已移植的 `src/lib/networkConfig.ts`。

**Spec:** `docs/superpowers/specs/2026-11-23-easytier-web-console-design.md`（§2 目标 2、§5.7、§6.5、§6.6、§6.7、§6.9、§2 反目标「保存配置时丢字段」）

**规划时核实的事实**（都在本地 testenv 上实测过：web v2.7.1，core 2.6.4，没有碰生产环境）：
- **成员覆盖会整体替换配置。**上游 `central_network/compiler.rs` 的 `apply_member_override` 是 `merged = override.clone()`，然后只把中央网络掌管的字段（`CENTRAL_OWNED_FIELDS`）换回网络级的值。网络级的基础配置除了这些字段，其他都是默认值。所以：覆盖对象里除了中央掌管的字段，其余每个字段，就是这个成员的最终配置。
- **没有覆盖时，`GET /networks/{id}/members/{device}/config` 返回 `{}`（HTTP 200），不是 404。**后端自己建的覆盖对象长这样：`{"proxy_cidrs": [...]}`。
- **TOML 互转接口：**
  - `POST /parse-config {toml_config}` 和 `POST /generate-config {config}` 出错时也返回 HTTP 200，内容分别是 `{"error": "...", "config": null}` 和 `{"error": "...", "toml_config": null}`；成功时 `error` 为 `null`。
  - `generate-config` 要求配置里有可用的组网方式。不带 `networking_method` 时，会报 `failed to parse public server uri`；经过 `toBackendNetworkConfig` 处理（会写入 `networking_method: "Manual"`）以后就没问题了。
- **TOML 往返会加上中央掌管的字段。**只有少数字段的配置，经 `generate-config` 再 `parse-config` 往返一遍以后，会多出随机的 `instance_id`、`dhcp: false`、`dhcpv6: false`、空的 `network_name` / `network_secret`、`networking_method: "Manual"`。这些都是中央网络掌管的字段。
- **实例列表：**`GET /machines/{id}/networks` 返回 `{running_inst_ids: UUID[], disabled_inst_ids: UUID[]}`，UUID 是 `{part1..part4}` 对象。**`running_inst_ids` 里包含这台设备所在中央网络的实例**（实例 id 等于网络 id）。
- **实例元信息：**`POST /machines/{id}/networks/metas {instance_ids}` 返回 `{metas: {<id>: {inst_id, network_name, instance_name, source}}}`。`source` 是 `"ConfigSourceWeb"`，或者 `ConfigSourceUser`、`ConfigSourceUnspecified`。`config_permission` 的值为 0 时，字段直接省略。按上游的定义，`1` 表示只读，`2` 表示不可删除。
- **运行信息：**`GET /machines/{id}/networks/info/{inst}` 返回 `{info: {map: {<id>: {running, error_msg?, my_node_info, events, routes?, peers?, peer_route_pairs?, foreign_network_summary}}}}`。停用的实例返回 `{info: {}}`。
- **实例的增删改：**
  - `POST /machines/{id}/networks {config, save: true}` 新建实例并立即运行。
  - `PUT /machines/{id}/networks/config/{inst} {config}` 用在新 id 上时，只保存配置，实例出现在 `disabled_inst_ids` 里。
  - `PUT /machines/{id}/networks/{inst} {disabled}` 启用或停用。
  - `DELETE /machines/{id}/networks/{inst}` 删除。
  - 读回来的实例配置里，每个开关都有明确的值（后端会补全）。
- **VPN Portal：**
  - 读取信息走 proxy-rpc：`api.instance.VpnPortalRpcService` / `get_vpn_portal_info`，返回 `{vpn_portal_info: {vpn_type, listener?, clients[], client_config(已弃用)}}`。
  - 增删客户端走 `PATCH /machines/{id}/networks/{inst}/vpn-portal-clients {patches: [{action: 'ADD'|'REMOVE'|'CLEAR', client?}]}`。
  - 客户端的 `virtual_ip` 必须是这个实例所在网段内的 CIDR（例如 `10.144.144.20/24`），不能是网络地址、广播地址或者本机地址。不带前缀时，后端返回 HTTP 500「has an unusable virtual IP」。
  - testenv 里的 2.6.4 core 上，VPN Portal 显示「Wireguard VPN Portal Not Started」，所以 VPN Portal 只能用 mock 测试。
- **默认值：**开关的默认值来自 `proto/common.proto` 的 `easytier.flag` 注解，例如 `mtu` 1380、`multi_thread` true、`bind_device` true、加密默认开启（`disable_encryption` false）、`encryption_algorithm` `aes-gcm`、`data_compress_algo` `None`。
- **可选值：**加密算法有 `aes-gcm`、`aes-256-gcm`、`chacha20`、`xor`；压缩算法有 `None`、`Zstd`、`Lzo`。

**规划时做的决定**（spec §7 交给实现者决定的部分，执行前请用户过目）：
1. **保存成员覆盖时，去掉中央掌管的字段，并且总是带上成员当前的子网代理。**如果保存后的覆盖里，没有任何字段和默认值不同，就改走「恢复默认」的写法（有子网代理时 PUT 一个只带 `proxy_cidrs` 的对象，否则 DELETE），这样「默认」状态不会被一次无改动的保存变成「已覆盖」。
2. **「已覆盖」的判断改为和声明的默认值比较**（例如 `mtu: 1380`、`multi_thread: true` 都算默认），这是计划 2 留下的待办。
3. **表单里放的字段：**网络（只在手动实例里显示）、连接（监听地址、MTU、延迟优先）、加密与压缩、KCP/QUIC、端口转发、DNS（魔法 DNS 和域名）、VPN Portal（开关、监听地址、客户端）、其他开关（其余所有布尔开关）。路由、出口节点、SOCKS5、映射监听、中转白名单、ACL、DNS 记录等其他内容，用 TOML 模式编辑。网络级 ACL 的可视化编辑器在计划 5 里做。
4. **成员模式下，隐藏中央网络掌管的字段**（网络名、密钥、组网方式、IP、主机名、安全模式、ACL），子网代理也隐藏（它有单独的一行）。TOML 页上方有一行说明：这些字段由中央网络管理，在这里修改会被忽略。
5. **开关的写法：**没写在配置里的开关，界面上显示它的默认值。用户把开关改回默认值时，从配置里删掉这个字段，而不是写成明确的值。
6. **手动实例面板也嵌在 webhook 模式的设备详情里**（spec §6.9「设备详情只显示『手动实例』和概览」）。中央模式下，入口有两个：网络切换器里的「手动实例（高级）…」，以及未入网空状态里的同名链接。
7. **只读和不可删除：**`config_permission` 带只读位的实例，不能编辑；带不可删除位的，不能删除。`source` 为 `ConfigSourceUser` 的实例，标为「设备本地配置」。
8. **VPN Portal 只做列表、增删客户端和复制客户端配置。**上游的二维码要新增 `qrcode` 依赖，这里不做。
9. **按钮颜色：**「新建实例」是手动实例页唯一的橙色主按钮（和计划 2 对「加入网络」的处理一致）。对话框里的「保存」一律用 secondary 样式（和计划 2 F9 对确认框的处理一致）。
10. **编辑运行中的实例：**保存时用 `POST /networks {config, save: true}`，实例会用新配置重启，对话框里说明这一点。编辑已停用的实例，只保存配置。

## Global Constraints

- 接口以 easytier-web **v2.7.1** 为准，返回结构以 `tests/fixtures/v2.7.1/` 为准，包括本计划 Task 1 新抓的那些。`parse-config` 和 `generate-config` 出错时也是 HTTP 200，内容带 `error`。
- **不丢字段：**读到的配置对象一律先经过 `normalizeNetworkConfig`，保存前经过 `toBackendNetworkConfig`。表单没有展示的字段，保存后必须和读到的完全相等（deep equal）。
- **成员覆盖的写入**：内容里不能有 `CENTRAL_OWNED_FIELDS` 中的任何字段，并且始终带上成员当前的 `proxy_cidrs`；没有任何非默认字段时，按 `resetOverridePlan` 写入。
- **实例列表**里永远不出现中央网络的实例（实例 id 等于任何一个中央网络的 id）。编辑现有实例时（包括经过 TOML），它的 `instance_id` 不变。
- **开关**：配置里没写的开关，显示它的声明默认值；改回默认值时，删掉这个字段。
- **危险操作要二次确认**：删除实例、删除 VPN 客户端、恢复默认。停用实例可以恢复，不需要确认。
- **不新增运行时依赖**，运行时不向第三方发请求。VPN Portal 的私钥在浏览器里生成（`crypto.getRandomValues`）。
- **视觉**：沿用计划 2 的 Global Constraints（token、无阴影、标题字重 400、IP/ID/CIDR/TOML 用 JetBrains Mono）。橙色只用于手动实例页的「新建实例」；对话框里的保存按钮用 secondary。
- **轮询**：手动实例面板每 5 秒刷新一次实例列表和运行信息，页面不可见时暂停。设备离线时不发任何实例请求。
- **语言**：所有新文案同时加入 zh-CN 和 en，键名一致性测试必须通过。本计划给出的中文原样使用。
- **webhook 模式**（`session.webhookMode`）下，手动实例面板可以正常使用（这些接口在 webhook 模式下存在），没有中央网络需要排除。
- **移植的代码**：从上游复制或改写的代码（开关文案、VPN Portal 地址计算），文件开头加 `// Ported from EasyTier v2.7.1 (https://github.com/EasyTier/EasyTier), LGPL-3.0-or-later`。
- **提交信息**结尾空一行，再加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。永远不推送。不碰任何远程主机。

## Review Focus

1. **编辑后不丢字段。**一个手动实例的配置里有表单不展示的字段（路由、出口节点、ACL、DNS 域名、SOCKS5、映射监听、端口转发、VPN Portal 配置）。打开编辑器，只改 MTU 并保存，提交的配置里，除 MTU 外的每个字段都和读到的相同。测试放在 Task 2（往返单测）和 Task 5（e2e 检查请求体）。
2. **TOML 错误和后端失败。**TOML 写错时，要显示错误信息，「保存」不可用，也不能切回表单页；`parse-config` 请求本身失败时，同样显示错误，并且不丢已编辑的内容。测试放在 Task 3。
3. **只有子网代理的成员覆盖。**后端自己建的 `{proxy_cidrs}` 覆盖对象，在编辑器里打开后应该显示为默认值。不做任何修改直接保存，写入内容仍然只有 `proxy_cidrs`，状态仍然是「默认」，子网代理不能丢。测试放在 Task 4。
4. **离线设备和接口出错。**设备离线时，面板显示离线状态，不发任何实例请求。列表读取失败时，显示错误和「重试」。中央网络的实例永远不出现在列表里。测试放在 Task 5。
5. **VPN 客户端地址校验。**以下情况要在发请求之前就拦下：不带前缀的 IP、网段外的 IP、网络地址或广播地址、已被占用的地址、不合法的名字。后端返回的错误信息原样显示。测试放在 Task 2（单测）和 Task 6（e2e）。

---

### Task 1: 抓取实例相关的 fixtures，补全 API 客户端

**Files:**
- Create: `testenv/capture-instance-fixtures.ts`、`testenv/lib/save-fixtures.ts`（从 `testenv/capture-fixtures.ts` 里把 `saveAll` 原样抽出来，两个脚本共用）
- Create (generated): `tests/fixtures/v2.7.1/instances-core2.json`、`instance-metas-core2.json`、`instance-config-core2.json`、`instance-info-core2.json`、`instance-info-disabled.json`、`member-config-empty.json`、`parse-config-ok.json`、`parse-config-error.json`、`generate-config-ok.json`、`vpn-portal-info-core2.json`
- Modify: `testenv/capture-fixtures.ts`（改为使用 `save-fixtures.ts`）、`testenv/capture-fixtures.test.ts`、`testenv/README.md`、`src/api/client.ts`、`src/api/types.ts`
- Test: `tests/unit/api.test.ts`

**Interfaces:**
- Produces（`src/api/types.ts`）：
```ts
export interface InstanceList { running: string[]; disabled: string[] }            // UUID 转成字符串
export type ConfigSource = 'web' | 'user' | 'unspecified'
export interface InstanceMeta { networkName: string; instanceName: string; source: ConfigSource; permission: number }
export const CONFIG_READ_ONLY = 1
export const CONFIG_NO_DELETE = 2
export interface InstanceRunningInfo {
  running: boolean
  error_msg?: string | null
  my_node_info?: { virtual_ipv4?: { address?: { addr?: number }; network_length?: number } | null; ips?: unknown } | null
  peer_route_pairs?: { route?: { ipv4_addr?: unknown } | null }[]
  [k: string]: unknown
}
export type VpnClientPatch =
  | { action: 'ADD'; client: { name: string; virtual_ip: string; groups: string[] } }
  | { action: 'REMOVE'; client: { name: string; virtual_ip: ''; groups: [] } }
  | { action: 'CLEAR' }
```
- Produces（`src/api/client.ts`，路径参数一律经过现有的 `seg()`）：
  - `listInstances(machineId): Promise<InstanceList>`：`GET /machines/{m}/networks`。
  - `instanceMetas(machineId, ids: string[]): Promise<Record<string, InstanceMeta>>`：`POST /machines/{m}/networks/metas {instance_ids}`；`ids` 为空时直接返回 `{}`，不发请求。`source` 的映射：`'ConfigSourceWeb'` 或 `2` → `'web'`，`'ConfigSourceUser'` 或 `1` → `'user'`，其他值 → `'unspecified'`。`permission` 取 `config_permission ?? 0`。
  - `instanceInfo(machineId, instId): Promise<InstanceRunningInfo | null>`：取 `info.map[instId]`，没有时返回 null。
  - `getInstanceConfig(machineId, instId): Promise<Record<string, unknown>>`：`GET …/networks/config/{inst}`。
  - `saveInstanceConfig(machineId, instId, config: object): Promise<void>`：`PUT …/networks/config/{inst} {config}`。
  - `runInstance(machineId, config: object, save: boolean): Promise<void>`：`POST …/networks {config, save}`。
  - `setInstanceDisabled(machineId, instId, disabled: boolean): Promise<void>`：`PUT …/networks/{inst} {disabled}`。
  - `deleteInstance(machineId, instId): Promise<void>`：`DELETE …/networks/{inst}`。
  - `vpnPortalInfo(machineId, instId): Promise<VpnPortalInfo | null>`：走 `proxyRpc`，结果经过 `normalizeVpnPortalInfo`。
  - `patchVpnPortalClients(machineId, instId, patches: VpnClientPatch[]): Promise<void>`：`PATCH …/networks/{inst}/vpn-portal-clients {patches}`。
  - `generateToml(config: object): Promise<{ toml: string } | { error: string }>`：`POST /generate-config {config}`。
  - `parseToml(toml: string): Promise<{ config: Record<string, unknown> } | { error: string }>`：`POST /parse-config {toml_config}`。

  这两个 TOML 函数遇到非 2xx 时，抛出 `ApiError`（和其他接口一样）；遇到 2xx 但带 `error` 时，返回 `{ error }`。

- [ ] **Step 1:** 把 `saveAll`（连同 redact 和临时目录的写法）从 `capture-fixtures.ts` 抽到 `testenv/lib/save-fixtures.ts`，然后运行 `node --test testenv/lib/api.test.ts testenv/capture-fixtures.test.ts`。Expected：PASS，行为不变。
- [ ] **Step 2:** 写 `testenv/capture-instance-fixtures.ts`，在 core2 上依次执行：
  1. 用固定 id `5eed0000-0000-4000-8000-000000000001` 新建并运行一个手动实例 `lab-manual`（`runInstance` 对应的请求，`save: true`）。配置要包含表单不展示的字段：`routes: ['10.99.0.0/16']`、`exit_nodes: ['10.144.144.1']`、`enable_socks5: true`、`socks5_port: 1081`、`mapped_listeners: ['tcp://203.0.113.10:11010']`、`enable_relay_network_whitelist: true`、`relay_network_whitelist: ['lab-*']`、一条端口转发、一条 ACL 链、`dns: { domain: 'lab.et' }`，以及 `vpn_portal_config: { enabled: true, wireguard_listen: '0.0.0.0:22022', clients: [] }`。另外设 `network_secret: 'fixture-secret'`、`dhcp: true`、`listener_urls: []`、`networking_method: 'Manual'`、`peer_urls: []`。
  2. 等实例运行起来（最多 60 秒）。
  3. 依次抓取：实例列表、元信息、配置、运行信息、VPN Portal 信息。
  4. 停用实例，再抓一次运行信息（得到 `instance-info-disabled.json`）。
  5. 抓 core2 在中央网络里的成员配置（得到 `member-config-empty.json`；如果 core2 已经有覆盖，就先报错退出，不能改动它）。
  6. 用实例配置调用 `generate-config`，把结果再交给 `parse-config`；另外用一段错误的 TOML `network_name = [` 调一次 `parse-config`。
  7. 在 `finally` 里删除这个实例。
  
  所有结果经过 `saveAll` 写入 fixtures。另外在 `testenv/README.md` 里写上运行命令。
- [ ] **Step 3:** 运行 `node testenv/capture-instance-fixtures.ts`（testenv 必须保持运行，不能关掉）。在 `capture-fixtures.test.ts` 里加上检查：
  - `instances-core2.json` 的 running 里包含固定 id，也包含中央网络 id（`index.json` 的 `networkId`）；
  - `instance-config-core2.json` 里有 `routes`、`exit_nodes`、`acl`、`port_forwards`、`vpn_portal_config`；
  - `parse-config-error.json` 的 `error` 不为空，`config` 为 null；
  - `member-config-empty.json` 是 `{}`。

  然后运行 `node --test testenv/capture-fixtures.test.ts`。Expected：PASS，原有的公网 IP 检查也通过。运行信息里 `my_node_info.ips` 下会有本机真实的公网地址：`redact.ts` 已经会把所有名为 `public_ipv4` 的键替换掉；如果检查发现还有漏网的地址（例如 `public_ipv6`），就扩展 `redact.ts` 和检查，不能把真实地址提交进仓库。
- [ ] **Step 4:** 在 `tests/unit/api.test.ts` 里写失败的测试，用 stub 的 fetch 返回上面这些 fixtures：
  - 每个新函数的请求方法、路径（含 `seg` 编码）和请求体都正确；
  - `listInstances` 把 UUID 转成了字符串；
  - `instanceMetas([])` 不发请求；`source` 的映射正确；
  - 停用实例的 `instanceInfo` 返回 null；
  - `parseToml` 遇到错误 fixture 返回 `{ error }`；`generateToml` 成功时返回 `{ toml }`；
  - `vpnPortalInfo` 走的是 proxy-rpc，并且发送了正确的 service、method 和 instance id。
- [ ] **Step 5:** 实现上述函数，然后运行 `npx vitest run tests/unit/api.test.ts && npm run typecheck`。Expected：PASS。
- [ ] **Step 6:** 提交：`git commit -m "feat(api): manual instance, toml and vpn portal endpoints with captured fixtures"`（新文件要先 `git add`）。

### Task 2: 默认值判断、成员覆盖的保存规则、实例整理与 VPN Portal 地址计算

**Files:**
- Modify: `src/lib/networkConfig.ts`（新增 `declaredDefault`）、`src/domain/memberOverride.ts`
- Create: `src/domain/instances.ts`、`src/domain/vpnPortal.ts`、`src/i18n/configFlags.ts`
- Modify: `src/i18n/zh-CN.ts`、`src/i18n/en.ts`（合并开关文案）
- Test: `tests/unit/memberOverride.test.ts`、`tests/unit/networkConfig.test.ts`、`tests/unit/instances.test.ts`、`tests/unit/vpnPortal.test.ts`、`tests/unit/i18n.test.ts`

**Interfaces:**
- Consumes：Task 1 的 `InstanceList`、`InstanceMeta`、`InstanceRunningInfo`、`CONFIG_READ_ONLY`、`CONFIG_NO_DELETE`，以及 fixtures。
- Produces:
```ts
// networkConfig.ts —— 和 defaultFlagValue 放在一起，读取 easytier.flag 注解
export function declaredDefault(field: string): boolean | string | undefined
//   布尔开关返回 declaredValue（已处理 negate）；其他有默认值的注解字段返回 meta.default 字符串（mtu → '1380'）；没有注解的字段返回 undefined
export function isDefaultValue(field: string, value: unknown): boolean
//   value 为 null/undefined/''/[] → true；declaredDefault 是布尔时，看 value === 它；是字符串时，看 String(value) === 它；其他情况 → false

// memberOverride.ts
export function overrideState(config): 'default' | 'overridden'          // 改为：忽略 CENTRAL_OWNED_FIELDS 和 proxy_cidrs 之后，存在 !isDefaultValue 的字段才算 overridden
export function memberOverridePayload(form: NetworkConfig, proxyCidrs: string[]):
  { kind: 'put'; config: Record<string, unknown> } | ResetOverridePlan
//   取 toBackendNetworkConfig(form)，删掉 CENTRAL_OWNED_FIELDS 中的每个字段，
//   把 proxy_cidrs 设为传入的值（为空时删掉这个字段）；
//   overrideState(结果) 是 'default' 时，返回 resetOverridePlan({ proxy_cidrs: proxyCidrs })

// instances.ts
export type InstanceState = 'running' | 'starting' | 'error' | 'disabled'
export interface InstanceRow {
  id: string; name: string; state: InstanceState; errorMsg: string | null; ipv4: string | null
  local: boolean; editable: boolean; deletable: boolean
}
export function manualInstanceIds(list: InstanceList, centralIds: Iterable<string>): { id: string; disabled: boolean }[]
export function buildInstanceRows(
  ids: { id: string; disabled: boolean }[],
  metas: Record<string, InstanceMeta>,
  infos: Record<string, InstanceRunningInfo | null>,
): InstanceRow[]

// vpnPortal.ts（移植上游 frontend-lib/src/modules/vpnPortal.ts，不引入 ip-num）
export function createVpnPortalConfig(): VpnPortalConfig      // 32 字节随机私钥（同上游的位处理），监听地址 '0.0.0.0:22022'，clients: []
export function vpnPortalUsedIps(info: InstanceRunningInfo | null, clients: { virtual_ip: string }[]): Set<number>
export function suggestVpnPortalAddress(info: InstanceRunningInfo | null, clients: { virtual_ip: string }[], used: Set<number>): { address: string; prefix?: number }
export function validVpnPortalAddress(address: string, prefix: number | undefined, used: Set<number>): boolean
export function validVpnClientName(name: string): boolean      // /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/
export function vpnPortalEndpoint(listener: string, info: InstanceRunningInfo | null): string
export function normalizeVpnPortalEndpoint(value: string, port: string): string
export function vpnPortalClientConfig(config: string, endpoint: string): string

// i18n/configFlags.ts
export const configFlagText: Record<'zh-CN' | 'en', Record<string, { label: string; help: string }>>
//   合并进两个语言包的 config.flags.<field>.label / .help
```

**规则：**
- **`manualInstanceIds`：**去掉 id 属于 `centralIds` 的实例。先列出运行中的，再列出已停用的，两组内部都保持接口返回的顺序。同一个 id 同时出现在两组里时，按已停用处理。
- **`buildInstanceRows`：**
  - `name`：依次取 meta 的 `networkName`、`instanceName`，都没有时用 id。
  - `state`：
    - 已停用 → `disabled`；
    - info 里 `running` 为 true → `running`；
    - info 里有非空的 `error_msg` → `error`；
    - 其余情况 → `starting`。
  - `ipv4`：取 `my_node_info.virtual_ipv4`，写成 `a.b.c.d/len`。
  - `local`：`source === 'user'`。
  - `editable` / `deletable`：按 permission 的只读位、不可删除位取反。
  - 结果按 name（zh-CN）排序。
- **`configFlagText`：**为 `formFlags()` 返回的每个字段，提供标签和帮助文字。中文取上游 v2.7.1 `easytier-web/frontend-lib/src/locales/cn.yaml` 里的同名条目，英文取 `en.yaml`（如 `latency_first: 开启延迟优先模式`、`latency_first_help: 忽略中转跳数，选择总延迟最低的路径`）。上游没有对应条目时，中文用字段名，英文用首字母大写的字段名，并在报告里列出这些字段。

- [ ] **Step 1:** 写失败的测试：
  - `networkConfig.test.ts`：
    - `isDefaultValue('mtu', 1380)`、`isDefaultValue('multi_thread', true)`、`isDefaultValue('disable_encryption', false)`、`isDefaultValue('encryption_algorithm', 'aes-gcm')`、`isDefaultValue('data_compress_algo', 'None')`、`isDefaultValue('latency_first', undefined)` 都为 true（`isDefaultValue` 处理的是后端 JSON，枚举用名字表示）；
    - `isDefaultValue('mtu', 1300)`、`isDefaultValue('multi_thread', false)`、`isDefaultValue('routes', ['10.0.0.0/8'])` 都为 false。
    - 往返测试：把 `instance-config-core2.json` 交给 `normalizeNetworkConfig`，把 mtu 改成 1300，再交给 `toBackendNetworkConfig`。结果和原 fixture 相比，除了 `mtu` 以外，`routes`、`exit_nodes`、`acl`、`dns`、`socks5_port`、`enable_socks5`、`mapped_listeners`、`relay_network_whitelist`、`port_forwards`、`vpn_portal_config` 都相等（`toEqual`）。
  - `memberOverride.test.ts`：
    - `overrideState({ mtu: 1380, multi_thread: true, proxy_cidrs: ['a'] })` 为 `'default'`；`overrideState({ mtu: 1300 })` 为 `'overridden'`。
    - `memberOverridePayload(normalizeNetworkConfig({proxy_cidrs: ['192.168.77.0/24']}), ['192.168.77.0/24'])` 等于 `{ kind: 'put', config: { proxy_cidrs: ['192.168.77.0/24'] } }`；传入的 proxyCidrs 为空时，等于 `{ kind: 'delete' }`。
    - 草稿里有 `mtu: 1300`、`network_name: 'x'`、`instance_id: 'y'`、`peer_urls: ['tcp://a:1']` 时：结果是 put，config 里有 `mtu: 1300`、`proxy_cidrs`，不含任何 `CENTRAL_OWNED_FIELDS` 中的键。
  - `instances.test.ts`（用 Task 1 的 fixtures）：
    - 中央网络 id 被排除，`lab-manual` 保留；
    - 状态推导覆盖四种情况；
    - `ipv4` 的格式正确；
    - permission 为 3 时，`editable` 和 `deletable` 都为 false；
    - `source: 'user'` 时 `local` 为 true。
  - `vpnPortal.test.ts`：
    - `createVpnPortalConfig()` 生成的私钥 base64 解码后长 32 字节，并且 `key[0] & 7 === 0`、`(key[31] & 192) === 64`；
    - 实例 IP 为 `10.144.144.3/24`、已用 `.3` 和 `.20` 时，`suggestVpnPortalAddress` 返回 `{ address: '10.144.144.1', prefix: 24 }`；
    - `validVpnPortalAddress` 对网络地址 `.0`、广播地址 `.255`、已被占用的地址、网段外的地址、没有前缀的情况都返回 false；
    - `validVpnClientName('phone-1')` 为 true，`validVpnClientName('-x')` 为 false；
    - `vpnPortalEndpoint('0.0.0.0:22022', 带公网 IPv4 的 info)` 返回 `'203.0.113.10:22022'`；
    - `vpnPortalClientConfig` 会替换 `Endpoint =` 这一行。
  - `i18n.test.ts`：`formFlags()` 里的每个字段，在两个语言包里都有 `config.flags.<field>.label` 和 `.help`。
- [ ] **Step 2:** 运行 `npx vitest run tests/unit/networkConfig.test.ts tests/unit/memberOverride.test.ts tests/unit/instances.test.ts tests/unit/vpnPortal.test.ts tests/unit/i18n.test.ts`。Expected：FAIL。
- [ ] **Step 3:** 实现上述内容。现有的 `memberOverride` 测试如果因为新的判断规则而改变了预期，在测试里说明原因后再修改。
- [ ] **Step 4:** 运行同一条命令，再运行 `npm test && npm run typecheck`。Expected：PASS。
- [ ] **Step 5:** 提交：`git commit -m "feat: config defaults, member override payload, instance rows and vpn portal helpers"`（新文件要先 `git add`）。

### Task 3: 高级配置编辑器（表单 / TOML）

**Files:**
- Create: `src/components/config-editor/ConfigEditor.vue`、`ConfigEditorDialog.vue`，以及各个分区组件：`SectionNetwork.vue`、`SectionConnection.vue`、`SectionCrypto.vue`、`SectionProxy.vue`、`SectionPortForwards.vue`、`SectionDns.vue`、`SectionVpnPortal.vue`、`SectionFlags.vue`、`ListField.vue`（可增删的字符串列表）
- Modify: `src/i18n/zh-CN.ts`、`src/i18n/en.ts`
- Test: `tests/unit/configEditor.test.ts`

**Interfaces:**
- Consumes：Task 1 的 `generateToml`、`parseToml`；Task 2 的 `declaredDefault`、`isDefaultValue`、`createVpnPortalConfig`、`configFlagText`；`normalizeNetworkConfig`、`toBackendNetworkConfig`、`formFlags`、`defaultFlagValue`、`NetworkConfig`、`CompressionAlgoPb`（`src/lib/networkConfig.ts`）；`isIpv4`、`isIpv4Cidr`（`src/domain/cidr.ts`）。
- Produces:
  - `ConfigEditor.vue`：
    - Props：`modelValue: NetworkConfig`（已 normalize）、`mode: 'member' | 'instance'`。
    - Emits：`update:modelValue`（深拷贝后的新草稿）、`update:valid`（boolean）。
    - 用 `defineExpose` 暴露 `flush(): Promise<NetworkConfig | null>`：当前在 TOML 页并且改动过时，先解析 TOML，失败时返回 null；否则直接返回当前草稿。
  - `ConfigEditorDialog.vue`：
    - Props：`open`（v-model）、`title: string`、`mode`、`initial: NetworkConfig`、`busy: boolean`、`note?: string`（显示在表单上方的说明）、`actions: { key: string; label: string }[]`。
    - Emits：`action(key: string, config: NetworkConfig)`（先 flush，成功后才 emit）、`update:open`。
    - 草稿不合法、或者正在 busy 时，所有 action 按钮都不可用。

**规则：**
- **草稿：**`ConfigEditor` 内部持有一份草稿（`structuredClone(modelValue)`），各分区直接修改这份草稿上的字段，`ConfigEditor` 深度监听并 emit。表单只改它展示的字段，其余字段保持原样。
- **表单页的分区**，按顺序：
  1. **网络**（只在 instance 模式显示）：
     - 网络名 `network_name`、网络密钥 `network_secret`；
     - 节点地址 `peer_urls`（列表）；
     - 「自动分配 IP」`dhcp` 开关；关闭时填 `virtual_ipv4` 和 `network_length`（1–32）；
     - 主机名 `hostname`；
     - 子网代理 `proxy_cidrs`（列表，每一项必须是 CIDR）。
  2. **连接：**
     - 监听地址 `listener_urls`（列表，每项必须形如 `协议://地址:端口`）；
     - MTU（留空表示默认 1380；填写时范围 400–1380）；
     - 延迟优先 `latency_first`。
  3. **加密与压缩：**
     - 「加密」开关，等于 `!disable_encryption`；
     - 加密算法 `encryption_algorithm`：下拉选择 `aes-gcm`（默认）、`aes-256-gcm`、`chacha20`、`xor`，加密关闭时不可选；
     - 压缩 `data_compress_algo`：下拉选择 `None`（默认）、`Zstd`、`Lzo`。
  4. **KCP / QUIC：**`enable_kcp_proxy`、`disable_kcp_input`、`enable_quic_proxy`、`disable_quic_input`。
  5. **端口转发：**每行包括协议（tcp/udp）、本地地址、本地端口、目标地址、目标端口，可以增删。地址必须是 IPv4，端口在 1–65535 之间。
  6. **DNS：**魔法 DNS `enable_magic_dns`；域名 `dns.domain`（为空时删掉 `dns.domain`；`dns` 里的其他内容保持原样）。
  7. **VPN Portal：**
     - 「启用」开关：打开时，如果没有 `vpn_portal_config`，就用 `createVpnPortalConfig()` 生成；关闭时把 `enabled` 设为 false，保留其余内容。
     - 监听地址 `wireguard_listen`。
     - 客户端列表：名称、虚拟 IP（必须是 CIDR）、分组（逗号分隔），可以增删。
  8. **其他开关：**`formFlags()` 中除去上面已经单独展示的字段，其余全部列为复选框，标签和帮助文字来自 `config.flags.*`。
- **开关的读写**：所有开关的选中状态是 `草稿[field] ?? defaultFlagValue(field)`。用户把开关改到等于默认值时，删掉这个字段；改到其他值时，写入明确的值。
- **TOML 页：**
  - 进入时：调用 `generateToml(toBackendNetworkConfig(草稿))`，加载中显示 SkeletonRows。返回 `error` 时显示错误，并提供「回到表单」。
  - 编辑区：用等宽字体的 `<textarea>`，`spellcheck="false"`。
  - 离开 TOML 页（切回表单，或者 `flush`）时：如果改动过，先调用 `parseToml`。
    - 失败时，留在 TOML 页，在编辑区下方显示错误，`valid` 为 false。
    - 成功时，把解析出的配置经过 `normalizeNetworkConfig` 换成新草稿。instance 模式下，把 `instance_id` 恢复为原来的值；member 模式下不做处理（保存时由 Task 2 的 payload 去掉中央字段）。
  - 请求本身失败（抛出 ApiError）时，同样显示错误，留在当前页，不丢失文本。
  - member 模式下，TOML 编辑区上方显示说明：「网络名、密钥、组网方式、IP、主机名、ACL 由中央网络管理，这里的修改会被忽略。」
- **校验：**任一字段不合法时，在字段下方显示错误，`valid` 为 false。
- **标签页的无障碍：**用 Reka Tabs，或者带 `role="tablist"` / `aria-selected` 的按钮实现。
- **i18n（zh-CN 原文）：**
  - `config.tabs.form 表单`、`config.tabs.toml TOML`；
  - `config.section.network 网络`、`connection 连接`、`crypto 加密与压缩`、`proxy KCP / QUIC`、`portForwards 端口转发`、`dns DNS`、`vpnPortal VPN Portal`、`flags 其他开关`；
  - 字段：`config.field.networkName 网络名`、`networkSecret 网络密钥`、`peerUrls 节点地址`、`dhcp 自动分配 IP`、`virtualIpv4 虚拟 IPv4`、`networkLength 前缀长度`、`hostname 主机名`、`proxyCidrs 子网代理`、`listenerUrls 监听地址`、`mtu MTU`、`mtuHint 留空使用默认值 1380`、`latencyFirst 延迟优先`、`encryption 加密`、`encryptionAlgorithm 加密算法`、`compression 压缩`、`magicDns 魔法 DNS`、`dnsDomain 域名`、`vpnEnabled 启用`、`vpnListen 监听地址`、`vpnClients 客户端`、`vpnClientName 名称`、`vpnClientIp 虚拟 IP`、`vpnClientGroups 分组`；
  - 操作：`config.add 添加`、`config.remove 删除`；
  - TOML：`config.toml.loading 正在生成 TOML…`、`config.toml.parseError 无法解析：{message}`、`config.toml.memberHint 网络名、密钥、组网方式、IP、主机名、ACL 由中央网络管理，这里的修改会被忽略。`、`config.toml.backToForm 回到表单`；
  - 校验：`config.invalid.cidr 请输入 CIDR，例如 10.0.0.0/24`、`invalid.ipv4 请输入 IPv4 地址`、`invalid.port 端口范围 1–65535`、`invalid.mtu MTU 范围 400–1380`、`invalid.url 格式应为 协议://地址:端口`、`invalid.required 必填`。

- [ ] **Step 1:** 写失败的测试 `tests/unit/configEditor.test.ts`（用 `@vue/test-utils` 挂载组件，mock `src/api/client` 的 `generateToml` 和 `parseToml`）：
  - 用 `instance-config-core2.json` 经 normalize 后作为输入：把 MTU 改成 1300，最后一次 emit 的草稿除 `mtu` 外，都和输入深度相等；
  - 输入里没写 `multi_thread`（默认 true）时，复选框是选中的。取消选中后，草稿里 `multi_thread === false`；再选中，草稿里没有 `multi_thread` 这个键；
  - member 模式下不渲染「网络」分区，instance 模式下渲染；
  - 切到 TOML 页时，用 `toBackendNetworkConfig(草稿)` 调用 `generateToml`，并显示返回的文本；
  - 把 TOML 改坏，`parseToml` 返回 `{ error: 'bad' }` 时：点「表单」后仍然停在 TOML 页，显示「无法解析：bad」，并 emit `update:valid` false；
  - 解析成功时，instance 模式下，新草稿的 `instance_id` 是原来的值；
  - `flush()` 在 TOML 页、内容无效时 resolve 为 null；
  - `parseToml` 抛出异常时，文本不丢，并显示错误；
  - 端口转发里填端口 70000 时，`valid` 为 false。
- [ ] **Step 2:** 运行 `npx vitest run tests/unit/configEditor.test.ts`。Expected：FAIL。
- [ ] **Step 3:** 实现组件。
- [ ] **Step 4:** 运行同一条命令，再运行 `npm test && npm run typecheck`。Expected：PASS，没有 Vue 警告。
- [ ] **Step 5:** 提交：`git commit -m "feat: advanced config editor with form and toml modes"`（新文件要先 `git add`）。

### Task 4: 在设备详情里编辑成员的高级配置

**Files:**
- Modify: `src/components/device-detail/AdvancedConfigRow.vue`、`src/i18n/zh-CN.ts`、`src/i18n/en.ts`
- Test: `tests/e2e/device-detail.spec.ts`

**Interfaces:**
- Consumes：Task 2 的 `overrideState`（新的判断规则）、`memberOverridePayload`；Task 3 的 `ConfigEditorDialog`；`setMemberConfig`、`clearMemberConfig`、`getMemberConfig`；`refreshInventoryFresh`、`errorMessage`（`src/components/device-detail/writes.ts`）。

**规则：**
- **「编辑」入口：**状态为 ready 时，这一行显示「编辑」（LinkButton），和「恢复默认」并列。点击后打开 `ConfigEditorDialog`：
  - mode 为 member；
  - initial 为 `normalizeNetworkConfig(config ?? {})`；
  - 标题「高级配置 · {设备名}」；
  - 一个 action：「保存」。
- **保存：**
  1. 打开对话框时，先记下当时的 networkId 和 deviceId（和「恢复默认」一样的做法）。
  2. 计算 `plan = memberOverridePayload(草稿, member.proxy_cidrs ?? [])`。
  3. plan 是 put 时，调用 `setMemberConfig`；是 delete 时，调用 `clearMemberConfig`。例外：plan 是 delete，而成员的 `has_override` 为 false（本来就没有覆盖）时，不发请求，直接关闭对话框。
  4. 成功后：toast「已保存高级配置」，关闭对话框，`refreshInventoryFresh()`，再重新读取配置。
  5. 失败时：toast「保存失败：{message}」，对话框保持打开，草稿保留。
  6. 保存过程中，这一行和整张卡片都处于 busy 状态。
- **状态文字：**「默认 / 已覆盖」改用 Task 2 的新判断规则。
- **i18n（zh-CN 原文）：**`detail.settings.edit 编辑`、`detail.settings.editorTitle 高级配置 · {name}`、`detail.settings.save 保存`、`detail.settings.saved 已保存高级配置`。保存失败复用现有的 `detail.settings.saveFailed`。

- [ ] **Step 1:** 在 `device-detail.spec.ts` 里写失败的 e2e 测试（沿用现有的 core3 成员覆盖场景）：
  1. 成员覆盖为 `{proxy_cidrs: ['192.168.77.0/24'], mtu: 1300, routes: ['10.9.0.0/16']}`，状态是「已覆盖」。
     - 点「编辑」，MTU 输入框的值是 1300。
     - 改成 1280，点「保存」。
     - 记录到的 `PUT …/members/<core3>/config` 请求体中，`config.mtu === 1280`、`config.routes` 等于 `['10.9.0.0/16']`、`config.proxy_cidrs` 等于 `['192.168.77.0/24']`，并且不含 `network_name`、`instance_id`、`peers`、`peer_urls`、`networking_method`、`dhcp` 中的任何一个。
  2. 成员覆盖为 `{proxy_cidrs: ['192.168.77.0/24']}`（fixture 默认情况），状态是「默认」。点「编辑」，不改任何内容，点「保存」：请求体严格等于 `{ config: { proxy_cidrs: ['192.168.77.0/24'] } }`。
  3. 成员覆盖为 `{mtu: 1380, multi_thread: true}`，状态显示「默认」。
  4. 在 TOML 页，mock 的 `generate-config` 返回一段 TOML。把内容改坏，并让 mock 的 `parse-config` 返回 `{error: 'bad toml', config: null}`：页面显示「无法解析：bad toml」，「保存」按钮不可用。
  5. 让 `PUT config` 返回 500：toast 显示后端的 message，对话框没有关闭。
- [ ] **Step 2:** 运行 `npx playwright test tests/e2e/device-detail.spec.ts`。Expected：新测试 FAIL。
- [ ] **Step 3:** 实现上述改动。
- [ ] **Step 4:** 运行 `npm test && npm run typecheck && npx playwright test`。Expected：全部 PASS。
- [ ] **Step 5:** 提交：`git commit -am "feat: edit a member's advanced config override"`。

### Task 5: 手动实例页面

**Files:**
- Create: `src/pages/DeviceInstancesPage.vue`、`src/components/instances/InstancesPanel.vue`、`src/components/instances/InstanceRowView.vue`（宽屏下是表格行，窄屏下是卡片）、`src/lib/download.ts`、`tests/e2e/instances.spec.ts`
- Modify: `src/router.ts`、`src/components/device-detail/NetworkSwitcher.vue`、`src/components/device-detail/NotInNetworkState.vue`、`src/pages/DeviceDetailPage.vue`（webhook 模式的布局）、`src/i18n/zh-CN.ts`、`src/i18n/en.ts`
- Test: `tests/unit/download.test.ts`

**Interfaces:**
- Consumes：Task 1 的实例接口（`listInstances`、`instanceMetas`、`instanceInfo`、`getInstanceConfig`、`saveInstanceConfig`、`runInstance`、`setInstanceDisabled`、`deleteInstance`、`generateToml`、`parseToml`）；Task 2 的 `manualInstanceIds`、`buildInstanceRows`、`InstanceRow`；Task 3 的 `ConfigEditorDialog`；`DEFAULT_NETWORK_CONFIG`、`normalizeNetworkConfig`、`toBackendNetworkConfig`；`uuid` 的 `v4`；`usePolling`、`useConfirm`、`useToast`、`copyText`、`UiMenu`。
- Produces：
  - 路由 `devices/:machineId/instances`，name 为 `'device-instances'`；
  - `InstancesPanel`，props 为 `{ device: DeviceView; centralIds: string[] }`；
  - `downloadText(filename: string, text: string, type?: string): void`。

**规则：**
- **页面：**
  - 面包屑「设备 / {名称} / 手动实例」。
  - 标题「手动实例」，26px、字重 400。
  - 副标题「直接运行在这台设备上的网络实例，不受中央网络管理。」
  - 标题下面是 InstancesPanel。
  - 设备不存在或者是 pending 设备时，沿用详情页的「找不到设备」空状态。
  - `centralIds` 取 `inventory.networks` 的所有 id，加上 `device.networks` 的所有 id。
- **InstancesPanel 的数据：**
  - **设备离线时**，显示 EmptyState「设备离线，恢复连接后可以管理实例」，不发任何请求。
  - **在线时**，用 `usePolling` 每 5 秒刷新一次：
    1. `listInstances` 得到实例列表，经 `manualInstanceIds` 去掉中央网络的实例；
    2. 对还没有缓存元信息的 id，调用 `instanceMetas`；
    3. 对每个没有停用的实例，并发调用 `instanceInfo`；
    4. 用 `buildInstanceRows` 生成行。
  - **读取失败时：**第一次就失败，显示错误和「重试」；之前已经有数据的，保留原来的行，并在列表上方显示一行细线样式的提示「刷新失败，正在重试」。
- **InstancesPanel 的界面：**
  - **工具栏：**「新建实例」（primary，本页唯一的橙色按钮）；「导入 TOML」（secondary，背后是一个隐藏的 `<input type="file" accept=".toml,text/plain">`）。
  - **每一行显示：**
    - 名称，下一行是 mono 小字的实例 id（可复制）；
    - 状态：
      - running：绿点加「运行中」；
      - starting：灰点加「启动中」；
      - disabled：灰点加「已停用」；
      - error：红色文字「错误：{errorMsg}」；
    - 虚拟 IP（mono）；
    - local 为真时，加一个「设备本地配置」的徽标。
  - **⋯ 菜单：**
    - 「编辑」（只在 editable 时出现）；
    - 「启用」或「停用」；
    - 「导出 TOML」；
    - 「VPN Portal…」（Task 6 实现，这里先不放）；
    - 「删除…」（只在 deletable 时出现）。
  - **没有手动实例时**，显示 EmptyState「这台设备上没有手动实例」，「新建实例」按钮仍然可用。
- **新建：**打开 `ConfigEditorDialog`，mode 为 instance，initial 为 `DEFAULT_NETWORK_CONFIG()`，标题「新建实例」。
  - 两个 action：
    - 「创建并运行」：`runInstance(m, toBackendNetworkConfig(cfg), true)`；
    - 「仅保存」：`saveInstanceConfig(m, cfg.instance_id, toBackendNetworkConfig(cfg))`。
  - 成功：toast「已创建 {name}」，关闭对话框，立即刷新。失败：toast「操作失败：{message}」，对话框保持打开。
- **导入 TOML：**
  1. 读取文件，调用 `parseToml`。
     - 返回 `error` 或者请求失败：toast「无法解析 TOML：{message}」。
     - 成功：打开和「新建」相同的对话框。initial 为 `normalizeNetworkConfig(config)`，并把 `instance_id` 换成新的 `v4()`。
  2. 处理完以后，清空文件输入框，以便同一个文件可以再选一次。
- **编辑：**
  1. `getInstanceConfig` 读取配置，经 `normalizeNetworkConfig` 后打开对话框，标题「编辑 {name}」，一个 action「保存」。
  2. 实例在运行时，`note` 为「保存后实例会用新配置重新启动。」，保存调用 `runInstance(m, toBackendNetworkConfig(cfg), true)`。
  3. 实例已停用时，保存调用 `saveInstanceConfig`。
  4. `instance_id` 始终是原来的值。
- **启用 / 停用：**调用 `setInstanceDisabled(m, id, !disabled)`，toast「已启用」或「已停用」，然后刷新。
- **导出 TOML：**
  1. `getInstanceConfig` → `normalizeNetworkConfig` → `toBackendNetworkConfig`，删掉 `instance_id`，再调用 `generateToml`。
  2. 成功时，`downloadText('{name}.toml', toml, 'application/toml')`；返回 `error` 时，toast「导出失败：{message}」。
- **删除：**弹出确认框（danger），标题「删除实例」，正文「将停止并删除 {name}，设备上的这个实例无法恢复。」。确认后调用 `deleteInstance`，toast「已删除 {name}」，然后刷新。
- **入口：**
  - **NetworkSwitcher：**在「加入其他网络…」之后，加一项「手动实例（高级）…」，跳转到 `device-instances`。
  - **NotInNetworkState：**在「选择其他网络」下方，加一个文字链接「手动实例（高级）」。
  - **webhook 模式的设备详情**（`session.webhookMode`，并且设备不是 pending）：页面布局和中央模式相同，左栏是 InstancesPanel（`centralIds` 为空），右栏是 OverviewCard。
- **`downloadText`：**用 Blob 加隐藏的 `<a download>` 触发下载，然后 revoke 掉 object URL。
- **i18n（zh-CN 原文）：**
  - 页面与工具栏：`instances.title 手动实例`、`instances.subtitle 直接运行在这台设备上的网络实例，不受中央网络管理。`、`instances.breadcrumb 手动实例`、`instances.new 新建实例`、`instances.import 导入 TOML`；
  - 状态：`instances.offline 设备离线，恢复连接后可以管理实例`、`instances.empty 这台设备上没有手动实例`、`instances.loadFailed 读取实例失败`、`instances.refreshFailed 刷新失败，正在重试`、`instances.state.running 运行中`、`instances.state.starting 启动中`、`instances.state.disabled 已停用`、`instances.state.error 错误：{message}`、`instances.local 设备本地配置`；
  - 菜单：`instances.menu.edit 编辑`、`instances.menu.enable 启用`、`instances.menu.disable 停用`、`instances.menu.export 导出 TOML`、`instances.menu.delete 删除…`；
  - 对话框：`instances.createTitle 新建实例`、`instances.createRun 创建并运行`、`instances.createSave 仅保存`、`instances.editTitle 编辑 {name}`、`instances.save 保存`、`instances.restartNote 保存后实例会用新配置重新启动。`；
  - 提示：`instances.created 已创建 {name}`、`instances.saved 已保存 {name}`、`instances.enabled 已启用`、`instances.disabled 已停用`、`instances.failed 操作失败：{message}`、`instances.parseFailed 无法解析 TOML：{message}`、`instances.exportFailed 导出失败：{message}`；
  - 删除确认：`instances.deleteTitle 删除实例`、`instances.deleteBody 将停止并删除 {name}，设备上的这个实例无法恢复。`、`instances.deleted 已删除 {name}`；
  - 入口：`detail.switcher.instances 手动实例（高级）…`、`detail.notInNetwork.instances 手动实例（高级）`。

- [ ] **Step 1:** 写失败的测试。
  - `download.test.ts`：调用 `downloadText` 后，创建了 `a[download="x.toml"]`，触发了 click，并且 revoke 了 object URL。
  - `instances.spec.ts`（e2e，用 Task 1 的 fixtures mock，core2 在线；`GET /machines/<core2>/networks` 默认返回 `instances-core2.json`）：
    1. 在 core2 的详情页，打开网络切换器，点「手动实例（高级）…」：URL 变成 `/devices/<core2>/instances`。列表里有 `lab-manual`，状态为「运行中」，显示它的虚拟 IP；列表里没有中央网络 id。
    2. 「停用」：记录到 `PUT /machines/<core2>/networks/5eed0000-0000-4000-8000-000000000001`，请求体为 `{ disabled: true }`。之后列表 mock 改为把它放在 disabled 中，行内显示「已停用」。
    3. 「编辑」：MTU 改成 1300 后「保存」，记录到 `POST /machines/<core2>/networks`，请求体中：
       - `save === true`；
       - `config.instance_id` 等于固定 id；
       - `config.mtu === 1300`；
       - `config.routes`、`exit_nodes`、`acl`、`port_forwards`、`vpn_portal_config`、`dns`、`mapped_listeners` 都和 `instance-config-core2.json` 中的相等。
    4. 「新建实例」：网络名填 `new-one`，点「仅保存」，记录到 `PUT /machines/<core2>/networks/config/<某个 uuid>`，请求体中 `config.network_name === 'new-one'`。
    5. 「导入 TOML」：设置文件后，mock 的 `parse-config` 返回 `parse-config-ok.json`。对话框里显示解析出的网络名，`instance_id` 不等于 fixture 里的那个 id。再导入一次，mock 返回错误：toast 显示「无法解析 TOML」。
    6. 「导出 TOML」：触发 download 事件，文件名为 `lab-manual.toml`，内容等于 `generate-config-ok.json` 里的 `toml_config`。
    7. 「删除…」：确认后，记录到 `DELETE /machines/<core2>/networks/5eed…0001`。
    8. 把 core2 改成离线：显示「设备离线，恢复连接后可以管理实例」，并且没有记录到任何 `/machines/<core2>/networks` 请求。
    9. 列表接口返回 500：显示「读取实例失败」和「重试」。
    10. webhook 模式（`mockApi(page, {}, { webhook: true })`）：core2 的详情页直接显示实例面板，里面有 `lab-manual`。
    11. 视口宽 390px 时，`scrollWidth <= 390`，并且行变成卡片。
- [ ] **Step 2:** 运行 `npx vitest run tests/unit/download.test.ts && npx playwright test tests/e2e/instances.spec.ts`。Expected：FAIL。
- [ ] **Step 3:** 实现上述内容。
- [ ] **Step 4:** 运行 `npm test && npm run typecheck && npm run build && npx playwright test`。Expected：全部 PASS。
- [ ] **Step 5:** 提交：`git commit -am "feat: manual instances page with create, edit, toggle, import and export"`（新文件要先 `git add`）。

### Task 6: VPN Portal 客户端管理

**Files:**
- Create: `src/components/instances/VpnPortalDialog.vue`
- Modify: `src/components/instances/InstancesPanel.vue`（菜单里加入口）、`src/i18n/zh-CN.ts`、`src/i18n/en.ts`
- Test: `tests/e2e/instances.spec.ts`

**Interfaces:**
- Consumes：Task 1 的 `vpnPortalInfo`、`patchVpnPortalClients`、`instanceInfo`；Task 2 的 `vpnPortalUsedIps`、`suggestVpnPortalAddress`、`validVpnPortalAddress`、`validVpnClientName`、`vpnPortalEndpoint`、`normalizeVpnPortalEndpoint`、`vpnPortalClientConfig`；`VpnPortalClientState`（`src/lib/networkConfig.ts`）；`copyText`、`useConfirm`、`useToast`、`UiDialog`。

**规则：**
- **入口：**InstancesPanel 的菜单里加「VPN Portal…」，只对运行中的实例显示。打开 VpnPortalDialog，传入 machineId、实例行，以及最近一次的 `InstanceRunningInfo`。
- **对话框：**
  - **打开时**，调用 `vpnPortalInfo`。加载中显示 SkeletonRows；失败时显示错误和「重试」。
  - **不可用时**（`vpn_type !== 'wireguard'`，或者没有 `listener`）：显示「这个实例的 VPN Portal 没有运行。可以在编辑配置时开启。」，同时显示返回的 `client_config` 原文（例如「Wireguard VPN Portal Not Started」），没有其他操作。
  - **可用时：**
    - **上方：**监听地址（mono）；「服务器地址」输入框，默认值为 `vpnPortalEndpoint(listener, info)`，用户可以改，经过 `normalizeVpnPortalEndpoint` 校验。
    - **客户端列表**，每一行显示：
      - 名称；
      - 虚拟 IP（mono）；
      - 状态：`VPN_PORTAL_CLIENT_STATE_ONLINE` 显示「已连接」，`CONNECTING` 显示「连接中」，`ERROR` 显示「错误」，其他值显示「未连接」；有 `error` 时一并显示；
      - 「复制配置」：复制 `vpnPortalClientConfig(client.client_config, 服务器地址)`。服务器地址为空时按钮不可用，提示「先填写服务器地址」。复制成功或失败都给 toast。
      - 「删除」：弹出确认框（danger），正文「将删除客户端 {name}，使用这个配置的设备将无法再连接。」。确认后发送 `REMOVE` 补丁。
    - **添加表单：**名称、地址、前缀、分组（逗号分隔，可以不填）。
      - 名称默认 `client-{n}`（n 取最小的未被使用的正整数）；地址和前缀默认取 `suggestVpnPortalAddress` 的结果。
      - 「添加」按钮在以下情况都不可用：`validVpnClientName` 为假、`validVpnPortalAddress` 为假、名称重复。
      - 提交 `ADD` 补丁，`virtual_ip` 为 `{地址}/{前缀}`。
    - 补丁成功后，重新读取信息，并 toast「已添加 {name}」或「已删除 {name}」。补丁失败时，在表单下方原样显示后端的 message。
- **i18n（zh-CN 原文）：**
  - 标题与状态：`vpn.title VPN Portal · {name}`、`vpn.unavailable 这个实例的 VPN Portal 没有运行。可以在编辑配置时开启。`、`vpn.listener 监听地址`、`vpn.endpoint 服务器地址`、`vpn.endpointHint 先填写服务器地址`；
  - 客户端：`vpn.clients 客户端`、`vpn.state.connected 已连接`、`vpn.state.connecting 连接中`、`vpn.state.disconnected 未连接`、`vpn.state.error 错误`、`vpn.copyConfig 复制配置`、`vpn.copied 已复制客户端配置`；
  - 删除：`vpn.remove 删除`、`vpn.removeTitle 删除客户端`、`vpn.removeBody 将删除客户端 {name}，使用这个配置的设备将无法再连接。`、`vpn.removed 已删除 {name}`；
  - 添加：`vpn.add 添加`、`vpn.added 已添加 {name}`、`vpn.name 名称`、`vpn.address 地址`、`vpn.prefix 前缀`、`vpn.groups 分组`；
  - 校验：`vpn.invalidName 名称只能包含字母、数字和连字符`、`vpn.invalidAddress 地址必须在实例的网段内，且未被使用`、`vpn.duplicate 名称已存在`。

- [ ] **Step 1:** 在 `instances.spec.ts` 里写失败的 e2e 测试。proxy-rpc 的 `get_vpn_portal_info` 用测试里手写的数据：
  ```
  { vpn_type: 'wireguard', listener: 'wg://0.0.0.0:22022',
    clients: [{ name: 'phone', virtual_ip: '10.144.144.20/24', state: <已连接>, client_config: '[Interface]\n…\nEndpoint = 0.0.0.0:22022\n' }] }
  ```
  `instance-info-core2.json` 提供实例 IP 和公网 IP。
  1. 打开「VPN Portal…」：列表里有 `phone` 和「已连接」；服务器地址默认是 `<公网 IP>:22022`。点「复制配置」，剪贴板里的内容包含 `Endpoint = <公网 IP>:22022`。
  2. 添加表单默认填好了名称 `client-1` 和一个网段内的地址。点「添加」，记录到 `PATCH …/vpn-portal-clients`，请求体为 `{ patches: [{ action: 'ADD', client: { name: 'client-1', virtual_ip: '<地址>/24', groups: [] } }] }`。
  3. 地址填 `10.144.144.255`、`10.144.144.20`（已被占用）、`192.168.1.5`（网段外）时，「添加」都不可用；名称填 `-bad` 时也不可用。
  4. `PATCH` 返回 500，内容为 `{message: 'VPN portal client x has an unusable virtual IP 10.144.144.9'}`：表单下方显示这条 message。
  5. 删除 `phone`：确认后，请求体为 `{ patches: [{ action: 'REMOVE', client: { name: 'phone', virtual_ip: '', groups: [] } }] }`。
  6. `vpn-portal-info-core2.json`（Not Started）的情况：显示「这个实例的 VPN Portal 没有运行…」。
- [ ] **Step 2:** 运行 `npx playwright test tests/e2e/instances.spec.ts`。Expected：新测试 FAIL。
- [ ] **Step 3:** 实现上述内容。
- [ ] **Step 4:** 运行 `npm test && npm run typecheck && npx playwright test`。Expected：全部 PASS。
- [ ] **Step 5:** 提交：`git commit -am "feat: vpn portal client management for manual instances"`（新文件要先 `git add`）。

### Task 7: 对接真实后端的冒烟测试与文档

**Files:**
- Modify: `tests/live/smoke.spec.ts`、`README.md`、`docs/superpowers/plans/2026-11-23-00-roadmap.md`

**Interfaces:**
- Consumes：计划 2 和 3 的 live 测试配置；正在运行的 testenv（core2 在中央网络里没有成员覆盖）。

- [ ] **Step 1:** 在 `tests/live/smoke.spec.ts` 里加两个测试。每个测试的 `afterEach` 都用 `EtApi` 做清理，即使测试中途失败也要清理干净。
  1. **成员高级配置：**
     - 打开 core2 的详情，点「高级配置 · 编辑」，MTU 填 1300，「保存」。
     - 用 API 读取成员配置：`mtu === 1300`，并且不含 `network_name`。
     - 回到页面，状态是「已覆盖」；点「恢复默认」并确认，状态变回「默认」。
     - 清理：用 API 调用 `DELETE …/members/<core2>/config`。
  2. **手动实例：**
     - 打开 core2 的「手动实例」，「新建实例」，网络名填 `live-manual`，点「仅保存」。
     - 列表里出现 `live-manual`，状态为「已停用」。
     - 「导出 TOML」触发下载，内容包含 `network_name = "live-manual"`。
     - 「删除…」并确认，列表里不再有它。
     - 清理：用 API 删除所有 network_name 为 `live-manual` 的实例。
- [ ] **Step 2:** 运行 `npx playwright test -c playwright.live.config.ts`。Expected：全部 PASS（testenv 必须保持运行，不能关掉）。
- [ ] **Step 3:** 在 README 里加「高级配置与手动实例」一节：
  - 成员覆盖的含义：除了中央网络掌管的字段，其余配置都以覆盖为准；
  - 表单和 TOML 两种模式；
  - 手动实例的用途，以及它在 webhook 模式下的位置；
  - VPN Portal 客户端的管理方式，并说明不提供二维码。
- [ ] **Step 4:** 把路线图第 4 行的状态改为「已完成」，并填上本计划的文件名。
- [ ] **Step 5:** 提交：`git commit -am "test: live smoke for member override and manual instances; docs"`。
