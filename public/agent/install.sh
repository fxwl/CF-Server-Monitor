#!/bin/sh
# First-party Linux installer for pinned, non-privileged ICMP agent.
set -eu
BASE=${CFSM_ASSET_BASE:-https://monitor.nnot.de}
case "$(uname -s):$(uname -m)" in
  Linux:x86_64|Linux:amd64) ARCH=amd64 ;;
  Linux:aarch64|Linux:arm64) ARCH=arm64 ;;
  *) echo "Unsupported Linux architecture" >&2; exit 1 ;;
esac
for cmd in curl sha256sum awk mktemp; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "Missing dependency: $cmd" >&2; exit 1; }
done
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT HUP INT TERM
curl -fLsS --retry 3 --connect-timeout 15 --max-time 180 "$BASE/agent/sha256sums.txt" -o "$TMP/sha256sums.txt"
FILE="cf-probe-linux-$ARCH"
EXPECTED=$(awk -v f="$FILE" '$2==f {print $1}' "$TMP/sha256sums.txt")
[ "${#EXPECTED}" -eq 64 ] || { echo "Invalid agent checksum manifest" >&2; exit 1; }
curl -fLsS --retry 3 --connect-timeout 15 --max-time 240 "$BASE/agent/$FILE" -o "$TMP/$FILE"
printf '%s  %s\n' "$EXPECTED" "$TMP/$FILE" | sha256sum -c -
chmod 755 "$TMP/$FILE"
"$TMP/$FILE" version
"$TMP/$FILE" "$@"
