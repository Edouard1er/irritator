param(
    [ValidateSet('Release','Debug')][string]$Configuration='Release',
    [switch]$TestsOnly,
    [switch]$BuildOnly
)
$ErrorActionPreference='Stop'
if ($TestsOnly -and $BuildOnly) { throw 'TestsOnly and BuildOnly are mutually exclusive' }
$repo=(Resolve-Path (Join-Path $PSScriptRoot '../../../..')).Path
# No production source changed in 8I: reuse the matching audited 8H build.
$build=Join-Path $repo "build-web-test8h/$Configuration"
$logs=Join-Path $repo ('build-web-test8i/'+$Configuration+'/logs/run-'+(Get-Date -Format 'yyyyMMdd-HHmmss-fffffff')+'-'+$PID)
New-Item -ItemType Directory -Force -Path $logs | Out-Null
Set-Content -LiteralPath (Join-Path (Split-Path $logs) 'latest-run.txt') -Value $logs
$results=@{}
function Step([string]$name,[string]$command,[string[]]$arguments) {
    $prior=$ErrorActionPreference; $ErrorActionPreference='Continue'
    try { & $command @arguments *> "$logs/$name.log"; $code=$LASTEXITCODE }
    finally { $ErrorActionPreference=$prior }
    $results[$name]=$code; $results | ConvertTo-Json | Set-Content -LiteralPath "$logs/exit-codes.json"
    Write-Output "$name exit=$code"
    if ($code -ne 0) { Get-Content -LiteralPath "$logs/$name.log" -Tail 12 }
}
Push-Location $repo
try {
    Write-Output "Evidence: $logs"
    if (-not $TestsOnly) {
        Step 'native-build' pwsh @('-NoProfile','-File',"$PSScriptRoot/run-8h.ps1",'-Configuration',$Configuration,'-BuildOnly')
        if ($results['native-build'] -ne 0) { throw 'Native build failed' }
    }
    $env:IRRITATOR_RUNNER="$build/runner/irritator-runner.exe"
    if (-not $BuildOnly) {
        Step 'runner-tests' ctest @('--test-dir',"$build/runner",'--output-on-failure','--output-junit',"$logs/runner.xml")
        foreach ($variant in @('','-single','-context')) {
            Step "native-8i$variant" "$build/runner/dynamic-uncertainty-native.exe" @("$repo/web/examples/tstar-schaefer-dynamic-uncertainty$variant-v3.json")
        }
        Step 'official-tests' ctest @('--test-dir',"$build/engine",'-R','^test-','--output-on-failure','--timeout','120','--output-junit',"$logs/official.xml")
        Step 'historical-tests' ctest @('--test-dir',"$build/historical",'--output-on-failure','--output-junit',"$logs/historical.xml")
        Push-Location "$repo/web"
        try {
            Step 'api-build' npm.cmd @('run','build')
            Step 'api-tests' node @('--test','--test-concurrency=1','dist/apps/api/tests/*.test.js')
            foreach ($suffix in @('B','C','D','E','F','G','H','I')) {
                $lower=$suffix.ToLowerInvariant()
                Set-Item -LiteralPath "Env:DECISION_8${suffix}_HTTP" -Value '1'
                Set-Item -LiteralPath "Env:IRRITATOR_8${suffix}_EVIDENCE" -Value "$logs/http-8$lower"
                try { Step "http-8$lower" node @('--test',"engine/runner/decision-8$lower-tests.mjs") }
                finally { Remove-Item -LiteralPath "Env:DECISION_8${suffix}_HTTP"; Remove-Item -LiteralPath "Env:IRRITATOR_8${suffix}_EVIDENCE" }
            }
            $env:IRRITATOR_DIAGNOSTICS_EVIDENCE="$logs/diagnostics"
            Step 'diagnostics' node @('--test','engine/runner/diagnostics-tests.mjs')
        } finally { Pop-Location }
    }
} finally { Pop-Location }
if (@($results.Values | Where-Object { $_ -ne 0 }).Count) { exit 1 }
