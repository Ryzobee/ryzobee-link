# Lua 硬件与底层绘图接口

适用：编写显示/触摸、无线状态、IMU/HID、GPIO/总线/串口/日志脚本。下列接口按当前 `firmware/rootmaker` 源码审计；查阅或改写脚本时重新核对对应符号。时间、协程、运行限制见 `runtime.md`；保留式 UI 见 UI 参考；`tools` broker 见 `tools.md`。

## 接口与证据边界

- 应用脚本首行采用 `-- ryz-app/1`；本页默认描述该 ABI。模块通过白名单 `require` 获取，模块函数用点号，外设 handle 方法用冒号。
- 有硬件功能不等于有 Lua 模块。当前不存在 `require('battery')`、`require('button')`、`require('time')`、通用 `require('rgb')`、任意 Wi-Fi/BLE 配置或寄存器直通接口。使用 `ryzobee` 获取时间，`led` 控制板载 RGB。
- 静态注册证明接口存在；host 测试证明协议/虚拟设备契约，不证明实际接线、模拟电气行为、真机外设可用或对端已执行动作。

## `display`：240×240 RGB565 立即模式画布

源：`components/ryz_runtime/app_runtime.c` 的 `open_display`、`display_*`、`claim_display`。

| 调用 | 参数与结果 |
|---|---|
| `display.clear(color)` | RGB565 整数 `0..65535`；无返回值 |
| `display.rect(x,y,width,height,color)` | 填充矩形；正宽高且整个矩形必须在 `240×240` 内；无返回值 |
| `display.text(x,y,text,color[,scale])` | 可打印 ASCII，`1..40` 字节，scale 默认 1、范围 `1..6`；占用宽 `(字节数×6−1)×scale`、高 `7×scale`，必须完整放入画布；无返回值 |
| `display.show()` | 提交显示，成功 `true`；通常先批量绘制，再调用一次 |

绘图失败、越界或非法颜色等直接引发 Lua 错误；这组接口不是 `nil,reason` 风格。颜色不是 `0xRRGGBB`。`display` 与 `ui` 不能同时持有画布；同一页面选一种渲染入口。APP ABI 没有 `display.read_pixel`。

入口接受可打印 ASCII 不保证像素字库含所有字形：真实 `components/ryz_board/display_font.h` 仅大写、数字及有限标点。优先使用大写文本，不能套用 `ui` 的字体 token。

```lua
-- ryz-app/1
local display = require('display')
display.clear(0x0000)
display.rect(8, 8, 224, 2, 0xfb40)
display.text(12, 24, 'RYZOBEE', 0xffff, 3)
display.show()
```

## `touch`：轮询触摸

源：`components/ryz_runtime/app_runtime.c` 的 `open_touch`、`touch_read`、`claim_touch`。

- `touch.info()` → `{ready,width=240,height=240}`。这里的 `ready` 表示平台读指针回调存在，不是完整硬件自检。
- `touch.read()` → `{pressed,interrupted,has_position,event,sampled_ms[,x,y]}`。`event` 为 `none/down/move/up`；仅 `has_position=true` 才有 `x,y`。中断样本不能按一次可靠点击处理。
- `touch.demo(enabled)`：必须布尔值；成功 `true`。这是调试覆盖效果开关，不能与活动 `ui.scene` 同用。
- `touch.read()` 与 `ui.poll()` 属于互斥输入所有者，不能一边使用 UI 事件一边另行轮询。读取失败抛 Lua 错误。

```lua
-- ryz-app/1
local board, touch = require('ryzobee'), require('touch')
for _ = 1, 100 do
    local p = touch.read()
    if not p.interrupted and p.has_position and p.event == 'down' then
        print(p.x, p.y)
    end
    board.sleep_ms(20)
end
```

## `wifi` / `ble` / `imu` / `hid`

源：`components/ryz_runtime/lua_hardware.h` 的 `ryz_lua_hardware_install/invoke`；`lua_hardware_esp.c` 的 `ryz_lua_hardware_esp_call/cleanup`。

| 调用 | 成功结果与语义 |
|---|---|
| `wifi.is_connected()` | 布尔值；STA 在线且已获 IPv4，非仅保存配置、非 AP 客户端连接，也不证明可访问互联网 |
| `ble.is_connected()` | 布尔值；链路、认证和绑定均完成，不等于 HID 可发报告 |
| `imu.init()` | `true`；当前 Lua job 显式取得 IMU 生命周期所有权 |
| `imu.read()` | `{x_mg,y_mg,z_mg,timestamp_us,sequence}`；三轴单位 mg；时间戳与序号是十进制字符串 |
| `imu.deinit()` | `true`；释放当前 job 的 IMU；未持有时也成功 |
| `hid.is_ready()` | 布尔值；安全连接完成且主机已具备 HID 报告就绪状态 |
| `hid.tap(key)` | `true` 仅表示有界队列受理，不保证手机/电脑已执行动作 |

仅 `hid.tap` 接受一个字符串参数；其他方法不能带参数。HID key 精确枚举：`play_pause`、`stop`、`next_track`、`previous_track`、`mute`、`volume_up`、`volume_down`。

业务/设备失败：状态查询返回 `false,reason`，其余返回 `nil,reason`；reason 为 `unavailable/not_initialized/not_ready/busy/failed`。正常未连接是单独的 `false`，不要直接对连接查询使用 `assert`。参数错误抛 Lua 错误。Wi-Fi 配网、BLE 配对/忘记连接在 C 系统 UI 完成，Lua 不接触密码或射频配置。

状态查询先检查第二返回值，不能用 `connected == nil` 判断失败，否则会隐藏错误原因。WiFi、BLE、HID 均使用这个模式：

```lua
local connected, reason = require('wifi').is_connected()
if reason ~= nil then
    print('WIFI ERROR', reason)
elseif connected then
    print('WIFI CONNECTED')
else
    print('WIFI DISCONNECTED')
end
```

IMU 必须当前 job 内 `init → read → deinit`；其他任务曾初始化不赋予当前脚本读取权限。结束/报错/取消有宿主清理兜底，只释放 job 资源，不销毁触摸共用的板载 I2C。HID session 也在 job 退出时关闭。

```lua
-- ryz-app/1
local board, imu = require('ryzobee'), require('imu')
local ok, reason = imu.init()
if not ok then print('IMU init:', reason); return end
for _ = 1, 50 do
    local sample, err = imu.read()
    if sample then
        print(sample.sequence, sample.x_mg, sample.y_mg, sample.z_mg)
    elseif err ~= 'not_ready' then
        print('IMU read:', err); break
    end
    board.sleep_ms(40)
end
local closed, err = imu.deinit()
if not closed then print('IMU close:', err) end
```

## 通用外设 handle 契约

源：`components/ryz_runtime/lua_peripherals.h` 的 `peripheral_open/method/close` 和 `ryz_lua_peripherals_install`；上限在 `include/ryz_peripheral.h`；真机实现 `peripheral_esp.c`。

- `module.open{...}` 成功返回 userdata handle，失败 `nil,reason`。配置必须为普通 table（无 metatable），只允许列出的字段；拼错字段/类型/范围直接抛错。
- 业务失败统一 `nil,reason`：`unavailable/invalid/busy/closed/timeout/not_found/no_memory/unsupported/failed`。唯一额外规则：I2C probe 的普通 NACK 返回 `false`，非 `nil`。
- 每 job 最多 16 个 handle，协程共享此额度与所有权；不是每协程 16 个。没有注册 `__gc` 自动关闭器，丢失 Lua 引用不保证提前释放，尽快显式 `h:close()`。
- `close()` 成功 `true`，已成功关闭再 close 仍 `true`。失败后该 handle 进入 closing，只能重试 close，不能继续读写；不要把失败 handle 清空再 open 替代。
- job 正常退出/异常/取消会撤销 Lua 调用并兜底清理。清理失败可保留底层 pin/controller 资源，不能把脚本停止等同于资源已物理释放。
- 字节数据使用 Lua 二进制 string（可含 `\0`），每次 `1..256` 字节；接收可返回空串。涉及等待的单次 timeout 为 `0..20ms`，循环中显式 `board.sleep_ms()`。
- ESP32-S3 pin 参数虽检查 `0..48`，不代表所有引脚可用。真机统一 pin/controller 租约会拒绝板载、内存、USB、未引出和已占用引脚。

### open 配置与 handle 方法

表内 `=` 表示默认值，其余注明必填；成功返回值见右列。所有 handle 另有 `:close()`。

| 模块与配置字段 | 可用方法与返回 |
|---|---|
| `gpio.open{pin=必填, mode='input', pull='none', initial=0}`；mode=`input/output/open_drain`；pull=`none/up/down/both`；initial=`0/1` | `:read()` → `0/1`；`:write(0或1)` → `true`，input 模式写返回 unsupported |
| `uart.open{port=1,tx=-1,rx=-1,baud=115200,bits=8,parity='none',stop=1}`；port=`1/2`；tx/rx 至少一个非负且不同；baud=`300..5000000`；bits=`5..8`；parity=`none/even/odd`；stop=`1/2` | `:write(bytes)` → 已接收字节数；`:read([length=256[,timeout_ms=0]])` → `bytes,{error_events,loss_possible}` |
| `timer.open{period_ms=必填,periodic=true}`；period=`1..3600000` ms | `:poll()` → 自上次 poll 到期次数，未到期为 0；不注册回调，单次定时器到期后只计一次 |
| `pwm.open{pin=必填,frequency_hz=1000,duty=0}`；frequency=`1..1000000` Hz；duty=`0..1000` 千分比 | `:set_duty(duty)` → `true`；无动态改频方法，原生硬件组合不支持时仍会失败 |
| `i2c.open{board=true}`；或 `{sda=必填,scl=必填,frequency_hz=100000}`，两个外部 pin 不同，频率仅 100000/400000 | `:probe(addr[,timeout=10])` → true/false；外部总线另有 `:read(addr,n[,timeout=10])` → bytes，`:write(addr,bytes[,timeout=10])` → 数量，`:transfer(addr,bytes,n[,timeout=10])` → bytes（写后重复 START 读） |
| `spi.open{sclk=必填,cs=必填,mosi=-1,miso=-1,frequency_hz=1000000,mode=0}`；mosi/miso 至少一个；所有有效 pin 不同；frequency=`100000..20000000`；mode=`0..3` | `:write(bytes[,timeout=10])` → 数量；`:read(n[,timeout=10])` → bytes；`:transfer(bytes[,timeout=10])` → 等长全双工 bytes；所需方向未配置返回 unsupported |
| `adc.open{pin=必填,attenuation_db=12}`；衰减仅 `0/2/6/12` | `:read()` → 原始 ADC 整数（真机配置为 12bit）；`:read_mv()` → 校准毫伏整数，无可用校准则 unsupported；不是电池百分比 |
| `log.open{level='info'}`；level=`error/warn/info/debug/verbose` | `:read([length=256[,timeout_ms=0]])` → `bytes,{dropped_bytes,loss_possible}`；模块另有 `log.write(level,message)` → true，消息 `1..256` 字节，不需要先 open |
| `led.open{board=true}`（默认即 true，false 不支持） | `:write(red,green,blue)` → true（异步受理），三通道整数 `0..255`；`:status()` → `{state,red,green,blue,output_known}`，state=`idle/pending/ready/failed` |

UART `error_events`、log `dropped_bytes` 是十进制字符串计数。写入返回数量可能小于请求长度，调用方需保留剩余字节并有界重试，不能把非 nil 自动当全量成功。

总线载荷按要求逐字节保留，包含大小写、NUL 和换行；例如 `ping` 必须是 `70 69 6e 67`，不能改成 `PING`。界面推荐大写的规则不适用于协议数据。接收长度/结束标记由协议决定，不能仅因发送 4 字节便假定回复也是 4 字节。

接收缓存每次只读取剩余容量，达到容量上限要报告可能截断。成功指示需同时考虑读错误、写错误、丢包和截断；先收到数据、之后读取失败不能显示全成功。用故障输入检查这些路径，不能只测无异常时的返回类型。

### 总线与板载资源边界

- 板载 `i2c.open{board=true}` 是共享 I2C0（SDA41/SCL40、100kHz）的只读地址探测授权；不能改 pin/频率，`read/write/transfer` 真机返回 `unsupported`。触摸/IMU 寄存器通过专用模块访问。
- `probe(addr, timeout_ms)` 的 timeout 参数仍需满足 Lua 校验；但板载总线当前调用 `ryz_board_i2c_try_probe`，非阻塞取锁后使用固定 **3ms** 探测，忽略传入的等待时长。只有外部 I2C 使用该 timeout；不能据 `probe(addr,20)` 宣称板载会等待 20ms。
- 外部 I2C 使用 I2C1，7bit 地址限定 `0x08..0x77`。SPI 使用 SPI3，UART 仅 UART1/2；SPI2、I2C0 系统所有权不能通过自定义 pin 绕过。
- pin 策略权威来源 `components/ryz_tool_pins/ryz_tool_pins.c::ryz_tool_pin_reason`。目前 13..18、21、38、47、48 为候选；33..37 随八线 Flash/PSRAM 配置可能保留。候选不表示已接外设或空闲。USB19/20 不应照抄默认监视器的端口菜单当可用引脚。
- `led` 与 `tools.rgb` 共用板载 RGB 所有者，不要同时申请。`write()` 后轮询 `status()`，以 `state='ready'` 且 `output_known=true` 判断已知输出；`true` 不是发光完成证据。

```lua
-- ryz-app/1
-- 有限板载地址扫描；不读写共享器件寄存器。
local board, i2c = require('ryzobee'), require('i2c')
local bus, err = i2c.open{board=true}
if not bus then print('open:', err); return end
for address = 0x08, 0x77 do
    local ack, reason = bus:probe(address, 10)
    if ack == nil then print('probe:', reason); break end
    if ack then print(string.format('ACK 0x%02X', address)) end
    board.sleep_ms(1)
end
local closed, reason = bus:close()
if not closed then print('close:', reason) end
```

## Legacy bring-up 入口差异

仅维护未带 `ryz-app/1` 的历史脚本时查 `components/ryz_runtime/lua_runtime.c::require_native/open_display/open_touch`，不要拼接两套表结构。Legacy 没有 `ui`、`tools`；额外 `display.read_pixel(x,y)` 返回 RGB565；`touch.info()` 有控制器与底层统计，`touch.read()` 有 fingers/gesture/raw_event，不是上述 app 表结构。新脚本优先 app ABI。

## 源码与默认范例导航

- Lua 绑定：`components/ryz_runtime/lua_hardware.h`、`lua_peripherals.h`、`app_runtime.c`。
- 实机适配/资源：`components/ryz_runtime/lua_hardware_esp.c`、`peripheral_esp.c`；`components/ryz_tool_pins/ryz_tool_pins.c`。
- 当前默认用法：`scripts/tool_i2c.lua` 为 Lua 扫描状态机；`tool_monitor.lua` 用 `uart/log` 与 Lua 有界历史缓冲；`tool_hardware.lua` 用公开板载能力。优先复用行为而非复制其 UI 大块布局。
- 契约回归：`tests/lua_peripherals_test.c` + `test_lua_peripherals.py`，`tests/lua_hardware_test.c` + `test_lua_hardware.py`。虚拟 GPIO/UART/I2C/SPI/ADC peer 的返回和接线只是测试 fixture，不能写成硬件规格。
