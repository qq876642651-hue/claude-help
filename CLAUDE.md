# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 仓库说明

Claude Help 是一个显示 Claude 账号额度的桌面软件（Electron），附带命令行工具 `claude-help`。代码都在 `app/` 下，软件和 CLI 共用同一份核心代码，版本号也相同。

- `app/src/core/`：纯 Node 的核心模块，不依赖 electron。
  - `paths.js`：数据目录 `%USERPROFILE%\.claude\claude-help\` 下的 `usage.json`、`mail-sites.json`、`desktop-settings.json`。
  - `usage.js`：读取和记录额度，每个账号只保留最新一条。
  - `mailSites.js`：邮箱后缀 → 收信网址，包括预置的波兰邮箱后缀表。
  - `config.js`：保存桌面端设置模板，以及和当前设置对比。
  - `format.js`：额度显示辅助函数，写成 UMD 形式，渲染进程用 `<script src>` 加载，CLI 用 `require`。
- `app/src/cli.js`：`claude-help` 命令，包括 `usage`、`usage record`、`mail`、`sites`、`config save|diff|show`。用法和“给 Claude 的说明”都在 `--help` 里。
  - 安装后由安装目录里的 `claude-help.cmd`（源文件 `app/build/claude-help.cmd`）以 `ELECTRON_RUN_AS_NODE=1` 运行软件自带的 exe。
  - 安装程序通过 `app/build/installer.nsh` 把安装目录加进用户 PATH。
  - 开发时用 `npm run cli -- <参数>`。
- 分工：额度（`get_usage`）和桌面端设置（`get_settings`/`set_setting`）只有 Claude 在桌面端会话里能读写。Claude 读取后把 JSON 通过 stdin 交给 CLI；软件和 CLI 自己读不到这些数据。
- `app/src/main.js` 和 `renderer/`：额度卡片会监视 `usage.json` 自动刷新。点「收信」会复制账号，再用默认浏览器打开收信网址；网址可在「收信地址」面板编辑。
- 命令（在 `app/` 下运行）：
  - `npm start`：开发运行。
  - `npm run dist`：打包 NSIS 安装程序到 `app/dist/`。
  - `npm run version:next`：只打印下一个版本号和分组的提交。
  - `npm run release`：正式发版。它会改版本号、提交、推送、先用 `gh` 建 Release，再用 electron-builder 上传，最后核对 exe、blockmap、latest.yml 三个文件。发版前先运行 `version:next`，让用户确认版本号。
  - 软件靠 electron-updater 从 GitHub Releases（ZhaoMCX/claude-help）自动更新。

提交和版本：
- 提交信息写成英文前缀加中文描述：
  - `break:`：不兼容的改动，升主版本。
  - `feat:`：新功能，升次版本。
  - `fix:`：修复，升修订号。
  - `chore:`、`docs:` 等其他前缀：升修订号。
- 版本号由 `app/scripts/release.mjs` 按上次 `v*` 标签以来的提交自动判断，不要手动改 `version`。

开发约定：
- 邮箱这类个人数据不进仓库。
- 测试时把 `$env:USERPROFILE` 和 `$env:APPDATA` 指向临时目录，免得改到真实数据。
  - 测试软件时还要加 `--user-data-dir=<临时目录>`。用户安装的 Claude Help 可能正在运行，单实例锁会让测试副本启动后立刻退出，并把用户的窗口切到前面。
