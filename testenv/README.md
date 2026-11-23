# 本地 Docker 测试环境

一个 `easytier-web` 容器（`web`）加三个 `easytier-core` 容器（`core1`、`core2`、`core3`）。

## 启动与停止

```sh
docker compose -f testenv/docker-compose.yml up -d     # 启动
docker compose -f testenv/docker-compose.yml down      # 停止（数据保留在 testenv/data）
```

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
docker compose -f testenv/docker-compose.yml down
ET_WEB_TAG=v2.7.1 docker compose -f testenv/docker-compose.yml up -d
```

## 账号与地址

- 管理员账号：`admin` / `admin`（登录时密码先做 MD5，`21232f297a57a5a743894a0e4a801fc3`）
- 旧前端（内嵌）：http://localhost:11211/
- API：`http://localhost:11211/api/v1/...`，设备登记端口 `22020/udp`
- 固定 machine id：core1 `11111111-1111-4111-8111-111111111111`，core2 `22222222-2222-4222-8222-222222222222`，core3 `33333333-3333-4333-8333-333333333333`
