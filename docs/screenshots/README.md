# README screenshots / README 截图

## MCP walkthrough / MCP 图文指南

Captured on 2026-09-19 from the actual **V1.1.0 fork Pages** at `https://geekheart.github.io/ryzobee-link/`, using desktop Chrome with a 1470×923 CSS-pixel viewport. Captures use the bundled `ui_demo.lua`, real MCP form submissions and Lua/LVGL Wasm; no physical board, fake serial data, mocked responses or composited UI.

2026-09-19 从 fork 的 V1.1.0 线上页面实拍。授权弹窗按界面边界直接截图，其余为完整页面或视口；没有修改页面 DOM 来伪造内容。图用于[上手指南](../ai-quickstart.md)。

| File | Content / 内容 |
| --- | --- |
| `mcp-approval.jpg` | Main-page session permission dialog / 用户页允许本次控制 |
| `mcp-command.jpg` | Matching `guide-status-1` MCP request/response, running state / 对应的请求、响应及真实运行状态 |
| `mcp-simulator.jpg` | Two MCP press/release pairs produce COUNT 2 / 两次命令触摸后的画面、源码和日志 |

The log view was cleared before the second click to remove earlier-session output; the picture shows `count 2` and the existing trailing-newline blank row. Session/client IDs identify an ephemeral browser session, not credentials. Screenshots are UI evidence only; no device upload/run is claimed. Simulation was stopped and session control revoked after capture.

重拍时使用同站点用户页和 `agent.html`，申请授权并记录弹窗，读取内置示例和 hash 后启动，等待 `running` 再记录状态查询；发送两组按下/释放并核对日志，截取用户页。保留未连接状态，完成后停止本次仿真并撤销控制。不要复制截图中的旧会话 ID、runId 或 hash。

## Original workspace gallery / 原工作区图集

Captured on 2026-09-17 from RYZOBEE LINK at a 1440×900 CSS-pixel viewport, using an isolated Chrome session and the bundled `ui_demo.lua`. The UI currently uses Chinese labels.

2026-09-17 在隔离 Chrome 会话中，以 1440×900 CSS 像素视口截取当前 Link 界面。运行内置 `ui_demo.lua`，依次点击三次，逐次等待真实模拟器日志返回计数后截图。没有连接设备或注入模拟串口数据。

| File | Content / 内容 |
| --- | --- |
| `workbench.png` | Full workspace after three clicks / 三次点击后的完整工作区 |
| `editor.png` | Second tab with the default script header / 新建第二个标签的脚本头部 |
| `simulator.png` | Actual simulator panel, COUNT 3 / 实际模拟器面板 |
| `logs.png` | Actual simulator output / 实际模拟器日志 |

Panel images are direct element screenshots, not composited mockups. These screenshots demonstrate browser UI behavior, not physical hardware validation. To refresh, use a clean browser session, run the bundled demo, click its ADD button three times, capture the workspace/simulator/log panels, then create `my_app.lua` and capture the editor panel. Keep the device disconnected; do not show fake connected-device data as real evidence.

局部图片直接截取对应元素，未拼接或绘制假界面。更新截图时按上述流程操作并确认输出；保持设备未连接，不把模拟数据伪装成实机结果。
