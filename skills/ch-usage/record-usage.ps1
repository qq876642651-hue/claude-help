# Records the latest plan usage for one account into %USERPROFILE%\.claude\claude-help\usage.json,
# which the Claude Help app watches. Keeps only the newest record per account.
# Run: powershell -NoProfile -ExecutionPolicy Bypass -File record-usage.ps1 -Email <email> -PlanFile <path>
# PlanFile holds the `plan` object returned by get_usage, as JSON. It is deleted after a successful run.
param(
    [Parameter(Mandatory = $true)][string]$Email,
    [Parameter(Mandatory = $true)][string]$PlanFile
)

$ErrorActionPreference = 'Stop'
$utf8 = New-Object Text.UTF8Encoding $false

$dataDir = Join-Path $env:USERPROFILE '.claude\claude-help'
if (-not (Test-Path -LiteralPath $dataDir)) {
    New-Item -ItemType Directory -Path $dataDir | Out-Null
}

$plan = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $PlanFile).Path, $utf8) | ConvertFrom-Json
if ($plan.status -ne 'ok') {
    throw "plan.status is '$($plan.status)', nothing recorded"
}

$windows = @()
foreach ($w in @($plan.windows)) {
    $windows += [ordered]@{
        label       = [string]$w.label
        percentUsed = [double]$w.percentUsed
        resetsAt    = [string]$w.resetsAt
    }
}

$record = [ordered]@{
    email             = $Email
    plan              = [string]$plan.plan
    windows           = $windows
    extraUsageEnabled = [bool]$plan.extraUsage.enabled
    recordedAt        = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
}

$usagePath = Join-Path $dataDir 'usage.json'
$accounts = @()
if (Test-Path -LiteralPath $usagePath) {
    $old = [IO.File]::ReadAllText($usagePath, $utf8) | ConvertFrom-Json
    $accounts = @(@($old.accounts) | Where-Object { $_ -and $_.email -ne $Email })
}
$accounts += $record

$json = ConvertTo-Json -InputObject ([ordered]@{ accounts = $accounts }) -Depth 10
[IO.File]::WriteAllText($usagePath, $json, $utf8)

Remove-Item -LiteralPath $PlanFile

Write-Output "recorded: $Email ($($record.plan)), accounts: $($accounts.Count)"
Write-Output "data: $usagePath"
