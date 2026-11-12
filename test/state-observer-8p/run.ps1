param([ValidateSet('Release','Debug')][string]$Configuration='Release', [switch]$BuildOnly, [switch]$FixtureBefore)
$ErrorActionPreference='Stop'
$repo=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$build=Join-Path $repo "build-web-test8p/$Configuration"
New-Item -ItemType Directory -Force $build | Out-Null
$codes=@{}
function Step([string]$name,[string]$program,[string[]]$arguments) {
    & $program @arguments *> (Join-Path $build "$name.log")
    $codes[$name]=$LASTEXITCODE
    $codes | ConvertTo-Json | Set-Content (Join-Path $build 'exit-codes.json')
    Write-Output "$Configuration $name exit=$LASTEXITCODE"
    if ($LASTEXITCODE -ne 0) { Get-Content (Join-Path $build "$name.log") -Tail 14 }
    if ($LASTEXITCODE -ne 0 -and $name -match '(configure|build)$') { throw "$name failed; no stale executable will be tested" }
}
$vsRoot='D:\Mes Programmes\Microsoft Visual Studio\2026'
Import-Module "$vsRoot/Common7/Tools/Microsoft.VisualStudio.DevShell.dll"
Enter-VsDevShell -VsInstallPath $vsRoot -SkipAutomaticLocation -DevCmdArguments '-arch=x64 -host_arch=x64' | Out-Null
$env:VSLANG='1033'
$node24=Get-Command node -All | Select-Object -ExpandProperty Source -Unique | Where-Object { (& $_ --version) -match '^v24\.' } | Select-Object -First 1
if (-not $node24) { throw 'Node 24 not available' }
$env:PATH=(Split-Path -Parent $node24)+';'+$env:PATH
Push-Location $repo
try {
    Step 'engine-configure' cmake @('-S',$repo,'-B',"$build/engine",'-G','Ninja',"-DCMAKE_BUILD_TYPE=$Configuration",'-DWITH_GUI=OFF','-DWITH_NATIVE_ARCH=OFF')
    Step 'engine-build' cmake @('--build',"$build/engine",'--parallel','2')
    Step 'runner-configure' cmake @('-S',"$repo/web/engine/runner",'-B',"$build/runner",'-G','Ninja',"-DCMAKE_BUILD_TYPE=$Configuration","-DIRRITATOR_BUILD_DIR=$build/engine","-DNODE_EXECUTABLE=$node24")
    Step 'runner-build' cmake @('--build',"$build/runner",'--parallel','2')
    Step 'historical-configure' cmake @('-S',"$repo/demos/wrapper-stabilization",'-B',"$build/historical",'-G','Ninja',"-DCMAKE_BUILD_TYPE=$Configuration","-DIRRITATOR_BUILD_DIR=$build/engine")
    Step 'historical-build' cmake @('--build',"$build/historical",'--parallel','1')
    Step 'proof-configure' cmake @('-S',$PSScriptRoot,'-B',"$build/proof",'-G','Ninja',"-DCMAKE_BUILD_TYPE=$Configuration","-DIRRITATOR_BUILD_DIR=$build/engine")
    Step 'proof-build' cmake @('--build',"$build/proof",'--parallel','2')
    if ($BuildOnly) { return }
    $fixture=Join-Path $repo 'web/model-test/modelhalieutiquetest-points.csv'
    if ($FixtureBefore) {
        if (Test-Path -LiteralPath $fixture) { throw 'FixtureBefore requires the original missing fixture; refusing to remove any user file' }
        Step 'fixture-before' ctest @('--test-dir',"$build/runner",'-R','^(runner-wrapper-7g|native-wrapper-schaefer-trajectories|native-wrapper-schaefer-pair)$','--output-on-failure','--output-junit',"$build/fixture-before.xml")
    }
    if (-not (Test-Path -LiteralPath $fixture)) {
        $source='C:\Users\cedouard\Downloads\modelhalieutiquetest-points.csv'
        $expected='E694ACC2D26EFB44811DD0CFD30D1FC634E1470775E2A6C4B73EC2C8119DE51C'
        if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne $expected) { throw 'Fixture SHA256 mismatch' }
        New-Item -ItemType Directory -Force (Split-Path -Parent $fixture) | Out-Null
        Copy-Item -LiteralPath $source -Destination $fixture
    }
    if ((Get-FileHash -LiteralPath $fixture -Algorithm SHA256).Hash -ne 'E694ACC2D26EFB44811DD0CFD30D1FC634E1470775E2A6C4B73EC2C8119DE51C') {
        throw 'Existing fixture SHA256 mismatch; refusing to overwrite it'
    }
    Step 'fixture-after' ctest @('--test-dir',"$build/runner",'-R','^(runner-wrapper-7g|native-wrapper-schaefer-trajectories|native-wrapper-schaefer-pair)$','--output-on-failure','--output-junit',"$build/fixture-after.xml")
    Step 'proof-tests' ctest @('--test-dir',"$build/proof",'--output-on-failure','--output-junit',"$build/proof.xml")
    Step 'runner-tests' ctest @('--test-dir',"$build/runner",'--output-on-failure','--output-junit',"$build/runner.xml")
    Step 'engine-tests' ctest @('--test-dir',"$build/engine",'--output-on-failure','--output-junit',"$build/engine.xml")
    Step 'historical-tests' ctest @('--test-dir',"$build/historical",'--output-on-failure','--output-junit',"$build/historical.xml")
} finally { Pop-Location }
if (@($codes.Values | Where-Object { $_ -ne 0 }).Count -gt 0) { exit 1 }
