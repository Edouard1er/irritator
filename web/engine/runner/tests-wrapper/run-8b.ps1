param([ValidateSet('Release','Debug')][string]$Configuration='Release', [switch]$TestsOnly)
$ErrorActionPreference='Stop'
$repo=(Resolve-Path (Join-Path $PSScriptRoot '../../../..')).Path
$build=Join-Path $repo "build-web-test8b/$Configuration"
$logs=Join-Path $build 'logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
function Step([string]$name,[string]$command,[string[]]$arguments) {
    & $command @arguments *> "$logs/$name.log"
    $code=$LASTEXITCODE
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
        Step 'engine-build' cmake @('--build',"$build/engine",'--target','libirritator','test-api','test-dama','test-qss','test-simulations','test-mod-to-sim','--parallel','2')
        if($LASTEXITCODE -ne 0) { throw 'Engine build failed' }
        Step 'runner-configure' cmake @('-S',"$repo/web/engine/runner",'-B',"$build/runner",'-G','Ninja',"-DCMAKE_BUILD_TYPE=$Configuration","-DIRRITATOR_BUILD_DIR=$build/engine")
        Step 'runner-build' cmake @('--build',"$build/runner",'--parallel','2')
        if($LASTEXITCODE -ne 0) { throw 'Runner build failed' }
    }
    Step 'runner-tests' ctest @('--test-dir',"$build/runner",'--output-on-failure','--output-junit',"$logs/runner.xml")
    Step 'official-tests' ctest @('--test-dir',"$build/engine",'-R','^(test-api|test-dama|test-qss|test-simulations|test-mod-to-sim)$','--output-on-failure','--timeout','120','--output-junit',"$logs/official.xml")
    Push-Location "$repo/web"
    try {
        Step 'api-build' npm.cmd @('run','build')
        Step 'api-tests' node @('--test','--test-concurrency=1','dist/apps/api/tests/*.test.js')
        $env:IRRITATOR_8B_EVIDENCE="$logs/scientific"
        Step 'decision-8b' node @('--test','engine/runner/decision-8b-tests.mjs')
    } finally { Pop-Location }
} finally { Pop-Location }
