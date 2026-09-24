#!/usr/bin/env bash
# Render every document from its fixture, for before/after comparison.
#   ./scripts/pdf_visual_render.sh /tmp/before
# @react-pdf is ESM-only, so the script is bundled and run by node — see
# scripts/permit_record_verify.sh for the full explanation.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=node_modules/.cache/pdf_visual_render.mjs
npx esbuild scripts/pdf_visual_render.ts \
  --bundle --platform=node --format=esm --packages=external \
  --alias:@=. --outfile="$OUT" --log-level=error
exec node "$OUT" "$@"
