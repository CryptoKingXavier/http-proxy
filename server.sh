#!/usr/bin/env bash
# ==============================================================================
# Script Name: server.sh
# Description: End-to-end integration test & demonstration script comparing
#              standard HTTP GET requests against the new HTTP QUERY method
#              (RFC 10008) across two local TypeScript servers.
# ==============================================================================

# Exit immediately if any command exits with a non-zero status, treat unset
# variables as errors, and fail pipelines if any component fails.
clear
set -euo pipefail

# ------------------------------------------------------------------------------
# 1. Server Lifecycle Management & Cleanup Trap
# ------------------------------------------------------------------------------
echo "Starting servers..."

# Creating time lapse for serving up both servers as daemons
sleep 0.1
echo "Servers ready (GET :3000, QUERY :3001)"
echo ""

# Launch the GET server (port 3000) and QUERY server (port 3001) in the background.
# Note: Uses Node's native TypeScript execution (Node 22.6+) or tsx/ts-node.
# Replace `npx tsx` with `node` if using Node.js v23.6+ native TS stripping.
# Replace `/dev/null` with a corresponding log file.
./node_modules/.bin/tsx get-server.ts > ./logs/get-server.log 2>&1 &
GET_PID=$!

./node_modules/.bin/tsx query-server.ts > ./logs/query-server.log 2>&1 &
QUERY_PID=$!

# Define a cleanup function to guarantee background server processes are
# terminated when the script finishes, exits early, or receives an interrupt.
cleanup() {
  echo "Done. Shutting down servers..."

  # 1. Kill child processes spawned by npx/tsx, then the parent PIDs themselves
  for pid in "${GET_PID:-}" "${QUERY_PID:-}"; do
    if [ -n "$pid" ]; then
      pkill -P "$pid" 2>/dev/null || true
      kill -9 "$pid" 2>/dev/null || true
    fi
  done

  # 2. Fallback: force-free ports 3000 and 3001 if any orphaned Node process remains
  for port in 3000 3001; do
    if command -v fuser >/dev/null 2>&1; then
      fuser -k "${port}/tcp" >/dev/null 2>&1 || true
    elif command -v lsof >/dev/null 2>&1; then
      lsof -ti :"$port" | xargs -r kill -9 2>/dev/null || true
    fi
  done

  wait 2>/dev/null || true
}

# Register the cleanup function on normal EXIT, INT (Ctrl+C), kill signals (TERM), or errors (ERR).
trap cleanup EXIT INT TERM ERR

# Poll both ports until the servers are actively accepting TCP connections
# rather than relying on an arbitrary hardcoded `sleep` duration.
for port in 3000 3001; do
  # while ! nc -z localhost "$port" 2>/dev/null; do
  while curl -s "http://localhost:$port" >/dev/null 2>&1 || [ $? -eq 52 ]; do
    sleep 0.1
  done
done
