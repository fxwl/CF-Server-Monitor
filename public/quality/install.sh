#!/usr/bin/env bash
# Install the independent diagnostics alongside, never instead of, cf-probe.
set -Eeuo pipefail
export DEBIAN_FRONTEND=noninteractive
if [ "$(id -u)" -ne 0 ]; then echo 'Run as root' >&2; exit 1; fi
command -v systemctl >/dev/null || { echo 'systemd required' >&2; exit 1; }
command -v apt-get >/dev/null || { echo 'Debian/Ubuntu only' >&2; exit 1; }
# Preserve root CFSM config, but use a separate unprivileged OS account.
test -r /etc/config/cf-probe/config.conf || { echo 'Install the main cf-probe first' >&2; exit 1; }
if ! id cfsm-quality >/dev/null 2>&1; then
    useradd --system --home-dir /var/lib/cfsm-quality --shell /usr/sbin/nologin --no-create-home cfsm-quality
fi
install -d -m 0755 -o root -g root /opt/cfsm-quality
install -d -m 0700 -o cfsm-quality -g cfsm-quality /var/lib/cfsm-quality
install -d -m 0750 -o root -g cfsm-quality /etc/cfsm-quality
grep -E '^(SERVER_ID|SECRET)=' /etc/config/cf-probe/config.conf > /etc/cfsm-quality/credentials.conf
test "$(grep -c '^SERVER_ID=' /etc/cfsm-quality/credentials.conf)" -eq 1
test "$(grep -c '^SECRET=' /etc/cfsm-quality/credentials.conf)" -eq 1
chown root:cfsm-quality /etc/cfsm-quality/credentials.conf
chmod 0640 /etc/cfsm-quality/credentials.conf

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
