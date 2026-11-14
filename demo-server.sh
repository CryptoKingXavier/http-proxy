#!/usr/bin/env bash
# ==============================================================================
# Script Name: demo-server.sh
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
  until curl -s "http://localhost:$port" >/dev/null 2>&1 || [ $? -eq 52 ]; do
    sleep 0.1
  done
done

echo "Servers ready (GET :3000, QUERY :3001)"
echo ""

# ------------------------------------------------------------------------------
# 2. Helper Functions for Formatted Output & HTTP Status Inspection
# ------------------------------------------------------------------------------

# Executes a curl command, formats JSON output if jq is installed, and prints
# the exact HTTP status code returned by the server.
run_status_check() {
  local response
  local http_code
  local body

  # Capture both the response body and the trailing HTTP status code
  response=$(curl -s -w "\n%{http_code}" "$@")
  http_code=$(echo "$response" | tail -n1)
  body=$(echo "$response" | sed '$d')

  echo "$body"
  echo "[HTTP $http_code]"
  echo ""
}

# ------------------------------------------------------------------------------
# 3. Positive Test Cases: GET vs. QUERY Equivalence
# ------------------------------------------------------------------------------

# Test 1: Traditional HTTP GET request passing parameters via the URI query string
echo "=== GET /contacts - query in the URI ==="
echo '$ curl "http://localhost:3000/contacts?match=example.com&limit=2&select=surname,email"'
curl -s "http://localhost:3000/contacts?match=example.com&limit=2&select=surname,email"
echo ""
echo ""

# Test 2: HTTP QUERY request (RFC 10008) passing identical query parameters
# safely inside a structured JSON request body instead of the URL
echo "=== QUERY /contacts - same query, in the body (RFC 10008) ==="
echo '$ curl -X QUERY -H "Content-Type: application/json" -d {...}'
curl -s -X QUERY \
  -H "Content-Type: application/json" \
  -d '{
    "match": "example.com",
    "limit": 2,
    "select": ["surname", "email"]
  }' \
  "http://localhost:3001/contacts"
echo ""
echo ""

# ------------------------------------------------------------------------------
# 4. Negative Test Cases: RFC 10008 Protocol Compliance & Edge Cases
# ------------------------------------------------------------------------------

# Test 3: Omitting the Content-Type header on a QUERY request
# Per the RFC specification, Content-Type is mandatory when sending a payload.
echo "=== QUERY without Content-Type -> 400 (RFC: Content-Type is mandatory) ==="
run_status_check -X QUERY \
  -d '{"match": "example.com"}' \
  "http://localhost:3001/contacts"

# Test 4: Sending an unsupported media type (e.g., text/plain instead of JSON)
# Server should reject with 415 Unsupported Media Type.
echo "=== QUERY with unsupported Content-Type -> 415 ==="
run_status_check -X QUERY \
  -H "Content-Type: text/plain" \
  -d 'match=example.com' \
  "http://localhost:3001/contacts"

# Test 5: Sending malformed JSON with a valid application/json header
# Server should reject with 422 Unprocessable Content.
echo "=== QUERY with invalid JSON -> 422 ==="
run_status_check -X QUERY \
  -H "Content-Type: application/json" \
  -d '{invalid-json' \
  "http://localhost:3001/contacts"

# ------------------------------------------------------------------------------
# 5. Capability Discovery: OPTIONS Preflight
# ------------------------------------------------------------------------------

# Test 6: Inspecting response headers via OPTIONS to verify server support
# for the QUERY method (`Allow`) and accepted payload formats (`Accept-Query`).
echo "=== OPTIONS discovery - Allow + Accept-Query headers ==="
curl -s -i -X OPTIONS "http://localhost:3001/contacts" | grep -E "^(HTTP/|Allow:|Accept-Query:)"
echo ""
