# Ryzobee Link skill

[English](#english) · [简体中文](#简体中文)

## English

Start with the [illustrated walkthrough](../../docs/ai-quickstart.en.md): real screenshots show the permission dialog, MCP page and interactive simulator. You describe the task to your assistant; you do not need to enter JSON manually.

This standalone skill teaches a browser-capable AI assistant to control Ryzobee Link through MCP JSON-RPC tool calls: edit browser drafts, run the UI simulator, interact with the simulated display, upload/run device scripts, and inspect logs. The custom browser transport is not an HTTP MCP endpoint. It is independent of [`ryzobee-lua`](../ryzobee-lua/README.md), which covers Lua authoring and firmware documentation.

Copy this **entire directory**, including `SKILL.md`, `references/` and `agents/`, to your assistant's skill directory. For Codex, the default location is `~/.codex/skills/ryzobee-link/`. Start a new task or reload skills, then invoke:

> Use $ryzobee-link on <https://ryzobee.github.io/ryzobee-link/> to open my Lua file and run its UI simulation.

Confirm that the target site has deployed V1.1.0 or a compatible MCP-capable release. To test a fork, substitute its Pages URL. Your assistant needs browser automation (DOM controls or page JavaScript); an HTTP-only tool cannot control a static page. Link asks for session permission on the user page. Device access additionally requires desktop Chrome/Edge, a connected compatible board and the browser's serial chooser. No model API key, server, firmware checkout, or mandatory test harness is required to use this skill. Writing Lua may benefit from installing the separate Lua skill too.

## 简体中文

先看[图文上手指南](../../docs/ai-quickstart.md)：用真实截图说明授权弹窗、MCP 页面和模拟器反馈。你向助手描述任务即可，不需要手工填写 JSON。

独立的 Link 操作 skill：让具备浏览器工具的 AI 通过标准 MCP JSON-RPC 工具调用编辑草稿、运行 UI 仿真、点击模拟屏幕、传输/运行设备脚本和查看日志。使用自定义浏览器传输，不是 HTTP MCP endpoint。与负责 Lua 编写及固件接口查证的 [`ryzobee-lua`](../ryzobee-lua/README.md) 分开安装。

复制**整个目录**到 AI 工具的 skill 目录，包含 `SKILL.md`、`references/` 和 `agents/`。Codex 默认位置为 `~/.codex/skills/ryzobee-link/`。开启新任务或重新加载后，例如：

> 使用 $ryzobee-link 打开 <https://ryzobee.github.io/ryzobee-link/>，把我的 Lua 文件放进去并运行 UI 仿真。

先确认目标站点已经发布 V1.1.0 或兼容的 MCP 版本；使用 fork 时换成对应 Pages 地址。AI 需要浏览器 DOM 或页面 JavaScript 工具，只有 HTTP 请求能力不够。用户页会请求本次控制授权；操作设备还需要兼容固件、桌面 Chrome/Edge 和用户选择串口。不需要模型 API key、服务端、固件源码或强制测试工具。写 Lua 时可另外安装 `ryzobee-lua`。

For a fork, open a matching pair, such as `https://geekheart.github.io/ryzobee-link/` and `https://geekheart.github.io/ryzobee-link/agent.html`. 使用 fork 时，用户页与 AI 页必须来自同一部署，不要混用官方与 fork 地址。MCP 初始化、用户允许控制、用户选择串口是三个不同步骤。

See / 参见 [command guide / 命令指南](../../docs/agent-commands.md). After copying this skill outside the repository, use the [online repository docs](https://github.com/Ryzobee/ryzobee-link/tree/main/docs); relative links above refer to the repository layout. 将 skill 单独安装到本机后，以上仓库相对链接可改从在线 docs 查看；尚未合并的新版本请查看对应 fork 分支。
