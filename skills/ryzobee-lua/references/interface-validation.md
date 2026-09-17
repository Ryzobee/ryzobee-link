# 脚本接口验证：交付前读取

目标是证明脚本在**所选固件、已测试输入路径**中调用了真实存在的函数，并通过实际 C 参数解析。语言模型提示和 Lua 语法检查本身不能给出这一保证；有限测试也不覆盖所有未来输入。

## 先建调用清单

对脚本实际使用的每个 native 调用核对：

- 所在 ABI / `require` 注册、真实模块或 handle 方法名。
- 点号模块函数 / 冒号 handle 方法，参数数量和顺序。
- table 字段、类型、单位、枚举、范围；必填与默认值。
- 返回值的结构、错误形式，异步受理与完成的区别。

数据来源必须是所选树的注册表、参数解析和当前默认脚本。参考摘要只能帮助定位；某 API 查不到就换用已有能力，或明确告知不支持，不凭其它 Lua 平台的同名功能补一个。

复杂脚本的清单可记录在临时测试笔记，不必把一大张表塞给用户。拿到函数对象并不等于调用过；成功返回 `unavailable` 而提前 return，也不能证明后面的 `handle:read()` 参数正确。

## 两步验证

1. `check_script.py`：头部、文件约束、目标 Lua 语法，**不执行 Lua**。
2. 用下面的真实运行时测试执行脚本；正例必须到达业务调用和回调，反例用于确认检查能抓住错误。底层接口专用测试使用虚拟输入，不接设备。

### UI / 画布 / 触摸

```sh
# 在技能目录运行 / Run from the skill directory
python3 scripts/check_ui_runtime.py \
  --firmware-root /absolute/path/to/firmware/rootmaker \
  --replay /absolute/path/to/replay.txt /absolute/path/to/app.lua
```

没有 replay 时默认运行 1000ms 虚拟时间，可用 `--duration-ms` 调整。helper 在临时目录构建当前 `host/app_host.c + app_runtime.c + app_tools.c + onelua.c`，先做头部/语法检查，再执行；带进程时间和输出大小限制，不改输入文件或固件。

回放示例（时间与坐标应按待测页面改，不是固定万能点击）：

```text
check 0
pointer 100 down 120 180
pointer 140 up
check 180
end 300
```

JSON `ok` 表示本次 Host 执行通过，`trace` 是可供断言的文本/绘图/状态回放，`coverage=executed-paths-only`。不能只看 ok：比如计数按钮应断言从 0 变 1，列表应触发滚动并选择屏外项，错误/取消分支也按需要触发。

轻量 app-host 不执行真实 LVGL 字体排版，也未实现 viewport parent/scroll/crop 的绘图效果；它能检查 facade schema、事件命中和 Lua 状态，不能用于确认列表裁切或真实字号外观。需要像素验收时改用项目 pixel/LVGL Host。

### 外设与 tools

虚拟外设校验使用本技能的 `check_hardware_runtime.py` / `contract_runner.c`。它链接当前真正的 Lua facade，复用所选树 `tests/lua_peripherals_test.c` 的虚拟 peers；没有 ESP adapter、串口、网络或真机调用。

- success 模式让 open 成功，实际触达 `read/write/close` 和 IMU 等调用。
- unavailable 模式验证失败处理，不能替代 success 模式。
- 输出 adapter 调用计数与 handle 统计，核对预期方法确实被执行。
- `adapter.uart_tx_hex` 记录最多 256 个实际被成功 WRITE 接受的字节；短写中未接受的尾部不计入。用它核对精确协议载荷，`uart_tx_overflow` 表示超过记录容量，不能用截断 trace 证明整个长包正确。
- 工具服务是同步完成的合成快照，仅证明 C 参数准入和 Lua 分支；不能据此证明真实 revision/session 竞争、异步状态机、引脚租约、电气结果或手机执行了 HID。
- 真实连接的更多状态（not_ready、短写、丢包、忙、关闭失败等）按脚本业务再用当前专用 fixture/集成测试注入，不假设 success/unavailable 穷尽所有状态。

运行方法：

```sh
python3 scripts/check_hardware_runtime.py --firmware-root ROOT --virtual-ms 5000 FILE.lua
python3 scripts/check_hardware_runtime.py --firmware-root ROOT --virtual-ms 5000 --mode unavailable FILE.lua
```

这两个命令前仍需运行 `check_script.py`。详细选项见 `--help`。默认临时构建，ASan/UBSan 开启；重复运行可显式指定临时 `--build-dir` 复用源码指纹相同的二进制。该工具实际执行 Lua，所以只在 Host 使用，不把它替换为设备的 run/烧录入口。

`success` 只表示 fixture 可用，并非每次 I/O 都成功：原有测试 fixture 保留 UART/SPI 短写、I2C 0x52 超时、部分 ADC 不支持校准、LED 延迟完成等输入。检查返回值，不为使测试“通过”而删去错误处理。

本技能包不附带维护者回归套件。使用者只需按本次脚本的实际调用与输入分支进行针对性校验，不需要运行技能开发时的全套测试。以上 `tests/lua_peripherals_test.c` 指所选固件中的 Host 依赖，不是技能附件。

## 不可跳过的完成边界

- 每种 native 调用至少有一条合法实参路径；按钮等回调内调用要通过输入触发。
- 跳过、提前返回、超时、进程异常或未访问的方法标为未验证；不要因 Lua 捕获错误而宣称成功。需验证的 handle 方法必须有成功 open 的测试。
- 有非法调用时修改脚本/必要的技能摘要后重跑。修复后保留一个反向用例，证明验证器仍能拒绝同类错误。
- 交付区分“本次已覆盖调用有效”与“任意未来脚本永远正确”；后者不能由一次测试证明。

## 已知固件诊断边界

2026-09-17 的 `app_runtime.c::integer_field_value` 用 `%lld` 构造 Lua 错误。某些越界字段（例如 width=0、radius=40）会被拒绝，但显示 `invalid option '%l' to 'lua_pushfstring'`，而非清晰字段提示。遇到此报错仍判验证失败，回查范围；不要改为跳过检查或把它当正确脚本。本技能测试没有擅自修改固件这个问题。
