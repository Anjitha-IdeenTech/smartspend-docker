"""Analytic distribution on request lines — Odoo's, carried to the purchase order.

Each requested item says which analytic accounts its cost lands on, and in what
share (Odoo's *Analytic Distribution*: ``{account id: percent}``). It starts as
the request's cost center at 100%, can be split across accounts and plans, and
goes onto the purchase order line unchanged, so the vendor bill and every
analytic report Odoo has see the same split.
"""
from odoo import api, fields, models, _
from odoo.exceptions import ValidationError

from .smartspend_product_request import same_product


class SmartspendRequestLine(models.Model):
    _name = 'smartspend.request.line'
    _inherit = ['smartspend.request.line', 'analytic.mixin']

    @api.depends('request_id.analytic_account_id')
    def _compute_analytic_distribution(self):
        """The request's cost center, in full — until someone splits it."""
        for line in self:
            if not line.analytic_distribution and line.request_id.analytic_account_id:
                line.analytic_distribution = {str(line.request_id.analytic_account_id.id): 100.0}

    @api.constrains('analytic_distribution')
    def _check_distribution_total(self):
        for line in self:
            dist = line.analytic_distribution or {}
            if not dist:
                continue
            # Odoo allows several plans, each adding up to 100% on its own:
            # check each plan's share separately.
            totals = {}
            for key, pct in dist.items():
                for account in self.env['account.analytic.account'].browse(
                        [int(a) for a in str(key).split(',') if a.strip().isdigit()]).exists():
                    totals[account.root_plan_id] = totals.get(account.root_plan_id, 0.0) + float(pct or 0)
            for plan, total in totals.items():
                if abs(total - 100.0) > 0.01:
                    raise ValidationError(_(
                        "“%(product)s”: the %(plan)s split adds up to %(total)s%% — it has to be 100%%.",
                        product=line.product_name, plan=plan.name, total=round(total, 2)))

    def _prepare_purchase_order_line_vals(self, order):
        vals = super()._prepare_purchase_order_line_vals(order)
        if self.analytic_distribution:
            vals['analytic_distribution'] = self.analytic_distribution
        return vals


class SmartspendRequest(models.Model):
    _inherit = 'smartspend.request'

    def _upsert_from_portal(self, payload):
        """The portal re-sends every item on each save, which replaces the line
        records. Keep each item's analytic split across that, matched by name."""
        reference = (payload.get('id') or '').strip()
        before = self.sudo().search([('name', '=', reference)], limit=1) if reference else self.browse()
        kept = [(line.product_name, line.analytic_distribution) for line in before.line_ids
                if line.analytic_distribution]
        request = super()._upsert_from_portal(payload)
        if kept:
            for line in request.line_ids:
                match = next((dist for name, dist in kept if same_product(name, line.product_name)), None)
                if match and match != line.analytic_distribution:
                    line.analytic_distribution = match
        return request

    @api.model
    def _seed_cost_centers(self):
        """One analytic account per department under a "Cost Centers" plan, so a
        request has somewhere to book its cost. Idempotent; never touches a
        department that already has one."""
        Plan = self.env['account.analytic.plan'].sudo()
        Account = self.env['account.analytic.account'].sudo()
        plan = Plan.search([('name', '=', 'Cost Centers')], limit=1) or Plan.create({'name': 'Cost Centers'})
        for department in self.env['smartspend.department'].sudo().search([('analytic_account_id', '=', False)]):
            account = Account.search([('name', '=', department.name), ('plan_id', '=', plan.id)], limit=1) or \
                Account.create({'name': department.name, 'plan_id': plan.id, 'code': department.code or False,
                                'company_id': department.company_id.id or False})
            department.analytic_account_id = account
        return True
