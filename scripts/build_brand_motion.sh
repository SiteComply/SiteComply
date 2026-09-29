#!/usr/bin/env bash
# BUILD THE REUSABLE BRANDED ANIMATION ASSETS.
#
# Run once, and again whenever the branding or a bumper wording changes. The output is
# COMMITTED to public/brand-motion, because these are brand assets that belong to the
# build the way the vendored ffmpeg binary does - always present, always matching the
# code that expects them, no storage round-trip and no availability check that
# narration and rendering could disagree about.
#
# ── WHY THIS IS WORTH DOING AT ALL ────────────────────────────────────────
#
# On the B1 that serves the site, fifteen seconds of even STATIC video costs about
# ninety-five seconds of CPU, and per-frame movement roughly doubles that. A clip built
# here and joined by stream copy costs about a second, whatever is in it. So this
# script is where every piece of real motion in an induction comes from.
#
# ── THE DURATION IS A CONTRACT ────────────────────────────────────────────
#
# Captions are timed during narration by adding up the running order, so each file's
# length must match the declaration in brandMotion.ts exactly. The durations below and
# those constants are checked against each other by scripts/brand_motion_verify.ts.
set -uo pipefail
cd "$(dirname "$0")/.."
FF="${FFMPEG_PATH:-$PWD/vendor/ffmpeg/ffmpeg}"
OUT="${INDUCTION_BRAND_MOTION_DIR:-$PWD/public/brand-motion}"
LOGO="${INDUCTION_VIDEO_LOGO:-$PWD/public/sitecomply-logo.png}"
mkdir -p "$OUT"
test -x "$FF" || { echo "FAIL no ffmpeg at $FF"; exit 1; }
test -f "$LOGO" || { echo "FAIL no logo at $LOGO"; exit 1; }

W=1080; H=1920; FPS=25
BRAND_DEEP=0x003A54
BRAND_BLUE=0x00AEEF
DANGER=0xB91C1C
HIVIS=0xFACC15
SAFE=0x39B54A
PAPER=0xFFFFFF

# Every clip is encoded to the pipeline spec so it can be stream-copied into an
# induction: same size, rate, pixel format and one stereo 44.1 kHz AAC track. The
# audio is SILENT - a sting that made a noise would fight the narration that follows.
enc() {
  local out="$1" secs="$2"; shift 2
  "$FF" -hide_banner -loglevel error -nostdin -y "$@" \
    -f lavfi -i "anullsrc=channel_layout=stereo:sample_rate=44100" \
    -t "$secs" -map '[v]' -map "${AUDIO_IN:-1}:a" \
    -c:v libx264 -preset veryfast -crf 21 -g $((FPS*2)) -pix_fmt yuv420p \
    -c:a aac -b:a 96k -ar 44100 -ac 2 -movflags +faststart "$OUT/$out" || return 1
  printf '  %-22s %s\n' "$(basename "$out")" "$("$FF" -hide_banner -i "$OUT/$out" 2>&1 | grep -oE 'Duration: [0-9:.]+' | head -1)"
}

# A title card with a word on it, animated by libass. One ASS file per bumper.
ass_for() {
  local text="$1" colour="$2" ms="$3"
  cat <<ASS
[Script Info]
ScriptType: v4.00+
PlayResX: $W
PlayResY: $H
WrapStyle: 0
ScaledBorderAndShadow: yes
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: B,DejaVu Sans,96,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,2,0,1,0,0,5,90,90,0,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Text
Dialogue: 0,0:00:00.00,0:00:0${ms},B,,0,0,0,{\\fad(260,240)\\t(0,520,\\fscx104\\fscy104)}$text
ASS
}

echo "Building branded motion into $OUT"

# ── THE OPENING STING ─────────────────────────────────────────────────────
# The mark grows very slightly and settles on brand deep, with a blue rule sweeping
# in beneath it. Restrained on purpose: it plays before EVERY induction, and anything
# flashy becomes tiresome by the third viewing.
AUDIO_IN=2 enc "sting.mp4" 2.4 \
  -f lavfi -i "color=c=$BRAND_DEEP:s=${W}x${H}:r=$FPS" \
  -loop 1 -i "$LOGO" \
  -filter_complex "[1:v]scale=$((W*52/100)):-1[lg];[0:v][lg]overlay=(W-w)/2:(H-h)/2-60:format=auto[o];[o]drawbox=x='if(lt(t,1.1),(iw/2)-(iw*0.11*(t/1.1)),(iw/2)-(iw*0.11))':y=$((H/2+130)):w='if(lt(t,1.1),iw*0.22*(t/1.1),iw*0.22)':h=8:color=$BRAND_BLUE@1.0:t=fill[b];[b]fade=t=in:st=0:d=0.4,fade=t=out:st=2.0:d=0.4[v]"

# ── THE CLOSING PLATE ─────────────────────────────────────────────────────
AUDIO_IN=2 enc "closing.mp4" 2.0 \
  -f lavfi -i "color=c=$BRAND_DEEP:s=${W}x${H}:r=$FPS" \
  -loop 1 -i "$LOGO" \
  -filter_complex "[1:v]scale=$((W*44/100)):-1[lg];[0:v][lg]overlay=(W-w)/2:(H-h)/2:format=auto[o];[o]fade=t=in:st=0:d=0.35,fade=t=out:st=1.6:d=0.4[v]"

# ── ONE BUMPER PER FAMILY ─────────────────────────────────────────────────
#
# THE RULE SITS ABOVE THE TITLE, at 40% of the frame height. It was at 46%, which is
# where a two-line title's FIRST line lands when the text is centred at 50% - so the
# rule drew straight through the words. Nothing automated noticed: the clip rendered,
# its duration was right, the frame had content. It took looking at a frame.
# Colour carries the meaning: brand for the company speaking, red for emergency,
# hi-vis for hazards, green for welfare. A viewer learns them in one induction.
bumper() {
  local key="$1" text="$2" bg="$3" rule="$4" secs="$5"
  local ms; ms=$(printf '%.2f' "$secs")
  ass_for "$text" "$rule" "$ms" > "/tmp/bm-$key.ass"
  AUDIO_IN=1 enc "$key.mp4" "$secs" \
    -f lavfi -i "color=c=$bg:s=${W}x${H}:r=$FPS" \
    -filter_complex "[0:v]drawbox=x=0:y=$((H*40/100)):w='if(lt(t,0.5),iw*(t/0.5),iw)':h=6:color=$rule@1.0:t=fill,ass=/tmp/bm-$key.ass,fade=t=in:st=0:d=0.25,fade=t=out:st=$(awk "BEGIN{printf \"%.2f\", $secs-0.3}"):d=0.3[v]"
}

bumper "bumper-opening"   "WELCOME"                 "$BRAND_DEEP" "$BRAND_BLUE" 1.2
bumper "bumper-project"   "THIS PROJECT"            "$BRAND_DEEP" "$BRAND_BLUE" 1.2
bumper "bumper-emergency" "IN AN EMERGENCY"         "$DANGER"     "$PAPER"      1.4
bumper "bumper-hazard"    "HAZARDS AND CONTROLS"    "0x1F2937"    "$HIVIS"      1.4
bumper "bumper-access"    "GETTING AROUND SITE"     "$BRAND_DEEP" "$BRAND_BLUE" 1.2
bumper "bumper-welfare"   "WELFARE AND ENVIRONMENT" "0x14532D"    "$SAFE"       1.2
bumper "bumper-standards" "WHAT WE EXPECT"          "$BRAND_DEEP" "$BRAND_BLUE" 1.2
bumper "bumper-closing"   "BEFORE YOU START"        "$BRAND_DEEP" "$BRAND_BLUE" 1.2

echo
echo "Done. $(ls -1 "$OUT"/*.mp4 | wc -l) clips, $(du -sh "$OUT" | cut -f1) total."
echo "Now run: npx tsx scripts/brand_motion_verify.ts"
