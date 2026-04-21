#!/usr/bin/env bash
# launch.sh — start a ChemSim web server.
#
# Two modes:
#
#   --dev       (default) Vite dev server with hot-reload. Edits to the
#               source show up in the browser immediately. Use this on
#               your own machine while editing code.
#
#   --serve     Serve the production build from dist/. Stable across
#               code edits (no hot-reload), slightly faster runtime, and
#               does NOT re-bundle every time you save a file. Use this
#               for the student-facing instance in a screen session so
#               your edits don't disturb their running simulations.
#
# Use `--fresh` together with `--serve` whenever you've changed source
# and want those changes reflected in the served bundle. Without
# `--fresh`, `--serve` will reuse whatever's already in dist/.

set -euo pipefail

PORT=""
HOST=""
MODE=dev
REBUILD_WASM=0
FRESH=0

usage() {
  cat <<'EOF'
Usage: ./launch.sh [options]

WHAT TO RUN:

  --dev                  (default) Vite dev server. Fast iteration:
                         edits to TypeScript / HTML / CSS reload the
                         browser automatically. HMR on.

  --serve                Serve the production build from dist/.
                         Stable for students — ignores your source-
                         code edits until you rebuild. (Previously
                         called --preview; --preview still works.)

WHERE TO LISTEN:

  -p, --port PORT        Server port.
                           Default with --dev:    3000
                           Default with --serve:  4173
                         `--strictPort` is on — if the port is taken
                         the command fails instead of silently picking
                         another.

  -H, --host HOST        Bind address.
                           Default: 0.0.0.0  (all interfaces; LAN peers
                                              can reach you)
                         Pass `--host localhost` for a dev-only
                         instance that only accepts connections from
                         the same machine.

REBUILD CONTROLS:

  -f, --fresh            Delete dist/ and the wasm output before
                         starting. Use after pulling new commits or
                         finishing a round of edits you want students
                         to see. Roughly 2 seconds of rebuild.

  --rebuild-wasm         Force a wasm rebuild but keep existing dist/.
                         Rarely needed — use --fresh to rebuild
                         everything from source instead.

  -h, --help             Show this message.

COMMON WORKFLOWS:

  # Your editing loop. Changes hot-reload.
  ./launch.sh

  # Student-facing instance in a detached screen session.
  # Students hit https://<your-LAN-IP>:3001/ and click through the
  # self-signed-cert warning once per browser.
  screen -S chemsim-student
  ./launch.sh --serve --port 3001 --host 0.0.0.0
  # Ctrl-A then D to detach. Reattach with: screen -r chemsim-student

  # After editing source and wanting the student instance updated:
  screen -r chemsim-student
  # Ctrl-C to kill vite preview, then:
  ./launch.sh --serve --fresh --port 3001 --host 0.0.0.0
  # Ctrl-A then D to re-detach. Students need to hard-refresh
  # (Ctrl+Shift+R / Cmd+Shift+R) to pick up the new bundle.

HTTPS NOTE:

Both modes serve HTTPS via a self-signed cert (required for
SharedArrayBuffer / parallel physics to work in the browser).
Students see "Your connection is not private" on first visit —
they click Advanced → Proceed / Continue, once per browser, per
host. It's safe on a LAN; it's just the browser complaining that
your cert wasn't issued by a public CA.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -p|--port)      PORT="$2"; shift 2;;
    -H|--host)      HOST="$2"; shift 2;;
    --serve|--preview) MODE=serve; shift;;
    --dev)          MODE=dev; shift;;
    -f|--fresh)     FRESH=1; shift;;
    --rebuild-wasm) REBUILD_WASM=1; shift;;
    -h|--help)      usage; exit 0;;
    *)              echo "unknown argument: $1" >&2; echo >&2; usage >&2; exit 1;;
  esac
done

# Default port depends on mode.
if [ -z "$PORT" ]; then
  if [ "$MODE" = serve ]; then PORT=4173; else PORT=3000; fi
fi
# Default host is all-interfaces.
if [ -z "$HOST" ]; then HOST=0.0.0.0; fi

# Work from the repo root (where this script lives).
cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")"

# Find node + rust toolchains.
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  source "$HOME/.nvm/nvm.sh"
fi
export PATH="$HOME/.cargo/bin:$PATH"

if ! command -v node >/dev/null 2>&1; then
  echo "[launch] node not found. Install via nvm or your package manager." >&2
  exit 1
fi

# --fresh wipes dist/ and (for --serve) forces a rebuild below. It also
# forces a wasm rebuild since the two usually move together.
if [ "$FRESH" = 1 ]; then
  echo "[launch] --fresh: removing dist/ and forcing wasm rebuild"
  rm -rf dist
  REBUILD_WASM=1
fi

# Rebuild wasm if missing or explicitly requested.
if [ "$REBUILD_WASM" = 1 ] || [ ! -f src/wasm-pkg/chemsim_physics_bg.wasm ]; then
  echo "[launch] Building wasm physics engine..."
  npm run build:wasm
fi

if [ "$MODE" = serve ]; then
  # Serve mode runs the production build from dist/. Build it if it's
  # missing (first run after `rm -rf dist` or after --fresh).
  if [ ! -d dist ] || [ ! -f dist/index.html ]; then
    echo "[launch] dist/ missing — running full production build..."
    npm run build
  else
    echo "[launch] dist/ present; serving existing build."
    echo "         Rerun with --fresh if you've edited source since the build."
  fi
  echo "[launch] Starting production serve on https://$HOST:$PORT"
  exec npx vite preview --host "$HOST" --port "$PORT" --strictPort
else
  echo "[launch] Starting Vite dev server on https://$HOST:$PORT"
  exec npx vite --host "$HOST" --port "$PORT" --strictPort
fi
