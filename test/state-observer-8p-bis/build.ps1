param([ValidateSet('Release','Debug')][string]$Configuration='Release',[switch]$AcceptanceOnly,[switch]$CleanFirst,[switch]$SkipRunnerTests)
$ErrorActionPreference='Stop'
$repo=(Resolve-Path "$PSScriptRoot/../..").Path
$build="$repo/build-web-test8p-bis/$Configuration"
New-Item -ItemType Directory -Force $build | Out-Null
$vsRoot='D:\Mes Programmes\Microsoft Visual Studio\2026'
Import-Module "$vsRoot/Common7/Tools/Microsoft.VisualStudio.DevShell.dll"
Enter-VsDevShell -VsInstallPath $vsRoot -SkipAutomaticLocation -DevCmdArguments '-arch=x64 -host_arch=x64' | Out-Null
$env:VSLANG='1033'
function Step($name,$program,[string[]]$arguments) {
 $ErrorActionPreference='Continue'
 & $program @arguments *> "$build/$name.log"
 $code=$LASTEXITCODE
 $ErrorActionPreference='Stop'
 Write-Output "$Configuration $name exit=$code"
 if ($code -ne 0) { Get-Content "$build/$name.log" -Tail 35; throw "$name exit=$code" }
}
Step engine-configure cmake @('-S',$repo,'-B',"$build/engine",'-G','Ninja',"-DCMAKE_BUILD_TYPE=$Configuration",'-DWITH_GUI=OFF','-DWITH_NATIVE_ARCH=OFF')
if($CleanFirst) { Step engine-build cmake @('--build',"$build/engine",'--parallel','2','--clean-first') }
elseif($AcceptanceOnly) { Step engine-build cmake @('--build',"$build/engine",'--parallel','2','--target','libirritator') }
else { Step engine-build cmake @('--build',"$build/engine",'--parallel','2') }
Step proof-configure cmake @('-S',$PSScriptRoot,'-B',"$build/proof",'-G','Ninja',"-DCMAKE_BUILD_TYPE=$Configuration","-DIRRITATOR_BUILD_DIR=$build/engine")
Step proof-build cmake @('--build',"$build/proof",'--parallel','2')
Step proof-tests ctest @('--test-dir',"$build/proof",'--output-on-failure','--output-junit',"$build/proof.xml")
if($AcceptanceOnly) { return }
$node24=Get-Command node -All | Select-Object -ExpandProperty Source -Unique | Where-Object { (& $_ --version) -match '^v24\.' } | Select-Object -First 1
if(-not $node24) { throw 'Node 24 not available' }
$env:PATH=(Split-Path -Parent $node24)+';'+$env:PATH
Step runner-configure cmake @('-S',"$repo/web/engine/runner",'-B',"$build/runner",'-G','Ninja',"-DCMAKE_BUILD_TYPE=$Configuration","-DIRRITATOR_BUILD_DIR=$build/engine","-DNODE_EXECUTABLE=$node24")
Step runner-build cmake @('--build',"$build/runner",'--parallel','2')
Step historical-configure cmake @('-S',"$repo/demos/wrapper-stabilization",'-B',"$build/historical",'-G','Ninja',"-DCMAKE_BUILD_TYPE=$Configuration","-DIRRITATOR_BUILD_DIR=$build/engine")
Step historical-build cmake @('--build',"$build/historical",'--parallel','1')
Step engine-tests ctest @('--test-dir',"$build/engine",'--output-on-failure','--output-junit',"$build/engine.xml")
Step historical-tests ctest @('--test-dir',"$build/historical",'--output-on-failure','--output-junit',"$build/historical.xml")
if(-not $SkipRunnerTests) { Step runner-tests ctest @('--test-dir',"$build/runner",'--output-on-failure','--output-junit',"$build/runner.xml") }
