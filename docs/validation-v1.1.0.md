# V1.1.0 验证记录

环境：macOS、桌面 Chrome；纯前端和浏览器仿真。此记录不复用首版真机结果，不代表本版物理设备验收。

## 本地验证

- `npm run build`：类型检查、双页面生产构建、离线缓存生成通过。Monaco 大 chunk 警告仍存在。
- `npm test -- src/commands/mcp.test.ts src/commands/owner.test.ts src/device/session.test.ts`：15/15 通过。覆盖官方 SDK Client 不改源码互通、版本协商/初始化/通知、JSON Schema 工具发现、参数错误与工具错误分类、标准截图 image 内容、唯一 RPC ID、按原 ID 查结果，以及权限/串口回归。
- 新增 `tests/agent-commands.spec.ts`：2/2 通过。真实 Chrome 双页面的原始 MCP JSON-RPC 与 BroadcastChannel；外部源码更新显示在 Monaco；真实 Lua/LVGL Wasm 启动、指针点击、按 runId 日志、PNG 内容变化、停止；URL 预填不执行；结束授权后拒绝工具调用。
- 同一文件的设备路径使用**模拟串口字节流**：用户页手势连接、无仿真上传、文件 hash 校验、重复 RPC ID 拒绝且只发一次 run、新 ID 查询原结果、实时任务查询和停止。不是实体板证明。
- 既有 `device-workflow.spec.ts`：4/4；`workspace-tabs.spec.ts`、`simulator-ui.spec.ts`：2/2 定向回归通过。未跑全量测试。
- `ryzobee-link` skill 的 frontmatter/命名校验通过。既有 `ryzobee-lua` 未改动。

## 独立审核与故障路径

独立子代理审查了共享命令核心、串口写前检查、请求账本和页面传输。已修复并复查：

1. 不拔 USB 的设备重启：不同 boot 事件使设备身份失效；upload/run/stop 前查询 fresh info，再检查授权。内存串口故障注入确认静默重启只发出 info，没有发出 console。
2. MCP 请求/通知通过官方 schema 校验；参数错误使用 `-32602`，工具执行错误使用 `isError`，避免将无效参数误归为 SDK 内部错误 `-32603`。先有失败用例再修复。
3. 排队串口变更在真正写出前再次检查授权；已撤销的请求不发送。
4. 保留请求指纹而淘汰回复正文；旧编号不会因缓存淘汰重新执行。指纹使用 SHA-256，不为每条记录保留整份源码。
5. 取消通知使挂起请求结束且不提交后续写入；未声明的 MCP Tasks 在 SDK 分派前拒绝，不执行工具。5000 次无目标会话的发现 ping 不耗尽操作会话预算。

AI 页保留路由与 RPC ID 匹配、15 秒本地超时、按原编号查询、刷新保留 clientId 和多会话选择；MCP 通知无响应。URL fragment 仅预填不执行。生产离线检查覆盖 `agent.html?query` 正确回退、不同 scope 缓存不互删、scope 外请求不拦截。

## 视觉与线上验收

已检查用户页授权弹窗、顶栏结束控制和仿真实际运行截图；没有向常规界面添加 AI 页入口或额外状态行。AI 页在 1440、360 和 320 px 检查无横向溢出。

fork Pages 的线上 skill 实操在标签部署后进行，结果记录到对应 GitHub Release / PR，不能以此发布前文档声称线上已通过。组织页面只有合并后单独发布才会更新。

## 明确限制

- 本版未操作实体板、未测试实体触摸，也未修改固件。
- AI 需浏览器工具；静态 URL 不是传统 MCP endpoint。
- 信任单位是整个 origin，BroadcastChannel 的路径与 clientId 不是抵御恶意同源代码的身份认证。
- 后台页会受浏览器冻结/丢弃策略影响；结果不确定时查询状态，不自动重放。
- Windows/Linux 串口驱动及实际设备连接仍需对应系统验收。
- `npm audit --omit=dev` 报告既有 Monaco/DOMPurify 的 1 项 moderate 和 1 项 low；没有本轮 SDK 的 high/critical 告警。未用强制依赖降级混入本次功能交付。
