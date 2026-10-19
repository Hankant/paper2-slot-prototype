# 2026-09-23 试玩、问卷与控制台验收

状态：VERIFIED_LOCAL_PILOT。Codex 直接实施，无 Kimi/子 agent。

## 实现

- 试玩任务持续黄色标识；页眉、来源表现条、结果卡不显示积分或金额。完成页只显示正式积分、对应金额与稳定兑奖编号。
- 问卷 sessionStorage 草稿按会话/版本/区块隔离；刷新保持答案和题序。理解题错误次数按提交尝试累计。新会话后台逐题校验，旧会话校验路径保留。
- 新增管理员认证的 admin.html，编辑模块顺序、轮数、问卷组合、条件与奖励；SQLite 保存配置版本。新会话等概率独立分组，旧会话冻结配置。
- 监控进度、筛选待核查、导出筛选 JSON/CSV。试玩原始分数仍留在事件中，但从正式奖励中排除。

## 验证证据

- Vitest 159 项完整回归 + 新增 1 项后台配置重启持久化/跨域拒绝测试：合计 160 项通过。
- 浏览器：5 项预览 + 8 项采集/校园 HTTP + 5 项旧入口，共 18 个测试通过。初次新增用例曾有按钮匹配/HTTP 回执断言错误，修正测试后通过；最终采集完整跑见 artifacts/qa-reward-final，最后新增用例重验见 artifacts/qa-admin-final。
- 特别核验：越界问卷得到拒绝回执且未落库；合法作答可随后保存；错误次数刷新保留；配置发布不影响已有会话；奖励汇总与完成页一致；试玩结果即使设置现金比例仍不显示积分/金额。
- typecheck、lint（无警告）、build:all、git diff --check 通过。
- 已查看 artifacts/qa/admin-console.png、practice-no-points.png、practice-no-points-mobile.png；390px 无页面横向溢出。

## 本机部署

已先备份：private/collection/backups/2026-09-23T11-06-53.329Z-c091a93b.sqlite，integrity_check 通过。
已构建并通过 paper2-collect-network 技能脚本重启 campus 服务；健康检查通过，admin.html HTTP 200，未认证管理接口 401；7 个原有会话仍可列出。
入口：http://127.0.0.1:5200/admin.html；校园参与入口：http://10.4.165.144:5200/collect.html。
管理员密钥沿用本机私有设置，不写入代码或本交接文档。已发布配置 v1 为当前默认配置，未擅自设置实际现金兑换比例。

## 边界

仍为本机/校园原型，未上公有云、未自动付款、未验证真实手机的校园连通性。未更改本轮未授权的历史记录/开奖生成算法或 AI 命中排程。更换问卷版本需同步配置迁移，草稿仅支持同标签页刷新。

操作说明：[ADMIN_CONSOLE.md](../../docs/ADMIN_CONSOLE.md)。
