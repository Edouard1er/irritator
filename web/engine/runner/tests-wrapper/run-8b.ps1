param([ValidateSet('Release','Debug')][string]$Configuration='Release', [switch]$TestsOnly, [switch]$BuildOnly, [int]$Parallel=2)
$ErrorActionPreference='Stop'
$repo=(Resolve-Path (Join-Path $PSScriptRoot '../../../..')).Path
$build=Join-Path $repo "build-web-test8b/$Configuration"
$logs=Join-Path $build 'logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$results=@{}
function Step([string]$name,[string]$command,[string[]]$arguments) {
    $stepPreference=$ErrorActionPreference
    $ErrorActionPreference='Continue'
    try { & $command @arguments *> "$logs/$name.log"; $code=$LASTEXITCODE }
    finally { $ErrorActionPreference=$stepPreference }
    $results[$name]=$code
    $results | ConvertTo-Json | Set-Content "$logs/exit-codes.json"
    Write-Output "$name exit=$code"
    if($code -ne 0) { Get-Content "$logs/$name.log" -Tail 12 }
    return
}
Push-Location $repo
try {
    $env:IRRITATOR_RUNNER="$build/runner/irritator-runner.exe"
    if(-not $TestsOnly) {
        $vsRoot='D:\Mes Programmes\Microsoft Visual Studio\2026'
        Import-Module "$vsRoot/Common7/Tools/Microsoft.VisualStudio.DevShell.dll"
        Enter-VsDevShell -VsInstallPath $vsRoot -SkipAutomaticLocation -DevCmdArguments '-arch=x64 -host_arch=x64' | Out-Null
        $env:VSLANG='1033'
        Step 'engine-configure' cmake @('-S',$repo,'-B',"$build/engine",'-G','Ninja',"-DCMAKE_BUILD_TYPE=$Configuration",'-DWITH_GUI=OFF','-DWITH_NATIVE_ARCH=OFF')
        Step 'engine-build' cmake @('--build',"$build/engine",'--clean-first','--target','libirritator','test-api','test-container','test-dama','test-dot-parser','test-mod-to-sim','test-qss','test-request-buffer','test-shared-buffer','test-simulations','test-task-manager','--parallel',"$Parallel")
        if($LASTEXITCODE -ne 0) { throw 'Engine build failed' }
        Step 'runner-configure' cmake @('-S',"$repo/web/engine/runner",'-B',"$build/runner",'-G','Ninja',"-DCMAKE_BUILD_TYPE=$Configuration","-DIRRITATOR_BUILD_DIR=$build/engine")
        Step 'runner-build' cmake @('--build',"$build/runner",'--clean-first','--parallel',"$Parallel")
        if($LASTEXITCODE -ne 0) { throw 'Runner build failed' }
        Step 'historical-configure' cmake @('-S',"$repo/demos/wrapper-stabilization",'-B',"$build/historical",'-G','Ninja',"-DCMAKE_BUILD_TYPE=$Configuration","-DIRRITATOR_BUILD_DIR=$build/engine")
        Step 'historical-build' cmake @('--build',"$build/historical",'--clean-first','--parallel',"$Parallel")
    }
    if($BuildOnly) { return }
    Step 'runner-tests' ctest @('--test-dir',"$build/runner",'--output-on-failure','--output-junit',"$logs/runner.xml")
    Step 'official-tests' ctest @('--test-dir',"$build/engine",'-R','^test-','--output-on-failure','--timeout','120','--output-junit',"$logs/official.xml")
    Step 'historical-tests' ctest @('--test-dir',"$build/historical",'--output-on-failure','--output-junit',"$logs/historical.xml")
    Push-Location "$repo/web"
    try {
        Step 'api-build' npm.cmd @('run','build')
        Step 'api-tests' node @('--test','--test-concurrency=1','dist/apps/api/tests/*.test.js')
        $env:IRRITATOR_8B_EVIDENCE="$logs/scientific"
        Step 'decision-8b' node @('--test','engine/runner/decision-8b-tests.mjs')
        $env:DECISION_8B_HTTP='1'
        $env:IRRITATOR_8B_EVIDENCE="$logs/http-8b"
        Step 'http-8b' node @('--test','engine/runner/decision-8b-tests.mjs')
        Remove-Item Env:DECISION_8B_HTTP -ErrorAction SilentlyContinue
    } finally { Pop-Location }
} finally { Pop-Location }
if (@($results.Values | Where-Object { $_ -ne 0 }).Count -gt 0) { exit 1 }
