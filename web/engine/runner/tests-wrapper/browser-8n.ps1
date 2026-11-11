param([ValidateSet('Release','Debug')][string]$Configuration='Release',[string]$FrontendUrl='http://127.0.0.1:3109',[string]$Grep='')
$ErrorActionPreference='Stop'
$node24=Get-Command node -All | Select-Object -ExpandProperty Source -Unique | Where-Object { (& $_ --version) -match '^v24\.' } | Select-Object -First 1
if (-not $node24) { throw 'Node 24 required' }
$env:PATH=(Split-Path -Parent $node24)+';'+$env:PATH
$repo=(Resolve-Path (Join-Path $PSScriptRoot '../../../..')).Path
$lower=$Configuration.ToLowerInvariant()
$base=Join-Path $repo ("build-web-test8n/playwright-$lower-"+(Get-Date -Format 'yyyyMMdd-HHmmss-fffffff')+'-'+$PID)
New-Item -ItemType Directory -Force $base | Out-Null
$env:FRONTEND_URL=$FrontendUrl
$env:IRRITATOR_RUNNER=Join-Path $repo "build-web-test8m/$Configuration/runner/irritator-runner.exe"
$env:IRRITATOR_BROWSER_REGRESSION_ROOT=$base
$env:IRRITATOR_BROWSER_EVIDENCE=Join-Path $base 'shared'
$env:IRRITATOR_BROWSER_SCREENSHOTS=Join-Path $base 'screenshots'
foreach($suffix in @('H','I','J','K','L','M','N')) { Set-Item -LiteralPath "Env:IRRITATOR_8${suffix}_BROWSER_EVIDENCE" -Value (Join-Path $base "8$($suffix.ToLowerInvariant())") }
$env:IRRITATOR_PLAYWRIGHT_REPORT=Join-Path $base 'result.json'
Write-Output "Browser evidence: $base"
Push-Location (Join-Path $repo 'web/apps/frontend')
try {
  $arguments=@('node_modules/@playwright/test/cli.js','test','--output',(Join-Path $base 'test-output'))
  if ($Grep) { $arguments+=@('--grep',$Grep) }
  $ErrorActionPreference='Continue'
  & $node24 @arguments *> (Join-Path $base 'run.log')
  $code=$LASTEXITCODE; $code | Set-Content -LiteralPath (Join-Path $base 'exit-code.txt')
  Get-Content -LiteralPath (Join-Path $base 'run.log') -Tail 25
} finally { Pop-Location }
exit $code
