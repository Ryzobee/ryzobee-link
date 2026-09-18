# Direct browser MCP

只在直接调用用户页 JavaScript 或接入浏览器传输时使用。普通 DOM 工具用 `agent.html` 即可。

用户页公开 `window.ryzobeeLink.request(message)`，输入原始 MCP JSON-RPC，返回原始响应；通知返回 `undefined`。支持 MCP `2025-11-25`。为本次客户端生成 `clientId`，每条消息的 `params._meta["com.ryzobee.link/transport"]` 带 `{clientId, sessionId}`。`sessionId` 首次发现可省略；它是页面路由而非权限凭证。

```js
const clientId = crypto.randomUUID();
let sessionId;
const rpc = message => window.ryzobeeLink.request({
  ...message,
  params: { ...message.params, _meta: {
    ...message.params?._meta,
    'com.ryzobee.link/transport': { clientId, sessionId }
  }}
});
const pong = await rpc({jsonrpc:'2.0', id:crypto.randomUUID(), method:'ping'});
sessionId = pong.result._meta['com.ryzobee.link/transport'].sessionId;
const initialized = await rpc({jsonrpc:'2.0', id:crypto.randomUUID(), method:'initialize', params:{
  protocolVersion:'2025-11-25', capabilities:{},
  clientInfo:{name:'browser-assistant',version:'1.0.0'}
}});
// Verify returned protocolVersion before continuing.
await rpc({jsonrpc:'2.0', method:'notifications/initialized'});
await rpc({jsonrpc:'2.0', id:crypto.randomUUID(), method:'tools/list', params:{}});
await rpc({jsonrpc:'2.0', id:crypto.randomUUID(), method:'tools/call', params:{
  name:'link.request_control', arguments:{label:'Browser assistant'}
}});
```

等待用户允许后，通过 `tools/call` 调用所需工具。工具业务结果在 `result.structuredContent`：`status`、`data` 或 `error`；同时提供 `content` 文本以兼容 MCP 客户端。截图在 `content` 的 `image` 块中，为 PNG base64。不要把设备 jobId 或仿真 runId 当作实验性 MCP Tasks ID。

每条请求 ID 唯一。结果查询也是一次标准工具调用，用新的 RPC ID：

```json
{"jsonrpc":"2.0","id":"query-2","method":"tools/call","params":{"name":"link.request_result","arguments":{"requestId":"original-call-1"}}}
```

客户端原页面仍存在时，`ping` 响应的路由元数据 `initialized:true` 表示同一个 clientId 已完成 MCP 初始化，可恢复查询。主页面重新加载后 sessionId 会改变，重新初始化并征得授权；先查询设备实际状态，不重放旧写入。

如直接使用 BroadcastChannel，频道为 `ryzobee-link:mcp:v1:<部署目录路径>`，例如末段 `/ryzobee-link/`。所有帧仍是原始 JSON-RPC；请求路由放在上述 `_meta`，成功响应在 `result._meta`，协议错误响应在 `error.data` 使用相同路由键。无 sessionId 的 `ping` 用于发现，可能收到多个不同页面的响应；其他消息指定目标 sessionId。匹配路由和 RPC ID，再读取结果。浏览器传输超时是本地异常，不伪造为服务端工具结果。

整个同源环境必须可信。此适配不是 stdio/Streamable HTTP；通用 MCP 客户端需实现浏览器 Transport，静态网页 URL 本身不能作为 HTTP MCP endpoint。规范：[MCP lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)、[tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)、[custom transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#custom-transports)。
