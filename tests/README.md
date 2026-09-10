# SmartSpend Phase 1 — regression suites

    ./run_all.sh

Runs all five suites against a running Odoo and prints one line per suite.
Exit code is the number of suites that failed.

| Suite | What it holds down |
|---|---|
| `test_api_contract.py` | Every route answers, and `/requests`, `/submit` and `/parse` return **exactly** the 29 keys the portal expects — none added, none lost. Totals are computed by Odoo, not trusted from the payload. |
| `test_end_to_end.py` | The portal's own sequence — preflight, login, me, master-data, requests, submit, reload, edit, role denials, logout — from origin `http://127.0.0.1:5173`. |
| `test_sync_errors.mjs` | A refused save, decision or purchase order becomes a visible banner row with Odoo's real message, keyed per action, cleared by a successful retry. |
| `test_backend_behaviour.py` | Calculations, every validation, submit/cancel/reset, ownership, and the record rules that keep one requester out of another's lines. |
| `test_backend_form.py` | Every view compiles, every Phase 1 field is on the form, and the header buttons resolve. |
| `test_contract_button.py` | The rate-contract smart button opens the rates that price *this* request — never the rest of the rate card — the label says which slice it is, and every smart-button count matches the list behind it. |
| `test_portal_journey.py` | The whole journey a person makes: sign in, dictate a requisition, save the extraction form, get a save refused, be denied the manager's and buyer's jobs, be approved, get an order raised, cancelled and re-raised, read the rate-contract button, sign out. Every portal call over HTTP from the portal's origin, with Odoo inspected out of band so the journey never marks its own homework. |
| `test_demo_mode.mjs` | The hosted build with no Odoo behind it: sign-in falls back to a local session against the seeded demo accounts (right roles, wrong passwords refused, no password echoed back), and `?api=` redirects the portal at a tunnelled backend, ignoring a mistyped one. Needs no running Odoo. |
| `test_po_lifecycle.py` | Raising an order withdraws the button and confirms the request; cancelling the last one hands the button back, unwinds the state and keeps the cancelled order as history; a replacement can then be raised. |

## Before you run it

Odoo must be up and serving the database you name. Node is needed for the
`.mjs` suite.

    SMARTSPEND_URL=http://127.0.0.1:8019   # where Odoo is
    ODOO_DB=odoo_19                        # which database
    ODOO_CONF=../../odoo.conf              # config to hand odoo-bin
    ODOO_PYTHON=../../env/bin/python       # interpreter that has Odoo
    SMARTSPEND_DB=odoo_19                  # only if Odoo serves several databases

## What it touches

It creates two throwaway accounts — `phase1.requester.test` and
`phase1.manager.test` — and whatever requests the suites raise, then removes
all of it and revokes the API keys it minted.

`_setup_users.py` records the ids of every request that already exists;
`_teardown.py` deletes **only** ids outside that set and asserts nothing from
the baseline went missing. A request raised by a real user before the run is
therefore never at risk. The suites that write through the ORM roll their
transaction back and leave nothing at all.

Even so: **run this against a development database.** A request created by
somebody else *while the suite is running* falls outside the baseline and would
be cleaned up with the test data.
