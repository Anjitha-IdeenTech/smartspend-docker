# Putting the demo on a URL the client can open

The link to share is one plain address — `https://smartspend-demo.ideenkreisetech.com/`
— with no `?api=` on it and no `127.0.0.1` anywhere. That works because the
server hands the browser both halves from the same hostname: nginx serves the
built portal and passes `/api/` to Odoo, and Caddy in front holds the
certificate.

    Browser ──▶ Caddy :443 ──▶ nginx :80 ──▶ /        the portal
                           │            └──▶ /api/…   Odoo
                           └──────────────▶ Odoo :8069  (odoo.<hostname>)

Nothing else is published: Postgres and Odoo have no port on the internet.

## A link today, before any of this

To put the demo in front of someone right now, from this laptop:

    bash deploy/share.sh

Cloudflare hands out a hostname and the script prints it once it has checked the
demo really answers through it. It holds while this laptop is awake and the
command is running, and it is a different link every time — so it is for a
call you are on, not for a client to come back to next week. `--stop` ends it.

That link works for the same reason the deployed one does: the portal and Odoo
answer on one hostname, so there is nothing to append to it.

## What you need first

1. **A small server.** 2 vCPU / 2 GB RAM / 40 GB is comfortable (Hetzner CX22
   ~€4/mo, DigitalOcean $6/mo, any Ubuntu 24.04 image). Note its public IP.
2. **A DNS record.** An `A` record for `smartspend-demo` under
   `ideenkreisetech.com`, pointing at that IP. If you also want Odoo's own
   screens, a second `A` record for `odoo.smartspend-demo`. Wait until
   `dig +short smartspend-demo.ideenkreisetech.com` answers with the IP —
   Caddy cannot get a certificate before that.
3. **Docker on the server:**

       ssh root@YOUR.IP
       curl -fsSL https://get.docker.com | sh
       ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw --force enable

## Deploying

From this repository on the laptop, with the local stack running (that is where
the demo data is read from):

    bash deploy/ship.sh root@YOUR.IP

It sends the repository, the database as it stands right now, and the uploaded
attachments. Then on the server:

    ssh root@YOUR.IP
    cd /opt/smartspend
    cp deploy/env.example .env
    nano .env            # SMARTSPEND_DOMAIN, and a POSTGRES_PASSWORD
    bash deploy/bootstrap.sh

`bootstrap.sh` starts the four containers, writes a `deploy/odoo.conf` with a
master password only that machine knows, loads the database and attachments,
upgrades the module, and prints the link. The first visit takes a few seconds
while Caddy gets the certificate.

## Sending a change later

    bash deploy/ship.sh root@YOUR.IP --code-only        # module + portal only
    ssh root@YOUR.IP "cd /opt/smartspend && bash deploy/bootstrap.sh"

Drop `--code-only` to also replace the server's data with this laptop's, and add
`--reload-data` to `bootstrap.sh` for it to be loaded:

    bash deploy/ship.sh root@YOUR.IP
    ssh root@YOUR.IP "cd /opt/smartspend && bash deploy/bootstrap.sh --reload-data"

That **replaces** the database on the server, so anything the client entered
there is gone. Take a copy first (below) if that matters.

A change to the portal needs a build before shipping, because the server runs
the built files:

    cd frontend && npm run build && cd ..

## Before you send the link

- **The demo logins are in this repository's README** — `requester/requester`,
  `buyer/buyer` and the rest. On a public URL, anyone who has the link can sign
  in as any of them. That is usually what you want for a demo; if it is not,
  put a shared password in front of everything with the `basic_auth` block at
  the bottom of `deploy/Caddyfile`, and give the client that password with the
  link.
- **Odoo's backend hostname is the admin view.** If you would rather the client
  only ever saw the portal, delete the `odoo.{$SMARTSPEND_DOMAIN}` block from
  `deploy/Caddyfile` and `docker compose -f docker-compose.prod.yml up -d`.
- **The database manager is already off** (`list_db = False`), so nobody can
  create, drop or duplicate databases from outside.

## Day to day

    cd /opt/smartspend
    docker compose -f docker-compose.prod.yml ps
    docker compose -f docker-compose.prod.yml logs -f web        # or caddy, ui
    docker compose -f docker-compose.prod.yml restart web

Take a copy of what is on the server:

    docker compose -f docker-compose.prod.yml exec -T db \
        pg_dump -U odoo -d odoo_19 | gzip > ~/smartspend-$(date +%F).sql.gz

Everything restarts by itself when the server reboots (`restart:
unless-stopped` on all four containers).

## If it does not come up

| What you see | Where to look |
|---|---|
| The browser cannot find the host | DNS: `dig +short smartspend-demo.ideenkreisetech.com` |
| A certificate warning, or plain HTTP | `logs caddy` — nearly always DNS not pointing here yet, or port 80 closed |
| The portal loads but sign-in says it cannot reach the server | `logs web`; check `/config.js` on the site returns `window.SMARTSPEND_API = window.location.origin;` |
| "Internal Server Error" | `logs web` — usually the module needing an upgrade: re-run `bootstrap.sh` |
| An auction does not open at its time | the cron thread: `max_cron_threads` must stay 1 in `deploy/odoo.conf` |
