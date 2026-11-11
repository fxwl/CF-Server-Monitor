#!/usr/bin/env bash
# CFSM weekly full NodeQuality 1.0.0, Fri 21:00 Asia/Shanghai.
# Derived AGPL-3.0 scripts pinned; no NodeQuality public upload.
set -Eeuo pipefail
ACTION="${1:-install}"
VERSION='1.0.0'
BASE='https://monitor.nnot.de/netdiag/nq'
DEST='/opt/cfsm-nq'
MANAGED="$DEST/.cfsm-managed"
UNIT='/etc/systemd/system/cfsm-nq.service'
TIMER='/etc/systemd/system/cfsm-nq.timer'
log(){ printf '[CFSM NQ] %s\n' "$*"; }
die(){ printf '[CFSM NQ ERROR] %s\n' "$*" >&2; exit 1; }
[[ "$(id -u)" == 0 ]] || die 'Use root; full BenchOS requires root.'
[[ "$ACTION" =~ ^(install|status|remove)$ ]] || die 'Usage: install|status|remove'
if [[ "$ACTION" == status ]]; then
  systemctl status cfsm-nq.timer --no-pager -l || true
  systemctl show cfsm-nq.service -p Result -p ExecMainStatus -p ActiveState || true
  systemctl list-timers --all --no-pager | grep -E 'cfsm-nq|NEXT' || true
  if [[ -d /var/lib/cfsm-nq/reports ]]; then find /var/lib/cfsm-nq/reports -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort | tail -n 4; fi
  journalctl -u cfsm-nq.service -n 20 --no-pager || true
  exit 0
fi
if [[ "$ACTION" == remove ]]; then
  [[ -f "$MANAGED" ]] || die 'Refusing to remove unowned NQ installation.'
  systemctl disable --now cfsm-nq.timer || true
  systemctl stop cfsm-nq.service || true
  rm -f "$UNIT" "$TIMER"
  systemctl daemon-reload
  rm -rf "$DEST"
  log 'Removed NQ program/timer; archived results left in /var/lib/cfsm-nq.'
  log 'Original cf-probe and previous cfsm-netdiag collector remain untouched.'
  exit 0
fi
for command in curl sha256sum python3 mount tar chroot systemctl runuser; do
  command -v "$command" >/dev/null 2>&1 || die "Missing $command"
done
[[ ! -L "$DEST" ]] || die 'Unsafe destination symlink.'
if [[ -e "$DEST" ]]; then
  [[ -f "$MANAGED" && -d "$DEST" && "$(stat -c %u "$DEST")" == 0 ]] || die 'Destination not managed by CFSM.'
fi
[[ -r /home/cfsm/.cf-probe/config.conf ]] || die 'Missing existing cfsm probe credentials.'
for file in "$UNIT" "$TIMER"; do
  if [[ -e "$file" ]]; then
    [[ ! -L "$file" ]] || die "Refusing systemd unit symlink $file"
    grep -Fq '# CFSM NQ Managed Unit' "$file" || die "Existing unmanaged systemd unit $file"
  fi
done
stage=$(mktemp -d)
backup=$(mktemp -d)
changed=0
cleanup(){
  rc=$?
  trap - EXIT
  if (( rc != 0 && changed == 1 )); then
    log 'Install failed; restoring managed files.'
    systemctl disable --now cfsm-nq.timer >/dev/null 2>&1 || true
    for file in "$UNIT" "$TIMER"; do
      basename=$(basename "$file")
      if [[ -f "$backup/$basename" ]]; then cp "$backup/$basename" "$file"; else rm -f "$file"; fi
    done
    if [[ -d "$backup/program" ]]; then
      rm -rf "$DEST"; cp -a "$backup/program" "$DEST"
    else
      rm -rf "$DEST"
    fi
    systemctl daemon-reload || true
    if [[ -f "$TIMER" ]]; then systemctl enable --now cfsm-nq.timer >/dev/null 2>&1 || true; fi
  fi
  rm -rf "$stage" "$backup"
  exit "$rc"
}
trap cleanup EXIT
log 'Downloading fixed NQ package and verifying file checksums'
curl -q -4fsSL --proto '=https' --proto-redir '=https' --max-time 60 "$BASE/manifest.json" -o "$stage/manifest.json"
python3 - "$stage/manifest.json" <<'PY'
import json,sys
m=json.load(open(sys.argv[1]))
assert m['version']=='1.0.0' and m['auto_update'] is False
assert m['schedule']=='Fri *-*-* 21:00:00 Asia/Shanghai'
assert set(m['files'])=={'NodeQuality.sh','runner.py','vendor/ip.sh','vendor/net.sh','vendor/hardware.sh'}
assert all(len(x)==64 and all(c in '0123456789abcdef' for c in x) for x in m['files'].values())
PY
mapfile -t names < <(python3 - "$stage/manifest.json" <<'PY'
import json,sys
for path in json.load(open(sys.argv[1]))['files']:print(path)
PY
)
for path in "${names[@]}"; do
  [[ "$path" =~ ^(NodeQuality\.sh|runner\.py|vendor/(ip|net|hardware)\.sh)$ ]] || die "Forbidden path $path"
  mkdir -p "$stage/$(dirname "$path")"
  curl -q -4fsSL --proto '=https' --proto-redir '=https' --connect-timeout 10 --max-time 120 --retry 2 "$BASE/$path" -o "$stage/$path"
done
python3 - "$stage" <<'PY'
import hashlib,json,os,sys
p=sys.argv[1];m=json.load(open(p+'/manifest.json'))
for name,sha in m['files'].items():
    real=hashlib.sha256(open(os.path.join(p,name),'rb').read()).hexdigest()
    if real!=sha:raise SystemExit('Checksum mismatch: '+name)
print('All pinned NodeQuality files SHA256 verified')
PY
python3 -I -m py_compile "$stage/runner.py"
for path in NodeQuality.sh vendor/ip.sh vendor/net.sh vendor/hardware.sh; do bash -n "$stage/$path"; done
systemd-analyze calendar 'Fri *-*-* 21:00:00 Asia/Shanghai' >/dev/null || die 'Invalid weekly timer.'
log 'Preparing reversible upgrade'
if [[ -d "$DEST" ]]; then cp -a "$DEST" "$backup/program"; fi
for file in "$UNIT" "$TIMER"; do if [[ -f "$file" ]]; then cp "$file" "$backup/$(basename "$file")"; fi; done
changed=1
systemctl stop cfsm-nq.service >/dev/null 2>&1 || true
install -d -o root -g root -m 755 "$DEST" "$DEST/vendor"
for path in "${names[@]}"; do install -o root -g root -m 644 "$stage/$path" "$DEST/$path"; done
install -o root -g root -m 600 "$stage/manifest.json" "$DEST/manifest.json"
printf 'CFSM_NQ_1.0.0\n' > "$MANAGED"
chmod 600 "$MANAGED"
install -d -o root -g root -m 700 /var/lib/cfsm-nq /var/lib/cfsm-nq/reports /var/lib/cfsm-nq/work
cat > "$UNIT" <<'UNIT'
# CFSM NQ Managed Unit
[Unit]
Description=CFSM weekly pinned full NodeQuality, local retention
After=network-online.target
Wants=network-online.target
ConditionPathExists=/opt/cfsm-nq/NodeQuality.sh
[Service]
Type=oneshot
User=root
Group=root
ExecStart=/usr/bin/python3 -I /opt/cfsm-nq/runner.py
WorkingDirectory=/var/lib/cfsm-nq
TimeoutStartSec=10800
KillMode=mixed
UMask=0077
Nice=15
IOSchedulingClass=idle
NoNewPrivileges=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
LogRateLimitIntervalSec=60s
LogRateLimitBurst=40
UNIT
cat > "$TIMER" <<'UNIT'
# CFSM NQ Managed Unit
[Unit]
Description=Run full NodeQuality on Friday 21:00 China time
[Timer]
OnCalendar=Fri *-*-* 21:00:00 Asia/Shanghai
AccuracySec=1min
Persistent=false
Unit=cfsm-nq.service
[Install]
WantedBy=timers.target
UNIT
chmod 644 "$UNIT" "$TIMER"
systemctl daemon-reload
systemctl enable --now cfsm-nq.timer
systemctl is-active --quiet cfsm-nq.timer || die 'Weekly timer is not active.'
# Pause the old twice-daily optional diagnostic, keeping the main agent alive.
if getent passwd cfsm >/dev/null; then
  uid=$(id -u cfsm)
  if [[ -S "/run/user/$uid/bus" ]]; then
    runuser -u cfsm -- env XDG_RUNTIME_DIR="/run/user/$uid" \
      DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$uid/bus" \
      systemctl --user disable --now cfsm-netdiag.timer >/dev/null 2>&1 || log 'Inspect old optional timer: unable to disable.'
  fi
fi
changed=0
install -o root -g root -m 700 "$0" "$DEST/install.sh"
log 'Fixed full NQ scheduled Fridays 21:00 Asia/Shanghai (13:00 UTC).'
log 'No immediate resource-intensive test. Main cf-probe unchanged. Reports remain private.'
log 'Inspect: bash /opt/cfsm-nq/install.sh status'
