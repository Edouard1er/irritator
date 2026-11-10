param([ValidateSet('Release','Debug')][string]$Configuration='Release',[string]$FrontendUrl='http://127.0.0.1:3402',[string]$Grep='')
$ErrorActionPreference='Stop'
$selectionNodePath=$null
foreach($candidate in @(Get-Command node -All | Select-Object -ExpandProperty Source -Unique)) {
  if ((& $candidate --version) -match '^v24\.') { $selectionNodePath=$candidate; break }
}
if (-not $selectionNodePath) { throw 'Node 24 is required by web/package.json; put its directory on PATH.' }
$env:PATH=(Split-Path -Parent $selectionNodePath)+';'+$env:PATH
$repo=(Resolve-Path (Join-Path $PSScriptRoot '../../../..')).Path
$lower=$Configuration.ToLowerInvariant()
$run='playwright-'+$lower+'-'+(Get-Date -Format 'yyyyMMdd-HHmmss-fffffff')+'-'+$PID
$base=Join-Path $repo "build-web-test8l/$run"
New-Item -ItemType Directory -Force -Path $base | Out-Null
$env:FRONTEND_URL=$FrontendUrl
$canonical=Join-Path $repo "build-web-test8l/$Configuration/runner/irritator-runner.exe"
$env:IRRITATOR_RUNNER=Join-Path $repo "build-web-test8l/$Configuration/runner/irritator-runner-browser-$lower.exe"
if (-not (Test-Path -LiteralPath $env:IRRITATOR_RUNNER) -or (Get-FileHash -LiteralPath $canonical).Hash -ne (Get-FileHash -LiteralPath $env:IRRITATOR_RUNNER).Hash) {
  Copy-Item -LiteralPath $canonical -Destination $env:IRRITATOR_RUNNER -Force
}
$env:IRRITATOR_BROWSER_REGRESSION_ROOT=$base
$env:IRRITATOR_BROWSER_EVIDENCE=Join-Path $base 'shared'
$env:IRRITATOR_BROWSER_SCREENSHOTS=Join-Path $base 'screenshots'
foreach($suffix in @('H','I','J','K','L')) {Set-Item -LiteralPath "Env:IRRITATOR_8${suffix}_BROWSER_EVIDENCE" -Value (Join-Path $base "8$($suffix.ToLowerInvariant())")}
$env:IRRITATOR_PLAYWRIGHT_REPORT=Join-Path $base 'result.json'
Write-Output "Browser evidence: $base"
Push-Location (Join-Path $repo 'web/apps/frontend')
try {
  $arguments=@((Join-Path $repo 'web/apps/frontend/node_modules/@playwright/test/cli.js'),'test','--output',(Join-Path $base 'test-output'))
  if($Grep){$arguments+=@('--grep',$Grep)}
  $ErrorActionPreference='Continue'
  & $selectionNodePath @arguments *> (Join-Path $base 'run.log')
  $code=$LASTEXITCODE
  $code | Set-Content -LiteralPath (Join-Path $base 'exit-code.txt')
  Get-Content -LiteralPath (Join-Path $base 'run.log') -Tail 20
} finally {Pop-Location}
exit $code

