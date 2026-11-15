#!/usr/bin/env bash
# Run the surface gates inside the official Playwright image that matches the repo's
# @playwright/test version, so screenshots render with the same Linux fonts as CI.
#
#   bun run surfaces:update                  # regenerate Linux baselines (--update-snapshots)
#   bun run surfaces:docker                  # compare against the committed baselines
#   bun run surfaces:docker -- visual.spec.ts --grep reader
#   SURFACES_RATCHET=update bun run surfaces:docker -- accessibility.spec.ts keyboard.spec.ts
#
# The repo is mounted read-only and copied into the container, which installs its own Linux
# node_modules and runs its own local stack, so the host's macOS install is never touched.
# Only results come back: __screenshots__/linux (with --update-snapshots), the ratchet files
# (with SURFACES_RATCHET=update), and the report under .playwright/surfaces-docker.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
REPO_DIR="$(cd "$APP_DIR/../.." && pwd)"
PW_VERSION="$(cd "$APP_DIR" && bun -e 'console.log(require("@playwright/test/package.json").version)')"
IMAGE="mcr.microsoft.com/playwright:v${PW_VERSION}-noble"
# CI runs on ubuntu-latest (x86_64). Apple Silicon emulates it through Rosetta; set
# SURFACES_DOCKER_PLATFORM=linux/arm64 for a faster native run whose pixels may differ slightly.
PLATFORM="${SURFACES_DOCKER_PLATFORM:-linux/amd64}"
CACHE_VOLUME="oncobase-surfaces-cache-${PLATFORM//\//-}"

mkdir -p "$APP_DIR/surface-gates/__screenshots__" "$APP_DIR/.playwright/surfaces-docker"
echo "[surfaces] $IMAGE ($PLATFORM), cache volume $CACHE_VOLUME"

exec docker run --rm --init --ipc=host --platform "$PLATFORM" \
  -v "$REPO_DIR:/src:ro" \
  -v "$APP_DIR/surface-gates:/out/gates" \
  -v "$APP_DIR/.playwright/surfaces-docker:/out/results" \
  -v "$CACHE_VOLUME:/cache" \
  -e SURFACES_RATCHET="${SURFACES_RATCHET:-}" \
  -e PW_VERSION="$PW_VERSION" \
  "$IMAGE" bash /src/apps/app/surface-gates/docker/inside.sh "$@"
