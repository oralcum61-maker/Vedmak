# Скопировать систему в рабочий Foundry пользователя.
# Копия, а не ссылка: удаление системы через интерфейс Foundry не заденет исходники.
param(
  [string]$Target = "D:\FoundryVTT-WindowsPortable-14.365\Data\systems\vedmak"
)

$source = Split-Path -Parent $PSScriptRoot
# .claude — навыки и рабочие копии агентов (.claude/worktrees), в игре не нужны.
# *.log не исключать: в LevelDB компендиумов данные лежат в 000NNN.log.
# LOCK/LOG — служебные файлы открытой базы: не копировать и не ждать их (/R:2 /W:1 вместо миллиона повторов).
robocopy $source $Target /MIR /XD .git node_modules packs-src "$source\.claude" /XF LOCK LOG LOG.old /R:2 /W:1 /NFL /NDL /NJH /NP | Out-Null
# Коды robocopy 0–7 — успех (1 = файлы скопированы), 8+ — ошибка
if ($LASTEXITCODE -ge 8) { throw "robocopy failed with code $LASTEXITCODE" }
Write-Output "vedmak synced to $Target"
exit 0
