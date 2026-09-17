# RyzoBee Lua Skill

[English](#english) · [简体中文](#简体中文)

## 简体中文

这是供 AI 编程助手使用的技能包，不是 Link 的浏览器插件或 Lua 库。它帮助生成、修改和审查 RootMaker Lua 脚本，覆盖 APPS 元数据、240×240 UI、真实原生接口、资源限制及有界 Host 验证。安装技能不会自动连接、写入或烧录设备，也不会给 Link 增加 AI 后端。

### 安装

从本仓库复制**整个 `skills/ryzobee-lua` 文件夹**，不要只复制 `SKILL.md`。先审阅内容；目标已存在时先备份或比较，避免覆盖自己的修改。

Codex 当前支持用户级 `~/.agents/skills/` 和项目级 `.agents/skills/`；选一个位置安装，避免重复发现同名技能。以下命令从 Link 仓库根执行，仅在目标不存在时复制：

```sh
skill_dest="$HOME/.agents/skills/ryzobee-lua"
if [ -e "$skill_dest" ]; then
  echo "目标已存在，请先比较或备份：$skill_dest"
else
  mkdir -p "$HOME/.agents/skills"
  cp -R skills/ryzobee-lua "$skill_dest"
fi
```

Windows PowerShell：

```powershell
$skillDest = Join-Path $HOME '.agents/skills/ryzobee-lua'
if (Test-Path $skillDest) {
  throw '目标技能已存在，请先比较或备份。'
}
New-Item -ItemType Directory -Force (Split-Path $skillDest) | Out-Null
Copy-Item -Recurse ./skills/ryzobee-lua $skillDest
```

只对某项目使用时，将完整文件夹复制到该项目的 `.agents/skills/ryzobee-lua`。已使用 `~/.codex/skills` 的旧配置请按客户端实际加载位置管理，不要同时安装两份。安装后在技能选择器检查 `ryzobee-lua`，未出现则重启客户端。[Codex 官方技能说明](https://learn.chatgpt.com/docs/build-skills)

其他 Agent 可加载 `SKILL.md` 并按链接读取 `references/`，同时保留 `scripts/`、`assets/`、`tests/` 相对路径；仅把入口文件粘贴到聊天会丢失接口和验证资料。

### 使用

在 Codex 中明确调用，并给出目标固件根：

```text
$ryzobee-lua 请为 RootMaker 编写一个点击加一的计数器。
固件路径：/absolute/path/to/firmware/rootmaker。
保留完整 APPS 摘要，使用托管 UI；执行有界 Host 检查，不连接设备。
```

生成 `.lua` 后在 Link 中「打开」，纯 UI 可点击模拟器运行；需要实机时由用户连接后「发送」。模拟器不模拟外设，技能快照与 Link 的 Wasm 版本也可能不同。**Host 验证是开发辅助，不是 Link 上传令牌或发送门槛。**

### 可选本地检查

阅读技能参考不需要 Python。运行检查器需要 Python 3.9+、macOS/Linux 原生 C 编译器及匹配的固件工作树（包括 `host/`、相关 `tests/`、`components/` 和已准备的 `managed_components/georgik__lua`）。Link 仓库不包含这些固件依赖；不要用系统 Lua 替代冻结 Lua。Windows 原生检查器未验证，可使用自行配置的 WSL/Linux 环境，但不承诺其已验收。

在技能目录运行，替换示例绝对路径：

```sh
python3 scripts/check_script.py --firmware-root /absolute/path/to/firmware/rootmaker assets/ui_counter.lua
python3 scripts/check_ui_runtime.py --firmware-root /absolute/path/to/firmware/rootmaker --duration-ms 1000 assets/ui_counter.lua
```

第一个只检查元数据和语法；第二个执行有界 UI Host，不验证真实 LCD、LVGL 像素或外设。更多回放与硬件虚拟测试见 [接口验证](references/interface-validation.md)。缺少固件依赖时报告未验证，不自动下载或烧录。

### 内容与版本边界

- `SKILL.md`：入口和工作流程；`agents/`：Codex 展示配置。
- `references/`：元数据、运行时、UI、硬件与工具接口。
- `assets/`：计数器示例；`scripts/`：Host 校验器。
- `tests/`：契约测试、正反例和带日期的历史验证记录。反例故意有错，不可作为应用模板。

参考基线为 2026-09-17 的 V0.10.1 工作树，含当时未提交内容。历史测试记录不代表本次重新运行，也不保证任何同版本固件都兼容。以用户选定源码为准；见 [来源与验证](references/sources-and-validation.md)。更新时比较整包，不只替换入口。技能按随包 [MIT](LICENSE) 协议发布。

## English

This is an AI coding skill, not a browser extension or Lua module. It covers RootMaker script metadata, UI/native APIs and bounded Host validation. It neither adds an AI backend to Link nor grants permission to connect or flash hardware.

### Install and invoke

Copy the **entire** `skills/ryzobee-lua` directory to either `~/.agents/skills/ryzobee-lua` (user scope) or your project's `.agents/skills/ryzobee-lua`. The shell and PowerShell examples above refuse to overwrite an existing installation. Review or back up existing copies first; avoid duplicate installations. Check the skill selector after installation and restart the client if needed. See the [official Codex guide](https://learn.chatgpt.com/docs/build-skills).

Invoke `$ryzobee-lua` and provide the absolute path to your selected `firmware/rootmaker` checkout. For example: “Create a touch counter with managed UI, complete APPS metadata and bounded Host checks; do not access hardware.” Other agents need the entrypoint **and linked resources**, not just pasted instructions.

### Validate and use with Link

Reading the skill needs no compiler. Optional validators require Python 3.9+, a native macOS/Linux C compiler and the selected firmware's Host sources, tests, components and frozen Lua dependency. Those are not included in Link. Native Windows validators are unverified.

From the skill directory, run the two commands above with your actual firmware path. The first parses metadata/syntax without running Lua; the second executes a bounded UI Host. Neither proves real hardware or LVGL pixel correctness. Open the resulting script in Link, simulate supported UI if useful, then explicitly connect/send when desired. Validation is **not** an upload gate.

The references describe a dated V0.10.1 working tree, including uncommitted changes. They are not a universal compatibility guarantee or a promise that Link's pinned Wasm has identical APIs. Historical reports under `tests/` are not fresh test results. Follow the [source notes](references/sources-and-validation.md) and [validation guide](references/interface-validation.md). Negative fixtures intentionally contain mistakes. The skill includes its [MIT License](LICENSE).
