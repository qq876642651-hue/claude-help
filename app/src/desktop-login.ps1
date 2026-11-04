# 用 Windows UI Automation 操作 Claude 桌面端的登录：由 desktopLogin.js 运行，参数走环境变量，最后输出一行 JSON
# CLAUDE_HELP_LOGIN_MODE：probe（只列控件，不点击）| same（已登录就不动，顺便读额度）| switch（已登录就先退出）| usage（只读额度）
# 桌面端屏蔽了远程调试参数和 /logout 深链接，只能这样从外面点
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms

$mode = $env:CLAUDE_HELP_LOGIN_MODE
$email = $env:CLAUDE_HELP_LOGIN_EMAIL
$names = $env:CLAUDE_HELP_LOGIN_NAMES | ConvertFrom-Json
$AE = [Windows.Automation.AutomationElement]
$CT = [Windows.Automation.ControlType]
$Scope = [Windows.Automation.TreeScope]

function Done($result) {
  [Console]::Out.WriteLine(($result | ConvertTo-Json -Compress -Depth 6))
  exit 0
}
function Fail($step, $detail) { Done @{ ok = $false; step = $step; detail = "$detail" } }
trap { Fail 'script' $_.Exception.Message }

function Matches($name, $patterns) {
  foreach ($p in $patterns) { if ($name -match $p) { return $true } }
  return $false
}

# 桌面端主窗口：MSIX 版和普通安装版都叫 Claude；Claude Code CLI 也叫 claude.exe，但没有窗口
function FindWindow {
  $ids = @(Get-Process -Name Claude -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object { $_.Id })
  if (-not $ids.Count) { return $null }
  $cond = New-Object Windows.Automation.PropertyCondition($AE::ClassNameProperty, 'Chrome_WidgetWin_1')
  foreach ($w in $AE::RootElement.FindAll($Scope::Children, $cond)) {
    if ($ids -contains $w.Current.ProcessId -and $w.Current.Name) { return $w }
  }
  return $null
}

# 没运行或藏在托盘里时，从开始菜单的应用入口启动（已运行时会把窗口叫出来）
function LaunchDesktop {
  $pkg = Get-AppxPackage -Name Claude -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $pkg) { return $false }
  $apps = @((Get-AppxPackageManifest $pkg).Package.Applications.Application)
  $app = $apps | Where-Object { $_.Id -eq 'Claude' } | Select-Object -First 1
  if (-not $app) { $app = $apps[0] }
  Start-Process explorer.exe "shell:AppsFolder\$($pkg.PackageFamilyName)!$($app.Id)"
  return $true
}

function Wait($seconds, $test) {
  $until = (Get-Date).AddSeconds($seconds)
  do {
    $r = & $test
    if ($r) { return $r }
    Start-Sleep -Milliseconds 300
  } while ((Get-Date) -lt $until)
  return $null
}

function All($win) { $win.FindAll($Scope::Descendants, [Windows.Automation.Condition]::TrueCondition) }

function Rect($e) { $e.Current.BoundingRectangle }

# 左下角的账号按钮：名称是“显示名 + 套餐”，不含邮箱，所以按位置和“能展开”来认
function AccountButton($win, $all) {
  $wr = Rect $win
  foreach ($e in $all) {
    if ($e.Current.ControlType -ne $CT::Button -or -not $e.Current.Name) { continue }
    if (Matches $e.Current.Name $names.settings) { continue }
    $r = Rect $e
    if ($r.IsEmpty -or $r.Left -gt $wr.Left + 360 -or $r.Top -lt $wr.Bottom - 160) { continue }
    if ($e.GetCurrentPropertyValue($AE::IsExpandCollapsePatternAvailableProperty)) { return $e }
  }
  return $null
}

# 登录页的邮箱框：按名称认；认不出时，页面上只有一个输入框就用它。已登录的页面也有输入框（提示词），所以有账号按钮时不算
function EmailBox($win, $all) {
  if (AccountButton $win $all) { return $null }
  $edits = @($all | Where-Object { $_.Current.ControlType -eq $CT::Edit -and -not $_.Current.IsOffscreen })
  $hit = $edits | Where-Object { Matches $_.Current.Name $names.email } | Select-Object -First 1
  if ($hit) { return $hit }
  if ($edits.Count -eq 1) { return $edits[0] }
  return $null
}

# 退出登录后先出现的欢迎页上的「开始使用」按钮，点了才有邮箱框
function StartButton($win, $all) {
  if (AccountButton $win $all) { return $null }
  return FindNamed $all @('ControlType.Button') $names.start
}

# 页面上还有填着这个邮箱的输入框
function EmailStillThere($all) {
  foreach ($e in $all) {
    if ($e.Current.ControlType -ne $CT::Edit) { continue }
    try { if ($e.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern).Current.Value -eq $email) { return $true } } catch {}
  }
  return $false
}

function FindNamed($all, $types, $patterns) {
  foreach ($e in $all) {
    if ($types -contains $e.Current.ControlType.ProgrammaticName -and (Matches $e.Current.Name $patterns)) { return $e }
  }
  return $null
}

function Click($e) {
  try { $e.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke(); return } catch {}
  try { $e.GetCurrentPattern([Windows.Automation.ExpandCollapsePattern]::Pattern).Expand(); return } catch {}
  $e.SetFocus()
  [Windows.Forms.SendKeys]::SendWait('{ENTER}')
}

# 登录状态：account（已登录）| login（登录页）| $null（还认不出）
function State($win) {
  $all = All $win
  if (AccountButton $win $all) { return 'account' }
  if ((EmailBox $win $all) -or (StartButton $win $all)) { return 'login' }
  return $null
}

# 等邮箱框出现，途中遇到「开始使用」就点；点完隔几秒再点，免得翻页途中重复点
# 刚点了退出登录时（$afterLogout），遇到确认框也点一次
$clicked = @{ start = [DateTime]::MinValue; confirm = $false }
function WaitEmailBox($seconds, $afterLogout) {
  Wait $seconds {
    $all = All $win
    $box = EmailBox $win $all
    if ($box) { return $box }
    if (((Get-Date) - $clicked.start).TotalSeconds -gt 3) {
      $btn = StartButton $win $all
      if ($btn) { Click $btn; $clicked.start = Get-Date; return $null }
    }
    if ($afterLogout -and -not $clicked.confirm) {
      $btn = FindNamed $all @('ControlType.Button') $names.logout
      if ($btn) { Click $btn; $clicked.confirm = $true }
    }
    return $null
  }
}

# 读当前账号的用量：账号菜单里点「用量」会打开设置的用量页，读完按 Esc 关掉，全程不动鼠标
# 只交出原始文字（类型、名称、纵坐标、进度条的值），由 desktopLogin.js 解析
function ReadUsage {
  $acc = AccountButton $win (All $win)
  if (-not $acc) { return @{ ok = $false; step = 'login' } }
  $account = $acc.Current.Name
  Click $acc
  $item = Wait 8 { FindNamed (All $win) @('ControlType.MenuItem') $names.usageItem }
  if (-not $item) {
    [Windows.Forms.SendKeys]::SendWait('{ESC}')
    return @{ ok = $false; step = 'menu' }
  }
  Click $item
  $bar = Wait 15 { FindNamed (All $win) @('ControlType.ProgressBar') $names.sessionLimit }
  if (-not $bar) {
    [Windows.Forms.SendKeys]::SendWait('{ESC}')
    return @{ ok = $false; step = 'page' }
  }
  Start-Sleep -Milliseconds 300
  $items = @()
  foreach ($e in (All $win)) {
    $type = $e.Current.ControlType.ProgrammaticName -replace '^ControlType\.', ''
    if ($type -notmatch '^(Text|ProgressBar|Button)$' -or -not $e.Current.Name) { continue }
    $one = @{ type = $type; name = $e.Current.Name; top = [int](Rect $e).Top }
    if ($type -eq 'ProgressBar') {
      try { $one.value = $e.GetCurrentPattern([Windows.Automation.RangeValuePattern]::Pattern).Current.Value } catch {}
    } elseif ($type -eq 'Button') {
      if (-not (Matches $e.Current.Name $names.extraUsage)) { continue }
      try { $one.toggle = "$($e.GetCurrentPattern([Windows.Automation.TogglePattern]::Pattern).Current.ToggleState)" } catch {}
    }
    $items += $one
  }
  # 设置页是窗口里的一层，Esc 关掉；没关掉再按一次
  [Windows.Forms.SendKeys]::SendWait('{ESC}')
  $closed = Wait 3 { -not (FindNamed (All $win) @('ControlType.ProgressBar') $names.sessionLimit) }
  if (-not $closed) { [Windows.Forms.SendKeys]::SendWait('{ESC}') }
  return @{ ok = $true; account = $account; items = $items }
}

$win = FindWindow
if (-not $win -and $mode -ne 'probe') {
  if (-not (LaunchDesktop)) { Fail 'window' 'Claude desktop is not installed' }
  $win = Wait 20 { FindWindow }
}
if (-not $win) { Fail 'window' 'window not found' }

if ($mode -eq 'probe') {
  $state = Wait 10 { State $win }
  $all = All $win
  $items = @()
  foreach ($e in $all) {
    $type = $e.Current.ControlType.ProgrammaticName -replace '^ControlType\.', ''
    if ($type -notmatch '^(Button|Edit|MenuItem|Hyperlink|CheckBox|RadioButton|ComboBox|Text)$') { continue }
    $r = Rect $e
    $items += @{ type = $type; name = $e.Current.Name; id = $e.Current.AutomationId; rect = "$($r.Left),$($r.Top),$($r.Width),$($r.Height)" }
  }
  $acc = AccountButton $win $all
  $accName = if ($acc) { $acc.Current.Name } else { '' }
  Done @{ ok = $true; window = $win.Current.Name; state = "$state"; account = $accName; items = $items }
}

# 窗口最小化时先还原；网页内容的无障碍树要被查询过才会生成，所以等它出现
try {
  $wp = $win.GetCurrentPattern([Windows.Automation.WindowPattern]::Pattern)
  if ($wp.Current.WindowVisualState -eq 'Minimized') { $wp.SetWindowVisualState('Normal') }
} catch {}
# 窗口元素不接受 SetFocus，用 AppActivate 把它切到前面（之后要用键盘粘贴）
[void](New-Object -ComObject WScript.Shell).AppActivate([int]$win.Current.ProcessId)
$state = Wait 10 { State $win }
if (-not $state) { Fail 'window' 'page not ready' }

if ($mode -eq 'usage') {
  if ($state -ne 'account') { Fail 'login' 'not signed in' }
  $usage = ReadUsage
  if (-not $usage.ok) { Fail $usage.step '' }
  Done $usage
}

if ($state -eq 'account') {
  # 同号时顺便读额度；读不到不影响登录的结果
  if ($mode -eq 'same') { Done @{ ok = $true; action = 'none'; usage = (ReadUsage) } }
  Click (AccountButton $win (All $win))
  $item = Wait 8 { FindNamed (All $win) @('ControlType.MenuItem', 'ControlType.Button') $names.logout }
  if (-not $item) {
    [Windows.Forms.SendKeys]::SendWait('{ESC}')
    Fail 'logout' 'menu item not found'
  }
  Click $item
  $box = WaitEmailBox 30 $true
  if (-not $box) { Fail 'logout' 'login page did not appear' }
} else {
  $box = WaitEmailBox 15 $false
  if (-not $box) { Fail 'email' 'email box not found' }
}

# 邮箱用剪贴板粘贴（Claude Help 事先写好），网页的输入框对粘贴一定有反应
try { $box.SetFocus() } catch {}
[Windows.Forms.SendKeys]::SendWait('^a')
[Windows.Forms.SendKeys]::SendWait('^v')
Start-Sleep -Milliseconds 200
try {
  $vp = $box.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern)
  if ($vp.Current.Value -ne $email) { $vp.SetValue($email) }
  if ($vp.Current.Value -ne $email) { Fail 'email' 'value not accepted' }
} catch { Fail 'email' $_.Exception.Message }

$btn = FindNamed (All $win) @('ControlType.Button') $names.continue
if ($btn) { Click $btn } else { $box.SetFocus(); [Windows.Forms.SendKeys]::SendWait('{ENTER}') }

# 填着邮箱的输入框消失（换成“去查收邮件”之类的页面）就算成功
$gone = Wait 15 { -not (EmailStillThere (All $win)) }
if (-not $gone) { Fail 'continue' 'page did not change' }
Done @{ ok = $true; action = 'filled' }
