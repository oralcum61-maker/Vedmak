// Пауза в духе медитации ведьмака (PLAN 4.182): медальон школы на цепи качается маятником и изредка вздрагивает,
// за ним медленно идёт циферблат медитации; под ним — кованая «Пауза». Вместо значка и полосы Foundry
// (CONFIG.ui.pause). Движение — только transform и opacity, без фильтров поверх холста.

const SCHOOL_MEDALLIONS = ["wolf", "cat", "griffin", "bear", "viper", "manticore"];
const ROMAN = ["XII", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI"];

/** Медальон школы персонажа пользователя; у ведущего и без школы — Волк. */
function medallionSrc() {
  const school = game.user.character?.system?.details?.school;
  const key = SCHOOL_MEDALLIONS.includes(school) ? school : "wolf";
  return `systems/vedmak/assets/fan/gear/med-school-${key}.webp`;
}

/** Циферблат медитации: 48 насечек, через каждые четыре — длинная и римская цифра. */
function dialSvg() {
  const c = 150;
  const ticks = [];
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const long = i % 4 === 0;
    const r1 = long ? 112 : 118, r2 = 126;
    const [s, k] = [Math.sin(a), -Math.cos(a)];
    ticks.push(`<line x1="${(c + s * r1).toFixed(1)}" y1="${(c + k * r1).toFixed(1)}" x2="${(c + s * r2).toFixed(1)}" y2="${(c + k * r2).toFixed(1)}" class="${long ? "l" : ""}"/>`);
  }
  const numerals = ROMAN.map((n, i) => {
    const a = (i / 12) * Math.PI * 2;
    const x = c + Math.sin(a) * 140, y = c - Math.cos(a) * 140;
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" transform="rotate(${i * 30} ${x.toFixed(1)} ${y.toFixed(1)})">${n}</text>`;
  }).join("");
  return `<svg class="vp-dial" viewBox="-6 -6 312 312" aria-hidden="true">
    <circle cx="${c}" cy="${c}" r="129" class="rim"/><circle cx="${c}" cy="${c}" r="108" class="rim in"/>
    <g class="ticks">${ticks.join("")}</g><g class="num">${numerals}</g></svg>`;
}

export class VedmakPause extends foundry.applications.ui.GamePause {

  static DEFAULT_OPTIONS = { classes: ["vedmak-pause"] };

  async _renderHTML(context) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="vp-veil"></div>
      <div class="vp-hang">
        <div class="vp-swing">
          <span class="vp-chain"></span>
          <div class="vp-medal">
            ${dialSvg()}
            <span class="vp-ring"></span>
            <img class="vp-sign" src="${medallionSrc()}" alt="">
          </div>
        </div>
      </div>
      <figcaption class="vp-cap">
        <b>Пауза</b>
        <i class="vp-rule"></i>
        <span>Время остановилось</span>
      </figcaption>`;
    return [...wrap.children];
  }
}
