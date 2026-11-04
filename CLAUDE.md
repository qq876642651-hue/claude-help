# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 仓库说明

Claude Help 是一个显示 Claude 账号额度的桌面软件（Electron），代码都在 `app/` 下。

- `app/src/core/`：纯 Node 的核心模块，不依赖 electron。
  - `paths.js`：数据目录 `%USERPROFILE%\.claude\claude-help\` 下的 `usage.json`、`mail-sites.json`；`desktopDataDirs()` 给出桌面端的数据目录（`%LOCALAPPDATA%\Claude-Data\*` 和旧版的 `%APPDATA%\Claude`），会话、`config.json`、采样文件都从这里找。
  - `usage.js`：读取和记录额度，每个账号只保留最新一条。记录里的 `accountId` 是桌面端账号 ID，用来把会话对应到邮箱。
    - 可以手动添加账号（`addAccount`），额度为空：`windows` 为空、`recordedAt` 为 null（用 `format.js` 的 `hasUsage` 判断）。以后记录额度时整条覆盖。
    - `setAccountId` 给手动添加的账号补上 `accountId`（见下面「收信」）。
    - 一个 `accountId` 只对应一个邮箱，写入时会去掉其他记录上的同一 ID。
    - `recordUsage(email, plan, accountId)` 的 plan 格式和桌面端 get_usage 的 plan 相同（`windows: [{ label, percentUsed, resetsAt }]`），会校验 `windows`，解析错的数据报错不写入，免得盖掉好记录。
  - `desktopUsage.js`：从桌面端的采样自动同步百分比（`syncDesktopUsage`）。
    - 桌面端每 15 分钟往数据目录的 `plan-usage-history.json` 给当前账号记一条：`{ version: 2, samples: [{ t, org, u: { fh, sd } }] }`，`fh` 是 5 小时用掉的百分比，`sd` 是每周（全部模型）的，`u` 为空表示那次没读到。未公开格式，读不到就不同步。
    - `org` 是组织 ID，用会话目录 `claude-code-sessions\<账号ID>\<组织ID>\` 对回账号 ID，再按 `accountId` 找到记录；对不上的样本不管。
    - 只在样本比 `recordedAt` 新时更新，只改 5 小时和「Weekly · all models」两条的百分比，其他窗口不动；记录带 `source: 'desktop'`，页面标“（自动）”。从界面读到的完整记录会整条覆盖，就没有这个字段。
    - 样本里没有重置时间：每周的按旧值整周往后推（准的）；5 小时的旧值没到就沿用，过了就在之后的样本里找最近一轮的开始加 5 小时，标 `resetsAtEstimated: true`，页面显示“约”。用量为 0 或推不出来时留空。
    - 测试时用 `CLAUDE_HELP_USAGE_HISTORY` 指向假的采样文件。
  - `sessions.js`：读取桌面端的会话列表，只读这几个字段：标题、目录、时间、归档。
    - 会话列表按账号分目录：`%LOCALAPPDATA%\Claude-Data\claude_<包ID>\claude-code-sessions\<账号ID>\<组织ID>\local_*.json`。切换账号后，桌面端只显示当前账号的会话。
    - 完整对话不分账号：`%USERPROFILE%\.claude\projects\<cwd 编码>\<cliSessionId>.jsonl`。
    - 这些是桌面端未公开的内部格式，可能变化，读不到就不显示。
    - 恢复方式只做“复制续接指令”（新会话里粘贴，让 Claude 读旧记录），不改桌面端文件。页面上的「接续」按钮就是做这个。
    - 「会话」页的“复制会话地址”复制的是对话记录 `.jsonl` 的完整路径。
    - 「会话」页按“账号 → 项目 → 会话”分三层，项目可以收起，收起状态存在 localStorage。
    - 删除只在软件里做，用 `shell.trashItem` 移到回收站。
    - 测试时用 `CLAUDE_HELP_SESSIONS_DIR` 指向假的会话目录，用 `CLAUDE_CONFIG_DIR` 指定 `.claude` 目录。
  - `memory.js`：Claude Code 的记忆。只管本机文件，不碰 claude.ai 的记忆。
    - 位置：`<配置目录>\projects\<cwd 编码>\memory\*.md`（`MEMORY.md` 是索引，其余每条一个文件，带 frontmatter），用户级 `<配置目录>\CLAUDE.md` 作为 key 为 `global` 的一组。配置目录由 `paths.js` 的 `claudeDir()` 给出（`CLAUDE_CONFIG_DIR` 优先）。
    - 项目的真实路径：读该项目任意一个 `.jsonl` 开头的 `"cwd"`，没有再看桌面端会话列表；目录名只能由 cwd 正向编码（`sessions.js` 的 `encodeCwd`），长路径会截断，不能反推。
    - 所有读写都经过 `entryPath(key, file)` 校验，主进程不用渲染进程传来的路径。
    - 编辑时带上打开时的 mtime，文件期间被改过（Claude 可能正在写）就不保存。只有全局 `CLAUDE.md` 可以新建。
    - 导出格式：`{ format: 'claude-help-memory', version: 1, groups: [{ kind, key, cwd, files: { 文件名: 内容 } }] }`。
    - 导入：先 `planImport` 预览（每个文件 `new`/`same`/`conflict`），再 `applyImport`。目标默认按原 cwd，先认本机 cwd 相同的项目目录。冲突默认跳过；覆盖前把旧文件备份到数据目录的 `memory-backups\<时间>\<key>\`。`MEMORY.md` 不整体覆盖，只把写入的条目追加到本地索引（用导入包索引里的那一行，没有就按 frontmatter 生成）。
    - 删除和编辑只在软件里做，删除用 `shell.trashItem` 并去掉索引里的那一行，索引本身不能删。
  - `mailSites.js`：邮箱后缀 → 收信网址。不预置网址（分发给别人时不该默认指向第三方网站），也就没有“恢复默认”；邮箱域名等于后缀或以“.后缀”结尾即匹配，多条匹配时取最长的后缀。
  - `format.js`：额度显示辅助函数，写成 UMD 形式，渲染进程用 `<script src>` 加载。默认中文，软件按界面语言调用 `setLang('en')`。
- `app/src/i18n.js`：软件界面的中英文字表（UMD），主进程和页面共用。core 里的报错、续接指令保持中文。
  - 语言设置 `language`：`system`（默认，系统语言是中文就用中文，否则英文）/`zh`/`en`，在「关于」页切换。
  - preload 用 `sendSync('app:lang')` 同步拿到 `zh` 或 `en`。切换后主进程更新托盘菜单，并用 `webContents.reload()` 重新加载页面（页面里的 `location.reload()` 会被 `will-navigate` 拦下）。
  - 页面静态文字用 `data-i18n`、`data-i18n-placeholder`、`data-i18n-title`、`data-i18n-aria` 标 key，脚本里用 `UI.t(key, vars)`。新增文字时中英两份都要加。
- 额度从哪来：软件自己从桌面端读，不经过 Claude。
  - 收信时从桌面端界面读当前账号的完整额度（见下面「收信」和 `desktopLogin.js`）。
  - 平时由 `desktopUsage.js` 同步桌面端每 15 分钟的采样，只有百分比。
- 1.3 删掉了命令行 `cchelp`：它原本是让 Claude 在桌面端会话里调 get_usage 后把 JSON 交给软件，软件能自己读以后就没用了。`app/build/installer.nsh` 安装时会把旧版加进用户 PATH 的安装目录去掉，并删掉残留的 `cchelp.cmd`、`cchelp`。
- 试过但不做的读额度方式：`claude.exe --desktop` 不接受指令；桌面端自带的 Claude Code 单独运行时没有登录；开会话让便宜的模型调 get_usage 再删会话太绕；悬停用量按钮看弹窗要动鼠标而且不稳定。
- 不做桌面端设置的备份和应用：2026-11-02 做过 `config save|diff|show` 和「配置」页，后来删除了。原因是大部分设置存在本机，不跟账号走，备份意义不大。
- `app/src/main.js`：主进程，负责监视 `usage.json` 和桌面端的采样文件（变化后 1 秒同步，另每 5 分钟兜底）、处理收信地址的增删改、会话的复制续接指令和删除、打开浏览器和数据目录、自动更新。
  - 「收信」（`openMail`）合并了切换账号和记录额度：先判断桌面端是不是这个号，是就只读额度并记下，不打开收信页，回到软件；不是就先读旧账号的额度记到它的卡上（桌面端当前的 ID 对不上任何卡就不读），再退出登录、填邮箱、点继续，然后复制账号、在浏览器打开收信页。读额度失败不影响收信，页面给一条警告；后面的步骤失败时，已读到的额度照样记下。
    - 同号判断：桌面端 `config.json` 的 `lastKnownAccountUuid` 等于这张卡的 `accountId` 才算同号。
    - 桌面端只在账号 ID 变化时写 `lastKnownAccountUuid`，退出登录不清空它；重新登录同一个号时它不变，所以认不出“登回了同一个号”。
    - 因此卡片没有 `accountId`、桌面端当前的 ID 也没记在别的卡片上时，返回 `{ ask: true }`，页面用 `#sameDialog` 问“桌面端当前登录的是这个号吗”，答“是”就 `setAccountId` 后按同号处理。测试时用 `CLAUDE_HELP_SAME_ANSWER`（`same`/`switch`）代替回答。
    - 填好登录页后 10 分钟内，`lastKnownAccountUuid` 变了就算登录完成：变成没记录过的 ID 就用 `setAccountId` 记到这个邮箱上。登录后不读额度（会再弹一次用量页，打断刚登录的用户），新账号的百分比等采样同步，完整额度等下次对这个号收信时读。
- `app/src/desktopLogin.js` + `desktop-login.ps1`：用 Windows UI Automation 操作桌面端的登录页和用量页（PowerShell 走 `-EncodedCommand`，参数走环境变量）。全程用控件自己的 Invoke/Expand 和键盘，不动鼠标。
  - 桌面端屏蔽了 `--remote-debugging-port`，`claude://` 深链接也拦了 `/logout`、`/login`，所以只能从外面点界面。
  - 网页内容的无障碍树要被查询过才会生成，脚本会等它出现。窗口元素不接受 `SetFocus`，用 `WScript.Shell.AppActivate` 置前。
  - 左下角账号按钮的名称是“显示名 + 套餐”，按“左下区域、能展开”认；菜单里点「退出登录」；退出后先是带「开始使用」按钮的欢迎页，点了才有邮箱框；邮箱用剪贴板粘贴。
    - 退出途中账号按钮先消失、提示词框还在，所以邮箱框要名称对得上，或者只有一个输入框且页面上有「继续」按钮才算。
    - 没有「继续」按钮就报错，不按回车，免得认错输入框时把邮箱当消息发出去。
    - 翻页时控件会失效，`Wait` 里的查询抛异常就当“还没好”，下一轮再查。
  - 读额度（`same` 模式顺便读，`switch` 模式带 `CLAUDE_HELP_LOGIN_READ=1` 时退出前读，`usage` 模式只读）：展开账号按钮，点菜单里的「用量」，会打开设置里的「使用情况」页；等到「当前会话」进度条出现，交出页面上的文字和进度条的值，按 Esc 关掉。
    - `parseUsage` 把它转成 plan：「当前会话」是 5 小时额度，「本周」是每周（全部模型），其余进度条按「Weekly · 名称」记；「本周各产品的用量」「用量额度」以下的不算。重置时间取纵坐标最近的“…重置”文字，`parseReset` 认“17:10”“星期三02:00”“11月12日 02:00”和英文的写法，取下一次出现的时刻。套餐取「您的用量」同一行的文字，没有就用账号按钮名称的末尾。认不出 5 小时额度就报错（步骤 `parse`）。
    - 输入框下面的用量按钮只有悬停才会弹出详情，`Expand` 打不开，所以不用它。
  - 控件文字都在 `desktopLogin.js` 的 `NAMES` 里（中英文），桌面端改了文字只改这里。`desktopLogin.probe()` 只读列出窗口里的控件，用来排查。
  - 测试钩子：`CLAUDE_HELP_LOGIN_RESULT`（`none`/`filled`/`fail:<步骤>`/`auto`：同号返回 `none`、切换返回 `filled`）跳过桌面端；`CLAUDE_HELP_DESKTOP_USAGE`（脚本原始结果的 JSON 或文件路径）代替读到的用量页，同号和切换前读额度都用它；`CLAUDE_HELP_DESKTOP_CONFIG` 指向假的 `config.json`。
  - 点 × 时按 `closeAction`（`ask`/`tray`/`quit`，默认 `ask`）处理：询问、回到后台（系统托盘）或退出。
    - 询问用页面里的 `#closeDialog`：页面先回“已显示”，再回选择。5 秒内没回“已显示”时，改用原生弹窗兜底。
  - 点「重启并安装」后，`.shell` 和提示条设为 `inert` 并盖上遮罩，快捷键也不响应；安装出错时解锁。开发模式下不安装，直接报错。
  - 设置存在 `src/settings.js` 管理的 `userData\settings.json`。
  - 托盘和窗口图标用 `src/assets/icon.png`，由 `npm run icon` 生成。
  - 测试时用 `CLAUDE_HELP_CLOSE_ANSWER`（`tray`/`quit`/`cancel`，可加 `-remember`）跳过关闭弹窗。
  - 记忆的导出、导入用系统文件框；测试时用 `CLAUDE_HELP_DIALOG_FILE` 指定文件，跳过文件框。导入时选好的文件留在主进程，页面只拿预览。
- `app/src/renderer/`：原生 HTML/CSS/JS，不用框架。左侧导航分五个页面：「额度」「收信地址」「会话」「记忆」「关于」，`Ctrl+1/2/3/4/5` 切换。
  - 「记忆」页按“全局 → 各项目”列出记忆，分组可以收起（存在 localStorage），每条可以查看编辑（`Ctrl+S` 保存，有改动时关闭要确认）和删除；工具栏有导入、导出。导入框里每组可以改目标项目，有冲突时才显示“跳过/覆盖”。
  - `app.js`：路由。
  - `ui.js`：界面文字（`t`、`applyI18n`）、图标、按钮、提示条、确认框。
  - `page-*.js`：各页面。
  - `style.css`：设计变量，跟随系统深浅色。
  - 「收信」进行中所有收信按钮禁用；邮箱后缀没配置网址时，跳到「收信地址」页并预填后缀。
- 命令（在 `app/` 下运行）：
  - `npm start`：开发运行。
  - `npm run dist`：打包 NSIS 安装程序到 `app/dist/`。
  - `npm run icon`：把 `build/icon.svg` 渲染成 `build/icon.png`（1024×1024）和 `src/assets/icon.png`（256×256），改了 SVG 后运行。`icon.png` 要提交，打包时 electron-builder 用它生成 exe 和安装程序的图标；侧栏标志是 `index.html` 里内联的同一个 SVG，改图标时一起改。
  - `npm run version:next`：只打印下一个版本号和分组的提交。
  - `npm run release`：正式发版。它会改版本号、提交、推送、先用 `gh` 建 Release，再用 electron-builder 上传，最后核对 exe、blockmap、latest.yml 三个文件。发版前先运行 `version:next`，让用户确认版本号。
  - 软件靠 electron-updater 从 GitHub Releases（qq876642651-hue/claude-help）自动更新。原仓库 ZhaoMCX/claude-help 已随账号封停失效，v0.3.1 及更早的安装需要手动装一次新版。

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
