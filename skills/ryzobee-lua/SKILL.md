---
name: ryzobee-lua
description: 编写、修改或审查 RyzoBee RootMaker Lua 脚本，处理 APPS 头部摘要、现有原生接口、240x240 UI、外设与协作式调度。用户称 ryzobee_lua 时也使用。以当前固件源码为准；不用于通用 Lua 教程或单独修改 C 固件。
---

# RyzoBee Lua

生成能被当前固件识别、运行和终止的 Lua 源文件。默认面向 `ryz-app/1`；维护旧脚本时先识别入口，保留其行为，不机械补 marker。

## 开始前

1. 定位用户指定固件工作树及其 `firmware/rootmaker`。本技能于 2026-09-17 核对 Ryzobee V0.10.1 工作树（含未提交内容），来源指纹见参考。Link 不包含该固件源码；按用户指定路径或 `RYZOBEE_FIRMWARE_ROOT` 定位，确认指向包含 `components`、`host` 的固件根；若指向仓库根则检查其 `firmware/rootmaker`。不同固件仓库不能静默混用，无法确认再询问。
2. 本地源码可读时，读取该树的 `AGENTS.md`、任务涉及的注册表/实现和默认脚本。下面的参考是有日期的源码摘要，不覆盖源码新变化；定位索引见 [源码与验证](references/sources-and-validation.md)。
3. 所有任务先读 [头部格式](references/metadata.md) 和 [运行环境](references/runtime.md)。再按功能读取：
   - `ui.mount/update/poll`、布局、字体、滚动、触摸事件 → [UI](references/ui.md)。
   - 直接绘图、原始触摸、无线状态、IMU、HID、GPIO、UART、定时器、PWM、I²C、SPI、ADC、日志、LED → [硬件接口](references/hardware.md)。
   - 维护已有 `tools.*` broker 脚本 → [工具接口](references/tools.md)。新外设脚本优先使用已公开的 handle 接口，不套旧 Studio SOP。

### 仅提供技能文件的环境

外部模型/API Agent 可能没有工程文件或 shell。若宿主已确认接口快照一致，按已提供的技能参考编写，再使用宿主暴露的真实运行时验证工具；这等价于下面的本地校验步骤，不必索取 shell。

可读取的技能路径以本文链接为准。参考里 `components/...`、`scripts/tool_*.lua` 是**工程源码定位**，不是技能附件；除 `assets/ui_counter.lua` 外不假定有其它模板。路径不存在时使用已有的完整 schema/签名，不猜更多相似文件名。无法确认版本一致则标记源码版本未核对，但仍可提交有界 Host 验证，不宣称兼容真机。

读完头部、运行环境和当前功能对应的一份参考，已能为全部待用调用找到签名时就开始写脚本。UI 列表无需读取 broker 工具文档，UART 无需读取字体文档。后续按具体缺失信息补读；完成条件是脚本和验证结果，不是读遍目录。

## 新脚本的固定开头

从第一个字节写 marker，UTF-8 **无 BOM**，此前没有空格、空行或其它注释：

```lua
-- ryz-app/1
-- @author: Unknown
-- @version: 0.1.0
-- @description: Brief, accurate description of this script.
```

替换为用户提供的作者及实际功能；未知作者用 `Unknown`，不替用户虚构身份。新草稿可用 `0.1.0`；已有脚本保留作者并按实际修改更新版本。文件名决定 APPS 名称；`@name`、创建时间等不是当前元数据字段。

推荐文件名 `[A-Za-z0-9_-]{1,36}.lua`，完整文件 1–16384 **字节**。作者/版本/简介限 80/32/256 UTF-8 字节。每个标签仅一行、仅一次，英文小写和冒号位置固定。元数据不能放入 `--[[...]]`。

## 编写决策

- `require` 仅取固件白名单模块，不从文件系统装载其它 `.lua`；`io/os/package/debug/load/pcall/xpcall` 不能当普通桌面 Lua 使用。准确差异见运行环境参考。
- 选择一种屏幕/输入路径：托管 `ui` + `ui.poll()`，或直接 `display` + `touch.read()`。同一 Job 不交叉占用；UI 坐标范围为 240×240。
- UI 脚本默认全屏，不自行增加系统状态栏或触摸退出按钮。长按实体 BOOT 的退出由固件处理；应用按钮只承担应用内部动作。
- 事件循环做有界工作后 `board.sleep_ms(10..40)`；定时器是轮询、协程由 Lua 主循环显式 resume，不把 sleep 写成自动调度器。按任务选择周期，不强制每项使用协程。
- `ui.mount` 用于首次建立/换页；值变化优先 `ui.update`，保留 generation。无变化不重绘；日志、历史、队列和每轮事件数都设上限。
- 外设通常返回 `nil, reason`；先判断再使用 handle/数据，保留超时、丢包、忙和 unavailable 的区别。显式关闭资源；C Job 清理是兜底，不依赖 `__gc` 或吞掉取消。
- WiFi/BLE/HID 状态查询例外：正常离线为 `false`，失败为 `false, reason`，先检查第二返回值。协议字节不随 UI 大写规则转换；收发语义按任务逐项验证。
- 参数错误和 UI schema 错误会抛 Lua 错误；不能凭所有 API 都是同一种返回形式来编写通用封装。
- 实际字体/资产/模块均有限制。特别是**元数据支持 UTF-8，不代表 Lua UI 正文支持中文**；按 UI 参考选受支持文本/字体。

可从 [可运行 UI 示例](assets/ui_counter.lua) 起步，替换摘要和功能。外设示例从参考中的真实调用签名或当前 `scripts/tool_*.lua` 选取，不使用猜测的 `digitalWrite`、`delay`、`lvgl.*` 等别的平台 API。

## 验证与交付

运行技能自带检查器（只编译临时 Host 校验库，**不执行 Lua、不连接设备**）：

```sh
python3 scripts/check_script.py \
  --firmware-root /absolute/path/to/firmware/rootmaker \
  /absolute/path/to/my_app.lua
```

以上命令在本技能目录运行。它直接调用所选固件的 C 元数据解析器和冻结 Lua 解析器，检查文件名、字节上限、marker、完整摘要及语法。维护 legacy 脚本时加 `--legacy`；这不让 legacy 获得 `ui/tools`。

每个新写或修改的脚本，都按 [接口验证](references/interface-validation.md) 检查它实际使用的模块、方法、参数及返回值，并用真实 facade 做有界执行。语法通过不能作为接口验证；源码中未触达的回调、连接成功后的分支需要补用例，不能算已通过。

UI 脚本用 `scripts/check_ui_runtime.py --firmware-root ROOT [--replay INPUT] FILE...`；含外设的脚本再按接口验证参考运行 success/unavailable 虚拟测试。缺少验证环境时明确交付为“未验证”，不猜测接口补齐，也不为验证自动访问真机。

交付说明元数据/语法、已覆盖的 native 调用/交互分支、Host 像素及真实设备分别验证了什么。固件升级或接口变化时，先核对当前注册表/实现，再运行相关契约测试。

只写脚本不自动写入设备、改 `boot.lua`、编译或烧录。用户要求这些操作时按所选工程及已有 `esp-build` / `ryzobee-flash` 技能执行相应步骤；本技能不扩大其授权。
