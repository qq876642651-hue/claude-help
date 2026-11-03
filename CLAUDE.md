# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 仓库说明

Claude Help 是一个显示 Claude 账号额度的桌面软件（Electron），附带命令行工具 `claude-help`。代码都在 `app/` 下，软件和 CLI 共用同一份核心代码，版本号也相同。

- `app/src/core/`：纯 Node 的核心模块，不依赖 electron。
  - `paths.js`：数据目录 `%USERPROFILE%\.claude\claude-help\` 下的 `usage.json`、`mail-sites.json`。
  - `usage.js`：读取和记录额度，每个账号只保留最新一条。记录里的 `accountId` 是桌面端账号 ID，用来把会话对应到邮箱。
    - 可以手动添加账号（`addAccount`），额度为空：`windows` 为空、`recordedAt` 为 null（用 `format.js` 的 `hasUsage` 判断）。以后记录额度时整条覆盖。
    - `setAccountId` 给手动添加的账号补上 `accountId`（见下面「收信」）。
  - `sessions.js`：读取桌面端的会话列表，只读这几个字段：标题、目录、时间、归档。
    - 会话列表按账号分目录：`%LOCALAPPDATA%\Claude-Data\claude_<包ID>\claude-code-sessions\<账号ID>\<组织ID>\local_*.json`。切换账号后，桌面端只显示当前账号的会话。
    - 完整对话不分账号：`%USERPROFILE%\.claude\projects\<cwd 编码>\<cliSessionId>.jsonl`。
    - 这些是桌面端未公开的内部格式，可能变化，读不到就不显示。
    - 恢复方式只做“复制续接指令”（新会话里粘贴，让 Claude 读旧记录），不改桌面端文件。
    - 「会话」页和 `claude-help sessions` 都按“账号 → 项目 → 会话”分三层，页面上的项目可以收起，收起状态存在 localStorage。
    - 删除只在软件里做，用 `shell.trashItem` 移到回收站。
    - 测试时用 `CLAUDE_HELP_SESSIONS_DIR` 指向假的会话目录，用 `CLAUDE_CONFIG_DIR` 指定 `.claude` 目录。
  - `mailSites.js`：邮箱后缀 → 收信网址。默认只有 `poczta.onet.pl → https://onet.yulishomes.com/`；邮箱域名等于后缀或以“.后缀”结尾即匹配，多条匹配时取最长的后缀。
  - `format.js`：额度显示辅助函数，写成 UMD 形式，渲染进程用 `<script src>` 加载，CLI 用 `require`。默认中文，软件按界面语言调用 `setLang('en')`。
- `app/src/i18n.js`：软件界面的中英文字表（UMD），主进程和页面共用。CLI 和 core 里的报错、续接指令保持中文。
  - 语言设置 `language`：`system`（默认，系统语言是中文就用中文，否则英文）/`zh`/`en`，在「关于」页切换。
  - preload 用 `sendSync('app:lang')` 同步拿到 `zh` 或 `en`。切换后主进程更新托盘菜单，并用 `webContents.reload()` 重新加载页面（页面里的 `location.reload()` 会被 `will-navigate` 拦下）。
  - 页面静态文字用 `data-i18n`、`data-i18n-placeholder`、`data-i18n-title`、`data-i18n-aria` 标 key，脚本里用 `UI.t(key, vars)`。新增文字时中英两份都要加。
- `app/src/cli.js`：`claude-help` 命令，包括 `usage`、`usage record`、`usage add`、`usage remove`、`mail`、`sites`、`sessions`、`sessions resume`。用法和“给 Claude 的说明”都在 `--help` 里。
  - 安装后由安装目录里的 `claude-help.cmd`（源文件 `app/build/claude-help.cmd`）以 `ELECTRON_RUN_AS_NODE=1` 运行软件自带的 exe。
  - 安装程序通过 `app/build/installer.nsh` 把安装目录加进用户 PATH。
  - 开发时用 `npm run cli -- <参数>`。
- 分工：额度（`get_usage`）只有 Claude 在桌面端会话里能读。Claude 读取后把 JSON 通过 stdin 交给 CLI；软件和 CLI 自己读不到额度。
- 不做桌面端设置的备份和应用：2026-11-02 做过 `config save|diff|show` 和「配置」页，后来删除了。原因是大部分设置存在本机，不跟账号走，备份意义不大。
- `app/src/main.js`：主进程，负责监视 `usage.json`、处理收信地址的增删改、会话的复制续接指令和删除、打开浏览器和数据目录、自动更新。
  - 「收信」（`openMail`）合并了切换账号：先判断桌面端是不是这个号，不是就退出登录、填邮箱、点继续，再复制账号、在浏览器打开收信页。
    - 同号判断：桌面端 `config.json` 的 `lastKnownAccountUuid` 等于这张卡的 `accountId` 才算同号；其余情况（包括卡片没有 `accountId`）一律切换，最多是重新登录一次同一个号。
    - 桌面端只在账号 ID 变化时写 `lastKnownAccountUuid`，退出登录不清空它；重新登录同一个号时它不变，所以认不出“登回了同一个号”。
    - 填好登录页后 10 分钟内，`lastKnownAccountUuid` 变成没记录过的 ID，就用 `setAccountId` 记到这个邮箱上，下次就能判断同号。
- `app/src/desktopLogin.js` + `desktop-login.ps1`：用 Windows UI Automation 操作桌面端登录页（PowerShell 走 `-EncodedCommand`，参数走环境变量）。
  - 桌面端屏蔽了 `--remote-debugging-port`，`claude://` 深链接也拦了 `/logout`、`/login`，所以只能从外面点界面。
  - 网页内容的无障碍树要被查询过才会生成，脚本会等它出现。窗口元素不接受 `SetFocus`，用 `WScript.Shell.AppActivate` 置前。
  - 左下角账号按钮的名称是“显示名 + 套餐”，按“左下区域、能展开”认；菜单里点「退出登录」；退出后先是带「开始使用」按钮的欢迎页，点了才有邮箱框；邮箱用剪贴板粘贴。
  - 按钮文字都在 `desktopLogin.js` 的 `NAMES` 里（中英文），桌面端改了文字只改这里。`desktopLogin.probe()` 只读列出窗口里的控件，用来排查。
  - 测试钩子：`CLAUDE_HELP_LOGIN_RESULT`（`none`/`filled`/`fail:<步骤>`/`auto`：同号返回 `none`、切换返回 `filled`）跳过桌面端；`CLAUDE_HELP_DESKTOP_CONFIG` 指向假的 `config.json`。
  - 点 × 时按 `closeAction`（`ask`/`tray`/`quit`，默认 `ask`）处理：询问、回到后台（系统托盘）或退出。
    - 询问用页面里的 `#closeDialog`：页面先回“已显示”，再回选择。5 秒内没回“已显示”时，改用原生弹窗兜底。
  - 点「重启并安装」后，`.shell` 和提示条设为 `inert` 并盖上遮罩，快捷键也不响应；安装出错时解锁。开发模式下不安装，直接报错。
  - 设置存在 `src/settings.js` 管理的 `userData\settings.json`，CLI 不用。
  - 托盘和窗口图标用 `src/assets/icon.png`，由 `npm run icon` 生成。
  - 测试时用 `CLAUDE_HELP_CLOSE_ANSWER`（`tray`/`quit`/`cancel`，可加 `-remember`）跳过关闭弹窗。
- `app/src/renderer/`：原生 HTML/CSS/JS，不用框架。左侧导航分四个页面：「额度」「收信地址」「会话」「关于」，`Ctrl+1/2/3/4` 切换。
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
