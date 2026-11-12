# Mesure la memoire de Desktop Companion et de ses processus WebView2.
# " Prive (WS) " = colonne " Memoire " du Gestionnaire des taches (ensemble de travail prive).
# Usage : powershell -File scripts/measure-memory.ps1 [-CpuSeconds 10]
param([int]$CpuSeconds = 0)

$app = Get-Process desktop-companion -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $app) { Write-Output 'desktop-companion ne tourne pas.'; exit 1 }

$wv = @(Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" |
    Where-Object { $_.CommandLine -match 'dev\.desktopcompanion\.core' })
$ids = @([int]$app.Id) + @($wv | ForEach-Object { [int]$_.ProcessId })
$perf = @{}
Get-CimInstance Win32_PerfFormattedData_PerfProc_Process |
    Where-Object { $ids -contains [int]$_.IDProcess } |
    ForEach-Object { $perf[[int]$_.IDProcess] = $_ }

$rows = foreach ($id in $ids) {
    $cmd = ($wv | Where-Object { [int]$_.ProcessId -eq $id }).CommandLine
    $type = if ($id -eq $app.Id) { 'app (Rust)' }
            elseif ($cmd -match '--type=([\w-]+)') {
                $t = $Matches[1]
                if ($cmd -match '--utility-sub-type=([\w.]+)') { "$t ($($Matches[1] -replace '.*\.', ''))" } else { $t }
            } else { 'browser' }
    $p = $perf[$id]
    [pscustomobject]@{
        PID = $id; Type = $type
        'Prive WS (Mo)' = if ($p) { [math]::Round($p.WorkingSetPrivate / 1MB, 1) } else { $null }
        'Commit (Mo)'   = if ($p) { [math]::Round($p.PrivateBytes / 1MB, 1) } else { $null }
    }
}
$rows | Format-Table -AutoSize | Out-String -Width 200
$tot = ($rows | Measure-Object 'Prive WS (Mo)' -Sum).Sum
$web = ($rows | Where-Object Type -ne 'app (Rust)' | Measure-Object 'Prive WS (Mo)' -Sum).Sum
"TOTAL prive WS : $tot Mo (dont WebView2 : $web Mo)"

if ($CpuSeconds -gt 0) {
    $procs = $ids | ForEach-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue }
    $t1 = 0; foreach ($p in $procs) { $t1 += $p.TotalProcessorTime.TotalMilliseconds }
    Start-Sleep -Seconds $CpuSeconds
    $t2 = 0; foreach ($p in $procs) { $p.Refresh(); $t2 += $p.TotalProcessorTime.TotalMilliseconds }
    $cores = [Environment]::ProcessorCount
    "CPU moyen sur $CpuSeconds s : $([math]::Round(($t2 - $t1) / ($CpuSeconds * 10) / $cores, 2)) % de la machine ($cores coeurs)"
}
