# Browser command interface / 浏览器命令接口

Link remains a static frontend. The visible user page owns the workspace, simulator and serial port. A command caller shares those services; it does not create a second serial reader or a second simulator. No API key, server process or traditional MCP server is involved.

Link 仍是纯前端。用户页面统一持有工作区、模拟器和串口；AI 与鼠标/键盘调用相同服务，不另开串口。没有新增模型 API、后台服务或必须通过的仿真关卡。

## Two entry points / 两个入口

1. User page / 用户页：`window.ryzobeeLink` exposes `hello()`, `requestControl({clientId,label})`, `execute(request)`, `result({sessionId,clientId,requestId})`.
2. Companion page / AI 页：open `agent.html` in the **same deployment directory, browser profile and storage partition**. Discover, select a session, request control, then fill “命令 JSON” and submit. `window.ryzobeeLinkAgent` additionally supports browser tools with JavaScript. The regular interface deliberately has no link to this page.

The human approves control on the main page and can end it from the existing top bar. No grant is persisted. Closing/reloading the main page, disconnecting an already bound board or observing a different boot invalidates it. A grant created without hardware can bind to the first successful connection. `device.connect` requests a main-page prompt; only its real click invokes `requestPort()`.

用户在主页面允许控制，也可从原有顶栏结束控制。授权不持久化；设备连接/启动状态变化会失效。首次授权时未连接的设备可在第一次连接后绑定。`device.connect` 只弹出连接提示，不从后台调用串口选择器。

## Request and result / 请求与结果

```js
const api = window.ryzobeeLink;
const { sessionId } = api.hello();
const clientId = crypto.randomUUID();
api.requestControl({ clientId, label: 'My AI assistant' });
// After the user approves / 等用户允许后：
await api.execute({ version: 1, sessionId, clientId,
  requestId: crypto.randomUUID(), command: 'help', args: {} });
```

The live `help` result is the command/argument source of truth. Argument types ending in `?` are optional. Unexpected fields are rejected. Requests may include an absolute `expiresAt` timestamp (milliseconds); otherwise a 60-second start deadline applies. JSON and source sizes are bounded.

| Commands | Purpose / 用途 |
| --- | --- |
| `help`, `link.status` | Discover capabilities and page state / 能力及状态 |
| `workspace.list/read/open/update/select/close` | Shared, persisted editor tabs / 草稿与标签；更新/关闭使用旧源码 hash |
| `simulator.run/status/stop/pointer/capture` | Execute, interact and inspect by runId / 真实 UI 仿真、触摸和 PNG |
| `device.connect/info/files/read/upload/run/jobs/stop` | User-assisted connection and script transfer/execution / 连接与脚本传输、运行 |
| `logs.read` | Bounded incremental logs / 以游标增量查询；包含丢失提示 |

`device.upload` writes only; `device.run` runs a saved filename independently of simulation. Replacing a device file requires its current `previousSha256` from `device.read`; new files use an empty previous hash. `expectedSha256` refers to the local document version. These are concurrency/integrity checks, not simulation approvals or execution tokens. Arbitrary Console, eval, device deletion and firmware flashing are not exposed to AI in this release.

上传仅保存文件，运行是独立命令。设备旧 hash 防止覆盖已变动文件，本地 hash 防止覆盖用户刚编辑的源码；不是仿真通行证。AI 本版不提供任意 Console、eval、设备删除或整机刷机入口。

Replies carry `version/sessionId/requestId/ok/status`, plus `data` or `error: {code,message}`:

- `completed`: operation returned; inspect its data (a file save does not mean execution).
- `accepted`: asynchronous run/stop/connect accepted. Poll `simulator.status` or `device.jobs`; inspect logs and frames.
- `rejected`: explicit error, such as `NEEDS_APPROVAL`, `NEEDS_CONNECTION`, `SOURCE_CHANGED` or `BUSY`.
- `unknown`: transport/serial outcome uncertain. Query the **original** request ID and actual state. Never blindly resend a write/run under a new ID.

Same client + requestId + command/args shares one in-flight execution or cached reply. Changed content under the same ID yields `REQUEST_CONFLICT`. The page retains fingerprints for at most 1024 requests and the latest 64 completed replies; an evicted result never executes again. Reloading clears the ledger and changes sessionId; inspect device state before resuming. Request IDs are operation identities, not credentials.

## Lifecycle and trust boundary / 生命周期与信任边界

- Direct API needs no agent page. A companion page can be backgrounded, but browser freezing/discarding can interrupt discovery or responses. Keeping the user page open is required; nothing runs after all pages are closed. A powered physical board may continue its already-started script.
- `#command=<URL-encoded JSON>` only prefills the AI page. Loading a URL never executes its contents. Keep source, private data and secrets out of URLs/history.
- BroadcastChannel requires the same origin **and storage partition**. A skill creating both tabs is useful but not proof: confirm discovery/sessionId. Same-origin code is trusted: this channel and clientId are **not authentication against malicious scripts on the same origin**. Host only trusted content on that origin, and do not embed untrusted scripts. Hiding `agent.html` is not a security control.
- Session permission controls an external assistant's workflow. It does not gate manual UI operations, impose a simulator credential or modify firmware execution rules.
- PNG capture is the simulator's latest frame, tagged with runId; it is not a device screenshot or proof of physical output.

See [skill installation / skill 安装](../skills/ryzobee-link/README.md). The separate [Lua skill](../skills/ryzobee-lua/README.md) handles target-firmware APIs.
