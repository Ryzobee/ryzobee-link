# 固件文档导航

读取条件：开始编写/审查脚本、目标固件变化，或遇到尚未查证的接口时。这里只提供发现路径和版本选择方法，不是接口快照。

## 版本与来源

- 官方仓库：[Ryzobee/ryzobee-firmware](https://github.com/Ryzobee/ryzobee-firmware)。从 [docs 目录](https://github.com/Ryzobee/ryzobee-firmware/tree/main/docs)及 [docs/README.md](https://github.com/Ryzobee/ryzobee-firmware/blob/main/docs/README.md) 开始；目录内可能有尚未列入索引的新文档。
- 用户指定版本优先。先在仓库核实 tag/分支/commit 是否存在，不猜版本标签的大小写或命名。没有匹配文档时说明缺口，不悄悄用最新版本代替旧设备契约。
- 未指定版本时发现官方默认分支，再解析当前 commit；本页的 `main` 链接是发现入口，不是固定兼容版本。阅读时将链接中的 ref 换成选定 commit，交付保留关键来源永久链接。
- 本地工作树可用时，核对其 remote、HEAD 和相关未提交改动，再读取该树的 docs。若实现已改而文档未更新，明确差异；不要混用相邻同名目录或云端另一版本。
- 能访问公开文档即可工作，不要求使用者准备整个固件仓库或提供 API key。本地工具、浏览器、GitHub API 或宿主的文档读取能力任选可用方式；文件位置以实际目录为准。

已安装且可用的 `gh` 可这样只读发现（指定版本时，用已核实的 ref 替换第一行的默认分支结果）：

```sh
firmware_ref=$(gh repo view Ryzobee/ryzobee-firmware --json defaultBranchRef --jq '.defaultBranchRef.name')
firmware_commit=$(gh api "repos/Ryzobee/ryzobee-firmware/commits/$firmware_ref" --jq .sha)
gh api "repos/Ryzobee/ryzobee-firmware/contents/docs?ref=$firmware_commit" --jq '.[].path'
gh api "repos/Ryzobee/ryzobee-firmware/contents/docs/README.md?ref=$firmware_commit" \
  -H 'Accept: application/vnd.github.raw+json'
```

随后列出相关子目录并读取选中文档全文或完整相关章节，不能把文件名、搜索摘要或 HTTP 成功当成已阅读接口。浏览器页面无法取正文时可尝试同一 commit 的 raw/Contents API；权限、限流或离线仍无法读取时，请用户提供对应正文，不反复索要不可用工具。

## 按任务查找

下表是当前可用的文档入口，**不是完整模块列表**。先核实它们在选定版本存在；文件改名或新能力加入时回到该版本的 docs 索引/目录搜索。每次任务重新发现，不把本表固定成能力上限。

| 任务 | 优先查阅 |
| --- | --- |
| 应用头部、文件名与脚本入口 | [应用与元数据](https://github.com/Ryzobee/ryzobee-firmware/blob/main/docs/software/firmware-script-apps.md)、[脚本存储](https://github.com/Ryzobee/ryzobee-firmware/blob/main/docs/software/firmware-script-store.md) |
| 模块、数值/运行限制、调度、板载能力 | [Lua 平台](https://github.com/Ryzobee/ryzobee-firmware/blob/main/docs/software/firmware-lua-platform.md)、[Lua 沙箱](https://github.com/Ryzobee/ryzobee-firmware/blob/main/docs/software/firmware-lua-sandbox.md) |
| 屏幕、字体、布局、交互与资源归属 | [Lua UI](https://github.com/Ryzobee/ryzobee-firmware/blob/main/docs/software/lvgl-lua-ui.md)、[UI 所有权](https://github.com/Ryzobee/ryzobee-firmware/blob/main/docs/software/firmware-ui-owner.md) |
| GPIO、总线、串口、定时器、日志等外设 | [Lua 通用外设](https://github.com/Ryzobee/ryzobee-firmware/blob/main/docs/software/firmware-lua-peripherals.md) |
| 配置保存、进度恢复、持久数据 | [Lua 文件存储](https://github.com/Ryzobee/ryzobee-firmware/blob/main/docs/software/firmware-lua-filesystem.md) |
| 接线、引脚或板载器件 | [RootMaker 硬件](https://github.com/Ryzobee/ryzobee-firmware/blob/main/docs/hardware/rootmaker.md)，结合任务对应的软件接口文档 |
| 用户要求上传、执行或调试通信 | [Workbench 协议](https://github.com/Ryzobee/ryzobee-firmware/blob/main/docs/software/lua-workbench-protocol.md)、[脚本存储](https://github.com/Ryzobee/ryzobee-firmware/blob/main/docs/software/firmware-script-store.md)，并核对所用客户端 |

在本地所选仓库可先用 `rg --files docs` 查看目录，再用 `rg -n -i 'lua|脚本|所需功能词' docs` 找入口。找到文档后沿其相对链接查示例、组件 README、实现和验证工具；这些链接相对**固件文档**，不是本技能目录。

## 阅读与验证边界

- 技术文档可能保留旧阶段、计划、废弃限制或历史验收；阅读开头更新说明及相关后续章节，确认当前生效的规则。发生冲突时查同一 commit 的实现/默认示例，说明采用哪份依据；无法确定则保留未验证状态。
- 文档只描述了一部分接口时，不凭其它平台、模块名字或硬件规格推导其余方法。缺少方法说明不等于不支持：继续沿索引/实现查证或指出缺项。
- 能力、脚本头部、字体、引脚、配额、错误和返回结构均以目标版本为准；本技能不另存一份表，不把源码分析结果回填成长期接口快照。
- 示例和验证命令也随所选版本查找。先确认脚本是否实际执行、是否访问真机或改写数据，再在授权范围内使用；文档中的历史烧录命令不是本次操作授权。
- 只验证本次脚本需要的行为，不要求用户运行维护者全量回归。做 Host 回放时限制时间与输出，区分调用实际覆盖、像素效果和物理设备证据。
- Link 是独立项目，其客户端约束/模拟器版本不由固件 docs 自动同步；历史 Studio 文档中的流程也不应转化为 Link 的额外上传门槛。
