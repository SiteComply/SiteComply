#!/usr/bin/env bash
# Permit record PDF verification.
#
#   ./scripts/permit_record_verify.sh
#
# WHY NOT `npx tsx` like most suites: tsx compiles the service modules to
# CommonJS, and @react-pdf/renderer ships an ESM-only build, so requiring it
# dies — its CJS entry reaches for `@react-pdf/hyphenate/en-us`, a subpath its
# own `exports` map does not publish. Neither is a problem in the app, where
# webpack resolves the ESM build. The same wrapper the CPP PDF suite uses.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=node_modules/.cache/permit_record_verify.mjs
npx esbuild scripts/permit_record_verify.ts \
  --bundle --platform=node --format=esm --packages=external \
  --alias:@=. --outfile="$OUT" --log-level=error
exec node "$OUT"
