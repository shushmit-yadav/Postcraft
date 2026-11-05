#!/usr/bin/env bash
# Runs on every codespace start. The docker-in-docker daemon starts in parallel, so wait for it.
set -euo pipefail
cd "$(dirname "$0")/.."
for _ in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 1; done
docker compose up -d --build
echo "Postcraft is starting on port 8080 (first build takes a few minutes)."
