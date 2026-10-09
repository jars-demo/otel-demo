#!/usr/bin/env sh
# Build (if needed) and start the whole lab, waiting until every health check passes.
set -eu
cd "$(dirname "$0")/.."
docker compose build
docker compose up -d --wait
echo
echo "The lab is up:"
echo "  Website      http://localhost:3400"
echo "  Grafana      http://localhost:3401"
echo "  API          http://localhost:8400/docs"
echo "  Lab console  http://localhost:8410/docs"
