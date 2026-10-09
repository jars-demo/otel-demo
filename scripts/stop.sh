#!/usr/bin/env sh
# Stop the lab. Containers are removed; orders and telemetry (Docker volumes) are kept.
set -eu
cd "$(dirname "$0")/.."
docker compose down
echo "Stopped. Data is kept; ./scripts/reset.sh deletes it."
