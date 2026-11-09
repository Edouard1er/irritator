param([ValidateSet('Release','Debug')][string]$Configuration='Release')
$ErrorActionPreference='Stop'
$repo=(Resolve-Path (Join-Path $PSScriptRoot '../../../..')).Path
$out=Join-Path $repo ('build-web-test8i/benchmarks/'+$Configuration+'-'+(Get-Date -Format 'yyyyMMdd-HHmmss-fffffff'))
& node "$repo/web/engine/runner/benchmark-8i.mjs" $out
$rows=@()
foreach ($n in @(2,4,6)) {
    foreach ($repeat in @(1,2,3)) {
        $info=[Diagnostics.ProcessStartInfo]::new()
        $info.FileName="$repo/build-web-test8h/$Configuration/runner/irritator-runner.exe"
        $info.UseShellExecute=$false; $info.CreateNoWindow=$true
        $info.StandardInputEncoding=[Text.UTF8Encoding]::new($false)
        $info.RedirectStandardInput=$true; $info.RedirectStandardOutput=$true; $info.RedirectStandardError=$true
        $process=[Diagnostics.Process]::new(); $process.StartInfo=$info
        $timer=[Diagnostics.Stopwatch]::StartNew(); [void]$process.Start()
        $stdout=$process.StandardOutput.ReadToEndAsync(); $stderr=$process.StandardError.ReadToEndAsync()
        $process.Refresh(); $peak=$process.PeakWorkingSet64
        $process.StandardInput.Write([IO.File]::ReadAllText("$out/campaign-$n.json"))
        $process.Refresh(); $peak=[Math]::Max($peak,$process.PeakWorkingSet64); $process.StandardInput.Close()
        while (-not $process.WaitForExit(1)) { $process.Refresh(); $peak=[Math]::Max($peak,$process.PeakWorkingSet64) }
        $timer.Stop(); $text=$stdout.GetAwaiter().GetResult(); $err=$stderr.GetAwaiter().GetResult()
        [IO.File]::WriteAllText("$out/result-$n-$repeat.json",$text)
        if ($process.ExitCode -ne 0 -or $err) { throw "Benchmark $n failed: $err $text" }
        $result=$text | ConvertFrom-Json
        $close=@($result.resultEvents | Where-Object port -eq 13)
        if ($close.Count -ne 1 -or $close[0].value[1] -ne $n) { throw 'Actual scenario count differs' }
        $rows += [pscustomobject]@{configuration=$Configuration;children=$n;repeat=$repeat;horizon=20;wallMs=$timer.Elapsed.TotalMilliseconds;sampledPeakWorkingSetBytes=$(if($peak){$peak}else{$null});parentCalls=$result.simulation.runCalls;resultEvents=$result.resultEvents.Count;points=(@($result.observations | ForEach-Object {$_.samples.Count}) | Measure-Object -Sum).Sum}
        $process.Dispose()
    }
}
$rows | ConvertTo-Json | Set-Content -LiteralPath "$out/measurements.json"
Write-Output $out
$rows | Format-Table -AutoSize
