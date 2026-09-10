# SmartSpend — the whole stack in Docker

Three containers: the React demo behind nginx, the Odoo 19 module, and Postgres
with the demo data already in it. Clone, start, restore, open.

    Browser ──▶ nginx :8090   serves the built demo
       └──────▶ Odoo  :8079   the smartspend module's REST API
                  └──▶ Postgres :5433

nginx never talks to Odoo. It hands the browser the page; the browser then calls
Odoo itself, which is why the module's controllers carry `cors='*'`.

## Run it

    docker compose up -d

Then restore the demo database (once):

    zcat database/odoo_19.sql.gz | docker compose exec -T db psql -U odoo -d odoo_19
    docker compose restart web

Open **http://127.0.0.1:8090/** — nginx redirects to `?api=http://127.0.0.1:8079`
so the plain URL reaches this stack's Odoo. Odoo's own backend is on
**http://127.0.0.1:8079**.

| Login | Password | Portal |
|---|---|---|
| `requester@smartspend.demo` | `requester` | Requester |
| `manager@smartspend.demo` | `manager` | Manager |
| `buyer@smartspend.demo` | `buyer` | SCM Buyer |
| `vendor@smartspend.demo` | `vendor` | Vendor |
| `admin@smartspend.demo` | `admin` | Full access |

> These are demo credentials for a local stack. Change them before exposing
> this to a network. The database ships with no API keys and no password for
> Odoo's built-in `admin` user — sign in as `admin@smartspend.demo` instead.

## What is where

| Path | Is |
|---|---|
| `frontend/` | React source for the demo (`src/App.tsx`, `src/demoMode.ts`) |
| `site/` | The built demo, which nginx serves |
| `addons/smartspend/` | The Odoo 19 module: models, controllers, security, views |
| `database/odoo_19.sql.gz` | Demo data — requests, purchase orders, contracts, budgets |
| `config/odoo.conf` | Odoo's config inside the container |
| `nginx.conf` | Serves `site/` and points the browser at Odoo on 8079 |
| `tests/` | Regression suites for both halves |

## The walkthrough

| # | Role | Does |
|---|---|---|
| 1 | Requester | Raises the request |
| 2 | Manager | Approves — signs the configured approval chain |
| 3 | SCM Buyer | Sources it, then generates the purchase order |
| 4 | Manager | Approves and releases the PO to the vendor |
| 5 | SCM Buyer or Vendor | Records the vendor acknowledgment |
| 6 | Manager | Goods receipt, three-way match, payment |

The role comes from the account you sign in as, so switching role means signing
in as someone else.

## Checking it is really connected

On the sign-in screen the **Odoo Backend URL** must read `http://127.0.0.1:8079`,
and once inside the sidebar must say **Connected**. If it says **Sample data**
the portal cannot reach Odoo and is running on its offline set — nothing you do
will be saved, and it will say so when you submit.

    docker compose ps                     # all three healthy?
    docker compose logs -f web            # every API call appears here
    docker compose exec db psql -U odoo -d odoo_19 \
      -c "select name,product_name,state from smartspend_request order by id desc limit 5;"

## After a code change

    # frontend
    cd frontend && npm install && npm run build   # writes ../site
    docker compose restart ui

    # backend module
    docker compose restart web
    # or, for a schema change:
    docker compose exec web odoo -c /etc/odoo/odoo.conf -d odoo_19 -u smartspend --stop-after-init

## Ports

| Port | Is |
|---|---|
| 8090 | The demo UI |
| 8079 | Odoo |
| 5433 | Postgres |

Chosen to stay clear of a default Odoo on 8069 and a dev server on 5173.
