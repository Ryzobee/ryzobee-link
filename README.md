# RYZOBEE LINK

Ryzobee 的轻量 Lua 上位机：编辑脚本、交互式 UI 模拟、串口文件管理和彩色日志。纯前端静态应用，无账户、模型平台、业务后端或 Electron 依赖。

## 开始

开发环境：Node.js 22.12+，桌面 Chrome / Edge。

```sh
npm ci
npm run dev
```

打开 `http://127.0.0.1:5180`。端口固定；已占用时明确退出，不自动启动另一个端口。

1. 点击模拟器的「运行」，点击屏幕中的 `ADD +1`，实时查看计数与日志。
2. 点击「连接设备」，选择 RootMaker 的 USB 串口。连接后自动读取设备文件和容量。
3. 「发送到设备」仅写入当前源码。需要立即执行时勾选「发送后自动运行」；设备文件菜单也可直接运行。
4. 修改 Lua 后重新点击「运行」更新本地模拟。串口日志和模拟器日志可分别筛选。

**发送到设备独立于模拟器**，不需要仿真通过、审核或令牌。SHA-256 只校验文件版本和传输完整性。覆盖与删除须明确确认；文件保护状态来自设备。没有新增自启设置。

## 保存与离线

- 草稿自动保存到本机浏览器 IndexedDB；「保存草稿」导出 `.lua` 文件到电脑。
- 打开另一文件前确认是否替换当前草稿。读取设备文件和删除设备文件不自动删除本地草稿。
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
src/device/       串口会话、协议分帧、文件操作、ANSI 日志
src/simulator/    Worker 生命周期与 Wasm 通信
src/workspace/    本地草稿、示例和日志模型
simulator/        C 浏览器适配、CMake、固件版本锁
public/simulator/ 预构建运行时与授权文本
tests/            少量关键浏览器闭环测试
docs/             架构与实际验收记录
```

界面根据 Figma `RYZOBEE LINK / V5` 实现；保留 Ryzobee 颜色与字体、橙黑渐变、四个工作区和 12px 面板间隔。不把演示文件、容量或连接状态伪装成真机数据。

## 验证

```sh
npm run typecheck
npm test
npm run test:browser
npm run test:simulator  # 先启动 npm run dev
npm run test:offline    # 先 npm run build，再启动 npm run preview
```

浏览器设备用例使用模拟字节流；不能替代实板测试。具体已执行项及限制见 [docs/validation.md](docs/validation.md)。第三方授权见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
