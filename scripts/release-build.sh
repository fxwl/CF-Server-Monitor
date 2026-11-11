#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."
export CFSM_SKIP_MKCERT=1
export PYTHONDONTWRITEBYTECODE=1
node --test test/agent-timestamp-guard.test.js test/netdiag.test.mjs test/stable-netdiag.test.mjs test/media-unlock.test.mjs
python3 test/netdiag-collector.test.py
python3 test/stable-collector.test.py
python3 test/media-probes.test.py
bash -n public/netdiag/stable/install.sh
bash -n public/netdiag/releases/1.3.0/install.sh
node scripts/stamp-release.mjs
npm run test:all
bash scripts/build-icmp-agent.sh
node scripts/verify-release.mjs
npm run build:frontend
npx --no-install wrangler deploy --dry-run
