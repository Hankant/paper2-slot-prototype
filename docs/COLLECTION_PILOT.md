# 数据收集试点：运行、验收与剩余边界

2026-09-19。当前交付是单轮模拟采集链路；正式 jsPsych 多轮实验与研究材料仍待确定。

## 直接运行

在 `E:/Info_AI/projects/paper2-slot-prototype` 中执行（Node 24）：

```powershell
npm ci
npm run build:all
npm run collect:local
```

打开 http://127.0.0.1:5200/collect.html ，首次本地参与码为 `PAPER2-LOCAL`。
这只是本机地址，外地参与者无法访问。现场手机/远程参与使用未来部署的 HTTPS 地址；不能用二维码把 127.0.0.1 变成公网网址。

流程：参与码与现场/远程选择 → 未预选的同意确认 → 操作说明 → 独立预测/信心 → 自己或 AI → 最终预测 → 开奖 → 服务端确认完成 → 下载本人 JSON。

`preview.html` / `preview-immersive.html` 仍是内存演示，只有 `collect.html` 接入持久采集。正式 timeline 仍采用 jsPsych；本次复用的是单轮 TypeScript 界面。

## 数据在哪里

- SQLite：`private/collection/collection.sqlite`，在服务器磁盘中保存，不在页面内存里冒充持久化。
- 本机设置：`private/collection/local-settings.json`。管理员令牌首次启动随机生成；参与码是批次共享码，不是个人一次性码。
- 匿名参与者与会话编号分别生成。记录来源选择、机器选择、信心、事件顺序/时间、同意版本、设备/参与方式、对话呈现与评分。
- 入口码不会写入参与确认或数据导出。不收集姓名、电话、年龄；这类字段需研究方案明确后再加。
- Cookie 为 HttpOnly / SameSite=Strict；数据库存储会话令牌哈希。本人导出须会话 Cookie，管理员导出须独立令牌。
- 未确认记录按会话隔离缓存在 sessionStorage，重试复用原 ID；服务器确认后清除缓存。刷新先重发未确认记录，再恢复已锁定状态。
- 恢复范围：同一浏览器会话、同一标签页缓存。关闭标签页会丢失未确认缓存；清 Cookie、换设备后不能自行找回身份。已确认数据仍留在服务器。
- AI 回答仍为脚本模拟。刷新中断的回答会标记重新呈现，原呈现记录保留；不把重新呈现当作原来没看过。

## 导出和备份

保持本机服务运行，在另一个终端执行：

```powershell
npm run collect:export
npm run collect:backup
```

导出存入 `private/collection/exports/`：JSON 为原始记录，CSV 为会话摘要。CSV 包含来源、信心、独立/最终正确、建议暴露、建议正确、最终是否与建议一致、是否从不同答案转向建议。未暴露建议的比较字段为空，不能解释成 false。

这些比较是描述性记录，不直接表示 AI 的因果影响，也不直接估计 alpha。弃用的 `advice_target_hit` 保留兼容字段；分析使用 `advice_evaluation`。

备份使用 SQLite `VACUUM INTO` 创建独立快照，随后执行 `integrity_check`；文件在 `private/collection/backups/`。不直接复制正在写入的单个数据库文件。备份不会自动上传到异地。

## 验收证据

本轮实际运行结果见 [验收交接](../handoffs/A/2026-09-19-collection-final.md)。覆盖：

- 自己/AI 两分支及建议访问门控；未作最终选择不返回结果。
- 服务端关闭并重建后按 SQLite 记录恢复，包括已读取但尚未确认呈现的建议。
- 相同事件 ID 重试不重复写入；内容冲突、错误同意版本、跨会话提交与跨站请求被拒。
- 浏览器刷新恢复；服务器已保存但客户端丢失回执时，不重复计数或改写选择。
- 完成接口失败时显示“等待保存确认”，可以重试，不显示完成或允许开始新一轮。
- 桌面和 390px 视口；前者的设备模拟不等于微信内置浏览器或真实手机验收。

## 部署与尚未完成

部署采用单个 Node 服务、SQLite 持久卷、Caddy HTTPS。文件与步骤见 [部署手册](COLLECTION_DEPLOYMENT.md)。无云账号，本轮没有开通资源、花费或公网部署。Docker 引擎未运行，Compose 静态校验通过不代表镜像与证书已实测。

仍需：正式试次/随机化方案、完整 jsPsych timeline、正式同意文本与联系人/保存期限、招募管理、真实手机验证、目标地区网络验证、负载和运维验收。不要把本轮工程验收写成实验效度或正式上线验收。

既有开发依赖的 npm audit 告警单独记录；未为消除告警贸然升级 Vite/Vitest 主版本。部署用构建后的 Node 服务，不使用 Vite 开发服务器公开收集数据。

## 当前工作方式

用户于 2026-09-19 要求停止 Kimi 和多 agent 调用。后续由 Codex 单人实现、审阅和验证；保留既有任务记录用于追溯，不继续调度或补派 Kimi。
