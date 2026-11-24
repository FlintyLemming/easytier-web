REHEARSAL: PASS

# 迁移演练（合成数据）— 2026-11-24

环境：`testenv/data-migrate`（`seed-migration.ts` 播种：office 组 core1..4、core1 上停用的 lab-old），web v2.6.4 → v2.7.1，core1..4 为 v2.6.4。浏览器走 `/migrate` 向导（`tests/live-migrate/migrate.spec.ts`），整体回滚按 spec §8 手工执行。

演练做了两轮。第 1 轮暴露了一个比较规则问题（见下），修正后从干净的升级前状态重做了第 2 轮；结论以第 2 轮为准。

## 第 2 轮（干净的一轮）

### 升级

```sh
ET_DATA_DIR=./data-migrate bash testenv/upgrade.sh v2.6.4 v2.7.1
# backup: testenv/backups/20261124-224211   ← 升级前备份
```

升级后 `GET /networks` 为空；core1 运行 office、停用 lab-old；core2、core3 运行 office；core4 的 office 停用。

### 向导（`npx playwright test -c playwright.migrate.config.ts`，PASS，2.6 分钟）

| 阶段 | 耗时 |
| --- | --- |
| 登录到第 3 步（盘点 4 台设备、网络设置取默认值） | 0.5 秒 |
| 第 4 步：新建网络 + 逐台迁移 core1..3 | 83 秒（每台约 28 秒） |
| 第 5 步：三台校验 | 不到 1 秒 |
| 第 5 步：回滚 core3 | 69 秒 |

- 第 2 步草稿：网络名 `office`、网段 `10.150.0.0/24`、Manual `tcp://core1:11010`、密钥 `office-secret`（组内最常见的值）。
- 第 3 步默认选择：core1..3「迁移」，core4（停用）「暂不迁移」。
- **第 3 类差异**恰好是预期的三条：
  - core1 连接方式：`tcp://core2:11010 → tcp://core1:11010`
  - core1 VPN Portal：`10.14.14.0/24 · 11013 → 关闭（2.6.4 core 的旧版 VPN Portal 不能放进成员覆盖）`
  - core3 ACL：`1 条规则 → 不迁移，需要手动写成中央规则`
  - core2、core4：无
- 第 4 步：导出文件 `easytier-migration-office-20261124-224238.json`；三台「已迁移」。
- 迁移后的后端状态：网络 `office`（`c43a801e-…`）有三个成员，都在运行，固定 IP 分别是 `10.150.0.1/.2/.3`；core2 的 `hostname_override` 是 `core2-office`；core4 不是成员。core1..3 上 office 旧实例已删除；core4 的 office、core1 的 lab-old 都还在。
- 第 5 步校验：三台「一致」。报告顶部显示「这些设备迁移前单独配置了 ACL：core3」和「去写 ACL 规则」。
- 单台回滚 core3：core3 不再是成员；旧实例（实例 id 不变）按迁移记录重建并运行；它的 TOML 去掉末尾的 `[source]` 表后和 `seed-snapshot.json` 逐行相同（44 行）。

### 整体回滚（spec §8）

```sh
ET_DATA_DIR=./data-migrate bash testenv/upgrade.sh v2.7.1 v2.6.4
#   web v2.6.4 起不来（预期）：panic「Migration file of version 'm2026…' is missing」
cd testenv && docker compose stop web
rm data-migrate/et.db* data-migrate/seed-*.json && cp -a backups/20261124-224211/. data-migrate/
ET_DATA_DIR=./data-migrate ET_WEB_TAG=v2.6.4 docker compose up -d web
```

- web v2.6.4 启动后 **7 秒**内，每台 core 的 `running_inst_ids` 恰好是迁移前的旧实例：core1、core2 上的中央实例（网络 `c43a801e-…`）被 2.6.4 web 清掉，迁移时删除的 office 旧实例由 2.6.4 web 按数据库重新运行。**不需要手动清理。**
- `ET_DATA_DIR=./data-migrate node testenv/seed-migration.ts` → `skipped 5 existing`。
- TOML 对比：core1、core2 的 office 和快照**逐字节相同**；core3 的 office 只多了末尾的 `[source] source = "webhook"`（见发现 2）。

## 第 1 轮（暴露的问题）

升级前备份 `testenv/backups/20261124-215939`。向导部分全部通过（迁移 106 秒，回滚 core3 35 秒），只有最后一条断言失败：回滚后重建的 core3 实例 TOML 比快照多了 `[source]` / `source = "webhook"` 两行。

- Ruling：比较前去掉 `[source]` 表（`stripSourceTable`，和 Task 1 的裁决一致）——这是配置来源标记，不是配置内容。去掉后逐行相同。
- 之后做了一次整体回滚：同样 12 秒内恢复旧实例，core3 同样只差 `[source]` 表；`docker compose restart core3` 不能去掉它（见发现 2）。为了第 2 轮能从干净状态开始，按「停 web → 恢复备份 → 重启 core3 → 启动 web 2.6.4」恢复，三台 TOML 和快照逐字节相同、数据库里 5 行来源都是 `user`。

## 发现

1. **2.6.4 web 会清掉中央实例（规划时的假设，已确认）。**整体回滚后第一次心跳，2.6.4 web 删除 core 上「来源是 webhook、但数据库里没有」的实例，v2.7.1 下发的中央实例正是这一类。升级手册不需要写手动清理步骤。
2. **在 v2.7.1 上单台回滚（重建）过的旧实例，整体回滚后会被 2.6.4 记成 webhook 来源。**v2.7.1 web 创建的实例来源是 `ConfigSourceWeb`，2.6.4 的 core 把它显示成 `webhook`。2.6.4 web 第一次心跳时 `sync_running_config_sources` 把 core 上报的来源写回数据库（core3 这一行 `source` 从 `user` 变成 `webhook`，配置本身不变），之后无论怎么重启 core，2.6.4 web 都按 webhook 来源下发它。不启用 webhook 时没有影响（实例照常运行，2.6.4 web 也不会删它，因为数据库里有）。想完全还原：恢复数据库后、启动 2.6.4 web 之前，重启这些设备上的 easytier-core（或停掉实例），让 2.6.4 web 按 `user` 来源重新下发。写进升级手册（Task 9）。
3. **core1 的新节点地址是它自己**（`tcp://core1:11010`）。草稿取组内最常见的地址，而 core1 原来是被 core2、core3 连接的那一台。第 3 步把它列为「连接方式」差异，需要确认；迁移后 core1 成员照常运行、校验一致（core2、core3 仍然连 core1，网络是通的）。生产环境如果有类似的「中心节点」，可以在第 2 步用「使用全部服务器地址」。
4. **从 data-migrate 切回 data-central 时，core 上会留下 data-migrate 的 `user` 来源实例**（v2.7.1 web 不删除数据库里没有的 `user` 来源实例；core3 上那个 webhook 来源的实例被 v2.7.1 清掉了）。切回后重启 core1、core2 即可。已写进 `testenv/README.md`。

## 环境恢复

```sh
cd testenv && docker compose stop web
cp -a backups/20261124-224211/et.db* data-migrate/          # data-migrate 回到升级前（2.6.4）的干净状态
docker compose --profile migrate stop core4
ET_DATA_DIR=./data-central docker compose up -d web          # web v2.7.1
docker compose restart core1 core2                           # 清掉 data-migrate 留下的 office 实例
```

之后 core1..3 只运行 `home-central`；`npx playwright test -c playwright.live.config.ts` → **5 passed**。
