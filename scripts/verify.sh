#!/usr/bin/env sh
# End-to-end check of a running lab: health, a real checkout, and its trace, logs and metrics
# arriving in Tempo, Loki and Prometheus. Exits non-zero on the first failure.
set -eu
API="${API_URL:-http://localhost:8400}"
LAB="${LAB_URL:-http://localhost:8410}"
pass() { echo "  ok    $*"; }
fail() { echo "  FAIL  $*" >&2; exit 1; }

echo "Components (waiting up to 90 s: Loki and Tempo need a moment after a fresh start)"
for c in api-gateway order-service inventory-service payment-service otel-collector tempo prometheus loki toxiproxy; do
  i=0
  until curl -fsS "$LAB/lab/status" 2>/dev/null | grep -q "\"$c\":\"up\""; do
    i=$((i + 1)); [ $i -gt 45 ] && fail "$c is not up"; sleep 2
  done
  pass "$c"
done
curl -fsS -X POST "$LAB/lab/faults/reset" >/dev/null && pass "faults reset"

echo "Checkout"
trace=$(curl -fsS -D - -o /dev/null -X POST "$API/api/checkout" -H 'Content-Type: application/json' \
  -d '{"user_id":"verify","items":[{"product_id":"prod-001","quantity":1}]}' \
  | tr -d '\r' | awk 'tolower($1)=="x-trace-id:" {print $2}')
[ -n "$trace" ] && pass "201 Created, trace $trace" || fail "checkout failed"

echo "Telemetry (waiting for batches to arrive)"
i=0
until curl -fsS "$LAB/lab/traces/$trace" 2>/dev/null | grep -q '"payment-service"'; do
  i=$((i + 1)); [ $i -gt 30 ] && fail "trace did not reach Tempo"; sleep 2
done
pass "trace in Tempo, spanning all services"
i=0
until curl -fsS "$LAB/lab/logs?trace_id=$trace" 2>/dev/null | grep -q 'checkout completed'; do
  i=$((i + 1)); [ $i -gt 30 ] && fail "logs did not reach Loki"; sleep 2
done
pass "logs in Loki, correlated by trace_id"
i=0
until curl -fsS "$LAB/lab/metrics/services" 2>/dev/null | grep -q '"api-gateway":{"rps":[0-9]'; do
  i=$((i + 1)); [ $i -gt 30 ] && fail "metrics did not reach Prometheus"; sleep 2
done
pass "metrics in Prometheus"
echo "All checks passed."
