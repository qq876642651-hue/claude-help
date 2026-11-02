---
name: ch-config
description: 保存或应用 Claude 桌面端 Code 标签页的偏好设置（通知、自动归档、分支前缀、防休眠、输出风格等），让不同账号用同一套习惯。用户说“保存我的配置”“把配置应用到这个账号”“换账号后同步设置”或调用 /ch-config 保存、/ch-config 应用 时使用。
---

# ch-config

所有账号共用一份配置，存在 `%USERPROFILE%\.claude\claude-help\desktop-settings.json`。读写设置用桌面端的 `mcp__ccd_settings__get_settings` 和 `mcp__ccd_settings__set_setting`（延迟加载的工具，先用 ToolSearch 一起加载）。工具不存在时，告诉用户这个技能需要在 Claude 桌面端的 Code 标签页里运行，然后结束。

用户没说保存还是应用时，用提问工具问；配置文件不存在时推荐“保存”，否则推荐“应用”。

## 保存

1. **读当前设置。** 调用 `get_settings`。
   完成标准：拿到 `settings` 和 `read_only` 两个列表。

2. **确认覆盖。** 配置文件已存在时，先读出来，列出和当前设置不同的项，用提问工具问用户是否用当前设置覆盖。文件不存在就直接下一步。
   完成标准：文件不存在，或用户确认覆盖。

3. **写文件。** 按下面的格式写 `desktop-settings.json`（UTF-8）：
   ```json
   {
     "savedAt": "<ISO 时间>",
     "settings": { "<key>": <value>, ... },
     "readOnly": { "<name>": "<value>", ... }
   }
   ```
   - `settings` 只收 `settable` 为 true 且 `value` 不是 `null` 的项；`null` 表示用默认值，`set_setting` 没法设回 `null`。
   - `readOnly` 收 `read_only` 列表里的值，只用来在应用时提醒用户，不会自动改。
   完成标准：文件已写好；告诉用户保存了哪几项，以及哪几项因为是默认值没有保存。

## 应用

1. **读两边。** 读 `desktop-settings.json`，再调用 `get_settings`。文件不存在时，告诉用户先保存一次，然后结束。
   完成标准：拿到保存的配置和当前设置。

2. **逐项修改。** 对 `settings` 里每个和当前值不同的 key，调用一次 `set_setting`。每一项都会弹卡片让用户批准；被拒绝、被锁定或报错的项记下来，继续下一项。
   完成标准：每个不同的项都调用过一次。

3. **汇报。** 告诉用户：改了哪些、跳过了哪些（以及原因）、哪些本来就一致。`readOnly` 里和当前值不同的项（权限模式、浏览器工具、worktree 位置等安全或只读设置），列出来，请用户自己到 Settings → Claude Code 里改。
   完成标准：用户拿到这三类结果，以及需要手动改的清单。
