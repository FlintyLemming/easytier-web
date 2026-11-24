# easytier-web 升级手册：v2.6.4 → v2.7.1（生产环境 idc-ucloud）

> **这份手册由用户执行，或者在执行当天得到用户明确同意后执行。**没有当天的明确同意，任何人（包括自动化代理）都不能执行下面的写操作：停止、删除、重命名、启动容器，写数据目录。

| 项目 | 值 |
| --- | --- |
| 主机 | `idc-ucloud` |
| 容器 | `easytier-web` |
| 数据目录（宿主机） | `/home/flintylemming/appdata/11211,22020-easytier-web/data`（容器内 `/app`；里面是 `et.db`、`et.db-wal`、`et.db-shm`） |
| 旧镜像 | `easytier/easytier:v2.6.4`，上游 digest `sha256:91d6732ea5ff71542fdb99333d2ee7b168e973443114db84db061e452427d91e` |
| 新镜像 | `easytier/easytier:v2.7.1`，上游 digest `sha256:24248ca25f55f97fde509af450124b31decd44421403518350c6f4109fb139ef`（镜像站 `mirror-hub.flinty.moe` 上的同一版本也可以，digest 应相同） |

下面的命令都在 `idc-ucloud` 上执行。先设好变量：

```sh
APP=/home/flintylemming/appdata/11211,22020-easytier-web
STAMP=$(date +%Y%m%d-%H%M%S)
BK="$APP/backups/$STAMP"
```

## 1. 前置验证（已在本机完成，不碰生产）

执行前确认下面三份报告的第一行都是 PASS：

- [`testenv/reports/gate-2026-11-23.md`](../testenv/reports/gate-2026-11-23.md)：v2.7.1 web + 2.6.4 core——旧实例照常下发运行、设备自动登记、中央网络能在 2.6.4 core 上运行；升级后再回滚到 2.6.4 也验证过。
- [`testenv/reports/migrate-rehearsal-2026-11-24.md`](../testenv/reports/migrate-rehearsal-2026-11-24.md)：合成数据上完整走一遍迁移向导、校验、单台回滚、整体回滚。
- [`testenv/reports/prod-rehearsal-2026-11-24.md`](../testenv/reports/prod-rehearsal-2026-11-24.md)：用**生产数据库的副本**做同样的演练。

## 2. 记录现状

```sh
mkdir -p "$BK"
docker inspect easytier-web > "$BK/container.json"
docker image inspect "$(docker inspect -f '{{.Image}}' easytier-web)" -f '{{json .RepoDigests}}' | tee "$BK/image-digests.json"
docker inspect -f 'image={{.Config.Image}} entrypoint={{json .Config.Entrypoint}} cmd={{json .Config.Cmd}}' easytier-web
docker inspect -f 'ports={{json .HostConfig.PortBindings}} binds={{json .HostConfig.Binds}} restart={{.HostConfig.RestartPolicy.Name}}' easytier-web
docker inspect -f 'compose={{index .Config.Labels "com.docker.compose.project.working_dir"}}' easytier-web
```

- `image-digests.json` 应包含上表里 2.6.4 的 digest（镜像站的镜像也一样）。回滚就用它。
- `cmd` 里应有 `--disable-registration`。升级后参数必须**完全不变**。
- `compose=` 后面有路径 → 这个容器由 docker compose 管理，第 4、8 步用「compose」那一种做法；为空 → 用「docker run」那一种。

## 3. 停机备份

```sh
docker stop easytier-web
cp -a "$APP/data" "$BK/data"
ls -la "$BK/data"                                     # et.db（以及 et.db-wal、et.db-shm，如果有）
sqlite3 -readonly "$BK/data/et.db" 'PRAGMA integrity_check'   # 必须输出 ok
```

主机上没有 `sqlite3` 时，把 `$BK/data` 复制到本机再检查。输出不是 `ok` 就**停下**：不升级，`docker start easytier-web` 恢复原状，再排查。

**从这一步起，第 7 步之前任何时候都可以零成本回滚（第 8 步）。**

## 4. 换成 v2.7.1（参数不变）

**docker run 管理的容器**：保留旧容器（改名、不删除），用同样的参数创建新容器。

```sh
docker rename easytier-web easytier-web-2.6.4
# 下面这条照抄原来的 docker run 命令，只把镜像换成 v2.7.1。
# 参数以第 2 步打印的 entrypoint / cmd / ports / binds / restart 为准，例如：
docker run -d --name easytier-web --restart unless-stopped \
  -p 11211:11211 -p 22020:22020/udp \
  -v "$APP/data:/app" \
  --entrypoint easytier-web-embed \
  easytier/easytier:v2.7.1 --disable-registration
```

**compose 管理的容器**：在 compose 文件里把 `image:` 改成 `easytier/easytier:v2.7.1`（或镜像站的同一版本），其他不动，然后在 compose 文件所在目录执行 `docker compose up -d easytier-web`。

## 5. 检查

```sh
docker logs --tail 50 easytier-web        # 没有 panic；数据库迁移完成
docker ps --filter name=easytier-web      # 状态 Up
```

- 原版内嵌前端（`http://<主机>:11211`）能用原来的账号登录。
- 设备陆续重新上线（原版前端的设备列表；几十秒内）。
- 旧实例照常运行：随便打开几台设备，网络实例都在、在运行。
- 已知、无害：每次给 2.6.4 core 下发**中央网络**实例时，日志里有一条 `ERROR Failed to cache runtime config after run: … Instance not found or API service not available`，实例照常运行（门禁报告）。

有任何一项不对 → 第 8 步回滚。

## 6. 部署新前端

按 README「部署」：本机 `npm run build`，把 `dist/` 复制到服务器，用 Caddy（`deploy/`）或现有的反向代理把 `/api/*` 转发到 easytier-web 的 11211 端口、其余路径托管 `dist/`。用原来的账号登录新前端。原版前端可以继续保留在 11211 端口，作为对照。

## 7. 运行迁移向导

新前端概览页顶部的横幅「检测到 N 个旧版网络实例…」→「开始迁移」，或者直接打开 `/#/migrate`。建议：

1. 第一次只选一台设备（其余选「暂不迁移」），确认它迁移后校验「一致」、网络通，再迁移其余设备。已经迁移的设备在第 3 步显示「已是成员，跳过」。
2. 第 4 步会先下载一份导出文件（含网络密钥），和第 3 步的备份放在一起。
3. 迁移完成后，到校验报告看结果；离线的设备上线后在报告里「重新校验」。
4. 单独配置过 ACL 的设备：迁移不会转换 ACL，按报告顶部的链接到网络的 ACL 页写成中央规则。

**第 7 步开始后再整体回滚，升级后的所有修改都会丢失**（新建的网络、成员、迁移结果）。单台设备有问题时，优先用校验报告里的「回滚这台…」。

## 8. 回滚（整体）

顺序：**停 web → 恢复备份 → 用旧镜像（2.6.4 的 digest）启动**。web 2.6.4 不能直接打开 v2.7.1 迁移过的数据库（启动即 panic：`Migration file of version '…' is missing`），所以必须恢复第 3 步的备份。

```sh
docker stop easytier-web
mv "$APP/data" "$APP/data.failed-$STAMP"          # 保留现场，不删除
cp -a "$BK/data" "$APP/data"
```

**docker run 管理的容器**（第 4 步保留了旧容器）：

```sh
docker rename easytier-web easytier-web-2.7.1
docker rename easytier-web-2.6.4 easytier-web
docker start easytier-web
```

**compose 管理的容器**：把 compose 文件里的 `image:` 改成 `easytier/easytier@sha256:91d6732ea5ff71542fdb99333d2ee7b168e973443114db84db061e452427d91e`（第 2 步记下的 digest），`docker compose up -d easytier-web`。

回滚后会发生什么（合成数据演练已验证，见 `testenv/reports/migrate-rehearsal-2026-11-24.md`）：

- web 2.6.4 在每台设备第一次心跳时（十几秒内），**自动删除** v2.7.1 下发的中央网络实例，并按数据库重新运行迁移时删掉的旧实例。**不需要手动清理。**
- 在 v2.7.1 上用「回滚这台…」重建过旧实例的设备：web 2.6.4 会把这个实例在数据库里的来源改成 `webhook`（配置不变）。不启用 webhook 时没有任何影响。想让它完全回到原样：恢复数据库后、启动 web 2.6.4 之前，重启这台设备上的 easytier-core。
- 浏览器里的本地迁移记录（localStorage `et.migrate.<用户名>`）已经过时。回滚后校验都会是「等待上线后校验」，报告里清除不了；在浏览器开发者工具里删掉这个键即可。

确认一切正常后，可以删除 `easytier-web-2.7.1` 容器和 `data.failed-*` 目录；备份 `$BK` 建议至少保留到迁移完成后一周。
