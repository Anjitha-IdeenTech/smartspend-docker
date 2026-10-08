#!/usr/bin/env bash
# Bring the demo up on this server, and keep it up.
#
#     cp deploy/env.example .env && nano .env
#     bash deploy/bootstrap.sh
#
# Safe to run again: it starts what is down, loads the database only when there
# is none yet (--reload-data replaces it), upgrades the module to the code on
# disk, and leaves the certificate and the settings it generated alone.
set -euo pipefail

# Overridable so the whole deployment can be rehearsed on a laptop with an extra
# -f override file, without changing what it does on a server.
COMPOSE=${COMPOSE:-"docker compose -f docker-compose.prod.yml"}
RELOAD=${1:-}

[ -f docker-compose.prod.yml ] || { echo "run this from the repository root" >&2; exit 2; }
command -v docker >/dev/null || { echo "docker is not installed: see deploy/README.md" >&2; exit 2; }
[ -f .env ] || { echo "no .env yet: cp deploy/env.example .env, then fill it in" >&2; exit 2; }
# shellcheck disable=SC1091
set -a; . ./.env; set +a
[ -n "${SMARTSPEND_DOMAIN:-}" ] || { echo "SMARTSPEND_DOMAIN is empty in .env" >&2; exit 2; }
[ -n "${POSTGRES_PASSWORD:-}" ] || { echo "POSTGRES_PASSWORD is empty in .env" >&2; exit 2; }

if [ ! -f deploy/odoo.conf ]; then
    echo "==> writing deploy/odoo.conf: this machine's database password, and a"
    echo "    master password only this machine knows"
    cp deploy/odoo.conf.dist deploy/odoo.conf
    SECRET=$(openssl rand -hex 24 2>/dev/null || head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
    # Literal replacements, so a '/' or '&' in either password cannot break the
    # line the way sed would.
    python3 - "$SECRET" "$POSTGRES_PASSWORD" <<'PATCH'
import io, sys
secret, db_password = sys.argv[1], sys.argv[2]
path = 'deploy/odoo.conf'
text = io.open(path, encoding='utf-8').read()
text = text.replace('admin_passwd = change-me-before-deploying',
                    'admin_passwd = ' + secret)
text = text.replace('db_password = POSTGRES_PASSWORD_GOES_HERE',
                    'db_password = ' + db_password)
io.open(path, 'w', encoding='utf-8').write(text)
PATCH
    # Odoo runs as uid 101 inside the container and has to read this file. As
    # root we can hand it to that user and keep it private; otherwise it has to
    # be world-readable, which on a machine only you log into is the trade.
    if chown 101:101 deploy/odoo.conf 2>/dev/null; then
        chmod 600 deploy/odoo.conf
    else
        chmod 644 deploy/odoo.conf
    fi
fi

# Postgres first and alone: Odoo creates an empty odoo_19 for itself the moment
# it starts, and an empty database would then look like an installed one.
echo "==> starting Postgres"
$COMPOSE up -d db
for _ in $(seq 1 60); do
    $COMPOSE exec -T db pg_isready -U odoo >/dev/null 2>&1 && break
    sleep 2
done

db_exists() {
    [ "$($COMPOSE exec -T db psql -U odoo -d postgres -tAc \
        "select count(*) from pg_database where datname = 'odoo_19'" | tr -d '[:space:]')" != "0" ]
}
# An Odoo database, as opposed to the bare one Odoo makes when it finds none.
db_installed() {
    db_exists && [ "$($COMPOSE exec -T db psql -U odoo -d odoo_19 -tAc \
        "select count(*) from information_schema.tables where table_name = 'ir_module_module'" \
        | tr -d '[:space:]')" != "0" ]
}
# 401 is the right answer: the module's own endpoint turning down a call that
# carries no token proves Odoo is up and smartspend is loaded.
odoo_answers() {
    $COMPOSE exec -T ui sh -c \
        'wget -q -S -O /dev/null http://web:8069/api/smartspend/master-data 2>&1 | grep -qE " (200|401) "'
}
wait_for_odoo() {
    for _ in $(seq 1 60); do
        odoo_answers && return 0
        sleep 2
    done
    return 1
}

if ! db_installed || [ "$RELOAD" = "--reload-data" ]; then
    [ -f deploy/data/odoo_19.sql.gz ] || {
        echo "no deploy/data/odoo_19.sql.gz — run deploy/ship.sh from your laptop first" >&2
        exit 2; }
    echo "==> loading the demo database"
    $COMPOSE stop web >/dev/null 2>&1 || true
    if db_exists; then
        $COMPOSE exec -T db psql -U odoo -d postgres -c \
            "select pg_terminate_backend(pid) from pg_stat_activity where datname = 'odoo_19'" >/dev/null
        $COMPOSE exec -T db dropdb -U odoo odoo_19
    fi
    $COMPOSE exec -T db createdb -U odoo -O odoo odoo_19
    zcat deploy/data/odoo_19.sql.gz | $COMPOSE exec -T db psql -U odoo -d odoo_19 -q
    RESTORED=yes
fi

echo "==> starting Odoo, nginx and Caddy"
$COMPOSE up -d
wait_for_odoo || { echo "Odoo did not come up: $COMPOSE logs web --tail 40" >&2; exit 1; }

if [ "${RESTORED:-no}" = yes ] && [ -f deploy/data/filestore.tar.gz ]; then
    echo "==> restoring the attachments"
    $COMPOSE exec -T web tar -xzf - -C /var/lib/odoo < deploy/data/filestore.tar.gz
fi

echo "==> bringing the module up to the code on disk"
$COMPOSE exec -T web odoo -c /etc/odoo/odoo.conf -d odoo_19 -u smartspend \
    --stop-after-init --no-http
$COMPOSE restart web
wait_for_odoo || { echo "Odoo did not come back: $COMPOSE logs web --tail 40" >&2; exit 1; }

cat <<DONE

Up, and answering. Share this link:

    https://$SMARTSPEND_DOMAIN/

Odoo's own backend, if you kept that block in deploy/Caddyfile and made the
second DNS record:

    https://odoo.$SMARTSPEND_DOMAIN/

The very first visit can take a few seconds while Caddy gets the certificate.
If it does not come up, the DNS record for $SMARTSPEND_DOMAIN is the first thing
to check, then:  $COMPOSE logs caddy --tail 30
DONE
