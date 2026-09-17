# Lua 运行环境、入口与调度

基线：2026-09-17，当前 V0.10.1 源码，而非旧 Studio 能力模型。

## Runtime 选择

| 入口 | 识别方式 | 用途与差异 |
| --- | --- | --- |
| App | byte 0 `-- ryz-app/1` | 新交互脚本默认；托管 `ui`、`tools`，以及下表 App 版 `ryzobee` |
| legacy | 无 App/neuro marker | 维护旧直接绘图脚本；没有 `ui/tools`，board/display/touch 返回形态可能不同 |
| neuro | `-- ryz-neuro/` 前缀 | 独立图运行时，不是普通 Lua App；不能将本技能模块表直接套进去 |

普通 Lua 使用依赖 `georgik/lua ==5.5.0~7` 的冻结源码。`managed_components/georgik__lua/include/luaconf.h` 设置 `LUA_32BITS=1`：整数和浮点均 32 位。不要拿系统 Lua 5.4/默认 double 的通过结果当目标一致性证明。

## 模块与标准库

App 原生模块：`ryzobee`、`display`、`touch`、`ui`、`tools`、`wifi`、`ble`、`imu`、`hid`、`gpio`、`uart`、`timer`、`pwm`、`i2c`、`spi`、`adc`、`log`、`led`；`require('coroutine')` 返回受控协程库。legacy 去掉 `ui/tools`，其余需以两个 require 分发表为准。

`table`、`string`、`math`、`utf8` 作为**全局库**存在（例如 `math.floor`），不因此支持 `require('math')`。全局 base 大部分存在，包括 `assert/error/ipairs/pairs/type/tonumber/tostring` 和受控 `setmetatable`。`print` 被固件捕获。

移除 `dofile/loadfile/load/pcall/xpcall`，未开放 `io/os/package/debug`；`require` 不是磁盘/网络 loader。没有任意文件写入、Wi-Fi 配置或 HTTP/socket 接口。修改文件、配网、启动文件管理由 C/UI/外部控制端负责。

## `local board = require('ryzobee')`

| 方法 | App 返回/约束 |
| --- | --- |
| `board.info()` | `{runtime='ryz-app/1', catalog='ryz-capabilities/1', width=240, height=240, seed=...}`；不是芯片信息 API |
| `board.millis()` | 平台单调毫秒转换成 `lua_Integer`；可能回绕，不是 UTC，不能做长时间绝对精确计数 |
| `board.seed()` | 本 Job 平台提供的 seed；需要复现随机数时显式 `math.randomseed(board.seed())` |
| `board.sleep_ms(ms)` | 整数 0..5000；协作暂停整个 Lua worker、检查取消；无返回值 |
| `board.mark(name, value)` | 供平台观察的标记，无返回值；name 匹配 `[a-z][a-z0-9_]{0,23}`；value 为布尔、signed int32 或匹配同一规则的字符串。名称和字符串值都必须以小写字母开头。不是任意结构化日志/持久化 |

legacy `board` 只有 `info/millis/sleep_ms`。其 `info()` 返回芯片/IDF/revision/Flash/PSRAM/堆信息，如 `chip,idf,revision,flash_bytes,psram_bytes,free_internal_bytes,free_psram_bytes`，没有 App 的宽高/catalog/seed 字段。不要给 `hello.lua` 加 App marker 后仍访问 `info.chip`。

## 协程与轮询

全局 `coroutine` 支持 `create/resume/yield/wrap/status/running/isyieldable/close`。单 VM 合作式调度，不是多核任务；`yield()` 返回调用者，由调用者继续 `resume()`。sleep 不会自动轮转其它协程，`timer` 也不是 callback/中断注册器。

```lua
local board = require('ryzobee')
local worker = coroutine.create(function()
  for i = 1, 3 do
    print('step', i)
    coroutine.yield()
  end
end)
while coroutine.status(worker) ~= 'dead' do
  local ok, reason = coroutine.resume(worker)
  if not ok then error(reason) end
  board.sleep_ms(20)
end
```

普通子协程错误仍按 Lua 语义返回；终止/超时被外围 guard 再抛出，不能用 resume 的 `false,error` 将 BOOT 退出吞掉。协程共享 Job 堆、期限、native handles 与清理。

## 有界资源与退出

- 完整源码上限 16384 字节；Lua allocator 限额 256 KiB（不等于整个固件/所有 C UI 资源占用）；捕获结果输出缓冲 4096 字节含尾 NUL，超出会标截断。不要无限累计字符串/日志表。
- 期限由运行入口的 C caller 提供，0 可代表无固定期限；不要假设所有脚本统一跑 5 秒。旧同步 `run/eval` 与 APPS/异步运行的准入不同。
- Lua instruction hook 和 native 调用边界检查 BOOT/取消/超时。正在执行的 C 调用须靠自身有界实现，Lua hook 不能即时打断它。
- 交互 App 在事件循环内保留短暂停顿；脚本自然返回、错误、OOM、超时或 BOOT 取消都结束 Job，UI/硬件最终由 C owner 收回。当前 BOOT 长按阈值在 `components/ryz_workbench/include/workbench_boot_key.h`（此基线 5000ms），产品改动时重查，不在 Lua 里另做系统退出手势。
- 用户 `__gc` 注册被拒绝；普通元表和 `__close` 仍受终止检查。显式 close/deinit 是正常路径，原生 cleanup 是兜底，不代表真实硬件永远能恢复。
- 对每种调用分别区分抛错、`nil,reason`、`false,reason` 和异步 request token；禁止用统一 `assert(fn())` 掩盖多返回值或临时 not_ready。

## Host 与真机边界

托管 UI/流程可用当前真实 App facade 做 Host 验证；`host/app_host.c` 的硬件注入不等于真实无线、引脚或手机。没有后端时通常返回 `unavailable`，应诚实展示，不能伪造一次成功读取。若 Lua 自己捕获 unavailable，Host 也不因此成为硬件验收。

源码锚点：`components/ryz_runtime/app_runtime.c:ryz_app_is_source,protected_run,open_board,ryz_app_execute`；`lua_runtime.c:require_native,open_board,ryz_lua_execute_with_options`；`lua_coroutines.h`；`lua_sandbox.h`；`include/lua_runtime.h`；`components/ryz_workbench/workbench.c`。
