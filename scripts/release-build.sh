#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."
export CFSM_SKIP_MKCERT=1
export PYTHONDONTWRITEBYTECODE=1
node scripts/stamp-nq.mjs
bash -n public/netdiag/nq/install.sh public/netdiag/nq/NodeQuality.sh
bash -n public/netdiag/nq/vendor/ip.sh public/netdiag/nq/vendor/net.sh public/netdiag/nq/vendor/hardware.sh
python3 -I -m py_compile public/netdiag/nq/runner.py
node --test test/nq-weekly.test.mjs
python3 test/nq-runner.test.py
node --test test/agent-timestamp-guard.test.js test/netdiag.test.mjs test/stable-netdiag.test.mjs
python3 test/netdiag-collector.test.py
python3 test/stable-collector.test.py
bash -n public/netdiag/stable/install.sh
npm run test:all
bash scripts/build-icmp-agent.sh
node scripts/verify-release.mjs
npm run build:frontend
npx --no-install wrangler deploy --dry-run
