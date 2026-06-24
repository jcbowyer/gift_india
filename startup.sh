#!/usr/bin/env bash
# Start Governance, Integrity, & Facility Trust (GIFT) Gauge locally — the AppKit web app (React + Express) on live
# Lakebase Postgres. Usage:  ./startup.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$ROOT_DIR/gift_india_web"
PROFILE="${DATABRICKS_CONFIG_PROFILE:-gift-india-mb}"
HOST="https://dbc-0951416d-6d0e.cloud.databricks.com"

# AppKit's dev server resolves the workspace via this profile — export it so the
# `npm run dev` child process inherits it (otherwise DATABRICKS_HOST is unset).
export DATABRICKS_CONFIG_PROFILE="$PROFILE"
export DATABRICKS_HOST="$HOST"

echo "▶ Governance, Integrity, & Facility Trust (GIFT) Gauge — local startup"

# 1. The web app reads live Lakebase via this Databricks CLI profile.
if ! command -v databricks >/dev/null 2>&1; then
  echo "✖ Databricks CLI not found on PATH. Install it: https://docs.databricks.com/dev-tools/cli/"
  exit 1
fi
if ! databricks current-user me --profile "$PROFILE" >/dev/null 2>&1; then
  echo "✖ Databricks profile '$PROFILE' is not authenticated."
  echo "  Run: databricks auth login --profile $PROFILE --host $HOST"
  exit 1
fi
echo "✓ Databricks profile '$PROFILE' authenticated"

# 1b. Load repo .env so local Postgres (:5433) wins over a stale shell export on :5432.
if [ -f "$ROOT_DIR/.env" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$ROOT_DIR/.env"
  set +a
fi
if [ -z "${GIFT_INDIA_DB_URL:-}" ] && [ -n "${GIFT_INDIA_PGPORT:-}" ]; then
  export GIFT_INDIA_DB_URL="postgresql://${GIFT_INDIA_PGUSER:-postgres}:${GIFT_INDIA_PGPASSWORD:-}@${GIFT_INDIA_PGHOST:-localhost}:${GIFT_INDIA_PGPORT}/${GIFT_INDIA_PGDATABASE:-gift_india}"
fi

# 2. Kill any prior dev server, Vite HMR websocket, and free the target port.
PORT="${DATABRICKS_APP_PORT:-8000}"
echo "▶ Stopping any existing dev server / Vite HMR / process on port $PORT…"
pkill -f "tsx watch .*server/server.ts" 2>/dev/null || true
pkill -f "vite.*gift_india_web" 2>/dev/null || true
if command -v lsof >/dev/null 2>&1; then
  # App HTTP port + common fallbacks when 8000 is busy.
  for p in "$PORT" 8001 8002 24678 24679; do
    lsof -ti:"$p" 2>/dev/null | xargs -r kill -9 2>/dev/null || true
  done
elif command -v fuser >/dev/null 2>&1; then
  fuser -k "${PORT}/tcp" 2>/dev/null || true
  fuser -k 24678/tcp 2>/dev/null || true
fi
sleep 0.5

# 3. Install web dependencies on first run.
cd "$WEB_DIR"
if [ ! -d node_modules ]; then
  echo "▶ Installing web dependencies (npm install)…"
  npm install
fi

# 4. Open the web client in a browser once the dev server is accepting connections.
URL="http://localhost:$PORT"
open_browser() {
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1
  elif command -v wslview >/dev/null 2>&1; then wslview "$URL" >/dev/null 2>&1
  elif command -v open >/dev/null 2>&1; then open "$URL" >/dev/null 2>&1
  elif command -v powershell.exe >/dev/null 2>&1; then powershell.exe -NoProfile Start-Process "$URL" >/dev/null 2>&1
  else echo "  (Could not auto-open a browser — visit $URL manually.)"; fi
}
(
  for _ in $(seq 1 60); do
    if (exec 3<>"/dev/tcp/localhost/$PORT") 2>/dev/null; then exec 3>&- 3<&-; break; fi
    sleep 0.5
  done
  echo "▶ Opening $URL in your browser…"
  open_browser
) &

# 5. Run the dev server — serves both the web client and the /api routes.
echo "▶ Starting dev server on $URL (Ctrl-C to stop)…"
echo "  If the terminal later says a different port (e.g. 8001), use that URL instead."
echo "  After a Vite error, hard-refresh the browser (Ctrl+Shift+R)."
exec npm run dev
