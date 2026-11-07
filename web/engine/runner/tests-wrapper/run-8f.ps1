param([ValidateSet('Release','Debug')][string]$Configuration='Release', [switch]$TestsOnly, [switch]$BuildOnly)
$ErrorActionPreference='Stop'
$repo=(Resolve-Path (Join-Path $PSScriptRoot '../../../..')).Path
$build=Join-Path $repo "build-web-test8f/$Configuration"
$logs=Join-Path $build 'logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$results=@{}
if ($TestsOnly -and (Test-Path "$logs/exit-codes.json")) {
    $priorResults=Get-Content "$logs/exit-codes.json" -Raw | ConvertFrom-Json
    foreach ($entry in $priorResults.PSObject.Properties) { $results[$entry.Name]=$entry.Value }
}
function Step([string]$name,[string]$command,[string[]]$arguments) {
    $previous=$ErrorActionPreference; $ErrorActionPreference='Continue'
    try { & $command @arguments *> "$logs/$name.log"; $code=$LASTEXITCODE }
    finally { $ErrorActionPreference=$previous }
    $results[$name]=$code; $results | ConvertTo-Json | Set-Content "$logs/exit-codes.json"
    Write-Output "$name exit=$code"
    if($code -ne 0) { Get-Content "$logs/$name.log" -Tail 15 }
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
        Step 'engine-build' cmake @('--build',"$build/engine",'--clean-first','--target','libirritator','test-api','test-container','test-dama','test-dot-parser','test-mod-to-sim','test-qss','test-request-buffer','test-shared-buffer','test-simulations','test-task-manager','--parallel','1')
        if($results['engine-build'] -ne 0) { throw 'Engine build failed' }
        Step 'runner-configure' cmake @('-S',"$repo/web/engine/runner",'-B',"$build/runner",'-G','Ninja',"-DCMAKE_BUILD_TYPE=$Configuration","-DIRRITATOR_BUILD_DIR=$build/engine")
        Step 'runner-build' cmake @('--build',"$build/runner",'--clean-first','--parallel','1')
        if($results['runner-build'] -ne 0) { throw 'Runner build failed' }
        Step 'historical-configure' cmake @('-S',"$repo/demos/wrapper-stabilization",'-B',"$build/historical",'-G','Ninja',"-DCMAKE_BUILD_TYPE=$Configuration","-DIRRITATOR_BUILD_DIR=$build/engine")
        Step 'historical-build' cmake @('--build',"$build/historical",'--clean-first','--parallel','1')
        if($results['historical-build'] -ne 0) { throw 'Historical build failed' }
    }
    if($BuildOnly) { return }
    Step 'runner-tests' ctest @('--test-dir',"$build/runner",'--output-on-failure','--output-junit',"$logs/runner.xml")
    Step 'native-events' "$build/runner/schaefer-feedback-native.exe" @("$repo/web/examples/decision-feedback-schaefer-v3.json")
    Step 'native-composition' "$build/runner/schaefer-feedback-native.exe" @("$repo/web/examples/tstar-schaefer-three-coupled-v3.json")
    Step 'official-tests' ctest @('--test-dir',"$build/engine",'-R','^test-','--output-on-failure','--timeout','120','--output-junit',"$logs/official.xml")
    Step 'historical-tests' ctest @('--test-dir',"$build/historical",'--output-on-failure','--output-junit',"$logs/historical.xml")
    Push-Location "$repo/web"
    try {
        Step 'api-build' npm.cmd @('run','build')
        Step 'api-tests' node @('--test','--test-concurrency=1','dist/apps/api/tests/*.test.js')
        $env:DECISION_8B_HTTP='1'; $env:IRRITATOR_8B_EVIDENCE="$logs/http-8b"
        Step 'http-8b' node @('--test','engine/runner/decision-8b-tests.mjs')
        Remove-Item Env:DECISION_8B_HTTP
        $env:DECISION_8C_HTTP='1'; $env:IRRITATOR_8C_EVIDENCE="$logs/http-8c"
        Step 'http-8c' node @('--test','engine/runner/decision-8c-tests.mjs')
        Remove-Item Env:DECISION_8C_HTTP
        $env:IRRITATOR_DIAGNOSTICS_EVIDENCE="$logs/diagnostics"
        $env:DECISION_8D_HTTP='1'; $env:IRRITATOR_8D_EVIDENCE="$logs/http-8d"
        Step 'http-8d' node @('--test','engine/runner/decision-8d-tests.mjs')
        Remove-Item Env:DECISION_8D_HTTP
        $env:DECISION_8E_HTTP='1'; $env:IRRITATOR_8E_EVIDENCE="$logs/http-8e"
        Step 'http-8e' node @('--test','engine/runner/decision-8e-tests.mjs')
        Remove-Item Env:DECISION_8E_HTTP
        $env:DECISION_8F_HTTP='1'; $env:IRRITATOR_8F_EVIDENCE="$logs/http-8f"
        Step 'http-8f' node @('--test','engine/runner/decision-8f-tests.mjs')
        Remove-Item Env:DECISION_8F_HTTP
        Step 'diagnostic-streams' node @('--test','engine/runner/diagnostics-tests.mjs')
    } finally { Pop-Location }
} finally { Pop-Location }
if (@($results.Values | Where-Object { $_ -ne 0 }).Count -gt 0) { exit 1 }



