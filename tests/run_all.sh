#!/usr/bin/env bash
# SmartSpend Phase 1 — full regression.
#
#   ./run_all.sh
#
# Creates two throwaway users, runs every suite, then removes everything it
# made and asserts the requests that existed beforehand are untouched.
#
# Override with:  ODOO_HOME=/path/to/odoo19  SMARTSPEND_URL=...  ODOO_DB=...
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Two directories up is the Odoo checkout when this module sits inside one.
# Checked out anywhere else, ODOO_HOME says where Odoo actually lives.
ROOT="${ODOO_HOME:-$(cd "$HERE/../.." && pwd)}"
PY="${ODOO_PYTHON:-$ROOT/env/bin/python}"
CONF="${ODOO_CONF:-$ROOT/odoo.conf}"
DB="${ODOO_DB:-odoo_19}"
export SMARTSPEND_URL="${SMARTSPEND_URL:-http://127.0.0.1:8019}"

if [ ! -x "$PY" ] || [ ! -f "$ROOT/odoo-bin" ]; then
  cat >&2 <<MSG
These suites drive a real Odoo, and this copy is not inside an Odoo checkout.
Point them at one:

  ODOO_HOME=/path/to/odoo19 $0

or name the pieces individually:

  ODOO_PYTHON=/path/to/odoo19/env/bin/python \
  ODOO_CONF=/path/to/odoo19/odoo.conf \
  ODOO_DB=odoo_19 $0

Looked for: $PY  and  $ROOT/odoo-bin
MSG
  exit 2
fi

shell() { "$PY" "$ROOT/odoo-bin" shell -c "$CONF" -d "$DB" --no-http < "$1" 2>&1 \
          | grep -vE "^[0-9]{4}-[0-9]{2}-[0-9]{2} .*(INFO|WARNING|DEBUG)"; }

fails=0
report() { # <name> <output>
  local tail; tail=$(printf '%s\n' "$2" | grep -E "[0-9]+ checks, [0-9]+ failed" | tail -1)
  printf '%-42s %s\n' "$1" "${tail:-NO RESULT}"
  printf '%s\n' "$tail" | grep -q ", 0 failed" || { fails=$((fails+1)); printf '%s\n' "$2" | grep "^FAIL"; }
}

if ! curl -sf -o /dev/null "$SMARTSPEND_URL/web/login"; then
  echo "Odoo is not answering at $SMARTSPEND_URL — start it first." >&2; exit 2
fi

echo "SmartSpend Phase 1 regression   db=$DB   url=$SMARTSPEND_URL"
echo "-------------------------------------------------------------------"
shell "$HERE/_teardown.py"    > /dev/null
shell "$HERE/_setup_users.py" > /dev/null

TOKEN=$(shell "$HERE/_make_token.py" | grep '^TOKEN_ADMIN=' | cut -d= -f2)
export SMARTSPEND_TOKEN="$TOKEN"

report "1. API contract"            "$("$PY" "$HERE/test_api_contract.py" 2>&1)"
shell "$HERE/_teardown.py" > /dev/null; shell "$HERE/_setup_users.py" > /dev/null
report "2. End to end (portal flow)" "$("$PY" "$HERE/test_end_to_end.py" 2>&1)"
shell "$HERE/_teardown.py" > /dev/null; shell "$HERE/_setup_users.py" > /dev/null
report "3. Failed calls are visible" "$(node "$HERE/test_sync_errors.mjs" 2>&1)"
shell "$HERE/_teardown.py" > /dev/null
report "4. Backend behaviour + security" "$(shell "$HERE/test_backend_behaviour.py")"
report "5. Odoo backend form"        "$(shell "$HERE/test_backend_form.py")"
report "6. Rate contract smart button"  "$(shell "$HERE/test_contract_button.py")"
report "7. Purchase order lifecycle"    "$(shell "$HERE/test_po_lifecycle.py")"
shell "$HERE/_teardown.py" > /dev/null; shell "$HERE/_setup_users.py" > /dev/null
report "8. Full portal journey"         "$("$PY" "$HERE/test_portal_journey.py" 2>&1)"
report "9. Hosted demo (no Odoo)"        "$(node "$HERE/test_demo_mode.mjs" 2>&1)"
report "10. Reverse auctions"           "$(shell "$HERE/test_auction_backend.py")"

echo "-------------------------------------------------------------------"
shell "$HERE/_teardown.py" | grep -E "requests left|BASELINE"
shell "$HERE/_finish.py" > /dev/null
[ "$fails" -eq 0 ] && echo "ALL SUITES PASSED" || echo "$fails SUITE(S) FAILED"
exit "$fails"
