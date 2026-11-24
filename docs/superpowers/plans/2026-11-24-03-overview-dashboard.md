# 概览页（Dashboard）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做出概览页：四个统计数字、自动聚焦的节点分布地图（同城合并、边缘标签、悬停列表、连接线、位置排行），以及「需要关注」和「连接质量」两栏。同时补上离线设备的位置缓存，并让设备详情和概览共用同一份 peer/路由数据。

**Architecture:**
- **数据生成：**坐标表和陆地点阵在构建时由 `scripts/build-geo.ts` 生成，数据来自 Natural Earth v5.1.2（公有领域）和 `world-atlas`，结果提交进 `src/generated/geo/`。运行时不请求任何外部资源。
- **纯函数：**放在 `src/domain/geo/`（名称归一化、位置解析、分组、自动聚焦、屏幕合并、边缘标签、连线）和 `src/domain/`（设备对统计、需要关注、概览数字），全部用单元测试覆盖。
- **运行时 store：**新的 Pinia store `runtime` 保存每个（设备, 网络）的路由和 peer 原始数据。概览页每 15 秒批量拉取所有在线成员的数据；设备详情的 `useDeviceRuntime` 也读写这份数据。
- **地图渲染：**使用 `d3-geo` 的 `geoNaturalEarth1` 投影，画成 SVG：
  - 陆地是一条由许多 `M x y h0` 组成的 path，用圆头描边画成点阵；
  - 节点是圆点；
  - 连线是二次贝塞尔曲线。

  概览页按路由懒加载，所以坐标表只打进这个分包。

**Tech Stack:** 在计划 2 的基础上新增：
- 运行时依赖：`d3-geo` 3.1；
- 开发依赖：`@types/d3-geo`，以及只在生成脚本里用到的 `topojson-client` 3.1、`@types/topojson-client`、`world-atlas` 2.0。

**Spec:** `docs/superpowers/specs/2026-11-23-easytier-web-console-design.md`（§5.3、§5.5、§6.1–6.4、§6.9、§8）

**规划时核实的事实：**
- **上游内置的 GeoIP 库只有国家级精度。**上游 v2.7.1 内置的 `geoip2-cn.mmdb` 里只有国家名「中国」，没有省和城市，所以默认配置下：
  - 中国的公网 IP 只能得到 `{country: '中国'}`；
  - 国外 IP 得到 `{country: '海外'}`；
  - 内网 IP 得到 `{country: '本地网络'}`。

  只有后端用 `--geoip-db` 加载了 GeoLite2-City 库时，才会有 `region` 和 `city`。`region` 有多个下级行政区时用英文逗号连接。名字优先用简体中文，没有中文名时用英文（见上游 `easytier-web/src/client_manager/mod.rs` 的 `lookup_location`）。
- `location` 只在设备在线时才有。
- **Natural Earth 的覆盖情况：**
  - 10m populated places 的每一条都有 `NAME_ZH`。
  - 抽样的 83 个中国地级市里，79 个能按中文名直接匹配上。没匹配上的台州、中山、宿迁、舟山会退回到省一级。
  - 只保留「中国全部地点 + 人口 ≥ 10 万的地点 + 首都 + worldcity」时，大约 3200 条，gzip 后约 83KB。
  - 部分中文名和 GeoLite2 的叫法不同，例如 Natural Earth 里法兰克福叫「美因河畔法兰克福」，中国叫「中华人民共和国」。所以需要后缀匹配和国家别名表。

**规划时做的决定**（spec §7 交给实现者决定的部分，执行前请用户过目）：
1. 坐标数据用 Natural Earth，不用 GeoNames。Natural Earth 是公有领域，自带中文名；README 里仍然注明来源。
2. 自动聚焦按距离判断：取离加权中心 3000 km 以内的地点作为核心，要求核心覆盖至少 60% 的已定位设备。没有用「去掉离群点后剩 80%」的百分位做法，因为按 mockup 的数据，百分位做法会把东京挤到视野外，和 mockup B 不一致。
3. 地图旋转到设备的加权中心经度。用户的设备在东亚时，世界视图以太平洋为中心，洛杉矶的边缘标签出现在右边（和 mockup B 一致）。
4. 离线设备的缓存位置也用在设备列表里（位置列用浅色显示，悬停提示「最后在线时的位置」）。这样从地图点进列表时，离线设备也能出现在筛选结果里。
5. 两个地点之间的连线，按设备对里多数的连接方式决定是实线还是虚线；直连和中继一样多时画虚线，让问题显眼一些。
6. 「需要关注」里的「全部 (N)」在原地展开。被拉黑设备的说明写「共尝试 N 次」，因为后端只返回累计次数，没有「今天」的次数。
7. 位置排行最多显示 8 行，其余的合成一行「其他 N 地」。
8. 当所有位置都只精确到国家时（也就是后端在用默认 GeoIP 库），地图下方提示可以用 `--geoip-db` 加载 GeoLite2-City，把精度提高到城市。
9. 登录后默认进入概览页（`/`）。计划 2 里默认进入 `/devices`，是因为当时还没有概览页。

## Global Constraints

- 运行时不能向第三方发任何请求。地图数据和坐标表全部打包进产物；概览页上除了本站和 API，不能有其他请求。
- 坐标表的数据来源是 Natural Earth v5.1.2（公有领域），文件 gzip 后不超过 150KB（150 × 1024 字节）。
- 位置匹配顺序：国家 + 城市 → 国家 + 省/州 → 国家中心点 → 未定位。`本地网络` 单独计数；`海外` 以及匹配不上的位置计入「未定位」。
- 离线设备的位置：按 machine id 缓存在 localStorage 里，键名是 `et.locations.<username>`。离线设备用缓存的位置画成空心点；没有缓存的计入未定位。
- 轮询：
  - 设备清单的轮询仍然只由 AppShell 负责：在概览页每 10 秒一次，其他页面每 5 秒一次。
  - peer 和路由每 15 秒一次，只在概览页和设备详情页拉取。
  - 页面不可见时暂停；同一类请求同一时刻只有一个在执行。
  - proxy-rpc 的并发上限是 4，沿用 `src/api/client.ts` 里的全局限流。
- 直连率 = 直连的设备对数 ÷ 所有可达的设备对数，规则如下：
  - 只统计成员与成员之间的连接；
  - 每对设备只算一次，任一端报告了直连，这一对就算直连；
  - 基础设施节点和临时节点不计入，也不在地图上画线；
  - 地图连线、连接质量列表、直连率都使用同一份计算结果（`useRuntime().pairs`）。
- 可更新：版本号取 `-` 之前的 `x.y.z`，和所有设备中的最高版本比较（沿用 `src/domain/version.ts`）。不访问外网。
- 地图只用墨色和灰色，**地图里不使用橙色**：
  - 陆地点用 `#cfcdc4`；
  - 节点用 ink `#26251e`，光晕是 ink、不透明度 8%；
  - 连线是 ink、不透明度 38%、线宽 1.2，中继用 `4 4` 的虚线；
  - 全部离线的地点画成白底、ink 描边（线宽 1.4）的空心圆。

  概览页本身没有橙色主按钮，全站唯一的「添加设备」在导航栏里。
- 视觉 token、字体和圆角与计划 2 的 Global Constraints 相同：canvas `#f7f7f4`；卡片白底，1px hairline `#e6e5e0`；不使用阴影；标题字重 400；IP、版本、ID、数字用 JetBrains Mono；caption-uppercase 为 11px、字重 600、字距 0.88px。
- 所有新文案同时加到 `zh-CN` 和 `en` 两个语言文件中，`tests/unit/i18n.test.ts` 的键一致性测试必须通过。本计划给出的中文文案要原样使用；英文由实现者翻译。
- webhook 模式（`session.webhookMode` 为真）下：不显示网络数、直连率、连接线开关和连接质量；不拉取 peer 和路由；「需要关注」里没有「未加入网络」这一项。
- 沿用计划 2 的约定：设备清单的轮询只有 AppShell 一个，页面只从 store 读数据。凡是调用 `inventory.reset()` 的地方（`src/router.ts` 的 401 处理、`UserMenu.vue` 的退出登录），都要同时调用 `useRuntime().reset()`。
- `scripts/*.ts`，以及被它们导入的 `src/domain/geo/normalize.ts`，只能使用可擦除的 TS 语法，导入时写明 `.ts` 扩展名，并且能用 `node scripts/xxx.ts`（Node 26）直接运行。
- 提交信息结尾空一行，再加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。

## Review Focus

1. **只有国家级位置**（内置 GeoIP 库，全部设备都是 `{country:'中国'}`）：所有设备合成一个点，画在中国的中心点上；聚焦视野有合理的大小（使用最小跨度）；地图下方显示精度提示；排行里是「中国 n/m」。测试放在 Task 4（单个地点的聚焦）和 Task 8（e2e 第 9 条）。
2. **没有可以定位的设备**（全部是本地网络、海外，或者离线且没有缓存）：照常画世界点阵，并叠加空状态文字；不显示聚焦/世界切换；排行只剩特殊行；页面上不出现 NaN。测试放在 Task 4（`computeFocus([])`）和 Task 8（e2e 第 8 条）。
3. **批量 proxy-rpc 部分失败或超时**：直连率只按回答了的设备计算；第一轮拉取结束后，统计卡不能一直停在「正在读取连接…」；其他卡片不受影响。测试放在 Task 5。
4. **位置名对不上坐标表**（GeoLite2 的英文名 `Ashburn`、多级 region `英格兰,大伦敦`、`海外`、空字符串、不认识的国家）：逐级回退，最后计入未定位，不抛错。测试放在 Task 2。
5. **离线设备与缓存**（包括 localStorage 里是损坏的 JSON、条目超过上限）：离线设备画成空心点，位置用缓存的；缓存损坏时当作没有缓存处理。测试放在 Task 3 和 Task 8（e2e 第 3 条）。

---

### Task 1: 坐标表、陆地点阵与名称归一化

**Files:**
- Create: `scripts/build-geo.ts`、`src/domain/geo/normalize.ts`、`src/domain/geo/landMask.ts`、`src/generated/geo/places.json`、`src/generated/geo/landMask.ts`、`src/generated/geo/SOURCE.md`
- Modify: `package.json`（新增依赖，以及脚本 `"geo": "node scripts/build-geo.ts"`）、`.gitignore`（加上 `.cache/`）
- Test: `tests/unit/geoData.test.ts`

**Interfaces:**
- Produces:
  - `normalizeName(s: string): string`：依次做 NFKC → 转小写 → NFD 后去掉附加符号（`\p{M}`）→ 只保留 `\p{L}\p{N}`。
  - `nameKeys(s: string): string[]`：返回 `normalizeName(s)`；如果 `s` 含有汉字，再加上去掉一个结尾后缀后的形式。后缀按以下顺序尝试：`特别行政区`、`维吾尔自治区`、`壮族自治区`、`回族自治区`、`自治区`、`自治州`、`地区`、`省`、`市`、`都`、`府`、`县`。去掉后缀后至少要剩 2 个字才算数。结果去重。**不去掉「州」**，否则杭州、广州会被误伤。
  - `src/generated/geo/places.json` 的结构是 `{ version: 1, source: string, countries: [iso2, lon, lat, keys][], regions: [iso2, lon, lat, keys][], cities: [iso2, lon, lat, keys, pop][] }`：
    - `keys` 是这一行所有名字经 `nameKeys` 展开、去重后用 `|` 连接的字符串；
    - 经纬度保留两位小数；
    - 每张表都按 iso2、再按第一个 key 排序，保证输出是确定的。
  - `src/generated/geo/landMask.ts` 导出 `LAND_MASK: { width: 720; height: 360; bits: string }`：
    - `bits` 是 base64 编码的位图，行优先存储，每个格子 0.5°；
    - 第 0 行是最北的一行（格子中心纬度 89.75），第 0 列的格子中心经度是 −179.75；
    - 第 i 个格子存在第 `i >> 3` 个字节的第 `7 - (i & 7)` 位。
  - `isLand(lon: number, lat: number): boolean`：经度先折回到 [−180, 180)，纬度夹到 [−90, 90]，再查 `LAND_MASK`。

- [ ] **Step 1:** 安装依赖：`npm i d3-geo@^3.1`，`npm i -D @types/d3-geo topojson-client@^3.1 @types/topojson-client world-atlas@^2.0`。
- [ ] **Step 2:** 写失败的测试 `tests/unit/geoData.test.ts`：
  - `normalizeName('São Paulo') === 'saopaulo'`、`normalizeName('Frankfurt am Main') === 'frankfurtammain'`、`normalizeName(' 上海 ') === '上海'`；
  - `nameKeys('上海市')` 包含 `'上海'`；`nameKeys('新疆维吾尔自治区')` 包含 `'新疆'`；`nameKeys('东京都')` 包含 `'东京'`；`nameKeys('杭州')` 严格等于 `['杭州']`；
  - `isLand(121.47, 31.23)`（上海）、`isLand(116.4, 39.9)`（北京）、`isLand(10, 50)`（德国）、`isLand(121.47 + 360, 31.23)`（经度折回）都为 true；`isLand(-150, 0)`（太平洋中部）、`isLand(0, 0)`（几内亚湾）都为 false；
  - `places.json` 的文件内容经 `zlib.gzipSync` 压缩后不超过 `150 * 1024` 字节；`cities.length >= 3000`；
  - 存在 iso2 为 `'CN'`、keys 含 `'上海'` 的城市；存在 iso2 为 `'US'`、keys 含 `'洛杉矶'` 的城市；
  - `countries` 中 iso2 为 `'CN'` 的那一行，keys 含 `'中国'`；`regions` 中存在 iso2 为 `'CN'`、keys 含 `'广东'` 的行。
- [ ] **Step 3:** 运行 `npx vitest run tests/unit/geoData.test.ts`。Expected：FAIL。
- [ ] **Step 4:** 实现 `normalize.ts` 和 `src/domain/geo/landMask.ts`。
- [ ] **Step 5:** 实现 `scripts/build-geo.ts`：
  - **数据下载：**从 `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/` 下载 `ne_10m_populated_places.geojson`、`ne_10m_admin_1_states_provinces.geojson`、`ne_50m_admin_0_countries.geojson` 三个文件，缓存到 `.cache/natural-earth/`，已经存在就不再下载。陆地数据用 `world-atlas/land-110m.json`，经 `topojson-client` 的 `feature` 转换。
  - **countries：**取 admin-0 的每一行。
    - iso2 取 `ISO_A2_EH`，值为 `-99` 的跳过；同一个 iso2 出现多次时，保留 `POP_EST` 最大的那一行。
    - 坐标取 `LABEL_X` / `LABEL_Y`。
    - 名字取 `NAME`、`NAME_EN`、`NAME_LONG`、`ADMIN`、`NAME_ZH`、`NAME_ZHT`，再加上下面的别名表（原样写进脚本）：
      `CN: 中国、中国大陆；TW: 台湾、中国台湾、台湾省；HK: 中国香港；MO: 中国澳门；KR: 韩国、南韩；KP: 朝鲜、北韩；US: 美国、United States；GB: 英国；RU: 俄罗斯`
  - **regions：**取 admin-1 中 `iso_a2` 属于 `CN US CA AU JP KR DE GB FR RU IN BR` 的行。坐标取 `longitude` / `latitude`；名字取 `name`、`name_en`、`name_zh`、`name_zht`，以及按 `|` 拆开的 `name_alt`。
  - **cities：**取 populated places 中满足以下任一条件的行：`ISO_A2 === 'CN'`、`POP_MAX >= 100000`、`ADM0CAP === 1`、`WORLDCITY === 1`。
    - 坐标取 `LONGITUDE` / `LATITUDE`；
    - 名字取 `NAME`、`NAMEASCII`、`NAME_EN`、`NAME_ZH`、`NAME_ZHT`，以及按 `|` 拆开的 `NAMEALT`；
    - pop 取 `POP_MAX`。
  - **陆地点阵：**对每个格子的中心点，用 `d3.geoContains` 判断它是否在陆地上。要先用每个多边形的 `d3.geoBounds` 做过滤，只对包围盒包含这个点的多边形做精确判断，否则要跑几分钟。
  - **结束时：**打印每个输出文件的字节数和 gzip 后的字节数。`places.json` gzip 后超过 150KB 时，以非 0 退出码结束。
  - **`SOURCE.md`：**写明数据版本、下载地址、「Natural Earth 是公有领域数据」、world-atlas 的许可证（ISC），以及重新生成的命令 `npm run geo`。
- [ ] **Step 6:** 运行 `npm run geo`，然后运行 `npx vitest run tests/unit/geoData.test.ts && npm run typecheck`。Expected：生成文件，测试 PASS。
- [ ] **Step 7:** 提交：`git add -A scripts src/domain/geo src/generated/geo tests/unit/geoData.test.ts package.json package-lock.json .gitignore && git commit -m "feat(geo): bundled place table and land mask from natural earth"`。

### Task 2: 位置解析（名称 → 坐标）

**Files:**
- Create: `src/domain/geo/resolve.ts`
- Test: `tests/unit/resolvePlace.test.ts`

**Interfaces:**
- Consumes：Task 1 的 `nameKeys` 和 `places.json`；`GeoText`（来自 `src/api/types.ts`）。
- Produces:
```ts
export type PlaceLevel = 'city' | 'region' | 'country'
export type ResolvedPlace =
  | { kind: 'local' }
  | { kind: 'unlocated' }
  | { kind: 'place'; key: string; level: PlaceLevel; iso2: string; lon: number; lat: number }
export function resolvePlace(geo: GeoText | null | undefined): ResolvedPlace
```
  `key` 的形式是 `city:CN:<行号>`、`region:US:<行号>` 或 `country:DE`。对同一份 `places.json`，同一个地点的 key 是稳定的。

**匹配规则**（索引只建一次，然后缓存起来）：
1. `geo` 为空 → unlocated。`country` 归一化后等于「本地网络」→ local。`country` 为空或者是「海外」→ unlocated。
2. `country` 的任一 `nameKeys` 命中国家表 → 得到 iso2；一个都没命中 → unlocated。
3. 有 `city` 时：
   - 先在这个 iso2 的城市里，精确匹配 city 的任一 key；匹配到多条时，取 pop 最大的。
   - 精确匹配不到，并且 city 含汉字时，找这个 iso2 中「某个 key 以 city 的某个 key 结尾」的城市，多条时取 pop 最大的。例如「法兰克福」能匹配到「美因河畔法兰克福」。
4. 有 `region` 时：按英文逗号拆开，依次在这个 iso2 的省/州表里做精确匹配。
5. 以上都没有命中 → 返回国家中心点（level 为 `'country'`）。

无论输入是什么都不会抛错。

- [ ] **Step 1:** 写失败的测试 `tests/unit/resolvePlace.test.ts`，用 `toMatchObject` 做断言，经纬度允许 ±0.5 的误差（除非另有说明）：
  - `{country:'中国', region:'上海', city:'上海'}` → `kind 'place'`、`level 'city'`、`iso2 'CN'`，经纬度约为 (121.4, 31.2)；
  - `{country:'中国', region:'广东', city:'深圳'}` → city，lon ≈ 114.1；
  - `{country:'中国'}` → country `CN`，lon 在 100 到 110 之间；
  - `{country:'中国', region:'广东省'}` → region `CN`，lon ≈ 113.7；
  - `{country:'中国', region:'浙江', city:'台州'}` → region（台州不在表里，退回到浙江）；
  - `{country:'美国', region:'加利福尼亚州', city:'洛杉矶'}` → city `US`，lon ≈ −118.2（不能匹配成智利的洛桑赫莱斯）；
  - `{country:'德国', region:'黑森', city:'法兰克福'}` → city `DE`，lon ≈ 8.7，误差 ±0.3（是美因河畔法兰克福，不是经度约 14.5 的奥得河畔法兰克福）；
  - `{country:'United States', region:'Virginia', city:'Ashburn'}` → region `US`，lon ≈ −78.2，误差 ±1.5；
  - `{country:'英国', region:'英格兰,大伦敦', city:'伦敦'}` → city `GB`；
  - `{country:'日本', region:'东京都', city:'东京'}` → city `JP`；
  - `{country:'香港', city:'香港'}` → `kind 'place'`、`iso2 'HK'`；
  - `{country:'本地网络', city:null, region:null}` → `{kind:'local'}`；
  - `{country:'海外'}`、`{country:''}`、`null`、`{country:'火星', city:'奥林匹斯'}` → 都是 `{kind:'unlocated'}`；
  - 同一个输入解析两次，得到的 `key` 相同。
- [ ] **Step 2:** 运行 `npx vitest run tests/unit/resolvePlace.test.ts`。Expected：FAIL。
- [ ] **Step 3:** 实现 `resolve.ts`。
- [ ] **Step 4:** 运行同一条命令。Expected：PASS。
- [ ] **Step 5:** 提交：`git commit -m "feat(geo): resolve geoip text to coordinates"`（新文件要先 `git add`）。

### Task 3: 离线设备的位置缓存

**Files:**
- Create: `src/lib/locationCache.ts`
- Modify: `src/domain/devices.ts`、`src/stores/inventory.ts`、`src/domain/deviceFilter.ts`、`src/pages/DevicesPage.vue`、`src/components/devices/DeviceFilters.vue`、`src/components/devices/DeviceRow.vue`、`src/components/devices/DeviceCard.vue`、`src/i18n/zh-CN.ts`、`src/i18n/en.ts`
- Test: `tests/unit/locationCache.test.ts`、`tests/unit/devices.test.ts`、`tests/unit/deviceFilter.test.ts`、`tests/unit/inventory.test.ts`、`tests/e2e/devices.spec.ts`

**Interfaces:**
- Produces:
```ts
export interface CachedLocation { geo: GeoText; at: number }     // at：写入时间，epoch 毫秒
export type LocationCache = Record<string, CachedLocation>       // 键是 machine id
export const LOCATION_CACHE_MAX = 1000
export const LOCATION_CACHE_TTL_MS = 180 * 86_400_000
export const LOCATION_REFRESH_MS = 86_400_000
export function locationCacheKey(username: string): string      // `et.locations.${username}`
export function loadLocationCache(username: string): LocationCache
export function saveLocationCache(username: string, cache: LocationCache): void
export function mergeLiveLocations(cache: LocationCache, machines: RawMachine[], now: number): { cache: LocationCache; changed: boolean }
```
- `DeviceView` 新增两个字段：
  - `knownLocation: GeoText | null`：有实时 location 时用实时的，否则用缓存的；
  - `locationCached: boolean`：`knownLocation` 来自缓存时为 true。

  原有的 `location` 字段含义不变，仍然只表示实时位置。现有测试里直接构造 `DeviceView` 对象的辅助函数，要补上这两个字段。
- `buildDeviceViews(machines, networks, membersByNetwork, cached: LocationCache = {})`。
- inventory store 新增 `cachedLocations: Ref<LocationCache>`。
- `filterDevices(ds, { query, status, city?: string | string[] | null })`。
- 新增 i18n 文案：`devices.cityChipMany: '位置：{city} 等 {n} 地'`、`devices.cachedLocation: '最后在线时的位置'`。

**规则：**
- **读取：**以下情况都返回 `{}`，不抛错：没有这一项、JSON 损坏、结构不对、读 localStorage 时抛错。**保存：**吞掉所有异常（比如超出存储配额）。
- **合并：**
  - 只处理满足以下全部条件的机器：`online === true`；有 machine id（`uuidToStr(info.machine_id)` 不为空）；有 location。
  - 比较 country、region、city 三项（空值统一当作 null）。和已有记录不同，或者已有记录的 `at` 早于 `now − LOCATION_REFRESH_MS` 时，写入 `{geo, at: now}`。
  - 然后删掉 `at < now − LOCATION_CACHE_TTL_MS` 的条目。超过 `LOCATION_CACHE_MAX` 条时，按 `at` 只保留最新的这么多条。
  - 返回一个新对象，不修改传入的对象；`changed` 表示是否有变化。
- **inventory store：**
  - 每次刷新成功后，如果 `session.username` 不为空：第一次（或者用户名变了）先调用 `loadLocationCache`；然后合并；有变化时保存，并更新 `cachedLocations`。
  - `reset()` 清空内存中的缓存，但不删除 localStorage。
  - `devices` 这个 computed 把 `cachedLocations` 传给 `buildDeviceViews`。
- **设备列表：**
  - `?city=` 可以出现多次（这时 `route.query.city` 是数组）。设备的 `locationText(d.knownLocation)` 等于其中任何一个值，就算匹配。搜索也用 `knownLocation` 的文本。
  - 筛选标签：只有一个值时显示「位置：{city}」；有多个值时显示「位置：{第一个} 等 {n} 地」。点 × 去掉全部位置筛选。
- **位置列：**DeviceRow 和 DeviceCard 显示 `locationText(knownLocation)`。位置来自缓存时，文字用 `text-muted-soft`，`title` 设为「最后在线时的位置」。

- [ ] **Step 1:** 写失败的测试：
  - `locationCache.test.ts`：
    - localStorage 里是损坏的 JSON 时，读取结果是 `{}`；
    - 合并会加入在线、有 id、有位置的机器；会跳过离线的、没有 id 的、没有位置的机器；
    - 位置没变且距上次写入不到一天时，`changed` 为 false；超过一天时 `at` 被更新；
    - 超过 TTL 的条目被删除；1001 条时只保留最新的 1000 条；
    - 传入的对象没有被修改。
  - `devices.test.ts`：
    - 离线设备有缓存时，`knownLocation` 等于缓存的 geo，`locationCached` 为 true，`location` 为 null；
    - 在线设备有实时位置时，即使缓存里是另一个值，`knownLocation` 也用实时的，`locationCached` 为 false。
  - `deviceFilter.test.ts`：`city` 传数组时，匹配其中任一值的设备都保留；离线设备能通过 `knownLocation` 被匹配到。
  - `inventory.test.ts`：
    - 刷新之后，`localStorage['et.locations.admin']` 里有 core1 的 machine id（fixture 里的机器都在线，位置是「本地网络」）；
    - 调用 `reset()` 之后，`cachedLocations` 变成 `{}`，localStorage 里的内容还在。
  - `devices.spec.ts`（e2e）：
    - 用 `addInitScript` 写入 `et.locations.admin`，内容是 `{<core2 的 id>: {geo: {country:'中国', region:'浙江', city:'杭州'}, at: Date.now()}}`；
    - 用 override 把 `/machines` 里的 core2 改成 `online: false`，并删掉它的 location；
    - 打开 `/#/devices?city=杭州&city=上海`：列表只有 core2 一行；筛选标签的文字是「位置：杭州 等 2 地」；core2 的位置格显示「杭州」，`title` 为「最后在线时的位置」。
- [ ] **Step 2:** 运行 `npx vitest run tests/unit/locationCache.test.ts tests/unit/devices.test.ts tests/unit/deviceFilter.test.ts tests/unit/inventory.test.ts`。Expected：FAIL。
- [ ] **Step 3:** 实现上述改动。
- [ ] **Step 4:** 运行 `npm test && npm run typecheck && npx playwright test tests/e2e/devices.spec.ts`。Expected：全部 PASS，包括原有的 `?city=` 测试。
- [ ] **Step 5:** 提交：`git commit -am "feat: cache last known device locations for offline devices"`（新文件要先 `git add`）。

### Task 4: 地图的分组、自动聚焦和屏幕布局（纯函数）

**Files:**
- Create: `src/domain/geo/groups.ts`、`src/domain/geo/focus.ts`、`src/domain/geo/layout.ts`
- Test: `tests/unit/geoGroups.test.ts`、`tests/unit/geoFocus.test.ts`、`tests/unit/geoLayout.test.ts`

**Interfaces:**
- Consumes：Task 2 的 `resolvePlace` 和 `PlaceLevel`；Task 3 的 `DeviceView.knownLocation`；`locationText`（来自 `src/domain/format.ts`）；`d3-geo` 的 `geoDistance`。
- Produces:
```ts
// groups.ts
export interface LocationGroup { key: string; label: string; level: PlaceLevel; lon: number; lat: number; devices: DeviceView[]; online: number; total: number }
export interface DeviceBucket { devices: DeviceView[]; online: number; total: number }
export interface LocationSummary {
  groups: LocationGroup[]
  local: DeviceBucket
  unlocated: DeviceBucket
  countryOnly: boolean
  groupOf: Record<string, string>          // 设备 id → 所在组的 key
}
export function summarizeLocations(devices: DeviceView[]): LocationSummary

// focus.ts
export const FOCUS_RADIUS_KM = 3000
export const FOCUS_MIN_SHARE = 0.6
export const FOCUS_MIN_SPAN = { lon: 20, lat: 12 }
export const MAP_LAT_RANGE: readonly [number, number] = [-56, 78]
export interface FocusBox { dLonMin: number; dLonMax: number; latMin: number; latMax: number }   // dLon：相对 centerLon 的经度差，范围 [-180, 180]
export interface MapFocus { centerLon: number; box: FocusBox | null }
export function computeFocus(groups: Pick<LocationGroup, 'lon' | 'lat' | 'total'>[]): MapFocus

// layout.ts
export interface ScreenPoint { key: string; label: string; x: number; y: number; total: number; online: number }
export interface MapCluster { id: string; x: number; y: number; r: number; total: number; online: number; keys: string[]; labels: string[] }
export interface EdgeChip { side: 'left' | 'right' | 'top' | 'bottom'; pos: number; total: number; keys: string[]; labels: string[] }
export interface MapArc { from: string; to: string; d: string; dashed: boolean }
export function dotRadius(total: number): number
export function clusterPoints(points: ScreenPoint[]): MapCluster[]
export function edgeChips(outside: ScreenPoint[], size: { width: number; height: number }): EdgeChip[]
export function buildArcs(clusters: MapCluster[], pairs: { a: string; b: string; direct: boolean }[], groupOf: Record<string, string>): MapArc[]
```

**规则：**
- **`summarizeLocations`：**
  - 对每台设备调用 `resolvePlace(d.knownLocation)`：结果是 local 或 unlocated 的，放进对应的桶；结果是 place 的，按 key 分组。
  - `group.label`：组内各设备 `locationText(knownLocation)` 中出现次数最多的那个文本；次数相同时，取排序后第一台设备的文本。
  - 组内设备排序：在线的在前，再按名字（zh-CN）。
  - `groups` 排序：先按 total 降序，再按 online 降序，最后按 label（zh-CN）。
  - `countryOnly`：至少有一个组，并且所有被定位设备的 `knownLocation` 都既没有 city 也没有 region。
- **`computeFocus`：**
  - 没有任何组 → 返回 `{ centerLon: 0, box: null }`。
  - `centerLon`：各组经度按 total 加权的圆周平均值（`atan2(Σw·sin, Σw·cos)`），四舍五入到 5° 的整数倍。
  - **核心组：**
    - 中心 c = （未取整的圆周平均经度，加权平均纬度）。
    - 核心组是满足 `geoDistance(c, g) × 6371 ≤ FOCUS_RADIUS_KM` 的组。
    - 核心组的设备数占已定位设备的比例小于 `FOCUS_MIN_SHARE` 时，把 c 换成 total 最大的那个组的坐标，再算一次。
    - 仍然小于 → `box = null`。
  - **box：**
    - 取核心组的 dLon（`g.lon − centerLon`，折回到 [−180, 180]）和纬度，各自的最小值和最大值。
    - 跨度不足 `FOCUS_MIN_SPAN` 时，以中点为中心扩展到 20° × 12°。
    - 纬度夹到 `MAP_LAT_RANGE`。
    - 经度跨度 ≥ 200° 时，`box = null`。
- **`dotRadius(n)`：**`n ≤ 1` 时为 4.5；否则为 `4.5·√n`，并夹到 [8, 22]。
- **`clusterPoints`：**
  - 先按 total 降序、再按 label 升序，依次处理每个点。
  - 如果这个点和某个已有簇的锚点距离小于 `dotRadius(簇当前的 total) + dotRadius(p.total) + 4`，就并入第一个这样的簇：锚点位置不变，keys 和 labels 追加，total 和 online 累加。否则新建一个簇。
  - 簇的 id 等于它的第一个 key；全部处理完后，按最终的 total 计算 r。
- **`edgeChips`：**
  - 从视图中心 (w/2, h/2) 向这个点画一条射线，射线先碰到视图的哪条边，side 就是哪条边。
  - `pos` 是交点在这条边上的坐标（左边和右边取 y，上边和下边取 x），夹到 [20, 边长 − 20]。
  - 同一条边上按 pos 排序，相邻两个的 pos 相差小于 28 时合并：pos 取前一个的，total 累加，labels 和 keys 追加。
- **`buildArcs`：**
  - 对每个设备对，先通过 `groupOf` 找到两端所在的组，再找到包含这些组的簇。任一端找不到，或者两端在同一个簇里，就跳过。
  - 按无序的簇对，分别累计直连数和中继数；`dashed = 中继数 ≥ 直连数`。
  - 路径写成 `M x1 y1 Q cx cy x2 y2`。控制点 = 两点中点 + 沿垂直方向偏移「0.2 × 两点距离」，偏移方向取 y 变小（向上）的一侧。坐标保留 1 位小数。

- [ ] **Step 1:** 写失败的测试：
  - `geoGroups.test.ts`：
    - 输入 3 台「中国/上海/上海」的设备（2 台在线，1 台离线、位置来自缓存）、1 台「本地网络」、1 台「海外」、1 台离线且没有缓存 → `groups[0]` 的 label 是「上海」，total 为 3、online 为 2；`local.total` 为 1；`unlocated.total` 为 2；`groupOf` 包含这 3 台上海设备。
    - label 取多数；groups 排序正确；所有设备都是 `{country:'中国'}` 时 `countryOnly` 为 true，只要有一台带 city 就为 false。
  - `geoFocus.test.ts`，用 mockup 的数据集测试：上海 7 台 (121.47, 31.23)、南京 3 台 (118.78, 32.06)、北京 2 台 (116.39, 39.91)、香港 2 台 (114.18, 22.31)、深圳 1 台 (114.12, 22.55)、东京 1 台 (139.69, 35.69)、洛杉矶 1 台 (−118.24, 34.05)、法兰克福 1 台 (8.68, 50.11)：
    - `centerLon === 120`；
    - box 的 dLon 范围包含东京（+19.69）和香港（−5.82），不包含洛杉矶和法兰克福。
  - `geoFocus.test.ts`，其他情况：
    - 只有一个组（中国中心点 (104.2, 35.9)，total 5）→ box 的跨度正好是 20 × 12，以这个点为中心；
    - 上海和洛杉矶各 1 台 → `box === null`；
    - 空数组 → `{ centerLon: 0, box: null }`；
    - 跨越 180° 经线的两个组（斐济 (178, −18)、萨摩亚 (−172, −14)）→ dLon 是连续的，box 跨度为最小跨度 20°，而不是 340°。
  - `geoLayout.test.ts`：
    - `dotRadius`：1 → 4.5，2 → 8，10 → 约 14.23，100 → 22；
    - `clusterPoints`：两个点相距 6px（total 分别为 2 和 1）→ 合成一个簇，total 为 3，labels 是 `[大的, 小的]`，锚点在大的那个点上；相距 60px → 两个簇；
    - `edgeChips`：视图尺寸 800×400。(1200, 180) → side 为 right，pos ≈ 190（射线和右边交在 y = 190）；(−300, 200) → left，pos 200；两个右边的点，pos 分别是 180 和 195 → 合成一个标签，total 相加；
    - `buildArcs`：
      - 簇 A 和 B 之间有一个直连对、一个中继对 → 虚线；
      - 簇 A 和 C 之间有两个直连对、一个中继对 → 实线；
      - 两端在同一个簇里的设备对 → 不画线；
      - `d` 以 `M` 开头并且包含 `Q`，控制点的 y 小于两点中点的 y。
- [ ] **Step 2:** 运行 `npx vitest run tests/unit/geoGroups.test.ts tests/unit/geoFocus.test.ts tests/unit/geoLayout.test.ts`。Expected：FAIL。
- [ ] **Step 3:** 实现这三个文件。
- [ ] **Step 4:** 运行同一条命令。Expected：PASS。
- [ ] **Step 5:** 提交：`git commit -m "feat(geo): location groups, auto focus and map layout"`（新文件要先 `git add`）。

### Task 5: 设备对统计与共享的运行时 store

**Files:**
- Create: `src/stores/runtime.ts`
- Modify: `src/domain/connections.ts`、`src/composables/useDeviceRuntime.ts`、`src/router.ts`、`src/components/shell/UserMenu.vue`
- Test: `tests/unit/connections.test.ts`、`tests/unit/runtime.test.ts`、`tests/unit/useDeviceRuntime.test.ts`

**Interfaces:**
- Consumes：`classifyPeers`、`infraLabelFor`、`PeerLink`、`LinkMode`（`src/domain/connections.ts`）；`nodeRoutes`、`nodePeers`（`src/api/client.ts`）；inventory store 的 `membersByNetwork`、`temporaryByNetwork`、`networks`、`devices`、`deviceById`、`loaded`；session 的 `webhookMode`。
- Produces:
```ts
// connections.ts
export interface DevicePair { networkId: string; a: string; b: string; direct: boolean; mode: LinkMode; latencyMs: number | null }
export function buildPairs(linksByNetwork: Record<string, Record<string, PeerLink[]>>): DevicePair[]
export function summarizePairs(pairs: DevicePair[]): { direct: number; relayed: number; rate: number | null }
// pairStats(linksByDevice) 的签名不变，改为 summarizePairs(buildPairs({ '': linksByDevice }))

// stores/runtime.ts
export const FLEET_POLL_MS = 15_000
export interface RuntimeEntry { routes: NodeRouteInfo[]; peers: NodePeerInfo[]; fetchedAt: number }
export const useRuntime: StoreDefinition   // setup store，暴露下面这些成员
//   entries: Ref<Record<string, RuntimeEntry>>
//   errors: Ref<Record<string, string>>
//   fleetLoaded: Ref<boolean>
//   runtimeKey(deviceId: string, networkId: string): string
//   fetch(deviceId: string, networkId: string): Promise<void>
//   clearError(deviceId: string, networkId: string): void
//   linksFor(deviceId: string, networkId: string): PeerLink[] | null
//   fleetTargets: ComputedRef<{ deviceId: string; networkId: string }[]>
//   refreshFleet(): Promise<void>
//   fleetLinks: ComputedRef<Record<string, Record<string, PeerLink[]>>>   // 网络 id → 设备 id → links
//   pairs: ComputedRef<DevicePair[]>
//   stats: ComputedRef<{ direct: number; relayed: number; rate: number | null }>
//   reset(): void
```

**规则：**
- **`buildPairs`：**
  - 对每个网络里的每个报告方设备，只取 `kind === 'member'`、`deviceId` 不为空、并且不等于报告方自己的 link。
  - 按无序的（networkId, 两端设备 id）归并成设备对；`direct` = 任一报告是 p2p。
  - **代表报告：**direct 为真时从 p2p 报告里选，否则从中继报告里选；选 `latencyMs` 最小的非空值。都为空，或者延迟相同时，选报告方 id 按字典序最小的。
  - `a` 是代表报告的报告方，`b` 是对端，`mode` 和 `latencyMs` 都来自代表报告。
  - 输出按 networkId、a、b 排序。
- **`fetch`：**
  - 同一个 key 同一时刻只有一个请求在执行（single-flight），内部并行调用 `nodeRoutes` 和 `nodePeers`。
  - 成功时写入 `entries[key]`（`fetchedAt = Date.now()`），并删除 `errors[key]`。
  - 失败时写入 `errors[key] = message`，保留旧的 entry。
  - 永远不 reject。
  - `reset()` 之后，在此之前发出的请求，结果一律丢弃（和 inventory 一样用 generation 计数）。
- **`linksFor`：**没有 entry 时返回 null。否则用 inventory 里该网络的 members、`temporaryByNetwork`、设备名（`inventory.devices` 的 name）和 `infraLabelFor(networking_method)` 调用 `classifyPeers`，结果和现在的 `useDeviceRuntime` 一致。
- **`fleetTargets`：**inventory 每个网络里 `online === true` 的成员，并且 `inventory.deviceById(device_id)` 存在、不是 pending。webhook 模式下为空。
- **`refreshFleet`：**
  - `inventory.loaded` 为 false 时直接返回，不改变 `fleetLoaded`。
  - single-flight；对每个 target 调用 `fetch`，并发由 proxy-rpc 的限流器控制。
  - 全部结束后，把 `fleetLoaded` 设为 true（无论成功还是失败）。
- **`fleetLinks`：**只包含当前 targets 中「有 entry 并且没有 error」的。`pairs = buildPairs(fleetLinks)`，`stats = summarizePairs(pairs)`。
- **`useDeviceRuntime`：**
  - 函数签名和对外行为都不变，现有测试不修改也要通过。
  - 内部改为：轮询时调用 `runtime.fetch`；设备在线并且有网络时，`links = runtime.linksFor(dev, net)`，否则为 null；`error = runtime.errors[key] ?? null`；`retry()` 先调用 `clearError`，再重启轮询。
  - 这样从概览页进入设备详情时，连接表会直接显示 store 里已有的数据。
- **reset：**401 处理和退出登录时，调用 `useRuntime().reset()`。

- [ ] **Step 1:** 写失败的测试：
  - `connections.test.ts`：
    - A→B 报告 p2p 2ms，B→A 报告 p2p 3ms → 只有一对，direct，延迟 2，`a = A`；
    - A→B 报告中继 40ms，B→A 报告 p2p 5ms → direct，延迟 5，`a = B`；
    - 基础设施节点和临时节点不计入；
    - 同一对设备在两个网络里 → 两对；
    - `summarizePairs` 的计数和比例正确；
    - 原有的 `pairStats` 测试保持不变。
  - `runtime.test.ts`（mock `src/api/client`，inventory 用 fixtures 刷新一次）：
    - `refreshFleet` 对 3 个在线成员各调用一次 `nodeRoutes` 和 `nodePeers`，共 6 次，`fleetLoaded` 变为 true；
    - 其中一台的 `nodePeers` reject → 这台出现在 `errors` 里，`stats` 由其余设备算出，`fleetLoaded` 仍然为 true；
    - 第一次 `refreshFleet` 还在进行时再调用一次，返回同一个 promise，调用次数不会翻倍；
    - 离线成员不会被拉取；
    - inventory 还没加载时，没有任何调用，`fleetLoaded` 为 false；
    - 请求进行中调用 `reset()`，结果被丢弃，`entries` 为空。
  - `useDeviceRuntime.test.ts`：新增一个测试：store 里已经有 (CORE1, NET) 的 entry 时，挂载后在 `nodeRoutes` resolve 之前，`links` 就已经不为 null。
- [ ] **Step 2:** 运行 `npx vitest run tests/unit/connections.test.ts tests/unit/runtime.test.ts tests/unit/useDeviceRuntime.test.ts`。Expected：新测试 FAIL。
- [ ] **Step 3:** 实现上述改动。
- [ ] **Step 4:** 运行 `npm test && npm run typecheck && npx playwright test tests/e2e/device-detail.spec.ts`。Expected：全部 PASS（设备详情的 e2e 不做任何修改）。
- [ ] **Step 5:** 提交：`git commit -am "feat: shared runtime store with fleet-wide pair statistics"`（新文件要先 `git add`）。

### Task 6: 概览页骨架、统计数字与轮询节奏

**Files:**
- Create: `src/pages/OverviewPage.vue`、`src/components/overview/StatCards.vue`、`src/domain/overview.ts`、`tests/e2e/fleet.ts`、`tests/e2e/overview.spec.ts`、`tests/unit/appShell.test.ts`、`tests/unit/overview.test.ts`
- Modify: `src/composables/usePolling.ts`、`src/components/shell/AppShell.vue`、`src/components/shell/TopNav.vue`、`src/router.ts`、`src/env.d.ts`、`src/domain/format.ts`、`src/pages/LoginPage.vue`、`src/i18n/zh-CN.ts`、`src/i18n/en.ts`、`tests/e2e/auth.spec.ts`、`tests/live/smoke.spec.ts`
- Test: `tests/unit/usePolling.test.ts`、`tests/unit/format.test.ts`

**Interfaces:**
- Consumes：Task 5 的 `useRuntime`（`refreshFleet`、`fleetLoaded`、`stats`）和 `FLEET_POLL_MS`；inventory store 的 `devices`、`networks`、`primaryNetwork`、`loaded`、`error`。
- Produces:
  - `usePolling(fn, intervalMs: number | (() => number))`：每次安排下一轮时，重新读取间隔。
  - `src/env.d.ts` 里用 `declare module 'vue-router'` 给 `RouteMeta` 声明 `public?: boolean; inventoryPollMs?: number`。
  - `overviewStats`：
```ts
export interface OverviewStats { total: number; online: number; offline: number; networks: number; primary: { name: string; cidr: string | null } | null; outdated: number; latest: string | null }
export function overviewStats(devices: DeviceView[], networks: CentralNetworkSummary[], primary: CentralNetworkSummary | null): OverviewStats
```
    `latest` 是所有设备中最高版本的 `x.y.z` 部分；没有可以解析的版本时为 null。
  - `src/domain/format.ts` 新增 `elapsedText(fromIso: string, now: Date, locale: 'zh-CN' | 'en'): string`：分档和 `relativeTime` 相同，但不带「前」字。
    - 中文：「5 分钟」「3 小时」「2 天」「3 周」，不足 1 分钟时为「不到 1 分钟」；
    - 英文：`5 min`、`3 h`、`1 day` / `2 days`、`1 week` / `3 weeks`，不足 1 分钟时为 `under a minute`。
  - `tests/e2e/fleet.ts`：
    - `fleetMock(now = new Date()): { overrides: Overrides; ids: Record<string, string>; networkId: string }`，`ids` 的键是设备名；
    - `fleetLocationCache(ids, now = Date.now()): LocationCache`。

**规则：**
- **路由：**`/`（name 为 `'overview'`）指向懒加载的 OverviewPage（`() => import('./pages/OverviewPage.vue')`），`meta.inventoryPollMs` 设为 `10_000`。删掉现在的 redirect。
- **AppShell：**轮询间隔取 `route.meta.inventoryPollMs ?? 5000`。这个值变化时，执行 `poller.stop(); poller.start()`：立即刷新一次，之后按新的间隔轮询。
- **TopNav：**标签依次为「概览」（`to: '/'`，`route.name === 'overview'` 时高亮）和「设备」。
- **登录后的默认页：**`LoginPage.vue` 中 `safeNext()` 的默认值从 `'/devices'` 改为 `'/'`。同时把 `tests/e2e/auth.spec.ts` 和 `tests/live/smoke.spec.ts` 中「登录后 URL 是 `#/devices`」的断言改为 `#/`（live 测试后面的步骤如果依赖设备列表，先点导航里的「设备」）。
- **OverviewPage：**
  - 页头：`<h1>`「概览」，36px、字重 400、字距 −0.72px；下方一行 14px 的 muted 文字「每 10 秒自动刷新」。
  - 页头下面是 StatCards。
  - 中央模式下：页面挂载后启动 `usePolling(() => runtime.refreshFleet(), FLEET_POLL_MS)`；`inventory.loaded` 变为 true 时，立即调用一次 `runtime.refreshFleet()`。webhook 模式下不启动。
  - 页面不自己轮询设备清单。还没加载完时显示骨架屏；加载失败时显示 EmptyState 和「重试」按钮（和 DevicesPage 的做法相同）。
- **StatCards：**
  - **布局：**一张白色卡片，里面分成 4 格；webhook 模式下只有 2 格（在线设备、可更新）。格之间用 1px 的 hairline 竖线分隔；宽度小于 640px 时排成 2 × 2。每格从上到下是：caption-uppercase 的标签；数值（30px、字重 400、字距 −0.4px，数字用 mono）；13px 的 muted 说明。
  - **在线设备：**数值是 `{online}`，后面跟 muted 的 ` / {total}`；说明是「{n} 台离线」，离线数为 0 时是「全部在线」。
  - **网络：**数值是网络数；说明是「{主网络名} · {cidr}」（cidr 用 mono；没有 cidr 时只显示名字）；没有网络时是「还没有网络」。
  - **P2P 直连率：**
    - `fleetLoaded` 为 false 时，数值显示「—」，说明是「正在读取连接…」；
    - 没有任何设备对时，显示「—」和「暂无成员之间的连接」；
    - 否则数值是 `Math.round(rate × 100)` 加上 `%`，说明是「{total} 条连接中 {relayed} 条走中继」。
  - **可更新：**数值是可更新的台数；说明是「最新版本 {latest}」；没有可以解析的版本时，说明显示「—」。
- **i18n（zh-CN 原文）：**`nav.overview 概览`、`overview.title 概览`、`overview.autoRefresh 每 10 秒自动刷新`、`overview.loadFailed 加载概览失败`、`overview.stats.online 在线设备`、`overview.stats.offline {n} 台离线`、`overview.stats.allOnline 全部在线`、`overview.stats.networks 网络`、`overview.stats.noNetworks 还没有网络`、`overview.stats.direct P2P 直连率`、`overview.stats.directSub {total} 条连接中 {relayed} 条走中继`、`overview.stats.directLoading 正在读取连接…`、`overview.stats.directNone 暂无成员之间的连接`、`overview.stats.outdated 可更新`、`overview.stats.latest 最新版本 {version}`。

**fleet 数据集**（`tests/e2e/fleet.ts`，Task 7 和 Task 8 也会用到）：
- **网络：**一个中央网络。
  - network id 为 `aaaaaaaa-0000-4000-8000-000000000001`，`display_name` 为「家庭网」，`network_name` 为 `home`；
  - `networking_method` 为 `Manual`，`virtual_cidr` 为 `10.144.0.0/24`。
- **设备：**20 台。第 NN 台的 machine id 是 `00000000-0000-4000-8000-0000000000NN`（NN 为两位序号），成员 IP 是 `10.144.0.NN`。

| 序号 | 名称 | 位置（country / region / city） | 在线 | 版本 | 备注 |
|---|---|---|---|---|---|
| 01–07 | router-ax6000、home-nas、macbook-pro、office-pc、sh-dev、sh-pi、old-laptop | 中国 / 上海 / 上海 | old-laptop 离线 3 周零 1 小时，其余在线 | office-pc 为 2.6.4，old-laptop 为 2.5.0，其余为 2.7.1 | sh-pi **不是成员**（还没加入网络）；old-laptop 离线，没有 location |
| 08–10 | nj-server、nj-backup、nj-nuc | 中国 / 江苏 / 南京 | 在线 | 2.7.1 | |
| 11–12 | bj-dev、bj-vps | 中国 / 北京 / 北京 | 在线 | 2.7.1 | |
| 13–14 | hk-vps、hk-mini | 香港 / — / 香港 | 在线 | 2.7.1 | |
| 15 | sz-box | 中国 / 广东 / 深圳 | 在线 | 2.7.1 | |
| 16 | tokyo-relay | 日本 / 东京都 / 东京 | 在线 | 2.7.1 | |
| 17 | la-vps | 美国 / 加利福尼亚州 / 洛杉矶 | 在线 | 2.7.1 | |
| 18 | fra-backup | 离线，没有 location | 离线 2 天零 1 小时 | 2.6.4 | |
| 19–20 | lab-a、lab-b | 本地网络 | 在线 | 2.7.1 | |

- **`fleetLocationCache`：**只包含两台离线设备：old-laptop 为「中国/上海/上海」，fra-backup 为「德国/黑森/法兰克福」。
- **blocked：**一条记录 `unknown-pc`，`attempt_count` 为 5，`last_attempt_time` 为 now 减 10 分钟。
- **proxy-rpc：**处理 `POST /machines/{id}/proxy-rpc` 的 `list_route` 和 `list_peer`，只对在线成员响应。
  - **路由：**每台在线成员能看到其他所有在线成员的路由（peer_id = 1000 + NN，`ipv4_addr.address.addr` 是 10.144.0.NN 的 u32 值），另外还有一个基础设施节点（peer_id 999，hostname `public-server`，不是成员，和每台设备直连）。
  - **直连：**除了下面三对，其余都是直连。直连的设备之间有一条未关闭的 peer conn：
    - `tunnel_type` 按 `(NN_a + NN_b) % 3` 依次取 `udp` / `tcp` / `quic`；
    - `latency_us` 是字符串；
    - 延迟：和 la-vps 之间的连接是 `150 + (对端 NN % 10)` ms，其余是 `5 + |NN_a − NN_b|` ms。所有直连都不超过 160 ms。
  - **中继：**以下三对没有 peer conn；两端报告一致，路由的 `next_hop_peer_id` 都指向中转节点：
    - la-vps ↔ bj-dev：经 hk-vps 中转，`path_latency` 为 186；
    - la-vps ↔ sh-dev：经 hk-vps 中转，`path_latency` 为 170；
    - tokyo-relay ↔ bj-vps：经 public-server（基础设施节点）中转，`path_latency` 为 95。这样聚焦视图里东京和北京之间是一直连一中继，按 Task 4 的规则画成虚线，e2e 能看到中继连线。
- **预期结果：**
  - 17 个在线成员，共 136 对，其中 3 对走中继、133 对直连，直连率显示 98%；
  - 共 20 台设备，18 台在线；
  - 可更新 3 台（office-pc 和 fra-backup 为 2.6.4，old-laptop 为 2.5.0），最新版本为 2.7.1。

- [ ] **Step 1:** 写失败的测试：
  - `usePolling.test.ts`：间隔是一个 getter，第一次返回 1000，之后返回 3000 → 在 fake timers 下，后续的 tick 按 3000 的间隔触发。
  - `appShell.test.ts`：用 memory router 挂载 AppShell，有两个路由：一个设了 `meta.inventoryPollMs: 10_000`，一个没设。用 spy 记录 `inventory.refresh`，用 fake timers 推进时间：在带 meta 的路由上 30 秒内调用 4 次（含开头立即的那次）；切换到另一个路由后，立即调用一次，之后每 5 秒一次。
  - `overview.test.ts`：`overviewStats` 的各项统计正确；`latest` 会去掉 hash（`'2.7.1-0d9c52b1'` → `'2.7.1'`）；可更新数和离线数正确；主网络没有 cidr 时，`primary.cidr` 为 null。
  - `format.test.ts`：`elapsedText` 测「2 天」「3 周」、英文单复数、不足一分钟这几种情况。
  - `overview.spec.ts`（e2e，使用 fleet 数据集）：
    - 打开 `/`：显示 `<h1>` 概览和「每 10 秒自动刷新」；导航里的「概览」有 `aria-current="page"`；先点「设备」，再点 Logo，回到 `/`。
    - 统计卡依次显示：「18」「/ 20」「2 台离线」；「1」「家庭网 · 10.144.0.0/24」；「98%」「136 条连接中 3 条走中继」；「3」「最新版本 2.7.1」。
    - 让 proxy-rpc 的 handler 先挂起：直连率显示「正在读取连接…」；放行后显示「98%」。
    - webhook 模式（`mockApi(page, {}, { webhook: true })`）：只有两格（在线设备、可更新）；页面加载完成后 2 秒内，没有出现任何 proxy-rpc 请求。
- [ ] **Step 2:** 运行 `npx vitest run tests/unit/usePolling.test.ts tests/unit/appShell.test.ts tests/unit/overview.test.ts tests/unit/format.test.ts`。Expected：新测试 FAIL。
- [ ] **Step 3:** 实现上述改动。
- [ ] **Step 4:** 运行 `npm test && npm run typecheck && npx playwright test`。Expected：全部 PASS。
- [ ] **Step 5:** 提交：`git commit -am "feat: overview page with stat cards and route-driven polling"`（新文件要先 `git add`）。

### Task 7: 「需要关注」和「连接质量」

**Files:**
- Create: `src/domain/attention.ts`、`src/composables/useLinkFormat.ts`、`src/components/overview/AttentionList.vue`、`src/components/overview/ConnectionQuality.vue`、`tests/unit/attention.test.ts`
- Modify: `src/components/device-detail/ConnectionsCard.vue`、`src/pages/OverviewPage.vue`、`src/i18n/zh-CN.ts`、`src/i18n/en.ts`
- Test: `tests/e2e/overview.spec.ts`

**Interfaces:**
- Consumes：Task 5 的 `DevicePair`、`useRuntime().pairs` 和 `fleetLoaded`；Task 6 的 `elapsedText` 和 fleet 数据集；`unblockDevice`、`addMembers`（`src/api/client.ts`）；`relativeTime`、`locationText`；`parseVersion`、`compareVersions`。
- Produces:
```ts
export const OFFLINE_ATTENTION_MS = 86_400_000
export type AttentionItem =
  | { kind: 'blocked'; id: string; name: string; attempts: number; lastAttempt: string | null }
  | { kind: 'unjoined'; device: DeviceView }
  | { kind: 'offline'; device: DeviceView; since: string }
  | { kind: 'outdated'; count: number; byVersion: { version: string; names: string[] }[] }
export function buildAttention(i: { devices: DeviceView[]; blocked: BlockedDevice[]; central: boolean; hasPrimary: boolean; now: number }): AttentionItem[]

export function useLinkFormat(): { modeLabel(mode: LinkMode): string; latencyText(ms: number | null): string }
```

**规则：**
- **`buildAttention`：**各类按以下顺序排列：blocked → unjoined → offline → outdated。
  - **blocked：**取 `attempt_count > 0` 的记录（和铃铛的规则相同），按 `last_attempt_time` 降序。name 依次取 alias、hostname、id。
  - **unjoined：**要求 `central && hasPrimary`，设备不是 pending，并且 `defaultNetworkId === null`。在线的在前，再按名字排序。
  - **offline：**设备不在线，`lastSeen` 能解析，并且 `now − lastSeen > 24 小时`。按 `lastSeen` 降序（最近离线的在前）。
  - **outdated：**所有可更新的设备合成一条。`byVersion` 按版本号（x.y.z）降序，每个版本下的 names 按名字排序。
- **`useLinkFormat`：**把 ConnectionsCard 里的 `modeLabel` 和 `latency` 两个函数原样移过来（使用同样的 i18n 键 `detail.connections.*`），ConnectionsCard 改为调用它，行为不变。
- **AttentionList：**
  - **外框：**SectionCard，标题「需要关注 · {n}」。默认只显示前 5 条；超过 5 条时，右上角有「全部 ({n})」按钮，点击后在原地展开，按钮变成「收起」。
  - **每一行：**左侧是 muted 颜色的符号（blocked 用 ⊘、unjoined 用 ＋、offline 用 ○、outdated 用 ↑，都加 `aria-hidden`）；中间是 14px 的标题和 13px 的 muted 说明（单行截断，`title` 是全文）；右侧是操作按钮（secondary、sm）。
  - **blocked 行：**
    - 标题「{name} 被拉黑后仍在尝试连接」，说明「已拉黑 · 共尝试 {n} 次 · 最后 {relativeTime}」；
    - 按钮「解除拉黑」：调用 `unblockDevice(id)`；成功时 toast「已解除拉黑」，然后连续刷新两次 inventory（同 DevicesPage 的 `refreshFresh`）；失败时 toast「解除拉黑失败：{message}」。
  - **unjoined 行：**
    - 标题「{name} 还没加入网络」，说明「系统 · 位置 · 在线」，设备离线时最后一项改成「最后在线 {relativeTime}」；缺少的部分直接省略；
    - 按钮「加入 {主网络名}」：调用 `addMembers(主网络 id, [设备 id])`，提示文案复用 `devices.joined` 和 `devices.joinFailed`。
  - **offline 行：**标题「{name} 已离线 {elapsedText}」，说明「{位置} · 最后 IP {ip}」，缺少的部分省略。标题是指向 `/devices/{id}` 的链接。
  - **outdated 行：**标题「{n} 台设备可更新」；说明对每个版本写「{该版本的设备名，用、连接} {version}」，版本之间用「 · 」连接。
  - 操作进行中时，按钮显示 loading，同一项不能重复点击。
  - 一条都没有时，显示 EmptyState：「一切正常」/「没有需要处理的设备。」
- **ConnectionQuality：**
  - **外框：**SectionCard，标题「连接质量 · 最慢 5 条」，右上角 meta「中继 {relayed} · 直连 {direct}」。
  - **内容：**设备对按 `latencyMs` 降序排列（null 排在最后），取前 5 条。每一行依次是：
    - 两端设备名：名字从 `inventory.deviceById` 取，超长截断；a 是指向 `/devices/{a}/networks/{networkId}` 的链接；
    - `modeLabel`（muted）；
    - `latencyText`（mono，右对齐）。
  - **加载与空状态：**`fleetLoaded` 为 false 时，显示 5 行 SkeletonRows；没有任何设备对时，显示 EmptyState「暂无成员之间的连接」。
  - webhook 模式下不渲染这个组件，「需要关注」占满整行。
- **OverviewPage：**统计卡下方分两栏：宽度 ≥ 1024px 时左右各占一半，否则上下排列。左边是「需要关注」，右边是「连接质量」。地图由 Task 8 插到统计卡和这两栏之间。
- **i18n（zh-CN 原文）：**
  - `overview.attention.*`：`title 需要关注 · {n}`、`all 全部 ({n})`、`collapse 收起`、`empty 一切正常`、`emptyBody 没有需要处理的设备。`、`blocked {name} 被拉黑后仍在尝试连接`、`blockedSub 已拉黑 · 共尝试 {n} 次 · 最后 {time}`、`unblock 解除拉黑`、`unblocked 已解除拉黑`、`unblockFailed 解除拉黑失败：{message}`、`unjoined {name} 还没加入网络`、`lastSeen 最后在线 {time}`、`offline {name} 已离线 {duration}`、`lastIp 最后 IP {ip}`、`outdated {n} 台设备可更新`；
  - `overview.quality.*`：`title 连接质量 · 最慢 5 条`、`meta 中继 {relayed} · 直连 {direct}`、`empty 暂无成员之间的连接`。

- [ ] **Step 1:** 写失败的测试：
  - `attention.test.ts`：
    - 各类的排列顺序正确；
    - `attempt_count` 为 0 的拉黑记录不出现；
    - 非中央模式、没有主网络、设备是 pending 时，不出现 unjoined；
    - 离线 23 小时的不出现，离线 25 小时的出现，`lastSeen` 为 null 的不出现；
    - outdated 的分组和版本排序正确；
    - 什么都没有时返回 `[]`。
  - `overview.spec.ts`（e2e，使用 fleet 数据集）：
    - 标题是「需要关注 · 5」，各行依次为：「unknown-pc 被拉黑后仍在尝试连接」；「sh-pi 还没加入网络」，带「加入 家庭网」按钮；「fra-backup 已离线 2 天」；「old-laptop 已离线 3 周」；「3 台设备可更新」，说明里包含「fra-backup、office-pc 2.6.4」和「old-laptop 2.5.0」（同一版本内按名字排序，版本按降序）。
    - 点「解除拉黑」→ 记录到 `DELETE /blocked-devices/<id>`；点「加入 家庭网」→ 记录到 `POST /networks/<networkId>/members`，body 为 `{ device_ids: [<sh-pi 的 id>], temporary: false }`。
    - 用 override 再加 2 台离线超过一天的设备 → 出现「全部 (7)」，点击后展开为 7 行，再点「收起」回到 5 行。
    - 连接质量的 meta 是「中继 3 · 直连 133」；第一行包含 la-vps 和 bj-dev、「中继 · 经 hk-vps」、「186 ms」；第二行包含 la-vps 和 sh-dev、「170 ms」。
    - webhook 模式：没有连接质量这一栏，也没有「还没加入网络」的行。
- [ ] **Step 2:** 运行 `npx vitest run tests/unit/attention.test.ts`。Expected：FAIL。
- [ ] **Step 3:** 实现上述改动。
- [ ] **Step 4:** 运行 `npm test && npm run typecheck && npx playwright test`。Expected：全部 PASS，现有的设备详情 e2e 不做修改也要通过。
- [ ] **Step 5:** 提交：`git commit -am "feat: overview attention list and connection quality"`（新文件要先 `git add`）。

### Task 8: 节点分布地图与位置排行

**Files:**
- Create: `src/domain/geo/projection.ts`、`src/components/overview/MapSection.vue`、`src/components/overview/NodeMap.vue`、`src/components/overview/MapHoverCard.vue`、`src/components/overview/LocationRanking.vue`、`tests/unit/geoProjection.test.ts`
- Modify: `src/pages/OverviewPage.vue`、`src/i18n/zh-CN.ts`、`src/i18n/en.ts`
- Test: `tests/e2e/overview.spec.ts`

**Interfaces:**
- Consumes：Task 1 的 `isLand`；Task 4 的 `summarizeLocations`、`computeFocus`、`MAP_LAT_RANGE`、`clusterPoints`、`edgeChips`、`buildArcs`、`dotRadius`；Task 5 的 `useRuntime().pairs` 和 `fleetLoaded`；Task 6 的 fleet 数据集和 `fleetLocationCache`。
- Produces:
```ts
export type MapView = 'focus' | 'world'
export interface MapInset { top: number; right: number; bottom: number; left: number }
export const MAP_INSET: MapInset = { top: 28, right: 72, bottom: 28, left: 28 }
export function makeProjection(focus: MapFocus, view: MapView, size: { width: number; height: number }, inset?: MapInset): GeoProjection
export function landDotsPath(projection: GeoProjection, size: { width: number; height: number }, spacing?: number): string   // spacing 默认 7
```

**规则：**
- **`makeProjection`：**
  - 投影是 `geoNaturalEarth1().rotate([-focus.centerLon, 0])`，用 `fitExtent([[left, top], [width − right, height − bottom]], MultiPoint)` 适配到可用区域。
  - 世界视图（或者 `focus.box` 为 null 时）：MultiPoint 是一个网格，dLon 从 −179.9 到 179.9，纬度在 `MAP_LAT_RANGE` 内，每 10° 取一个点。
  - 聚焦视图：MultiPoint 是 box 范围内 5 × 5 的网格，经度 = `centerLon + dLon`。
- **`landDotsPath`：**
  - 从 (spacing/2, spacing/2) 开始，按 spacing 的间距逐个取像素点，用 `projection.invert` 换算成经纬度。
  - `isLand` 为真，并且这个经纬度再投影回去和原像素相差不到 1px 时，输出 `M{x} {y}h0`（坐标保留 1 位小数）。
  - 在 SVG 里用 `stroke="#cfcdc4" stroke-width="2.4" stroke-linecap="round" fill="none"` 绘制。
- **MapSection**（白色卡片）：
  - **头部：**标题「节点分布」（16px、字重 500）。说明「{located} 台已定位 · {local} 台在本地网络」，未定位数大于 0 时，后面再接上「 · {n} 台未定位」。右侧有两个控件：
    - `focus.box` 不为 null 时，显示分段按钮「聚焦 / 世界」（用 `aria-pressed` 表示当前选中的一项）；
    - 中央模式下，并且 `fleetLoaded` 为 true 时，显示「连接线」开关按钮（`aria-pressed`，默认打开）。
  - **主体：**宽度 ≥ 1024px 时，左边是地图（宽度自适应），右边是位置排行（宽 260px）；否则上下排列。
  - **精度提示：**`countryOnly` 为真时，卡片底部显示一行 13px 的 muted 说明：「位置只精确到国家。后端启动时加上 --geoip-db 参数并使用 GeoLite2-City 数据库，可以精确到城市。」其中 `--geoip-db` 用 mono 字体。
- **NodeMap：**
  - **尺寸：**用 ResizeObserver 获取容器宽度。视口宽度 ≥ 640px 时地图高 380px，否则 260px。外层是 `<svg role="img" aria-label="节点分布地图">`。尺寸变化时重新计算，用 `requestAnimationFrame` 把多次变化合并成一次。
  - **默认视图：**`focus.box` 不为 null 时是「聚焦」，否则是「世界」。
  - **投影与分流：**把每个组投影到屏幕上。在视口范围内（允许 4px 误差）的组交给 `clusterPoints`。聚焦视图下，视口外的组交给 `edgeChips`。
  - **边缘标签：**画在视口边上的胶囊按钮，白底、1px `#cfcdc4` 边框、12px 字号。
    - 文字：左边「← {标签} {台数}」，右边「{标签} {台数} →」，上边「↑ {标签} {台数}」，下边「↓ {标签} {台数}」；多个合并时，标签写成「{第一个} 等 {n} 地」。
    - 点击后切换到世界视图。
    - `aria-label` 为「{标签}，{n} 台设备，切换到世界视图」。
  - **簇的外观：**
    - 光晕：半径 r + 4，ink 色、不透明度 8%。
    - 圆点：半径 r；簇内有在线设备时是实心 ink，全部离线时是白底、ink 描边 1.4 的空心圆。
    - 数字：total > 1 时在圆上居中显示，11px、字重 600；实心圆上用 canvas 色，空心圆上用 ink 色。
    - 标签：画在圆的右侧、距圆心 r + 6 处，12px、ink 色，加 3px 白色描边做衬底（`paint-order: stroke`）。只有一个组时显示该组的 label，多个组时显示「{第一个} 等 {n} 地」。
  - **簇的元素：**每个簇是一个 `<g role="button" tabindex="0" data-cluster>`，`aria-label` 为「{标签}，{total} 台设备，{online} 台在线」。全部离线时加上 `data-offline` 属性。
  - **悬停卡片：**鼠标悬停或键盘聚焦在簇上时，显示 MapHoverCard。
    - 位置：绝对定位在圆的右侧；超出容器右边时改放到左侧。
    - 内容：标题行是「{标签}」和「{online}/{total} 在线」；下面最多 6 行设备，每行是 StatusDot、名字（截断）、内网 IP（mono，离线设备的 IP 用 muted-soft）；超过 6 台时，最后一行写「还有 {n} 台 · 点击查看全部」。
    - 鼠标离开、失去焦点或按 Esc 时隐藏。
  - **点击：**点击簇，或者簇有焦点时按 Enter/空格，执行 `router.push({ name: 'devices', query: { city: 簇内各组的 label } })`。
  - **连线：**
    - 同时满足以下条件时绘制：「连接线」开关打开、中央模式、pairs 已加载。
    - 用 `buildArcs(clusters, runtime.pairs, summary.groupOf)` 计算，画在圆点下面。
    - 样式：`fill="none" stroke="#26251e" stroke-opacity="0.38" stroke-width="1.2"`；中继加 `stroke-dasharray="4 4"`。
    - 每条线带 `data-arc` 属性，中继线另外带 `data-relay`。端点在视口外的不画。
    - 开关打开时，左下角显示图例：实线「直连 P2P」、虚线「中继」、空心圆「全部离线」。
  - **空状态**（一个组都没有）：照常画世界点阵，在中间叠一段文字：「还没有可以定位的设备」（14px、ink 色）和「设备的位置来自公网 IP。在本地网络中、或者位置未知的设备不会显示在地图上。」（13px、muted 色）。
- **LocationRanking：**
  - 顶部 caption「按位置 · 在线/总数」。
  - 每个组一行，依次是：label；比例条（宽度 = total ÷ 最大的 total，ink 色、不透明度 70%，高 4px，圆角）；「{online}/{total}」（mono）。
  - 最多显示 8 行，多出的合成一行「其他 {n} 地」（不能点击）。
  - 后面接两行特殊行，数量为 0 时不显示：
    - 本地网络：「本地网络」，后面跟 muted 的「无公网位置」；
    - 未定位：「未定位」。
  - 组的行和本地网络行可以点击，跳到 `/devices?city={label}`；本地网络行的 label 用「本地网络」。
- **OverviewPage：**在统计卡和两栏之间插入 MapSection。数据来自 `summarizeLocations(inventory.devices)`、`computeFocus(summary.groups)` 和 `runtime.pairs`。
- **i18n（zh-CN 原文）：**
  - `overview.map.*`：`title 节点分布`、`meta {located} 台已定位 · {local} 台在本地网络`、`metaUnlocated  · {n} 台未定位`、`focus 聚焦`、`world 世界`、`lines 连接线`、`merged {name} 等 {n} 地`、`clusterLabel {name}，{total} 台设备，{online} 台在线`、`chipLabel {name}，{total} 台设备，切换到世界视图`、`cardOnline {online}/{total} 在线`、`more 还有 {n} 台 · 点击查看全部`、`empty 还没有可以定位的设备`、`emptyBody 设备的位置来自公网 IP。在本地网络中、或者位置未知的设备不会显示在地图上。`、`countryOnly 位置只精确到国家。后端启动时加上 {flag} 参数并使用 GeoLite2-City 数据库，可以精确到城市。`、`legendDirect 直连 P2P`、`legendRelay 中继`、`legendOffline 全部离线`、`label 节点分布地图`；
  - `overview.ranking.*`：`title 按位置 · 在线/总数`、`local 本地网络`、`localSub 无公网位置`、`unlocated 未定位`、`others 其他 {n} 地`。

- [ ] **Step 1:** 写失败的测试 `geoProjection.test.ts`：用 Task 4 测试里的 mockup 数据集计算 `computeFocus`，尺寸取 800×380：
  - 聚焦投影下，上海 (121.47, 31.23) 落在 [28, 728] × [28, 352] 之内，洛杉矶 (−118.24, 34.05) 落在这个范围之外；
  - 世界投影下，两者都在这个范围之内；
  - `landDotsPath(世界投影)` 不为空，并且在太平洋中部 (−150, 0) 的投影点 10px 范围内没有任何点。
- [ ] **Step 2:** 运行 `npx vitest run tests/unit/geoProjection.test.ts`。Expected：FAIL。
- [ ] **Step 3:** 实现 `projection.ts`，以及上面列出的组件。
- [ ] **Step 4:** 在 `overview.spec.ts` 里加 e2e 测试。除第 8、9 条外，都使用 fleet 数据集，并用 `addInitScript` 把 `fleetLocationCache` 写进 `localStorage['et.locations.admin']`；视口为 1280×800：
  1. **聚焦视图：**存在 `aria-label` 以「上海」「南京」「北京」「东京」开头的簇；存在 `aria-label` 为「香港 等 2 地，3 台设备，3 台在线」的簇；有边缘标签「洛杉矶 1 →」（位于地图的右半边）和「← 法兰克福 1」（位于左半边）。
  2. **悬停与跳转：**鼠标悬停在上海的簇上 → 卡片显示「上海」「6/7 在线」、6 行设备和「还有 1 台 · 点击查看全部」。点击这个簇 → URL 变成 `#/devices?city=上海`，设备表有 7 行。
  3. **切到世界视图：**点击「← 法兰克福 1」→「世界」的 `aria-pressed` 为 true；能看到洛杉矶和法兰克福的簇，法兰克福的簇带有 `data-offline`。
  4. **连线：**在聚焦视图下检查（世界视图里东亚的地点会合并，中继在多数规则下被直连盖过）：`[data-arc]` 的数量大于 0，`[data-relay]` 至少有 1 条（东京和北京之间那条）；关掉「连接线」→ `[data-arc]` 数量为 0，图例消失。
  5. **排行：**第一行是「上海」「6/7」；有「本地网络」「2/2」这一行。点击「本地网络」→ 跳到 `?city=本地网络`，列表有 2 行（lab-a、lab-b）。
  6. **头部说明：**显示「18 台已定位 · 2 台在本地网络」。
  7. **无第三方请求：**用 `page.on('request')` 记录访问概览页期间的所有请求，每个 URL 都以应用的 baseURL 的 origin 开头。
  8. **默认 fixtures**（3 台 core，全部是本地网络）：地图显示「还没有可以定位的设备」；没有「聚焦 / 世界」控件；排行有「本地网络」「3/3」；头部说明是「0 台已定位 · 3 台在本地网络」；整个页面的文本里不出现 `NaN`。
  9. **只有国家级位置：**用 override 把所有机器的 location 都改成 `{country:'中国'}` → 只有一个簇，标签是「中国」；精度提示可见，并且包含 `--geoip-db`。
  10. **窄屏：**视口宽 390px 时，`document.documentElement.scrollWidth <= 390`；排行在地图下方（排行的 top 大于地图的 bottom）。
- [ ] **Step 5:** 运行 `npm test && npm run typecheck && npm run build && npx playwright test`。Expected：全部 PASS。另外截两张图（不提交）：1280px 下的聚焦视图，以及悬停在上海簇上时的卡片，和 `.superpowers/brainstorm/48737-1795418816/content/map-layout-v2.html` 里的方案 B 对照。
- [ ] **Step 6:** 提交：`git commit -am "feat: overview node map with auto focus, clusters and location ranking"`（新文件要先 `git add`）。

### Task 9: 对接真实后端的冒烟测试与文档

**Files:**
- Modify: `tests/live/smoke.spec.ts`、`README.md`、`docs/superpowers/plans/2026-11-23-00-roadmap.md`

**Interfaces:**
- Consumes：计划 2 的 live 测试配置（`playwright.live.config.ts`、`tests/live/env.ts`），以及正在运行的 testenv（web v2.7.1 + 3 台 2.6.4 的 core，数据目录 `data-central`）。

- [ ] **Step 1:** 在 `tests/live/smoke.spec.ts` 里加一个测试「overview against the real backend」：
  - 登录后打开 `/`；
  - 统计卡显示「3」和「/ 3」；
  - 40 秒内，直连率变成一个匹配 `/^\d+%$/` 的值；
  - 排行里有「本地网络」「3/3」；地图显示「还没有可以定位的设备」；
  - 页面没有向应用 origin 和 API 以外的地址发请求。
- [ ] **Step 2:** 运行 `npx playwright test -c playwright.live.config.ts`。Expected：PASS（testenv 必须保持运行，不能关掉）。
- [ ] **Step 3:** 在 README 里加「概览页」一节：
  - 概览页显示哪些内容；
  - 位置精度：内置的 GeoIP 库只能定位到国家；要精确到城市，需要从 MaxMind 下载 GeoLite2-City（需要注册免费账号），挂载进容器，并在启动参数里加上 `--geoip-db /app/GeoLite2-City.mmdb`；
  - 数据来源：Natural Earth（公有领域）、world-atlas（ISC）；
  - 用 `npm run geo` 重新生成坐标表。
- [ ] **Step 4:** 路线图第 3 行的状态改为「已完成」，并填上本计划的文件名。
- [ ] **Step 5:** 提交：`git commit -am "test: live overview smoke; docs for overview and geoip precision"`。
