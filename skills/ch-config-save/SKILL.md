---
name: ch-config-save
description: 记录配置：读取 Claude 桌面端 Code 标签页当前的偏好设置（通知、自动归档、分支前缀、防休眠、输出风格等），存成所有账号共用的配置模板，供 ch-config-apply 换账号后应用。用户说“记录/保存我的配置”“把现在的设置存下来”或调用 /ch-config-save 时使用。
---

# ch-config-save

配置模板只有一份，所有账号共用，存在 `%USERPROFILE%\.claude\claude-help\desktop-settings.json`。读设置用桌面端的 `mcp__ccd_settings__get_settings`（延迟加载的工具，先用 ToolSearch 加载）。工具不存在时，告诉用户这个技能需要在 Claude 桌面端的 Code 标签页里运行，然后结束。

## 步骤

1. **读当前设置。** 调用 `get_settings`。
   完成标准：拿到 `settings` 和 `read_only` 两个列表。

2. **确认覆盖。** 模板文件已存在时，先读出来，列出和当前设置不同的项，用提问工具问用户是否用当前设置覆盖（不同的项写在问题或选项说明里）。文件不存在就直接下一步。
   完成标准：文件不存在，或用户确认覆盖。

3. **写模板。** 按下面的格式写 `desktop-settings.json`（UTF-8）：
   ```json
   {
     "savedAt": "<ISO 时间>",
     "settings": { "<key>": <value>, ... },
     "readOnly": { "<name>": "<value>", ... }
   }
   ```
   - `settings` 只收 `settable` 为 true 且 `value` 不是 `null` 的项；`null` 表示用默认值，`set_setting` 没法设回 `null`。
   - `readOnly` 收 `read_only` 列表里的值，只用来在应用时提醒用户，不会自动改。
   完成标准：文件已写好；告诉用户保存了哪几项、哪几项因为是默认值没有保存，以及换账号后可以运行 `/ch-config-apply`。
