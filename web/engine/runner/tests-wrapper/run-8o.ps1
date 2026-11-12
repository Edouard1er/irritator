param([ValidateSet('Release','Debug')][string]$Configuration='Release',[switch]$BuildOnly,[switch]$TestsOnly,[switch]$CoreOnly)
$ErrorActionPreference='Stop'
if ($TestsOnly -and $BuildOnly) { throw 'TestsOnly and BuildOnly are mutually exclusive' }
if ($CoreOnly -and -not $BuildOnly) { throw 'CoreOnly requires BuildOnly; run the complete campaign for regression checks' }
$repo=(Resolve-Path (Join-Path $PSScriptRoot '../../../..')).Path
$node24=Get-Command node -All | Select-Object -ExpandProperty Source -Unique | Where-Object { (& $_ --version) -match '^v24\.' } | Select-Object -First 1
if (-not $node24) { throw 'Node 24 required' }
$env:PATH=(Split-Path -Parent $node24)+';'+$env:PATH
$build=Join-Path $repo "build-web-test8o/$Configuration"
$logs=Join-Path $build ('run-'+(Get-Date -Format 'yyyyMMdd-HHmmss-fffffff')+'-'+$PID)
New-Item -ItemType Directory -Force $logs | Out-Null
$env:IRRITATOR_RUNNER=Join-Path $build 'runner/irritator-runner.exe'
$results=@{}
function Step([string]$name,[string]$command,[string[]]$arguments) {
  $previous=$ErrorActionPreference; $ErrorActionPreference='Continue'
  try { & $command @arguments *> "$logs/$name.log"; $results[$name]=$LASTEXITCODE } finally { $ErrorActionPreference=$previous }
  $results | ConvertTo-Json | Set-Content -LiteralPath "$logs/exit-codes.json"
  Write-Output "$name exit=$($results[$name])"
  if ($results[$name] -ne 0) { Get-Content -LiteralPath "$logs/$name.log" -Tail 15 }
  if ($results[$name] -ne 0 -and $name -match '(configure|build)$') { throw "$name failed; refusing to test stale binaries" }
}
Write-Output "Evidence: $logs"
Push-Location $repo
try {
  if (-not $TestsOnly) {
    $vsRoot='D:\Mes Programmes\Microsoft Visual Studio\2026'
    Import-Module "$vsRoot/Common7/Tools/Microsoft.VisualStudio.DevShell.dll"
    Enter-VsDevShell -VsInstallPath $vsRoot -SkipAutomaticLocation -DevCmdArguments '-arch=x64 -host_arch=x64' | Out-Null
    $env:VSLANG='1033'
    Step 'engine-configure' cmake @('-S',$repo,'-B',"$build/engine",'-G','Ninja',"-DCMAKE_BUILD_TYPE=$Configuration",'-DWITH_GUI=OFF','-DWITH_NATIVE_ARCH=OFF')
    if ($CoreOnly) { Step 'engine-build' cmake @('--build',"$build/engine",'--target','libirritator','--parallel','1') }
    else { Step 'engine-build' cmake @('--build',"$build/engine",'--parallel','1') }
    Step 'runner-configure' cmake @('-S',"$repo/web/engine/runner",'-B',"$build/runner",'-G','Ninja',"-DCMAKE_BUILD_TYPE=$Configuration","-DIRRITATOR_BUILD_DIR=$build/engine","-DNODE_EXECUTABLE=$node24")
    Step 'runner-core-build' cmake @('--build',"$build/runner",'--target','irritator-runner','trajectory-native','--parallel','1')
    if (-not $CoreOnly) {
      Step 'runner-build' cmake @('--build',"$build/runner",'--parallel','1')
      Step 'historical-configure' cmake @('-S',"$repo/demos/wrapper-stabilization",'-B',"$build/historical",'-G','Ninja',"-DCMAKE_BUILD_TYPE=$Configuration","-DIRRITATOR_BUILD_DIR=$build/engine")
      Step 'historical-build' cmake @('--build',"$build/historical",'--parallel','1')
    }
  }
  if (-not $BuildOnly) {
    Push-Location $build
    try { Step 'native-8o' (Join-Path $build 'runner/trajectory-native.exe') @("$repo/web/examples/test-8o-schaefer-six-trajectories-v3.json") } finally { Pop-Location }
    Step 'runner-tests' ctest @('--test-dir',"$build/runner",'--output-on-failure','--output-junit',"$logs/runner.xml")
    Step 'official-tests' ctest @('--test-dir',"$build/engine",'-R','^test-','--output-on-failure','--output-junit',"$logs/official.xml")
    Step 'historical-tests' ctest @('--test-dir',"$build/historical",'--output-on-failure','--output-junit',"$logs/historical.xml")
    Push-Location "$repo/web"
    try {
      Step 'api-build' $node24 @('node_modules/typescript/bin/tsc','-p','apps/api/tsconfig.json')
      $env:IRRITATOR_HTTP_EVIDENCE="$logs/api-evidence"
      try { Step 'api-tests' $node24 @('--test','--test-concurrency=1','dist/apps/api/tests/*.test.js') } finally { Remove-Item Env:IRRITATOR_HTTP_EVIDENCE }
      $env:TRAJECTORY_8O_HTTP='1'; $env:IRRITATOR_8O_EVIDENCE="$logs/http-8o"
      try { Step 'http-8o' $node24 @('--test','engine/runner/trajectory-8o-tests.mjs') } finally { Remove-Item Env:TRAJECTORY_8O_HTTP; Remove-Item Env:IRRITATOR_8O_EVIDENCE }
    } finally { Pop-Location }
  }
} finally { Pop-Location }
if (@($results.Values | Where-Object { $_ -ne 0 }).Count -gt 0) { exit 1 }
