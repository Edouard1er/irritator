param(
    [ValidateSet('Release','Debug')][string]$Configuration='Release',
    [string]$EngineBuildDir='',
    [switch]$SkipEngineBuild,
    [int]$Parallel=2,
    [string]$RunnerBuildDir=''
)
$ErrorActionPreference='Stop'
$repo=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$suffix=$Configuration.ToLowerInvariant()
if(-not $EngineBuildDir) { $EngineBuildDir=Join-Path $repo "build-web-test4/engine-$suffix" }
if(-not [IO.Path]::IsPathRooted($EngineBuildDir)) { $EngineBuildDir=Join-Path $repo $EngineBuildDir }
$EngineBuildDir=[IO.Path]::GetFullPath($EngineBuildDir)
$runnerDir=if($Configuration -eq 'Release'){Join-Path $repo 'build-web-test4/runner'}else{Join-Path $repo 'build-web-test4/runner-debug'}
$logs=Join-Path $repo "build-web-test4/logs/build-$suffix"
if($RunnerBuildDir) {
    $runnerDir=[IO.Path]::GetFullPath($RunnerBuildDir,$repo)
    $logs=Join-Path $runnerDir 'logs'
}
New-Item -ItemType Directory -Force -Path $logs | Out-Null
function Invoke-Native([string]$Name,[string[]]$NativeArguments,[string]$Log) {
    $ErrorActionPreference='Continue'
    & $Name @NativeArguments 2>&1 | Tee-Object -FilePath $Log
    if($LASTEXITCODE -ne 0) { throw "$Name failed ($LASTEXITCODE): $Log" }
}
Push-Location -LiteralPath $repo
try {
    if(-not (Get-Command cl.exe -ErrorAction SilentlyContinue) -and $IsWindows -ne $false) {
        $vsRoot='D:\Mes Programmes\Microsoft Visual Studio\2026'
        $module=Join-Path $vsRoot 'Common7/Tools/Microsoft.VisualStudio.DevShell.dll'
        if(-not (Test-Path -LiteralPath $module)) { throw 'Use an x64 Developer PowerShell with cl.exe and Ninja available.' }
        Import-Module $module
        Enter-VsDevShell -VsInstallPath $vsRoot -SkipAutomaticLocation -DevCmdArguments '-arch=x64 -host_arch=x64'
    }
    if(-not $SkipEngineBuild) {
        Invoke-Native cmake @('-S',$repo,'-B',$EngineBuildDir,'-G','Ninja','-DWITH_GUI=OFF','-DWITH_NATIVE_ARCH=OFF',"-DCMAKE_BUILD_TYPE=$Configuration",'-DCMAKE_CXX_STANDARD=20','-DCMAKE_CXX_STANDARD_REQUIRED=ON') "$logs/engine-configure.log"
        # Required on this localized MSVC setup: stale /showIncludes dependencies
        # must not leave an archive compiled against an older public structure.
        Invoke-Native cmake @('--build',$EngineBuildDir,'--clean-first','--target','libirritator','--parallel',"$Parallel") "$logs/engine-build.log"
    }
    Invoke-Native cmake @('-S',"$PSScriptRoot/engine/runner",'-B',$runnerDir,'-G','Ninja',"-DCMAKE_BUILD_TYPE=$Configuration","-DIRRITATOR_BUILD_DIR=$EngineBuildDir") "$logs/runner-configure.log"
    Invoke-Native cmake @('--build',$runnerDir,'--clean-first','--parallel',"$Parallel") "$logs/runner-build.log"
    Invoke-Native ctest @('--test-dir',$runnerDir,'--output-on-failure','--timeout','60','--output-junit',"$logs/runner.xml") "$logs/runner-tests.log"
    Write-Host "Runner: $runnerDir"
} finally { Pop-Location }
