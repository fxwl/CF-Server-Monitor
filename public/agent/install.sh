#!/bin/sh
# First-party Linux installer for pinned, non-privileged ICMP agent.
set -eu
BASE=${CFSM_ASSET_BASE:-https://monitor.nnot.de}
case "$BASE" in
  https://*) ;;
  *) echo "CFSM_ASSET_BASE must be an HTTPS URL" >&2; exit 1 ;;
esac
case "$BASE" in
  *[!A-Za-z0-9._:/-]*) echo "Invalid CFSM_ASSET_BASE" >&2; exit 1 ;;
esac
case "${1:-install}" in
  install) ;;
  uninstall|remove|delete|purge) ;;
  *) echo "Unsupported installer command" >&2; exit 1 ;;
esac
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
# Do not allow the upstream auto-updater to replace this patched ICMP binary.
# install.go accepts -auto_update=0 for install; uninstall needs no config args.
if [ "${1:-install}" = install ]; then
  "$TMP/$FILE" "$@" -auto_update=0
else
  "$TMP/$FILE" "$@"
fi
