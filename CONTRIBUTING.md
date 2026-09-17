# Contributing / 贡献指南

## Pull requests / 提交流程

Do not push directly to `main`. Create a topic branch, commit scoped changes, push the branch and open a PR. Administrators follow the same rule. Force pushes and deletion of `main` are disabled. An additional human approval is not mandatory. Report relevant local verification results in the PR.

不要直接推送 `main`。先建立功能分支，按范围提交，再推送分支并创建 PR。管理员也遵守同样规则；禁止强推及删除 `main`。暂不强制第二人审批；在 PR 中记录相关本地验证结果。

```sh
git switch main
git pull --ff-only
git switch -c feat/editor-empty-state
# Make and verify your changes / 修改并验证
git add src/style.css
git commit -m "✨ feat(editor): improve empty workspace layout"
git push -u origin feat/editor-empty-state
gh pr create
```

## Commit messages / 提交规范

```text
<emoji> <type>(<scope>): <summary>
```

Use exactly one of these pairs. The scope is required and describes the affected module; use lowercase letters, numbers and hyphens (e.g. `editor`, `serial`, `simulator`, `logs`, `docs`, `ci`, `release`). Keep the summary concise and meaningful, in English or Chinese. Do not include secrets or personal data.

必须使用下列固定 emoji / 前缀组合；范围必填，使用小写字母、数字、连字符。简介可中英文，准确说明改动，不填写密钥或个人数据。

| Pair / 组合 | Purpose / 用途 |
| --- | --- |
| ✨ feat | New functionality / 新功能 |
| 🐛 fix | Bug fix / 修复缺陷 |
| 🎨 style | Visual or formatting changes / 视觉样式、格式调整 |
| ♻️ refactor | Restructure without behavior changes / 不改变行为的重构 |
| ⚡️ perf | Performance improvement / 性能优化 |
| 📝 docs | Documentation / 文档 |
| ✅ test | Tests / 测试 |
| 🔧 chore | Dependencies, build and maintenance / 依赖、构建及维护 |
| 👷 ci | CI workflow / 自动化流程 |
| ⏪️ revert | Revert a change / 撤销改动 |

Examples / 示例：

```text
🐛 fix(serial): preserve unknown status after interrupted uploads
🎨 style(editor): 放大空工作区图标并统一按钮间距
📝 docs(deploy): document HTTPS static hosting
```

PR titles follow the same format. The required `PR checks` workflow validates the title and builds the application (including type checking). Squash merging uses the PR title as the final commit title; only squash merging is enabled. Temporary feature-branch commits should also follow the convention, but are not individually checked by this workflow. Existing historical commits are not rewritten.

PR 标题同样遵守规范。必需的 `PR checks` 工作流检查标题格式并构建应用（包含类型检查）。合并仅使用 squash，最终提交标题取自 PR 标题。功能分支中的临时提交也应遵守规范，但该工作流不逐条检查；旧历史不改写。

## Verification / 验证

Run `npm run build` for type checking and production packaging. Run relevant tests for the behavior changed; avoid claiming hardware verification from fake-serial tests. UI changes should include desktop and narrow-screen screenshots. Explain remaining risks in the PR.

执行 `npm run build` 完成类型检查及构建，按修改范围运行相关测试。模拟串口测试不等于实机验证。界面修改附桌面、窄屏截图，并在 PR 说明剩余风险。

Never commit `.env` files, API keys, browser profiles, serial captures containing personal data, `node_modules`, build output or local caches. Do not modify simulator pins/generated runtime assets without following `simulator/README.md`.

不要提交密钥、浏览器个人数据、本地缓存或构建目录。模拟器版本锁和产物更新请遵守专门的构建说明。
