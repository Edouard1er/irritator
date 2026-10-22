param(
    [ValidateSet('Release','Debug')][string]$Configuration='Release',
    [int]$Parallel=2,
    [switch]$SkipBuild
)
$ErrorActionPreference='Stop'
$repo=(Resolve-Path (Join-Path $PSScriptRoot '../../../..')).Path
$baseline=Join-Path $repo "build-web-test7b/$Configuration"
$build=Join-Path $repo "build-web-test7g/$Configuration"
$runner=Join-Path $build 'runner'
$logs=Join-Path $build 'logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
function Invoke-Checked([string]$Command,[string[]]$Arguments,[string]$Log) {
    & $Command @Arguments *> $Log
    $result=$LASTEXITCODE
    Get-Content -LiteralPath $Log | Select-String 'FAILED|error C[0-9]|tests passed|Total Test|pass |fail |duration_ms|CMake Error'
    if($result -ne 0) { throw "$Command failed ($result). See $Log" }
}
Push-Location -LiteralPath $repo
try {
    $env:IRRITATOR_RUNNER=Join-Path $runner 'irritator-runner.exe'
    $env:IRRITATOR_HTTP_EVIDENCE=Join-Path $logs 'http-regression'
    $env:IRRITATOR_7F_EVIDENCE=Join-Path $logs 'http-7f'
    Remove-Item Env:WRAPPER_7F_HTTP -ErrorAction SilentlyContinue
    Remove-Item Env:WRAPPER_7G_HTTP -ErrorAction SilentlyContinue
    if(-not $SkipBuild) {
        if(-not (Get-Command cl.exe -ErrorAction SilentlyContinue)) {
            $vsRoot='D:\Mes Programmes\Microsoft Visual Studio\2026'
            Import-Module "$vsRoot/Common7/Tools/Microsoft.VisualStudio.DevShell.dll"
            Enter-VsDevShell -VsInstallPath $vsRoot -SkipAutomaticLocation -DevCmdArguments '-arch=x64 -host_arch=x64' | Out-Null
        }
        $env:VSLANG='1033'
        Invoke-Checked cmake @('--build',"$baseline/engine",'--target','libirritator','test-api','test-qss','test-simulations','test-mod-to-sim','--parallel',"$Parallel") "$logs/engine-build.log"
        Invoke-Checked cmake @('-S',"$repo/web/engine/runner",'-B',$runner,'-G','Ninja',"-DCMAKE_BUILD_TYPE=$Configuration","-DIRRITATOR_BUILD_DIR=$baseline/engine") "$logs/runner-configure.log"
        Invoke-Checked cmake @('--build',$runner,'--parallel',"$Parallel") "$logs/runner-build.log"
        Invoke-Checked cmake @('--build',"$baseline/historical",'--parallel',"$Parallel") "$logs/historical-build.log"
    }
    $env:IRRITATOR_7G_EVIDENCE=Join-Path $logs 'json-7g'
    Invoke-Checked ctest @('--test-dir',$runner,'--output-on-failure','--output-junit',"$logs/runner.xml") "$logs/runner-tests.log"
    Copy-Item -LiteralPath "$runner/Testing/Temporary/LastTest.log" -Destination "$logs/runner-detail.log"
    Invoke-Checked ctest @('--test-dir',"$baseline/engine",'-R','^(test-api|test-qss|test-simulations|test-mod-to-sim)$','--output-on-failure','--timeout','120','--output-junit',"$logs/official.xml") "$logs/official-tests.log"
    Invoke-Checked ctest @('--test-dir',"$baseline/historical",'--output-on-failure','--timeout','30','--output-junit',"$logs/historical.xml") "$logs/historical-tests.log"
    Push-Location -LiteralPath "$repo/web"
    try {
        Invoke-Checked node @('--test','--test-concurrency=1','dist/apps/api/tests/*.test.js') "$logs/backend-tests.log"
        $env:WRAPPER_7F_HTTP='1'
        Invoke-Checked node @('--test','engine/runner/wrapper-7f-tests.mjs') "$logs/http-7f.log"
        $env:WRAPPER_7G_HTTP='1'
        $env:IRRITATOR_7G_EVIDENCE=Join-Path $logs 'http-7g'
        Invoke-Checked node @('--test','engine/runner/wrapper-7g-tests.mjs') "$logs/http-7g.log"
    } finally {
        Pop-Location
        Remove-Item Env:WRAPPER_7F_HTTP,Env:WRAPPER_7G_HTTP -ErrorAction SilentlyContinue
    }
} finally { Pop-Location }

