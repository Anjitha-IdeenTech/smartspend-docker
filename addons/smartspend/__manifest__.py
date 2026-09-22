{
    'name': 'SmartSpend AI Procurement Copilot',
    'version': '19.0.1.2.0',
    'summary': 'Purchase requests, rate contracts and the REST API behind the SmartSpend demo UI',
    'description': """
SmartSpend AI Procurement Copilot — Odoo backend
================================================

Backs the SmartSpend front-end (the React "AI Procurement Copilot" demo) with a
real Odoo data model, so every purchase request raised in the portal lands as an
Odoo record you can open, approve and turn into a purchase order.

* ``smartspend.request`` — the purchase request (PR) with its lines, vendor
  bids, approval history and clarification thread.
* ``smartspend.contract`` — pre-negotiated rate contracts. A request is matched
  against the active contracts and the matching one is one click away on a smart
  button.
* Smart buttons on the request for its **Purchase Orders** and its **Rate
  Contract**, and a matching button back to the request from the purchase order.
* A bearer-authenticated REST API under ``/api/smartspend/`` that the portal
  calls to sign in, list requests, submit them and parse free-text requisitions.

Phase 1 makes the backend the source of truth for the request itself: server-side
totals, server-side validation on the request and its lines, a Draft → Submitted
→ Cancelled lifecycle with the user and timestamp behind every move, an audited
timeline that the portal can add to but no longer overwrite, and record rules
that keep a requester's lines, bids and timeline as private as the request they
belong to.
""",
    'author': 'Anjitha',
    'category': 'Inventory/Purchase',
    'license': 'LGPL-3',
    'depends': ['base', 'mail', 'uom', 'analytic', 'purchase'],
    'data': [
        'security/smartspend_security.xml',
        'security/ir.model.access.csv',
        'data/ir_sequence_data.xml',
        'data/smartspend_master_data.xml',
        'data/smartspend_contract_data.xml',
        'data/smartspend_workflow_data.xml',
        'data/smartspend_demo_users_data.xml',
        'data/smartspend_auction_data.xml',
        'views/smartspend_master_views.xml',
        'views/smartspend_budget_views.xml',
        'views/smartspend_request_views.xml',
        'views/smartspend_contract_views.xml',
        'views/smartspend_workflow_views.xml',
        'views/purchase_order_views.xml',
        'views/smartspend_auction_views.xml',
        'wizard/smartspend_request_cancel_views.xml',
        'wizard/smartspend_request_approve_views.xml',
        'views/smartspend_menus.xml',
    ],
    'installable': True,
    'application': True,
}
