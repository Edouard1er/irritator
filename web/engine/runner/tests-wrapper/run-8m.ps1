param(
    [ValidateSet('Release','Debug')][string]$Configuration='Release',
    [Alias('TestOnly')][switch]$TestsOnly,
    [switch]$BuildOnly,
    [switch]$NativeOnly
)
$ErrorActionPreference='Stop'
# Honour web/package.json even when a newer system Node precedes Node 24.
$selectionNodePath=$null
foreach($candidate in @(Get-Command node -All | Select-Object -ExpandProperty Source -Unique)) {
    if ((& $candidate --version) -match '^v24\.') { $selectionNodePath=$candidate; break }
}
if (-not $selectionNodePath) { throw 'Node 24 is required by web/package.json; put its directory on PATH.' }
$env:PATH=(Split-Path -Parent $selectionNodePath)+';'+$env:PATH
Write-Output "Test runtime: $selectionNodePath $(& $selectionNodePath --version)"
if ($NativeOnly -and $TestsOnly) { throw 'NativeOnly and TestsOnly are mutually exclusive' }
if ($NativeOnly) { $BuildOnly=$true }
if ($TestsOnly -and $BuildOnly) { throw 'TestsOnly and BuildOnly are mutually exclusive' }
$repo=(Resolve-Path (Join-Path $PSScriptRoot '../../../..')).Path
$build=Join-Path $repo "build-web-test8m/$Configuration"
$engine=Join-Path $repo "build-web-test8m/$Configuration/engine"
$historical=Join-Path $repo "build-web-test8m/$Configuration/historical"
$logsRoot=Join-Path $build 'logs'
$priorResultsPath=$null
if (Test-Path -LiteralPath "$logsRoot/latest-run.txt") {
    $priorRun=(Get-Content -LiteralPath "$logsRoot/latest-run.txt" -Raw).Trim()
    $priorResultsPath=Join-Path $priorRun 'exit-codes.json'
}
# Each invocation owns new logs, evidence and JUnit files. A retry never
# overwrites the initial failure, including JSON produced by HTTP suites.
$runId='run-'+(Get-Date -Format 'yyyyMMdd-HHmmss-fffffff')+'-'+$PID
$logs=Join-Path $logsRoot $runId
New-Item -ItemType Directory -Force -Path $logs | Out-Null
Set-Content -LiteralPath "$logsRoot/latest-run.txt" -Value $logs
$results=@{}
if ($TestsOnly -and $priorResultsPath -and (Test-Path -LiteralPath $priorResultsPath)) {
    $priorResults=Get-Content -LiteralPath $priorResultsPath -Raw | ConvertFrom-Json
    foreach ($entry in $priorResults.PSObject.Properties) { $results[$entry.Name]=$entry.Value }
}
function Step([string]$name,[string]$command,[string[]]$arguments) {
    $previous=$ErrorActionPreference
    $ErrorActionPreference='Continue'
    $code=1
    try {
        & $command @arguments *> "$logs/$name.log"
        $code=$LASTEXITCODE
    } finally {
        $ErrorActionPreference=$previous
    }
    $results[$name]=$code
    $results | ConvertTo-Json | Set-Content -LiteralPath "$logs/exit-codes.json"
    Write-Output "$name exit=$code"
    if ($code -ne 0) { Get-Content -LiteralPath "$logs/$name.log" -Tail 15 }
}
function RequireSuccess([string]$name) {
    if ($results[$name] -ne 0) { throw "$name failed; see $logs/$name.log" }
}
Write-Output "Evidence: $logs"
Push-Location $repo
try {
    $env:IRRITATOR_RUNNER="$build/runner/irritator-runner.exe"
    if (-not $TestsOnly) {
        $vsRoot='D:\Mes Programmes\Microsoft Visual Studio\2026'
        Import-Module "$vsRoot/Common7/Tools/Microsoft.VisualStudio.DevShell.dll"
        Enter-VsDevShell -VsInstallPath $vsRoot -SkipAutomaticLocation -DevCmdArguments '-arch=x64 -host_arch=x64' | Out-Null
        $env:VSLANG='1033'
        Step 'engine-configure' cmake @('-S',$repo,'-B',"$engine",'-G','Ninja',"-DCMAKE_BUILD_TYPE=$Configuration",'-DWITH_GUI=OFF','-DWITH_NATIVE_ARCH=OFF')
        RequireSuccess 'engine-configure'
        # Keep compilation serial: simultaneous 8H Release/Debug jobs exhausted
        # the host paging file and MSVC heap (C1060). Timeouts are unchanged.
        $engineTargets=@('libirritator')
        if (-not $NativeOnly) {
            $engineTargets+=@('test-api','test-container','test-dama','test-dot-parser','test-mod-to-sim','test-qss','test-request-buffer','test-shared-buffer','test-simulations','test-task-manager')
        }
        Step 'engine-build' cmake (@('--build',"$engine",'--target')+$engineTargets+@('--parallel','1'))
        RequireSuccess 'engine-build'
        Step 'runner-configure' cmake @('-S',"$repo/web/engine/runner",'-B',"$build/runner",'-G','Ninja',"-DCMAKE_BUILD_TYPE=$Configuration","-DIRRITATOR_BUILD_DIR=$engine","-DNODE_EXECUTABLE=$selectionNodePath")
        RequireSuccess 'runner-configure'
        $runnerArguments=@('--build',"$build/runner")
        if ($NativeOnly) { $runnerArguments+=@('--target','irritator-runner','execution-safety-native','dynamic-plan-native','structural-native','model-selection-native','forecast-native') }
        Step 'runner-build' cmake ($runnerArguments+@('--parallel','1'))
        RequireSuccess 'runner-build'
        if (-not $NativeOnly) {
            Step 'historical-configure' cmake @('-S',"$repo/demos/wrapper-stabilization",'-B',"$historical",'-G','Ninja',"-DCMAKE_BUILD_TYPE=$Configuration","-DIRRITATOR_BUILD_DIR=$engine")
            RequireSuccess 'historical-configure'
            Step 'historical-build' cmake @('--build',"$historical",'--parallel','1')
            RequireSuccess 'historical-build'
        }
    }
    if (-not $BuildOnly) {
        # CTest caches find_program(NODE_EXECUTABLE); PATH alone cannot replace
        # a newer Node used by an earlier configure, including with TestsOnly.
        Step 'runner-runtime-configure' cmake @('-S',"$repo/web/engine/runner",'-B',"$build/runner","-DNODE_EXECUTABLE=$selectionNodePath")
        RequireSuccess 'runner-runtime-configure'
        Step 'runner-tests' ctest @('--test-dir',"$build/runner",'--output-on-failure','--output-junit',"$logs/runner.xml")
        Step 'native-events' "$build/runner/schaefer-feedback-native.exe" @("$repo/web/examples/decision-feedback-schaefer-v3.json")
        Step 'native-composition' "$build/runner/schaefer-feedback-native.exe" @("$repo/web/examples/tstar-schaefer-three-coupled-v3.json")
        Step 'native-uncertainty' "$build/runner/grouped-feedback-native.exe" @("$repo/web/examples/tstar-schaefer-uncertainty-v3.json")
        Step 'native-dynamic-minimal' "$build/runner/dynamic-plan-native.exe" @("$repo/web/examples/decision-dynamic-plan-minimal-v3.json")
        Step 'native-dynamic-schaefer' "$build/runner/dynamic-plan-native.exe" @("$repo/web/examples/tstar-schaefer-dynamic-plan-v3.json")
        Step 'native-dynamic-single' "$build/runner/dynamic-plan-native.exe" @("$repo/web/examples/tstar-schaefer-dynamic-plan-single-v3.json")
        foreach ($variant in @('','-single','-context')) {
            Step "native-8i$variant" "$build/runner/dynamic-uncertainty-native.exe" @("$repo/web/examples/tstar-schaefer-dynamic-uncertainty$variant-v3.json")
        }
        Step 'native-8j' "$build/runner/execution-safety-native.exe" @("$repo/web/examples/decision-fault-tolerant-minimal-v3.json")
        Step 'official-tests' ctest @('--test-dir',"$engine",'-R','^test-','--output-on-failure','--timeout','120','--output-junit',"$logs/official.xml")
        Step 'historical-tests' ctest @('--test-dir',"$historical",'--output-on-failure','--output-junit',"$logs/historical.xml")
        Push-Location "$repo/web"
        try {
            Step 'api-build' $selectionNodePath @('node_modules/typescript/bin/tsc','-p','apps/api/tsconfig.json')
            Step 'api-tests' node @('--test','--test-concurrency=1','dist/apps/api/tests/*.test.js')
            $env:IRRITATOR_DIAGNOSTICS_EVIDENCE="$logs/diagnostics"
            foreach ($suffix in @('B','C','D','E','F','G','H','I','J')) {
                $lower=$suffix.ToLowerInvariant()
                Set-Item -LiteralPath "Env:DECISION_8${suffix}_HTTP" -Value '1'
                Set-Item -LiteralPath "Env:IRRITATOR_8${suffix}_EVIDENCE" -Value "$logs/http-8$lower"
                try {
                    Step "http-8$lower" node @('--test',"engine/runner/decision-8$lower-tests.mjs")
                } finally {
                    Remove-Item -LiteralPath "Env:DECISION_8${suffix}_HTTP"
                    Remove-Item -LiteralPath "Env:IRRITATOR_8${suffix}_EVIDENCE"
                }
            }
            $env:STRUCTURAL_HTTP='1'
        $env:IRRITATOR_8K_EVIDENCE="$logs/http-8k"
        try { Step 'http-8k' node @('--test','engine/runner/structural-tests.mjs') } finally { Remove-Item Env:STRUCTURAL_HTTP; Remove-Item Env:IRRITATOR_8K_EVIDENCE }
        $env:DECISION_8L_HTTP='1'
        $env:IRRITATOR_8L_EVIDENCE="$logs/http-8l"
        try { Step 'http-8l' node @('--test','engine/runner/decision-8l-tests.mjs') } finally { Remove-Item Env:DECISION_8L_HTTP; Remove-Item Env:IRRITATOR_8L_EVIDENCE }
        $env:DECISION_8M_HTTP='1'
        $env:IRRITATOR_8M_EVIDENCE="$logs/http-8m"
        try { Step 'http-8m' node @('--test','engine/runner/decision-8m-tests.mjs') } finally { Remove-Item Env:DECISION_8M_HTTP; Remove-Item Env:IRRITATOR_8M_EVIDENCE }
        Step 'diagnostic-streams' node @('--test','engine/runner/diagnostics-tests.mjs')
        } finally { Pop-Location }
    }
} finally { Pop-Location }
if (@($results.Values | Where-Object { $_ -ne 0 }).Count -gt 0) { exit 1 }


