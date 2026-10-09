#!/usr/bin/env sh
# Delete everything the lab stored: orders, payments, traces, metrics, logs, Grafana state.
# Pass -y to skip the question.
set -eu
cd "$(dirname "$0")/.."
if [ "${1:-}" != "-y" ]; then
  echo "This deletes ALL local lab data: orders, traces, metrics, logs and Grafana state."
  printf "Type 'reset' to continue: "
  read -r answer
  [ "$answer" = "reset" ] || { echo "Cancelled."; exit 1; }
fi
docker compose down -v --remove-orphans
echo "Reset complete. Start fresh with ./scripts/start.sh"
