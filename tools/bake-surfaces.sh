#!/usr/bin/env bash
# Запечённые поверхности (PLAN 4.53): фактуры, которые CSS раньше накладывал на цвет в режиме overlay слоями
# на каждом элементе, сведены заранее в одну цветную плитку. Браузеру остаётся положить картинку, без смешения
# слоёв при каждой отрисовке — это и снимало нагрузку с видеокарты, которую делит холст сцены.
# Смешение то же, что в CSS: Overlay с основой снизу, вуаль — доля цвета основы поверх.
# Нужен ImageMagick 7 (magick). Запуск из корня: bash tools/bake-surfaces.sh
set -euo pipefail
T=assets/textures
O=assets/textures/baked
mkdir -p "$O"

# tile <файл> <сторона плитки> — фактура, растянутая до стороны и замощённая на холст
# bake <выход> <сторона> <цвет> <вуаль 0..100> <файл:сторона>... — слои снизу вверх
bake() {
  local out=$1 size=$2 color=$3 veil=$4; shift 4
  local args=(-size "${size}x${size}" "xc:${color}")
  local n=0
  for spec in "$@"; do
    local f=${spec%%:*} s=${spec##*:}
    n=$((n + 1))
    # +compose: tile: замащивает текущим режимом смешения, а после первого слоя это Overlay — вышла бы чернота
    args+=( \( +compose "$f" -colorspace sRGB -depth 8 -resize "${s}x${s}!" -write "mpr:t$n" +delete -size "${size}x${size}" "tile:mpr:t$n" \) -compose Overlay -composite )
  done
  if [ "$veil" != 0 ]; then
    args+=( \( -size "${size}x${size}" "xc:${color}" \) -compose blend -define "compose:args=${veil}" -composite )
  fi
  magick "${args[@]}" -quality 88 "$O/$out"
}

G=$T/grain.png
# Лист и окна
bake plate.webp    512 '#1f2024' 0  "$T/steel-plate.webp:512" "$G:128"
bake window.webp   512 '#17181b' 0  "$T/stains.webp:512" "$T/leather.webp:512" "$G:128"
bake header.webp   512 '#131417' 0  "$T/steel-brushed.webp:512" "$G:128"
# Чат «Медальон»: кожа с вуалью 50 %, планка шапки, кнопки и таблички
bake chat.webp     720 '#1e1f23' 50 "$T/leather.webp:720" "$G:180"
bake chat-head.webp 512 '#16171a' 40 "$T/steel-brushed.webp:512" "$G:128"
bake btn-steel.webp 512 '#3b3d43' 62 "$T/steel-brushed.webp:512" "$G:128"
bake plaque-ok.webp 512 '#34492a' 62 "$T/steel-brushed.webp:512" "$G:128"
bake plaque-bad.webp 512 '#8f301f' 60 "$T/steel-brushed.webp:512" "$G:128"
bake go-red.webp   512 '#b8432c' 45 "$T/steel-brushed.webp:512" "$T/scratches.webp:256" "$G:128"
bake go-violet.webp 512 '#6a5a98' 45 "$T/steel-brushed.webp:512" "$T/scratches.webp:256" "$G:128"
# Ремень ползунка прокрутки
bake strap.webp    300 '#26211c' 40 "$T/leather.webp:300"
ls -la "$O"
