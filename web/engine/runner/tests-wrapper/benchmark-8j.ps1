param([ValidateSet('Release','Debug')][string]$Configuration='Release')
$ErrorActionPreference='Stop'
$repo=(Resolve-Path (Join-Path $PSScriptRoot '../../../..')).Path
$out=Join-Path $repo ('build-web-test8j/benchmarks/'+$Configuration+'-'+(Get-Date -Format 'yyyyMMdd-HHmmss-fffffff'))
& node "$repo/web/engine/runner/benchmark-8i.mjs" $out
$rows=@()
foreach($mode in @('before','after','controlled')) {
    $binary=if($mode -eq 'before'){"$repo/build-web-test8h/$Configuration/runner/irritator-runner.exe"}else{"$repo/build-web-test8j/$Configuration/runner/irritator-runner.exe"}
    foreach($n in @(2,4,6)) {
        $request=Get-Content -LiteralPath "$out/campaign-$n.json" -Raw | ConvertFrom-Json
        if($mode -eq 'controlled') {
            $wrapper=$request.model.components | Where-Object id -eq 'forecast'
            $wrapper.experiment | Add-Member -NotePropertyName execution -NotePropertyValue @{failurePolicy='isolate';maxChildRunCalls=10000;maxCampaignRunCalls=100000}
        }
        $inputText=$request | ConvertTo-Json -Depth 100 -Compress
        [IO.File]::WriteAllText("$out/$mode-$n-request.json",$inputText,[Text.UTF8Encoding]::new($false))
        foreach($repeat in @(1,2,3)) {
            $info=[Diagnostics.ProcessStartInfo]::new();$info.FileName=$binary;$info.UseShellExecute=$false;$info.CreateNoWindow=$true
            $info.StandardInputEncoding=[Text.UTF8Encoding]::new($false)
            $info.RedirectStandardInput=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
            $process=[Diagnostics.Process]::new();$process.StartInfo=$info
            $timer=[Diagnostics.Stopwatch]::StartNew();[void]$process.Start()
            $stdout=$process.StandardOutput.ReadToEndAsync();$stderr=$process.StandardError.ReadToEndAsync()
            $process.Refresh();$peak=$process.PeakWorkingSet64
            $process.StandardInput.Write($inputText);$process.StandardInput.Close()
            while(-not $process.WaitForExit(1)){$process.Refresh();$peak=[Math]::Max($peak,$process.PeakWorkingSet64)}
            $timer.Stop();$text=$stdout.GetAwaiter().GetResult();$err=$stderr.GetAwaiter().GetResult()
            [IO.File]::WriteAllText("$out/$mode-$n-$repeat.json",$text)
            if($process.ExitCode -ne 0 -or $err){throw "$mode/$n failed: $err $text"}
            $r=$text|ConvertFrom-Json
            $rows += [pscustomobject]@{configuration=$Configuration;mode=$mode;children=$n;repeat=$repeat;horizon=20;processWallMs=$timer.Elapsed.TotalMilliseconds;sampledPeakWorkingSetBytes=$(if($peak){$peak}else{$null});parentCalls=$r.simulation.runCalls;resultEvents=$r.resultEvents.Count}
            $process.Dispose()
        }
        if($mode -ne 'before') {
            & "$repo/build-web-test8j/$Configuration/runner/execution-safety-native.exe" "$out/$mode-$n-request.json" *> "$out/$mode-$n-native.log"
            if($LASTEXITCODE -ne 0){throw 'Native benchmark failed'}
        }
    }
}
$rows|ConvertTo-Json|Set-Content -LiteralPath "$out/measurements.json"
Write-Output $out
$rows|Format-Table -AutoSize
