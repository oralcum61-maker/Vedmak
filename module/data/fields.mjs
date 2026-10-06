// Общие кирпичики схем данных.

const { NumberField, StringField, SchemaField, HTMLField } = foundry.data.fields;

/** Целое число, по умолчанию 0. */
export const int = (initial = 0, opts = {}) =>
  new NumberField({ required: true, nullable: false, integer: true, initial, ...opts });

/** Дробное число (вес, цена). */
export const num = (initial = 0, opts = {}) =>
  new NumberField({ required: true, nullable: false, initial, ...opts });

export const str = (initial = "", opts = {}) =>
  new StringField({ required: true, blank: true, initial, ...opts });

export const html = () => new HTMLField({ required: true, blank: true, initial: "" });

/** Шкала «текущее / максимум». Максимум у производных пересчитывается, но хранится для полос токена. */
export const track = (value = 0, max = 0) => new SchemaField({ value: int(value), max: int(max) });

/** Кошелёк по валютам (config/money.mjs): крона — основная (у персонажа бывает в минусе — долг), остальные меняются по курсу. */
export const moneySchema = () => new SchemaField({
  crowns: int(0), orens: int(0, { min: 0 }), florens: int(0, { min: 0 }), ducats: int(0, { min: 0 }),
  marks: int(0, { min: 0 }), lintars: int(0, { min: 0 }), bizants: int(0, { min: 0 })
});

/** Источник: книга и страница — чтобы любую цифру можно было сверить. */
export const source = () => new SchemaField({ book: str("Корник"), page: str("") });
