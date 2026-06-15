#!/usr/bin/env bash
# Start gift_india India locally — the AppKit web app (React + Express) on live
# Lakebase Postgres. Usage:  ./startup.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$ROOT_DIR/gift_india_web"
PROFILE="${DATABRICKS_CONFIG_PROFILE:-gift-india}"
HOST="https://dbc-0be3157e-0574.cloud.databricks.com"

echo "▶ gift_india India — local startup"

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

# 2. Kill any prior dev server and free the target port.
PORT="${DATABRICKS_APP_PORT:-8000}"
echo "▶ Stopping any existing dev server / process on port $PORT…"
pkill -f "tsx watch .*server/server.ts" 2>/dev/null || true
if command -v lsof >/dev/null 2>&1; then
  lsof -ti:"$PORT" 2>/dev/null | xargs -r kill -9 2>/dev/null || true
elif command -v fuser >/dev/null 2>&1; then
  fuser -k "${PORT}/tcp" 2>/dev/null || true
fi

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
exec npm run dev
