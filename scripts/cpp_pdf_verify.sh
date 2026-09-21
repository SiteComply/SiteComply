#!/usr/bin/env bash
# CPP PDF verification.
#
#   ./scripts/cpp_pdf_verify.sh
#
# WHY THIS IS NOT `npx tsx scripts/cpp_pdf_verify.ts` like every other suite:
# tsx compiles the service modules to CommonJS, and @react-pdf/renderer ships an
# ESM-only build, so a `require` of it dies with ERR_REQUIRE_ESM. Its CJS entry
# is no better — it reaches for `@react-pdf/hyphenate/en-us`, a subpath its own
# `exports` map does not publish. Neither is a problem in the app: webpack
# resolves the ESM build correctly, which is why the induction record PDF has
# worked in production all along.
#
# So the suite is bundled to ESM by esbuild and run by node. The bundle lands
# inside the project because a file in /tmp cannot resolve node_modules.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=node_modules/.cache/cpp_pdf_verify.mjs
npx esbuild scripts/cpp_pdf_verify.ts \
  --bundle --platform=node --format=esm --packages=external \
  --alias:@=. --outfile="$OUT" --log-level=error
exec node "$OUT"
