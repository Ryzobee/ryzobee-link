# V1.1.0 验证记录

环境：macOS、桌面 Chrome；纯前端和浏览器仿真。此记录不复用首版真机结果，不代表本版物理设备验收。

## 本地验证

- `npm run build`：类型检查、双页面生产构建、157 个本地静态资源离线缓存生成通过。Monaco 大 chunk 警告仍存在。
- `npm test -- src/commands/owner.test.ts src/device/session.test.ts`：9/9 通过。包括未授权拒绝、并发去重、参数冲突、过期、等待中撤权、设备身份变化、结果淘汰不重放，以及原设备协议聚合回归。
- 新增 `tests/agent-commands.spec.ts`：2/2 通过。真实 Chrome 双页面 BroadcastChannel 与 JSON 表单；外部源码更新显示在 Monaco；真实 Lua/LVGL Wasm 启动、指针点击、按 runId 日志、PNG 内容变化、停止；URL 预填不执行；结束授权后拒绝命令。
- 同一文件的设备路径使用**模拟串口字节流**：用户页手势连接、无仿真上传、文件 hash 校验、重复编号只发一次 run、实时任务查询和停止。不是实体板证明。
- 既有 `device-workflow.spec.ts`：4/4；`workspace-tabs.spec.ts`、`simulator-ui.spec.ts`：2/2 定向回归通过。未跑全量测试。
- `ryzobee-link` skill 的 frontmatter/命名校验通过。既有 `ryzobee-lua` 未改动。

## 独立审核与故障路径

独立子代理审查了共享命令核心、串口写前检查、请求账本和页面传输。已修复并复查：

1. 不拔 USB 的设备重启：不同 boot 事件使设备身份失效；upload/run/stop 前查询 fresh info，再检查授权。内存串口故障注入确认静默重启只发出 info，没有发出 console。
2. 不合法的 requestId 在客户端明确拒绝，不因回显截断误报为传输超时。
3. 排队串口变更在真正写出前再次检查授权；已撤销的请求不发送。
4. 保留请求指纹而淘汰回复正文；旧编号不会因缓存淘汰重新执行。指纹使用 SHA-256，不为每条记录保留整份源码。

AI 页独立检查覆盖 transportId 不匹配、15 秒超时不重发、按原编号查结果、刷新保留 clientId、多会话选择、fragment 只预填。生产离线检查覆盖 `agent.html?query` 正确回退、不同 scope 缓存不互删、scope 外请求不拦截。

## 视觉与线上验收

已检查用户页授权弹窗、顶栏结束控制和仿真实际运行截图；没有向常规界面添加 AI 页入口或额外状态行。AI 页在 1440、360 和 320 px 检查无横向溢出。

fork Pages 的线上 skill 实操在标签部署后进行，结果记录到对应 GitHub Release / PR，不能以此发布前文档声称线上已通过。组织页面只有合并后单独发布才会更新。

## 明确限制

- 本版未操作实体板、未测试实体触摸，也未修改固件。
- AI 需浏览器工具；静态 URL 不是传统 MCP endpoint。
- 信任单位是整个 origin，BroadcastChannel 的路径与 clientId 不是抵御恶意同源代码的身份认证。
- 后台页会受浏览器冻结/丢弃策略影响；结果不确定时查询状态，不自动重放。
- Windows/Linux 串口驱动及实际设备连接仍需对应系统验收。
