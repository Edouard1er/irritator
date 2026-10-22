param(
    [ValidateSet('Release','Debug')][string]$Configuration='Release',
    [int]$Parallel=2,
    [switch]$SkipBuild
)
$ErrorActionPreference='Stop'
$repo=(Resolve-Path (Join-Path $PSScriptRoot '../../../..')).Path
$baseline=Join-Path $repo "build-web-test7b/$Configuration"
$build=Join-Path $repo "build-web-test7c/$Configuration"
$runner=Join-Path $build 'runner'
$logs=Join-Path $build 'logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
function Invoke-Logged([string]$Command,[string[]]$Arguments,[string]$Log) {
    $ErrorActionPreference='Continue'
    & $Command @Arguments *> $Log
    $code=$LASTEXITCODE
    Get-Content -LiteralPath $Log | Select-String ': error |FAILED|Linking|Building|tests passed|Test #|Total Test|CMake Error'
    if($code -ne 0) { throw "$Command failed with code $code. See $Log" }
}
Push-Location -LiteralPath $repo
try {
    if(-not $SkipBuild) {
        if(-not (Get-Command cl.exe -ErrorAction SilentlyContinue)) {
            $vsRoot='D:\Mes Programmes\Microsoft Visual Studio\2026'
            Import-Module "$vsRoot/Common7/Tools/Microsoft.VisualStudio.DevShell.dll"
            Enter-VsDevShell -VsInstallPath $vsRoot -SkipAutomaticLocation -DevCmdArguments '-arch=x64 -host_arch=x64' | Out-Null
        }
        $env:VSLANG='1033'
        # The unchanged core and historical sources reuse the matching 7B
        # configuration. Build them incrementally to check that they are current.
        Invoke-Logged cmake @('--build',"$baseline/engine",'--target','libirritator','test-api','test-qss','test-simulations','test-mod-to-sim','--parallel',"$Parallel") "$logs/engine-build.log"
        Invoke-Logged cmake @('-S',"$repo/web/engine/runner",'-B',$runner,'-G','Ninja',"-DCMAKE_BUILD_TYPE=$Configuration","-DIRRITATOR_BUILD_DIR=$baseline/engine") "$logs/runner-configure.log"
        Invoke-Logged cmake @('--build',$runner,'--clean-first','--parallel',"$Parallel") "$logs/runner-build.log"
        Invoke-Logged cmake @('--build',"$baseline/historical",'--parallel',"$Parallel") "$logs/historical-build.log"
    }
    Invoke-Logged ctest @('--test-dir',$runner,'--output-on-failure','--output-junit',"$logs/runner.xml") "$logs/runner-tests.log"
    Copy-Item -LiteralPath "$runner/Testing/Temporary/LastTest.log" -Destination "$logs/runner-detail.log"
    Invoke-Logged ctest @('--test-dir',"$baseline/engine",'-R','^(test-api|test-qss|test-simulations|test-mod-to-sim)$','--output-on-failure','--timeout','120','--output-junit',"$logs/official.xml") "$logs/official-tests.log"
    Copy-Item -LiteralPath "$baseline/engine/Testing/Temporary/LastTest.log" -Destination "$logs/official-detail.log"
    Invoke-Logged ctest @('--test-dir',"$baseline/historical",'--output-on-failure','--timeout','30','--output-junit',"$logs/historical.xml") "$logs/historical-tests.log"
    Copy-Item -LiteralPath "$baseline/historical/Testing/Temporary/LastTest.log" -Destination "$logs/historical-detail.log"
} finally { Pop-Location }
