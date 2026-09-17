# `tools` broker：I2C 扫描、RGB、串口监视器

适用：维护已有 `require('tools')` 应用，或明确需要 C 工具任务、状态机与快照的脚本。普通新脚本优先 `hardware.md` 的 `i2c/led/uart/log` handle API；当前默认工具脚本也已采用公开外设接口，不能因文件名叫 tool 就写成 tools broker。

## 契约

- 模块仅 app ABI 可 require；13 个真实方法由 `components/ryz_runtime/app_tools.c::ryz_app_tools_open` 注册。这里的 `tools` 是 Lua C broker facade，不是 Web Serial RPC，也不直接提供 UI。
- 所有方法成功/业务失败都返回一个 table：`{ok,code,error_code,...}`。必须检查 `r.ok`，`assert(r)` 没有意义（失败 table 也为真）。code=`ok/busy/invalid/state/unavailable/no_memory/failed`。
- 成功命令再附 `{accepted=true,operation_id,revision,view_generation}`；未用于该命令的字段可能为字符串 `"0"`。受理不等于异步动作完成。成功 status 增加 `started` 与快照；未启动状态为 `phase='unstarted'`。
- 参数数量、未知字段、metatable、错类型/枚举/token 属于脚本错误，直接抛 Lua 错误，不返回失败 table。
- `expected_revision`、操作/session/序列号、view generation 必须原样使用十进制字符串。入参为 canonical uint32（不带前导零、不含空格/正负号/小数/指数）；通常须 >0，仅 `after_sequence` 允许 `"0"`。返回大计数/时间戳也为字符串；不要 `tonumber()` 后再传回。
- 源：`app_tools.c::parse/call_tool/i2c_status/rgb_status/monitor_status/monitor_page`；原生执行 `components/ryz_tools/ryz_tools.c::perform/ryz_tools_call`。

## 全部 13 方法

令 `t=require('tools')`；命令均点号调用。

| 方法 | 参数与调用顺序 |
|---|---|
| `t.i2c.status()` | 无参数；取得 `config_revision`、当前配置/阶段/结果 |
| `t.i2c.configure{ sda,scl,hz,expected_revision }` | 字段全部必填；pin 整数 0..48 还须原生权限合法；hz 仅 100000/400000；revision 从 status 获取 |
| `t.i2c.start(expected_revision)` | 正十进制字符串；保存成功 ACK 的 `operation_id` 作为本次 scan ID |
| `t.i2c.cancel(operation_id)` | 取消自己保存的 scan ID；受理后继续 status 等待资源释放 |
| `t.rgb.status()` | 无参数；检查最新 request 与已完成 request、颜色和已知输出 |
| `t.rgb.set{red,green,blue}` | 三字段全部必填，整数 0..255；ACK 后等待对应 request 完成 |
| `t.monitor.status()` | 无参数；取得 config_revision、session_id、operation_id、stream 等 |
| `t.monitor.configure{source='system',expected_revision}` | 系统源仅这两个字段；UART 源改用 `{source='uart',rx,tx,baud,expected_revision}`，字段全部必填 |
| `t.monitor.start(expected_revision)` | 配置完成后用最新 status 的 config_revision；保存 ACK ID，等 phase=`running` |
| `t.monitor.stop(operation_id)` | 参数名虽为 operation_id，业务上对应当前捕获 session ID（`status.session_id`），不是随意取最新控制命令 ID |
| `t.monitor.pause{operation_id,view_generation,paused}` | 使用捕获 session ID、最新 stream.view_generation 与 boolean；从返回更新 generation |
| `t.monitor.clear{operation_id,view_generation}` | 同上，清除视图使 generation 改变；后续游标从 `"0"` 重建 |
| `t.monitor.read{operation_id,view_generation,after_sequence}` | 同上；首次 after_sequence=`"0"`，后续原样用上次 `next_sequence`；没有 limit 参数 |

Monitor baud 精确枚举：`1200,2400,4800,9600,19200,38400,57600,115200,230400,460800,921600`。这是 broker 自己的限制，不等于 `uart.open` 的范围。system 源不能传 rx/tx/baud，UART 源也没有 bits/parity/stop 字段。

## 如何解释状态

### I2C

- 默认 `{sda=41,scl=40,hz=100000}`、初始 config_revision=`"1"`；先 status 获取真实值，不硬编码 revision。
- 阶段 `unstarted/idle/queued/running/cancelling/completed/cancelled/failed/releasing`。`completed` 之外的未完成/失败/释放中状态不能报“未发现设备”。
- 状态含 `scan_id,config,config_revision,scan_config,scan_config_revision`、`resources_held,cleanup_error,error`、时间戳、completed_addresses/probe_calls/busy_responses/current_address 与分类计数。
- `results` 含数组 `unscanned/ack/nack/busy/timeout/error`；前五为地址，error 项为 `{address,code}`。仅 `empty=true` 明确表示完整 112 地址均 NACK、无错误、无未扫项且清理完成。
- `config` 是现配置，`scan_config` 是此次扫描快照；区分它们避免配置变了却给旧结果贴新 pin 标签。

### RGB

- 阶段 `unstarted/idle/queued/sending/completed/failed/cleaning/cleaned`。
- `request_id`/`requested` 与 `last_completed_id`/`color` 分开；配合 `output_known` 判断当前可证实颜色。`set()` 成功只是受理。
- `resources_held,error,cleanup_error` 保留清理/失败语义。模块没有 `rgb.off/cleanup`；要熄灭用 `set{red=0,green=0,blue=0}` 并等待完成。

### Monitor

- 阶段 `unstarted/idle/starting/running/reconfiguring/stopping/stopped/failed`；控制 operation=`none/start/configure/stop`。同时看 `operation_pending,source_active,resources_held`，不能把 ACK 当 running。
- `config` 为已保存配置；`capture_config` 是当前捕获配置；`requested_config` 是正在申请的配置。检查 `operation_error,cleanup_error,restore_error`。
- `session_id` 是捕获会话，`operation_id` 是控制动作标识。pause/clear/read/stop 的入参名称沿用 operation_id，但原生 broker 对其验证的是捕获 session ID；使用本 job 开始并从 status 确认的 session。
- `stream` 含 `view_generation,paused,accepting,first_sequence,last_sequence,retained_records,chunks,bytes,overwritten_chunks,overwritten_bytes,truncated_bytes,filtered_logs,capture_gap_since_boot,sequence_exhausted` 及 source/session/config_revision。
- `read` 返回 `{records,count,next_sequence,gap,more,stream,...}`；每条 `{sequence,captured_ms,length,truncated,bytes}`，bytes 是二进制块而非完整行。正确处理跨块换行、NUL/非 ASCII。当前环容量32块，每块96字节，每页最多8块；有界翻页，按 `more` 决定续读。
- generation 改变时放弃旧游标/旧列表，重新从 `"0"` 读。`gap`、覆盖/截断与 `capture_gap_since_boot` 意味日志不完整，不隐藏这些证据。UART 另有 `uart_events` 错误计数和 `events_may_be_lost`。
- “暂停界面”是冻结视图用于浏览，不等同于关闭 UART 或清空底层日志。应用恢复时回最新数据；参考对应 stream 实现和当前脚本，不把 UI 暂停按钮直接解释为停止采集。

## 有限扫描范例

```lua
-- ryz-app/1
local board, tools = require('ryzobee'), require('tools')
local s = tools.i2c.status()
if not s.ok then print('status:', s.code); return end
local accepted = tools.i2c.start(s.config_revision)
if not accepted.ok then print('start:', accepted.code); return end
local scan_id, terminal = accepted.operation_id, false
for _ = 1, 200 do
    board.sleep_ms(20)
    s = tools.i2c.status()
    if not s.ok then print('status:', s.code); break end
    if s.scan_id == scan_id and not s.resources_held and
       (s.phase == 'completed' or s.phase == 'cancelled' or s.phase == 'failed') then
        terminal = true
        print(s.phase, 'ACK:', s.ack_count, 'empty:', s.empty)
        break
    end
end
if not terminal then
    local r = tools.i2c.cancel(scan_id)
    print('cancel:', r.code) -- 只是取消请求，不能据此宣称清理完成。
end
```

## 所有权与结束

Lua job 通过可信宿主获得 broker session；Lua 没有 `tools.open/close/owner_session`。工具有独占资源状态，C 界面、其他任务或旧任务清理未完成时可返回 busy/state。新任务不能拿旧 ID 控制他人资源。退出时宿主撤销 facade 并跟踪异步清理；500ms 的清理观察超时不等于清理成功。

源码：`components/ryz_workbench/workbench_tools.c::ryz_workbench_tools_call/finish/tick`，`components/ryz_tools/ryz_tools.c::ryz_tools_close/progress`。

契约回归：`tests/app_tools_test.c` 覆盖13方法/错误/token/极大计数/OOM；`tests/tools_test.c`、`tools_monitor_integration_test.c`、`tools_i2c_integration_test.c` 覆盖 broker 与服务集成。测试里的 GPIO2/3/4/5 等为 facade 字段测试值，不意味着实机允许占用这些板载 pin。
