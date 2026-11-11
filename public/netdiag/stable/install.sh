#!/usr/bin/env bash
# Immutable CFSM diagnostics 1.2.0. Existing cf-probe is never restarted or replaced.
set -Eeuo pipefail
VERSION=1.2.0
ACTION="${1:-apply}"
AGENT_USER="${CFSM_USER:-cfsm}"
BASE='https://monitor.nnot.de/netdiag/releases/1.2.0'
DEST='/opt/cfsm-netdiag'
EXPECTED='3709646046a48461253429f169333c626b0c4e69ac704584c024180f89ae7279'
SERVICE=cfsm-netdiag.service
TIMER=cfsm-netdiag.timer
log(){ printf '[INFO] %s\n' "$*"; }
die(){ printf '[ERROR] %s\n' "$*" >&2; exit 1; }
[[ $(id -u) == 0 ]] || die 'Use root for installation only; diagnostics run as cfsm.'
[[ "$ACTION" =~ ^(apply|status|remove)$ ]] || die 'Usage: install.sh apply|status|remove'
[[ "$AGENT_USER" =~ ^[a-z_][a-z0-9_-]*$ ]] || die 'Invalid service account'
entry=$(getent passwd "$AGENT_USER") || die 'Existing cfsm account not found'
IFS=: read -r _ _ UID_CF GID_CF _ HOME_CF _ <<< "$entry"
[[ "$UID_CF" != 0 && "$HOME_CF" =~ ^/[A-Za-z0-9/_-]+$ ]] || die 'Unsafe account path'
CONFIG="$HOME_CF/.cf-probe/config.conf"
UNIT_DIR="$HOME_CF/.config/systemd/user"
STATE_DIR="$HOME_CF/.cfsm-netdiag"
[[ -f "$CONFIG" && ! -L "$CONFIG" ]] || die 'Missing or unsafe original Agent config'
[[ $(stat -c %u "$CONFIG") == "$UID_CF" && $(stat -c %a "$CONFIG") == 600 ]] || die 'Original config must be owned by cfsm with mode 600'
[[ -S "/run/user/$UID_CF/bus" ]] || die 'The existing user systemd manager is unavailable'
usercmd(){ runuser -u "$AGENT_USER" -- env HOME="$HOME_CF" XDG_RUNTIME_DIR="/run/user/$UID_CF" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$UID_CF/bus" "$@"; }
ctl(){ usercmd systemctl --user "$@"; }
if [[ "$ACTION" == status ]]; then
  ctl status "$TIMER" --no-pager -l || true
  ctl show "$SERVICE" -p Result -p ExecMainStatus -p NoNewPrivileges -p UMask || true
  if [[ -f "$DEST/collector.py" ]]; then usercmd python3 -I "$DEST/collector.py" --version; fi
  journalctl "_UID=$UID_CF" "_SYSTEMD_USER_UNIT=$SERVICE" -n 15 --no-pager || true
  exit 0
fi
[[ ! -L "$DEST" ]] || die 'Unsafe install directory'
if [[ -e "$DEST" ]]; then
  [[ -d "$DEST" && $(stat -c %u "$DEST") == 0 && -f "$DEST/.managed" ]] || die 'Refusing to replace an unrelated installation'
  [[ $((8#$(stat -c %a "$DEST") & 022)) == 0 ]] || die 'Install directory is writable by non-root'
fi
if [[ "$ACTION" == remove ]]; then
  [[ -f "$DEST/.managed" ]] || die 'Managed installation not found'
  ctl disable --now "$TIMER" || true
  ctl stop "$SERVICE" || true
  usercmd rm -f "$UNIT_DIR/$SERVICE" "$UNIT_DIR/$TIMER"
  ctl daemon-reload
  rm -f "$DEST/collector.py" "$DEST/install.sh" "$DEST/.managed"
  rmdir "$DEST" 2>/dev/null || true
  log 'Diagnostics removed. cf-probe and saved reports were not changed.'
  exit 0
fi
for name in "$SERVICE" "$TIMER"; do
  file="$UNIT_DIR/$name"
  [[ ! -L "$file" ]] || die 'Refusing symlinked unit'
  if [[ -e "$file" ]]; then grep -Fqx '# Managed by CFSM Netdiag Installer' "$file" || die 'Unmanaged service exists'; fi
done
for cmd in curl sha256sum runuser systemctl install; do command -v "$cmd" >/dev/null || die "Missing $cmd"; done
stage=$(mktemp -d)
changed=0
had_service=0
had_timer=0
had_binary=0
cleanup(){
  rc=$?
  trap - EXIT
  if [[ "$rc" -ne 0 && "$changed" == 1 ]]; then
    printf '[WARN] Installation failed; restoring previous diagnostics files.\n' >&2
    ctl stop "$SERVICE" || true
    if [[ "$had_binary" == 1 ]]; then install -o root -g root -m 644 "$stage/old-collector.py" "$DEST/collector.py"; else rm -f "$DEST/collector.py"; fi
    if [[ "$had_service" == 1 ]]; then usercmd tee "$UNIT_DIR/$SERVICE" < "$stage/old-service" >/dev/null; else usercmd rm -f "$UNIT_DIR/$SERVICE"; fi
    if [[ "$had_timer" == 1 ]]; then usercmd tee "$UNIT_DIR/$TIMER" < "$stage/old-timer" >/dev/null; else ctl disable "$TIMER" || true; usercmd rm -f "$UNIT_DIR/$TIMER"; fi
    ctl daemon-reload || true
    if [[ "$had_timer" == 1 ]]; then ctl enable --now "$TIMER" || true; fi
  fi
  rm -rf "$stage"
  exit "$rc"
}
trap cleanup EXIT
log 'Downloading the fixed diagnostics release from your monitoring domain'
curl -q -4fsSL --proto '=https' --proto-redir '=https' --connect-timeout 10 --max-time 90 --retry 1 "$BASE/collector.py" -o "$stage/collector.py"
printf '%s  %s\n' "$EXPECTED" "$stage/collector.py" | sha256sum -c -
if ! command -v python3 >/dev/null || ! command -v traceroute >/dev/null || ! command -v ping >/dev/null; then
  command -v apt-get >/dev/null || die 'Install python3 traceroute iputils-ping ca-certificates first'
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y python3 traceroute iputils-ping ca-certificates
fi
python3 -I -c 'import ast,sys; ast.parse(open(sys.argv[1], encoding="utf-8").read())' "$stage/collector.py"
if [[ -f "$DEST/collector.py" && ! -L "$DEST/collector.py" ]]; then cp "$DEST/collector.py" "$stage/old-collector.py"; had_binary=1; fi
if [[ -f "$UNIT_DIR/$SERVICE" ]]; then cp "$UNIT_DIR/$SERVICE" "$stage/old-service"; had_service=1; fi
if [[ -f "$UNIT_DIR/$TIMER" ]]; then cp "$UNIT_DIR/$TIMER" "$stage/old-timer"; had_timer=1; fi
install -d -o root -g root -m 755 "$DEST"
usercmd mkdir -p "$UNIT_DIR" "$STATE_DIR"
usercmd chmod 700 "$STATE_DIR"
changed=1
ctl stop "$SERVICE" || true
install -o root -g root -m 644 "$stage/collector.py" "$DEST/collector.py"
usercmd tee "$UNIT_DIR/$SERVICE" >/dev/null <<UNIT
# Managed by CFSM Netdiag Installer
[Unit]
Description=CFSM fixed Fuzhou diagnostics 1.2.0 (non-root)
After=default.target

[Service]
Type=oneshot
ExecStart=/usr/bin/python3 -I $DEST/collector.py --config $CONFIG --state $STATE_DIR
TimeoutStartSec=300
KillMode=control-group
NoNewPrivileges=yes
RestrictSUIDSGID=yes
LockPersonality=yes
RestrictRealtime=yes
UMask=0077
Nice=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=cfsm-netdiag
UNIT
usercmd tee "$UNIT_DIR/$TIMER" >/dev/null <<'UNIT'
# Managed by CFSM Netdiag Installer
[Unit]
Description=CFSM diagnostics twice daily (fixed version)
[Timer]
OnCalendar=*-*-* 00,12:20:00 UTC
RandomizedDelaySec=15m
Persistent=true
Unit=cfsm-netdiag.service
[Install]
WantedBy=timers.target
UNIT
usercmd chmod 644 "$UNIT_DIR/$SERVICE" "$UNIT_DIR/$TIMER"
ctl daemon-reload
ctl enable --now "$TIMER"
ctl is-active --quiet "$TIMER"
if [[ $(readlink -f "$0") != "$DEST/install.sh" ]]; then install -o root -g root -m 700 "$0" "$DEST/install.sh"; fi
printf '%s\n' 'CFSM Netdiag Installer v1.2.0' > "$DEST/.managed"
chmod 600 "$DEST/.managed"
changed=0
ctl start --no-block "$SERVICE"
log 'Installed version 1.2.0. No auto-update, cf-probe restart, firewall or SSH change.'
log 'A oneshot task normally becomes inactive after completion. Verify Result=success and report_accepted.'
log 'Status: bash /opt/cfsm-netdiag/install.sh status'
