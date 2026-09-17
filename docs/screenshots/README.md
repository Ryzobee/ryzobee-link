# README screenshots / README 截图

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
