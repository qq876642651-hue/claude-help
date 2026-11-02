<p align="center">
  <img src="app/build/icon.png" width="96" alt="Claude Help 图标">
</p>

<h1 align="center">Claude Help</h1>

<p align="center">
  在一个窗口里看清多个 Claude 账号的额度，找回切换账号后“消失”的会话。<br>
  <b>中文</b> · <a href="README.en.md">English</a>
</p>

---

Claude Help 是一个 Windows 桌面软件（Electron），附带命令行工具 `claude-help`。它适合在多个 Claude 账号之间切换使用 Claude 桌面端的人：

- 每个账号还剩多少额度、什么时候重置，一眼看到。
- 一键复制账号并打开对应的收信网页。
- 切换账号后，桌面端只显示当前账号的会话；这里能看到所有账号的会话，并把旧会话接着做下去。

> 本项目不是 Anthropic 的官方产品，和 Anthropic 没有关联。

## 功能

### 额度

- 每个账号一张卡片，显示 5 小时额度和每周额度的剩余百分比、重置倒计时，以及“可用 / 已用尽”状态。
- 可以按每周剩余、5 小时剩余或最近记录排序，也可以按邮箱筛选（`Ctrl+F`）。
- 超过一天没更新的记录会标出“可能过期”。
- 记录可以删除，删除后可在提示条里撤销。
- 额度由 Claude 在桌面端会话里读取后写入（见下文“记录额度”），写入后页面自动刷新。

### 收信地址

- 按邮箱后缀配置收信网址，例如 `poczta.onet.pl → https://…`。
- 点卡片上的「收信」会先复制账号，再用默认浏览器打开对应网址。
- 邮箱域名等于后缀或以“.后缀”结尾即匹配；有多条匹配时取最长的后缀。
- 后缀还没配置网址时，会跳到「收信地址」页并预填好后缀。

### 会话

Claude 桌面端按账号分开存放会话列表，切换账号后只显示当前账号的会话。但完整的对话记录都还在本机，「会话」页把它们找回来：

- 按 **账号 → 项目 → 会话** 三层列出本机所有会话，项目可以收起，支持按标题或项目名筛选。
- **复制续接指令**：在当前账号里用同一个项目目录新建会话，粘贴这段指令，Claude 会先读旧的完整对话记录、概括进度，再接着做。
- **删除**：把会话列表文件、对话记录和子代理记录一起移到回收站（不是永久删除，可以从回收站还原）。
- 账号默认显示为 ID；在某个账号里记录过一次额度后，这个账号就会显示成邮箱。

### 自动更新

软件从本仓库的 GitHub Releases 自动检查并下载新版本，下载后在「关于」页重启即可静默安装。

## 安装

1. 打开 [Releases](https://github.com/qq876642651-hue/claude-help/releases/latest)，下载 `Claude-Help-Setup-<版本>.exe`。
2. 运行安装程序，可以自选安装位置。安装程序没有代码签名，Windows 可能会提示“未知发布者”。
3. 安装程序会把安装目录加进用户 PATH，**新开**一个终端就能使用 `claude-help`。

只支持 Windows。

## 用法

### 记录额度

额度只有 Claude 在桌面端会话里能读到，Claude Help 自己读不到。所以记录额度的方式是：在 Claude 桌面端对 Claude 说

> 记录额度

Claude 会读取当前账号的额度和会话 ID，交给 `claude-help usage record` 保存，软件随即刷新。具体流程写在 `claude-help --help` 的“给 Claude 的说明”里，Claude 会照着做。

每个账号需要在登录状态下各记录一次。

### 命令行

| 命令 | 作用 |
|---|---|
| `claude-help` | 显示各账号额度，默认按每周剩余排序；`--sort weekly\|5h\|recorded`，`--json` |
| `claude-help usage record --email <邮箱> [--session <会话ID>] [--file <文件>]` | 记录一个账号的额度（plan JSON 从 stdin 或文件读入），一般由 Claude 调用 |
| `claude-help usage remove <邮箱>` | 删除一个账号的额度记录 |
| `claude-help mail <邮箱> [--print]` | 复制账号并用默认浏览器打开收信网址；`--print` 只打印网址 |
| `claude-help sites` | 列出收信地址 |
| `claude-help sites add <后缀> <网址>` / `remove <后缀>` / `reset` | 添加、删除收信地址，或恢复默认 |
| `claude-help sessions [--json]` | 按账号和项目列出全部会话 |
| `claude-help sessions resume <会话ID或前缀>` | 打印续接指令并复制到剪贴板 |
| `claude-help --help` / `--version` | 帮助和版本 |

会话的删除只在软件里提供，命令行不提供，免得误删。

### 快捷键

| 快捷键 | 作用 |
|---|---|
| `Ctrl+1` / `Ctrl+2` / `Ctrl+3` / `Ctrl+4` | 切换到「额度」「收信地址」「会话」「关于」 |
| `Ctrl+F` | 在「额度」页筛选邮箱 |

## 数据与隐私

所有数据都只存在本机，不会上传。

| 内容 | 位置 |
|---|---|
| 额度记录 | `%USERPROFILE%\.claude\claude-help\usage.json` |
| 收信地址 | `%USERPROFILE%\.claude\claude-help\mail-sites.json` |
| 会话列表（桌面端的，只读） | `%LOCALAPPDATA%\Claude-Data\claude_<包ID>\claude-code-sessions\<账号ID>\…` |
| 对话记录（Claude Code 的，只读） | `%USERPROFILE%\.claude\projects\<项目>\<会话>.jsonl` |

「会话」功能读取的是 Claude 桌面端**未公开的内部文件**，只取标题、目录、时间、是否归档这几项，除删除外不做任何修改。桌面端以后升级可能改变格式，到时这一页会显示为空，但不会报错。

## 开发

需要 Node.js 和 npm。代码都在 `app/` 下，软件和命令行共用 `app/src/core/` 里的模块。

```bash
cd app
npm install
npm start               # 开发运行
npm run cli -- --help   # 运行开发版命令行
npm run icon            # 改了 build/icon.svg 后重新生成 build/icon.png
npm run dist            # 打包 NSIS 安装程序到 app/dist/
npm run version:next    # 打印下一个版本号和分组的提交
npm run release         # 发版：改版本号、提交、推送、建 Release、上传并核对
```

测试时请把 `USERPROFILE` 和 `APPDATA` 指向临时目录，并给软件加 `--user-data-dir=<临时目录>`，免得改到真实数据，或者被已安装的 Claude Help 的单实例锁挡住。

### 提交与版本

提交信息写成“英文前缀 + 中文描述”，版本号由 `app/scripts/release.mjs` 按上次 `v*` 标签以来的提交自动计算，不要手动修改：

| 前缀 | 含义 | 版本变化 |
|---|---|---|
| `break:` | 不兼容的改动 | 升主版本 |
| `feat:` | 新功能 | 升次版本 |
| `fix:` | 修复 | 升修订号 |
| `chore:`、`docs:` 等 | 其他 | 升修订号 |

## 许可

私有项目，未授权使用许可（`UNLICENSED`）。
