# Lua UI、画布与触摸

读取条件：编写或检查 Lua 屏幕、按钮、滚动列表、图形、触摸交互时读取。
本页以 2026-09-17 审计的 `firmware/rootmaker` 工作树为快照；更新固件后先核对本文末尾注册表与解析函数。
下面源码路径均相对于固件根 `firmware/rootmaker/`，不相对于技能目录。

## 先选显示模式

| 模式 | 使用方式 | 合适场景 |
| --- | --- | --- |
| 托管 UI | `local ui = require('ui')`，`mount` → `poll` / `update` | 品牌字体、按钮、列表、局部数据刷新 |
| 像素画布 | `local display = require('display')`，绘制后 `show()` | 色块、像素图、简单动画；自行处理交互 |

`display.canvas` 是能力/所有权名称，**不是** `display.canvas()` 方法，也没有 `Canvas` 类、全局或构造器。
`ui` 暴露的函数只有 `mount`、`update`、`poll`；没有直接向 Lua 暴露任意 LVGL API。
使用托管 UI 的脚本必须进入 `ryz-app/1` 执行路径，规范头部以 `-- ryz-app/1` 开始。
同一个 app 执行期间选择一个显示所有者：实际调用 `display.clear/rect/text/show` 与 `ui.mount` 互斥。
重新 `ui.mount` 可以换场景；没有 Lua `ui.close/unmount`，脚本结束或被取消时由 C 清理。

## 三个 UI 方法

| 调用 | 成功结果 | 用法边界 |
| --- | --- | --- |
| `generation = ui.mount(scene)` | 正整数世代号，首次为 1，后续挂载递增 | 提交完整场景；切页、改类型/字体/结构时重新挂载 |
| `ui.update(generation, patches)` | 原世代号 | 同一场景增量更新；参数必须恰好两个；空补丁合法 |
| `event = ui.poll([scroll_id])` | 事件 table，或 `nil` | 每次取一次输入并泵送 UI；在有让步的循环中调用 |

这些方法出错时抛出 Lua 错误，不是 `false, err` 或 `{ok=false}`。
`ryz-app/1` 移除了 `pcall/xpcall`，校验错误会退出本次脚本，由宿主报告。
常见错误包括未知字段、越界对象、失效世代、模块/适配器不可用、显示/触摸所有权冲突。
`mount` 返回的是 token，不是可调用对象：使用 `ui.update(g, {...})`，不是 `g:update(...)`。

## scene：完整场景格式

```lua
local generation = ui.mount({
  id = 'home',
  background = 0x0000,
  objects = {
    {id='title', kind='label', x=8, y=8, width=224, height=32,
      text='RYZOBEE', font='title_24', foreground=0xFB40},
  },
})
```

场景只接受 `id`、`background`、`objects`，三项均必填；未知字段会报错。
`objects` 是 0–32 项的连续数组，从 1 开始，不能混用字典键或洞。
场景/对象/父对象 id 是 **`[a-z][a-z0-9_]{0,23}`**，对象 id 在场景内唯一。
屏幕固定为 240×240，坐标左上角为 `(0,0)`；`x` 向右、`y` 向下，数值是像素而非百分比。
数组中较后的按钮优先命中；绘制顺序也按数组建立。避免无意重叠遮挡。

### 对象字段

| 字段 | 类型、默认与约束 |
| --- | --- |
| `id`, `kind` | 必填字符串；kind 为 `box` / `label` / `button` / `viewport` / `image` |
| `x`, `y`, `width`, `height` | 必填整数；x=0..239，宽/高=1..240；无 parent 时 y=0..239，矩形整体须在屏内 |
| `parent` | 可选 viewport id；父对象必须位于数组前面；仅一层，viewport 自身不能有 parent |
| `text` | label/button 必填，1..40 **字节**；其它类型只能省略或为空 |
| `foreground` | RGB565 整数 0..65535，默认 `0xFFFF` |
| `background` | RGB565，默认 `0x0000` |
| `border` | RGB565，默认继承当前 foreground |
| `border_width` | 整数 0..2，默认 0 |
| `radius` | 整数 0..32，默认 0 |
| `font` | 下表固定 token，默认 `body_16`；没有任意 font-size 参数 |
| `align` | `left` / `center` / `right`；label 默认 left，其它类型默认 center |
| `visible`, `enabled` | 真正的 boolean，默认 true；不是 0/1 或字符串 |
| `content_height` | viewport 必填；范围 `height..1024`；其它类型只能省略/0 |
| `scroll_y` | viewport 可选，默认 0；范围 `0..content_height-height`；其它类型只能省略/0 |
| `line_height` | 可选整数，默认 0 使用字体行高；显式值 12..64 |
| `asset` | image 必填，限下列两项；其它类型不能带资产名 |

子对象坐标相对父 viewport 的**未滚动内容**，不是全屏位置；y 可为 0..1023。
子对象的右边/底边不能超过父 width/content_height；单个子对象自身 height 仍不超过 240。
viewport 提供裁切与命中边界，`box` 不是通用容器。

### 正文与字体

Lua `ui` 正文目前只接受可打印 ASCII `0x20..0x7E` 加换行 `\n`；不接受中文、emoji、tab、CR。
包括 `°`、`·` 等非 ASCII 符号也会被 Lua 解析器拒绝，即使底层字体资产含该字形。
注释里的中文和 Lua UI `text` 不是同一限制；不要由元数据可读中文推断 UI 可显示中文。
文本超出框会裁切，不会自动缩小字号；显式分行且预留行高。button 内文字会居中，并有少量水平空间预留。

| token | 字体与像素 |
| --- | --- |
| `body_12`, `body_14`, `body_16` | Noto Sans Regular，12 / 14 / 16 |
| `medium_12`, `medium_14` | Noto Sans Medium，12 / 14 |
| `button_12`, `button_14`, `button_16` | Noto Sans SemiBold，12 / 14 / 16 |
| `title_24` | Noto Sans SemiBold，24；不是 Teko |
| `display_20` | Teko SemiBold，20 |
| `mono_12`, `mono_14` | Roboto Mono Regular，12 / 14 |
| `mono_medium_12`, `mono_medium_13` | Roboto Mono Medium，12 / 13 |
| `mono_semibold_12`, `mono_semibold_14` | Roboto Mono SemiBold，12 / 14 |

默认构建与 C UI 共享静态字形；`CONFIG_RYZ_LUA_FREETYPE` 是固件编译选项，不是 Lua 开关。
即使启用它，Lua 仍使用相同固定字体 token、字号和正文校验；不会自动获得任意字体/Unicode 支持。
label 实际主要采用文字样式；给 label 填 `background/border/radius` 不会自动画出卡片。
需要背景/描边时使用独立 box 或 button；image 使用内置像素资产，不是通用可着色矢量。

### 内置 image

| asset | 强制尺寸 |
| --- | --- |
| `rootmaker_a_face` | 88×88 |
| `monitor_divider` | 232×2 |

不支持文件路径、URL、自定义 PNG/SVG、缩放或 `image.new`；其它名称/尺寸在解析时失败。

## RGB565，而不是网页颜色

颜色使用 16-bit RGB565 整数；不要传 `'#FF6A00'`、RGBA table 或 24-bit `0xFF6A00`。
常用：黑 `0x0000`、白 `0xFFFF`、主题橙 `0xFB40`。
若确需 RGB888 转换，Lua 整数运算可写：

```lua
local function rgb565(r, g, b)
  return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)
end
```

输入自行限定为 0..255；当前节点 schema 没有 opacity、渐变或 RGBW 字段。

## update：保持结构、只补数据

```lua
ui.update(generation, {
  {id='title', text='RUNNING', foreground=0xFFFF},
  {id='action', enabled=false},
})
```

- `patches` 是最多 32 项的连续普通 table 数组，数组和每条 patch 都不能有 metatable。
- 每条 patch 必须有已存在的 id，一次调用不能对同一 id 写两条。
- 可补字段：`text`, `foreground`, `background`, `border`, `visible`, `enabled`, `scroll_y`, `y`, `height`, `width`。
- `scroll_y` 仅能给 viewport 设置非零值；值必须已夹紧。
- **仅 box** 可以实际改变 `y/height/width`，适合滚动条滑块与进度条；必须仍处于屏幕或父 viewport 内容范围内。
- 其它类型即使提交相同几何值合法，也不能用 update 移动/缩放；改变字体、x、kind、parent、line_height、radius 等须重新 mount。
- 不支持删除、增加或重排对象；也不通过 update 改场景背景。
- 全部补丁先验证，再交给渲染器；无变化或空补丁不触发适配器更新。
- 验证失败不会部分应用；适配器执行失败可能已有像素变化，运行时结束并清理，不能声称渲染失败可回滚。

保存 mount 返回的 generation。每次 remount 后更新它；旧 token 会报 `ui update requires current generation`。
update 成功不递增 generation。频繁数值刷新优先 update，避免反复 mount 丢失手势捕获和重建控件。
按钮内容/颜色/可见性等实质变化会取消正在按下的按钮捕获；仅刷新其它 label 通常保留捕获。

## poll：点击与拖动

```lua
-- 激活：在同一可见、可用按钮上按下并释放。
{kind='activate', scene='home', generation=1, id='action', at_ms=123}
-- 滚动：传入 scroll_id 的区域捕获了纵向拖动。
{kind='scroll', scene='home', generation=1, id='list', at_ms=123, dy=-12}
```

无事件返回 `nil`；不会返回 `down/move/up`、长按事件、完整坐标或事件数组。
`ui.poll('list')` 每次只启用一个已挂载 box/viewport 的滚动区域；下一次仍须传相同 id。
省略、更换 id，或隐藏/禁用该区域，会撤销旧拖动。下发后只消费匹配当前 generation 的业务事件。
首次累计位移绝对值至少 6 px 才开始拖动；开始后输出每次非零增量，`dy>0` 表示手指向下。
拖动一旦成立就不会再生成 click。viewport 内按钮允许轻点与拖动竞争；普通 box 区域上的按钮优先点击。
`ui.poll` **不会自动修改滚动偏移**；Lua 维护位置并调用 update：

```lua
local event = ui.poll('list')
if event and event.generation == generation and event.kind == 'scroll' then
  offset = math.max(0, math.min(content_height - view_height, offset - event.dy))
  ui.update(generation, {{id='list', scroll_y=offset}})
end
```

无内置惯性、自动滚动条或自动 focus。横向 swipe 需要选择原始触摸路线，不能由只有 dy 的 scroll 事件推导。
如果确实需要原始触摸坐标/按住时长，选择 `touch.read()` 自己实现交互；同一执行中不能再用 `ui.poll()`。
`touch.info()` 是只读查询；`touch.demo(...)` 与已挂载 UI 冲突。
原始 `touch.read()` 返回 `pressed, interrupted, has_position, event, sampled_ms`，有位置时才有 `x,y`。
其 `event` 为 `none/down/move/up`；输入中断时应撤销自己的捕获，避免误触发。

## 最小交互脚本

以下只依赖 app 的 UI、时间与输入适配器：屏幕显示计数，点击加一；由宿主停止/设备 BOOT 退出。
不要把它作为同步无限执行任务；执行模式、超时/退出要求见技能的运行时引用。

```lua
-- ryz-app/1
-- @author: Unknown
-- @version: 0.1.0
-- @description: Tap ADD to increase a counter, capped at 9999.
local board = require('ryzobee')
local ui = require('ui')
local count, maximum = 0, 9999
local generation = ui.mount({id='counter', background=0x0000, objects={
  {id='title',kind='label',x=12,y=20,width=216,height=34,
    text='RYZOBEE',font='title_24',foreground=0xFB40,align='center'},
  {id='value',kind='label',x=12,y=88,width=216,height=32,
    text='COUNT 0',font='body_16',foreground=0xFFFF,align='center'},
  {id='add',kind='button',x=24,y=164,width=192,height=48,
    text='ADD',font='button_16',foreground=0x0000,background=0xFB40,radius=4},
}})
while true do
  local e = ui.poll()
  if e and e.generation == generation and e.kind == 'activate' and e.id == 'add' and count < maximum then
    count = count + 1
    ui.update(generation, {{id='value',text='COUNT '..count}, {id='add',enabled=count < maximum}})
  end
  board.sleep_ms(20)
end
```

## display 直接画布速查

`ryz-app/1` 中只注册下面四项；`display.read_pixel` 属于非 app 的旧路径，不应写进新 app。

| 调用 | 行为 |
| --- | --- |
| `display.clear(color)` | 清 RAM 画布，无返回值；不会代替 show |
| `display.rect(x,y,w,h,color)` | 实心矩形，整体须在 240×240 内；宽高正数，无返回值 |
| `display.text(x,y,text,color[,scale])` | 可打印 ASCII 1..40 bytes，scale=1..6 默认 1；字框宽 `(bytes*6-1)*scale`、高 `7*scale` 必须入屏 |
| `display.show()` | 提交已绘制画面，成功返回 true；错误抛出 |

```lua
-- ryz-app/1
local display = require('display')
display.clear(0x0000)
display.rect(8, 8, 224, 4, 0xFB40)
display.text(8, 24, 'RYZOBEE', 0xFFFF, 3)
display.show()
```

此模式的 text 是简单像素字，不能使用托管 UI 的字体 token/字号；多操作完成后一次 show。
app 入口接受可打印 ASCII 不等于底层有所有字形；真实 display 字库限大写/数字及有限标点，使用大写文案并查字库。
展示是否持续由执行宿主清理策略决定，脚本返回不意味着自动保持交互页面。

## 源码定位与复核入口

- 模块注册：`components/ryz_runtime/app_runtime.c:972` (`open_ui`)、`:981` (`require_native`)。
- 所有权与 id：同文件 `:171`、`:187`；display/touch：`:279`–`:419`。
- 节点解析：同文件 `:504` (`parse_ui_object`)；场景：`:622` (`parse_ui_scene`)。
- 三方法实现：同文件 `:667` / `:721` / `:855`；结束清理：`:1059`。
- 结构与限额：`components/ryz_lvgl/include/ryz_ui.h:11`；字体映射：`components/ryz_lvgl/ryz_lvgl.c:238`。
- 字体实体：`components/ryz_font/ryz_font.c:98`；实际控件样式：`components/ryz_lvgl/ryz_lvgl.c:443`。
- display 字库：`components/ryz_board/display_font.h:12` / `:62`；渲染检查：`components/ryz_board/display.c:604`。
- 回归：`tests/app_runtime_test.c:318`（增量）、`:479`（scroll）、`:559`（viewport/资产）、`:728`（新增字体）、`:744`（box width）。
- 工具脚本：`fs/tool_monitor.lua:118`（挂载与补丁拆分）、`:277`（暂停后滚动）；`fs/tool_i2c.lua:77`（结果列表虚拟化）。
- 较早诊断示例 `scripts/ui_demo.lua`、`scripts/ui_update_demo.lua` 可参考 API，不把其旧界面文案当最新产品交互要求。
- 接口回归入口为 `tools/test_app_runtime.sh`；宿主/真机是不同验证层，接口测试通过不代表显示及真实触摸已验收。
