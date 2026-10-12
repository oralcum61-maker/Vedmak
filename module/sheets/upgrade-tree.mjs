// Общее у деревьев «Обустройство» (лист постройки) и «Обучение» (лист отряда), PLAN 4.198: правка формы поверх
// сохранённых массивов и добавление/удаление веток, ступеней, эффектов и цены ведущим.

/** Поверх сохранённого массива объектов — правка формы с номерами (name="…branches.1.nodes.0.cost.0.qty"), вглубь. */
export function patchArray(src = [], patch = {}) {
  const out = foundry.utils.deepClone(src);
  for (const [k, val] of Object.entries(patch)) {
    const i = Number(k);
    if (!Number.isInteger(i)) continue;
    out[i] = patchValue(out[i], val);
  }
  return out;
}

function patchValue(cur, val) {
  if (!val || typeof val !== "object" || Array.isArray(val)) return val;
  if (Array.isArray(cur)) return patchArray(cur, val);
  const out = { ...(cur ?? {}) };
  for (const [k, v] of Object.entries(val)) out[k] = Array.isArray(out[k]) ? patchArray(out[k], v) : patchValue(out[k], v);
  return out;
}

/** Данные формы: массивы-ключи system (levels, branches) — поверх сохранённых. */
export function patchFormArrays(data, source, keys) {
  for (const key of keys) {
    const v = data.system?.[key];
    if (v && typeof v === "object" && !Array.isArray(v)) data.system[key] = patchArray(source[key] ?? [], v);
  }
  return data;
}

/**
 * Добавить в дерево: ветку (kind «branch»), ступень («node»), эффект («effect») или ресурс цены («cost»).
 * @param {object} sys — копия system
 * @param {string} kind
 * @param {string} path — путь к массиву («system.branches.0.nodes»)
 * @param {{node: Function, effect: Function}} make — пустая ступень (по предыдущей) и пустой эффект
 */
export function treeAdd(sys, kind, path, make) {
  const id = () => foundry.utils.randomID(8);
  if (kind === "branch") { sys.branches.push({ id: id(), name: "Новая ветка", icon: "fa-star", nodes: [] }); return; }
  const list = foundry.utils.getProperty(sys, String(path ?? "").replace(/^system\./, ""));
  if (!Array.isArray(list)) return;
  if (kind === "node") list.push({ id: id(), requires: list.at(-1)?.id ?? "", ...make.node() });
  else if (kind === "effect") list.push(make.effect());
  else if (kind === "cost") list.push({ resource: "", qty: 1 });
}

/** Убрать элемент массива дерева; у удалённых ступеней снимаются связи и освоение. Возвращает id удалённых ступеней. */
export function treeDel(sys, path, index) {
  const list = foundry.utils.getProperty(sys, String(path ?? "").replace(/^system\./, ""));
  if (!Array.isArray(list)) return new Set();
  const [gone] = list.splice(Number(index), 1);
  const ids = new Set(gone?.id ? [gone.id, ...(gone.nodes ?? []).map(x => x.id)] : []);
  for (const br of sys.branches) for (const nd of br.nodes) if (ids.has(nd.requires)) nd.requires = "";
  sys.upgrades = (sys.upgrades ?? []).filter(x => !ids.has(x));
  if (ids.has(sys.research?.node)) sys.research = { node: "", progress: 0 };
  return ids;
}
