// Звуки системы (PLAN 4.66): синтезированы tools/make-sounds.py, лежат в assets/sounds. Играют у каждого клиента
// сами по себе (хуки срабатывают везде), поэтому без рассылки: громкость у каждого своя.

import { setting } from "../util.mjs";

const PATH = "systems/vedmak/assets/sounds/";

/** Ключ → громкость по умолчанию (относительно настройки «Громкость эффектов»). */
export const SOUNDS = {
  swing: 0.7, "swing-heavy": 0.75, miss: 0.6, hit: 0.85, "hit-crit": 0.95, block: 0.8, parry: 0.8, fumble: 0.75,
  bow: 0.75, crossbow: 0.75, death: 0.8,
  aard: 0.85, igni: 0.85, quen: 0.7, axii: 0.7, yrden: 0.7, spell: 0.7,
  drink: 0.7, bomb: 0.9, oil: 0.65,
  "ui-click": 0.35, "ui-coin": 0.5, "ui-turn": 0.6, "ui-success": 0.45, "ui-fail": 0.45, "ui-crit": 0.55
};

/** Звуки включены у этого клиента (интерфейсные — отдельным переключателем). */
export function soundsOn(key) {
  if (!setting("fxSound", true)) return false;
  return !key.startsWith("ui-") || setting("fxUi", true);
}

const last = new Map();

/**
 * Сыграть звук у себя. Одинаковый звук чаще раза в 60 мс глушится: пачка карточек не должна греметь хором.
 * @param {string} key
 * @param {{volume?: number, delay?: number}} [opts]
 */
export function playSound(key, { volume = 1, delay = 0 } = {}) {
  if (!(key in SOUNDS) || !soundsOn(key)) return;
  const now = performance.now();
  if (now - (last.get(key) ?? 0) < 60) return;
  last.set(key, now);
  const go = () => {
    const v = SOUNDS[key] * volume * Number(setting("fxVolume", 0.7));
    if (v <= 0) return;
    foundry.audio.AudioHelper.play({ src: `${PATH}${key}.ogg`, volume: v, loop: false, channel: "interface" }, false)
      ?.catch?.(err => console.warn("vedmak | звук", key, err));
  };
  if (delay > 0) setTimeout(go, delay);
  else go();
}

/** Заранее подгрузить звуки боя, чтобы первый удар не молчал, пока файл качается. */
export function preloadSounds() {
  if (!setting("fxSound", true)) return;
  for (const key of Object.keys(SOUNDS)) {
    foundry.audio.AudioHelper.preloadSound?.(`${PATH}${key}.ogg`)?.catch?.(() => {});
  }
}
