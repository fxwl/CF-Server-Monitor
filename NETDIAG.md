# Network Diagnostics 1.0.0 (local extension)

Additive extension for this fork of CF-Server-Monitor **2.8.7 Stable**. This is not a new upstream release.

## Scope

- Authenticated, same-domain dashboard at `/netdiag`, linked from the existing home/admin/theme HTML.
- Public IP, ASN/operator/geolocation and separate observations from proxycheck.io v3 and ipapi.is.
- Fuzhou return-route targets only, displayed **Unicom -> Telecom -> Mobile**. The existing deployment swapped its first two metric slots; the extension reads names instead of assuming that `custom_ct` is Telecom.
- Independent unprivileged UDP traceroute, three short TCP connection attempts per target, observed ASN evidence, path/IP/property changes, and historical snapshots.
- No bandwidth downloads/uploads, speedtest, web SSH, generic command queue, automatic executable updates, or extra inbound ports.

The existing Go `cf-probe`, its systemd hardening, credentials, WAF rules, normal metrics and traffic accounting are not changed. No history is cleared by this extension.

## Two components, two deployment states

1. `src/network-entry.js` wraps the existing Worker. `wrangler.toml` points to the wrapper and explicitly retains the existing D1 UUID. Existing routes, cron behavior and Durable Objects are delegated unchanged. Static assets are copied from `public/netdiag` by the existing frontend build.
2. Each VPS must install `public/netdiag/collector.py` once. The cloud dashboard cannot trace from a VPS until that local helper has actually run and reported. A missing collector is shown as **not connected**, never as a fabricated successful trace.

The wrapper adds a small navigation link and standalone diagnostic view. It does not replace the currently selected third-party theme or pretend to modify all of that theme's internal components.

## Install on each existing Debian VPS

Use the dashboard's **Copy install command** button, or the pinned command supplied with the release. Run the installer as root; the collector itself refuses to run as root and uses the existing `cfsm` account. UID and home are discovered locally.

The installer downloads only from `https://monitor.nnot.de/netdiag/download/`, verifies the pinned SHA256 before installing, and installs Debian packages `python3`, `traceroute`, `ca-certificates` only if required. No pip packages or third-party executable mirrors are used. The current WAF whitelist must include the VPS's actual IPv4 egress address.

Files:

- Root-owned collector: `/opt/cfsm-netdiag/collector.py`
- User units: `~cfsm/.config/systemd/user/cfsm-netdiag.service` and `.timer`
- Private cache/state: `~cfsm/.cfsm-netdiag/` (mode 700; files 600)
- Existing config is read, never sourced or modified: `~cfsm/.cf-probe/config.conf`

Schedule: twice daily, 00:20 and 12:20 UTC (08:20 and 20:20 China time), plus up to 15 minutes of randomized delay. The first collection is started by systemd immediately after installation. This is a local timer, not a ChatGPT background task. A successful report has a 10-minute minimum repetition interval.

Management from root:

```bash
bash /opt/cfsm-netdiag/install.sh status
bash /opt/cfsm-netdiag/install.sh remove
```

Manual collection, without changing the original agent:

```bash
u=$(id -u cfsm)
runuser -u cfsm -- env HOME="$(getent passwd cfsm | cut -d: -f6)" XDG_RUNTIME_DIR="/run/user/$u" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$u/bus" systemctl --user start --no-block cfsm-netdiag.service
```

A completed oneshot service normally becomes `inactive (dead)` with `Result=success` / `ExecMainStatus=0`; the timer remains active. This is not an agent crash.

## IP information providers

No paid API account is required to attempt the default lookups. Anonymous calls may be limited, denied from shared cloud egress, or return fewer fields. Failures and missing data remain explicitly unavailable/unknown. Do not infer that an unknown VPN flag means no VPN, that a hosting IP is malicious, or that a provider risk score is a compromise/account-ban probability.

Optional Worker secrets, added through Cloudflare **Variables and Secrets**, never in Git:

- `NETDIAG_PROXYCHECK_KEY`
- `NETDIAG_IPAPI_KEY`

IP quality is checked on demand and by the existing hourly cron, selecting two oldest servers per pass. Successful results are reused for 12 hours; total failure is reused for one hour. Local UTC-day budgets are 80 proxycheck / 20 ipapi calls without keys, and 900 per provider with keys. The providers may apply additional limits to the shared egress IP; local budgets cannot guarantee their availability.

Only registered server IPs already reported by the original agent can be queried. IP observations older than two days are rejected. Public IPs are disclosed to the selected metadata providers as part of the requested diagnostics.

Official references:

- https://proxycheck.io/api/ (v3 pinned to `24-June-2026`)
- https://ipapi.is/developers.html (minimal, legacy flat and full nested response shapes handled)
- https://stat.ripe.net/docs/data-api/api-endpoints/network-info
- https://manpages.debian.org/bookworm/traceroute/traceroute.1.en.html

## Routing and interpretation

Targets are restricted to the configured Fuzhou allowlist. Remote configuration cannot specify an arbitrary host, port or shell command. Resolved destinations must be public IPv4 addresses. IPv6 route collection is not part of this version.

The helper uses classic **UDP** traceroute with numeric output, 30-hop maximum, one probe per TTL, at most three parallel probes, and a 45-second per-route process timeout. It never uses `sudo`, TCP raw mode, root fallback, `setcap`, or `shell=True`. Each target also receives three ordinary TCP connect attempts (no application payload). TCP and UDP may follow different paths.

Public hop addresses are mapped to announcing ASNs using RIPE RIS via RIPEstat. Private hops are never sent to the enrichment service. Results are cached locally for seven days, queries are limited to 48 new public hop IPs per collection and four concurrent requests. Failed lookups are cached for one hour and remain unknown.

Observed AS9929 / AS4837 / AS10099 / AS4809 / AS4134 / AS58453 / AS58807 / AS9808 produce evidence labels. A silent hop is not end-to-end packet loss. Hidden hops, load balancing and asymmetric routing prevent complete path or service-tier guarantees. In particular, AS4809 does not prove CN2 GIA/GT. Partial-path changes are marked separately from complete observed changes.

## Storage and safety

Only these new tables are created/maintained:

- `netdiag_runs`: IP and route snapshots, indexed by server/kind/time.
- `netdiag_locks`: cooldown and concurrent query controls.
- `netdiag_budget`: per-provider daily lookup budgets.

Retention: up to 30 days and at most 60 reports per server per kind. Original `metrics_history`, `servers`, `settings`, passwords and traffic counters are never updated or deleted by this module.

The collector reuses the existing agent secret locally through an HTTPS Authorization header; it never logs the value. Registered server ID and actual Cloudflare source IP are checked. Browser data APIs always require existing admin authentication; modifying browser calls additionally require same-origin checks and a dedicated header. The new API is not a general-purpose external-IP lookup proxy.

Request bodies are streamed with a 64 KiB cap; provider responses have a 128 KiB cap. Redirects are refused for authenticated collector HTTP calls. The UI renders remote data through text nodes rather than HTML injection.

The helper's user service uses only the restrictions already compatible with this deployment: NoNewPrivileges, RestrictSUIDSGID, LockPersonality, RestrictRealtime and UMask 0077. It intentionally avoids CapabilityBoundingSet/AmbientCapabilities, which previously caused 218/CAPABILITIES on this user's Debian user manager.

## Validation

Run with Node 22.16+ (native SQLite) and Python 3:

```bash
node --test test/netdiag.test.mjs
python3 test/netdiag-collector.test.py
bash -n public/netdiag/install.sh
npm run build:frontend
npx wrangler deploy --dry-run
```

Tests exercise the actual module with an isolated SQLite D1 adapter; they never modify production metrics. Unit tests cannot prove external provider uptime or a specific VPS's UDP reachability. Local UI smoke tests use labeled synthetic data, not live diagnostic results. Full end-to-end VPS verification requires at least one collector installation and an accepted report.

## Rollback and upstream synchronization

Remove only the helper with the command above. To roll back the cloud code, deploy the recorded pre-extension Worker version or restore the prior `wrangler.toml` entrypoint (`src/index.js`) and redeploy. Existing monitoring remains independent. New diagnostic tables can be left unused; do not drop the original history tables.

The backup branch is `backup/pre-netdiag-20261111-68c1258`. Review upstream merges: do not force-reset your customized `main` branch to upstream, or the extension will be removed. The existing upstream-sync workflow has not been changed.
