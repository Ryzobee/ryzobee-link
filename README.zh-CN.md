<p align="center">
  <a href="https://wiki.ryzobee.com/zh/home"><img src="public/logo.svg" width="80" alt="Ryzobee 标志"></a>
</p>

<h1 align="center">RYZOBEE LINK</h1>
<p align="center"><strong>从一段 Lua，到你手中的设备。</strong></p>
<p align="center">编写 · 模拟 · 发送 · 调试</p>
<p align="center"><a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a></p>
<p align="center"><a href="#开始">快速开始</a> · <a href="#界面预览">界面预览</a> · <a href="#静态部署">部署</a> · <a href="#ai-协作技能">AI 技能</a> · <a href="CONTRIBUTING.md">参与贡献</a></p>
<p align="center"><a href="LICENSE">MIT 开源</a> · 纯静态网页 · Web Serial · Lua + LVGL + WebAssembly</p>

面向 **Ryzobee RootMaker** 的轻量 Lua 工作台。在浏览器中编辑脚本、交互式模拟 UI、通过 USB 串口传输文件并查看日志，无需业务后端或桌面安装包。

![RYZOBEE LINK 实际运行计数器，展示 Lua 编辑器、交互模拟器和日志](docs/screenshots/workbench.png)

<p align="center"><em>真实浏览器截图：内置计数器点击三次后的状态，未连接串口设备。</em></p>

## 为什么选择 Link

- **打开即用**：纯前端静态应用，无账号、模型平台或 Electron 依赖。
- **多文件编辑**：Monaco 高亮、文件标签、本地草稿、导入导出及快捷键。
- **真实 UI 交互**：Lua + LVGL 的 WebAssembly 运行时，点击屏幕即可得到反馈。
- **串口文件管理**：读取、发送、运行和删除脚本，文件列表与容量自动更新。
- **直接发送设备**：不要求先通过模拟，不需要审核令牌。
- **浏览器 MCP 工具**：外部助手经用户在主页面授权后，共享编辑器、模拟器和设备会话。
- **离线可用**：生产版首次完成资源缓存后可离线打开。

## 开始

开发环境：Node.js 22.12+，桌面 Chrome / Edge。

```sh
npm ci
npm run dev
```

打开 `http://127.0.0.1:5180`。端口固定；已占用时明确退出，不自动启动另一个端口。

1. 点击模拟器的 ▶ 图标运行，点击屏幕中的 `ADD +1`，实时查看计数与日志；运行后同一图标变为停止。
2. 点击「连接」，选择 RootMaker 的 USB 串口。连接后自动读取设备文件和容量。
3. 点击「发送」打开弹窗，「发送后自动运行」默认勾选；点击「确认」后写入当前源码，成功后启动。取消勾选则仅写入；设备文件菜单也可直接运行。
4. 修改 Lua 后先停止，再点击 ▶ 加载当前源码。加载、停止过程中图标显示忙碌状态，不接受重复点击。日志使用「全部 / 设备串口 / 模拟器 / Link」Tab 切换来源，可叠加级别筛选。

设备文件双击读取到编辑器，或从文件的 `…` 菜单读取、下载、运行及删除。「打开」只在顶部保留；没有手动刷新入口，连接成功、写入和删除后自动更新文件列表和容量。

**发送到设备独立于模拟器**，不需要仿真通过、审核或令牌。SHA-256 只校验文件版本和传输完整性。覆盖与删除须明确确认；文件保护状态来自设备。没有新增自启设置。

## 浏览器 MCP 接口

Link 使用官方 MCP TypeScript SDK **1.30.0**，固定协议版本 **2025-11-25**，通过标准 JSON-RPC 2.0 的 `initialize`、`tools/list` 和 `tools/call` 通信。外部 AI 可调用用户页的 `window.ryzobeeLink.request(message)`，或在同一部署、同一浏览器配置中打开 `agent.html`：先调用 `window.ryzobeeLinkAgent.connect(sessionId)` 初始化，再通过 `request(sessionId, message)` 发送原始 MCP 消息。独立页面也提供会话选择、授权申请和 JSON 输入。详见[MCP 指南](docs/agent-commands.md)。

用户在主页面允许或结束控制，授权不持久化。工具与界面共享工作区、模拟器和串口；上传仅保存文件，运行是独立操作。每次 JSON-RPC 请求使用新 id；超时后用新查询 id 调用 `link.request_result` 查询原 id，并检查实际状态，不重放写入或运行。Link 仍是纯前端：采用自定义浏览器传输，无 HTTP MCP 端点、模型 API key 或后台服务。

整个 origin 都必须可信：会话和客户端 ID 无法抵御同源恶意脚本；同一 `owner.github.io` 域名下的不同 GitHub Pages 仓库仍然同源。部署路径只区分通信频道，不构成安全隔离。

## 界面预览

### 多文件编辑，思路不断线

在多个 Lua 标签之间切换，从符合固件规范的元数据模板开始。草稿保留在当前浏览器，需要备份时导出到电脑。

![多文件标签与新建 Lua 脚本的元数据模板](docs/screenshots/editor.png)

### 点击屏幕，立即交互

运行当前源码，在 240×240 模拟屏幕中操作并查看反馈。这是 UI 运行时，不是 ESP32 电气或外设模拟器。

<p align="center"><img src="docs/screenshots/simulator.png" width="360" alt="计数器点击三次后的交互式模拟器"></p>

### 日志分来源，调试更清楚

设备串口、模拟器和 Link 消息分别查看，支持级别筛选及暂停滚动。

![模拟器日志显示三次点击产生的计数输出](docs/screenshots/logs.png)

以上均为当前应用与内置示例的实际截图，没有注入模拟串口数据。设备连接面向桌面 Chrome / Edge，截图不代表本次进行了实机验收。详见[截图说明](docs/screenshots/README.md)。

## 保存与离线

### 快捷键

按钮悬停显示当前系统的快捷键；编辑区键盘图标或 `F1` 可查看清单。下表的 `Ctrl` 在 macOS 使用 `⌘`。

| 快捷键 | 操作 |
| --- | --- |
| `Ctrl+O` | 打开本地 Lua 文件 |
| `Ctrl+S` | 保存当前文件到电脑 |
| `Ctrl+Enter` | 运行 / 停止模拟器 |
| `Ctrl+Shift+Enter` | 打开发送确认，不直接写入设备 |
| `F1` | 查看快捷键 |
| `←` / `→`、`Home` / `End` | 文件标签获得焦点后切换文件 |
| `Esc` | 关闭空闲弹窗 |

快捷键与按钮共享禁用状态；中文输入法组合中、长按重复及弹窗中不触发后台操作。运行和发送组合键在编辑器中不会插入额外代码行。连接、断开和删除保留鼠标/按钮操作，不注册全局快捷键。

### 草稿与导出

- 「+」和空工作区的「新建 Lua 文件」统一使用 [`new-app.lua`](src/workspace/templates/new-app.lua) 模板：

  ```lua
  -- ryz-app/1
  -- @author: Unknown
  -- @version: 0.1.0
  -- @description: 空白 Lua 应用，尚未添加功能。
  ```

  第一行从文件首字节开始，UTF-8 无 BOM。填写实际作者和功能简介即可；名称来自文件名，不新增 `@name` 或日期字段。作者/版本/简介分别最多 80/32/256 个 UTF-8 字节，每项仅一行且不重复。初始计数示例也有完整摘要。已有草稿、导入及设备读取原样保留，不自动补写；不增加上传前的验证门槛。

- 多文件以 Tab 展示，内容和当前标签一起自动保存到本机浏览器 IndexedDB；旧版单文件草稿自动迁移。「保存」或 `Ctrl+S`（macOS 也支持 `⌘S`）仅导出当前 Tab，不上传设备。
- 打开本地文件、读取设备文件会新增 Tab，不再弹替换确认；完全相同的文件聚焦已有 Tab，同名但内容不同的文件分别保留。支持批量打开及「+」新建。
- 标签与编辑区相连，空间不足时非活动标签等宽省略，选中标签展开完整名称；超过最小宽度后横向滚动，也支持在标签条上使用鼠标滚轮。
- 每个标签的 × 关闭该浏览器草稿，不删除电脑或设备文件，不停止已运行的模拟器；重要修改请先导出。关闭最后一个标签后保留空工作区，刷新不会重新创建文件。
- 切换 Tab 不重启模拟器；仅点击「运行」加载当时选中的源码。设备覆盖、删除仍须确认。
- 刷新、关闭或离开页面时使用浏览器原生确认；浏览器要求页面有过用户交互才会显示，提示文字由浏览器控制。强制关闭进程等情况不能保证触发确认。
- 浏览器清除站点数据会删除草稿，重要内容应导出备份。
- 所有字体、编辑器 Worker、模拟器 JS/Wasm 均随应用分发，不从 CDN 动态加载。

```sh
npm run build
npm run preview
```

`dist/` 可由任意静态 HTTP 服务托管。生产版首次完整加载并完成 Service Worker 缓存后可离线使用；开发模式不注册离线缓存。PWA 更新在旧页面关闭后生效，不中途替换运行中的编辑器。首次使用仍需获取完整应用资源。不支持直接双击 `index.html` 的 `file://` 方式。

## 实机约束

- 使用固件的 `ryz-script-store/1` 协议，115200 波特率，单一串口接收者。
- 当前仅管理固件允许的 `.lua` 文件；文件名为 1–36 位 ASCII 字母、数字、`_`、`-`。
- 上传沿用设备源码上限，当前最多 16 KiB；不修改或补写用户 Lua 内容。
- 端口不能同时被 IDE、Studio 或其他监视器占用。USB 驱动与操作系统串口权限仍需正确安装/设置。
- 串口断开不停止持续供电的设备脚本；重连不重发写入或执行。停止设备脚本用文件区的「停止」。
- 当前固件在设备脚本运行期间拒绝文件读写；先停止设备脚本再读写。浏览器模拟器可独立继续运行。
- 中断、超时或设备报告无法确定提交结果时，明确显示「结果未知」，先读取设备确认，不自动重试。
- 不含整机固件烧录、设备擦除、自动联网或自动上传源码。

## 模拟器

不是 JavaScript 重画界面：使用同一套 Ryzobee C 应用运行时、Lua 解释器、LVGL 渲染和静态字体，通过 Emscripten 预编译为 WebAssembly，运行在独立 Web Worker。默认示例以 `-- ryz-app/1` 标记应用脚本。

支持 `ui.mount/update/poll`、生产运行时中的基础 Lua/board 能力以及 legacy RGB565 canvas 显示。触摸来自鼠标/指针事件。不模拟 ESP32 的电气、DMA、实时性能、无线通信或外设；不可用硬件能力明确报错，不伪造成功。

每次运行使用新的 Worker/VM。优先协作取消；运行时故障无法响应时，800ms 后终止浏览器 Worker，允许重新运行，不触碰真实设备。

预构建产物已包含在 Git 中，普通前端开发不需要安装 ESP-IDF/Emscripten。重建方法、版本锁与来源见 [simulator/README.md](simulator/README.md)。固件仓库默认从平级 `../ryzobee-firmware` 获取，也可通过 `RYZOBEE_FIRMWARE_ROOT` 指定。版本锁只约束开发时的模拟器构建，不是用户发送设备的门槛。

## 代码结构

```text
src/components/   编辑器、模拟屏幕、日志和确认框
src/commands/     MCP 服务、共享工具调度、会话授权与请求记录
src/agent/        独立 JSON-RPC 页面与 MCP 浏览器传输客户端
src/device/       串口会话、协议分帧、文件操作、ANSI 日志
src/simulator/    Worker 生命周期与 Wasm 通信
src/workspace/    本地草稿、示例和日志模型
simulator/        C 浏览器适配、CMake、固件版本锁
public/simulator/ 预构建运行时与授权文本
skills/           分开安装的 Link 操作技能与 Lua 编写技能
tests/            少量关键浏览器闭环测试
docs/             架构与实际验收记录
```

界面根据 Figma `RYZOBEE LINK / V5` 实现；保留 Ryzobee 颜色与字体、橙黑渐变，面板间隔为桌面 8px、窄屏 4px。不把演示文件、容量或连接状态伪装成真机数据。

## 静态部署

首次获取代码：`git clone https://github.com/Ryzobee/ryzobee-link.git`，进入目录后执行 `npm ci` 和 `npm run build`。

将 `dist/` 中的全部内容上传至 Nginx、GitHub Pages、Cloudflare Pages 等静态托管平台，无需在服务器运行 Node.js 或业务后端。`npm run preview` 的本地预览地址是 `http://127.0.0.1:4180`。

- 正式站点必须使用 HTTPS；本地 localhost / 127.0.0.1 可用于开发。Web Serial 需要桌面 Chrome / Edge 支持。
- 保留 `sw.js`、模拟器、字体及 Worker 的目录结构。`.wasm` 应使用 `application/wasm`，JS 使用正确的 JavaScript MIME 类型。
- 已配置相对资源路径，支持 `/ryzobee-link/` 等子目录部署；目录 URL 应重定向至带尾斜杠的形式。
- 建议为 `index.html`、`agent.html` 和 `sw.js` 配置 `Cache-Control: no-cache`，避免浏览器无法发现新版本。
- 已提供 [GitHub Pages 发布工作流](.github/workflows/pages.yml)：推送与包版本一致的标签（例如 `V1.0.0`）时构建并发布 `dist/`，普通提交和 PR 不发布。每个仓库（包括 fork）须先将 Pages 来源设为 **GitHub Actions**，并允许版本标签部署到 `github-pages` 环境。详见[部署与发版指南](docs/deployment.md)和 [V1.0.0 功能清单](docs/releases/V1.0.0.md)。fork 的标签、Release、Pages 设置不会随 PR 自动同步到上游。

## 贡献与协议

本项目原创代码使用 [MIT 协议](LICENSE)，与组织中的其他代码仓库保持一致。第三方组件保留原协议和署名，商标权不随代码协议授予。

提交与 PR 标题遵循 `emoji 前缀(范围): 简介`，固定组合与例子见 [CONTRIBUTING.md](CONTRIBUTING.md)。`main` 禁止直接推送，只能通过 PR 更新。

## 验证

### AI 协作技能

两个技能分开安装：复制各自的**完整目录**到 AI 工具的技能目录，Codex 默认为 `~/.codex/skills/`。

- [Ryzobee Link skill](skills/ryzobee-link/README.md#简体中文)：引导具备浏览器工具的 AI 操作 Link MCP 工具，管理草稿、运行仿真、传输设备脚本和查看日志。使用 fork 时换成对应的 Pages 地址。
- [RyzoBee Lua skill](skills/ryzobee-lua/README.md#简体中文)：引导 AI 读取[官方固件 docs](https://github.com/Ryzobee/ryzobee-firmware/tree/main/docs)，按目标版本编写 Lua。它独立安装；仅查文档无需本地固件仓库。

安装技能不会给 Link 添加 AI 后端、模型 API key 要求或强制上传验证步骤。

```sh
npm run typecheck
npm test
npm run test:browser
npm run test:simulator  # 先启动 npm run dev
npm run test:offline    # 先 npm run build，再启动 npm run preview
```

浏览器设备用例使用模拟字节流；不能替代实板测试。具体已执行项及限制见 [docs/validation.md](docs/validation.md)。第三方授权见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
