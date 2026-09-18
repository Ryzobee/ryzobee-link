# Browser MCP interface / 浏览器 MCP 接口

Link remains a static frontend. The visible user page owns the workspace, simulator and serial port. The official `@modelcontextprotocol/sdk` implements MCP **2025-11-25** JSON-RPC, lifecycle and tool messages, over a custom browser transport. There is no HTTP listener, stdio process or model API key. A normal HTTP MCP client cannot use this static URL without a browser transport adapter.

Link 仍是纯前端。用户页面统一持有工作区、模拟器和串口；AI 与鼠标/键盘调用相同服务，不另开串口。消息使用 MCP 标准，不自定义控制信封；浏览器传输适配仅负责路由。支持固定版本 2025-11-25，不声明支持新版本的无握手协议或实验性 Tasks。

## Two entry points / 两个入口

1. User page / 用户页：`window.ryzobeeLink.request(message)` accepts raw MCP JSON-RPC and returns its response (notifications return `undefined`). Direct callers perform `initialize` → `notifications/initialized` themselves.
2. Companion page / AI 页：open `agent.html` in the **same deployment directory, browser profile and storage partition**. Discover, select a session, request control, then fill “MCP JSON-RPC” and click “发送 MCP 请求”. The page handles initialization. JavaScript callers may use `window.ryzobeeLinkAgent.discover()`, `connect(sessionId)` and `request(sessionId,message)`. The regular UI has no link to this page.

The human approves control on the main page and can end it from the existing top bar. No grant is persisted. Closing/reloading the main page, disconnecting an already bound board or observing a different boot invalidates it. A grant created without hardware can bind to the first successful connection. `device.connect` requests a main-page prompt; only its real click invokes `requestPort()`.

用户在主页面允许控制，也可从原有顶栏结束控制。授权不持久化；设备连接/启动状态变化会失效。首次授权时未连接的设备可在第一次连接后绑定。`device.connect` 只弹出连接提示，不从后台调用串口选择器。

## Request and result / 请求与结果

```json
{"jsonrpc":"2.0","id":"list-1","method":"tools/list","params":{}}
```

```json
{"jsonrpc":"2.0","id":"read-1","method":"tools/call","params":{"name":"workspace.read","arguments":{}}}
```

`tools/list` returns standard tool definitions with JSON Schema `inputSchema` and annotations; this is the live source of truth. Use `tools/call` for every control operation. Unexpected tool arguments are rejected. JSON, source sizes and execution start deadlines are bounded. Requests have unique string/integer IDs; notifications have no ID and receive no response.

| Commands | Purpose / 用途 |
| --- | --- |
| `tools/list` | Standard MCP tool discovery / 标准工具发现 |
| `link.request_control/control_status/request_result`, `link.status` | Human control grant, prior result and page state / 授权、历史结果和页面状态 |
| `workspace.list/read/open/update/select/close` | Shared, persisted editor tabs / 草稿与标签；更新/关闭使用旧源码 hash |
| `simulator.run/status/stop/pointer/capture` | Execute, interact and inspect by runId / 真实 UI 仿真、触摸和 PNG |
| `device.connect/info/files/read/upload/run/jobs/stop` | User-assisted connection and script transfer/execution / 连接与脚本传输、运行 |
| `logs.read` | Bounded incremental logs / 以游标增量查询；包含丢失提示 |

`device.upload` writes only; `device.run` runs a saved filename independently of simulation. Replacing a device file requires its current `previousSha256` from `device.read`; new files use an empty previous hash. `expectedSha256` refers to the local document version. These are concurrency/integrity checks, not simulation approvals or execution tokens. Arbitrary Console, eval, device deletion and firmware flashing are not exposed to AI in this release.

上传仅保存文件，运行是独立命令。设备旧 hash 防止覆盖已变动文件，本地 hash 防止覆盖用户刚编辑的源码；不是仿真通行证。AI 本版不提供任意 Console、eval、设备删除或整机刷机入口。

All responses use `{jsonrpc:"2.0",id,result}` or `{jsonrpc:"2.0",id,error:{code,message}}`. Protocol errors use integer JSON-RPC codes; tool/business errors use MCP `CallToolResult.isError:true`. Tool results contain `content` text and `structuredContent: {status,data?,error?}`. Screenshots use standard `{type:"image",mimeType:"image/png",data:"<base64>"}` blocks, with run metadata in structured content.

Domain status meanings / 业务状态含义：

- `completed`: operation returned; inspect its data (a file save does not mean execution).
- `accepted`: asynchronous run/stop/connect accepted. Poll `simulator.status` or `device.jobs`; inspect logs and frames.
- `rejected`: explicit error, such as `NEEDS_APPROVAL`, `NEEDS_CONNECTION`, `SOURCE_CHANGED` or `BUSY`.
- `unknown`: a device operation has an uncertain outcome. Browser transport timeouts are local exceptions, not fabricated server replies. Query the original operation and actual state; never blindly resend a write/run.

MCP request IDs must **not** be reused within a client connection. Duplicate requests are rejected without re-executing. To recover a lost result, send a **new** RPC request calling `link.request_result` with `arguments:{requestId:<original id>}`. The page retains at most 1024 operation fingerprints and 64 completed operation replies; evicted results never cause execution. Reloading clears records and changes the page session; inspect actual device state before resuming. IDs are not authorization credentials.

## Browser transport binding / 浏览器传输约定

All BroadcastChannel frames are raw JSON-RPC, without a proprietary wrapper. The channel is `ryzobee-link:mcp:v1:<deployment-directory>`, such as `ryzobee-link:mcp:v1:/ryzobee-link/`. Routing is carried by the standard `_meta` extension mechanism: `params._meta["com.ryzobee.link/transport"]={clientId,sessionId}`. Successful responses echo it in `result._meta`; protocol errors put the routing object under the same key in `error.data`.

A standard `ping` without a target session discovers pages; its result metadata includes `owner` and `initialized`. Other requests specify a target page. Each client initializes separately and has its own request IDs. User permission is separate from MCP initialization: use the `link.request_control` tool and wait for the user. Direct API examples and reconnection details are in the [skill transport reference](../skills/ryzobee-link/references/browser-mcp.md).

This browser binding is a **custom transport**, not a standard Streamable HTTP endpoint. It follows MCP's permitted custom-transport boundary while preserving protocol messages and lifecycle. References: [base protocol](https://modelcontextprotocol.io/specification/2025-11-25/basic), [tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools), [custom transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#custom-transports).

## Lifecycle and trust boundary / 生命周期与信任边界

- Direct API needs no agent page. A companion page can be backgrounded, but browser freezing/discarding can interrupt discovery or responses. Keeping the user page open is required; nothing runs after all pages are closed. A powered physical board may continue its already-started script.
- `#command=<URL-encoded JSON>` only prefills the AI page. Loading a URL never executes its contents. Keep source, private data and secrets out of URLs/history.
- BroadcastChannel requires the same origin **and storage partition**. A skill creating both tabs is useful but not proof: confirm discovery/sessionId. Same-origin code is trusted: this channel and clientId are **not authentication against malicious scripts on the same origin**. Host only trusted content on that origin, and do not embed untrusted scripts. Hiding `agent.html` is not a security control.
- Session permission controls an external assistant's workflow. It does not gate manual UI operations, impose a simulator credential or modify firmware execution rules.
- PNG capture is the simulator's latest frame, tagged with runId; it is not a device screenshot or proof of physical output.

See [skill installation / skill 安装](../skills/ryzobee-link/README.md). The separate [Lua skill](../skills/ryzobee-lua/README.md) handles target-firmware APIs.
