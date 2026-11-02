---
name: ch-config-apply
description: 应用配置：把 ch-config-save 记录的配置模板应用到当前 Claude 账号的桌面端 Code 标签页设置，只改和当前不同的项。用户说“把配置应用到这个账号”“换账号后同步设置”或调用 /ch-config-apply 时使用。
---

# ch-config-apply

模板文件是 `%USERPROFILE%\.claude\claude-help\desktop-settings.json`，格式由 `ch-config-save` 技能定义。读写设置用桌面端的 `mcp__ccd_settings__get_settings` 和 `mcp__ccd_settings__set_setting`（延迟加载的工具，先用 ToolSearch 一起加载）。工具不存在时，告诉用户这个技能需要在 Claude 桌面端的 Code 标签页里运行，然后结束。

## 步骤

1. **读两边。** 读模板文件，再调用 `get_settings`。模板不存在时，告诉用户先在配好习惯的账号上运行 `/ch-config-save`，然后结束。
   完成标准：拿到模板和当前设置。

2. **逐项修改。** 对模板 `settings` 里每个和当前值不同的 key，调用一次 `set_setting`。每一项都会弹卡片让用户批准；被拒绝、被锁定或报错的项记下来，继续下一项。
   完成标准：每个不同的项都调用过一次。

3. **汇报。** 告诉用户：改了哪些、跳过了哪些（以及原因）、哪些本来就一致。模板 `readOnly` 里和当前值不同的项（权限模式、浏览器工具、worktree 位置等安全或只读设置）列出来，请用户自己到 Settings → Claude Code 里改。
   完成标准：用户拿到这三类结果，以及需要手动改的清单。
