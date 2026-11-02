# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 仓库说明

Claude Help 是一组给 Claude Code 用的技能，外加一个显示额度的桌面软件。技能是普通文件夹形式，不是插件格式；技能名用英文，说明和产出都用中文。这里只放源码，技能还没有安装到任何地方。

- `skills/ch-init/`：往项目的 CLAUDE.md 写规则段，并建 `.claude/handoffs/`。规则只有一份来源，就是 `rules-template.md`。`writing-for-agents.md` 是写给 agent 看的文档时要遵守的要点。
- `skills/ch-handoff/`：写交接文档，写完后按 ch-usage 的步骤记录一次额度。
- `skills/ch-usage/`：记录账号额度。脚本 `record-usage.ps1` 只写 `%USERPROFILE%\.claude\claude-help\usage.json`。
- `app/`：Claude Help 桌面软件（Electron）。左侧额度卡片，监视 `usage.json` 自动刷新；右侧分栏用 `WebContentsView` 显示收信网站（该站禁止 iframe 内嵌）。在 `app/` 下：`npm start` 开发运行，`npm run dist` 打包 NSIS 安装程序到 `app/dist/`，`npm run release` 发布到 GitHub Releases（ZhaoMCX/claude-help，需要 `GH_TOKEN`），软件靠 electron-updater 从那里自动更新。发版前先改 `app/package.json` 的 `version`。
- `skills/ch-config/`：保存和应用桌面端的偏好设置，所有账号共用一份配置。

开发约定：
- 脚本用 Windows PowerShell 5.1，运行方式是 `powershell -NoProfile -ExecutionPolicy Bypass -File <脚本>`。
  - `.ps1` 文件只写 ASCII 字符。5.1 会把不带 BOM 的脚本按 ANSI 读，中文会乱码。
  - 写文件用不带 BOM 的 UTF-8。
- 邮箱这类个人数据不进仓库。
- 测试脚本时，把 `$env:USERPROFILE` 指向临时目录再运行，免得改到真实数据。
- 本仓库 CLAUDE.md 末尾的规则段由 `skills/ch-init/apply-rules.ps1` 生成，要改规则就改模板，然后对本仓库重新运行这个脚本。

<!-- claude-help:start -->
## Claude Help 规则

- 全程用中文沟通，任务列表和实施步骤也用中文；代码、命令、文件路径保持原样。
- 做新功能或涉及设计取舍时，先讨论再执行：把要做的决定画成决策树，每轮只问当下就能回答的问题，每题附推荐答案；能查到的事实自己去查；用户确认后再动手。小改动照常直接做。
- 需要用户回答或拍板时，用提问工具（AskUserQuestion）列出选项，推荐项放在第一个。
- 交接文档放在 `.claude/handoffs/`：接手旧工作时先读最新一篇；结束工作或换账号前，用 `ch-handoff` 技能写一篇交接。
<!-- claude-help:end -->
