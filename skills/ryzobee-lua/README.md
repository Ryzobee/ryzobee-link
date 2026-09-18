# RyzoBee Lua Skill

[English](#english) · [简体中文](#简体中文)

## 简体中文

这是供 AI 编程助手使用的技能包，不是 Link 的浏览器插件或 Lua 库。它引导 AI 先读取 [Ryzobee 固件仓库的 docs](https://github.com/Ryzobee/ryzobee-firmware/tree/main/docs)，再按目标版本生成、修改和审查 RootMaker Lua 脚本。接口、脚本头部、示例及验证入口随固件文档维护，不在本包中复制一份。安装不会自动连接、写入或烧录设备，也不会给 Link 增加 AI 后端。

### 安装

从本仓库复制**整个 `skills/ryzobee-lua` 文件夹**，不要只复制 `SKILL.md`。先审阅内容；目标已存在时先备份或比较，避免覆盖自己的修改。升级旧版时，备份后替换整包，不要仅覆盖同名文件而留下旧接口表、示例和校验器。

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

其他 Agent 可加载 `SKILL.md` 并按链接读取 `references/`；同时需要可用的网页/文档读取工具，或用户提供的对应版本文档。仅把入口文件粘贴到聊天会丢失文档导航。

### 使用

在 Codex 中明确调用；有目标固件版本、commit 或本地工作树时一并提供，未指定时 AI 将查阅官方默认分支当前文档并说明兼容性尚未与设备核对：

```text
$ryzobee-lua 请为 RootMaker 编写可记住选择的主题切换界面。
先读取官方固件仓库当前 docs，并记录使用的版本。
完成 Lua 文件；不要连接或写入设备。
```

生成 `.lua` 后在 Link 中「打开」，纯 UI 可点击模拟器运行；需要实机时由用户连接后「发送」。Link 模拟器仅覆盖其运行时支持的 UI，可能落后于最新固件接口；模拟器不支持某能力不等于设备固件不支持。**验证是开发辅助，不是 Link 上传令牌或发送门槛。**

### 文档与验证环境

阅读公开文档不要求本地固件源码、编译器或 API key。AI 可使用宿主已有的浏览器、GitHub API 或文件读取工具；离线时提供匹配版本的本地文档或相关正文。没有文档且无法联网时，AI 会请求资料，不猜测接口。

语法、Host/模拟器等验证工具及其依赖从同版本固件文档查找；本技能不再附带固定 ABI 的校验器或维护者测试套件。是否需要固件源码、SDK 或其它环境取决于选用的工具。缺少环境时交付会明确标记未验证，不自动下载 SDK 或访问设备；语法、已执行行为、像素和实机证据分开说明。

### 内容与版本边界

- `SKILL.md`：入口和工作流程；`agents/`：Codex 展示配置。
- `references/firmware-docs.md`：上游文档导航、版本选择与查证边界。
- `README.md` 与 `LICENSE`：安装使用说明与 MIT 协议。

同一次任务使用同一版本的文档、示例和必要源码。导航链接只是发现入口，目录改名或新增接口时应重新查找，不能把导航表当作固件能力上限。未指定设备版本时不承诺最新接口兼容现有设备；见 [固件文档导航](references/firmware-docs.md)。技能按随包 [MIT](LICENSE) 协议发布。

## English

This is an AI coding skill, not a browser extension or Lua module. It guides the assistant to the [official firmware docs](https://github.com/Ryzobee/ryzobee-firmware/tree/main/docs) before writing or reviewing RootMaker Lua. APIs, metadata, examples and validation tools are maintained upstream, not copied into this package. It neither adds an AI backend to Link nor grants permission to connect or flash hardware.

### Install and invoke

Copy the **entire** `skills/ryzobee-lua` directory to either `~/.agents/skills/ryzobee-lua` (user scope) or your project's `.agents/skills/ryzobee-lua`. The shell and PowerShell examples above refuse to overwrite an existing installation. Review or back up existing copies first; avoid duplicate installations. When upgrading, replace the complete package after backup instead of overlaying files and leaving old API references, templates or validators behind. Check the skill selector after installation and restart the client if needed. See the [official Codex guide](https://learn.chatgpt.com/docs/build-skills).

Invoke `$ryzobee-lua` and provide a target firmware version, commit or local checkout if known. For example: “Create a theme picker that remembers my choice; consult current official firmware docs, record the version used, and do not access hardware.” Without a target version, the assistant reads the current default branch and notes that device compatibility is unconfirmed. Other agents need the entrypoint **and linked resources**, plus a way to read upstream docs or matching documentation supplied by the user.

### Validate and use with Link

Reading public docs requires neither a local firmware checkout nor a compiler or API key. An available browser, GitHub API or file reader is sufficient; offline use requires matching local docs or supplied text. If neither source is available, the assistant requests documentation instead of inventing interfaces.

Validation tools and dependencies are discovered in the same firmware version's docs. This package no longer bundles ABI-specific validators or maintainer test suites. Missing tools are reported as unverified; SDK installation and hardware access are not automatic. Syntax checks, executed behavior, pixels and physical-device results are separate evidence. Open the resulting script in Link, simulate supported UI if useful, then explicitly connect/send when desired. Validation is **not** an upload gate.

Use one firmware version for docs, examples and any required source inspection. The [documentation map](references/firmware-docs.md) is a discovery aid, not an API ceiling or compatibility guarantee. Link's pinned Wasm may lag behind current firmware; lack of simulator support does not prove lack of device support. The package contains the workflow, documentation map, agent configuration, this guide and its [MIT License](LICENSE).
