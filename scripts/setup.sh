#!/usr/bin/env sh
# Check prerequisites and build the images. Safe to run more than once.
set -eu
cd "$(dirname "$0")/.."

fail() { echo "error: $*" >&2; exit 1; }
command -v docker >/dev/null 2>&1 || fail "Docker is not installed: https://docs.docker.com/get-docker/"
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required (docker compose version)"
docker info >/dev/null 2>&1 || fail "the Docker daemon is not running"

echo "Building images (the first run downloads base images and takes a few minutes)..."
docker compose build
echo "Done. Start the lab with: ./scripts/start.sh"
