#requires -Version 7.2
[CmdletBinding()]
param(
    [string]$EtienneRepo,
    [string]$NodePath,
    [string]$PythonPath,
    [string]$RunnerPath,
    [string]$LocalUseProof,
    [string]$AcquiredAt,
    [switch]$Synthetic,
    [switch]$Background,
    [switch]$NoBrowser,
    [switch]$Stop
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$web = Join-Path $repo 'web'
$front = Join-Path $web 'apps/frontend'
$local = Join-Path $repo 'local-sig-guiers'
$runtime = Join-Path $local 'runtime'
$activeFile = Join-Path $runtime 'active.pid'
$apiBuild = Join-Path $web 'build-guiers-api'
$supervisor = Join-Path $PSScriptRoot 'guiers/local-servers.mjs'

function Invoke-Checked([string]$Exe, [string[]]$Arguments) {
    & $Exe @Arguments
    if ($LASTEXITCODE -ne 0) { throw "${Exe} a échoué (code $LASTEXITCODE)." }
}
function Get-Digest([string]$File) {
    (Get-FileHash -Algorithm SHA256 -LiteralPath $File).Hash.ToLowerInvariant()
}
function Get-Key([string[]]$Items) {
    [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData(
        [Text.Encoding]::UTF8.GetBytes(($Items -join "`n")))).ToLowerInvariant()
}
function Get-AuditLocation([string]$Name, [string[]]$Required) {
    $base = Join-Path $local $Name
    foreach ($dir in (Get-ChildItem -LiteralPath $local -Directory -Filter "$Name*" | Sort-Object LastWriteTime -Descending)) {
        $missing = $Required | Where-Object { !(Test-Path -LiteralPath (Join-Path $dir.FullName $_) -PathType Leaf) }
        if (!$missing) { return $dir.FullName }
    }
    if (!(Test-Path -LiteralPath $base)) { return $base }
    return "$base-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
}

if ($Stop) {
    if (!(Test-Path -LiteralPath $activeFile)) { Write-Host 'Aucune session Guiers active.'; return }
    $active = (Get-Content -LiteralPath $activeFile -Raw).Trim()
    Set-Content -LiteralPath (Join-Path $runtime 'stop.pid') -Value $active -NoNewline
    for ($i = 0; $i -lt 40 -and (Test-Path -LiteralPath $activeFile); $i++) { Start-Sleep -Milliseconds 250 }
    if (Test-Path -LiteralPath $activeFile) { throw "La session Guiers (PID $active) n'a pas confirmé son arrêt." }
    Write-Host 'Session Guiers arrêtée.'
    return
}

if ((Invoke-Checked git @('-C', $repo, 'branch', '--show-current')) -ne 'modelisation-spatiale') {
    throw 'Ce lancement exige la branche modelisation-spatiale.'
}
if (!$EtienneRepo) { $EtienneRepo = Join-Path (Split-Path -Parent $repo) 'viabFishSng' }
$EtienneRepo = (Resolve-Path -LiteralPath $EtienneRepo).Path
$data = Join-Path $EtienneRepo 'data'
$etienneGit = @('--no-optional-locks', '-c', "safe.directory=$($EtienneRepo.Replace('\', '/'))", '-C', $EtienneRepo)
$head = Invoke-Checked git ($etienneGit + @('rev-parse', 'HEAD'))
if (!(Test-Path -LiteralPath $data -PathType Container)) { throw 'Dossier data de viabFishSng absent.' }
Write-Host "viabFishSng $head"
$listeners = Get-NetTCPConnection -LocalPort 3000,3001 -State Listen -ErrorAction SilentlyContinue
if ($listeners) {
    $occupied = foreach ($listener in $listeners) {
        $program = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
        "$($listener.LocalAddress):$($listener.LocalPort) PID $($listener.OwningProcess) $($program.ProcessName)"
    }
    throw "Ports occupés : $($occupied -join ' | '). Pour une session Guiers, utilisez -Stop."
}

New-Item -ItemType Directory -Force -Path $runtime | Out-Null
if (!$NodePath) {
    $preparedNode = Join-Path $repo 'build-guiers-tools/node.exe'
    $NodePath = if (Test-Path -LiteralPath $preparedNode) { $preparedNode } else { (Get-Command node.exe).Source }
}
$NodePath = (Resolve-Path -LiteralPath $NodePath).Path
$nodeVersion = Invoke-Checked $NodePath @('--version')
if ($nodeVersion -notmatch '^v24\.') { throw 'Node.js 24 requis. Indiquez son exécutable avec -NodePath.' }
$npm = Join-Path (Split-Path -Parent (Get-Command npm.cmd).Source) 'node_modules/npm/bin/npm-cli.js'
Write-Host "Node $nodeVersion, npm $(Invoke-Checked $NodePath @($npm, '--version'))"
foreach ($dir in @($web, $front)) {
    $deps = Get-Content -LiteralPath (Join-Path $dir 'package.json') -Raw | ConvertFrom-Json -AsHashtable
    $modules = Join-Path $dir 'node_modules'
    $missing = @($deps.dependencies.Keys) + @($deps.devDependencies.Keys) |
        Where-Object { !(Test-Path -LiteralPath (Join-Path $modules "$_/package.json")) }
    if ($missing) {
        $npmArgs = if (Test-Path -LiteralPath $modules) { @('install', '--no-save') } else { @('ci') }
        Invoke-Checked $NodePath (@($npm, '--prefix', $dir) + $npmArgs)
    }
}

$hydro = Join-Path $front 'data/geography/guiers-hydrolakes-1520.original.geojson'
$pipeline = Join-Path $PSScriptRoot 'guiers'
$manifest = Get-Content -LiteralPath (Join-Path $pipeline 'source_manifest.json') -Raw | ConvertFrom-Json
$referenceCommit = $manifest.viabFishSng.candidate_commit
$pipelineInputs = Get-ChildItem -LiteralPath $pipeline -File |
    Where-Object Name -In @('audit_sig.py', 'map_comparison.py', 'source_manifest.json', 'requirements.txt')
$pipelineKeys = @($pipelineInputs | Sort-Object Name | ForEach-Object { Get-Digest $_.FullName }) + @(Get-Digest $hydro)
$datedAudit = Join-Path $local 'v2-recette/provenance.json'
if (!$AcquiredAt -and (Test-Path -LiteralPath $datedAudit)) {
    $AcquiredAt = (Get-Content -LiteralPath $datedAudit -Raw | ConvertFrom-Json).viabFishSng.lac.acquiredAt
}
if (!$AcquiredAt) { throw "Indiquez la date réelle d'acquisition des données avec -AcquiredAt (AAAA-MM-JJ)." }
[void][DateOnly]::ParseExact($AcquiredAt, 'yyyy-MM-dd')
$proofPath = Join-Path $local 'local-use-proof.txt'
if (!$LocalUseProof) { $LocalUseProof = $env:GUIERS_LOCAL_USE_PROOF }
if (!$LocalUseProof -and (Test-Path -LiteralPath $proofPath -PathType Leaf)) {
    $LocalUseProof = (Get-Content -LiteralPath $proofPath -Raw).Trim()
}
if ($LocalUseProof) { $LocalUseProof = $LocalUseProof.Trim() }
if ($Synthetic -and $PSBoundParameters.ContainsKey('LocalUseProof')) { throw 'Sélectionnez un seul profil SIG.' }

function Get-SigPython {
    if ($PythonPath) { return (Resolve-Path -LiteralPath $PythonPath).Path }
    $venv = Join-Path $repo 'build-sig-guiers/venv/Scripts/python.exe'
    if (Test-Path -LiteralPath $venv) {
        & $venv --version 2>$null | Out-Host
        if ($LASTEXITCODE -eq 0) { return $venv }
    }
    $target = Join-Path $repo 'build-guiers-tools/venv'
    $py = Join-Path $target 'Scripts/python.exe'
    if (!(Test-Path -LiteralPath $py)) {
        Invoke-Checked (Get-Command python.exe).Source @('-m', 'venv', $target) | Out-Host
    }
    return $py
}
function Initialize-SigPython {
    $py = Get-SigPython
    $required = Join-Path $pipeline 'requirements.txt'
    & $py -B -c 'import shapely, pyproj, shapefile' 2>$null
    if ($LASTEXITCODE -ne 0) { Invoke-Checked $py @('-m', 'pip', 'install', '-r', $required) | Out-Host }
    return $py
}

$candidate = $null
$profile = ''
$exports = @('candidate-local-v2.json', 'water-part-graphs.json', 'mask-local.geojson')
if ($Synthetic) {
    $key = Get-Key ($pipelineKeys + @((Get-Digest (Join-Path $pipeline 'recipe_fixture.py')), $AcquiredAt))
    $fixture = Get-AuditLocation "fixture-v2-1-$($key.Substring(0, 16))" ($exports | ForEach-Object { "sorties/$_" })
    $candidate = Join-Path $fixture 'sorties'
    if (!(Test-Path -LiteralPath (Join-Path $candidate 'candidate-local-v2.json'))) {
        Invoke-Checked (Initialize-SigPython) @('-B', (Join-Path $pipeline 'recipe_fixture.py'), $fixture, $AcquiredAt)
    }
    $profile = 'synthetic'
} else {
    $files = @('README.md', 'modelv0.nlogo', 'modelv0_viab.nlogo', 'data')
    $dirty = Invoke-Checked git ($etienneGit + @('-c', 'core.excludesFile=', 'status', '--porcelain', '--') + $files)
    $snapshotCommit = @()
    if ($head -ne $referenceCommit -or $dirty) {
        Write-Host "Sources de travail divergentes. Utilisation des objets Git $referenceCommit."
        $snapshot = Join-Path $local "viabFishSng-$referenceCommit"
        if (!(Test-Path -LiteralPath (Join-Path $snapshot 'data/lac.shp'))) {
            $archive = Join-Path $runtime "viabFishSng-$referenceCommit.zip"
            Invoke-Checked git ($etienneGit + @('archive', '--format=zip', "--output=$archive", $referenceCommit, '--') + $files)
            Expand-Archive -LiteralPath $archive -DestinationPath $snapshot
        }
        $data = Join-Path $snapshot 'data'
        $snapshotCommit = @('--etienne-commit', $referenceCommit)
    }
    $layers = @('lac', 'envelope', 'villages', 'zoneExclusionPeche', 'tipha_theoric')
    foreach ($layer in $layers) {
        foreach ($extension in @('shp', 'shx', 'dbf', 'prj')) {
            if (!(Test-Path -LiteralPath (Join-Path $data "$layer.$extension") -PathType Leaf)) {
                throw "Composant SIG manquant : $layer.$extension"
            }
        }
    }
    $sourceKeys = Get-ChildItem -LiteralPath $data -File | Where-Object BaseName -In $layers |
        Sort-Object Name | ForEach-Object { "$($_.Name) $(Get-Digest $_.FullName)" }
    $key = Get-Key ($pipelineKeys + @($sourceKeys) + @($referenceCommit, $AcquiredAt, $LocalUseProof))
    $auditFiles = @('report.json', 'provenance.json', 'reference-H.json', 'connectivity-H.json',
        'water-part-graphs.json', 'carte-comparative-hp-plus.svg', 'carte-detail-coupure.svg')
    if ($LocalUseProof) { $auditFiles += $exports }
    $audit = Get-AuditLocation "audit-v2-1-$($key.Substring(0, 16))" $auditFiles
    if (!(Test-Path -LiteralPath $audit)) {
        $auditArgs = @('-B', (Join-Path $pipeline 'audit_sig.py'), '--hydro', $hydro, '--etienne', $data,
            '--acquired-at', $AcquiredAt, '--out', $audit) + $snapshotCommit
        if ($LocalUseProof) { $auditArgs += @('--local-use-proof', $LocalUseProof) }
        Invoke-Checked (Initialize-SigPython) $auditArgs
    }
    $report = Get-Content -LiteralPath (Join-Path $audit 'report.json') -Raw | ConvertFrom-Json
    if (!$report.fishingDomain -or ($report.sourceBlobChecks.PSObject.Properties.Value | Where-Object { !$_.matches })) {
        throw 'Empreintes du périmètre de référence divergentes.'
    }
    if ($LocalUseProof) {
        $bundle = Get-Content -LiteralPath (Join-Path $audit 'candidate-local-v2.json') -Raw | ConvertFrom-Json -AsHashtable
        foreach ($layer in $layers | Where-Object { $_ -ne 'envelope' }) {
            $source = $bundle.sources[$layer]
            $components = Get-ChildItem -LiteralPath $data -File | Where-Object {
                $_.BaseName -eq $layer -and $_.Extension -in @('.shp', '.shx', '.dbf', '.prj', '.cpg', '.qmd')
            }
            if ($source.files.Count -ne @($components).Count -or
                ($components | Where-Object { $source.files[$_.Name] -ne (Get-Digest $_.FullName) })) {
                throw "Les empreintes de la couche $layer divergent du paquet local."
            }
        }
        $candidate = $audit
        $profile = 'authorized'
    }
    else { Write-Host "Aucune référence d'autorisation fournie. Démarrage avec HydroLAKES." }
}

$apiFiles = Get-ChildItem -Path (Join-Path $web 'apps/api'), (Join-Path $web 'packages/contracts'), (Join-Path $web 'examples') -File -Recurse
$apiKey = Get-Key (@($apiFiles | Sort-Object FullName | ForEach-Object { "$($_.FullName) $(Get-Digest $_.FullName)" }) + @($nodeVersion))
$apiStamp = Join-Path $apiBuild 'source.sha256'
if (!(Test-Path -LiteralPath (Join-Path $apiBuild 'apps/api/src/server.js')) -or
    (Get-Content -LiteralPath $apiStamp -Raw -ErrorAction SilentlyContinue) -ne $apiKey) {
    Invoke-Checked $NodePath @((Join-Path $web 'node_modules/typescript/bin/tsc'), '-p', (Join-Path $web 'apps/api/tsconfig.json'), '--outDir', $apiBuild)
    Set-Content -LiteralPath $apiStamp -Value $apiKey -NoNewline
}

$runnerCandidates = @($RunnerPath, $env:IRRITATOR_RUNNER, (Join-Path $repo 'build-guiers-native/runner/irritator-runner.exe'),
    (Join-Path $repo 'build-web-test8p-bis/Release/runner/irritator-runner.exe'))
$probe = "import {ProcessEngine} from './build-guiers-api/apps/api/src/services/engine.js'; import {readConfig} from './build-guiers-api/apps/api/src/config/index.js'; const engine=new ProcessEngine(readConfig({...process.env,IRRITATOR_RUNNER:process.argv[1]})); try { await engine.capabilities(); } finally { await engine.close(); }"
function Test-Runner([string]$File) {
    if (!$File -or !(Test-Path -LiteralPath $File -PathType Leaf)) { return $false }
    & $NodePath --input-type=module -e $probe $File 2>$null | Out-Null
    return $LASTEXITCODE -eq 0
}
Push-Location -LiteralPath $web
try {
    $runner = $runnerCandidates | Where-Object { Test-Runner $_ } | Select-Object -First 1
    if (!$runner) {
        $nativeBuild = Join-Path $repo 'build-guiers-native'
        & (Join-Path $web 'build-runner.ps1') -EngineBuildDir (Join-Path $nativeBuild 'engine') -RunnerBuildDir (Join-Path $nativeBuild 'runner')
        $runner = Join-Path $nativeBuild 'runner/irritator-runner.exe'
        if (!(Test-Runner $runner)) { throw "Le runner compilé est incompatible avec l'API locale." }
    }
    $runner = (Resolve-Path -LiteralPath $runner).Path
} finally { Pop-Location }
Write-Host "Runner natif : $runner"

$assetsReady = (Test-Path -LiteralPath (Join-Path $front 'public/vendor/plotly-basic.min.js')) -and
    (Test-Path -LiteralPath (Join-Path $front 'public/vendor/LICENSE-plotly')) -and
    (Test-Path -LiteralPath (Join-Path $front 'public/geography/lac-de-guiers.hydrolakes.geojson')) -and
    ((Get-Digest (Join-Path $front 'public/geography/lac-de-guiers.hydrolakes.geojson')) -eq
     (Get-Digest (Join-Path $front 'data/geography/lac-de-guiers.hydrolakes.geojson')))
if (!$assetsReady) { Invoke-Checked $NodePath @((Join-Path $front 'scripts/prepare-assets.mjs')) }

$config = @{
    NODE_ENV = 'development'; HOST = '127.0.0.1'; PORT = '3001'; IRRITATOR_RUNNER = $runner
    IRRITATOR_API_URL = 'http://127.0.0.1:3001'; NEXT_TELEMETRY_DISABLED = '1'
    GUIERS_LOCAL_PROFILE = $profile; GUIERS_LOCAL_USE_PROOF = ''; NEXT_PUBLIC_GUIERS_LOCAL = ''
}
if ($candidate) {
    $config.NEXT_PUBLIC_GUIERS_LOCAL = '1'
    if (!$Synthetic) { $config.GUIERS_LOCAL_USE_PROOF = $LocalUseProof }
    $config.GUIERS_LOCAL_FOLDER = [IO.Path]::GetRelativePath($local, $candidate)
    $config.GUIERS_LOCAL_CANDIDATE_SHA = Get-Digest (Join-Path $candidate 'candidate-local-v2.json')
    $config.GUIERS_LOCAL_GRAPH_SHA = Get-Digest (Join-Path $candidate 'water-part-graphs.json')
    $config.GUIERS_LOCAL_MASK_SHA = Get-Digest (Join-Path $candidate 'mask-local.geojson')
}
$oldEnvironment = @{}
try {
    foreach ($name in $config.Keys) {
        $oldEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        [Environment]::SetEnvironmentVariable($name, $config[$name], 'Process')
    }
    $serverArgs = @($supervisor)
    if ($NoBrowser) { $serverArgs += '--no-browser' }
    if ($Background) {
        $process = Start-Process -FilePath $NodePath -ArgumentList ($serverArgs | ForEach-Object { '"' + $_ + '"' }) -WorkingDirectory $repo -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput (Join-Path $runtime 'servers.log') -RedirectStandardError (Join-Path $runtime 'servers-errors.log')
        for ($i = 0; $i -lt 140; $i++) {
            $process.Refresh()
            if ($process.HasExited) { break }
            if ((Get-Content -LiteralPath (Join-Path $runtime 'servers.log') -Raw -ErrorAction SilentlyContinue) -match 'Irritator prêt') {
                Write-Host "Session Guiers démarrée (PID $($process.Id)) sur http://localhost:3000."
                return
            }
            Start-Sleep -Milliseconds 500
        }
        throw "Le démarrage doit être vérifié dans $runtime."
    }
    Invoke-Checked $NodePath $serverArgs
} finally {
    foreach ($name in $oldEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $oldEnvironment[$name], 'Process') }
}
