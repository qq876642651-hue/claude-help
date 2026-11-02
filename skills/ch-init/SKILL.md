---
name: ch-init
description: 给当前项目接入 Claude Help：往项目的 CLAUDE.md 写入 Claude Help 规则段（中文沟通、先讨论再执行、提问工具、交接文档），并建好 .claude/handoffs/。用户说“初始化 Claude Help”“给这个项目加上规则”或调用 /ch-init 时使用；重复运行只更新规则段。
---

# ch-init

只处理规则段和交接目录，不分析项目代码。

## 步骤

1. **确定项目目录。** 默认是当前工作目录；用户指定了别的目录就用那个。
   完成标准：拿到一个存在的目录的绝对路径。

2. **写入规则段。** 运行：
   ```
   powershell -NoProfile -ExecutionPolicy Bypass -File "<本技能目录>\apply-rules.ps1" -ProjectDir "<项目目录>"
   ```
   脚本把 `rules-template.md` 的内容写进 `<项目目录>\CLAUDE.md`：
   - 没有 CLAUDE.md：新建一份，内容是标题加规则段（输出 `created`）。
   - 有 CLAUDE.md、没有标记段：在文件末尾追加规则段（输出 `appended`）。
   - 已有 `<!-- claude-help:start -->` … `<!-- claude-help:end -->`：只替换这一段，标记段外的内容不变（输出 `replaced` 或 `unchanged`）。
   - 同时建好 `<项目目录>\.claude\handoffs\`。
   完成标准：脚本退出码为 0，输出一行 `CLAUDE.md: …`；文件里 `<!-- claude-help:start -->` 只出现一次。
   脚本报 “only one claude-help marker” 时，把情况告诉用户，请用户确认后再手动修好标记。

3. **检查是否需要 `/init`。** 读一遍 CLAUDE.md。如果里面还没有构建/测试命令或架构说明，告诉用户可以运行内置的 `/init` 补上。
   完成标准：已经告诉用户结果（写入方式、交接目录路径），需要时附上 `/init` 提醒。

## 改规则段时

规则的唯一来源是 `rules-template.md`，各项目 CLAUDE.md 里的规则段由它生成，不要手改。改模板前先读 `writing-for-agents.md`。规则段要短，细节写进对应技能，规则段里只留指向技能的一句话。
