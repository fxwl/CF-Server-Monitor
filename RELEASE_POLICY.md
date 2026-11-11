# Frozen Fuzhou monitoring release

Release: **2.8.7-fuzhou.20261111.1**. This is a local stable integration, not a new upstream CFSM release.

The base is `031206f972e3ed0915f694f1046af585a1b5758a`, which already contains the prior NQ/TQ-style UI work plus the separate chat's non-root ICMP installer and future-timestamp guards. Keep those fixes. No histories or settings are reset by this release.

## UI

The existing pinned AnotherLuminaPlus theme remains selected. Public IP is placed beside the server name. Homepage cards display a compact quality/ASN/return-path summary without duplicating all the resource and latency charts. Native `/server/:id` and `/instance/:id` pages show the full NQ-style report: basic info, provider-by-provider classification, separate risk indicators, explicit factor matrix, all route hops, and history. `/netdiag` uses the same report renderer as a compatibility entry point.

All collected provider fields are displayed. Missing data remains unknown. The free IPinfo/ipwho.is sources only provide location and ASN, not risk or proxy classifications. Media/AI unlock, mail and bulk DNSBL scanning are not run and are labeled as not enabled; no synthetic pass/clean scores are generated.

## Probe compatibility

Existing primary `cf-probe` installations do not need to be reinstalled. Their merged ordinary-user ICMP implementation, hardening, credentials and history timestamp guards are retained. The build includes checksum-verified first-party amd64/arm64 installation assets, so newly added servers use the corrected installer.

The optional independent diagnostics component needs one final upgrade to **1.2.0** for the same canonical Fuzhou targets: Unicom 36.248.48.211, Telecom 218.85.157.99, Mobile 211.138.151.161. It takes five non-root ICMP measurements and an ordinary unprivileged UDP traceroute; it does not assume these IPs expose TCP ports. Old diagnostics stay readable but are labeled as old-target observations, not mixed with current measurements.

The 1.2.0 installer is pinned under `/netdiag/releases/1.2.0/install.sh` and verifies the collector hash before installation. It never restarts or replaces the main Go probe, changes firewall/SSH, grants raw-socket capabilities, or enables automatic upgrades. Installation starts a local systemd oneshot task; `inactive` after successful completion is normal. Use `bash /opt/cfsm-netdiag/install.sh status` to verify `Result=success` and `report_accepted`.

## Deployment and rollback

Production is the existing **cf-server-monitor** Worker, existing D1 UUID and Durable Object binding. Never generate a `server-monitor-pro` configuration or replace the entrypoint with `src/index.js`: that would omit the customization. The connected Workers Builds pipeline runs `bash scripts/release-build.sh`, then `npx --no-install wrangler deploy`. The GitHub deploy workflow is now manual-only and reuses committed `wrangler.toml`; it never places secrets into source.

The daily upstream-sync schedule has been removed. Keep the package lock with `npm ci`, pinned theme and pinned Go source. A deliberate reviewed commit can still trigger a build; no schedule pulls or deploys new upstream releases. Necessary security/reliability fixes must be evaluated and regression-tested in a separate branch. Record a backup branch before changes and do not force-reset main.

Rollback uses the previous successful Worker deployment and leaves D1 data intact. The backup source branch is `backup/pre-stable-merge-20261111-031206f`. Application rollback does not restore external database history.


## 2026-11-12 Frozen Weekly Full NodeQuality

The operator requested a full NQ run once per week, **Friday 21:00 Asia/Shanghai** (13:00 UTC), not continuous fragmented IP-quality lookups. Full NQ includes hardware benchmarks (HardwareQuality), IP risk / media / mail (IPQuality), NetQuality including throughput measurements and return routes. These tests are intentionally resource-intensive. Weekly runs require Linux root to mount the pinned BenchOS chroot; this is not the original unprivileged cf-probe. Install on production VPS only after reviewing the code, provider terms and available storage.

- The original NodeQuality launcher is copied from upstream commit a92fca6c0067df29ddd03fdc2fee6f3000f64545, with original AGPL-3.0 license included.
- IPQuality, NetQuality and HardwareQuality scripts are separately pinned to the recorded xykt commits and served from CFSM; BenchOS v0.0.2 artifacts are SHA256 checked against GitHub's published release digests before extraction.
- The modified launcher bypasses public NodeQuality report upload and copies the four JSON sections to private local storage instead. The exact scripts are available in this public repository with AGPL notices. External provider requests and network speedtests performed inside the original scripts cannot be made fully static or risk-free; read the vendor source before enabling.
- Local root-only records: /var/lib/cfsm-nq/reports/ (13 newest retained), capped console log 4 MiB per run. Cloudflare D1 stores up to 26 weekly JSON records per server in netdiag_nq_runs, with strict source-IP / agent-secret validation and raw report available only to admins.
- The new dedicated cfsm-nq.timer runs at the fixed Friday schedule. The installer pauses only the previous twice-daily cfsm-netdiag.timer. It never restarts the main cf-probe, changes SSH or firewall, or runs NodeQuality immediately after install.
- Cloudflare Worker no longer schedules the older hourly third-party quality lookups; original metrics / real-time Fuzhou CU, CT, CM ICMP continue.
- The current AnotherLuminaPlus card uses provider-specific meter bars and media result segments without duplicating native resource charts. Native detail pages provide structured scores, factors, media, mail, BGP/network, and four complete source JSON reports for admins. Unknown is not clean or zero.
- No automatic pull of new NodeQuality commits or upstream CFSM releases. Stable release baseline a55259f2a79fba44da03f5cd475d0afea25ff06b was used to remove the failed unshipped 1.3.0 ad-hoc media experiment.
