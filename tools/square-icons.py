"""Значки из игры — в квадрат по рисунку.

Значки с вики лежат на холстах 64×128 с прозрачными полями, а лист вписывает картинку в квадратную рамку
целиком (object-fit: contain) — рисунок выходит вдвое мельче рамки. Скрипт обрезает прозрачные поля и кладёт
рисунок по центру квадратного холста с небольшим запасом: в рамке он занимает почти всё место и не обрезается.
Заодно уменьшает значки больше MAX_SIDE: в листе они 28 px в списках и 64 px в шапке предмета, а браузер
распаковывает картинку целиком — значок 512×512 распаковывался в 4 раза дольше и занимал в 4 раза больше памяти
(PLAN 4.37). Портреты (бестиарий, люди) не трогает. Повторный запуск ничего не меняет.

Запуск из корня репозитория: python tools/square-icons.py   (нужен Pillow: pip install pillow)
"""
import pathlib
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent / "assets" / "fan"
SKIP = {"bestiary", "people"}   # портреты: заполняют кадр сами
PAD = 0.06                      # запас вокруг рисунка
FILL_OK = 0.9                   # квадратный значок, заполненный хотя бы на 90%, не трогаем
MAX_SIDE = 256                  # больше не нужно даже на экране с масштабом 4×


def square(path: pathlib.Path) -> bool:
    im = Image.open(path)
    im.load()
    rgba = im.convert("RGBA")
    w, h = rgba.size
    box = rgba.getchannel("A").point(lambda a: 255 if a > 16 else 0).getbbox()
    if not box:
        return False
    bw, bh = box[2] - box[0], box[3] - box[1]
    canvas = rgba
    if not (w == h and max(bw, bh) / w >= FILL_OK):
        side = round(max(bw, bh) * (1 + PAD))
        if side != w or side != h:
            canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
            canvas.paste(rgba.crop(box), ((side - bw) // 2, (side - bh) // 2))
    if max(canvas.size) > MAX_SIDE:
        canvas = canvas.resize((MAX_SIDE, round(canvas.size[1] * MAX_SIDE / canvas.size[0])), Image.LANCZOS)
    if canvas is rgba:
        return False
    canvas.save(path, "WEBP", lossless=True, quality=100, method=6)
    return True


def main():
    changed = 0
    for path in sorted(ROOT.rglob("*.webp")):
        if path.relative_to(ROOT).parts[0] in SKIP:
            continue
        if square(path):
            changed += 1
    print(f"В квадрат уложено или уменьшено значков: {changed}")


if __name__ == "__main__":
    main()
