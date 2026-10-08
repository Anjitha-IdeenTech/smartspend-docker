#!/usr/bin/env bash
# The demo on its own hostname — smartspend-demo.ideenkreisetech.com — without
# a server, straight from this laptop.
#
# Once, in a browser (this is the part that needs your Cloudflare account):
#
#     cloudflared tunnel login
#
# Then, here:
#
#     bash deploy/tunnel-named.sh              # creates it if needed, starts it
#     bash deploy/tunnel-named.sh --stop
#
# Unlike share.sh the hostname never changes, so the link you give a client
# keeps working across restarts — while this laptop is awake. When the server in
# deploy/README.md exists, point the same record at it and the link moves with
# no new link to send anyone.
set -euo pipefail

HOSTNAME_=${SMARTSPEND_HOSTNAME:-smartspend-demo.ideenkreisetech.com}
TUNNEL=${SMARTSPEND_TUNNEL:-smartspend-demo}
PORT=${PORT:-8090}
RUN_DIR=${RUN_DIR:-deploy/data}
LOG="$RUN_DIR/tunnel-named.log"
PIDFILE="$RUN_DIR/tunnel-named.pid"
CLOUDFLARED=${CLOUDFLARED:-$HOME/.local/bin/cloudflared}

stop() {
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
        kill "$(cat "$PIDFILE")"; echo "$HOSTNAME_ taken down"
    else
        echo "nothing was running"
    fi
    rm -f "$PIDFILE"
}
[ "${1:-}" = "--stop" ] && { stop; exit 0; }

[ -f docker-compose.yml ] || { echo "run this from the repository root" >&2; exit 2; }
[ -x "$CLOUDFLARED" ] || { echo "cloudflared is not installed — see deploy/share.sh" >&2; exit 2; }
[ -f "$HOME/.cloudflared/cert.pem" ] || {
    echo "Cloudflare has not been signed into on this machine. Once:" >&2
    echo "    $CLOUDFLARED tunnel login" >&2
    echo "It opens a browser; pick the ideenkreisetech.com zone." >&2
    exit 2; }
curl -fsS -o /dev/null "http://127.0.0.1:$PORT/" || {
    echo "nothing is serving the demo on $PORT — docker compose up -d" >&2; exit 2; }

mkdir -p "$RUN_DIR"
if ! "$CLOUDFLARED" tunnel list 2>/dev/null | awk '{print $2}' | grep -qx "$TUNNEL"; then
    echo "==> creating the tunnel '$TUNNEL'"
    "$CLOUDFLARED" tunnel create "$TUNNEL"
fi
echo "==> pointing $HOSTNAME_ at it"
"$CLOUDFLARED" tunnel route dns --overwrite-dns "$TUNNEL" "$HOSTNAME_"

[ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null && stop
: > "$LOG"
nohup "$CLOUDFLARED" tunnel --no-autoupdate --url "http://127.0.0.1:$PORT" run "$TUNNEL" >"$LOG" 2>&1 &
echo $! > "$PIDFILE"

echo "==> checking https://$HOSTNAME_ answers"
WORKS=no
for _ in $(seq 1 60); do
    if curl -fsS -o /dev/null "https://$HOSTNAME_/" && \
       curl -fsS -o /dev/null -X POST -H 'Content-Type: application/json' \
           -d '{"login":"buyer@smartspend.demo","password":"buyer"}' \
           "https://$HOSTNAME_/api/smartspend/login"; then
        WORKS=yes; break
    fi
    sleep 2
done

cat <<DONE

    https://$HOSTNAME_

DONE
[ "$WORKS" = yes ] && echo "Checked: the portal and its API both answer there." \
  || echo "Not answering yet — DNS usually catches up within a minute or two. Log: $LOG"
