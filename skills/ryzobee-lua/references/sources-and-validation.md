# 源码导航与验证

读取条件：定位真实实现、更新 API 摘要，或准备验证/交付脚本。

## 选择正确工作树

本技能基线为 2026-09-17 Ryzobee 工作树的 `firmware/rootmaker`，`PROJECT_VER=0.10.1`。仓库 HEAD 为 `272234fd87b00bd7fb81e870c80a451a75c9d816`，**另有未提交实现**，不能只凭 commit 或版本号断言源码相同。该历史指纹不是可下载的完整发布快照，也不是 Link 内置 Wasm 的兼容性承诺。

名为 `ryzobee-firmware` 的相邻目录可能是独立仓库；按用户指定任务/cwd/工程配置选择，不因目录更短就切过去。注册表缺少某 API 时，不把本技能描述当兼容层或自动下载理由。

本次抽查 SHA-256（用于识别漂移，不是阻止合法更新）：

- `components/ryz_runtime/app_runtime.c`: `991124cde66d8533335331a48cdcec4db61790845a37c2e02f05eaadb778ef91`
- `components/ryz_script_metadata/ryz_script_metadata.c`: `1fd78a4d27bb10f7a0fc7c12522f7574c9a1f6b611c95ce7c3e3fa0426944e4c`

下表路径均相对选定的固件根。优先查实现符号，行号可能漂移。

| 问题 | 首要证据 |
| --- | --- |
| 头部标签/UTF-8/截断 | `components/ryz_script_metadata/ryz_script_metadata.c`、`include/ryz_script_metadata.h`，符号 `ryz_script_metadata_parse` |
| APPS 文件名/大小/日期/boot.lua | `components/ryz_script_store/ryz_script_store.c` 及其 include；`components/ryz_apps/ryz_apps.c` |
| App 路由/模块/显示与 UI | `components/ryz_runtime/app_runtime.c`，`ryz_app_is_source/require_native/open_board/parse_ui_object/ui_update/ui_poll` |
| legacy 模块与沙箱 | `components/ryz_runtime/lua_runtime.c`、`lua_sandbox.h`、`lua_coroutines.h` |
| 运行内存、结果缓冲、ABI | `components/ryz_runtime/include/lua_runtime.h`、`app_runtime.h` |
| Wi-Fi/BLE/IMU/HID | `components/ryz_runtime/lua_hardware.h`、`lua_hardware_esp.c`、`include/ryz_lua_hardware.h` |
| handle 外设 | `components/ryz_runtime/lua_peripherals.h`、`peripheral_esp.c`、`include/ryz_peripheral.h` |
| 引脚许可而非数字范围 | `components/ryz_tool_pins/ryz_tool_pins.c`，`ryz_tool_pin_reason` |
| tools facade / 原生异步任务 | `components/ryz_runtime/app_tools.c`、`components/ryz_tools/ryz_tools.c`、`components/ryz_workbench/workbench_tools.c` |
| UI schema / 字体 / 真渲染 | `components/ryz_lvgl/include/ryz_ui.h`、`ryz_lvgl.c`、`components/ryz_font/ryz_font.c` |
| 冻结 Lua 版本与数值配置 | `components/ryz_runtime/idf_component.yml`、`managed_components/georgik__lua/include/luaconf.h`、`managed_components/georgik__lua/lua/onelua.c` |
| BOOT 与 Job 生命周期 | `components/ryz_workbench/include/workbench_boot_key.h`、`workbench.c`，再按符号搜索实际 owner |

全文搜索先用 `rg`，不要凭记忆猜 `workbench_job.c` 等文件名。根工程补充说明在 `docs/software/firmware-lua-platform.md`；旧说明与当前注册表冲突时以当前实现/测试为准，明确指出差异。

## 参考脚本的优先级

1. `scripts/tool_monitor.lua` / `fs/tool_monitor.lua`：UI 增量刷新、暂停后滚动、有界日志、uart/log handle。
2. `scripts/tool_i2c.lua` / `fs/tool_i2c.lua`：公开 I2C handle、分步扫描、列表。
3. `scripts/tool_hardware.lua`：现有板载能力；仅实现过的模块，不由名字推测。
4. `scripts/lua_platform_demo.lua`：无线状态、IMU 显式初始化、HID。
5. `scripts/ui_demo.lua` / `ui_update_demo.lua`：API 机制演示，旧文案/布局不等于最新 UI 要求。
6. `scripts/hello.lua`：legacy 的 board.info，不能加 app marker 后照抄字段。

`tools/prepare_factory_scripts.py` 准备工厂文件；`build/factory-scripts` 是生成副本，优先修改用户指定的源文件，不只改构建输出。脚本元数据作者时间与 C 文件系统创建/修改时间是两回事。

参考中的短片段用于展示调用，不一定包含完整头部；交付每个 `.lua` 文件都补完整规范摘要。不要把参考中的示例 GPIO 或未知作者误当用户真实接线/身份。

## 自带校验器

环境：Python 3.9+、原生 C 编译器（macOS/Linux 的 cc），以及所选工作树已下载的冻结 Lua 源码。它不依赖 ESP-IDF 激活、不联网、不改输入文件、不连接串口；缺少依赖会报告，不自动安装。

`scripts/check_script.py --firmware-root ROOT FILE...` 每次在系统临时目录构建一个小型共享库，再删除临时产物；多文件在一次命令中检查可复用编译结果。`CC` 可指定编译器。

- 文件名、完整文件字节数、UTF-8、无 NUL、规范 app 首行。
- 直接调用固件 `ryz_script_metadata_parse`，要求三字段存在、非空、无 invalid/truncated。
- 直接调用该固件冻结 Lua 的 `luaL_loadbufferx(...,"t")`，只解析文本语法，**不执行脚本或 require/native 函数**。
- `--legacy` 只用于维护旧入口；不验证 app/neuro，不给予旧入口新的 API。
- JSON 输出，退出码 0=全部通过，1=脚本检查未通过，2=校验环境不可用。

规范有意比固件解析更严格：固件容忍缺字段/空值、标签之间的普通注释和部分 marker 后空白，但新脚本仍按统一四行头交付。语法正确不代表模块、参数、UI schema、输出或硬件正确。共享库机制尚未验证 Windows；不能声称该检查器跨平台已验收。

写完脚本后继续 [接口验证](interface-validation.md)：使用 `check_ui_runtime.py` 或 `check_hardware_runtime.py` 执行目标脚本，检查真实 native 调用。不能停在本节的语法检查。

## 分层验证，不替代证据

| 层级 | 验证方法 | 能证明什么 / 不能证明什么 |
| --- | --- | --- |
| 元数据与语法 | 上述检查器 | 当前 C parser 提取结果 + 目标 Lua 语法；不运行 Lua |
| 绑定契约 | 对应 Host 测试 | 真 Lua 和 native facade/虚拟回调参数、错误、生命周期；不是真实电气行为 |
| 单脚本有界回放 | app-host 输入脚本 | 挂载、更新、点击/滚动状态、取消；不默认证明像素字体布局 |
| 像素检查 | 项目现有 pixel/LVGL Host、240×240 截图 | 真实字体/裁切/布局；不是真机 LCD、触摸或外设验收 |
| 实机 | 用户授权后发送/运行 | APPS 摘要、真实显示、BOOT、触摸、真实接线与对端结果 |

绑定测试在固件根按需要运行，不要求每次写十行 Lua 就全量重跑：

```sh
python3 -m unittest tests/test_script_metadata.py
python3 -m unittest tests/test_lua_hardware.py tests/test_lua_peripherals.py
python3 -m unittest tests/test_app_tools.py
sh tools/test_app_runtime.sh
```

`test_script_metadata.py` 同时检查 fs/scripts 头部；硬件和外设用虚拟 peers，tools 用 typed callback。`tools/test_app_runtime.sh` 会写 `build-host`，若不能碰既有构建产物，可按脚本中的同一编译参数将二进制输出到临时目录。

单脚本回放先读 `tools/build_app_host.sh` 和 `host/app_host.c`，或使用技能的 `check_ui_runtime.py`。非 live 模式从 stdin 读取 `pointer <ms> down|move <x> <y>`、`pointer <ms> up`、`check <ms>`、`end <ms>`；必须给有限 `end` 并设进程超时。不要直接运行交互无限循环等待它自然结束。Host 会拒绝把真实 hardware tools 的 unavailable 当成功回执。轻量 Host 的 viewport 绘图不含 parent/scroll/crop，像素验收要用真实 LVGL Host。

完成时注明实际运行了哪层。仅编写 skill/API 文档时，不默认烧录固件或运行会改变真实 GPIO/HID/无线状态的脚本。
