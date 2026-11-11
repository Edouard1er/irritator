param([ValidateSet('Release','Debug')][string]$Configuration='Release', [switch]$TargetedOnly)
$ErrorActionPreference='Stop'
$repo=(Resolve-Path (Join-Path $PSScriptRoot '../../../..')).Path
$node24=Get-Command node -All | Select-Object -ExpandProperty Source -Unique | Where-Object { (& $_ --version) -match '^v24\.' } | Select-Object -First 1
if (-not $node24) { throw 'Node 24 required' }
$env:PATH=(Split-Path -Parent $node24)+';'+$env:PATH
# 8N changes composition only: reuse and incrementally build the matching 8M
# engine/adapter, preserving its Release/Debug compiler flags and all budgets.
$build=Join-Path $repo "build-web-test8m/$Configuration"
$logs=Join-Path $repo ("build-web-test8n/$Configuration/run-"+(Get-Date -Format 'yyyyMMdd-HHmmss-fffffff')+'-'+$PID)
New-Item -ItemType Directory -Force $logs | Out-Null
$env:IRRITATOR_RUNNER=Join-Path $build 'runner/irritator-runner.exe'
$results=@{}
function Step([string]$name,[string]$command,[string[]]$arguments) {
  $previous=$ErrorActionPreference; $ErrorActionPreference='Continue'
  try { & $command @arguments *> "$logs/$name.log"; $results[$name]=$LASTEXITCODE } finally { $ErrorActionPreference=$previous }
  $results | ConvertTo-Json | Set-Content -LiteralPath "$logs/exit-codes.json"
  Write-Output "$name exit=$($results[$name])"
  if ($results[$name] -ne 0) { Get-Content -LiteralPath "$logs/$name.log" -Tail 12 }
}
Write-Output "Evidence: $logs"
Push-Location $repo
try {
  if (-not $TargetedOnly) {
    $vsRoot='D:\Mes Programmes\Microsoft Visual Studio\2026'
    Import-Module "$vsRoot/Common7/Tools/Microsoft.VisualStudio.DevShell.dll"
    Enter-VsDevShell -VsInstallPath $vsRoot -SkipAutomaticLocation -DevCmdArguments '-arch=x64 -host_arch=x64' | Out-Null
    $env:VSLANG='1033'
    Step 'engine-build' cmake @('--build',"$build/engine",'--parallel','1')
    Step 'runner-configure' cmake @('-S',"$repo/web/engine/runner",'-B',"$build/runner","-DNODE_EXECUTABLE=$node24")
    Step 'runner-build' cmake @('--build',"$build/runner",'--parallel','1')
    Step 'runner-tests' ctest @('--test-dir',"$build/runner",'--output-on-failure','--output-junit',"$logs/runner.xml")
    Step 'official-tests' ctest @('--test-dir',"$build/engine",'-R','^test-','--output-on-failure','--timeout','120','--output-junit',"$logs/official.xml")
    Step 'historical-tests' ctest @('--test-dir',"$build/historical",'--output-on-failure','--output-junit',"$logs/historical.xml")
  }
  Push-Location "$repo/web"
  try {
    Step 'api-build' $node24 @('node_modules/typescript/bin/tsc','-p','apps/api/tsconfig.json')
    if (-not $TargetedOnly) {
      Step 'api-tests' $node24 @('--test','--test-concurrency=1','dist/apps/api/tests/*.test.js')
      foreach ($suffix in @('B','C','D','E','F','G','H','I','J','K','L','M')) {
        $lower=$suffix.ToLowerInvariant()
        $key=if ($suffix -eq 'K') { 'STRUCTURAL_HTTP' } else { "DECISION_8${suffix}_HTTP" }
        Set-Item -LiteralPath "Env:$key" -Value '1'
        Set-Item -LiteralPath "Env:IRRITATOR_8${suffix}_EVIDENCE" -Value "$logs/http-8$lower"
        $suite=if ($suffix -eq 'K') { 'structural-tests.mjs' } else { "decision-8$lower-tests.mjs" }
        try { Step "http-8$lower" $node24 @('--test',"engine/runner/$suite") } finally { Remove-Item -LiteralPath "Env:$key"; Remove-Item -LiteralPath "Env:IRRITATOR_8${suffix}_EVIDENCE" }
      }
    }
    $env:DECISION_8N_HTTP='1'; $env:IRRITATOR_8N_EVIDENCE="$logs/http-8n"
    try { Step 'http-8n' $node24 @('--test','engine/runner/decision-8n-tests.mjs') } finally { Remove-Item Env:DECISION_8N_HTTP; Remove-Item Env:IRRITATOR_8N_EVIDENCE }
  } finally { Pop-Location }
} finally { Pop-Location }
if (@($results.Values | Where-Object { $_ -ne 0 }).Count -gt 0) { exit 1 }
