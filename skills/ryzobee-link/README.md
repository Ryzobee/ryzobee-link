# Ryzobee Link skill

[English](#english) · [简体中文](#简体中文)

## English

This standalone skill teaches a browser-capable AI assistant to control Ryzobee Link through MCP JSON-RPC tool calls: edit browser drafts, run the UI simulator, interact with the simulated display, upload/run device scripts, and inspect logs. The custom browser transport is not an HTTP MCP endpoint. It is independent of [`ryzobee-lua`](../ryzobee-lua/README.md), which covers Lua authoring and firmware documentation.

Copy this **entire directory**, including `SKILL.md`, `references/` and `agents/`, to your assistant's skill directory. For Codex, the default location is `~/.codex/skills/ryzobee-link/`. Start a new task or reload skills, then invoke:

> Use $ryzobee-link on https://ryzobee.github.io/ryzobee-link/ to open my Lua file and run its UI simulation.

To test a fork, substitute its Pages URL. Your assistant needs browser automation (DOM controls or page JavaScript); an HTTP-only tool cannot control a static page. Link asks for session permission on the user page. Device access additionally requires desktop Chrome/Edge, a connected compatible board and the browser's serial chooser. No model API key, server, firmware checkout, or mandatory test harness is required to use this skill. Writing Lua may benefit from installing the separate Lua skill too.

## 简体中文

独立的 Link 操作 skill：让具备浏览器工具的 AI 通过标准 MCP JSON-RPC 工具调用编辑草稿、运行 UI 仿真、点击模拟屏幕、传输/运行设备脚本和查看日志。使用自定义浏览器传输，不是 HTTP MCP endpoint。与负责 Lua 编写及固件接口查证的 [`ryzobee-lua`](../ryzobee-lua/README.md) 分开安装。

复制**整个目录**到 AI 工具的 skill 目录，包含 `SKILL.md`、`references/` 和 `agents/`。Codex 默认位置为 `~/.codex/skills/ryzobee-link/`。开启新任务或重新加载后，例如：

> 使用 $ryzobee-link 打开 https://ryzobee.github.io/ryzobee-link/，把我的 Lua 文件放进去并运行 UI 仿真。

使用 fork 时换成对应 Pages 地址。AI 需要浏览器 DOM 或页面 JavaScript 工具，只有 HTTP 请求能力不够。用户页会请求本次控制授权；操作设备还需要兼容固件、桌面 Chrome/Edge 和用户选择串口。不需要模型 API key、服务端、固件源码或强制测试工具。写 Lua 时可另外安装 `ryzobee-lua`。

See / 参见 [command guide / 命令指南](../../docs/agent-commands.md).
