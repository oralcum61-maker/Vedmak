// Система в тестовом Foundry — копия репозитория, а не ссылка: сервер пишет в свои базы компендиумов (LevelDB) и держит
// их открытыми, а в репозитории от этого оставался мусор в packs/ и падала сборка компендиумов (EPERM).
// Копия обновляется перед каждым прогоном: robocopy /MIR переписывает изменённое и убирает лишнее — тестовый
// сервер всякий раз стартует с пакетами репозитория. Пока сервер работает, пакеты не трогаются (их файлы открыты).
import { spawnSync } from "node:child_process";
import { lstatSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../../..");

/** Обновить копию системы в данных тестового Foundry. packs — false, когда сервер уже запущен. */
export function syncSystem(dataPath, { packs = true } = {}) {
  const target = join(dataPath, "Data/systems/vedmak");
  let st = null;
  try { st = lstatSync(target); } catch {}
  // Старое подключение ссылкой: снять его — дело человека (rmdir без /s снимает только ссылку), копировать в ссылку нельзя
  if (st?.isSymbolicLink()) throw new Error(`${target} — ссылка на репозиторий. Снимите её (cmd /c rmdir "${target}") и запустите снова.`);
  mkdirSync(target, { recursive: true });
  // Как tools/sync-to-foundry.ps1: без .git, node_modules, исходников пакетов и служебных файлов открытой базы
  const xd = [".git", "node_modules", "packs-src", join(REPO, ".claude"), join(REPO, "tools/bench/results")];
  if (!packs) xd.push(join(REPO, "packs"));
  const r = spawnSync("robocopy", [REPO, target, "/MIR", "/XD", ...xd, "/XF", "LOCK", "LOG", "LOG.old", "/R:2", "/W:1", "/NFL", "/NDL", "/NJH", "/NJS", "/NP"], { encoding: "utf8" });
  // Коды robocopy 0–7 — успех, 8+ — ошибка
  if (r.status === null || r.status >= 8) throw new Error(`Копия системы в тестовый Foundry не обновлена (robocopy ${r.status}): ${(r.stdout || r.error?.message || "").trim().slice(0, 300)}`);
  return { target, copied: (r.status & 1) === 1, packs };
}
