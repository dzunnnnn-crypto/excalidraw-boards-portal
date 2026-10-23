$ErrorActionPreference = 'Stop'
$taskCodex = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
$taskConfig = Join-Path $taskCodex 'config.toml'
$taskText = if (Test-Path -LiteralPath $taskConfig) { [System.IO.File]::ReadAllText($taskConfig) } else { '' }
if ($taskText -match '(?m)^\[mcp_servers\.boards(?:\]|\.)') { throw 'MCP boards already exists. Ask Codex to update it without overwriting your settings.' }
$taskPrivate = Join-Path $taskCodex 'private-boards'
New-Item -ItemType Directory -Path $taskPrivate -Force | Out-Null
$taskAccount = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $taskPrivate /inheritance:r /grant:r "${taskAccount}:(OI)(CI)F" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Cannot protect credential directory' }
$taskSecret = Join-Path $taskPrivate 'credential.json'
[System.IO.File]::WriteAllText($taskSecret, (@{token='TOKEN_PLACEHOLDER'} | ConvertTo-Json), (New-Object System.Text.UTF8Encoding($false)))
$taskHelper = Join-Path $taskPrivate 'headers.ps1'
$taskHelperText = '$taskValue = Get-Content -LiteralPath (Join-Path $PSScriptRoot "credential.json") -Raw | ConvertFrom-Json; @{Authorization=("Bearer " + $taskValue.token)} | ConvertTo-Json -Compress'
[System.IO.File]::WriteAllText($taskHelper, $taskHelperText, (New-Object System.Text.UTF8Encoding($false)))
if (Test-Path -LiteralPath $taskConfig) { Copy-Item -LiteralPath $taskConfig -Destination (Join-Path $taskPrivate ('config-before-' + (Get-Date -Format 'yyyyMMddHHmmss') + '.toml')) }
$taskCommand = 'powershell.exe -NoProfile -NonInteractive -File "' + $taskHelper + '"'
$taskCommandToml = $taskCommand | ConvertTo-Json -Compress
$taskSection = @"

[mcp_servers.boards]
url = "ORIGIN_PLACEHOLDER/mcp"
http_headers_helper = $taskCommandToml
startup_timeout_sec = 30
tool_timeout_sec = 120
enabled = true

"@
[System.IO.File]::WriteAllText($taskConfig, $taskText + $taskSection, (New-Object System.Text.UTF8Encoding($false)))
Write-Host 'Connection saved. Restart Codex. Keep credential.json private.'
