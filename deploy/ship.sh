#!/usr/bin/env bash
# Send this machine's demo to the server: the repository, the database exactly
# as it stands now, and the attachments people have uploaded.
#
#     bash deploy/ship.sh root@203.0.113.10
#     bash deploy/ship.sh root@203.0.113.10 --code-only   # no data, just files
#
# Run it from the repository root, with the local stack up (that is where the
# database is read from). Re-running it is how a change reaches the server: the
# server's own .env, its deploy/odoo.conf and its data are never overwritten.
set -euo pipefail

TARGET=${1:-}
MODE=${2:-}
REMOTE_DIR=${REMOTE_DIR:-/opt/smartspend}
LOCAL_PROJECT=smartspend-backup   # the local stack, from docker-compose.yml

if [ -z "$TARGET" ]; then
    echo "usage: bash deploy/ship.sh user@server [--code-only]" >&2
    exit 2
fi
[ -f docker-compose.prod.yml ] || { echo "run this from the repository root" >&2; exit 2; }
command -v rsync >/dev/null || { echo "rsync is not installed here: sudo apt install rsync" >&2; exit 2; }

echo "==> making sure the server has $REMOTE_DIR"
ssh "$TARGET" "mkdir -p $REMOTE_DIR/deploy/data"

if [ "$MODE" != "--code-only" ]; then
    mkdir -p deploy/data
    echo "==> dumping the database as it stands"
    docker compose -p "$LOCAL_PROJECT" exec -T db pg_dump -U odoo -d odoo_19 \
        | gzip -9 > deploy/data/odoo_19.sql.gz
    echo "    $(du -h deploy/data/odoo_19.sql.gz | cut -f1)"
    echo "==> packing the attachments"
    docker compose -p "$LOCAL_PROJECT" exec -T web tar -czf - -C /var/lib/odoo . \
        > deploy/data/filestore.tar.gz
    echo "    $(du -h deploy/data/filestore.tar.gz | cut -f1)"
fi

echo "==> sending the repository"
# Not .git (the server only runs the files), not node_modules (huge, rebuilt
# only here), and not the server's own settings or data.
rsync -az --delete \
    --exclude '.git/' --exclude 'node_modules/' --exclude '.env' \
    --exclude 'deploy/odoo.conf' --exclude 'deploy/data/' \
    ./ "$TARGET:$REMOTE_DIR/"

if [ "$MODE" != "--code-only" ]; then
    echo "==> sending the data"
    rsync -az --progress deploy/data/odoo_19.sql.gz deploy/data/filestore.tar.gz \
        "$TARGET:$REMOTE_DIR/deploy/data/"
fi

cat <<NEXT

Sent to $TARGET:$REMOTE_DIR

On the server, the first time:
    ssh $TARGET
    cd $REMOTE_DIR
    cp deploy/env.example .env && nano .env      # hostname + a POSTGRES_PASSWORD
    bash deploy/bootstrap.sh

Afterwards, to pick up what you just sent:
    ssh $TARGET "cd $REMOTE_DIR && bash deploy/bootstrap.sh"
NEXT
