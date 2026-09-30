---
name: sync
description: Скопировать систему из рабочей папки D:\Witcher\vedmak в рабочий Foundry пользователя (D:\FoundryVTT-WindowsPortable-14.365\Data\systems\vedmak). Работает только на компьютере автора. Использовать, когда правку нужно увидеть в игре, или по просьбе «выгрузи в Foundry», «синхронизируй», «обнови систему в Foundry».
---

# Выгрузка в Foundry

## На компьютере автора

1. Сначала проверка: `node tools/check.mjs`. С ошибками не выгружать.
2. Из `D:\Witcher\vedmak`:
   ```
   powershell -ExecutionPolicy Bypass -File tools/sync-to-foundry.ps1
   ```
   В конце должно быть `vedmak synced to …`.

   Скрипт делает `robocopy /MIR`: в папке Foundry удаляется всё, чего нет в исходниках. Не трогаются
   `.git`, `node_modules`, `packs-src` и служебные `LOCK`/`LOG` компендиумов.

   В папке Foundry git быть не должно — репозиторий живёт в `D:\Witcher\vedmak`.
3. Скажи пользователю, как подхватить изменения:
   - код, шаблоны, стили, `lang/ru.json` — обновить страницу мира **Ctrl+F5**;
   - `system.json` (новые типы документов, компендиумы) или содержимое `packs/` — **перезапустить
     Foundry целиком**: F5 не хватит.

## В облачной сессии

Выгрузить нельзя: компьютера автора отсюда не видно. Закоммить и отправь правки, затем дай пользователю команды:

```powershell
cd D:\Witcher\vedmak
git pull
powershell -ExecutionPolicy Bypass -File tools\sync-to-foundry.ps1
```

И так же скажи, нужен ли Ctrl+F5 или полный перезапуск.
