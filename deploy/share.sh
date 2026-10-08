#!/usr/bin/env bash
# A public link to this laptop's demo, in one command — for showing a client
# something today, before the server in deploy/README.md exists.
#
#     bash deploy/share.sh          # starts it and prints the link
#     bash deploy/share.sh --stop   # takes it down
#
# Cloudflare gives out the hostname, so there is nothing to buy and nothing to
# configure. What you give up: the link lives only while this laptop is awake
# and this tunnel is running, and it is a different link every time it starts.
# For a link that stays put, deploy to a server — see deploy/README.md.
set -euo pipefail

PORT=${PORT:-8090}
RUN_DIR=${RUN_DIR:-deploy/data}
LOG="$RUN_DIR/tunnel.log"
PIDFILE="$RUN_DIR/tunnel.pid"
CLOUDFLARED=${CLOUDFLARED:-$HOME/.local/bin/cloudflared}

stop() {
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
        kill "$(cat "$PIDFILE")"
        echo "link taken down"
    else
        echo "nothing was running"
    fi
    rm -f "$PIDFILE"
}

[ "${1:-}" = "--stop" ] && { stop; exit 0; }

[ -f docker-compose.yml ] || { echo "run this from the repository root" >&2; exit 2; }
if [ ! -x "$CLOUDFLARED" ]; then
    echo "cloudflared is not installed. Once:" >&2
    echo "    mkdir -p ~/.local/bin && curl -fsSL -o ~/.local/bin/cloudflared \\" >&2
    echo "        https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \\" >&2
    echo "        && chmod +x ~/.local/bin/cloudflared" >&2
    exit 2
fi
curl -fsS -o /dev/null "http://127.0.0.1:$PORT/" || {
    echo "nothing is serving the demo on $PORT — start the stack first: docker compose up -d" >&2
    exit 2; }

[ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null && { echo "already running"; stop; }
mkdir -p "$RUN_DIR"
: > "$LOG"
nohup "$CLOUDFLARED" tunnel --url "http://127.0.0.1:$PORT" --no-autoupdate >"$LOG" 2>&1 &
echo $! > "$PIDFILE"

for _ in $(seq 1 45); do
    URL=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" "$LOG" | head -1 || true)
    [ -n "${URL:-}" ] && break
    sleep 2
done
[ -n "${URL:-}" ] || { echo "the tunnel did not come up — see $LOG" >&2; stop; exit 1; }

# Prove it end to end before handing the link over: the page, and the API on
# the same hostname (that is the part a wrong setup breaks). The hostname is
# brand new, so give the world's DNS a minute to know it.
# A brand-new hostname can take a couple of minutes to be known everywhere, and
# a resolver that already answered "no such host" will keep saying so for a
# while, so this waits it out rather than calling it a failure.
echo "checking the link answers (a new hostname can take a minute or two)..."
WORKS=no
for _ in $(seq 1 60); do
    if curl -fsS -o /dev/null "$URL/" && \
       curl -fsS -o /dev/null -X POST -H 'Content-Type: application/json' \
           -d '{"login":"buyer@smartspend.demo","password":"buyer"}' "$URL/api/smartspend/login"; then
        WORKS=yes
        break
    fi
    sleep 2
done
if [ "$WORKS" != yes ]; then
    cat >&2 <<WARN

The tunnel is up but nothing answered through it yet, which is nearly always
DNS still catching up. The link is:

    $URL

Try it in a browser in a minute. If it still does nothing, see $LOG.
WARN
    exit 1
fi

cat <<DONE

Share this:

    $URL

It stays up while this laptop is awake and this stays running. To take it down:
    bash deploy/share.sh --stop
DONE
