# APPS 脚本头部与文件约束

基线：2026-09-17，RootMaker V0.10.1 当前工作树。源码锚点均相对 `firmware/rootmaker`。

## 两种解析，不能混为一谈

| 消费者 | 规则 | 影响 |
| --- | --- | --- |
| `app_runtime.c:ryz_app_is_source` | byte 0 必须为 `-- ryz-app/1`，其后为 EOF、换行、CR、空格或 Tab | 选择 App facade，才有 `ui` / `tools` 和 App 版 board 接口 |
| `ryz_script_metadata.c:ryz_script_metadata_parse` | 扫描文件开头的普通 `--` 行注释和空白行 | 提取作者、版本、简介，不运行 Lua |

**新 App 采用无 BOM、marker 第一行的标准模板。** 元数据解析器虽然容忍文件 byte 0 的一个 UTF-8 BOM，App dispatcher 不容忍；不要为兼容元数据而给 App 加 BOM。把 metadata 放在 marker 前同样会丢失 App 路由。

## 精确字段

| 标签 | 最大值长度 | 说明 |
| --- | --- | --- |
| `-- @author: ...` | 80 字节 | 作者显示文本，无身份认证 |
| `-- @version: ...` | 32 字节 | 纯文本，不强制 SemVer；本技能建议 `1.2.3`，UI 是否补 V 由展示层决定 |
| `-- @description: ...` | 256 字节 | 单行简介，不支持续行；中文按 UTF-8 字节计数 |

最大长度不含 C 末尾 NUL。三字节汉字通常每个占 3 字节，不能将“256 字节”写成“256 汉字”。

语法：行首允许空格/Tab，`--` 后和冒号后可有零个或多个空格/Tab；值两端空格/Tab会去除。标签区分大小写，冒号前不能留空格。未知普通注释被忽略；不解释 Lua 字符串、转义、JSON 或 Markdown。

```lua
-- ryz-app/1
-- @author: Example author
-- @version: 1.2.3
-- @description: 展示传感器状态，并在数据不可用时报告原因。
local board = require('ryzobee')
```

以下不是等价格式：`@Author:`、`@author :`、`@version=`、`author:`。`@name`、`@title`、`@license`、`@created`、`@updated` 当前不会变成 APPS 字段；可作为普通注释保存，但不要宣称会被提取。

## 边界、重复和异常

- 第一条非空且不是行注释的源代码结束 header；代码下面再加标签不会被读取。
- `--[[`、`--[=[` 等长注释起始行也结束 header；其中/之后的字段不会读取。`-- [[` 是普通行注释，不等同 Lua 长注释。生成时不要利用这种细微差别。
- 接受 LF、CRLF 和空白行。禁止给字段内写换行续段；不把字符 `\\n` 当换行展开。
- 第一个已识别字段获胜，包括空值或无效值；再次出现同名字段只令 `invalid=true`，不能“在下面补正确的覆盖它”。
- 值须为严格 UTF-8；控制字符、DEL/C1、双向/零宽等格式控制被拒绝。值内部 Tab 也非法；外侧 Tab 只是空白。
- 有效但过长的值保留不截断码点的前缀并标 `truncated`；整条原值仍须合法。含非法字节/控制码的首次值会清空并标 `invalid`。
- 解析返回 `ESP_OK` **不表示字段完整、没截断或 Lua 可执行**。读取 `present/invalid/truncated`；本技能的生成检查要求三个值均非空、存在、有效且无截断。

## 文件名、时间与入口

- Store 接收 1–36 个 `[A-Za-z0-9_-]` 后接小写 `.lua`，总长 ≤40。上传给 Store 的是 basename，不是 `/scripts/name.lua` 路径；文件系统根由 C 管理。
- Store 源码非空、无 NUL、≤16384 字节。APPS 名称来自文件名，不来自简介。
- 创建/修改时间由 C Script Store 的记录管理，不从头部作者或日期注释推算。出厂镜像时间记录也不等于作者创作时间。
- `boot.lua` 是特殊启动文件名。设置开机脚本是通过 C 复制选中源码到独立 `boot.lua`，修改原文件不自动更新副本；清除自启仅删此副本。不要为了测试自动覆盖它。
- `scripts/` 是维护/示例源；`fs/` 是进入出厂镜像的脚本集合，二者并非全部一一对应。更改示例不等于下次固件已经包含它。

源码：`components/ryz_script_metadata/{ryz_script_metadata.c,include/ryz_script_metadata.h}`、`tests/script_metadata_test.c`、`components/ryz_script_store/{ryz_script_store.c,include/ryz_script_store.h}`、`tools/prepare_factory_scripts.py`、`components/ryz_runtime/app_runtime.c`。
