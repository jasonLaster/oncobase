#!/usr/bin/env bash
# Runs inside mcr.microsoft.com/playwright:v<version>-noble (see run.sh). Copies the read-only
# repo from /src, installs Linux dependencies, starts the local stack and runs the suite.
# /cache is a named volume: bun, its install cache and the convex-local-backend download.
set -euo pipefail

BUN_VERSION=1.3.12
export HOME=/root
export BUN_INSTALL_CACHE_DIR=/cache/bun-install-cache
export PATH="/cache/bun/bin:$PATH"

step() { echo "[surfaces] $*"; }

if ! command -v unzip >/dev/null; then
  step "installing unzip (the stack unpacks convex-local-backend)"
  apt-get update -qq >/dev/null && apt-get install -y -qq unzip >/dev/null
fi
if [ "$(bun --version 2>/dev/null || true)" != "$BUN_VERSION" ]; then
  step "installing bun $BUN_VERSION into the cache volume"
  npm install --silent --global --prefix /cache/bun "bun@$BUN_VERSION"
fi
# The Convex CLI caches the backend binary under ~/.cache/convex; keep it in the volume.
mkdir -p /cache/convex "$HOME/.cache" && ln -sfn /cache/convex "$HOME/.cache/convex"

step "copying the repo (without node_modules, .git, env files or local stack state)"
mkdir -p /work/repo
tar -C /src \
  --exclude=node_modules --exclude=.git --exclude=.local-stack --exclude=.playwright \
  --exclude=.vercel --exclude=.turbo --exclude=dist --exclude=test-results \
  --exclude='.env' --exclude='.env.*' \
  -cf - . | tar -C /work/repo -xf -
cd /work/repo

step "bun install"
bun install --frozen-lockfile >/tmp/install.log 2>&1 || { tail -40 /tmp/install.log; exit 1; }
INSTALLED="$(cd apps/app && bun -e 'console.log(require("@playwright/test/package.json").version)')"
if [ "$INSTALLED" != "${PW_VERSION:-$INSTALLED}" ]; then
  echo "Installed @playwright/test $INSTALLED does not match the image ($PW_VERSION)." >&2
  exit 1
fi

cd apps/app
step "starting the local stack"
bun run local:stack >/tmp/stack.log 2>&1 || { tail -60 /tmp/stack.log; exit 1; }

step "running: playwright test --config playwright.surfaces.config.ts $*"
set +e
bun run local:stack exec -- bunx playwright test --config playwright.surfaces.config.ts "$@"
status=$?
set -e

rm -rf /out/results/* && cp -r .playwright/surfaces/. /out/results/ 2>/dev/null || true
for arg in "$@"; do
  if [ "$arg" = "--update-snapshots" ] || [ "$arg" = "-u" ]; then
    step "copying Linux baselines back to surface-gates/__screenshots__/linux"
    rm -rf /out/gates/__screenshots__/linux
    mkdir -p /out/gates/__screenshots__
    cp -r surface-gates/__screenshots__/linux /out/gates/__screenshots__/linux
  fi
done
if [ "${SURFACES_RATCHET:-}" = "update" ]; then
  step "copying ratchet files back"
  cp surface-gates/known-axe-violations.json surface-gates/known-keyboard-failures.json /out/gates/
fi
bun run local:stack stop >/dev/null 2>&1 || true
exit $status
