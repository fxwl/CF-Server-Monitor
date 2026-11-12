// Shared by "copy server command" and "auto-discover server" Linux installs.
// The user runs the generated command as root (or a sudo-capable user). The
// primary agent still runs as cfsm; systemd runs the sidecar as cfsm-quality.
const shellQuote = value => "'" + String(value).replaceAll("'", "'\\''") + "'"

export function attachQualitySidecar(mainCommand, { baseUrl, installMode = 'cfsm-user' } = {}) {
  const host = String(baseUrl || '').replace(/\/+$/, '')
  if (!host.startsWith('https://')) throw new Error('Quality installer requires an HTTPS API base')
  const configLines = installMode === 'cfsm-user'
    ? [
        'CFSM_MAIN_HOME=$(getent passwd cfsm | cut -d: -f6)',
        'CFSM_MAIN_HOME=${CFSM_MAIN_HOME:-/home/cfsm}',
        'CFSM_MAIN_CONFIG="${CFSM_MAIN_HOME%/}/.cf-probe/config.conf"'
      ]
    : ['CFSM_MAIN_CONFIG="$HOME/.cf-probe/config.conf"']
  return [
    '(',
    'set -e',
    mainCommand,
    '# Install the independent diagnostics only after the main probe succeeds.',
    '# Never run either collector as root: the systemd service owns cfsm-quality.',
    'if [ "$(id -u)" -eq 0 ]; then',
    '  as_root() { "$@"; }',
    'elif command -v sudo >/dev/null 2>&1; then',
    '  as_root() { sudo "$@"; }',
    'else',
    '  echo "cfsm-quality installation requires root or sudo" >&2',
    '  exit 1',
    'fi',
    ...configLines,
    'quality_script=$(mktemp)',
    'trap \'rm -f "$quality_script"\' EXIT',
    'echo "Installing independent IPQuality / NetQuality sidecar..."',
    `curl -4fsSL --noproxy '*' --retry 2 --connect-timeout 15 --max-time 120 ${shellQuote(host + '/quality/install.sh')} -o "$quality_script"`,
    'as_root env CFSM_PROBE_CONFIG="$CFSM_MAIN_CONFIG" CFSM_QUALITY_WAIT_FOR_REGISTRATION=1 bash "$quality_script"',
    'as_root systemctl reset-failed cfsm-quality.service',
    'as_root systemctl enable --now cfsm-quality.timer',
    'as_root systemctl start --no-block cfsm-quality.service',
    ')'
  ].join('\n')
}
