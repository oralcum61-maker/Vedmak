// Ползунок громкости звуков системы (PLAN 4.67): строкой «Ведьмак» в блоке громкости вкладки «Звуки» боковой
// панели, рядом с музыкой, окружением и интерфейсом Foundry, и в худе — за кнопкой с динамиком. Пишет
// клиентскую настройку fxVolume; все ползунки на экране держатся в одном положении.

import { SYSTEM_ID } from "../util.mjs";
import { playSound } from "./sounds.mjs";

export const volumeIcon = v => (v <= 0 ? "fa-volume-xmark" : v < 0.35 ? "fa-volume-low" : "fa-volume-high");

function current() {
  try { return Number(game.settings.get(SYSTEM_ID, "fxVolume")); } catch { return 0.7; }
}

/** Привести все ползунки и подписи к значению (после правки в любом из мест или в настройках). */
export function syncVolumeControls(v = current()) {
  for (const input of document.querySelectorAll("input.vd-fx-slider")) if (Number(input.value) !== v) input.value = v;
  for (const out of document.querySelectorAll(".vd-fx-value")) out.textContent = `${Math.round(v * 100)}%`;
  for (const icon of document.querySelectorAll(".vd-fx-icon")) {
    icon.classList.remove("fa-volume-xmark", "fa-volume-low", "fa-volume-high");
    icon.classList.add(volumeIcon(v));
  }
}

let timer = null;

/** Оживить ползунок: тянешь — значение пишется, отпустил — короткий щелчок новой громкостью. */
export function bindVolumeSlider(input) {
  if (!input || input.dataset.vdBound) return;
  input.dataset.vdBound = "1";
  input.addEventListener("input", () => {
    const v = Number(input.value);
    syncVolumeControls(v);
    clearTimeout(timer);
    timer = setTimeout(() => game.settings.set(SYSTEM_ID, "fxVolume", v), 120);
  });
  input.addEventListener("change", () => setTimeout(() => playSound("hit", { volume: 0.6 }), 160));
}

function onRenderPlaylists(app, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  const list = root?.querySelector(".global-volume ol");
  if (!list || list.querySelector(".vd-fx-volume")) return;
  const v = current();
  const li = document.createElement("li");
  li.className = "flexrow vd-fx-volume";
  li.dataset.tooltip = "Звуки системы «Ведьмак»: удары, блоки, знаки, зелья, взрывы, щелчки и колокол хода";
  li.innerHTML = `<label>Ведьмак</label><i class="volume-icon vd-fx-icon fa-fw fa-solid ${volumeIcon(v)}" inert></i>`
    + `<input type="range" class="vd-fx-slider" min="0" max="1" step="0.05" value="${v}" aria-label="Громкость звуков системы">`;
  list.append(li);
  bindVolumeSlider(li.querySelector("input"));
}

export function registerVolumeControls() {
  Hooks.on("renderPlaylistDirectory", onRenderPlaylists);
}
