# Device Access — Web Interface & mDNS

Notes on how the SIA Test Bench web interface is exposed on a deployed device.
Reference device: `10.144.126.10` (hostname `doovit-91b467`).

## Web interface port: 8092

- The app (`server.py`) starts an aiohttp server on `0.0.0.0`, reading the port
  from the `PORT` env var and falling back to **8092** when unset.
- On the device the `sia_test_bench` container runs with **host networking**
  (no Docker port mapping), so the app binds directly to the host's `:8092`.
- `PORT` is not set on this device, so it uses the default 8092.

Direct access (bypasses nginx):

```
http://10.144.126.10:8092
```

## Friendly name: http://sia-test-bench.local

An nginx reverse proxy + mDNS alias provide a friendly hostname on port 80.

**Request flow:** `http://sia-test-bench.local` → nginx (:80) → `http://127.0.0.1:8092`

### nginx vhost

`/etc/nginx/sites-available/sia-test-bench.conf` (enabled via symlink in
`sites-enabled/`):

```nginx
server {
    listen 80;
    server_name sia-test-bench.local;

    location / {
        proxy_pass http://127.0.0.1:8092;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";  # WebSocket support

        proxy_buffering off;
        proxy_read_timeout 3600;
        proxy_send_timeout 3600;
    }
}
```

### mDNS alias

The `.local` name is published by a systemd service:

- Unit: `/etc/systemd/system/mdns-alias-sia-test-bench.service`
- Script: `/usr/local/bin/publish-mdns-alias sia-test-bench.local`

The script runs one `avahi-publish -a -R sia-test-bench.local <ip>` per
interface, so the name resolves on **every** network the device is on:

| Interface | IP              |
|-----------|-----------------|
| eth0      | 192.168.127.200 |
| wlan0     | 192.168.100.110 |
| br0       | 192.168.50.10   |
| ZeroTier  | 10.144.126.10   |

So `sia-test-bench.local` resolves to `10.144.126.10` over ZeroTier and lands on
the app via nginx.

> Note: `avahi-resolve -n sia-test-bench.local` may print just one of the four
> A-records (e.g. `192.168.127.200`), but all four — including `10.144.126.10` —
> are published.

## Summary

| URL                              | Path                         |
|----------------------------------|------------------------------|
| `http://sia-test-bench.local`    | nginx :80 → proxy → :8092    |
| `http://10.144.126.10:8092`      | app directly                 |

## Device access reference

- SSH: `ssh doovit@<device-ip>` (default creds `doovit` / `doovit`)
- Container name: `sia_test_bench_1-sia_test_bench-1`
- Logs: `docker logs sia_test_bench_1-sia_test_bench-1`
- Health check port: 49200 (`HEALTHCHECK_PORT`)
