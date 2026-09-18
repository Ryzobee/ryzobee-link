---
name: ryzobee-link
description: 通过 Ryzobee Link 的浏览器 MCP 接口操作 Lua 草稿、UI 模拟器和设备脚本，或读取日志联调时使用。不负责 Lua API 定义或整机固件烧录。
---

# Ryzobee Link

通过用户已部署的 Link 页面完成操作。它使用 MCP `2025-11-25` 的 JSON-RPC、工具发现和调用规范，通过浏览器通信适配传输。纯静态网页不是 Streamable HTTP MCP endpoint；需要浏览器 DOM 或页面 JavaScript 工具，不能仅将网页地址填入普通 HTTP MCP 客户端。无需本地服务、扩展或模型 API key。

## 建立会话

1. 确认用户要使用的 Link 地址；默认官方站点为 `https://ryzobee.github.io/ryzobee-link/`，若用户指定 fork 或本地地址则使用该地址。先复用目标页面；需要新建时，用同一浏览器、同一 profile 打开用户页并保持它打开。
2. 打开同目录的 `agent.html`，如 `https://ryzobee.github.io/ryzobee-link/agent.html`，点击“发现会话”。选定用户会话后点击“申请授权”；页面自动完成 MCP 初始化并调用授权工具。多个会话时核对 `sessionId`，不猜测目标。未发现时检查完整地址、浏览器/profile、隐身窗口和存储分区，不重复提交操作。
3. 提示用户在用户页点击“允许本次控制”。授权仅限本次会话；设备断开、重新启动或用户结束控制后需重新授权。使用 `link.control_status` 工具确认 `control: "granted"` 且 `clientId` 匹配。正常工作不要代替用户点击授权；仅在用户明确委托 UI 验收时可模拟该点击。

支持页面 JavaScript 的工具可不打开 AI 页，直接调用 `window.ryzobeeLink.request(message)`。此路径先按 [browser-mcp.md](references/browser-mcp.md) 建立客户端并完成标准 `initialize` → `notifications/initialized`；该参考只在直接 API 或底层传输接入时读取。

主页面持有串口、模拟器和草稿。AI 页可以后台使用，但浏览器可能冻结后台页；超时不代表操作失败。支持直接 API 时可以完全不打开 AI 页；关闭所有页面后没有常驻后台代理。

## 调用命令

先在 AI 页的“MCP JSON-RPC”文本框填写标准 `tools/list`，点击“发送 MCP 请求”，按当前返回的 `inputSchema` 填参数。结果在“MCP 响应”区域的 `#command-result`。

```json
{"jsonrpc":"2.0","id":"list-1","method":"tools/list","params":{}}
```

调用工具使用 `tools/call`，例如读取当前草稿：

```json
{"jsonrpc":"2.0","id":"read-1","method":"tools/call","params":{"name":"workspace.read","arguments":{}}}
```

支持脚本调用的 AI 页公开 `window.ryzobeeLinkAgent.discover()`、`connect(sessionId)`、`request(sessionId, message)`，后者传入相同的原始 MCP JSON-RPC 消息。路由由适配层补到命名空间 `_meta`，不改变工具参数。

每条 JSON-RPC 请求使用从未用过的新 `id`；通知没有 `id`，也没有响应。超时/结果未知时保留原 ID，点击“查询结果”，或使用**新 ID** 调用 `link.request_result`，参数为 `{"requestId":"原 ID"}`。随后查询实际文件 hash、任务或仿真状态，不自动重发写入/运行。`result.isError` 表示工具执行错误，`error.code` 表示协议错误；正常结果的 `structuredContent.status: "accepted"` 仅表示受理。

## 选择工作流

- **编辑**：`workspace.list/read` 获取文档 ID 和 hash；新增用 `workspace.open`，已有文档用 `workspace.update` 并带读取到的 `expectedSha256`。若用户已修改导致 `SOURCE_CHANGED`，重新读回并保留用户改动。草稿是浏览器存储，不是电脑文件。
- **仿真**：`simulator.run` 后按返回的 `runId` 查询 `simulator.status`；`running`、首帧和运行日志才是执行证据。需要交互时对同一个 `runId` 调用 `simulator.pointer` 按下/释放，再读取 `simulator.capture` 的标准 MCP `image` 内容块和增量日志。状态变化时重新查询，不对旧 runId 发操作。仅 UI 模拟，不能证明真实外设或设备运行。
- **设备**：先 `device.info`；若 `NEEDS_CONNECTION`，请用户在主页面的连接弹窗点击并选择串口。页面脚本无法替用户提供浏览器的可信点击。按任务需要读取文件或停止现有任务，避免接管无关程序。上传用 `device.upload`：新文件的 `previousSha256` 为 `""`，覆盖文件先 `device.read` 得到旧 hash。上传成功后，只有任务要求运行时才调用 `device.run`，再查 `device.jobs` 和日志。设备运行独立于仿真，不增加仿真、审核或令牌前置步骤。
- **调试**：`logs.read` 使用返回游标增量读取；按 `runId` 或 `jobId` 区分运行，`truncated` 表示有日志丢失。结合原源码 hash、错误行和实际画面定位；修订源码后再按用户要求仿真或运行。模糊输出不是完成证据。

需要编写/修改 Lua 时，若安装了 `ryzobee-lua`，使用它查目标固件版本的官方文档；否则直接查 `https://github.com/Ryzobee/ryzobee-firmware/tree/main/docs`。两个 skill 独立安装，Link 不内置固件 API 清单。

交付时区分已保存、已上传、已受理、仿真实际运行和真机实际运行。没有设备就说明未做真机验证。任务完成后可结束 AI 控制，但不擅自停止用户要持续运行的设备程序。
