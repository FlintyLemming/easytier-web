# 迁移向导、部署与上线 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做出 `/migrate` 迁移向导（把 2.6.4 的旧实例逐台转换成中央网络的成员，可预览、可回滚、可校验），提供 Caddy + compose 部署示例、README 和后端升级手册，并在合成数据和**生产数据库副本**上各完整演练一次升级、迁移和回滚。

**Architecture:**
- **纯函数**放在 `src/domain/migration/`：盘点分组和网络草稿（`inventory.ts`）、逐台拆分（`classify.ts`）、配置比较（`compare.ts`）、本地迁移记录和导出文件（`journal.ts`）。全部单元测试覆盖。
- **执行器** `src/domain/migration/run.ts`：逐台执行、失败回滚、单台回滚、校验。接口通过参数注入（`MigrationApi`，就是 `src/api/client.ts` 里现有函数的子集），用假接口做单元测试。
- **页面** `src/pages/MigratePage.vue` 加 `src/components/migrate/` 下每一步一个组件；概览页顶部加横幅 `MigrationBanner.vue`。旧实例由页面自己读取（`useLegacyInventory`），不进 inventory store 的轮询。
- **测试环境**：testenv 新增一个专门的数据目录 `data-migrate`（web v2.6.4 上播种一组仿照生产情况的旧实例，再升级到 v2.7.1）和第 4 台 core（compose profile `migrate`）。抓取脚本顺带在真实后端上把一台设备的迁移和回滚走一遍，结果存成 fixtures，作为比较规则的依据。
- **部署**：`deploy/` 下的 Caddyfile、compose、`config.js` 示例；`docs/upgrade-runbook.md`。

**Tech Stack:** 不新增运行时依赖。沿用 Vue 3.5、Pinia、vue-router、vue-i18n、Tailwind v4、Reka UI，以及现有的 `UiButton`、`UiDialog`、`UiInput`、`UiBadge`、`SectionCard`、`EmptyState`、`SkeletonRows`、`KeyValueList`、`CheckboxField`、`NetworkSettingsFields`、`useConfirm`、`useToast`、`downloadText`。部署示例用官方镜像 `caddy:2` 和 `easytier/easytier:v2.7.1`。

**Spec:** `docs/superpowers/specs/2026-11-23-easytier-web-console-design.md`（§5.1 部署、§5.10 迁移、§6.5 写操作、§6.9 webhook、§8 验收）

**规划时核实的事实**（读 v2.7.1 源码，并在本地 testenv 上查过；没有碰生产环境）：
- **读不到停用标记。**`GET /machines/{id}/networks` 返回 `running_inst_ids`（core 上正在运行的）和 `disabled_inst_ids`（web 存了、但 core 上没在运行的，`remote_client.rs handle_list_network_instance_ids`）。数据库里的 `disabled` 列没有任何接口返回。
- **离线设备读不到实例列表。**上面这个接口要先拿到设备的 RPC 会话（`get_rpc_client … ClientNotFound`），设备离线就报错。停用、启用、删除实例也都要设备在线。
- **运行中实例读到的是 core 还原的配置。**`GET /machines/{id}/networks/config/{inst}`：实例在 core 上运行时，经 RPC 取 core 当前的配置（2.6.4 的 core 把 PublicServer 还原成 `networking_method: Manual` + `peer_urls`，所有开关都写成显式值，如 `mtu: 1380`）；实例没在运行时才读数据库里存的那份（`client_manager/mod.rs handle_get_network_config_with_source`）。所以**停用之后再读，拿到的就是存储的原样配置**。
- **中央网络掌管的字段**（`compiler.rs apply_member_override`）：`instance_id, dhcp, dhcp_ipv4_cidr, dhcpv6, dhcp_ipv6_cidr, virtual_ipv4, network_length, hostname, network_name, network_secret, networking_method, public_server_url, peer_urls, peers, secure_mode, managed_credentials, acl, credential_file`，和现有的 `CENTRAL_OWNED_FIELDS` 一致。`hostname` 来自成员的 `hostname_override`（没设置时不写，core 用系统主机名）；`dhcp` = 没有分配到地址；`network_length` = 网段前缀（没有网段时 24）。网段为空时成员没有地址、`dhcp: true`。
- **成员接口**：`POST /networks/{id}/members` 只收 `device_ids`，新成员没有固定 IP（有网段时自动分配）。`PATCH …/members/{device}` 设 `virtual_ipv4`、`hostname_override`、`proxy_cidrs`。`PUT …/members/{device}/config {config}` **整个替换**覆盖对象（子网代理也在里面）。每次修改都整体编译一次：固定 IP 不在网段内（或等于网络地址、广播地址）→ 400 `invalid IPv4 address for member …`；重复 → `duplicate virtual IPv4 address`；覆盖里开启旧版 VPN Portal → 编译失败（Plan 4 R18）。
- **直接修改实例的保护**（`restful/network.rs ensure_direct_mutation_allowed`）：设备一旦有中央网络的配置，对它运行或保存实例时，实例 id 或**网络名**和中央配置相同就返回 409 `central network config must be changed through its network intent`；停用、启用、删除只比较实例 id。所以旧实例（id 不同）在设备入网后仍然可以停用、启用、删除；但要**重新创建**一个和中央网络同名的实例，必须先把设备移出网络。
- **EasyTier 的网络身份是网络名 + 密钥。**中央网络用和旧实例相同的网络名和密钥时，已经迁移的成员和还没迁移的旧实例在同一个虚拟网络里，可以逐台迁移而不断开。
- **2.6.4 web 回滚后会清掉中央实例（待演练确认）。**v2.6.4 的 `session.rs run_network_on_start` 第一次心跳时，会删除 core 上「来源是 webhook、但数据库里没有」的实例；v2.7.1 下发的中央实例来源是 `ConfigSourceWeb`（枚举值同 2.6.4 的 Webhook）。Task 8 的整体回滚演练要确认这一点，不成立时升级手册要写明怎么手动清理。
- **移出成员会改 ACL**（Plan 5 记录）：引用这个成员的规则会被删减，只剩它的规则整条删除。

**规划时做的决定**（spec §7 交给实现者决定的部分，以及上面事实带来的取舍）：
1. **旧实例**：在线设备上、实例 id 不等于任何中央网络 id 的实例。在 `running_inst_ids` 里的算「运行中」，否则算「停用」（读不到真正的停用标记，见上；core 刚重连时可能把启用的实例暂时算成停用，后果只是默认不迁移，偏安全）。离线设备单独列出：「离线，上线后才能读取它的实例」。
2. **分组和目标网络**：按网络名分组。网络名等于某个中央网络 `network_name` 的组，目标就是这个已有网络（不再新建，设置只读显示，并链接到它的设置页）；否则在执行开始时按草稿新建。草稿的网络名和密钥默认取组内最常见的值，这样迁移中的设备始终和未迁移的设备在同一个虚拟网络里；用户改了网络名或密钥时，草稿下方显示提示：「迁移后的设备和还没迁移的设备将不在同一个虚拟网络里」。
3. **「最常见」只数运行中的实例**；组里没有运行中的实例时才数全部。并列时取设备名排序靠前的那个。
4. **连接方式按「实际连接的节点地址」比较**，不比较组网方式的名字：PublicServer → `[public_server_url]`，Manual → `peer_urls` 加 `peers[].uri` 去重排序，Standalone → `[]`。原因：2.6.4 的 core 把 PublicServer 读成 Manual；两种方式编译出来的 TOML 一样（都是 `[[peer]]`）。草稿的组网方式：没有地址 → Standalone；参与最常见值的配置全是 PublicServer 且只有一个地址 → PublicServer；否则 Manual。网络设置里提供「使用全部服务器地址」，把组内所有地址的并集填进 Manual。
5. **网段**：每个固定 IP 实例按它的 `network_length`（缺省 24）算出所在网段，取最常见的作为草稿网段。组里没有固定 IP 时网段留空。
6. **拆分规则**（`classifyInstance`，spec §5.10.2 第 3 步）：
   - 成员字段：`dhcp` 不为 true 且 `virtual_ipv4` 有值 → 固定 IP（去掉前缀）；`hostname` 非空且不等于设备的系统主机名（`/machines` 的 `info.hostname`）→ 主机名覆盖；`proxy_cidrs` → 子网代理。
   - 配置覆盖：其余字段，去掉 `CENTRAL_OWNED_FIELDS`、`virtual_ipv4/hostname/proxy_cidrs`、旧版 VPN 字段（`LEGACY_VPN_FIELDS`，Plan 4 的笔记：不能放进成员覆盖），再去掉值为默认值的（`isDefaultValue`），剩下的原样放进覆盖。
   - 会改变（第 3 类，键名固定）：`connectivity`（实际地址不同）、`network_name`、`network_secret`、`dhcp`（旧实例用 DHCP）、`network_length`、`secure_mode`（启用状态不同）、`acl`（旧实例有非空 ACL 就算，**不自动转换**）、`vpn_portal`（有任何非默认的旧版 VPN 字段；`enable_vpn_portal === true` 时文案是「迁移后 VPN Portal 会关闭」，否则是「未启用，迁移时丢弃」），以及 `dhcp_ipv4_cidr / dhcpv6 / dhcp_ipv6_cidr / managed_credentials / credential_file` 中有非默认值的（键名就是字段名）。
   - 不能迁移（阻止项）：固定 IP 不在网段内或等于网络地址、广播地址（`ipOutsideCidr`）；和本次选中的另一台重复（`duplicateIp`）；和目标网络已有成员的 IP 重复（`ipTaken`）。有阻止项的设备固定为「暂不迁移」。
   - 已经是目标网络成员的设备显示「已是成员，跳过」，不可选。它的旧实例如果还在，提示「旧实例还在，确认这台运行正常后可以在手动实例页删除」。
7. **第 3 类差异必须逐条确认。**每台设备的每条差异一个勾选框；第 3 步顶部按差异种类汇总（「连接方式 · 34 台」），每种一个「全部确认」。选中的设备全部确认后才能下一步。
8. **执行顺序**（每台设备依次，`migrateDevice`）：
   1. `disable`：停用旧实例；
   2. `recheck`：重新读配置（此时是数据库里的原样配置），重新拆分；出现**预览时没确认过的**第 3 类差异就回滚这台，原因写「预览之后配置有变化：{差异}」；
   3. `join`：加入网络；
   4. `settings`：`PATCH` 固定 IP 和主机名覆盖（只发有值的），覆盖或子网代理不为空时再 `PUT config`（覆盖 + `proxy_cidrs`）；
   5. `wait`：每 2 秒读一次成员列表，最多 120 秒，等这个成员 `running === true`；
   6. `record`：写本地迁移记录（含第 2 步读到的原样配置和已确认的差异）；
   7. `cleanup`：删除旧实例。

   第 3–5 步失败：回滚 = 移出网络（如果已加入）→ 等这台设备的中央实例消失（`running_inst_ids` 不再含网络 id，最多 90 秒）→ 重新启用旧实例；第 1–2 步失败：只做「重新启用」（第 1 步失败时什么都不用做）。回滚本身失败 → 「需要处理」，写明卡在哪一步。第 7 步失败不回滚，结果是「已迁移，旧实例没删掉」（已停用，可以在手动实例页删除）。
9. **执行前**：第 4 步要先勾选「我已经按升级手册备份了 et.db」，再点「下载备份并开始迁移」：先下载导出文件，然后（需要时）新建网络，再逐台执行。新建网络失败就停下，什么都不做。可以「停止」：当前这台做完（或回滚完）后停下。执行中离开页面先确认；确认离开后，当前这台照样做完或回滚完，后面的不再开始。
10. **本地迁移记录**存在 localStorage `et.migrate.<用户名>`（含旧配置和网络密钥，只在这个浏览器里）。用途：离线设备上线后补做校验、单台回滚时重建已删除的旧实例。第 5 步提供「下载迁移记录」和「清除迁移记录」（全部一致或已回滚时才可清除）。
11. **校验**（`verifyDevice`，第 5 步）：取成员实例运行中的 TOML（`show_node_info`，实例 id = 网络 id），和记录里的旧配置（去掉旧版 VPN 字段）经 `generate-config` 得到的 TOML，两边都经 `parse-config` 转成配置对象再比较（`diffConfigs`）。忽略 `instance_id`、已确认差异涉及的字段、`acl`（中央 ACL 在网络的 ACL 页管理）。设备离线或读取失败 → 「等待上线后校验」。比较规则见 Task 3，以 Task 1 在真实后端上抓到的数据为准。
12. **单台回滚**（第 5 步「回滚这台」，danger 确认，网络有 ACL 规则时加一句「引用它的 ACL 规则会被删减」）：移出网络 → 等中央实例消失 → 旧实例还在就重新启用，不在就用记录里的原样配置 `POST /machines/{id}/networks {config, save: true}` 重建（实例 id 不变）→ 等它运行 → 记录标为「已回滚」。
13. **横幅**：概览页顶部，在中央网络模式下，`/machines` 心跳里的 `running_network_instances` 中有不属于任何中央网络的 id 时显示「检测到 N 个旧版网络实例，可以迁移到中央网络」和「开始迁移」；本地迁移记录里有未校验（`migrated`）的设备时显示「N 台设备迁移后等待校验」。可以关闭；关闭时记下当前的 id 集合，集合变了才再出现。不额外发请求。
14. **主按钮**：第 2、3 步底部的「下一步」、第 4 步的「下载备份并开始迁移」各是所在步骤唯一的 primary 按钮；其余都用 secondary 或 text。
15. **读取并发**：盘点时每台设备内部依次读（列表 → 元信息 → 每个旧实例的配置），最多 4 台设备同时读；显示「正在读取 {done} / {total} 台设备」。单台失败不影响其他设备，列在「读取失败」里并可重试。

## Global Constraints

- 接口以 easytier-web **v2.7.1** 为准；返回结构以 `tests/fixtures/v2.7.1/`（包括本计划新抓的 `migrate/`）为准。设备上的 core 是 **2.6.4**。
- **不丢字段**（spec 反目标）：旧配置里所有非默认、非中央掌管的字段都进入配置覆盖；凡是会丢或会变的内容，都必须出现在第 3 类差异里并被确认过。
- **任何一台设备都不能停在「旧实例停用、又不是成员」的状态**：执行器的每条失败路径都要回滚或标为「需要处理」。
- **危险操作二次确认（danger）**：单台回滚、清除迁移记录。开始迁移用第 4 步的勾选框代替确认框。
- **每个写操作**都有加载状态和失败提示（显示后端 message）；进行中不能重复提交。
- **webhook 模式**（`session.webhookMode`）：不显示横幅，`/migrate` 跳回概览，不发任何请求。
- **密钥**：网络密钥在页面上默认隐藏（`type="password"`，旁边「显示」）。导出文件和迁移记录含密钥，下载按钮旁边写明「文件里有网络密钥，请妥善保存」。
- **不新增运行时依赖**，运行时不向第三方发请求。
- **视觉**沿用前几个计划（token、无阴影、标题字重 400、IP / CIDR / 实例 id / URL / 配置键值用 JetBrains Mono；状态色只用 success / error）。
- **语言**：新文案放在 `src/i18n/migrate/{zh-CN,en}.ts`，键名一致性测试必须通过。本计划给出的中文原样使用。
- **提交信息**结尾空一行，再加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。永远不推送。
- **生产环境**（`idc-ucloud`）：只允许 Task 10 里写明的**只读**操作（用户 2026-11-24 同意复制数据库）。不写生产主机上的任何文件，不停止、不重启任何容器。生产升级本身由用户按手册执行。
- **testenv**：任务结束时恢复成 `ET_DATA_DIR=./data-central`、web v2.7.1、core1..3 v2.6.4 运行（core4 停止），live smoke 依赖它。

## Review Focus

1. **执行中途失败或中断。**任何一步的接口失败、等待超时、点「停止」、离开页面：没有设备停在「旧实例停用、又不是成员」；回滚后旧实例重新启用；再次进入向导时已入网的设备显示「已是成员，跳过」。测试放在 Task 4（每个失败点各一个单测）和 Task 7（e2e：`join` 返回 500 → 回滚请求依次发出，状态「已回滚」）。
2. **预览之后配置变了。**停用后读到的原样配置多出一条没确认的差异（例如数据库里存的是另一组服务器地址）：这台回滚、不入网，原因写明差异。测试放在 Task 4。
3. **覆盖不丢、不多。**一份带端口转发、监听地址、MTU、socks5、子网代理、自定义主机名、ACL 和开启的旧版 VPN Portal 的配置：覆盖里有前四项、没有中央字段、旧版 VPN 字段和默认值；子网代理和主机名进成员字段；ACL 和 VPN 进第 3 类。测试放在 Task 3（用 Task 1 抓到的真实配置）。
4. **IP 冲突在写之前拦下。**固定 IP 在网段外、等于网络地址或广播地址、和另一台选中设备重复、和已有成员重复：这台显示阻止原因、不能选「迁移」，执行时不发任何请求。测试放在 Task 3 和 Task 6。
5. **离线和读取失败。**设备离线（盘点时列在离线里、校验时「等待上线后校验」）、某台设备读取实例失败（列在读取失败里，可重试，其余设备照常）、执行时设备刚好离线（停用失败 → 什么都没改，报告原因）。测试放在 Task 4、Task 5、Task 7。

---

### Task 1: 迁移测试环境、真实数据和 fixtures

**Files:**
- Modify: `testenv/docker-compose.yml`（加 `core4`：`profiles: [migrate]`，machine id `44444444-4444-4444-8444-444444444444`，其余同 core1）、`testenv/lib/api.ts`（`MACHINES` 加 core4 的导出常量 `MIGRATE_MACHINES = {...MACHINES, core4}`，`MACHINES` 本身不变）、`testenv/capture-fixtures.test.ts`、`testenv/README.md`、`tests/e2e/mockApi.ts`
- Create: `testenv/seed-migration.ts`、`testenv/capture-migration-fixtures.ts`
- Create (generated): `tests/fixtures/v2.7.1/migrate/*.json`（列表见 Step 3）

**Interfaces:**
- Produces（fixtures，供 Task 2–7 使用）：
  - `migrate/machines.json`：`GET /machines`（core1..4 在线，心跳里有旧实例 id）。
  - `migrate/instances-core{1..4}.json`：`GET /machines/{id}/networks`；`migrate/metas-core{1..4}.json`：对应的 `POST …/networks/metas`。
  - `migrate/config-core{n}-{network}.json`：运行中时读到的配置（core 还原的）；`migrate/stored-core{n}-{network}.json`：停用后读到的原样配置（只对 core1..3 的 `office`）。停用的实例（core1 `lab-old`、core4 `office`）只有 `stored-…`。
  - `migrate/flow-core2.json`：在真实后端上把 core2 迁移再回滚一遍的记录：`{ legacyToml, memberAfterSettings, centralToml, generatedFromStored, parsedLegacy, parsedCentral, parsedGenerated, timings: { runningAfterMs, goneAfterRemoveMs, reenabledRunningAfterMs }, recreate409: { status, message } }`。
  - `migrate/offline-instances-error.json`：设备离线时 `GET /machines/{core4}/networks` 的 `{ status, body }`。
  - `migrate/index.json`：`{ machines: {core1..core4}, instances: { core1: {office, 'lab-old'}, core2: {office}, core3: {office}, core4: {office} } }`（实例 id）。
- Produces（`tests/e2e/mockApi.ts`）：GET 默认路由加 `/machines/[^/]+/networks$` → `instances-core2.json`（已有）保持不变；新增导出 `migrateFixture(name)` = `fixture('migrate/' + name)`。

- [ ] **Step 1: 在 web v2.6.4 上播种迁移数据。**`testenv/seed-migration.ts`（结构同 `seed-legacy.ts`：幂等，按网络名查已有实例，打印 `seeded N` / `skipped N existing`）。数据（所有 `office` 实例共用 `network_name: 'office'`、`network_secret: 'office-secret'`、`dhcp: false`、`network_length: 24`、监听 `tcp://0.0.0.0:11010`、`udp://0.0.0.0:11010`）：

  | 设备 | 实例 | 内容 |
  |---|---|---|
  | core1 | office | `10.150.0.1`，Manual，`peer_urls: ['tcp://core2:11010']`，旧版 VPN Portal 开启（`enable_vpn_portal: true, vpn_portal_listen_port: 11013, vpn_portal_client_network_addr: '10.14.14.0', vpn_portal_client_network_len: 24`） |
  | core1 | lab-old | `network_name: 'lab-old'`、`network_secret: 'lab-old-secret'`，DHCP，Standalone，监听 `tcp://0.0.0.0:11030`，有一条 ACL 规则（入站，拒绝 TCP 22），**停用** |
  | core2 | office | `10.150.0.2`，PublicServer `tcp://core1:11010`，`hostname: 'core2-office'`，`proxy_cidrs: ['192.168.88.0/24']`，`port_forwards: [{ bind_ip: '0.0.0.0', bind_port: 18080, dst_ip: '10.150.0.1', dst_port: 80, proto: 'tcp' }]` |
  | core3 | office | `10.150.0.3`，PublicServer `tcp://core1:11010`，`mtu: 1300`、`enable_socks5: true`、`socks5_port: 1080`，有一条 ACL 规则（入站，拒绝 TCP 3389） |
  | core4 | office | `10.150.0.4`，PublicServer `tcp://core1:11010`，**停用** |

  ACL 用 proto JSON（`acl_v1.chains[].rules[]`，字段名同 `proto/acl.proto`），2.6.4 web 不认枚举数字时改用枚举名。和 `seed-legacy.ts` 一样，在 `data-migrate/seed-snapshot.json` 记下每个实例的配置和运行中的 TOML。在 `testenv/README.md` 加「迁移演练环境」一节，写明命令：
  ```sh
  mkdir -p testenv/data-migrate
  ET_DATA_DIR=./data-migrate ET_WEB_TAG=v2.6.4 docker compose -f testenv/docker-compose.yml --profile migrate up -d
  ET_DATA_DIR=./data-migrate node testenv/seed-migration.ts
  ET_DATA_DIR=./data-migrate bash testenv/upgrade.sh v2.6.4 v2.7.1     # 打印备份路径，记下来
  ```
  `upgrade.sh` 只重建 web；core4 在 profile 里，用 `--profile migrate` 才会启动。脚本读 `ET_DATA_DIR` 决定状态文件写到哪个目录（默认 `./data-migrate`）。运行上面四条命令。Expected：`seeded 5 instances`，3 个 office 运行中，升级后 web v2.7.1 启动、打印备份路径。

- [ ] **Step 2: 写 `testenv/capture-migration-fixtures.ts`**（在升级后的 data-migrate 环境上运行，结构同 `capture-network-fixtures.ts`，用 `saveAll` 写到 `tests/fixtures/v2.7.1/migrate/`）。依次：
  1. 抓 `machines.json`、四台的 `instances-*`、`metas-*`、运行中实例的 `config-*`。
  2. 对 core1..3 的 office：停用 → 读 `stored-*` → 重新启用，等它重新运行（最多 60 秒）。停用实例直接读 `stored-*`。
  3. core2 走一遍迁移：读 office 运行中的 TOML（`legacyToml`）→ 停用 → 新建中央网络 `office`（Manual，`peer_urls: ['tcp://core1:11010']`，网段 `10.150.0.0/24`，密钥 `office-secret`）→ 加入 → `PATCH {virtual_ipv4: '10.150.0.2', hostname_override: 'core2-office'}` → `PUT config {port_forwards, listener_urls, proxy_cidrs}`（按决定 6 从 `stored-core2-office` 算）→ 记下成员（`memberAfterSettings`）→ 等运行（记 `runningAfterMs`）→ 读中央实例 TOML（`centralToml`）→ `generate-config(stored)`（`generatedFromStored`）→ 三份 TOML 各 `parse-config` 一次。然后**试着**用 `POST /machines/{core2}/networks {config: stored, save: true}` 新建同名实例，记下返回（`recreate409`，预期 409）。
  4. 回滚：移出 core2 → 等中央实例从 core2 的 `running_inst_ids` 消失（记 `goneAfterRemoveMs`，最多 90 秒）→ 重新启用旧实例 → 等运行（`reenabledRunningAfterMs`）→ 删除中央网络。
  5. `docker compose --profile migrate stop core4` → 读 `GET /machines/{core4}/networks`，记 `{status, body}` → `start core4` → 等它重新上线。
  6. `finally`：不管成败都执行第 4、5 步里还没做的清理（网络存在就删、core2 旧实例没运行就启用、core4 没启动就启动），保证环境回到播种后的样子。
- [ ] **Step 3: 运行并检查。**`ET_DATA_DIR=./data-migrate node testenv/capture-migration-fixtures.ts`。在 `capture-fixtures.test.ts` 里加检查：`migrate/index.json` 有四台设备、五个实例；`instances-core1.json` 的 running 有 office、disabled 有 lab-old；`config-core2-office.json` 的 `networking_method` 是 `"Manual"`、`peer_urls` 是 `['tcp://core1:11010']`（core 还原的），`stored-core2-office.json` 的 `networking_method` 是 `"PublicServer"`；`flow-core2.json` 的 `recreate409.status === 409`，`parsedCentral.hostname === 'core2-office'`；`offline-instances-error.json` 的 status ≥ 400。原有的「fixture 里只能有私网 IP」检查也覆盖 `migrate/`；按 network_id 一致性检查的测试跳过 `migrate/` 目录。运行 `node --test testenv/capture-fixtures.test.ts`。Expected：PASS。
- [ ] **Step 4: 记录事实。**在 `testenv/README.md` 的「观察到的响应形状」里补上本次看到的：离线设备列实例的返回码、运行中 vs 停用后读到的配置有哪些不同（逐条，按 `config-*` 和 `stored-*` 比较）、`recreate409` 的 message、三个 timing。把 `MIGRATE_MACHINES` 和 mockApi 的 `migrateFixture` 加上。运行 `node --test testenv/lib/api.test.ts testenv/capture-fixtures.test.ts && npm run typecheck`。Expected：PASS。
- [ ] **Step 5: 提交** `git commit -m "test(testenv): legacy migration data set and migration fixtures"`（新文件先 `git add`）。

### Task 2: 盘点分组和网络草稿

**Files:**
- Create: `src/domain/migration/types.ts`、`src/domain/migration/inventory.ts`
- Test: `tests/unit/migrationInventory.test.ts`

**Interfaces:**
- Consumes：`CentralNetworkSummary`、`CentralNetworkMember`、`RawMachine`、`NetworkingMethod`（`src/api/types.ts`）；`SettingsForm`（`src/domain/networks.ts`）；`uuidToStr`。
- Produces（`types.ts`）：
```ts
export type LegacyConfig = Record<string, unknown>
export interface DeviceRef { id: string; name: string; hostname: string; online: boolean }
export interface LegacyInstance {
  deviceId: string; instanceId: string; networkName: string
  running: boolean
  config: LegacyConfig
}
export interface LegacyGroup {
  networkName: string
  instances: LegacyInstance[]          // 按设备名排序
  runningCount: number
  disabledCount: number
  targetNetworkId: string | null       // network_name 相同的中央网络
}
export interface ValueCount { value: string; count: number }
export interface NetworkDraft { form: SettingsForm; secret: string }
export interface DraftConflicts {
  networkName: ValueCount[]; secret: ValueCount[]; connectivity: ValueCount[]; subnet: ValueCount[]
}
```
- Produces（`inventory.ts`）：
  - `isLegacyId(id: string, networks: CentralNetworkSummary[]): boolean`
  - `runningLegacyIds(machines: RawMachine[], networks: CentralNetworkSummary[]): string[]`：在线设备心跳 `info.running_network_instances` 里的旧实例 id（去重、排序），给横幅用。
  - `groupLegacy(instances: LegacyInstance[], devices: Map<string, DeviceRef>, networks: CentralNetworkSummary[]): LegacyGroup[]`：组按网络名排序。
  - `effectivePeers(config: LegacyConfig): string[]`：决定 4 的规则（`networking_method` 接受数字 0/1/2 和名字）。
  - `subnetOf(config: LegacyConfig): string | null`：固定 IP 的网段 `a.b.c.d/len`。
  - `draftFromGroup(group: LegacyGroup): { draft: NetworkDraft; conflicts: DraftConflicts; serverUnion: string[] }`：决定 2–5。冲突列表只在有两个以上不同值时非空，按 count 降序；`connectivity` 的 value 是地址用 `, ` 连起来（空为 `''`）。

- [ ] **Step 1: 写失败的测试**（数据用 `migrate/` fixtures 拼，`config-*` 当运行中实例）：
  - `runningLegacyIds(migrate/machines.json, [])` 包含三个 office 的 id；传入一个 id 等于 core1 office 的中央网络时不含它；离线设备的 id 不算。
  - `groupLegacy` 得到 `lab-old`（1 个，停用 1）和 `office`（4 个，运行中 3、停用 1）；网络名等于已有中央网络时 `targetNetworkId` 是它的 id。
  - `effectivePeers`：`{networking_method: 0, public_server_url: 'tcp://a:1'}` → `['tcp://a:1']`；`{networking_method: 'Manual', peer_urls: ['tcp://b:1','tcp://a:1','tcp://a:1'], peers: [{uri: 'udp://c:2'}]}` → `['tcp://a:1','tcp://b:1','udp://c:2']`；`{networking_method: 2}` → `[]`；Manual 没有地址 → `[]`。
  - `subnetOf({dhcp: false, virtual_ipv4: '10.150.0.2', network_length: 24})` → `'10.150.0.0/24'`；缺 `network_length` 按 24；`dhcp: true` → null。
  - `draftFromGroup(office)`：网络名 `office`、密钥 `office-secret`、网段 `10.150.0.0/24`、显示名 `office`；三个运行中实例里两个连 `tcp://core1:11010`、一个连 `tcp://core2:11010`，所以 `form.method === 'Manual'`（运行中读到的都是 Manual）、`peerUrls` 是 `['tcp://core1:11010']`，`conflicts.connectivity` 两项（count 2 和 1），`serverUnion` 是两个地址排序后。
  - 全是 `stored-*`（PublicServer）的组 → `method === 'PublicServer'`、`publicServerUrl === 'tcp://core1:11010'`。
  - 只有停用实例的组（`lab-old`）也能得出草稿（数全部）；没有固定 IP → `virtualCidr === ''`；没有地址 → `Standalone`。
  - 并列：两种密钥各 1 台 → 取设备名靠前的那台的值，`conflicts.secret` 两项。
- [ ] **Step 2:** 运行 `npx vitest run tests/unit/migrationInventory.test.ts`。Expected：FAIL（模块不存在）。
- [ ] **Step 3:** 实现 `types.ts` 和 `inventory.ts`。
- [ ] **Step 4:** 运行同一命令和 `npm run typecheck`。Expected：PASS。
- [ ] **Step 5: 提交** `git commit -m "feat(migrate): legacy inventory groups and network draft"`。

### Task 3: 逐台拆分和配置比较

**Files:**
- Create: `src/domain/migration/classify.ts`、`src/domain/migration/compare.ts`
- Test: `tests/unit/migrationClassify.test.ts`、`tests/unit/migrationCompare.test.ts`

**Interfaces:**
- Consumes：Task 2 的类型和 `effectivePeers`；`CENTRAL_OWNED_FIELDS`（`memberOverride.ts`）；`LEGACY_VPN_FIELDS`（`vpnPortal.ts`）；`isDefaultValue`（`networkConfig.ts`）；`isIpv4Cidr`（`cidr.ts`）。
- Produces（`classify.ts`）：
```ts
export type ChangeKey =
  | 'connectivity' | 'network_name' | 'network_secret' | 'dhcp' | 'network_length' | 'secure_mode' | 'acl' | 'vpn_portal'
  | 'dhcp_ipv4_cidr' | 'dhcpv6' | 'dhcp_ipv6_cidr' | 'managed_credentials' | 'credential_file'
export interface Change { key: ChangeKey; from: string; to: string }   // 显示用文字；密钥两边都显示为 '••••'，相同时不算差异
export type Blocker = 'ipOutsideCidr' | 'duplicateIp' | 'ipTaken'
export interface MemberFields { virtualIpv4: string | null; hostnameOverride: string | null; proxyCidrs: string[] }
export interface DevicePlan { member: MemberFields; override: LegacyConfig; changes: Change[]; legacyAcl: unknown | null }
export interface TargetNetwork {
  networkName: string; secret: string; method: NetworkingMethod
  publicServerUrl: string | null; peerUrls: string[]; virtualCidr: string | null; secureMode: boolean
}
export interface DevicePreview {
  instance: LegacyInstance; device: DeviceRef; plan: DevicePlan
  blockers: Blocker[]; alreadyMember: boolean; defaultSelected: boolean
}
export function targetFromDraft(draft: NetworkDraft): TargetNetwork
export function targetFromDetail(detail: CentralNetworkDetail, gateway: GatewayInfo | null): TargetNetwork
export function classifyInstance(config: LegacyConfig, deviceHostname: string, target: TargetNetwork): DevicePlan
export function planGroup(
  group: LegacyGroup, devices: Map<string, DeviceRef>, target: TargetNetwork,
  members: CentralNetworkMember[], selected: ReadonlySet<string>,   // 选中的设备 id，用来算 duplicateIp
): DevicePreview[]
/** 一条差异覆盖的配置字段（校验时忽略），例如 connectivity → networking_method/public_server_url/peer_urls/peers */
export function changeFields(key: ChangeKey): string[]
/** 执行时用：b 里有、a 里没有的差异键 */
export function unconfirmedChanges(plan: DevicePlan, confirmed: ReadonlySet<ChangeKey>): ChangeKey[]
```
  `targetFromDetail` 对 Gateway 网络用 gateway-info 的 `peer_url` 当它的地址。`defaultSelected` = 运行中、没有阻止项、不是已有成员。`alreadyMember` 的设备没有阻止项。
- Produces（`compare.ts`）：
```ts
export interface FieldDiff { field: string; expected: unknown; actual: unknown }
export function diffConfigs(expected: LegacyConfig, actual: LegacyConfig, ignore: Iterable<string>): FieldDiff[]
export function verifyIgnore(confirmed: Iterable<ChangeKey>): Set<string>  // instance_id + acl + 各差异的 changeFields
```
  比较规则（`diffConfigs`）：先把 `networking_method/public_server_url/peer_urls/peers` 合成一个虚拟字段 `connectivity`（值为 `effectivePeers`），忽略列表里有这四个字段之一时忽略 `connectivity`；其余每个字段：`isDefaultValue` 为真的算「未设置」；对象递归去掉未设置的键再比较，键的顺序不计；数组按顺序比较；两边都未设置算相同。结果按字段名排序。**这套规则必须让 Step 1 里用真实 fixtures 的测试通过；需要调整时，在 `compare.ts` 顶部注释里逐条写明为什么，并记一条 ruling。**

- [ ] **Step 1: 写失败的测试**（`target` 用 Task 1 core2 演练的那个网络：Manual `['tcp://core1:11010']`、`10.150.0.0/24`、`office` / `office-secret`、非安全模式）：
  - `classifyInstance(stored-core2-office, 'core2', target)`：成员字段 `{virtualIpv4: '10.150.0.2', hostnameOverride: 'core2-office', proxyCidrs: ['192.168.88.0/24']}`；覆盖里有 `port_forwards`（和原值深度相等）和 `listener_urls`，**没有** `CENTRAL_OWNED_FIELDS` 的任何键、`proxy_cidrs`、`virtual_ipv4`、`hostname`、任何值为默认值的键；`changes` 为空（地址相同，PublicServer 和 Manual 不算差异）。
  - `classifyInstance(config-core2-office, 'core2', target)`（core 还原的）得到的成员字段和变化键与上一条相同。
  - core3 office（stored）：覆盖有 `mtu: 1300`、`enable_socks5: true`、`socks5_port: 1080`；`changes` 只有 `acl`；`legacyAcl` 等于原 ACL。
  - core1 office：`changes` 有 `connectivity`（from `tcp://core2:11010`，to `tcp://core1:11010`）和 `vpn_portal`（from 含「11013」），覆盖里没有任何 `LEGACY_VPN_FIELDS`。
  - `lab-old`（DHCP）对一个 `virtualCidr: '10.150.0.0/24'` 的目标：`changes` 有 `dhcp`、`network_name`、`network_secret`、`connectivity`（Standalone → 有地址）、`acl`；成员固定 IP 为 null。
  - `network_length: 16` 的配置对 `/24` 的目标 → `network_length` 差异；`hostname` 等于系统主机名 → `hostnameOverride` 为 null；`hostname: ''` → null。
  - `planGroup`：固定 IP `10.150.1.5`、`10.150.0.0`、`10.150.0.255` 对 `/24` 目标各得 `ipOutsideCidr`；两台选中设备都用 `10.150.0.9` → 两台都有 `duplicateIp`（只选中一台时没有）；已有成员 `virtual_ipv4: '10.150.0.3'` → core3 有 `ipTaken`；core2 已是成员 → `alreadyMember: true`、`defaultSelected: false`；core4（停用）→ `defaultSelected: false`。
  - `unconfirmedChanges(plan with acl+connectivity, new Set(['acl']))` → `['connectivity']`。
  - `compare`：`diffConfigs(flow.parsedGenerated, flow.parsedCentral, verifyIgnore([]))` 为空数组（core2 在真实后端上迁移前后一致）；把 `parsedCentral.mtu` 改成 1200 → 恰好一条 `{field: 'mtu'}`；把 `peer_urls` 改成另一个地址 → 一条 `connectivity`，而 `verifyIgnore(['connectivity'])` 时为空；`{a: null}` 对 `{}`、`{latency_first: false}` 对 `{}`（默认值）都没有差异；键顺序不同的对象没有差异；数组顺序不同有差异。
- [ ] **Step 2:** 运行 `npx vitest run tests/unit/migrationClassify.test.ts tests/unit/migrationCompare.test.ts`。Expected：FAIL。
- [ ] **Step 3:** 实现两个文件。
- [ ] **Step 4:** 运行同一命令和 `npm run typecheck`。Expected：PASS。
- [ ] **Step 5: 提交** `git commit -m "feat(migrate): per-device split into member fields, override and changes; config comparison"`。

### Task 4: 执行器、本地迁移记录和导出文件

**Files:**
- Create: `src/domain/migration/journal.ts`、`src/domain/migration/run.ts`
- Test: `tests/unit/migrationJournal.test.ts`、`tests/unit/migrationRun.test.ts`

**Interfaces:**
- Consumes：Task 2、3；`src/api/client.ts` 的函数签名。
- Produces（`journal.ts`）：
```ts
export type RecordStatus = 'migrated' | 'consistent' | 'mismatch' | 'rolledBack'
export interface MigrationRecord {
  deviceId: string; deviceName: string; networkId: string; networkName: string; instanceId: string
  config: LegacyConfig                 // 停用后读到的原样配置
  confirmed: ChangeKey[]
  status: RecordStatus; migratedAt: number; checkedAt?: number; diffs?: FieldDiff[]
}
export function journalKey(user: string): string                // 'et.migrate.' + user
export function loadJournal(user: string): MigrationRecord[]    // 坏数据或不可用 → []
export function upsertRecord(user: string, rec: MigrationRecord): MigrationRecord[]   // 按 deviceId + networkId 替换
export function clearJournal(user: string): void
export function exportFile(networkName: string, previews: DevicePreview[], now: Date): { filename: string; text: string }
```
  `exportFile`：文件名 `easytier-migration-{networkName}-{YYYYMMDD-HHmmss}.json`（本地时间）；内容 `{ format: 'easytier-console-migration/1', exported_at, network_name, devices: [{ device_id, device_name, hostname, instance_id, running, config }] }`，两格缩进。
- Produces（`run.ts`）：
```ts
export interface MigrationApi {
  setInstanceDisabled(machineId: string, instId: string, disabled: boolean): Promise<void>
  getInstanceConfig(machineId: string, instId: string): Promise<Record<string, unknown>>
  listInstances(machineId: string): Promise<InstanceList>
  deleteInstance(machineId: string, instId: string): Promise<void>
  runInstance(machineId: string, config: object, save: boolean): Promise<void>
  addMembers(networkId: string, deviceIds: string[]): Promise<void>
  updateMember(networkId: string, deviceId: string, patch: MemberPatch): Promise<unknown>
  setMemberConfig(networkId: string, deviceId: string, config: object): Promise<void>
  removeMember(networkId: string, deviceId: string): Promise<void>
  listMembers(networkId: string): Promise<{ members: CentralNetworkMember[] }>
  nodeInfo(machineId: string, instId: string): Promise<{ config: string }>
  generateToml(config: object): Promise<{ toml: string } | { error: string }>
  parseToml(toml: string): Promise<{ config: Record<string, unknown> } | { error: string }>
}
export type StepName = 'disable' | 'recheck' | 'join' | 'settings' | 'wait' | 'record' | 'cleanup'
export type DeviceOutcome =
  | { kind: 'migrated' }
  | { kind: 'migratedKeptLegacy'; message: string }        // 第 7 步失败
  | { kind: 'rolledBack'; step: StepName; message: string }
  | { kind: 'needsAttention'; step: StepName; message: string }
export interface RunTiming { pollMs: number; runningTimeoutMs: number; goneTimeoutMs: number }
export const DEFAULT_TIMING: RunTiming  // { pollMs: 2000, runningTimeoutMs: 120_000, goneTimeoutMs: 90_000 }
export interface RunHooks {
  onStep(step: StepName): void
  record(rec: MigrationRecord): void
  sleep?(ms: number): Promise<void>
  now?(): number
  timing?: RunTiming
}
export async function migrateDevice(api: MigrationApi, input: {
  networkId: string; networkName: string; preview: DevicePreview; target: TargetNetwork; confirmed: ReadonlySet<ChangeKey>
}, hooks: RunHooks): Promise<DeviceOutcome>
export async function rollbackDevice(api: MigrationApi, rec: MigrationRecord, hooks: RunHooks):
  Promise<{ ok: true } | { ok: false; message: string }>
export async function verifyDevice(api: MigrationApi, rec: MigrationRecord):
  Promise<{ status: 'consistent' } | { status: 'mismatch'; diffs: FieldDiff[] } | { status: 'unreachable'; message: string }>
```
  `migrateDevice` 严格按决定 8；`recheck` 用 `classifyInstance` + `unconfirmedChanges`；`settings` 的 PATCH 只带有值的 `virtual_ipv4`、`hostname_override`；`PUT config` 的 body 是 `{...override, proxy_cidrs}`（子网代理为空时不带这个键；覆盖和子网代理都为空时不发）。`wait` 失败的 message 带上成员最后一次的 `error_msg`（有的话）。`rollbackDevice` 按决定 12；重建时 `runInstance(deviceId, rec.config, true)`。`verifyDevice` 按决定 11，`generateToml` 之前去掉 `LEGACY_VPN_FIELDS`。

- [ ] **Step 1: 写失败的测试**（假接口记录调用顺序；`sleep` 立即返回，`now` 每次加 `pollMs`）：
  - 正常：调用顺序恰好是 `setInstanceDisabled(true) → getInstanceConfig → addMembers → updateMember → setMemberConfig → listMembers…(直到 running) → record → deleteInstance`，结果 `migrated`；`record` 收到的 `config` 是 `getInstanceConfig` 的返回值（stored），`confirmed` 是传入的集合。
  - 没有固定 IP 和主机名覆盖时不调用 `updateMember`；覆盖和子网代理都为空时不调用 `setMemberConfig`；`PUT` 的 body 里子网代理为空时没有 `proxy_cidrs` 键。
  - 每个失败点各一个测试：`disable` 抛错 → `rolledBack`、`step: 'disable'`，之后没有任何调用；`recheck` 发现没确认的差异 → 只调用 `setInstanceDisabled(false)`，message 含差异键名；`join`、`settings`、`wait`（超时）失败 → 依次 `removeMember`（`join` 失败时不调）→ `listInstances` 直到不含网络 id → `setInstanceDisabled(false)`，结果 `rolledBack`；回滚中 `setInstanceDisabled(false)` 也失败 → `needsAttention`，`step` 是最初失败的那步；`cleanup` 失败 → `migratedKeptLegacy`，没有任何回滚调用，`record` 已被调用。
  - `wait`：成员 `running: false, error_msg: 'boom'` 直到超时 → message 含 `boom`。
  - `rollbackDevice`：旧实例还在（`listInstances` 里有）→ `removeMember` → 等消失 → `setInstanceDisabled(false)`；不在 → `runInstance(deviceId, rec.config, true)` → 等它出现在 running 里。
  - `verifyDevice`：`nodeInfo` 抛错 → `unreachable`；用 `flow-core2.json` 的 TOML 和 `stored-core2-office` 做记录 → `consistent`；`parseToml` 返回 error → `unreachable`，message 是这个 error；记录的配置带旧版 VPN 字段时，`generateToml` 收到的对象里没有这些字段。
  - `journal`：`upsertRecord` 同一设备同一网络替换、不同网络并存；localStorage 里是坏 JSON → `loadJournal` 返回 `[]`；`exportFile` 的文件名格式和 `format` 字段；`clearJournal` 后为空。
- [ ] **Step 2:** 运行 `npx vitest run tests/unit/migrationJournal.test.ts tests/unit/migrationRun.test.ts`。Expected：FAIL。
- [ ] **Step 3:** 实现两个文件。
- [ ] **Step 4:** 运行同一命令和 `npm run typecheck`。Expected：PASS。
- [ ] **Step 5: 提交** `git commit -m "feat(migrate): device runner with rollback, verification, local journal and export file"`。

### Task 5: 路由、横幅、盘点和网络设置两步

**Files:**
- Create: `src/pages/MigratePage.vue`、`src/composables/useLegacyInventory.ts`、`src/components/migrate/MigrationBanner.vue`、`src/components/migrate/WizardSteps.vue`、`src/components/migrate/InventoryStep.vue`、`src/components/migrate/NetworkStep.vue`、`src/i18n/migrate/zh-CN.ts`、`src/i18n/migrate/en.ts`
- Modify: `src/router.ts`（`{ path: 'migrate', name: 'migrate', component: MigratePage }`，webhook 模式 `replace('/')`）、`src/pages/OverviewPage.vue`（标题下面放横幅）、`src/i18n/zh-CN.ts`、`src/i18n/en.ts`
- Create: `tests/e2e/migrateMock.ts`、`tests/e2e/migrate.spec.ts`

**Interfaces:**
- Consumes：Task 2–4；inventory store（`machines`、`networks`、`membersByNetwork`、`devices`）；`listInstances`、`instanceMetas`、`getInstanceConfig`、`getNetwork`、`getGatewayInfo`。
- Produces（`useLegacyInventory.ts`）：
```ts
export function useLegacyInventory(): {
  loading: Ref<boolean>; progress: Ref<{ done: number; total: number }>
  instances: Ref<LegacyInstance[]>; offline: Ref<DeviceRef[]>
  failed: Ref<{ device: DeviceRef; message: string }[]>
  load(): Promise<void>               // 全部重读；单飞
  retry(deviceId: string): Promise<void>
}
```
- Produces（`MigratePage.vue` 的页面状态，后面的步骤组件通过 props / emits 读写）：`step: 1..5`、`group: LegacyGroup | null`、`draft`、`target: TargetNetwork`、`selected: Set<string>`、`confirmed: Map<deviceId, Set<ChangeKey>>`。选中组 → 第 2 步；第 2 步「下一步」→ 第 3 步；第 5 步可以从第 1 步的「校验报告」直接进入。
- Produces（`tests/e2e/migrateMock.ts`）：`migrateOverrides(opts?: { offline?: string[]; failRead?: string[]; network?: 'none' | 'existing' }): Overrides`，用 `migrate/` fixtures 回答 `/machines`、`/machines/*/networks`、`/machines/*/networks/metas`、`/machines/*/networks/config/*`、`/networks`；写请求（POST/PUT/PATCH/DELETE）默认成功并由 `requests` 记录。

文案（中文原样）：
- 横幅：「检测到 {n} 个旧版网络实例，可以迁移到中央网络」，按钮「开始迁移」，关闭按钮 aria-label「关闭」；记录：「{n} 台设备迁移后等待校验」，按钮「查看」。
- 页面标题「迁移到中央网络」，步骤条：「盘点」「网络设置」「逐台预览」「执行」「校验报告」。
- 第 1 步：表头「网络名」「实例」「运行中」「停用」「目标」，目标列「新建」或「已有网络 {name}」，行按钮「迁移这一组」；离线区标题「离线设备（{n} 台）」、说明「上线后才能读取它们的实例」；失败区「读取失败（{n} 台）」+「重试」；进度「正在读取 {done} / {total} 台设备」；没有旧实例时空状态「没有需要迁移的旧实例」。
- 第 2 步：沿用 `NetworkSettingsFields`，另加「网络密钥」（密码框 +「显示」）；冲突区标题「组内不一致的设置」，每项「{value}（{count} 台）」；Manual 时有「使用全部服务器地址（{n} 个）」；网络名或密钥和最常见值不同时的提示（决定 2）；已有网络时只读显示并链接「到网络设置中修改」（`/networks/{id}?tab=settings`）。底部「上一步」「下一步」。

- [ ] **Step 1: 写失败的 e2e 测试**（`tests/e2e/migrate.spec.ts`，`mockApi(page, migrateOverrides())`）：
  1. 概览页显示横幅「检测到 3 个旧版网络实例」；点「开始迁移」到 `/#/migrate`；点关闭后横幅消失，刷新后仍不显示；machines 里多出一个旧实例 id 后再次显示。
  2. webhook 模式（`mockApi(page, {}, { webhook: true })`）不显示横幅，打开 `/#/migrate` 回到概览。
  3. 第 1 步列出 `office`（4 / 运行中 3 / 停用 1 / 新建）和 `lab-old`（1 / 0 / 1）；`offline: [core4]` 时 office 只有 3 个实例、离线区列出 core4；`failRead: [core3]` 时读取失败区有 core3，点「重试」（这次成功）后 office 有 core3。
  4. 「迁移这一组」进入第 2 步：网络名 `office`、网段 `10.150.0.0/24`、冲突区有两种连接方式；点「使用全部服务器地址（2 个）」后节点地址是两个；把网络名改成 `office2` 出现决定 2 的提示；网络名清空时「下一步」不可用。
  5. `network: 'existing'`（`/networks` 里有 network_name `office` 的网络）时第 1 步目标列「已有网络 office」，第 2 步只读并有「到网络设置中修改」链接。
  6. 整个第 1、2 步没有发出任何非 GET 请求。
- [ ] **Step 2:** 运行 `npx playwright test tests/e2e/migrate.spec.ts`。Expected：FAIL。
- [ ] **Step 3:** 实现路由、横幅（决定 13，关闭状态存 `et.migrate.banner.<用户名>`）、`useLegacyInventory`（决定 1、15；`getInstanceConfig` 只读旧实例）、页面骨架和前两步。
- [ ] **Step 4:** 运行 `npx playwright test tests/e2e/migrate.spec.ts tests/e2e/overview.spec.ts && npx vitest run tests/unit/i18n.test.ts && npm run typecheck`。Expected：PASS。
- [ ] **Step 5: 提交** `git commit -m "feat(migrate): migration banner, inventory and network settings steps"`。

### Task 6: 逐台预览

**Files:**
- Create: `src/components/migrate/PreviewStep.vue`、`src/components/migrate/DevicePreviewCard.vue`、`src/components/migrate/ChangeSummary.vue`
- Modify: `src/pages/MigratePage.vue`、`src/i18n/migrate/*.ts`、`tests/e2e/migrate.spec.ts`

**Interfaces:**
- Consumes：`planGroup`、`DevicePreview`、`Change`、页面状态 `selected`、`confirmed`。
- Produces：`PreviewStep` emits `next`；页面在第 4 步用 `previews.filter(p => selected.has(p.device.id))`。

文案（中文原样）：每台卡片右上「迁移 / 暂不迁移」（两个选项的分段按钮）；三段标题「转换成成员字段」「转换成配置覆盖」「中央网络无法表达，会改变」；成员字段行「固定 IP」「主机名覆盖」「子网代理」；覆盖为空时「没有需要覆盖的配置」；差异行「{label}：{from} → {to}」+ 勾选框「我已了解」；差异名：connectivity「连接方式」、network_name「网络名」、network_secret「网络密钥」、dhcp「自动分配 IP」、network_length「子网前缀」、secure_mode「安全模式」、acl「ACL」、vpn_portal「VPN Portal」，其余用字段名；ACL 差异下方可展开「查看旧 ACL」（等宽，JSON 两格缩进）和提示「迁移不会转换 ACL。迁移完成后，到网络的 ACL 页把它写成中央规则。」；阻止项：ipOutsideCidr「固定 IP {ip} 不在网段 {cidr} 内」、duplicateIp「固定 IP {ip} 和 {other} 重复」、ipTaken「固定 IP {ip} 已被成员 {other} 使用」；停用实例默认「暂不迁移」，小字「这个实例已停用，暂不迁移时原样保留为手动实例」；已是成员「已是成员，跳过」。顶部汇总「将迁移 {n} 台 · 暂不迁移 {m} 台」和各差异种类「{label} · {n} 台」+「全部确认」。

- [ ] **Step 1: 写失败的 e2e 测试：**
  1. 第 3 步有四张卡片；core1、core2、core3 默认「迁移」，core4 默认「暂不迁移」并有停用说明。
  2. core2 卡片：固定 IP `10.150.0.2`、主机名覆盖 `core2-office`、子网代理 `192.168.88.0/24`；覆盖里有 `port_forwards`；没有第 3 类差异。
  3. core3 的 ACL 差异能展开看到 `3389`；core1 有「连接方式」和「VPN Portal」两条差异。
  4. 「下一步」在还有未勾选差异时不可用；逐条勾选后可用；取消勾选又不可用；汇总里「连接方式 · 1 台」的「全部确认」勾上 core1 的那条。
  5. 第 2 步把网段改成 `10.151.0.0/24` 再到第 3 步：core1..3 都显示 `ipOutsideCidr` 并固定为「暂不迁移」，汇总「将迁移 0 台」，「下一步」不可用。
  6. 两台设备改成相同 IP（mock 把 core3 的 `virtual_ipv4` 改成 `10.150.0.2`）：两张卡片都有 duplicateIp；把 core3 设为「暂不迁移」后 core2 的阻止项消失。
  7. 窄屏（375×812）`scrollWidth <= 视口宽度`。
- [ ] **Step 2:** 运行 `npx playwright test tests/e2e/migrate.spec.ts`。Expected：新测试 FAIL。
- [ ] **Step 3:** 实现预览步骤。
- [ ] **Step 4:** 运行同一命令和 `npm run typecheck`。Expected：PASS。
- [ ] **Step 5: 提交** `git commit -m "feat(migrate): per-device preview with confirmations and blockers"`。

### Task 7: 执行和校验报告

**Files:**
- Create: `src/components/migrate/ExecuteStep.vue`、`src/components/migrate/ReportStep.vue`
- Modify: `src/pages/MigratePage.vue`（执行中离开页面的确认：`onBeforeRouteLeave` + `beforeunload`）、`src/i18n/migrate/*.ts`、`tests/e2e/migrate.spec.ts`、`tests/e2e/migrateMock.ts`（成员列表在 `addMembers` 之后返回这台设备 `running: true`；可选让某个写请求返回 500；`POST /generate-config` 回答 `flow-core2.json` 的 `generatedFromStored`，`POST /parse-config` 按请求里的 TOML 等于 `centralToml` / `generatedFromStored` 分别回答 `parsedCentral` / `parsedGenerated`，其余 TOML 回答 `parsedCentral` 的一份改了 `mtu` 的副本，用来做「不一致」）

**Interfaces:**
- Consumes：`migrateDevice`、`rollbackDevice`、`verifyDevice`、`exportFile`、`loadJournal`、`upsertRecord`、`clearJournal`、`createNetwork`、`settingsPayload`、`downloadText`；`client.ts` 的函数作为 `MigrationApi`。
- Produces：无（最后的页面）。

文案（中文原样）：第 4 步说明「将把 {n} 台设备迁移到中央网络 {name}。每台设备依次：停用旧实例 → 加入网络 → 写入设置 → 等待运行 → 删除旧实例。任何一步失败，这台设备会被移出网络并重新启用旧实例。」；勾选框「我已经按升级手册备份了 et.db」；按钮「下载备份并开始迁移」、「停止」；下载旁小字「文件里有网络密钥，请妥善保存」；每台状态：等待中、停用旧实例、复查配置、加入网络、写入设置、等待运行、记录、删除旧实例、已迁移、已迁移（旧实例没删掉：{message}）、已回滚（{step}：{message}）、需要处理（{step}：{message}）；完成后「查看校验报告」。第 5 步：每台「一致」「不一致」「等待上线后校验」「已回滚」，不一致时列出「{field}：期望 {expected}，实际 {actual}」；按钮「重新校验」「回滚这台…」「下载迁移记录」「清除迁移记录…」；有 ACL 差异被确认过的设备，在报告顶部列出「这些设备迁移前单独配置了 ACL：{names}」+ 链接「去写 ACL 规则」（`/networks/{id}?tab=acl`）。离开确认：「迁移正在进行。离开后，当前这台设备会做完（或回滚完），其余设备不再开始。」

- [ ] **Step 1: 写失败的 e2e 测试：**
  1. 没勾「我已经按升级手册备份了 et.db」时开始按钮不可用；勾上点击后先触发下载（`page.waitForEvent('download')`，文件名以 `easytier-migration-office-` 开头，内容 `format` 正确、含三台设备）。
  2. 没有目标网络时先 `POST /networks`（body 的 settings 等于第 2 步草稿、带 `network_secret`），然后对每台设备的写请求顺序严格符合决定 8（检查 `requests` 里该设备相关请求的方法和路径序列）；三台都显示「已迁移」；本地记录 `et.migrate.admin` 有三条 `migrated`。
  3. `POST /networks/*/members` 对 core3 返回 500 `{message: 'boom'}`：core3 显示「已回滚（加入网络：boom）」，它的请求序列以 `PUT …/networks/{inst} {disabled: false}` 结束；core1、core2 照常迁移。
  4. 执行中点「停止」：当前设备做完后停止，剩下的保持「等待中」。
  5. 执行中点导航「设备」：出现离开确认；取消留在本页；确认后离开。
  6. 第 5 步：`show_node_info` 返回 `flow-core2.json` 的 `centralToml`（mock 的 parse/generate 接口用 flow 里的 parsed 结果回答）→ core2「一致」；某台 proxy-rpc 返回 502 → 「等待上线后校验」；一台不一致时显示差异行，点「回滚这台…」确认后发出 `DELETE …/members/{device}`，然后（旧实例已删除）`POST /machines/{device}/networks`，body 的 `config` 等于记录里的配置、`save: true`，状态变成「已回滚」。
  7. 重新打开 `/#/migrate`：第 1 步出现「校验报告」入口；已迁移的设备在第 3 步显示「已是成员，跳过」。
  8. 「清除迁移记录…」在还有「已迁移」（未校验）记录时不可用。
- [ ] **Step 2:** 运行 `npx playwright test tests/e2e/migrate.spec.ts`。Expected：新测试 FAIL。
- [ ] **Step 3:** 实现第 4、5 步和离开确认。
- [ ] **Step 4:** 运行完整测试：`npm test && npm run typecheck && npm run e2e`。Expected：全部 PASS。
- [ ] **Step 5: 提交** `git commit -m "feat(migrate): execute step with export, stop and leave guard; verification report with rollback"`。

### Task 8: 在 testenv 上完整演练（合成数据）

**Files:**
- Create: `playwright.migrate.config.ts`（同 `playwright.live.config.ts`，`testDir: 'tests/live-migrate'`，`timeout: 600_000`）、`tests/live-migrate/migrate.spec.ts`、`testenv/reports/migrate-rehearsal-2026-11-24.md`
- Modify: `testenv/README.md`

**Interfaces:**
- Consumes：Task 1 的 data-migrate 环境（升级前备份路径）；Task 5–7 的页面。

- [ ] **Step 1: 写 live 测试** `tests/live-migrate/migrate.spec.ts`（只针对 data-migrate 环境：开头检查 `/machines` 里有 core4 且 core1 有名为 `office` 的旧实例，否则直接失败并提示怎么准备环境）：用浏览器走完整个向导（office 组，默认选择：core1..3 迁移、core4 不迁移；确认所有差异；勾选备份；开始），断言：三台「已迁移」；`GET /networks` 有 `office`；三个成员 `running`，固定 IP 是 `.1/.2/.3`，core2 的 `hostname_override` 是 `core2-office`；三台设备上不再有 office 旧实例，core4 的 office 和 core1 的 lab-old 还在；校验报告三台「一致」；然后在报告里回滚 core3，断言 core3 不再是成员、旧实例重建并运行、它的 TOML 和 `data-migrate/seed-snapshot.json` 里迁移前的逐行相同。测试结束（`finally`）**不**自动恢复——环境恢复由 Step 3 的整体回滚完成。
- [ ] **Step 2:** 运行 `npx playwright test -c playwright.migrate.config.ts`（环境：`ET_DATA_DIR=./data-migrate`、web v2.7.1、`--profile migrate`）。Expected：PASS。不通过时用 superpowers:systematic-debugging 找原因；是比较规则的问题就改 Task 3 的规则并记 ruling，是产品行为就记进报告并修正向导。
- [ ] **Step 3: 整体回滚演练**（spec §8）：`ET_DATA_DIR=./data-migrate bash testenv/upgrade.sh v2.7.1 v2.6.4`（web 2.6.4 起不来是预期的）→ 停 web → 用 Task 1 Step 1 打印的升级前备份覆盖 `data-migrate` → `ET_WEB_TAG=v2.6.4` 启动 web → 等 90 秒内：每台 core 的 `running_inst_ids` 恰好是迁移前的旧实例（中央实例 `office` 网络 id 已被 2.6.4 web 清掉）→ `ET_DATA_DIR=./data-migrate node testenv/seed-migration.ts` 输出 `skipped 5 existing` → 三个 office 的 TOML 和 seed-snapshot 逐行相同。中央实例没被清掉时：记录现象，试 `docker compose restart core1 core2 core3` 能否清掉，结论写进报告和升级手册（Task 9）。
- [ ] **Step 4: 写报告** `testenv/reports/migrate-rehearsal-2026-11-24.md`：第一行 `REHEARSAL: PASS` 或 `REHEARSAL: FAIL`；记录每一步的命令、耗时、预览里出现的第 3 类差异（应恰好是 core1 的连接方式和 VPN Portal、core3 的 ACL）、校验结果、单台回滚结果、整体回滚结果。然后把环境恢复：`docker compose --profile migrate stop core4`，用 `ET_DATA_DIR=./data-central` 和 web v2.7.1 重新启动 web（core1..3 继续运行），确认 `npx playwright test -c playwright.live.config.ts` 仍然通过。
- [ ] **Step 5: 提交** `git commit -m "test: live migration rehearsal on the legacy testenv"`。

### Task 9: 部署示例、升级手册和 README

**Files:**
- Create: `deploy/Caddyfile`、`deploy/docker-compose.yml`、`deploy/config.js.example`、`docs/upgrade-runbook.md`
- Modify: `README.md`（「部署」「从 2.6.4 迁移」两节，替换现在的「见 Plan 6」）、`docs/superpowers/plans/2026-11-23-00-roadmap.md`（计划 6 状态）

**Interfaces:**
- Consumes：Task 8 报告里的结论（回滚是否需要重启 core）。

内容要求：
- `deploy/docker-compose.yml`：服务 `easytier-web`（镜像 `easytier/easytier:v2.7.1`，`entrypoint: ["easytier-web-embed"]`，`command: ["--disable-registration"]`，数据卷 `./data:/app`，发布 `22020/udp`（设备登记）；原版内嵌前端的 11211 默认不对外发布，注释里写明需要保留旧前端作对照时怎么打开）和 `caddy`（`caddy:2`，挂载 `../dist:/srv:ro`、`./Caddyfile:/etc/caddy/Caddyfile:ro`、数据卷，发布 80/443）。
- `deploy/Caddyfile`：站点地址用 `{$SITE_ADDRESS:localhost}`；`handle /api/*` 反向代理到 `easytier-web:11211`；其余 `root * /srv` + `file_server`；`/config.js` 不存在时返回空 200（`window.__ET_CONFIG__` 未设置 = 同源）；`encode gzip`。
- `deploy/config.js.example`：`window.__ET_CONFIG__ = { apiBase: 'https://api.example.com' }` 和一行注释：只有前端和 API 在同一注册域名的不同子域时才需要（spec §5.1 的 cookie 限制）。
- `docs/upgrade-runbook.md`：按 spec §5.10.1 的 7 步写成可以照着执行的命令清单，替换成生产的真实路径和容器名（`easytier-web`，数据目录 `/home/flintylemming/appdata/11211,22020-easytier-web/data`），包括：前置验证引用 Task 8 / Task 10 的报告；备份（`docker stop easytier-web` 后 `cp -a` 整个 data 目录，带时间戳，并 `sqlite3 … 'PRAGMA integrity_check'`）；用 `easytier/easytier:v2.7.1`（或镜像站同版本）重建容器，**参数不变**；检查清单；部署新前端；运行向导；回滚顺序 **停 web → 恢复备份 → 用旧镜像（2.6.4 的 digest）启动**（Plan 1 M7），以及 Task 8 发现的「中央实例是否会被自动清掉」的结论和对应操作。开头写明：这份手册由用户执行，或者在执行当天得到用户明确同意后执行。
- README「部署」：同源方案（推荐）、`npm run build` → `deploy/` 用法、OIDC（`--oidc-frontend-base-url`）、`config.js` 子域方案及限制、GeoLite2 引用现有说明；「从 2.6.4 迁移」：链接升级手册，说明向导的五步、横幅入口和 `/#/migrate`、本地迁移记录在浏览器 localStorage 里（含密钥）、ACL 不自动转换、停用实例默认保留为手动实例、离线设备上线后再迁移和校验。

- [ ] **Step 1:** 写上面的文件。
- [ ] **Step 2: 本地冒烟**（用户已同意拉取 `caddy:2`）：`npm run build`；在 scratch 目录放一个空的 `data`，用 `SITE_ADDRESS=:8088` 和改过的端口（避开 testenv 的 11211 / 22020：compose 里端口写成 `${ET_HTTP_PORT:-80}:80`、`${ET_UDP_PORT:-22020}:22020/udp` 这类变量）`docker compose -f deploy/docker-compose.yml -p et-deploy-smoke up -d`。检查：`curl -s localhost:8088/` 含 `<div id="app">`；`curl -s localhost:8088/config.js` 返回 200；`curl -s localhost:8088/api/v1/auth/check_login_status` 返回 401（经 Caddy 到达后端）；用浏览器打开 `http://localhost:8088/`，注册关闭时用 API 建不了用户——改为启动参数去掉 `--disable-registration` 的临时 override 文件注册 `smoke` 账号后登录，看到概览页。最后 `docker compose -p et-deploy-smoke down -v` 并删除 scratch 数据。Expected：全部符合。
- [ ] **Step 3:** 把冒烟结果（命令和输出要点）写进 `deploy/README.md` 的末尾「已验证」一小节；roadmap 计划 6 状态改为「已完成（生产升级待用户执行）」。
- [ ] **Step 4: 提交** `git commit -m "docs: deployment examples, upgrade runbook and migration guide"`。

### Task 10: 用生产数据库副本演练（用户 2026-11-24 同意只读复制）

**Files:**
- Create: `testenv/prod-rehearsal.ts`（生成演练用的 compose 和账号，不含任何生产数据）、`testenv/reports/prod-rehearsal-2026-11-24.md`
- 生成但不提交（`testenv/data-prod/` 已被 `.gitignore` 的 `testenv/data*/` 覆盖）：`testenv/data-prod/et.db`、`testenv/data-prod/docker-compose.yml`

**安全规则**（这一任务的每一步都要遵守）：
- 生产主机上**只读**：不写任何文件（包括 `/tmp`），不停止或重启容器，不执行 sqlite 的写语句。
- 副本和生成的 compose 只放在 `testenv/data-prod/` 和 `testenv/backups/`（都被 git 忽略）；报告只写数量和类别，不写密钥、IP、machine id、设备名以外的个人信息（设备名用「设备 1、设备 2…」代替）。
- 模拟设备的 core **只接入 `internal: true` 的 Docker 网络**，不能连外网，所以拿着真实网络密钥的实例连不到真实网络。web 另接一个普通网络，只为了把端口发布到 `127.0.0.1`。

- [ ] **Step 1: 只读复制。**先只读探查：`ssh idc-ucloud 'command -v sqlite3; docker ps --format "{{.Names}} {{.Image}}"'`。有 sqlite3 且对数据库文件有读权限时：`ssh idc-ucloud "sqlite3 -readonly 'file:/home/flintylemming/appdata/11211,22020-easytier-web/data/et.db?mode=ro' .dump" > testenv/data-prod/dump.sql`，本地 `sqlite3 testenv/data-prod/et.db < dump.sql`；否则用 `ssh idc-ucloud 'docker cp easytier-web:/app/. -' | tar -x -C testenv/data-prod --include 'et.db*'`（容器内路径以 `docker inspect` 的挂载为准）。本地 `sqlite3 testenv/data-prod/et.db 'PRAGMA integrity_check'` 必须是 `ok`，否则重复复制（最多 3 次）。复制一份原样副本到 `testenv/backups/prod-copy-<时间戳>/`。
- [ ] **Step 2: 生成演练环境。**`node testenv/prod-rehearsal.ts testenv/data-prod`：从副本里读出拥有旧实例的用户（应为 user_id 3）和他名下有旧实例的设备 id；把这个用户的密码哈希替换成 testenv `admin` 的哈希（只改本地副本，打印用户名）；生成 `testenv/data-prod/docker-compose.yml`：web（镜像标签取 `ET_WEB_TAG`，挂载 `testenv/data-prod`，端口 `127.0.0.1:11311:11211`，网络 `rehearsal` + `egress`）和每台设备一个 core（`easytier/easytier:v2.6.4`，`--config-server udp://web:22020/<用户名>`、`--machine-id <设备 id>`，只在 `rehearsal` 网络，`internal: true`，`cap_add: NET_ADMIN`、`/dev/net/tun`）。设备太多导致资源不够时（容器起不来或 web 报错），改为只生成前 N 台并在报告里写明 N。
- [ ] **Step 3: 在 2.6.4 上确认副本能用。**`ET_WEB_TAG=v2.6.4 docker compose -f testenv/data-prod/docker-compose.yml -p et-prod-rehearsal up -d` → 用 API 登录（用户名 + `admin`）→ 等 core 都上线 → 记录每台设备的旧实例数、运行中数（应和 spec §1：42 台设备、46 个实例、组 A 42 个（4 个停用）、组 B 4 个（全部停用）一致，差异写进报告）→ 对每个运行中的实例抓 `show_node_info` TOML，存到 `testenv/data-prod/snapshot.json`。
- [ ] **Step 4: 升级并跑向导。**停 web → 备份 `testenv/data-prod` 到 `testenv/backups/prod-pre-upgrade-<时间戳>/` → `ET_WEB_TAG=v2.7.1` 重新 up web。核对 spec §5.10.1 第 1 步的三点（旧实例照常下发运行；设备登记到 devices 表；中央网络能下发给 2.6.4 core 运行）。然后用 live 测试的方式（`ET_LIVE_API=http://localhost:11311`，复用 `tests/live-migrate/` 的辅助函数，新增 `tests/live-migrate/prod.spec.ts`，只在 `ET_PROD_REHEARSAL=1` 时运行）走向导：组 A 的预览里第 3 类差异按种类计数，和 spec §1 对照（至少：连接方式不同的设备、单独配置 ACL 的 1 台；组 B 全部停用、默认不迁移）；全部确认后执行；校验报告应全部「一致」，不一致的逐条分析（比较规则问题 → 修 Task 3 并记 ruling；产品问题 → 修向导）。
- [ ] **Step 5: 回滚演练。**在报告里对一台设备「回滚这台」，确认它的 TOML 和 Step 3 的快照逐行相同；然后整体回滚：停 web → 用 Step 4 的升级前备份覆盖 → `ET_WEB_TAG=v2.6.4` 启动 → 90 秒内每台设备的运行实例和 Step 3 的快照一致、TOML 逐行相同（中央实例被清掉的情况同 Task 8 Step 3 的结论）。
- [ ] **Step 6: 收尾。**`docker compose -p et-prod-rehearsal down`；确认 testenv（data-central）仍在运行。写报告 `testenv/reports/prod-rehearsal-2026-11-24.md`（第一行 `REHEARSAL: PASS` / `FAIL`，遵守上面的安全规则），在升级手册的「前置验证」里引用它。副本**保留**在 `testenv/data-prod/`（git 忽略），最终总结里告诉用户位置和删除命令。
- [ ] **Step 7: 提交** `git commit -m "test: production-copy migration rehearsal"`（只提交脚本、报告和手册的改动；提交前 `git status` 确认没有 `data-prod` 下的文件）。

### 收尾

- [ ] 把执行中做的决定写进 `docs/superpowers/rulings-plan-6.md`（格式同前几个计划）。
- [ ] 全量验证：`npm test && npm run typecheck && npm run e2e && npm run build`，以及 `npx playwright test -c playwright.live.config.ts`。
- [ ] 用 superpowers:requesting-code-review 做一次整体审阅，修掉 Critical / Important 问题后再交给用户。
