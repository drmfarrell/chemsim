#!/usr/bin/env bash
# launch.sh — start a ChemSim web server instance.
#
# Two modes:
#   --dev       (default) Vite dev server with HMR. What you edit against.
#   --preview   Serve the production build from dist/. Stable; no hot-
#               reload means editing source won't disturb students' running
#               simulations. This is what you want for the classroom-
#               facing instance.
#
# Typical two-instance setup:
#   Terminal 1 (dev, your local work):
#     ./launch.sh
#   Terminal 2 (screen, student-facing, LAN):
#     screen -S chemsim-student
#     ./launch.sh --preview --port 3001 --host 0.0.0.0
#     Ctrl-A then D to detach.
#     Reattach with:   screen -r chemsim-student
#
# Notes:
# - Both modes serve HTTPS via @vitejs/plugin-basic-ssl. Students click
#   through the self-signed-cert warning on first visit; this is required
#   for SharedArrayBuffer (parallel physics).
# - `--strictPort` is on, so if the port is already in use the command
#   fails instead of silently picking a different one. That way you
#   always know where each instance is.
# - Uses nvm-installed node if ~/.nvm is present, plus $HOME/.cargo/bin
#   for wasm-pack.
# - Rebuilds the wasm physics engine on first run or when explicitly
#   asked; subsequent launches skip that step.

set -euo pipefail

PORT=""
HOST=""
MODE=dev
REBUILD_WASM=0

usage() {
  cat <<'EOF'
Usage: ./launch.sh [options]

Options:
  -p, --port PORT        Server port.
                           Default dev: 3000
                           Default preview: 4173
  -H, --host HOST        Bind address (default: 0.0.0.0, listens on all
                         interfaces so LAN peers can connect).
      --preview          Serve the production build (Vite preview) —
                         stable, no hot-reload. Use for the student-
                         facing instance in a screen session.
      --dev              (default) Vite dev server with HMR.
      --rebuild-wasm     Force a wasm rebuild before starting.
  -h, --help             Show this message.

Examples:
  ./launch.sh
  ./launch.sh --preview --port 3001 --host 0.0.0.0
  ./launch.sh --rebuild-wasm --port 3002
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -p|--port)     PORT="$2"; shift 2;;
    -H|--host)     HOST="$2"; shift 2;;
    --preview)     MODE=preview; shift;;
    --dev)         MODE=dev; shift;;
    --rebuild-wasm) REBUILD_WASM=1; shift;;
    -h|--help)     usage; exit 0;;
    *)             echo "unknown argument: $1" >&2; usage >&2; exit 1;;
  esac
done

# Default port depends on mode.
if [ -z "$PORT" ]; then
  if [ "$MODE" = preview ]; then PORT=4173; else PORT=3000; fi
fi
# Default host is all-interfaces so LAN works; user can override with
# --host localhost for a dev-only instance they don't want peers hitting.
if [ -z "$HOST" ]; then HOST=0.0.0.0; fi

# Work from the repo root (where this script lives).
cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")"

# Find the node + rust toolchains.
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  source "$HOME/.nvm/nvm.sh"
fi
export PATH="$HOME/.cargo/bin:$PATH"

if ! command -v node >/dev/null 2>&1; then
  echo "[launch] node not found. Install Node via nvm or your package manager." >&2
  exit 1
fi

# Rebuild wasm if missing or explicitly requested.
if [ "$REBUILD_WASM" = 1 ] || [ ! -f src/wasm-pkg/chemsim_physics_bg.wasm ]; then
  echo "[launch] Building wasm physics engine..."
  npm run build:wasm
fi

if [ "$MODE" = preview ]; then
  # Preview serves dist/ — build first if it's missing.
  if [ ! -d dist ] || [ ! -f dist/index.html ]; then
    echo "[launch] dist/ missing — running full production build first..."
    npm run build
  else
    echo "[launch] dist/ present; skipping rebuild. Delete dist/ and rerun --preview to rebuild."
  fi
  echo "[launch] Starting Vite preview on https://$HOST:$PORT"
  exec npx vite preview --host "$HOST" --port "$PORT" --strictPort
else
  echo "[launch] Starting Vite dev server on https://$HOST:$PORT"
  exec npx vite --host "$HOST" --port "$PORT" --strictPort
fi
