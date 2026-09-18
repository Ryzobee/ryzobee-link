# GitHub Pages 部署与版本发布

## 发布规则

- 推送 `V*` 或 `v*` 版本标签时触发 [pages.yml](../.github/workflows/pages.yml)，例如 `V1.0.0`。标签去掉前缀后必须等于 `package.json` 和 `package-lock.json` 的版本。
- 编译的是**标签指向的提交**，不是运行时最新的 `main`。普通分支提交、PR 和仅编辑 Release 说明都不会发布。
- Node.js 22 执行 `npm ci`、`npm run build`，包含类型检查、Vite 打包及完整离线缓存生成。Git 中已有模拟器 JS/Wasm，普通发布不重建固件或模拟器。
- 构建成功后才将完整 `dist/` 上传并部署。构建 job 只有读取源码权限；部署 job 使用 GitHub 自带的短期 token/OIDC，不需要 PAT、API key 或额外仓库密钥。
- Pages 同一时间只保留一个线上版本；不同标签的部署串行处理，不中断正在发布的任务。密集推送多个标签时，GitHub concurrency 只保留最新待运行任务，因此请逐个发布并等待完成。
- 标签确定源码快照，请勿移动或强推已发布标签；内容更新应提升版本并使用新标签。重跑同一次 Actions 任务用于发布失败后的恢复。

## 仓库首次配置

在**要实际发布的仓库**中执行以下配置。fork 和上游是两套独立站点。

1. 确认仓库已允许 Actions 运行，fork 在 Actions 页按提示启用。
2. **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
3. **Settings → Environments → github-pages → Deployment branches and tags** 选择 **Selected branches and tags**，添加类型为 **Tag** 的 `V*` 和 `v*` 规则。不要只允许 `main`，否则标签部署会被拒绝。保留已有合理的审批要求。
4. 确认仓库的 Actions 策略允许工作流引用的官方 `actions/*`。工作流已固定具体提交 SHA；升级依赖时同步版本注释。
5. 使用 `github.io` 时启用 HTTPS；自定义域名需先完成 DNS 和证书配置。

默认 URL 为 `https://<owner>.github.io/ryzobee-link/`。Vite 的 `base: './'` 已支持该子目录，不要把部署方用户名硬编码到应用。`index.html`、`agent.html`、字体、Monaco Worker、Wasm、`sw.js` 都应来自该目录，不能只上传 `index.html`。AI 使用同目录 `agent.html` 或主页面的公开接口；参见[命令指南](agent-commands.md)。

## 维护者发布步骤

先通过 PR 合并版本号、代码和对应的发行说明到发布仓库，再在这个仓库已确认的提交上创建标签。首次 fork 预览可以从 fork 功能分支发布，然后向上游提交 PR，但它**不是组织正式发布**。

以下以版本已经准备好的 `V1.0.0` 为例；先用 `git remote -v` 核对 `origin` 指向实际目标，确认 `HEAD` 是待发布提交：

```sh
git remote -v
git status --short
git log -1 --oneline
npm ci
npm run build
git tag -a V1.0.0 -F docs/releases/V1.0.0.md
git push origin V1.0.0
```

在 Actions 中等待 **Publish tagged release to Pages** 成功，然后打开部署结果 URL，检查编辑器、模拟器交互和离线重开。串口连接需要用户主动授权；上线检查不会自动写入设备。

如需将说明展示在 GitHub Releases，显式指定刚才推送标签的仓库，避免多 remote 的 fork 工作区被 `gh` 默认指向上游。下面是个人 fork 的示例；正式组织发布时替换 `--repo`：

```sh
gh release create V1.0.0 --repo geekheart/ryzobee-link --verify-tag \
  --title 'V1.0.0 · RYZOBEE LINK 首个正式版本' \
  --notes-file docs/releases/V1.0.0.md
```

`--verify-tag` 避免误从默认分支创建另一份标签。Release 仅展示说明；真正的构建触发点是标签 push。若标签已存在而运行失败，应检查日志后重跑，不要删除重打。

## 从 fork 向组织贡献

- fork 站点示例：`https://geekheart.github.io/ryzobee-link/`。
- 组织站点配置完成并在组织仓库推送标签后，地址为 `https://ryzobee.github.io/ryzobee-link/`。
- PR 只传递代码，**不会传递标签、Release、Pages 配置或部署环境规则**。
- 组织仓库需独立完成首次配置。在 PR 合并后的组织 `main` 提交上创建组织自己的 `V1.0.0`，不要为了发版直接将未合并的 fork 提交推送到组织 `main`。
- 继续遵守 [提交规范](../CONTRIBUTING.md)和 `main` 的 PR 保护，不绕过检查或审批。

## 缓存、隐私与验收边界

- 首次访问需要联网，所有资源完整缓存后才支持离线。生产版会检查 Service Worker 更新；新版本等待旧 Link 标签页全部关闭后激活，不会中途替换运行中的编辑器。
- 暂不强制刷新或清空站点数据。清空站点数据会删除 IndexedDB 草稿，重要文件先导出；localhost、fork 和组织站点的草稿及串口授权相互独立，不会迁移。
- V1.1.0 起静态缓存按 Service Worker scope 区分，只清理自己路径下的旧缓存；AI 页带 query 的离线访问也回到 AI 页。旧版全局前缀缓存不主动清除。草稿数据库仍为 origin 级共享，多个不同路径部署并不等于独立工作区。
- AI 控制仅适用于可信的同源页面。GitHub Pages 同一用户名下的不同仓库可共享 origin；路径化通道名不是恶意同源脚本之间的权限隔离。
- GitHub Pages 只托管静态文件，不接收或转发 Lua、串口、API key。草稿留在浏览器；串口由支持 Web Serial 的桌面浏览器访问本机设备。网站访问本身仍受 GitHub 的访问日志和隐私政策约束。
- 支持 HTTPS 的 Pages 不能消除浏览器兼容性、USB 驱动、串口占用和操作系统权限限制。
- 构建成功不等于实机通过；发布验收分别记录 CI、线上 UI/Wasm、离线缓存及实际设备证据。不将历史实机记录冒充本次验收。

## English summary

Push a version tag such as `V1.0.0` (lowercase `v` is also accepted) matching both package files. The workflow checks out that tag, runs `npm ci` and `npm run build`, then deploys the complete `dist/` artifact. Branch pushes and PRs never deploy. Official actions are pinned to commits; only the deploy job has Pages/OIDC write permissions.

For each repository, enable Actions, select **Settings → Pages → GitHub Actions**, and allow **Tag** patterns `V*` and `v*` in the `github-pages` environment. No personal access token is needed in CI. Fork and upstream have independent tags, Releases, environments and websites; merging a PR does not transfer them. For an upstream release, tag its reviewed, merged commit separately.

Use annotated tags and a release note file as shown above. Wait for one deployment before pushing the next version; never force-move a published tag. Retry failed runs instead. GitHub Releases are optional documentation; tag push is the deployment trigger.

First load requires the network; offline use requires a completed cache installation. Close all old Link tabs and reopen for updates. Drafts are origin-local: localhost, a fork site and the organization site do not share them. Export important Lua files instead of clearing site data. V1.1.0 scopes static-cache cleanup by deployment path; browser drafts still share an origin-level database. Deploy `agent.html` with the full build. AI commands trust the entire origin, not individual paths. Browser/driver/firmware requirements still apply; UI simulation does not prove hardware correctness.

## 官方参考 / References

- [GitHub Pages 自定义工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [部署环境的分支与标签规则](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
- [GitHub Pages HTTPS](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https)
