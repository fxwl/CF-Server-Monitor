# CFSM 2.8.7 — monitoring only

This rollback removes the custom IP-quality scoring, independent return-path traces, NodeQuality/streaming/AI tests, and all bespoke diagnosis UI/API/scripts. The original site theme, resource history, alerts, original ICMP/TCP/Fuzhou ping and server list are preserved.

The deployment retains bug fixes from the other chat (ordinary-user Linux ICMP install and timestamp guards) and preserves the existing Cloudflare D1 database binding, Durable Object and Worker hostname. No database tables, ping history, API secrets, server configuration, WAF or external applications are deleted or reset during this code rollback.

The removed optional diagnostics were installed manually on some servers. The Worker can no longer receive diagnosis reports but cannot stop their systemd user timers remotely. Disable those locally with the provided cleanup commands; do not remove cf-probe.

The original upstream source repository is not automatically synced. Future upstream changes require a reviewed commit. Rollback backup branch: backup/pre-remove-netdiag-20261112.
