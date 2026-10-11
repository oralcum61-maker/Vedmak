"""Шрифты системы: подмножество WOFF2 из исходных TTF google/fonts (PLAN 4.124).

Запуск: python tools/make-fonts.py <папка с Forum-Regular.ttf, IBMPlexSans-Variable.ttf, IBMPlexSans-Italic-Variable.ttf>
Нужны fonttools и brotli (pip install fonttools brotli). Остаются латиница, кириллица, общая пунктуация, стрелки,
математика и знаки (U+2000–2BFF) и все возможности OpenType; оси wght и wdth у Plex сохраняются.
Подмножество — изменённая версия по SIL OFL, поэтому зарезервированные имена «Forum» и «Plex» заменены на
«Vedmak Display» и «Vedmak Sans»; копирайт и лицензия в таблице имён не трогаются.
"""
import io, os, sys
from fontTools import subset
from fontTools.ttLib import TTFont

UNICODES = "U+0020-024F,U+0300-036F,U+0400-052F,U+1E00-1EFF,U+2000-2BFF,U+FFFD"
KEEP = {0, 7, 8, 9, 10, 11, 12, 13, 14}  # копирайт, марка, производитель, автор, описание, адреса, лицензия
JOBS = [
    ("Forum-Regular.ttf", "VedmakDisplay.woff2", [("Forum", "Vedmak Display")]),
    ("IBMPlexSans-Variable.ttf", "VedmakSans.woff2", [("IBM Plex Sans", "Vedmak Sans"), ("IBMPlexSans", "VedmakSans"), ("Plex", "Vedmak")]),
    ("IBMPlexSans-Italic-Variable.ttf", "VedmakSans-Italic.woff2", [("IBM Plex Sans", "Vedmak Sans"), ("IBMPlexSans", "VedmakSans"), ("Plex", "Vedmak")]),
]

src = sys.argv[1] if len(sys.argv) > 1 else "."
out = os.path.join(os.path.dirname(__file__), "..", "fonts")
for name, dst, pairs in JOBS:
    font = TTFont(os.path.join(src, name))
    opts = subset.Options()
    opts.layout_features = ["*"]
    opts.flavor = "woff2"
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=subset.parse_unicodes(UNICODES))
    sub.subset(font)
    for rec in font["name"].names:
        if rec.nameID in KEEP:
            continue
        text = rec.toUnicode()
        for a, b in pairs:
            text = text.replace(a, b)
        rec.string = text
    font.flavor = "woff2"
    path = os.path.join(out, dst)
    font.save(path)
    print(f"{dst}: {os.path.getsize(path) // 1024} КБ")
