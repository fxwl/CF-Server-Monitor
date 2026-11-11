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
