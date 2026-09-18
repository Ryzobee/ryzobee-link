# Let AI operate RYZOBEE LINK

[简体中文](ai-quickstart.md) · [Back to README](../README.md) · [MCP interface reference](agent-commands.md)

Describe your task, and let AI work with files, the simulator and the device while you watch the code, display and logs in the familiar Link workspace. **Everyday use does not require writing JSON or configuring a model API key in Link.** Your AI assistant provides the model and browser tools.

This guide applies to V1.1.0 and later compatible releases. The images below show real Chrome pages running V1.1.0 and its built-in UI example. No physical device was connected.

## 1. Install the skill and describe your task

Follow the [skill installation instructions](../skills/ryzobee-link/README.md#english) to copy the entire `ryzobee-link` directory, keeping `references/` and `agents/`. This skill **operates Link**. For writing Lua, you can separately install `ryzobee-lua`; the two skills are independent.

Your AI assistant needs browser automation. Try starting with:

> Use $ryzobee-link to open <https://geekheart.github.io/ryzobee-link/>, run the built-in counter, click its button twice, and check the display and logs. Do not connect to or write to a device yet.

This is the fork used for this walkthrough. Replace it with the deployment you intend to operate. Installing the skill alone does not give an assistant browser access.

## 2. Let the two pages find each other

AI will usually open two pages in the **same browser profile, on the same site and in the same deployment directory**:

| Page | What you see | This fork's example |
| --- | --- | --- |
| User page | Editor, simulated display, device files and logs | [Open Link](https://geekheart.github.io/ryzobee-link/) |
| AI page | Target session, MCP requests and responses | [Open agent.html](https://geekheart.github.io/ryzobee-link/agent.html) |

The official deployment uses `https://ryzobee.github.io/ryzobee-link/` and `agent.html` in the same directory. First confirm that it has a release supporting MCP. **Do not mix the official user page with the fork's AI page**, or open one page in Chrome and the other in an embedded browser or incognito window.

AI discovers and selects your session on the command page, then clicks “申请授权” (Request control). The regular user page has no navigation button to the AI page; it is a separate entry point. If your assistant can run page JavaScript, it can also operate directly on the user page without a second tab. See the [direct interface instructions](../skills/ryzobee-link/references/browser-mcp.md).

## 3. Allow control on the user page

When the dialog below appears, check that the request is from the assistant you just asked to help, then click “允许本次控制” (Allow control for this session). Reject unfamiliar requests.

![Session control permission dialog on the user page](screenshots/mcp-approval.jpg)

*This permission covers the current drafts, the simulator and scripts on a connected device. It does not select a serial port for you.*

After approval, “结束 AI 控制” (End AI control) appears in the user page's top bar, and the AI page shows “已获授权” (Authorized). `disconnected` means **the device's serial port is not connected**, not that AI has lost permission. The editor and simulator do not require a board.

These three steps are independent:

| State | Who handles it | What it means |
| --- | --- | --- |
| MCP initialization | Automatic on the AI page; handled by the caller for the direct API | The tool discovery and calling protocol is ready |
| Session control permission | You approve it on the user page | This client may operate the current session |
| Device connection | You click Connect and select a serial port in the browser | Link gains serial access to the selected device |

Permission is not saved permanently. You must approve control again after the user page closes or reloads, the bound device disconnects, or a device restart is detected. Use only trusted sites.

## 4. AI sends commands; you see the actual result

AI reads the current tool list and files before sending operations. The screenshot below shows a real `simulator.status` request and response. Their matching `id` values identify the pair.

![AI page with an authorized session, a standard MCP status request and its response](screenshots/mcp-command.jpg)

*This interface is for AI and developers, not a form that everyday users need to fill in. Scroll within the result area to see the full JSON.*

A run request returning `accepted` only means that the request was accepted. AI should also check for `running` and the first frame, then verify the display or logs. Here, two press/release pairs sent through MCP changed the counter to `COUNT 2`, with a corresponding `count 2` log:

![User page showing COUNT 2 after two AI clicks, alongside Lua source and simulator logs](screenshots/mcp-simulator.jpg)

*You can end AI control from the top bar at any time. The simulator shows the actual running UI. Only the old log view was cleared before this screenshot, leaving the output from the second click. The trailing newline produces an empty row under the current display rules; it is not a duplicate execution.*

The simulator covers UI only. It does not validate physical peripherals, wireless communication or on-device performance. Editing source does not silently replace the running version; another run operation is needed to load the new source.

<details>
<summary>Developers: reproduce the commands shown in the screenshots</summary>

On an authorized AI page, send a tool discovery request:

```json
{"jsonrpc":"2.0","id":"guide-tools-1","method":"tools/list","params":{}}
```

Read the current document. Find the result in `result.structuredContent.data` and note its `id` and `sha256`:

```json
{"jsonrpc":"2.0","id":"guide-read-1","method":"tools/call","params":{"name":"workspace.read","arguments":{}}}
```

Replace the placeholders with those freshly read values. Do not copy old IDs or hashes from a screenshot:

```json
{"jsonrpc":"2.0","id":"guide-run-1","method":"tools/call","params":{"name":"simulator.run","arguments":{"documentId":"<data.id>","expectedSha256":"<data.sha256>"}}}
```

Check the run status. Pointer input, capture and stop use the `runId` returned by the run operation; use this page's `tools/list` output for the current arguments:

```json
{"jsonrpc":"2.0","id":"guide-status-1","method":"tools/call","params":{"name":"simulator.status","arguments":{}}}
```

Use a new `id` for every request, including when repeating this tutorial. The page buttons handle initialization. When calling the AI page's JavaScript API directly, first call `await window.ryzobeeLinkAgent.connect(sessionId)`, then `request(sessionId, message)`.

</details>

## 5. Connect and send to a board when you need to

Tell AI, “Send this file to my device and run it.” When prompted to connect, click Connect on the **user page**, then select the RootMaker serial port in the browser dialog. The device needs compatible firmware, and another IDE or monitor must not already be using the port.

The device workflow is: read the current draft and device file state → upload → query the result → run the saved file if requested. **Simulation is not a prerequisite; no simulation token or additional review is required.**

| Operation | Required version information | What it accomplishes |
| --- | --- | --- |
| `workspace.read` | Document ID is optional; defaults to the current document | Returns the current source's `data.id` and `data.sha256` |
| `device.read` | File name on the device | Obtains the device file's `data.sha256` before replacement |
| `device.upload` | `documentId` = draft ID; `expectedSha256` = current draft hash; `previousSha256` = old device file hash, or `""` for a new file | Saves to the device only; confirm `data.state: "committed"` |
| `device.run` | `name` of a file already saved on the device | Starts a job; check execution with `device.jobs` and logs |

Hashes protect against transfer corruption and unintended overwrites; they are not permission to execute. **`device.run` does not upload the current editor changes automatically.** Upload and run are separate AI tools. The regular page's “run after sending” checkbox in the Send dialog does not change MCP tool behavior.

No physical device was connected for these screenshots. They are not evidence of a successful device upload or physical-device acceptance testing.

## 6. Pause, end control and troubleshoot

- **End AI control:** revokes permission for subsequent operations. It does not stop a simulation or device program that is already running. To stop one, first ask AI to stop the corresponding job, or use the page's stop control.
- **Keep the user page open:** the AI page can remain in the background, but the user page must stay open. Browsers may freeze background pages, and there is no persistent web agent after all pages close. A powered device may continue running a script that has already started.
- **No session found:** check both complete URLs, the browser profile and storage partition. Select the correct target if several sessions are available. Do not troubleshoot by repeatedly sending writes.
- **Timeout or unknown result:** the AI page times out after 15 seconds. This does not prove that the operation failed, and it does not automatically cancel it. Use a new RPC ID to query the original operation ID, then check file hashes, jobs or simulator state. Do not immediately resend a write or run.
- **`SOURCE_CHANGED`:** the source changed after it was read. Read it again and preserve the user's edits; do not force an overwrite using an old hash.
- **`NOT_SEEN` / evicted result:** there is no recoverable record. This does not prove that the device did not execute the operation; inspect its actual state. Authorization and control-query tools do not retain their own operation history.
- **A “MCP server address” field cannot connect:** this static URL is not a Streamable HTTP MCP service. Use this skill with browser tools, or implement the [browser transport binding](agent-commands.md#browser-transport-binding--浏览器传输约定).

Further reading: [Install the skill](../skills/ryzobee-link/README.md#english) · [Tools and error formats](agent-commands.md) · [Deployment and version updates](deployment.md#english-summary) · [Screenshot provenance](screenshots/README.md)
