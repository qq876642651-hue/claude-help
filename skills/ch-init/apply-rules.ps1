# Writes the Claude Help rules block into <ProjectDir>\CLAUDE.md and creates .claude\handoffs.
# Only the text between the claude-help markers is ever replaced.
# Run: powershell -NoProfile -ExecutionPolicy Bypass -File apply-rules.ps1 -ProjectDir <dir>
param([Parameter(Mandatory = $true)][string]$ProjectDir)

$ErrorActionPreference = 'Stop'
$utf8 = New-Object Text.UTF8Encoding $false
$startMarker = '<!-- claude-help:start -->'
$endMarker = '<!-- claude-help:end -->'

$templatePath = Join-Path $PSScriptRoot 'rules-template.md'
$block = [IO.File]::ReadAllText($templatePath, $utf8).Trim()

$projectPath = (Resolve-Path -LiteralPath $ProjectDir).Path
$claudeMd = Join-Path $projectPath 'CLAUDE.md'

if (-not (Test-Path -LiteralPath $claudeMd)) {
    $text = "# CLAUDE.md`n`n" + $block + "`n"
    $result = 'created'
} else {
    $old = [IO.File]::ReadAllText($claudeMd, $utf8)
    $start = $old.IndexOf($startMarker)
    $end = $old.IndexOf($endMarker)
    if ($start -ge 0 -and $end -gt $start) {
        $after = $end + $endMarker.Length
        $text = $old.Substring(0, $start) + $block + $old.Substring($after)
        $result = if ($text -eq $old) { 'unchanged' } else { 'replaced' }
    } elseif ($start -ge 0 -or $end -ge 0) {
        throw "CLAUDE.md has only one claude-help marker; fix it by hand first: $claudeMd"
    } else {
        $text = $old.TrimEnd() + "`n`n" + $block + "`n"
        $result = 'appended'
    }
}

if ($result -ne 'unchanged') {
    [IO.File]::WriteAllText($claudeMd, $text, $utf8)
}

$handoffs = Join-Path $projectPath '.claude\handoffs'
if (-not (Test-Path -LiteralPath $handoffs)) {
    New-Item -ItemType Directory -Path $handoffs | Out-Null
}

Write-Output "CLAUDE.md: $result"
Write-Output "handoffs: $handoffs"
