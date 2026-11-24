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

冒烟测试只写本地测试环境：会临时改 core2 的固定 IP 和成员覆盖，并在 core2 上建一个名为 `live-manual` 的手动实例；每个测试结束后（失败也一样）都用 API 恢复原状。

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

## 高级配置与手动实例

**成员覆盖。** 设备详情「此网络中的设置」里的「高级配置」一行，点「编辑」打开配置编辑器，保存的是这台设备在中央网络里的成员覆盖。网络名、密钥、组网方式、虚拟 IP、主机名、节点地址、ACL 这些字段由中央网络掌管（完整列表见 `src/domain/memberOverride.ts` 的 `CENTRAL_OWNED_FIELDS`），始终以网络为准，表单里不展示，写入时也会去掉；除此之外的配置（MTU、监听地址、加密、端口转发、DNS、各项开关等）都以覆盖为准。覆盖里只有子网代理、或者只有和默认值相同的字段时，这一行显示「默认」，否则显示「已覆盖」。「恢复默认」需要确认，它清除覆盖但保留子网代理（子网代理也存在覆盖里，在「子网代理」一行单独编辑）。

**表单和 TOML。** 编辑器有「表单」和「TOML」两个标签页。表单只放常用字段，没有展示的字段保存后原样保留。TOML 页由 easytier-web 的 `generate-config` 生成，可以直接修改；切回表单或保存时用 `parse-config` 解析，解析失败会在下方显示原因，不能保存。编辑成员覆盖时，TOML 里中央网络掌管的字段即使改了也会被忽略。2.7 之前的 core 使用旧版 VPN Portal 字段（`enable_vpn_portal` 等），easytier-web 2.7.1 的 TOML 接口不接受这些字段，所以它们不出现在 TOML 里，保存时原样保留。

**手动实例。** 手动实例是直接运行在某台设备上、不受中央网络管理的网络实例（对应原版的远程管理），用来让这台设备额外加入中央网络之外的网络，比如别人的 EasyTier 网络或临时的测试网络，配置完全由你在编辑器里写。入口在设备详情的网络切换器 →「手动实例（高级）…」（`/#/devices/<id>/instances`）：可以新建（「创建并运行」，或者「仅保存」——仅保存的实例处于停用状态）、导入 TOML、编辑、启用和停用、导出 TOML、删除（需要确认）。列表每 5 秒刷新一次，中央网络自己的实例不会出现在这里；设备离线时不能操作。「仅保存」的请求如果正好赶上 easytier-web 2.7.1 对这台设备做运行时对齐（比如中央网络的配置刚改过），web 会把这个实例在设备上短暂运行起来（约 5–25 秒），直到 web 服务端下一次心跳把它清理掉；这段时间列表里显示它在运行，之后变成「已停用」。这是 easytier-web 的行为。webhook 模式下没有中央网络，设备详情页的左栏直接显示手动实例。

**VPN Portal。** 让装了 WireGuard 的手机、笔记本接入实例所在的网络。先在编辑器的「VPN Portal」一节开启，然后从运行中实例的菜单打开「VPN Portal…」：

- **2.7 及以上的 core** 按客户端管理：列表显示每个客户端的虚拟 IP 和连接状态；可以添加客户端（名称、实例网段内未使用的地址、前缀、分组）和删除客户端（需要确认）；「复制配置」复制已经填好服务器地址（Endpoint）的 WireGuard 配置。新客户端的默认名称是随机的（`client-` 加 8 位十六进制）：core 用名称推导客户端的密钥，再次添加删除过的名称，会让原来那份配置恢复访问权限。
- **2.7 之前的 core** 是旧版 VPN Portal：所有客户端共用一份配置，没有按客户端的管理。编辑器里设置监听端口和客户端网段；复制配置后，要把 `Address` 改成客户端网段里一个未使用的地址。这只适用于手动实例：easytier-web 2.7.1 保存成员覆盖时会用新版配置校验整份中央网络配置，开启旧版 VPN Portal 的覆盖会被拒绝，所以成员覆盖的编辑器在这类 core 上只显示一句说明、不提供开关，覆盖里已有的旧版字段原样保留。要在这类设备上用 VPN Portal，可以升级 core，或者使用手动实例。

控制台不提供二维码（上游的二维码需要新增依赖）。把复制的配置导入 WireGuard 客户端即可；需要二维码时可以在本机用 `qrencode` 之类的工具自己生成。

## 网络

顶部导航的「网络」进入网络页（webhook 模式下没有这个入口）。只有一个网络时直接打开它的详情；面包屑「网络」（`/#/networks?list=1`）回到列表，在那里可以新建网络。新建时可以填显示名、网络名（留空由后端生成）、组网方式（内置网关只在后端开启了网关时可选）、网段、安全模式和网络密钥（留空由后端生成，也可以在浏览器里随机生成）。

网络详情有四个标签页，标签页记在地址里（`?tab=acl` 等）：

- **成员**：和设备表一样的成员列表，点击一行进入这台设备在这个网络里的详情。「添加成员」可以多选还不在这个网络里的设备；安全模式的网络还可以把它们作为临时成员加入（24 小时 / 7 天 / 30 天后失效）。有临时节点（用凭据接入、但不是成员的设备）时，列在成员下面。移出成员需要确认；注意 easytier-web 会同时修改引用这个成员的 ACL 规则，只剩它的规则会被删除。
- **ACL**：先编辑、再保存。默认动作、规则的增删改、启用开关和上下顺序都只改页面上的草稿，点「保存」才把整份策略写回；没改过的规则原样写回。规则从上到下匹配，排在前面的优先；端口留空表示所有端口。「默认拒绝」并且没有启用的「允许」规则时，保存前会再确认一次。有未保存的修改时离开页面会先询问。策略一旦保存过就只能修改，不能删除。
- **凭据**（只在安全模式下显示）：生成凭据（有效期、是否可重复使用、可选的自定义 ID），查看接入信息（命令行或配置文件，以及凭据密钥），吊销（需要确认）。列表每 5 秒刷新一次在线节点。临时成员自己的凭据（`member-…`）不能在这里吊销，移出这个临时成员即可。
- **设置**：修改新建时的那些字段。修改网络名、网段、组网方式或节点地址、安全模式会让所有成员重新连接，保存前会列出影响并确认；修改网段时，所有自动分配的 IP 会重新分配。网络密钥默认隐藏，可以显示、复制或重新生成（需要确认，用旧密钥手动接入的设备会断开）。最下面是删除网络（需要确认，不能恢复）。

## 测试环境

本地 Docker 测试环境（easytier-web v2.7.1 + 三个 easytier-core）的启动、账号、数据目录与返回结构说明见 [`testenv/README.md`](testenv/README.md)。

## 部署

见 Plan 6（尚未编写）：同源反向代理，把 `/api` 转发到 easytier-web。设计见 [`docs/superpowers/specs/`](docs/superpowers/specs/)。

## 许可证

LGPL-3.0-or-later，见 [`LICENSE`](LICENSE)。部分文件移植自 [EasyTier](https://github.com/EasyTier/EasyTier) v2.7.1，文件开头有标注。
