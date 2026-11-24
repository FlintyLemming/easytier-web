# easytier-web 升级手册：v2.6.4 → v2.7.1（生产环境 idc-ucloud）

> **这份手册由用户执行，或者在执行当天得到用户明确同意后执行。**没有当天的明确同意，任何人（包括自动化代理）都不能执行下面的写操作：停止、删除、重命名、启动容器，写数据目录。

| 项目 | 值 |
| --- | --- |
| 主机 | `idc-ucloud` |
| 管理方式 | docker compose：`/home/flintylemming/appdata/11211,22020-easytier-web/compose.yaml`，里面有两个服务 `easytier-web` 和 `easytier-core`（本机的 core，`network_mode: host`） |
| 容器 | `easytier-web`（`entrypoint: easytier-web-embed`，`command: --disable-registration`，`ET_DISABLE_REGISTRATION=true`，`TZ=Asia/Shanghai`，端口 `11211/tcp`、`22020/udp`，`./data:/app`） |
| 数据目录（宿主机） | `/home/flintylemming/appdata/11211,22020-easytier-web/data`（容器内 `/app`；`et.db`、`et.db-wal`、`et.db-shm`，属主 flintylemming） |
| 旧镜像 | compose 里写的是 `mirror-hub.flinty.moe/easytier/easytier:latest`，本机这个 `latest` 是 **2.6.4**：digest `sha256:91d6732ea5ff71542fdb99333d2ee7b168e973443114db84db061e452427d91e`（和上游 `easytier/easytier:v2.6.4` 相同；2026-11-24 只读查看） |
| 新镜像 | `mirror-hub.flinty.moe/easytier/easytier:v2.7.1`（或 `easytier/easytier:v2.7.1`），上游 digest `sha256:24248ca25f55f97fde509af450124b31decd44421403518350c6f4109fb139ef` |
| 主机上的工具 | 没有 `sqlite3`（2026-11-24 只读查看） |

> **不要**在这台主机上执行 `docker compose pull` 或不带服务名的 `docker compose up`：两个服务都用 `:latest`，拉取后 `easytier-core` 也会被换成新版本。下面只操作 `easytier-web` 这一个服务。

下面的命令都在 `idc-ucloud` 上、在 **bash** 里执行（这台主机的登录 shell 是 fish，先输入 `bash`）。先设好变量：

```sh
APP=/home/flintylemming/appdata/11211,22020-easytier-web
STAMP=$(date +%Y%m%d-%H%M%S)
BK="$APP/backups/$STAMP"
echo "$BK"          # 记下这个路径：第 9 步回滚要用（第 4 步也会把它写进 $APP/backups/LATEST）
```

## 1. 前置验证（已在本机完成，不碰生产）

执行前确认下面四份报告的第一行都是 PASS：

- [`testenv/reports/gate-2026-11-23.md`](../testenv/reports/gate-2026-11-23.md)：v2.7.1 web + 2.6.4 core——旧实例照常下发运行、设备自动登记、中央网络能在 2.6.4 core 上运行；升级后再回滚到 2.6.4 也验证过。
- [`testenv/reports/migrate-rehearsal-2026-11-24.md`](../testenv/reports/migrate-rehearsal-2026-11-24.md)：合成数据上完整走一遍迁移向导、校验、单台回滚、整体回滚。
- [`testenv/reports/prod-rehearsal-2026-11-24.md`](../testenv/reports/prod-rehearsal-2026-11-24.md)：用**生产数据库的副本**做同样的演练。
- [`testenv/reports/prod-rehearsal-2026-11-25-auto-ip.md`](../testenv/reports/prod-rehearsal-2026-11-25-auto-ip.md)：在生产副本上验证共用固定 IP 的自动选址，以及 `routes = []`、端口占用、同一设备两个实例这三处修复；38 台运行中的设备全部迁移成功过。

## 2. （可选）两个 v2.7.1 读不出的停用实例

生产库里有 **2 个已停用的组 A 实例**，存储的配置里还带着很早以前版本写进去的 `rpc_port` 字段。2.6.4 能读，v2.7.1 不认识这个字段：读取这两个实例时返回 500 `unknown field rpc_port`，迁移向导把这两台设备列在「读取失败」里，手动实例页也读不出它们（生产副本演练确认，见报告）。运行中的实例不受影响：v2.7.1 第一次心跳时就会用 core 上报的配置把它们重写掉。

**推荐不处理**：这两个实例本来就停用、向导默认也不迁移它们，影响只是上面说的「读取失败」。

如果希望升级后这两个实例在新后端里还能打开，就在升级**之前**按演练过的办法把它们原样保存一次（2.6.4 保存时只去掉 `rpc_port`，其他字段逐个相同，实例仍是停用）。这一步会写数据库，所以先单独备份一次：

1. 按第 4 步停机备份，然后 `docker start easytier-web` 启动回 2.6.4。
2. 在本机用这份备份找出这两个实例（本机执行；`<备份目录>` 是上一步的 `$BK`）：

   ```sh
   mkdir -p ~/et-check && ssh idc-ucloud "tar -C '<备份目录>/data' -cf - ." | tar -x -C ~/et-check
   sqlite3 ~/et-check/et.db "select device_id, network_instance_id from user_running_network_configs where disabled = 1 and network_config like '%\"rpc_port\"%'"
   ```

3. 在主机上（bash）用原来的账号逐个原样保存（`<用户名>`、`<密码>`、`<设备>`、`<实例>` 换成实际值）：

   ```sh
   J="$BK/cookies"; API=http://127.0.0.1:11211/api/v1
   PW=$(printf '%s' '<密码>' | md5sum | cut -d' ' -f1)
   curl -sf -c "$J" -H 'content-type: application/json' -d "{\"username\":\"<用户名>\",\"password\":\"$PW\"}" "$API/auth/login"
   curl -sf -b "$J" "$API/machines/<设备>/networks/config/<实例>" > "$BK/cfg.json"
   printf '{"config":%s}' "$(cat "$BK/cfg.json")" | curl -sf -b "$J" -X PUT -H 'content-type: application/json' --data-binary @- "$API/machines/<设备>/networks/config/<实例>"
   ```

4. **重新运行开头的变量块**（得到新的 `$BK`，不要和这一步的备份混用），再从第 3 步继续（第 4 步会再备份一次）。升级后在向导第 1 步确认没有「读取失败」。

## 3. 记录现状

```sh
mkdir -p "$BK"
docker inspect easytier-web > "$BK/container.json"
docker image inspect "$(docker inspect -f '{{.Image}}' easytier-web)" -f '{{json .RepoDigests}}' | tee "$BK/image-digests.json"
docker inspect -f 'image={{.Config.Image}} entrypoint={{json .Config.Entrypoint}} cmd={{json .Config.Cmd}}' easytier-web
docker inspect -f 'ports={{json .HostConfig.PortBindings}} binds={{json .HostConfig.Binds}} restart={{.HostConfig.RestartPolicy.Name}}' easytier-web
docker inspect -f 'compose={{index .Config.Labels "com.docker.compose.project.working_dir"}}' easytier-web
```

- `image-digests.json` 应包含上表里 2.6.4 的 digest。回滚就用它。
- `cmd` 里应有 `--disable-registration`。升级后参数必须**完全不变**。
- `compose=` 后面应是 `/home/flintylemming/appdata/11211,22020-easytier-web`（compose 管理）。

再保存一份 compose 文件：

```sh
cp -a "$APP/compose.yaml" "$BK/compose.yaml"
```

## 4. 停机备份

```sh
docker stop easytier-web
cp -a "$APP/data" "$BK/data"
ls -la "$BK/data"                    # et.db（以及 et.db-wal、et.db-shm，如果有）
echo "$BK" > "$APP/backups/LATEST"   # 第 9 步回滚从这里读备份路径
```

这台主机上没有 `sqlite3`：把备份复制到本机再检查（本机执行，`<备份目录>` 换成上面打印的 `$BK`）：

```sh
mkdir -p ~/et-backup-check && ssh idc-ucloud "tar -C '<备份目录>/data' -cf - ." | tar -x -C ~/et-backup-check
sqlite3 ~/et-backup-check/et.db 'PRAGMA integrity_check'      # 必须输出 ok
```

输出不是 `ok` 就**停下**：不升级，`docker start easytier-web` 恢复原状，再排查。

**从这一步起，第 8 步之前任何时候都可以零成本回滚（第 9 步）。**

## 5. 换成 v2.7.1（参数不变）

在 `$APP/compose.yaml` 里只把 `easytier-web` 服务的 `image:` 改成 `mirror-hub.flinty.moe/easytier/easytier:v2.7.1`（`easytier-core` 服务不动），其他不动，然后：

```sh
cd "$APP"
docker compose pull easytier-web          # 只拉 easytier-web 的新镜像
docker compose up -d easytier-web         # 只重建 easytier-web
docker image inspect mirror-hub.flinty.moe/easytier/easytier:v2.7.1 -f '{{json .RepoDigests}}'   # 应含上表的 2.7.1 digest
```

## 6. 检查

```sh
docker logs --tail 50 easytier-web        # 没有 panic；数据库迁移完成
docker ps --filter name=easytier-web      # 状态 Up
```

- 原版内嵌前端（`http://<主机>:11211`）能用原来的账号登录。
- 设备陆续重新上线（原版前端的设备列表；几十秒内）。
- 旧实例照常运行：随便打开几台设备，网络实例都在、在运行。
- 已知、无害：每次给 2.6.4 core 下发**中央网络**实例时，日志里有一条 `ERROR Failed to cache runtime config after run: … Instance not found or API service not available`，实例照常运行（门禁报告）。

有任何一项不对 → 第 9 步回滚。

## 7. 部署新前端

按 README「部署」：本机 `npm run build`，把 `dist/` 复制到服务器，用 Caddy（`deploy/`）或现有的反向代理把 `/api/*` 转发到 easytier-web 的 11211 端口、其余路径托管 `dist/`。用原来的账号登录新前端。原版前端可以继续保留在 11211 端口，作为对照。

## 8. 运行迁移向导

新前端概览页顶部的横幅「检测到 N 个旧版网络实例…」→「开始迁移」，或者直接打开 `/#/migrate`。建议：

1. 第一次只选一台设备（其余选「暂不迁移」），确认它迁移后校验「一致」、网络通，再迁移其余设备。已经迁移的设备在向导第 3 步显示「已是成员，跳过」。
2. 向导第 4 步会先下载一份导出文件（含网络密钥），和本手册第 4 步的备份放在一起。
3. 迁移完成后，到校验报告看结果；离线的设备上线后在报告里「重新校验」。
4. 单独配置过 ACL 的设备：迁移不会转换 ACL，按报告顶部的链接到网络的 ACL 页写成中央规则。生产副本里的 5 份 ACL 配置全是空的（0 条规则），所以预计不会出现。
5. **组 A 有多台设备共用同一个固定 IP**（生产副本里 38 个运行中的实例只有 15 个不同的地址）。中央网络里一个地址只能给一台设备，所以向导第 3 步默认让每个共用地址里按名称排第一的设备保留原地址，其余设备改用**自动选择**的空闲地址：从网段顶部往下取，避开这一组读到的任何旧实例（迁移或不迁移、运行或停用）、任何成员和网络里现在在线的地址。**离线设备的地址读不到**：迁移当天如果有设备离线，第 3 步会提示，最好等它们上线再迁移。卡片上显示「旧地址 → 新地址（自动选择）」，差异里多一条「固定 IP」要确认（摘要里可以「全部确认」）。想让另一台设备保留原地址，在卡片上切换「保留原地址 / 自动选择」。**这些设备迁移后的虚拟 IP 会变**：有东西按 IP 访问它们的话，迁移后要改过去。
6. 组 B（4 个实例，全部停用、DHCP）默认「暂不迁移」，原样保留为手动实例。

**升级后、迁移前，不要在手动实例页对 2.6.4 设备的旧实例「停用」再「启用」。**2.6.4 的 core 上报配置时会丢掉「手动路由、列表为空」（TOML 里的 `routes = []`，意思是不安装其他设备代理的子网路由）这个模式；v2.7.1 停用实例时用这份上报覆盖存储的配置，再启用时这台设备就变成自动安装路由。生产副本里 17 个运行中的实例是这种配置。迁移向导已经处理了这个问题：它从运行中的 TOML 读回这个模式，迁移和回滚都会保留。

已知、无害：向导停用旧实例时，v2.7.1 会用 core 上报的运行配置覆盖存储的配置；2.6.4 的 core 不上报和系统主机名相同的 `hostname`，所以这类实例（生产副本里 12 个）在迁移记录里、以及「回滚这台…」重建出的实例里少了 `hostname` 这一行。core 没有这一行时用的就是系统主机名，实际效果相同。

**第 8 步开始后再整体回滚，升级后的所有修改都会丢失**（新建的网络、成员、迁移结果）。单台设备有问题时，优先用校验报告里的「回滚这台…」。

## 9. 回滚（整体）

顺序：**停 web → 恢复备份 → 用旧镜像（2.6.4 的 digest）启动**。web 2.6.4 不能直接打开 v2.7.1 迁移过的数据库（启动即 panic：`Migration file of version '…' is missing`），所以必须恢复第 4 步的备份。

回滚往往在另一个 SSH 会话里做，所以下面是一段独立的脚本：备份路径从第 4 步写下的 `$APP/backups/LATEST` 读（也可以把 `BK=` 那一行直接改成记下的路径）；备份不在就停下，什么都不动。整段粘贴到主机上执行（任何一条失败都会停止）：

```sh
bash -eu <<'EOF'
APP=/home/flintylemming/appdata/11211,22020-easytier-web
BK=$(cat "$APP/backups/LATEST")
test -s "$BK/data/et.db" && test -s "$BK/compose.yaml" || { echo "备份不完整: $BK" >&2; exit 1; }
docker stop easytier-web
mv "$APP/data" "$APP/data.failed-$(date +%Y%m%d-%H%M%S)"   # 保留现场，不删除
cp -a "$BK/data" "$APP/data"
cp -a "$BK/compose.yaml" "$APP/compose.yaml"                 # 换回原来的 compose
cd "$APP" && docker compose up -d easytier-web
docker image inspect "$(docker inspect -f '{{.Image}}' easytier-web)" -f '{{json .RepoDigests}}'
EOF
```

最后一行应打印 2.6.4 的 digest（`sha256:91d6732e…`）。原来的 compose 写的是 `:latest`，本机的 `latest` 仍是 2.6.4（只要没人在这台主机上 pull 过它）；如果打印的不是这个 digest，把 `easytier-web` 服务的 `image:` 改成 `mirror-hub.flinty.moe/easytier/easytier@sha256:91d6732ea5ff71542fdb99333d2ee7b168e973443114db84db061e452427d91e`（本机已有，不需要拉取），再 `docker compose up -d easytier-web`。

回滚后会发生什么（合成数据和生产副本的演练都验证过，见第 1 步的报告）：

- web 2.6.4 在每台设备第一次心跳时（十几秒内），**自动删除** v2.7.1 下发的中央网络实例，并按数据库重新运行迁移时删掉的旧实例。**不需要手动清理。**
- 在 v2.7.1 上被停用又重新启用、或者用「回滚这台…」重建过旧实例的设备（包括迁移失败后自动回滚的设备）：core 会继续运行 v2.7.1 最后下发的那份配置，直到 easytier-core 重启；和备份里的配置相比只差系统主机名那一行 `hostname`，重建过的还会被 web 2.6.4 把数据库里的来源改成 `webhook`（配置不变）。不启用 webhook 时都没有实际影响。想让它们完全回到原样：恢复数据库后、启动 web 2.6.4 **之前**，重启这些设备上的 easytier-core（演练里这样做之后，全部实例的 TOML 和升级前逐字节相同）。
- 浏览器里的本地迁移记录（localStorage `et.migrate.<用户名>`）已经过时。回滚后校验都会是「等待上线后校验」，报告里清除不了；在浏览器开发者工具里删掉这个键即可。

确认一切正常后，可以删除 `data.failed-*` 目录；备份 `$BK` 建议至少保留到迁移完成后一周。
