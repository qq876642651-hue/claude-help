# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 仓库说明

Claude Help 是一个显示 Claude 账号额度的桌面软件，配三个由 agent 执行的技能。技能是普通文件夹形式，不是插件格式；技能名用英文，说明和产出都用中文。技能随软件打包，在软件里点「安装技能」复制到 `%USERPROFILE%\.claude\skills\`。

- `skills/ch-usage/`：记录账号额度。脚本 `record-usage.ps1` 只写 `%USERPROFILE%\.claude\claude-help\usage.json`。
- `skills/ch-config-save/`：记录配置。把桌面端 Code 标签页的偏好设置存成所有账号共用的模板 `desktop-settings.json`，模板格式只在这个技能里定义。
- `skills/ch-config-apply/`：应用配置。按模板只改和当前账号不同的设置项。
- `app/`：Claude Help 桌面软件（Electron）。
  - 额度卡片：监视 `usage.json`，变化后自动刷新。软件自己读不到额度，记录只能在 Claude 里运行 `/ch-usage`。
  - 收信：卡片上的「收信」先复制账号，再用系统默认浏览器打开收信网址，密码由浏览器自己记。网址按邮箱后缀配置，存在 `%USERPROFILE%\.claude\claude-help\mail-sites.json`，在软件的「收信地址」面板里编辑。文件不存在时，用 `main.js` 里预置的波兰邮箱后缀表。
  - 技能安装：`package.json` 的 `extraResources` 把 `../skills` 打包进去。安装时只替换这几个技能自己的文件夹，并写 `skills-installed.json` 记下版本。
  - 命令（在 `app/` 下运行）：`npm start` 开发运行；`npm run dist` 打包 NSIS 安装程序到 `app/dist/`；`npm run release` 发布到 GitHub Releases（ZhaoMCX/claude-help，需要 `GH_TOKEN`），软件靠 electron-updater 从那里自动更新。
  - 发版步骤：
    1. 改 `app/package.json` 的 `version`，提交并推送。
    2. 用 `gh release create v<版本> --target main --title v<版本> --notes "..."` 先建好 Release。如果让 electron-builder 自己建，它会同时发两个创建请求，其中一个报 422，导致 `latest.yml` 漏传。
    3. 运行 `GH_TOKEN="$(gh auth token)" npm run release`。
    4. 用 `gh release view` 确认 exe、`.blockmap`、`latest.yml` 三个文件都在，并且 `latest.yml` 里的 size 和 exe 一致。

开发约定：
- 脚本用 Windows PowerShell 5.1，运行方式是 `powershell -NoProfile -ExecutionPolicy Bypass -File <脚本>`。
  - `.ps1` 文件只写 ASCII 字符。5.1 会把不带 BOM 的脚本按 ANSI 读，中文会乱码。
  - 写文件用不带 BOM 的 UTF-8。
- 邮箱这类个人数据不进仓库。
- 测试脚本或软件时，把 `$env:USERPROFILE` 和 `$env:APPDATA` 指向临时目录再运行，免得改到真实数据。
  - 测试软件时还要加 `--user-data-dir=<临时目录>`。用户安装的 Claude Help 可能正在运行，单实例锁会让测试副本启动后立刻退出，并把用户的窗口切到前面。
