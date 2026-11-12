#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."
export CFSM_SKIP_MKCERT=1
export PYTHONDONTWRITEBYTECODE=1
node --check public/quality/theme-home-v4.js
node --check public/quality/theme-detail-v4.js
node --test test/agent-timestamp-guard.test.js
npm run test:all
bash scripts/build-icmp-agent.sh
node scripts/verify-release.mjs
npm run build:frontend
npx --no-install wrangler deploy --dry-run
