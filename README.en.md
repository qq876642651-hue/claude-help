<p align="center">
  <img src="app/build/icon.png" width="96" alt="Claude Help icon">
</p>

<h1 align="center">Claude Help</h1>

<p align="center">
  See the usage limits of all your Claude accounts in one window, and get back the sessions that "disappear" when you switch accounts.<br>
  <a href="README.md">中文</a> · <b>English</b>
</p>

---

Claude Help is a Windows desktop app (Electron). It's built for people who switch between several Claude accounts in the Claude desktop app:

- See how much of each account's limit is left and when it resets, at a glance.
- Switch the desktop app to an account, record its usage, and open its webmail in one click.
- After switching accounts, the desktop app only lists the current account's sessions. Claude Help lists the sessions of every account and lets you pick an old one back up.

> This is not an official Anthropic product and is not affiliated with Anthropic.

The interface is available in Chinese and English (About page → Language).

## Features

### Usage

- One card per account, showing how much of the 5-hour and weekly limits is left, a countdown to each reset, and an available / used-up status.
- Sort by weekly remaining, 5-hour remaining, or most recently recorded; filter by email with `Ctrl+F`.
- Records older than a day are flagged as possibly out of date.
- Records can be deleted, with an undo button in the toast.
- Usage is read straight from the Claude desktop app (see "Recording usage" below). The page refreshes on its own.

### Webmail addresses

- Map an email suffix to a webmail URL, for example `poczta.onet.pl → https://…`.
- The **Mail** button on a card first makes sure the desktop app is signed in to that account: if it isn't, it signs out, enters the email and presses Continue; if it is, it reads and records the account's usage. Then it copies the address and opens the matching URL in your default browser.
- A suffix matches when the email domain equals it or ends with `.suffix`; when several match, the longest wins.
- If no URL is set up for a suffix yet, the app jumps to the webmail page with the suffix filled in.

### Sessions

The Claude desktop app stores its session list per account, so switching accounts hides the other accounts' sessions. The full conversation transcripts are still on your machine, and the Sessions page brings them back:

- Lists every session on this computer as a tree of **account → project → session**. Projects can be collapsed, and you can filter by title or project name.
- **Copy resume prompt**: start a new session in the current account in the same project folder and paste it. Claude reads the old transcript, sums up where things stand, and carries on.
- **Delete**: moves the session's list file, its transcript, and any subagent transcripts to the Recycle Bin. Nothing is permanently deleted, so you can restore it from there.
- Accounts are shown by ID until you click Mail once for that account; after that they're shown by email.

### Running in the background

Clicking the window's × asks whether to keep Claude Help running in the background (in the system tray, still refreshing when usage is recorded) or quit. Tick "don't ask again" to remember the choice; you can change it later under "关闭窗口时" (When closing the window) on the About page. While it's in the background, click the tray icon to reopen it, or right-click to quit.

### Automatic updates

The app checks this repository's GitHub Releases, downloads new versions in the background, and installs them silently when you restart from the About page.

## Installation

1. Open [Releases](https://github.com/qq876642651-hue/claude-help/releases/latest) and download `Claude-Help-Setup-<version>.exe`.
2. Run the installer; you can choose where to install. The installer isn't code-signed, so Windows may warn about an unknown publisher.

Windows only.

## Usage

### Recording usage

1. Click **Add account** and enter the email of a Claude account.
2. Click **Mail** on its card. The desktop app switches to that account (signs out, enters the email, presses Continue); open the sign-in link in the email.
3. Once you're signed in, Claude Help opens **Usage** from the desktop app's account menu, reads the 5-hour and weekly limits and their reset times, and records them. Clicking Mail for an account that is already signed in reads it again right away.

Reading usage brings the desktop app to the front and shows its usage page for a second or two. It never moves the mouse.

The desktop app also samples the signed-in account's usage percentages every 15 minutes, and Claude Help syncs those automatically; such cards are marked "(auto)". The samples have no reset times: the weekly reset is carried forward from the last record, and the 5-hour reset is estimated from the samples and shown as "about".

The first time you click Mail for an account, if Claude Help can't tell which account the desktop app is signed in to, it asks whether it's this one.

> The `cchelp` command line that came with 1.2 and earlier was removed in 1.3. Installing the new version takes the old install folder off your PATH.

### Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+1` … `Ctrl+5` | Go to Usage, Webmail addresses, Sessions, Memory, About |
| `Ctrl+F` | Filter by email on the Usage page |

## Data and privacy

Everything stays on your computer; nothing is uploaded.

| Data | Location |
|---|---|
| Usage records | `%USERPROFILE%\.claude\claude-help\usage.json` |
| Webmail addresses | `%USERPROFILE%\.claude\claude-help\mail-sites.json` |
| Session lists (the desktop app's, read-only) | `%LOCALAPPDATA%\Claude-Data\claude_<package ID>\claude-code-sessions\<account ID>\…` |
| Transcripts (Claude Code's, read-only) | `%USERPROFILE%\.claude\projects\<project>\<session>.jsonl` |
| Usage samples (the desktop app's, read-only) | `%LOCALAPPDATA%\Claude-Data\claude_<package ID>\plan-usage-history.json` |

The Sessions page and the usage sync read **undocumented internal files** of the Claude desktop app. They only read what they need and change nothing except when you delete a session. Reading usage works through the desktop app's interface. A future desktop-app update may change the format or the wording; if that happens, these features stop finding anything rather than failing.

## Development

You'll need Node.js and npm. All code lives in `app/`; modules that don't depend on Electron are in `app/src/core/`.

```bash
cd app
npm install
npm start               # run in development
npm run icon            # regenerate build/icon.png after editing build/icon.svg
npm run dist            # build the NSIS installer into app/dist/
npm run version:next    # print the next version and the commits grouped by type
npm run release         # release: bump version, commit, push, create the Release, upload, verify
```

When testing, point `USERPROFILE` and `APPDATA` at a temporary folder and pass `--user-data-dir=<temp folder>` to the app. That keeps your real data safe and stops an installed copy of Claude Help from taking the single-instance lock.

### Commits and versions

Commit messages use an English prefix followed by a description (in Chinese in this repo). `app/scripts/release.mjs` works out the version from the commits since the last `v*` tag, so don't edit the version by hand:

| Prefix | Meaning | Version bump |
|---|---|---|
| `break:` | Breaking change | Major |
| `feat:` | New feature | Minor |
| `fix:` | Fix | Patch |
| `chore:`, `docs:`, etc. | Anything else | Patch |

## License

Private project, no license granted (`UNLICENSED`).
