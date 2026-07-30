#!/usr/bin/env bash
# SC-020 Phase 4 — create/update the hourly compliance scheduler timer.
#
# Idempotent: safe to re-run to update the function code or its settings.
# See azure/scheduler-function/README.md for why this is a Function App timer
# rather than the originally preferred Logic App recurrence.
set -euo pipefail

RG=rgSiteComply
LOC=uksouth
WEBAPP=sitecomply-web
FNAPP=sitecomply-scheduler
STORAGE=scschedfn
SRC=azure/scheduler-function
ZIP=/tmp/sc020p4_timer.zip

echo "== SC-020 PHASE 4 SCHEDULER TIMER =="

echo "[1/6] Reading SCHEDULER_SECRET from the web app (single source of truth)..."
SECRET=$(az webapp config appsettings list -g "$RG" -n "$WEBAPP" \
  --query "[?name=='SCHEDULER_SECRET'].value | [0]" -o tsv)
if [ -z "$SECRET" ] || [ "$SECRET" = "None" ]; then
  echo "      ERROR: SCHEDULER_SECRET is not set on $WEBAPP. Set it first —"
  echo "      the tick endpoint stays disabled (503) without it."
  exit 1
fi
echo "      got it (${#SECRET} chars)."

echo "[2/6] Ensuring storage account '$STORAGE'..."
if az storage account show -g "$RG" -n "$STORAGE" -o none 2>/dev/null; then
  echo "      already exists."
else
  az storage account create -g "$RG" -n "$STORAGE" -l "$LOC" \
    --sku Standard_LRS --kind StorageV2 --min-tls-version TLS1_2 \
    --allow-blob-public-access false -o none
  echo "      created."
fi

echo "[3/6] Ensuring function app '$FNAPP'..."
if az functionapp show -g "$RG" -n "$FNAPP" -o none 2>/dev/null; then
  echo "      already exists."
else
  az functionapp create -g "$RG" -n "$FNAPP" \
    --storage-account "$STORAGE" \
    --consumption-plan-location "$LOC" \
    --runtime node --runtime-version 20 --functions-version 4 \
    --os-type Linux --disable-app-insights true -o none
  echo "      created."
fi

echo "[4/6] Applying settings..."
az functionapp config appsettings set -g "$RG" -n "$FNAPP" --settings \
  "SCHEDULER_SECRET=$SECRET" \
  "TICK_URL=https://$WEBAPP.azurewebsites.net/api/system/compliance/tick" \
  -o none
echo "      SCHEDULER_SECRET + TICK_URL set."

echo "[5/6] Packaging and deploying the function..."
rm -f "$ZIP"
( cd "$SRC" && zip -rq "$ZIP" . )
az functionapp deployment source config-zip -g "$RG" -n "$FNAPP" --src "$ZIP" -o none
echo "      deployed."

echo "[6/6] Confirming the function is registered..."
for i in $(seq 1 20); do
  NAMES=$(az functionapp function list -g "$RG" -n "$FNAPP" --query "[].name" -o tsv 2>/dev/null || true)
  if [ -n "$NAMES" ]; then
    echo "      functions: $NAMES"
    break
  fi
  sleep 15
done
if [ -z "${NAMES:-}" ]; then
  echo "      *** function not visible yet — check 'az functionapp function list' shortly ***"
  exit 1
fi

echo "== TIMER READY: hourly at :05, calling POST /api/system/compliance/tick =="
