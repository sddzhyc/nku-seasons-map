# GitHub Actions / github.io 部署

## 首次上线

1. 准备你的 GitHub 仓库，默认分支使用 `main`。把本项目源码和 `public/data/` 有效快照推送到该仓库；不上传 node_modules、dist 或原始研究提取文件。
2. 仓库 Settings → Pages → Build and deployment → Source 选择 **GitHub Actions**。
3. 确保 Actions 可以写入仓库，以便回存已通过测试的数据快照；受保护分支或组织策略若禁止机器人提交，需要为此仓库调整允许范围，或改用独立数据分支方案后再启用定时回存。
4. 推送 main 或手动运行 **Update campus data and deploy Pages** 工作流。
5. 等待 build 和 deploy 均成功，使用 deploy 的 `page_url` 输出访问网站。项目站通常在 `https://你的用户名.github.io/仓库名/`；以 GitHub 的实际输出为准。

本项目使用相对资源地址。CI 会验证根路径与项目子路径，不要求把仓库名写死进前端配置。

## 工作流做什么

`.github/workflows/pages.yml` 在 main 推送、手动运行和 UTC 每6小时的第23分钟触发（北京时间通常为02:23、08:23、14:23、20:23；GitHub 调度可能延迟）。同一工作流串行运行。

1. 安装锁定依赖。
2. 校验 YAML，然后通过 Overpass 同步物种与完整校园简图。
3. 同步失败时发出警告，保留最近有效快照继续；无效 YAML、测试错误或构建错误仍会失败。
4. 生成后台索引、一体数据包，运行测试和正式构建，再验证 Pages 路径。
5. 只在成功时回存这些数据文件到 main。后续运行从最近有效快照开始，不因断网回退到最初数据。
6. 上传正式产物，使用官方 `actions/deploy-pages@v4` 部署至 github-pages 环境。

由 GITHUB_TOKEN 推送的回存提交不会再次触发普通 push 工作流；当前运行已经直接执行部署。拉取请求只运行 `.github/workflows/check.yml` 的检查，不写仓库，也不执行生产部署。

## 权限与失败恢复

- build：`contents: write` 用于回存有效数据；deploy：`pages: write` 和 `id-token: write` 用于 Pages。未使用私有访问令牌。
- Overpass 故障：检查日志中的警告与页面获取时间，可稍后手动重试，不要把旧快照标成已同步。
- YAML 无效：根据错误修复日期、别名、来源或区间重叠后重新提交。
- main 出现并发更新、分支策略禁止机器人写入：工作流会在 push 处失败，保留已有线上版本。检查策略/最新 main 后重新运行，不会强推覆盖用户提交。
- 部署需要环境审批时由仓库设置决定，工作流不会绕过审批。
- 公开仓库长时间没有活动时，GitHub 可能停用 schedule；定期检查工作流状态。

## 当前交付状态

目标仓库已创建为 [sddzhyc/nku-autumn-map](https://github.com/sddzhyc/nku-autumn-map)，站点目标为 `https://sddzhyc.github.io/nku-autumn-map/`。仓库内的工作流将在 main 推送后执行。请以 [Actions 运行结果](https://github.com/sddzhyc/nku-autumn-map/actions) 和实际站点响应确认线上状态，单有工作流文件不代表部署成功。

依据：[GitHub Pages 自定义工作流文档](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)、[官方部署 Action](https://github.com/actions/deploy-pages)、[官方上传 Action](https://github.com/actions/upload-pages-artifact)。
