# 采集试点部署与运维手册（COLLECTION_DEPLOYMENT）

版本：2026-09-19 · 适用范围：collection pilot（合成数据工程试点）

> **重要边界声明**
>
> - 用户**没有任何云账号**。本文档只提供可部署产物与操作步骤，**不代表已在云端部署或验证成功**。云端步骤需在用户准备资源后执行，是否可用以实际执行为准。
> - 本文档**不包含任何价格信息**；各云厂商定价随时变动，请以官网当日价格为准。
> - **伦理与正式方案未最终定稿前，禁止招募真实被试。** 当前部署仅用于合成数据/工程验证，知情同意文案仍是试点版。

## 1. 产物清单

| 文件                            | 作用                                                                                                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Dockerfile`                    | 多阶段构建：Node 24 `npm ci` → `npm run build:all`；运行时仅含生产依赖，`dist/`（前端）+ `dist-server/main.js`（服务端），非 root 用户，健康检查 `/api/health`    |
| `.dockerignore`                 | 排除 `.env`/私钥/研究原始数据/日志/数据库/构建产物，确保密钥与敏感材料不进入镜像；保留 `src/`、`server/`、`tools/`、`tests/`、`config/` 等 typecheck/构建所需输入 |
| `deploy/docker-compose.yml`     | 应用 + Caddy 反代示例；SQLite 持久卷 `collect-data:/data`（compose 会按项目名加前缀）；单写者单实例**设计**                                                       |
| `deploy/Caddyfile`              | HTTPS 反向代理，`DOMAIN` 环境变量注入，自动申请/续期证书                                                                                                          |
| `docs/COLLECTION_DEPLOYMENT.md` | 本手册                                                                                                                                                            |

`npm run build:all` 已提供，产出 `dist/` 与 `dist-server/main.js`。本机 Node 服务验收通过。2026-09-20 补充验证（Docker 28.0.4）：镜像 `paper2-collection:local` 构建成功；容器运行后 `/api/health` 与 `collect.html` 正常；API 建会话并 `docker restart` 后会话从持久卷恢复；`docker compose config` 通过。**Caddy 公网 HTTPS 与证书申请仍未实测**，云端步骤以实际执行为准。

## 2. 密钥与配置管理（先读）

- **必需环境变量**：`ENTRY_CODE`（参与者入口码）、`ADMIN_TOKEN`（管理员导出用 Bearer 令牌）。服务端**拒绝**缺少这两个变量的启动，镜像内无任何内置默认凭据。
- 两个密钥**只出现在服务端环境**：
  - 永不为前端打包它们（前端只收集用户手填的入口码）；
  - 永不写入仓库、镜像层、compose 文件或 Caddyfile；
  - 存放于部署机上的 `deploy/.env`（已被 `.gitignore`/`.dockerignore` 排除），权限建议 `chmod 600`。
- 生成示例（在部署机上执行）：

```bash
cd deploy
umask 077
cat > .env <<'EOF'
DOMAIN=collect.example.org
ENTRY_CODE=<openssl rand -hex 16 的输出>
ADMIN_TOKEN=<openssl rand -hex 32 的输出>
EOF
```

## 3. 本地构建与运行（单机 Docker）

```bash
# 仓库根目录
docker build -t paper2-collection:local .

# 本地试运行：SQLite 落在命名卷 collect-data 中，重启不丢数据
# 注意：镜像默认 NODE_ENV=production，生产模式服务端强制安全 Cookie；
# 本地 HTTP 试用必须显式覆盖 NODE_ENV=development 才能配合 SECURE_COOKIES=false。
docker run -d --name collect \
  -e NODE_ENV=development \
  -e ENTRY_CODE="$ENTRY_CODE" \
  -e ADMIN_TOKEN="$ADMIN_TOKEN" \
  -e SECURE_COOKIES=false \
  -v collect-data:/data \
  -p 127.0.0.1:5200:5200 \
  paper2-collection:local

curl -s http://127.0.0.1:5200/api/health
# 期望：{"ok":true,"storage":"sqlite","simulation":true}
```

注意：

- 生产（HTTPS）必须保持 `NODE_ENV=production` 且 `SECURE_COOKIES=true`；本地 HTTP 试用的 `development + SECURE_COOKIES=false` 只是覆盖，不放宽生产要求。
- 只把端口绑到 `127.0.0.1`，不要对公网直接暴露 5200；公网入口只走 Caddy。
- 停止/删除容器**不会**删除数据，数据在卷里。删除数据需显式 `docker volume rm collect-data`。

## 4. 域名 + HTTPS（compose + Caddy）

1. 准备一个域名（如 `collect.example.org`），在其 DNS 添加 **A 记录指向云主机公网 IP**；等待解析生效。
2. 在 `deploy/.env` 填好 `DOMAIN`/`ENTRY_CODE`/`ADMIN_TOKEN`（见第 2 节）。
3. 启动：

```bash
cd deploy
docker compose up -d --build
docker compose ps        # collect 应为 healthy，caddy 应为 running
curl -s https://$DOMAIN/api/health
```

- Caddy 自动申请并续期公共 CA 证书；证书持久化在 `caddy-data` 卷。
- 应用容器**不发布主机端口**，只在 compose 内网对 Caddy 暴露 5200。服务端 `HOST=0.0.0.0` 仅应绑定容器内网；**前提**是绝不把 5200 发布到主机或公网，否则该设置不再成立。
- **单写者单实例设计**：SQLite 单写者，不要 `docker compose up --scale collect=N`，也不要把卷挂到多台机器。compose 本身**不会强制**单副本，这是需要运维自觉遵守的设计约束；需要更高可用性时先改存储架构，再谈多副本。

## 5. 云主机选项（不含价格、不作容量保证）

用户尚无云账号。以下为通用选项，具体机型、规格与价格以各官网为准：

- **主流公有云 VM**（国内外均可）：通用型实例 + 主流 LTS 系统镜像（Ubuntu/Debian 等）；需分配公网 IP 并开放 80/443。所需规格取决于实际并发与数据量，请先低成本试运行，再按监控与实际负载调整。
- **轻量应用服务器**：部分厂商提供简化版 VM，操作步骤更少，可选项之一。
- **自建/实验室服务器**：有公网可达 IP 的机器亦可，要求一致（Docker + 域名解析）。
- 通用建议：开启厂商防火墙/安全组仅放行 80/443/SSH；SSH 用密钥登录并禁用口令登录；开启自动安全更新。具体计费项（实例、流量、磁盘、IP）请自行查官网。

## 6. 备份与恢复（SQLite，禁止直拷活动库）

SQLite 以 WAL 模式运行时直接 `cp collection.db` 可能拷到不一致快照（还有 `-wal`/`-shm` 文件）。**正确做法是使用 SQLite 在线备份**，而不是复制数据库文件。

**关于前缀**：docker compose 会按项目名给容器和卷加前缀（容器可能是 `deploy-collect-1`，卷可能是 `deploy_collect-data`），因此不要依赖裸容器名 `collect` 或裸卷名 `collect-data`；统一用 `docker compose exec -T <服务名>` / `docker compose cp`，compose 会自动解析。

推荐方式（在线热备，不停服）：用 `VACUUM INTO` 在容器内生成**带时间戳的唯一文件名**，再 `docker compose cp` 取回宿主机：

```bash
cd deploy
mkdir -p backups
STAMP="$(date +%Y%m%d-%H%M%S)"

docker compose exec -T collect node -e \
  "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.env.DATA_PATH);d.exec(\"VACUUM INTO '/data/backup-${STAMP}.db'\")"

docker compose cp "collect:/data/backup-${STAMP}.db" "./backups/collection-${STAMP}.db"
```

- 文件名唯一，不会覆盖历史备份，不需要强制删除旧文件；同一时刻只执行一个备份，避免并发 `VACUUM INTO` 写同一目标。
- 确认备份已取回宿主机后，可自行删除容器内的临时备份文件（非强制步骤）。
- 备份文件属于**研究数据**，按研究数据管理要求存放（加密、访问受限、不进代码仓库）。
- 建议每日自动备份（cron 执行上述命令），并定期演练恢复。

安全停服与恢复（描述性步骤，请按顺序手工执行，勿在服务运行时替换数据库文件）：

1. **先验证备份**：把备份副本放到临时位置，用临时容器挂载启动服务端，确认 `GET /api/health` 与管理导出正常后再继续。
2. **停服**：`docker compose stop collect`。
3. **替换**：将验证过的备份复制到数据卷中替换现有数据库文件，并同时移除旧的 `-wal`/`-shm` 伴生文件（SQLite 会以备份自身的一致性状态重建，残留伴生文件会导致问题）。
4. **启动验证**：`docker compose start collect`，确认健康检查通过，并走一遍完整会话流程。
5. 任何替换操作前，先保留原始卷或原始数据库的副本，以便回退。

## 7. 管理员导出（不泄露凭据）

```bash
# 交互式输入，避免令牌出现在 shell 历史
read -rs ADMIN_TOKEN; export ADMIN_TOKEN; echo

# JSON 全量导出
curl -fsS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "https://$DOMAIN/api/admin/export" -o admin-export.json

# CSV 摘要（每会话一行）
curl -fsS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "https://$DOMAIN/api/admin/export?format=csv" -o admin-export.csv
unset ADMIN_TOKEN
```

- `ADMIN_TOKEN` 在服务端**与同名环境变量比对校验，不写入数据库**；以哈希形式入库的是**会话令牌**，两者不要混淆。不要把令牌写进任何脚本文件或提交进仓库。
- 导出结果含会话与事件，按研究数据处理。

## 8. 部署后验收测试清单

外部控制器/用户执行；未运行不得宣称通过：

1. `GET /api/health` 返回 `{ok:true,storage:"sqlite",simulation:true}`。
2. 浏览器走 `https://$DOMAIN/collect.html` 完成一次完整流程：入口码 → 同意 → 独立预测/信心/来源 → 建议 → 最终预测 → 反馈 → 完成，且每步都有服务端回执（非仅 HTTP 200）。
3. **重启恢复**：`docker compose restart collect` 后刷新页面，会话从服务端恢复，已锁定答案不回退，未确认事件按原 ID 重试。
4. **持久化**：删容器重建（卷保留）后数据仍在。
5. 导出：`/api/export`（本人会话）与 `/api/admin/export`（Bearer 令牌）均正常；未认证请求被拒；响应中无令牌/堆栈/密钥。
6. 单实例约束核对：实际只运行一个 collect 容器。
7. 仓库回归：`npm run typecheck`、`npm run test:run`、相关 lint/e2e 通过（在源码工作树执行）。

## 9. 伦理与数据红线（再次强调）

- **伦理批准与研究方案未最终定稿前，禁止招募真实被试；** 当前仅允许合成数据演练。
- 不收集姓名/电话/年龄等个人信息；入口材料不承诺旧版"仅内存"语义，须如实说明服务端存储与重启恢复。
- 真实数据、个人信息、令牌不写入仓库（`.dockerignore`/`.gitignore` 已双重排除 `.env`、私有目录、数据库与日志）。
- 不生成"已获伦理批准 / 已验证 AI / 已完成真实支付"等不实说明。

## 10. 常见故障排查

| 现象                                   | 排查                                                                                                     |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 容器启动即退出                         | 查看 `docker logs collect`：多为缺少 `ENTRY_CODE`/`ADMIN_TOKEN`（服务端拒绝启动）                        |
| 本地试用起不来、报安全 Cookie 相关错误 | 是否忘了 `-e NODE_ENV=development`（镜像默认 production，强制安全 Cookie）                               |
| Caddy 拿不到证书                       | `DOMAIN` 未解析到本机、80/443 未放行、或已有其他服务占用端口                                             |
| 健康检查失败                           | 先 `docker logs collect`；确认 `DATA_PATH` 卷可写（属主 `collect`）                                      |
| 会话丢失                               | 确认未误删卷；确认没有以无卷方式另起了第二个容器                                                         |
| 备份/恢复命令找不到容器或卷            | compose 项目前缀导致名字不同；统一用 `docker compose exec -T collect` / `docker compose cp`（见第 6 节） |

## 11. 配置依据

- [Caddy 自动 HTTPS 官方说明](https://caddyserver.com/docs/automatic-https)：域名解析、80/443 与证书存储要求。
- [Docker Compose 部署规范](https://docs.docker.com/reference/compose-file/deploy/)：部署配置是 Compose 可选部分，不应把单实例要求写成仅限 Swarm 的行为。

本机安装的 Node 24.14.1 对 node:sqlite 仍显示 ExperimentalWarning。当前只接受工程试点；正式部署前须锁定并验证运行时、依赖和容量。
