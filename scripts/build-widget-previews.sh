#!/bin/bash
# Generates the widget previews (preview-light.png / preview-dark.png) for every widget.
#
# Homey App Store guideline 1.10: 1024 x 1024 PNG, transparent background, simple shapes,
# no text, no screenshots, few colours, a soft shadow. Requires ImageMagick (`magick`).
#
# Usage:  bash scripts/build-widget-previews.sh
# Run from the app root.

set -euo pipefail

command -v magick >/dev/null || { echo "ERROR: ImageMagick (magick) is required" >&2; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

GREEN="#2E8B3D"
RED="#C0392B"
R=56 # card corner radius

# card <file> <width> <height> <card colour>
card() {
  magick -size "$2x$3" xc:none -fill "$4" -draw "roundrectangle 0,0 $(($2 - 1)),$(($3 - 1)) $R,$R" "$1"
}

# finish <card file> <output file>: soft shadow, centred on a transparent 1024 x 1024 canvas.
finish() {
  magick -size 1024x1024 xc:none \
    \( "$1" \( +clone -background black -shadow 30x26+0+18 \) +swap -background none -layers merge +repage \) \
    -gravity center -compose over -composite "$2"
}

# draw <file> <draw args...>: draws onto an existing card.
draw() {
  local file="$1"; shift
  magick "$file" "$@" "$file"
}

widget_status() { # 880 x 560: status dot, two text-like bars, three buttons (middle one active)
  local f="$1" block="$2"
  card "$f" 880 560 "$CARD"
  draw "$f" -fill "$GREEN" -draw "circle 150,150 150,212" \
    -fill "$block" -draw "roundrectangle 250,105 650,155 25,25" -draw "roundrectangle 250,185 520,219 17,17" \
    -draw "roundrectangle 60,340 293,480 36,36" -draw "roundrectangle 586,340 819,480 36,36" \
    -fill "$GREEN" -draw "roundrectangle 323,340 556,480 36,36"
}

widget_alarm_stop() { # 880 x 400: one big round button
  local f="$1" block="$2"
  card "$f" 880 400 "$CARD"
  draw "$f" -fill "$RED" -draw "circle 440,200 440,330" -fill "white" -draw "roundrectangle 392,152 488,248 18,18"
}

widget_bypass() { # 880 x 460: title bar, progress track, three pill buttons
  local f="$1" block="$2" line="$3"
  card "$f" 880 460 "$CARD"
  draw "$f" -fill "$block" -draw "roundrectangle 60,66 480,106 20,20" -draw "roundrectangle 60,170 820,214 22,22" \
    -draw "roundrectangle 60,290 293,400 36,36" -draw "roundrectangle 323,290 556,400 36,36" -draw "roundrectangle 586,290 819,400 36,36" \
    -fill "$GREEN" -draw "roundrectangle 60,170 520,214 22,22"
}

widget_event_log() { # 880 x 700: four rows with a coloured dot and two bars
  local f="$1" block="$2" line="$3"
  card "$f" 880 700 "$CARD"
  local colours=("$RED" "$GREEN" "$GREEN" "$line") i y
  for i in 0 1 2 3; do
    y=$((70 + i * 150))
    draw "$f" -fill "${colours[$i]}" -draw "circle 100,$((y + 38)) 100,$((y + 62))" \
      -fill "$block" -draw "roundrectangle 160,$y 780,$((y + 44)) 22,22" \
      -fill "$line" -draw "roundrectangle 160,$((y + 66)) 540,$((y + 90)) 12,12"
  done
}

widget_snapshot() { # 880 x 660: picture placeholder (sun and two hills) with a red alarm dot
  local f="$1" block="$2" line="$3"
  card "$f" 880 660 "$CARD"
  draw "$f" -fill "$block" -draw "roundrectangle 40,40 839,619 36,36" \
    -fill "$line" -draw "circle 240,200 240,255" \
    -draw "polygon 140,590 380,330 620,590" -draw "polygon 440,590 620,420 780,590" \
    -fill "$RED" -draw "circle 770,110 770,148"
}

for theme in light dark; do
  if [ "$theme" = "light" ]; then
    CARD="#FFFFFF"; BLOCK="#E3E6EA"; LINE="#C7CCD3"
  else
    CARD="#2C2C2E"; BLOCK="#48484A"; LINE="#636366"
  fi

  widget_status        "$TMP/status.png" "$BLOCK"
  widget_alarm_stop    "$TMP/stop.png"   "$BLOCK"
  widget_bypass        "$TMP/bypass.png" "$BLOCK" "$LINE"
  widget_event_log     "$TMP/log.png"    "$BLOCK" "$LINE"
  widget_snapshot      "$TMP/snap.png"   "$BLOCK" "$LINE"

  finish "$TMP/status.png" "widgets/guard-status/preview-$theme.png"
  finish "$TMP/stop.png"   "widgets/alarm-stop/preview-$theme.png"
  finish "$TMP/bypass.png" "widgets/perimeter-bypass/preview-$theme.png"
  finish "$TMP/log.png"    "widgets/event-log/preview-$theme.png"
  finish "$TMP/snap.png"   "widgets/latest-snapshot/preview-$theme.png"
done

echo "Widget previews written (1024x1024, transparent, no text)."
