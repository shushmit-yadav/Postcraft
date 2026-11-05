#!/usr/bin/env bash
# Creates .env once, with a random APP_SECRET, so the stack can start with no manual steps.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -f .env ]; then
  cp .env.example .env
  sed -i "s/^APP_SECRET=.*/APP_SECRET=$(openssl rand -hex 32)/" .env
  echo "Created .env with a random APP_SECRET"
fi
