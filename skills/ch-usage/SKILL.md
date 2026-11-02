---
name: ch-usage
description: 记录当前 Claude 账号的套餐和额度（5 小时、每周），供 Claude Help 软件显示。用户调用 /ch-usage、说“记录一下额度”时使用；ch-handoff 写完交接后也会按这里的步骤记录一次。其他时候不自动运行。
---

# ch-usage

数据放在 `%USERPROFILE%\.claude\claude-help\usage.json`，不放进任何项目仓库。每个账号只保留最新一条记录。

## 步骤

1. **读取额度。** 调用桌面端的 `mcp__ccd_session_mgmt__get_usage`（延迟加载的工具，先用 ToolSearch 加载）。
   - `plan.status` 是 `ok` 才继续；是 `not_applicable` 或 `unavailable` 时，把状态和 note 告诉用户，然后结束。
   - 工具不存在（不在桌面端）时，告诉用户这个技能需要在 Claude 桌面端的 Code 标签页里运行，然后结束。
   完成标准：拿到 `plan.status` 为 `ok` 的 `plan` 对象。

2. **确定邮箱。** 用会话上下文里提供的用户邮箱（userEmail）。不要读 `~/.claude.json` 里的邮箱，它不一定跟着桌面端的账号切换更新。上下文里没有邮箱时，用提问工具问用户当前是哪个账号。
   完成标准：拿到当前账号的邮箱。

3. **写入记录。** 把 `plan` 对象原样写成 JSON，存到 `%USERPROFILE%\.claude\claude-help\plan-input.json`，然后运行：
   ```
   powershell -NoProfile -ExecutionPolicy Bypass -File "<本技能目录>\record-usage.ps1" -Email "<邮箱>" -PlanFile "%USERPROFILE%\.claude\claude-help\plan-input.json"
   ```
   脚本会用这条记录替换该账号的旧记录，写入 `usage.json`，最后删掉 `plan-input.json`。
   完成标准：脚本退出码为 0，输出 `recorded: …` 和 `data: …` 两行。

4. **告诉用户。** 用一两句话说明记录的账号、套餐、5 小时和每周的已用百分比，并说明 Claude Help 软件开着时会自动刷新显示。
   完成标准：用户拿到这几个数字。

## 显示

`usage.json` 由仓库里的 Claude Help 软件（`app/`）读取并监视，文件一变界面就刷新。本技能只负责写数据，不负责显示。
