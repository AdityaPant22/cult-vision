#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BACKEND_VENV="$ROOT_DIR/.venv-backend/bin/python"
BACKEND_CACHE_DIR="$ROOT_DIR/backend/data/runtime-cache"
BACKEND_MPL_DIR="$BACKEND_CACHE_DIR/matplotlib"

mkdir -p "$BACKEND_MPL_DIR" "$ROOT_DIR/.pycache"

if [[ ! -d "$ROOT_DIR/node_modules" ]]; then
  echo "Missing frontend dependencies. Run: npm install"
  exit 1
fi

if [[ ! -x "$BACKEND_VENV" ]]; then
  echo "Missing backend virtualenv. Run:"
  echo "  python3 -m venv .venv-backend"
  echo "  .venv-backend/bin/pip install -r backend/requirements.txt"
  exit 1
fi

if command -v lsof >/dev/null 2>&1; then
  if lsof -ti tcp:8000 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port 8000 is already in use. Stop the existing backend or change the port."
    exit 1
  fi

  if lsof -ti tcp:5173 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port 5173 is already in use. Stop the existing frontend or change the port."
    exit 1
  fi
fi

export MPLCONFIGDIR="$BACKEND_MPL_DIR"
export XDG_CACHE_HOME="$BACKEND_CACHE_DIR"
export PYTHONPYCACHEPREFIX="$ROOT_DIR/.pycache"

backend_pid=""
frontend_pid=""

cleanup() {
  if [[ -n "$frontend_pid" ]] && kill -0 "$frontend_pid" >/dev/null 2>&1; then
    kill "$frontend_pid" >/dev/null 2>&1 || true
  fi

  if [[ -n "$backend_pid" ]] && kill -0 "$backend_pid" >/dev/null 2>&1; then
    kill "$backend_pid" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

echo "[api] starting FastAPI backend on 127.0.0.1:8000"
.venv-backend/bin/uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000 &
backend_pid=$!

echo "[web] starting Vite frontend on 0.0.0.0:5173"
npm run dev &
frontend_pid=$!

echo "Cult Vision is starting..."
echo "Kiosk: http://localhost:5173"
echo "Analysis: http://localhost:5173/analysis"
echo "Backend health: http://127.0.0.1:8000/health"
echo "Press Ctrl+C to stop both services."

while true; do
  backend_running=1
  frontend_running=1

  if [[ -n "$backend_pid" ]] && ! kill -0 "$backend_pid" >/dev/null 2>&1; then
    backend_running=0
  fi

  if [[ -n "$frontend_pid" ]] && ! kill -0 "$frontend_pid" >/dev/null 2>&1; then
    frontend_running=0
  fi

  if [[ "$backend_running" -eq 0 || "$frontend_running" -eq 0 ]]; then
    break
  fi

  sleep 1
done

wait "$backend_pid" 2>/dev/null || true
wait "$frontend_pid" 2>/dev/null || true
