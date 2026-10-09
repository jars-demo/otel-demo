#!/usr/bin/env sh
# Send controlled traffic through the lab's own api-gateway, via the lab-console.
# Usage: ./scripts/load-test.sh [scenario] [requests_per_second] [seconds]
#   scenario: mixed (default), checkout or browse. Limits: 20 req/s, 900 s.
set -eu
LAB="${LAB_URL:-http://localhost:8410}"
SCENARIO="${1:-mixed}"; RPS="${2:-5}"; SECONDS_="${3:-60}"
curl -fsS -X POST "$LAB/lab/load" -H 'Content-Type: application/json' \
  -d "{\"scenario\":\"$SCENARIO\",\"rps\":$RPS,\"duration_s\":$SECONDS_}" >/dev/null
echo "Sending $RPS req/s of '$SCENARIO' traffic for ${SECONDS_}s. Watch http://localhost:3400/metrics/"
echo "Stop early with: curl -X DELETE $LAB/lab/load"
