#!/usr/bin/env bash
# Install the independent diagnostics alongside, never instead of, cf-probe.
set -Eeuo pipefail
export DEBIAN_FRONTEND=noninteractive
if [ "$(id -u)" -ne 0 ]; then echo 'Run as root' >&2; exit 1; fi
command -v systemctl >/dev/null || { echo 'systemd required' >&2; exit 1; }
command -v apt-get >/dev/null || { echo 'Debian/Ubuntu only' >&2; exit 1; }
# Find official root/system or Go-agent user-mode credentials. Never
# modify the original cf-probe service, binary, or configuration file.
probe_config=''
if [ -n "${CFSM_PROBE_CONFIG:-}" ]; then
    case "$CFSM_PROBE_CONFIG" in /*) ;; *) echo 'CFSM_PROBE_CONFIG must be an absolute path' >&2; exit 2 ;; esac
    test -f "$CFSM_PROBE_CONFIG" && test -r "$CFSM_PROBE_CONFIG" || {
        echo 'Selected CFSM_PROBE_CONFIG is not a readable file' >&2; exit 2;
    }
    probe_config="$CFSM_PROBE_CONFIG"
else
    declare -a candidates=()
    add_candidate() {
        local path="$1" existing
        test -f "$path" && test -r "$path" || return 0
        for existing in "${candidates[@]}"; do
            [ "$existing" = "$path" ] && return 0
        done
        candidates+=("$path")
    }
    add_candidate /etc/config/cf-probe/config.conf
    add_candidate /root/.cf-probe/config.conf
    while IFS=: read -r _user _pass _uid _gid _gecos home _shell; do
        case "$home" in /*) add_candidate "${home%/}/.cf-probe/config.conf" ;; esac
    done < <(getent passwd 2>/dev/null || true)
    if [ "${#candidates[@]}" -eq 0 ]; then
        cat >&2 <<'HELP'
No CFSM probe credentials were found at the official root or user paths.
Check the main probe: systemctl status cf-probe --no-pager
If absent, add this VPS in the CFSM admin Server list, then run the
main agent's Linux install command before installing this quality sidecar.
For a custom config location, retry using:
  CFSM_PROBE_CONFIG=/absolute/path/to/config.conf bash install.sh
No main probe or diagnostics services have been changed.
HELP
        exit 2
    fi
    if [ "${#candidates[@]}" -gt 1 ]; then
        printf 'Multiple probe configs found; select with CFSM_PROBE_CONFIG:\n' >&2
        printf '  %s\n' "${candidates[@]}" >&2
        exit 2
    fi
    probe_config="${candidates[0]}"
fi
echo "Found CFSM credentials at: $probe_config"
# Read data as text only, never source an untrusted config.
probe_id="$(sed -n 's/^SERVER_ID=//p' "$probe_config" | sed 's/^"//; s/"$//')"
probe_secret="$(sed -n 's/^SECRET=//p' "$probe_config" | sed 's/^"//; s/"$//')"
if ! [[ "$probe_id" =~ ^[0-9a-fA-F-]{20,80}$ ]] || [ "${#probe_secret}" -lt 16 ]; then
    echo 'The main probe config lacks a valid SERVER_ID or SECRET.' >&2
    echo 'For an auto-discovered agent, register the server ID in CFSM admin first.' >&2
    exit 2
fi
unset probe_id probe_secret
if [ "${CFSM_QUALITY_PREFLIGHT_ONLY:-0}" = 1 ]; then
    echo 'CFSM quality installer preflight passed; no changes made'
    exit 0
fi
if ! id cfsm-quality >/dev/null 2>&1; then
    useradd --system --home-dir /var/lib/cfsm-quality --shell /usr/sbin/nologin --no-create-home cfsm-quality
fi
install -d -m 0755 -o root -g root /opt/cfsm-quality
install -d -m 0700 -o cfsm-quality -g cfsm-quality /var/lib/cfsm-quality
install -d -m 0750 -o root -g cfsm-quality /etc/cfsm-quality
credential_tmp="$(mktemp /etc/cfsm-quality/.credentials.XXXXXXXX)"
trap 'rm -f "$credential_tmp"' EXIT
grep -E '^(SERVER_ID|SECRET)=' "$probe_config" > "$credential_tmp"
test "$(grep -c '^SERVER_ID=' "$credential_tmp")" -eq 1
test "$(grep -c '^SECRET=' "$credential_tmp")" -eq 1
chown root:cfsm-quality "$credential_tmp"
chmod 0640 "$credential_tmp"
mv -f "$credential_tmp" /etc/cfsm-quality/credentials.conf

apt-get update -qq
apt-get install -y -qq --no-install-recommends python3 curl jq bc dnsutils netcat-openbsd iproute2 iperf3 traceroute ca-certificates libcap2-bin

# Official NextTrace Debian packages, installed only if not already available.
if ! command -v nexttrace >/dev/null 2>&1; then
    install -d -m 0755 /etc/apt/keyrings
    tempkey="$(mktemp)"
    trap 'rm -f "$tempkey"' EXIT
    curl -4fsSL --retry 2 --connect-timeout 20 --max-time 120 \
      'https://github.com/nxtrace/nexttrace-debs/releases/latest/download/nexttrace-archive-keyring.gpg' -o "$tempkey"
    install -m 0644 "$tempkey" /etc/apt/keyrings/nexttrace.gpg
    printf '%s\n' 'Types: deb' 'URIs: https://github.com/nxtrace/nexttrace-debs/releases/latest/download/' 'Suites: ./' 'Signed-By: /etc/apt/keyrings/nexttrace.gpg' > /etc/apt/sources.list.d/nexttrace.sources
    apt-get update -qq
    apt-get install -y -qq --no-install-recommends nexttrace
fi
# Allow non-root NextTrace to use raw packet sockets.
NEXTPATH="$(command -v nexttrace || true)"
if [ -n "$NEXTPATH" ]; then setcap cap_net_raw,cap_net_admin+eip "$NEXTPATH" || true; fi

# Both script versions are fixed to reviewed upstream commits; never fetch 'main' dynamically.
URL_BASE='https://raw.githubusercontent.com/xykt'
curl -4fsSL --retry 2 --max-time 120 \
  "$URL_BASE/IPQuality/8e685686e1df89119d9aeb182a9dedbc88da19e3/ip.sh" -o /opt/cfsm-quality/ip.sh.new
curl -4fsSL --retry 2 --max-time 120 \
  "$URL_BASE/NetQuality/e91cd4963c2676da0e12bcece8ccb145e04a6735/net.sh" -o /opt/cfsm-quality/net.sh.new
bash -n /opt/cfsm-quality/ip.sh.new
bash -n /opt/cfsm-quality/net.sh.new
install -m 0755 -o root -g root /opt/cfsm-quality/ip.sh.new /opt/cfsm-quality/ip.sh
install -m 0755 -o root -g root /opt/cfsm-quality/net.sh.new /opt/cfsm-quality/net.sh
rm -f /opt/cfsm-quality/ip.sh.new /opt/cfsm-quality/net.sh.new

curl -4fsSL --retry 2 --max-time 120 'https://monitor.nnot.de/quality/collector.py' \
  -o /opt/cfsm-quality/collector.py.new
python3 -m py_compile /opt/cfsm-quality/collector.py.new
install -m 0755 -o root -g root /opt/cfsm-quality/collector.py.new /opt/cfsm-quality/collector.py
rm -f /opt/cfsm-quality/collector.py.new

cat >/etc/systemd/system/cfsm-quality.service <<SERVICE
[Unit]
Description=CFSM independent IP and network quality collector
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
User=cfsm-quality
Group=cfsm-quality
Environment=HOME=/var/lib/cfsm-quality
WorkingDirectory=/var/lib/cfsm-quality
ExecStart=/usr/bin/python3 /opt/cfsm-quality/collector.py
TimeoutStartSec=3h
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/var/lib/cfsm-quality
AmbientCapabilities=CAP_NET_RAW
CapabilityBoundingSet=CAP_NET_RAW
RestrictSUIDSGID=true
LockPersonality=true
UMask=0077
StandardOutput=journal
StandardError=journal
SERVICE
cat >/etc/systemd/system/cfsm-quality.timer <<'TIMER'
[Unit]
Description=Check CFSM diagnostics schedule every 15 minutes
[Timer]
OnCalendar=*:0/15
RandomizedDelaySec=20
Persistent=true
Unit=cfsm-quality.service
[Install]
WantedBy=timers.target
TIMER
systemctl daemon-reload
systemctl enable --now cfsm-quality.timer
echo 'cfsm-quality installed, existing cf-probe unchanged'
echo 'Run: systemctl start cfsm-quality.service'
