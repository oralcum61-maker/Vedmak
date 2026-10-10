// Помощники сценариев (подмешиваются перед каждым сценарием быстрого набора, tools/bench/run.mjs).
// log(...) — строка в отчёт; ok(условие, текст) — проверка: провал записывается и роняет сценарий.
// Окна подтверждения нажимаются сами; свои карточки чата помечаются flags.world.bench = имя сценария;
// сцена «Прогон <имя>» и папка актёров того же имени создаются заново и очищаются перед сценарием.
const ok = (cond, text) => { window.__log.push(`${cond ? "✓" : "✗"} ${text}`); if (!cond) window.__fails.push(text); return !!cond; };
const log = (...a) => window.__log.push(a.join(" "));
const stepName = s => { window.__step = s; };
// Окна подтверждения и выбора — нажимаются сами (кнопка по умолчанию). Сценарий, который сам проверяет окна,
// ставит window.__noAutoDialog = true — иначе помощник нажмёт кнопку раньше проверки
Hooks.on("renderDialogV2", app => setTimeout(() => {
  if (window.__noAutoDialog) return;
  const b = app.element?.querySelector("footer button[autofocus], footer button.default, .form-footer button[autofocus]")
    ?? app.element?.querySelector("footer button, .form-footer button");
  b?.click();
}, 80));
const A = await import("/systems/vedmak/module/combat/attack.mjs");
const D = await import("/systems/vedmak/module/combat/defense.mjs");
const G = await import("/systems/vedmak/module/combat/damage.mjs");
const C = await import("/systems/vedmak/module/combat/common.mjs");
const TAG = window.__tag ?? "main";
// Свои карточки: метка ставится только на клиенте, который их создаёт (preCreate)
Hooks.on("preCreateChatMessage", doc => { doc.updateSource({ "flags.world.bench": TAG }); });
const mine = m => m.flags?.world?.bench === TAG;
const lastMine = () => game.messages.contents.filter(mine).at(-1);
const counts = {};
window.__counts = counts;

// Сцена прогона
let sc = game.scenes.getName(`Прогон ${TAG}`);
if (!sc) sc = await Scene.create({ name: `Прогон ${TAG}`, width: 4000, height: 3000, padding: 0, grid: { size: 100, distance: 2 } });
await sc.view();
for (let i = 0; i < 120 && !(canvas.ready && canvas.scene?.id === sc.id); i++) await wait(250);
await wait(500);
if (sc.tokens.size) await sc.deleteEmbeddedDocuments("Token", sc.tokens.map(t => t.id));
if (sc.regions.size) await sc.deleteEmbeddedDocuments("Region", sc.regions.map(r => r.id));
const folder = game.folders.find(f => f.type === "Actor" && f.name === `Прогон ${TAG}`) ?? await Folder.create({ name: `Прогон ${TAG}`, type: "Actor" });
for (const a of game.actors.filter(a => a.folder?.id === folder.id)) await a.delete();
for (const c of game.combats.filter(c => c.scene?.id === sc.id)) await c.delete();

const placeToken = async (actor, x, y) => {
  const td = await actor.getTokenDocument({ x, y, actorLink: true });
  const [t] = await sc.createEmbeddedDocuments("Token", [td.toObject()]);
  for (let i = 0; i < 20 && !t.object; i++) await wait(50);
  return t;
};
const cloneActor = async (src, name) => {
  const data = src.toObject();
  delete data._id;
  data.name = name;
  data.folder = folder.id;
  return Actor.create(data);
};
// Сбросить состояние: здоровье, выносливость, новые эффекты
const snapshot = actor => new Set(actor.effects.map(e => e.id));
const reset = async (actor, keep) => {
  // Эффекты, снятые системой одновременно с нами (конец формы, срок), — не ошибка стенда
  for (const id of actor.effects.filter(e => !keep.has(e.id)).map(e => e.id)) {
    if (actor.effects.has(id)) await actor.deleteEmbeddedDocuments("ActiveEffect", [id]).catch(() => {});
  }
  const upd = { "system.hp.value": actor.system.hp.max, "system.sta.value": actor.system.sta.max };
  await actor.update(upd).catch(() => {});
};
const clearChat = async () => {
  const ids = game.messages.filter(mine).map(m => m.id);
  if (ids.length) await ChatMessage.deleteDocuments(ids);
};

/**
 * Обход карточек: в каждой новой карточке нажимается по одной кнопке каждого вида (data-vedmak),
 * затем — в карточках, которые эти нажатия создали, и так до глубины maxDepth.
 */
// «Повторить атаку» порождает новую атаку со всей цепочкой — обход разрастался бы вглубь
const SKIP_ALWAYS = ["repeatAttack"];
let seen = new Set(game.messages.map(m => m.id));
async function crawl(label, maxDepth = 4, skip = []) {
  for (let depth = 0; depth <= maxDepth; depth++) {
    const fresh = game.messages.contents.filter(m => !seen.has(m.id) && mine(m));
    for (const m of fresh) seen.add(m.id);
    if (!fresh.length) return;
    for (const m of fresh) {
      await wait(30);
      const done = new Set();
      for (let k = 0; k < 40; k++) {
        const el = ui.chat.element?.querySelector(`[data-message-id="${m.id}"]`);
        if (!el) break;
        const b = [...el.querySelectorAll("[data-vedmak]")].find(x => !done.has(x.dataset.vedmak) && !skip.includes(x.dataset.vedmak) && !SKIP_ALWAYS.includes(x.dataset.vedmak));
        if (!b) break;
        const act = b.dataset.vedmak;
        done.add(act);
        if (b.disabled || b.style.opacity === "0.5") continue;
        stepName(`${label} → ${act} (${depth})`);
        counts[act] = (counts[act] ?? 0) + 1;
        b.click();
        await wait(120);
        for (let i = 0; i < 80 && b.isConnected && b.disabled; i++) await wait(100);
        await wait(80);
      }
    }
  }
}
