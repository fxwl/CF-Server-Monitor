# CFSM 2.8.7 — independent quality diagnostics

The original Cloudflare server monitoring implementation, existing cf-probe, dashboard metrics, alerts, resource history, Fuzhou CU/CT/CM Ping, original D1 resource bindings and Durable Objects remain unchanged.

The sole new diagnostics are independent upstream xykt/IPQuality and xykt/NetQuality, collected by optional VPS-side systemd timers and stored as isolated CFSM D1 tables. No all-in-one NodeQuality, third-party averaged scores, inferred route classification or forced upstream synchronization. Failed/missing upstream measurements remain unmeasured.

The source and collector are pinned. The VPS collector requires separate installation as the existing cfsm OS user and does not replace, disable or mutate the primary cf-probe. Existing cloud metrics tables and historic data are not reset. Runtime diagnostics settings are scoped globally or per server, and administrator-triggered checks are picked up by the separate sidecar timer.

Build and production deploy must use the existing Worker name and deployment bindings. Do not overwrite production secrets and do not reinitialize monitoring data.
