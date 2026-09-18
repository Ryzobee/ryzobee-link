---
name: ryzobee-link
description: 通过 Ryzobee Link 浏览器命令接口操作 Lua 草稿、交互式 UI 模拟器和设备脚本，或读取运行日志进行联调时使用。不负责 Lua API 定义或整机固件烧录。
---

# Ryzobee Link

通过用户已部署的 Link 页面完成操作。它是纯静态网页，不是 HTTP MCP 服务；浏览器工具需要能打开页面并操作 DOM，或调用页面公开的 JavaScript 接口。无需启动本地服务、安装浏览器扩展或填写模型 API key。

## 建立会话

1. 确认用户要使用的 Link 地址；默认官方站点为 `https://ryzobee.github.io/ryzobee-link/`，若用户指定 fork 或本地地址则使用该地址。先复用目标页面；需要新建时，用同一浏览器、同一 profile 打开用户页并保持它打开。
2. 若工具允许调用页面 API，优先使用用户页的 `window.ryzobeeLink`。调用 `hello()` 获取 `sessionId`，生成本次任务的 `clientId`，再调用 `requestControl({clientId,label})`。
3. 若工具只能操作普通网页，打开同目录的 `agent.html`，如 `https://ryzobee.github.io/ryzobee-link/agent.html`。页面没有从用户界面进入的链接。点击“发现会话”，选择明确的用户会话，再点击“申请授权”。多个会话时核对 `sessionId`，不猜测目标。发现不到时检查完整地址、浏览器/profile、隐身窗口和存储分区，而不是重复提交命令。
4. 提示用户在用户页点击“允许本次控制”。授权是本次浏览器会话的控制范围，不是烧录凭证；设备断开、重新启动或用户结束控制后需重新授权。得到 `control: "granted"` 且 `clientId` 匹配后再操作。正常工作不要代替用户点击授权；仅在用户明确委托 UI 验收时可模拟该点击。

主页面持有串口、模拟器和草稿。AI 页可以后台使用，但浏览器可能冻结后台页；超时不代表操作失败。支持直接 API 时可以完全不打开 AI 页；关闭所有页面后没有常驻后台代理。

## 调用命令

先执行 `help`，按当前页面返回的参数定义操作，不把历史固件接口当作 Link 命令。

直接 API 的请求形状：

```js
await window.ryzobeeLink.execute({
  version: 1, sessionId, clientId,
  requestId: crypto.randomUUID(),
  command: 'help', args: {}
})
```

AI 页的“命令 JSON”只需填写以下内容，再点击“提交命令”；会话与 clientId 由页面补齐。结果在“JSON 结果”区域的 `#command-result`。

```json
{"requestId":"help-1","command":"help","args":{}}
```

支持脚本调用的 AI 页还公开 `window.ryzobeeLinkAgent`：`discover()`、`requestControl({sessionId,label})`、`execute({sessionId,requestId,command,args})`、`result({sessionId,requestId})`。

每个新动作使用新的 `requestId`。超时/`unknown` 时保留原编号：直接入口调用 `result({sessionId,clientId,requestId})`，AI 页点击“查询结果”或调用其 `result()`。随后查询实际文件 hash、任务或仿真状态。不自动重发写入/运行；新编号会被当作新的操作。`accepted` 表示受理，不表示脚本成功运行。

## 选择工作流

- **编辑**：`workspace.list/read` 获取文档 ID 和 hash；新增用 `workspace.open`，已有文档用 `workspace.update` 并带读取到的 `expectedSha256`。若用户已修改导致 `SOURCE_CHANGED`，重新读回并保留用户改动。草稿是浏览器存储，不是电脑文件。
- **仿真**：`simulator.run` 后按返回的 `runId` 查询 `simulator.status`；`running`、首帧和运行日志才是执行证据。需要交互时对同一个 `runId` 发送 `simulator.pointer` 按下/释放，再读取 `simulator.capture` PNG 和增量日志。状态变化时重新查询，不对旧 runId 发操作。仅 UI 模拟，不能证明真实外设或设备运行。
- **设备**：先 `device.info`；若 `NEEDS_CONNECTION`，请用户在主页面的连接弹窗点击并选择串口。页面脚本无法替用户提供浏览器的可信点击。按任务需要读取文件或停止现有任务，避免接管无关程序。上传用 `device.upload`：新文件的 `previousSha256` 为 `""`，覆盖文件先 `device.read` 得到旧 hash。上传成功后，只有任务要求运行时才调用 `device.run`，再查 `device.jobs` 和日志。设备运行独立于仿真，不增加仿真、审核或令牌前置步骤。
- **调试**：`logs.read` 使用返回游标增量读取；按 `runId` 或 `jobId` 区分运行，`truncated` 表示有日志丢失。结合原源码 hash、错误行和实际画面定位；修订源码后再按用户要求仿真或运行。模糊输出不是完成证据。

需要编写/修改 Lua 时，若安装了 `ryzobee-lua`，使用它查目标固件版本的官方文档；否则直接查 `https://github.com/Ryzobee/ryzobee-firmware/tree/main/docs`。两个 skill 独立安装，Link 不内置固件 API 清单。

交付时区分已保存、已上传、已受理、仿真实际运行和真机实际运行。没有设备就说明未做真机验证。任务完成后可结束 AI 控制，但不擅自停止用户要持续运行的设备程序。
