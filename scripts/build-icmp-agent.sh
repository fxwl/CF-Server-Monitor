#!/usr/bin/env bash
# Build reproducible non-privileged ICMP Linux agents for Cloudflare Static Assets.
set -Eeuo pipefail

REV=85208b81487e919aa8585e538ae82710e90961d2
REPO=https://github.com/huilang-me/cfsm-agent.git
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="$ROOT/public/agent"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

for cmd in git go python3 sha256sum; do
  command -v "$cmd" >/dev/null || { echo "Missing build dependency: $cmd" >&2; exit 1; }
done

mkdir -p "$WORK/src" "$OUT"
git -C "$WORK/src" init -q
git -C "$WORK/src" fetch -q --depth 1 "$REPO" "$REV"
git -C "$WORK/src" checkout -q --detach FETCH_HEAD
test "$(git -C "$WORK/src" rev-parse HEAD)" = "$REV"

python3 - "$WORK/src/internal/cfprobe/probe.go" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
source = path.read_text()
old = "pinger.SetPrivileged(true)"
if source.count(old) != 1:
    raise SystemExit("Unexpected upstream ICMP implementation; refusing to build")
path.write_text(source.replace(old, "pinger.SetPrivileged(false)"))
print("Patched Go ICMP to use Linux ping sockets (no CAP_NET_RAW)")
PY

VERSION="custom-icmp-$(printf '%s' "$REV" | cut -c1-12)"
for ARCH in amd64 arm64; do
  echo "Building Linux/$ARCH ($VERSION)"
  (
    cd "$WORK/src"
    CGO_ENABLED=0 GOOS=linux GOARCH="$ARCH" GOTOOLCHAIN=auto \
      go build -trimpath -ldflags "-s -w -X main.version=$VERSION" \
      -o "$OUT/cf-probe-linux-$ARCH" ./cmd/cf-probe
  )
  chmod 755 "$OUT/cf-probe-linux-$ARCH"
  BYTES=$(wc -c < "$OUT/cf-probe-linux-$ARCH")
  if [ "$BYTES" -ge 24000000 ]; then
    echo "Asset exceeds safe Cloudflare Static Assets limit: $ARCH ($BYTES bytes)" >&2
    exit 1
  fi
done

(
  cd "$OUT"
  sha256sum cf-probe-linux-amd64 cf-probe-linux-arm64 > sha256sums.txt
  sha256sum -c sha256sums.txt
)
echo "ICMP agent binaries and checksums ready for deployment."
