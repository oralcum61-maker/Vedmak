// Значки для окон проверок и чата (assets/glyphs): кованые части тела и грани d10 файлами SVG.
// Окна DialogV2 и сообщения чата вычищают встроенный <svg> из разметки, поэтому там значки — картинками
// (фон через CSS), а на листе — встроенным подшаблоном parts/armor-part.hbs с теми же контурами.
// Запуск: node tools/make-glyphs.mjs
import { writeFileSync, mkdirSync } from "node:fs";

const OUT = new URL("../assets/glyphs/", import.meta.url);
mkdirSync(OUT, { recursive: true });

const grad = (id, stops) => `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">${
  stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join("")}</linearGradient>`;
const METAL = {
  ok: [[0, "#f6f2ea"], [.45, "#b3ada2"], [.7, "#74706a"], [1, "#3e3d3a"]],
  dim: [[0, "#8e897e"], [.5, "#5a5752"], [1, "#2c2b29"]]
};

// Контуры — как в templates/actor/parts/armor-part.hbs
const PARTS = {
  head: {
    shell: ["M4.5 21.5V9L6.8 4.6L12 2.6L17.2 4.6L19.5 9V21.5H14.6L13.4 19.2H10.6L9.4 21.5Z"],
    ink: "M12 2.8V19", slit: "M6.4 10.4H11.1V12.2H6.4ZM12.9 10.4H17.6V12.2H12.9ZM14.5 14.6h1v1.5h-1zM16.4 14.6h1v1.5h-1zM14.5 16.9h1v1.4h-1zM16.4 16.9h1v1.4h-1z",
    hi: "M6.2 9.6V20.4"
  },
  torso: {
    shell: ["M3 7L6.5 3L10 4.6L12 6.2L14 4.6L17.5 3L21 7L18.8 10.2V16.2L16.6 21.5H7.4L5.2 16.2V10.2Z"],
    ink: "M12 6.4V21.3M5.3 15.6H18.7M3.3 7.2L6.4 9.4M20.7 7.2L17.6 9.4", rv: [[8.2, 12.2], [15.8, 12.2], [8.8, 18.4], [15.2, 18.4]],
    hi: "M6 10.8V15"
  },
  arm: {
    shell: ["M5 2H15L16.4 8.6H4.6Z", "M16.4 9.4L20.4 11.2L19.8 15L16.8 14.4Z", "M4.6 8.6H16.4L17.2 14.2H5.2Z", "M5.2 14.2H17.2L18.4 16.6L17.6 19.8L15.2 21.8H8.4L6 19.6Z"],
    slit: "M6.6 14.2L7.6 12.1L8.6 14.2ZM10.4 14.2L11.4 12.1L12.4 14.2ZM14.2 14.2L15.2 12.1L16.2 14.2Z",
    ink: "M9.2 14.6V21.4M12.2 14.6V21.8M15 14.6V21.2M5.1 5.2H15.7", rv: [[7.2, 3.6], [12.8, 3.6]], hi: "M5.8 9.6V13.4"
  },
  leg: {
    shell: ["M7.2 1.6H13.4L14 11.4L13.2 16.4L19.4 18.4L21.4 21.8H7.6L6.6 16.4L6.2 11.4Z", "M5.4 8L7 5.6H13.8L15.2 8L13.8 10.4H7Z"],
    ink: "M10.3 10.6V16.4M13.6 17L14.2 21.6M16 17.8L16.6 21.6M18.2 18.6L18.8 21.6M6.8 16.4H13.2", rv: [[10.3, 8]], hi: "M7.4 11.6V15.8"
  },
  die: {
    shell: ["M12 1.5L22.5 10L12 22.5L1.5 10Z"],
    ink: "M1.5 10L12 14L22.5 10M12 14V22.5M12 1.5L7.4 11.6M12 1.5L16.6 11.6", hi: "M3.6 10.4L11 13.2"
  }
};

for (const [kind, p] of Object.entries(PARTS)) {
  for (const [state, stops] of Object.entries(METAL)) {
    const rv = state === "ok" ? "#f1ece0" : "#c9c3b6";
    const hi = state === "ok" ? "rgba(255,255,255,.55)" : "rgba(255,255,255,.22)";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><defs>${grad("m", stops)}</defs>` +
      p.shell.map(d => `<path d="${d}" fill="url(#m)" stroke="#050607" stroke-width="1.3" stroke-linejoin="miter"/>`).join("") +
      (p.slit ? `<path d="${p.slit}" fill="#050607"/>` : "") +
      (p.ink ? `<path d="${p.ink}" fill="none" stroke="#050607" stroke-width=".9"/>` : "") +
      (p.rv ?? []).map(([x, y]) => `<circle cx="${x}" cy="${y}" r=".8" fill="${rv}"/>`).join("") +
      (p.hi ? `<path d="${p.hi}" fill="none" stroke="${hi}" stroke-width=".8"/>` : "") + "</svg>\n";
    writeFileSync(new URL(`part-${kind}-${state}.svg`, OUT), svg);
  }
}

// Грани d10 для чата: обычная, десятка, единица с трещиной, кость провала
const FACE = "M14 1.5L26.5 12L14 28.5L1.5 12Z";
const EDGE = "M1.5 12L14 17L26.5 12M14 17V28.5";
const DICE = {
  ok: { stops: [[0, "#f6f2ea"], [.5, "#c9c3b6"], [1, "#7d7972"]], stroke: "#050607", edge: "rgba(5,6,7,.4)" },
  max: { stops: [[0, "#ffe2a6"], [.45, "#e09a4a"], [1, "#8a3a1c"]], stroke: "#3a1206", edge: "rgba(58,18,6,.55)" },
  min: { stops: [[0, "#4a4c52"], [.55, "#26272b"], [1, "#121316"]], stroke: "#050607", edge: "rgba(255,255,255,.12)",
    extra: `<path d="M9 5.5L12 10.5L10 14L13 19L11.5 24" fill="none" stroke="#b8432c" stroke-width="1"/>` },
  burn: { stops: [[0, "#e0604a"], [.55, "#8f301f"], [1, "#3a120a"]], stroke: "#2a0c06", edge: "rgba(42,12,6,.5)" }
};
for (const [state, d] of Object.entries(DICE)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 30"><defs>${grad("f", d.stops)}</defs>` +
    `<path d="${FACE}" fill="url(#f)" stroke="${d.stroke}" stroke-width="1.2" stroke-linejoin="round"/>` +
    `<path d="${EDGE}" fill="none" stroke="${d.edge}" stroke-width=".8"/>${d.extra ?? ""}</svg>\n`;
  writeFileSync(new URL(`die-${state}.svg`, OUT), svg);
}
// Кости для пергамента чата: тушь по бумаге — обычная, десятка (сусальное золото), единица с красной трещиной,
// кость провала (киноварь)
const INK = {
  "ink-ok": { stops: [[0, "#f6eedb"], [1, "#d9cba9"]], stroke: "#2b2117", edge: "rgba(43,33,23,.45)" },
  "ink-max": { stops: [[0, "#f7d98c"], [.5, "#d9a441"], [1, "#9a6a1c"]], stroke: "#4a2f0c", edge: "rgba(74,47,12,.5)" },
  "ink-min": { stops: [[0, "#d8ccb0"], [1, "#a8997a"]], stroke: "#2b2117", edge: "rgba(43,33,23,.4)",
    extra: `<path d="M9 5.5L12 10.5L10 14L13 19L11.5 24" fill="none" stroke="#8e2a1c" stroke-width="1.1"/>` },
  "ink-burn": { stops: [[0, "#c4503a"], [.55, "#8e2a1c"], [1, "#5a170c"]], stroke: "#3a0e06", edge: "rgba(58,14,6,.5)" }
};
for (const [state, d] of Object.entries(INK)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 30"><defs>${grad("f", d.stops)}</defs>` +
    `<path d="${FACE}" fill="url(#f)" stroke="${d.stroke}" stroke-width="1.3" stroke-linejoin="round"/>` +
    `<path d="${EDGE}" fill="none" stroke="${d.edge}" stroke-width=".8"/>${d.extra ?? ""}</svg>\n`;
  writeFileSync(new URL(`die-${state}.svg`, OUT), svg);
}
console.log("assets/glyphs: готово");
