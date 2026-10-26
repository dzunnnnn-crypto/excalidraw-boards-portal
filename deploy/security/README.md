# Caddy admin access guard

Deployment-specific Linux hardening for the `excalidraw` account with UID 993.
The two rules reject its TCP connections to 127.0.0.1:2019 and [::1]:2019.
Other UIDs, addresses and ports continue through the existing firewall.
Review the actual account, Caddy admin address and existing rules before installation.
This is not a portable default for every server and is not installed by `npm start`.

The helper manages only `inet excalidraw_admin_guard`. It validates the rule file
and existing table, ignores counters/handles for comparison, and refuses unknown
contents instead of overwriting them. Repeated start/stop is idempotent.
It never loads `/etc/nftables.conf` or flushes the ruleset.

Reviewed installation paths:

- rules: `/etc/excalidraw-portal/caddy-admin-guard.nft`, root:root 0600;
- helper: `/usr/local/libexec/excalidraw-caddy-admin-guard.py`, root:root 0700;
- unit: `/etc/systemd/system/excalidraw-admin-guard.service`, root:root 0644;
- dependency drop-in: `90-caddy-admin-guard.conf` under the four existing board units.

Keep rules and helper root-owned and not writable by the application.
The service starts before board units, with CAP_NET_ADMIN as its only bounded capability.
Dependencies deliberately block future board startup if the guard cannot start.
An external root-level firewall flush can still remove this table; this oneshot
service is not a continuous firewall monitor.

Validate the candidate with `nft --check`; test semantics in an isolated network
namespace before production installation. Check blocked access as `excalidraw`,
retained access as root and caddy, board/MCP/guest reads, other sites, reload,
and unchanged unrelated firewall tables. Compare counters to confirm matching.

Rollback order matters: remove only the added Requires/After drop-ins first,
run daemon-reload and confirm dependencies are gone, then stop/disable the guard.
Never stop it first while board units still Require it. Remove only verified
own files/table; preserve unknown or concurrently changed content for review.
Do not restore board data, authentication state or the global firewall for this rollback.

References: https://caddyserver.com/docs/api and
https://wiki.nftables.org/wiki-nftables/index.php/Matching_packet_metainformation .

Local helper regression checks (Linux / Python 3, no root needed):

```sh
python3 tests/caddy-admin-guard.test.py
```

The tests mock identity and every nft call. They do not install rules, change
users or inspect the host firewall. Real packet filtering and systemd ordering
still require the isolated namespace and deployment checks described above.
