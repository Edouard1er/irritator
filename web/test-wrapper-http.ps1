param(
    [ValidateSet('Release','Debug')][string]$Configuration='Release',
    [int]$Parallel=2,
    [switch]$SkipBuild
)
$ErrorActionPreference='Stop'
$repo=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$baseline=Join-Path $repo "build-web-test7b/$Configuration"
$build=Join-Path $repo "build-web-test7d/$Configuration"
$logs=Join-Path $build 'logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
function Invoke-Logged([string]$Command,[string[]]$Arguments,[string]$Log) {
    $ErrorActionPreference='Continue'
    & $Command @Arguments *> $Log
    $code=$LASTEXITCODE
    Get-Content -LiteralPath $Log | Select-String ': error |FAILED|Linking|Building|tests passed|Test #|Total Test|CMake Error|tests |pass |fail '
    if($code -ne 0) { throw "$Command failed with code $code. See $Log" }
}
$previousRunner=$env:IRRITATOR_RUNNER
$previousEvidence=$env:IRRITATOR_HTTP_EVIDENCE
$previousLegacy=$env:IRRITATOR_LEGACY_RUNNER
Push-Location -LiteralPath $repo
try {
    if(-not $SkipBuild) {
        if(-not (Get-Command cl.exe -ErrorAction SilentlyContinue)) {
            $vsRoot='D:\Mes Programmes\Microsoft Visual Studio\2026'
            Import-Module "$vsRoot/Common7/Tools/Microsoft.VisualStudio.DevShell.dll"
            Enter-VsDevShell -VsInstallPath $vsRoot -SkipAutomaticLocation -DevCmdArguments '-arch=x64 -host_arch=x64' | Out-Null
        }
        $env:VSLANG='1033'
        # These unchanged engine/historical builds must first exist (7B run.ps1).
        Invoke-Logged cmake @('--build',"$baseline/engine",'--target','libirritator','test-api','test-qss','test-simulations','test-mod-to-sim','--parallel',"$Parallel") "$logs/engine-build.log"
        Invoke-Logged cmake @('-S',"$repo/web/engine/runner",'-B',"$build/runner",'-G','Ninja',"-DCMAKE_BUILD_TYPE=$Configuration","-DIRRITATOR_BUILD_DIR=$baseline/engine") "$logs/runner-configure.log"
        Invoke-Logged cmake @('--build',"$build/runner",'--clean-first','--parallel',"$Parallel") "$logs/runner-build.log"
        Invoke-Logged cmake @('--build',"$baseline/historical",'--parallel',"$Parallel") "$logs/historical-build.log"
    }
    $env:IRRITATOR_RUNNER=Join-Path $build 'runner/irritator-runner.exe'
    $env:IRRITATOR_HTTP_EVIDENCE=$logs
    if(-not $env:IRRITATOR_LEGACY_RUNNER) {
        $legacyDirectory=if($Configuration -eq 'Debug') {'runner-debug'} else {'runner'}
        $env:IRRITATOR_LEGACY_RUNNER=Join-Path $repo "build-web-test6-1/$legacyDirectory/irritator-runner.exe"
    }
    Invoke-Logged ctest @('--test-dir',"$build/runner",'--output-on-failure','--output-junit',"$logs/runner.xml") "$logs/runner-tests.log"
    Copy-Item -LiteralPath "$build/runner/Testing/Temporary/LastTest.log" -Destination "$logs/runner-detail.log"
    Invoke-Logged ctest @('--test-dir',"$baseline/engine",'-R','^(test-api|test-qss|test-simulations|test-mod-to-sim)$','--output-on-failure','--timeout','120','--output-junit',"$logs/official.xml") "$logs/official-tests.log"
    Invoke-Logged ctest @('--test-dir',"$baseline/historical",'--output-on-failure','--timeout','30','--output-junit',"$logs/historical.xml") "$logs/historical-tests.log"
    Push-Location -LiteralPath $PSScriptRoot
    try {
        # Avoid overlapping tsc builds; CTest already built the shared contracts.
        Invoke-Logged node @('--test','dist/apps/api/tests/backend.test.js','dist/apps/api/tests/process.test.js') "$logs/backend-tests.log"
        Invoke-Logged node @('--test','dist/apps/api/tests/integration.test.js','dist/apps/api/tests/hierarchy.test.js','dist/apps/api/tests/qss-catalog.test.js') "$logs/legacy-http-tests.log"
        Invoke-Logged node @('--test','dist/apps/api/tests/wrapper-http.test.js') "$logs/http-tests.log"
    } finally { Pop-Location }
} finally {
    Pop-Location
    $env:IRRITATOR_RUNNER=$previousRunner
    $env:IRRITATOR_HTTP_EVIDENCE=$previousEvidence
    $env:IRRITATOR_LEGACY_RUNNER=$previousLegacy
}
