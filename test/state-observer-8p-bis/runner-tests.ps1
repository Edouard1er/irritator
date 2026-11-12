param([ValidateSet('Release','Debug','Both')][string]$Configuration='Both')
$ErrorActionPreference='Stop'
$repo=(Resolve-Path "$PSScriptRoot/../..").Path
$node24=Get-Command node -All | Select-Object -ExpandProperty Source -Unique | Where-Object { (& $_ --version) -match '^v24\.' } | Select-Object -First 1
if(-not $node24) { throw 'Node 24 not available' }
$env:PATH=(Split-Path -Parent $node24)+';'+$env:PATH
$configs=if($Configuration -eq 'Both') {@('Release','Debug')} else {@($Configuration)}
$failed=$false
foreach($c in $configs) {
 $build="$repo/build-web-test8p-bis/$c"
 if(-not (Test-Path "$build/runner/CTestTestfile.cmake")) { throw "Runner not built: $c" }
 $ErrorActionPreference='Continue'
 & ctest --test-dir "$build/runner" --output-on-failure --output-junit "$build/runner.xml" *> "$build/runner-tests.log"
 $code=$LASTEXITCODE
 $ErrorActionPreference='Stop'
 Write-Output "$c runner-tests exit=$code"
 Set-Content "$build/runner-exit-code.txt" -Value $code
 if($code -ne 0) { $failed=$true; Get-Content "$build/runner-tests.log" -Tail 45 }
}
if($failed) { exit 1 }
