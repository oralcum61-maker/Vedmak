# Скопировать систему в рабочий Foundry пользователя.
# Копия, а не ссылка: удаление системы через интерфейс Foundry не заденет исходники.
param(
  [string]$Target = "D:\FoundryVTT-WindowsPortable-14.365\Data\systems\vedmak"
)

$source = Split-Path -Parent $PSScriptRoot
# .claude — навыки и рабочие копии агентов (.claude/worktrees), в игре не нужны.
# *.log не исключать: в LevelDB компендиумов данные лежат в 000NNN.log.
# LOCK/LOG — служебные файлы открытой базы: не копировать и не ждать их (/R:2 /W:1 вместо миллиона повторов).
# Foundry running from the same portable folder: its world holds the compendium LevelDB open, so packs are skipped
# (replacing an open LevelDB corrupts it). Code, styles and templates are copied; reload the page (F5).
$foundryRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $Target))
$running = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like "$foundryRoot\*" -or $_.CommandLine -like "*$foundryRoot*main.mjs*" }).Count -gt 0
$xd = @(".git", "node_modules", "packs-src", "dist", "$source\.claude")
if ($running) { $xd += "$source\packs" }
robocopy $source $Target /MIR /XD @xd /XF LOCK LOG LOG.old /R:2 /W:1 /NFL /NDL /NJH /NP | Out-Null
# Коды robocopy 0–7 — успех (1 = файлы скопированы), 8+ — ошибка
if ($LASTEXITCODE -ge 8) { throw "robocopy failed with code $LASTEXITCODE" }
if ($running) { Write-Output "vedmak synced to $Target (Foundry is running: packs skipped, reload with F5)" }
else { Write-Output "vedmak synced to $Target" }
exit 0
