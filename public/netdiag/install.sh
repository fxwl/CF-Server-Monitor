#!/usr/bin/env bash
# CFSM Netdiag Installer v1.1.0
# Installs ONLY the independent diagnostics helper; does not modify cf-probe.
set -Eeuo pipefail
ACTION="${1:-apply}"
AGENT_USER="${CFSM_USER:-cfsm}"
BASE_URL='https://monitor.nnot.de/netdiag/download'
DEST='/opt/cfsm-netdiag'
EXPECTED_COLLECTOR='10283dbf34b0f8c3f476753bedd368dc263865603a68bc8df51f8a2090bb6449'
SERVICE='cfsm-netdiag.service'
TIMER='cfsm-netdiag.timer'
log(){ printf '[INFO] %s\n' "$*"; }
die(){ printf '[ERROR] %s\n' "$*" >&2; exit 1; }
[[ $(id -u) == 0 ]] || die 'Run this installer as root. The collector will run as cfsm, not root.'
[[ "$ACTION" =~ ^(apply|status|remove)$ ]] || die 'Usage: install.sh apply|status|remove'
[[ "$AGENT_USER" =~ ^[a-z_][a-z0-9_-]*$ ]] || die 'Invalid account name'
entry=$(getent passwd "$AGENT_USER") || die 'The existing cfsm account was not found'
IFS=: read -r _ _ AGENT_UID AGENT_GID _ HOME_DIR _ <<< "$entry"
[[ "$AGENT_UID" != 0 && "$HOME_DIR" =~ ^/[A-Za-z0-9/_-]+$ ]] || die 'Unsafe account or home path'
CONFIG="$HOME_DIR/.cf-probe/config.conf"
UNIT_DIR="$HOME_DIR/.config/systemd/user"
STATE_DIR="$HOME_DIR/.cfsm-netdiag"
[[ -f "$CONFIG" && ! -L "$CONFIG" ]] || die 'Existing cf-probe config was not found or is a symlink'
[[ $(stat -c %u "$CONFIG") == "$AGENT_UID" ]] || die 'Unexpected config owner'
[[ $(stat -c %a "$CONFIG") == 600 ]] || die 'The existing config must have mode 600'
[[ -S /run/user/"$AGENT_UID"/bus ]] || die 'Existing systemd user manager is unavailable; original agent was not changed'
usercmd(){ runuser -u "$AGENT_USER" -- env HOME="$HOME_DIR" XDG_RUNTIME_DIR="/run/user/$AGENT_UID" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$AGENT_UID/bus" "$@"; }
ctl(){ usercmd systemctl --user "$@"; }
if [[ "$ACTION" == status ]]; then
  ctl status "$TIMER" --no-pager -l || true
  ctl show "$SERVICE" -p Result -p ExecMainStatus -p NoNewPrivileges -p UMask || true
  journalctl "_UID=$AGENT_UID" "_SYSTEMD_USER_UNIT=$SERVICE" -n 12 --no-pager || true
  exit 0
fi
if [[ "$ACTION" == remove ]]; then
  [[ -f "$DEST/.managed" && ! -L "$DEST" ]] || die 'Not a managed helper installation'
  ctl disable --now "$TIMER" || true
  ctl stop "$SERVICE" || true
  usercmd rm -f "$UNIT_DIR/$SERVICE" "$UNIT_DIR/$TIMER"
  ctl daemon-reload
  rm -f "$DEST/collector.py" "$DEST/install.sh" "$DEST/.managed"
  rmdir "$DEST" 2>/dev/null || true
  log 'Helper removed. Existing cf-probe and local diagnostic history were preserved.'
  exit 0
fi
[[ ! -L "$DEST" ]] || die 'Unsafe installation path'
if [[ -e "$DEST" ]]; then
  [[ -d "$DEST" && $(stat -c %u "$DEST") == 0 && -f "$DEST/.managed" ]] || die 'Refusing to overwrite an unmanaged directory'
fi
for file in "$UNIT_DIR/$SERVICE" "$UNIT_DIR/$TIMER"; do
  if [[ -e "$file" ]]; then
    grep -Fqx '# Managed by CFSM Netdiag Installer' "$file" || die 'Refusing to overwrite an unrelated service'
  fi
done
for dependency in curl sha256sum runuser systemctl; do
  command -v "$dependency" >/dev/null || die "Missing command: $dependency"
done
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
log 'Downloading the pinned collector from your own monitor domain'
curl -q -4fsSL --proto '=https' --proto-redir '=https' --connect-timeout 10 --max-time 90 --retry 1 "$BASE_URL/collector.py" -o "$stage/collector.py"
printf '%s  %s\n' "$EXPECTED_COLLECTOR" "$stage/collector.py" | sha256sum -c -
if ! command -v python3 >/dev/null || ! command -v traceroute >/dev/null; then
  command -v apt-get >/dev/null || die 'Install python3 and the Debian traceroute package, then rerun'
  log 'Installing distribution packages: python3 traceroute ca-certificates (no system upgrade)'
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y python3 traceroute ca-certificates
fi
python3 -I -c 'import ast,sys; ast.parse(open(sys.argv[1], encoding="utf-8").read())' "$stage/collector.py"
install -d -o root -g root -m 755 "$DEST"
install -o root -g root -m 644 "$stage/collector.py" "$DEST/collector.py"
if [[ $(readlink -f "$0") != "$DEST/install.sh" ]]; then
  install -o root -g root -m 700 "$0" "$DEST/install.sh"
fi
printf '%s\n' 'CFSM Netdiag Installer v1.1.0' > "$DEST/.managed"
chmod 600 "$DEST/.managed"
# Write home-directory files AS cfsm so a malicious user-owned symlink cannot cause root writes.
usercmd mkdir -p "$UNIT_DIR" "$STATE_DIR"
usercmd chmod 700 "$STATE_DIR"
usercmd tee "$UNIT_DIR/$SERVICE" >/dev/null <<UNIT
# Managed by CFSM Netdiag Installer
[Unit]
Description=CFSM Fuzhou Network Diagnostics (non-root)
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
Description=Run CFSM network diagnostics twice daily

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
ctl start --no-block "$SERVICE"
log 'Installed. The helper runs as the existing non-root cfsm account.'
log 'First diagnostic run started through systemd; subsequent runs are twice daily.'
log 'No raw-socket capabilities, inbound ports, firewall changes, or cf-probe restart were added.'
log 'Check: bash /opt/cfsm-netdiag/install.sh status'
log 'Remove: bash /opt/cfsm-netdiag/install.sh remove'
ctl is-active "$TIMER"
