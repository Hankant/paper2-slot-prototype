# 2026-09-21 HTTP 校园网兼容修复

状态：VERIFIED。Codex 直接实施，未调用 Kimi 或多 agent。

## 发现和修复

- 开始时工作区已有 src/uuid.ts、UUID 测试及前端调用替换，保留并审查这些在途改动。前端会话、事件、审计、聊天请求及消息均通过 randomId 生成。
- randomId 优先使用 randomUUID；普通 HTTP 下使用 getRandomValues 生成 UUID v4。不使用 Math.random；缺少随机数能力时给出可读错误。
- 发现剩余故障：src/domain/text-hash.ts 直接调用 crypto.subtle.digest。普通 HTTP 没有 SubtleCrypto，AI 回答完整性校验会失败。
- 为该分支引入锁定版本 @noble/hashes 2.4.0 的 SHA-256，保持 UTF-8 编码和 64 位十六进制哈希格式。WebCrypto 可用时继续使用原实现，不捕获并掩盖其真实错误。
- 没有修改后端认证、事件幂等规则、材料或评分协议。界面“复制回答”已有失败提示，HTTP 下不可访问剪贴板时可手动选择文字复制。

## 验证

- npm run test:run：138 / 138。
- npm run test:collection：6 / 6（原 4 项 + 新增 2 项非安全 HTTP）。
- 新增测试用浏览器 DNS 映射把 campus.test 指到隔离测试服务；实际断言 isSecureContext=false、randomUUID/subtle 不存在、getRandomValues 可用。没有把 HTTP 强行标记为安全，也没有伪造 Crypto 对象来代替浏览器端验收。
- HTTP 下自己/AI 两分支均完成：知情同意、预测、流式回答、结果保存、刷新恢复、本人 JSON 导出。
- 单测对比 Node SHA-256：空文本、英文、中文与 emoji、分块边界、长文本及孤立代理字符。校验缺失原生接口的结果一致，并确认原生 digest 失败不会被吞掉。
- build:all、typecheck、lint 通过；dist 已重新生成。
- 校园地址 http://10.4.165.144:5200/collect.html 返回 200，响应与新构建 HTML 一致，health 返回 200。端口已有校园服务运行，未终止或重启该服务。
- 本次属于桌面 Edge 的非安全 HTTP 测试，不代替真实手机、微信内置浏览器或校园网跨设备连通性验证。

## 依据

- [MDN randomUUID](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID)：安全上下文限制。
- [MDN getRandomValues](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues)：非安全上下文可用的随机数 API。
- [MDN digest](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest)：SubtleCrypto 安全上下文限制。
- [noble-hashes 官方仓库](https://github.com/paulmillr/noble-hashes)：SHA-256 子模块与 API。

没有 Git 推送、云端部署或真实数据采集。已有校园模式文档与脚本改动保持原样。
