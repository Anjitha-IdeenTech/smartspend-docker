"""The vendor's delivery schedule — an order delivered over several dates.

When a vendor acknowledges a purchase order it may commit to deliver it in
parts: "10 laptops and 5 monitors on 5 Nov, the rest on 12 Nov". Each part is
a date with the quantity of each item coming that day; together the parts
deliver exactly what was ordered. The last date is the request's committed
delivery date (``vendor_delivery_date``), as when one date was given.
"""
from datetime import datetime

from odoo import _, fields, models
from odoo.exceptions import UserError
from odoo.tools.float_utils import float_compare, float_is_zero


class SmartspendDeliverySlot(models.Model):
    _name = 'smartspend.delivery.slot'
    _description = 'Vendor Delivery Schedule'
    _order = 'date, sequence, id'

    request_id = fields.Many2one('smartspend.request', required=True, ondelete='cascade', index=True)
    date = fields.Date(string='Delivery Date', required=True)
    sequence = fields.Integer(default=10)
    line_id = fields.Many2one('smartspend.request.line', string='Request Line', ondelete='cascade')
    product_name = fields.Char(string='Product', required=True)
    quantity = fields.Float(string='Quantity', digits='Product Unit', required=True)


class SmartspendRequest(models.Model):
    _inherit = 'smartspend.request'

    delivery_slot_ids = fields.One2many(
        'smartspend.delivery.slot', 'request_id', string='Delivery Schedule', readonly=True, copy=False)

    def _read_delivery_schedule(self, schedule):
        """Check a schedule the vendor sent and turn it into slot values.

        :param schedule: ``[{'date': 'YYYY-MM-DD', 'items': [{'productName', 'quantity'}]}]``
        :return: ``(last date, [slot values])``
        """
        self.ensure_one()
        lines = self.line_ids.filtered(lambda l: l.product_name)
        by_name = {}
        for line in lines:
            by_name.setdefault(line.product_name.strip().casefold(), line)
        ordered = {}
        for line in lines:
            key = line.product_name.strip().casefold()
            ordered[key] = ordered.get(key, 0.0) + line.product_qty
        today = fields.Date.context_today(self)
        seen_dates, slots, scheduled = set(), [], {}
        for index, part in enumerate(schedule or [], 1):
            try:
                day = fields.Date.to_date(str((part or {}).get('date') or '').strip()[:10] or None)
            except ValueError:
                day = None
            if not day:
                raise UserError(_("Delivery %s needs a date.", index))
            if day < today:
                raise UserError(_("Delivery %s is dated in the past.", index))
            if day in seen_dates:
                raise UserError(_("Two deliveries are dated %s — put everything for that day in one.",
                                  day.strftime('%b %d, %Y')))
            seen_dates.add(day)
            total = 0.0
            for item in (part or {}).get('items') or []:
                key = str(item.get('productName') or '').strip().casefold()
                line = by_name.get(key)
                if not line:
                    raise UserError(_("“%s” is not on this order.", item.get('productName')))
                try:
                    quantity = float(item.get('quantity') or 0)
                except (TypeError, ValueError):
                    raise UserError(_("Quantities have to be numbers."))
                if quantity < 0:
                    raise UserError(_("Quantities cannot be negative."))
                if float_is_zero(quantity, precision_digits=2):
                    continue
                total += quantity
                scheduled[key] = scheduled.get(key, 0.0) + quantity
                slots.append({'date': day, 'sequence': index, 'line_id': line.id,
                              'product_name': line.product_name, 'quantity': quantity})
            if float_is_zero(total, precision_digits=2):
                raise UserError(_("Delivery %s has nothing in it.", index))
        if not slots:
            raise UserError(_("Add at least one delivery."))
        for key, quantity in ordered.items():
            if float_compare(scheduled.get(key, 0.0), quantity, precision_digits=2):
                raise UserError(_(
                    "%(product)s: %(scheduled)s scheduled, but %(ordered)s ordered — the deliveries have to add up to the order.",
                    product=by_name[key].product_name, scheduled=f"{scheduled.get(key, 0.0):g}", ordered=f"{quantity:g}"))
        return max(seen_dates), slots

    def _delivery_schedule(self):
        """``[{'date': 'YYYY-MM-DD', 'items': [{'productName', 'quantity'}]}]``, by date."""
        self.ensure_one()
        parts = {}
        for slot in self.delivery_slot_ids:
            parts.setdefault(slot.date, []).append({'productName': slot.product_name, 'quantity': slot.quantity})
        return [{'date': fields.Date.to_string(day), 'items': items} for day, items in sorted(parts.items())]

    def action_acknowledge_purchase_order(self, delivery_date=None, schedule=None):
        """Acknowledge with a delivery schedule — several dates — or one date.

        :param schedule: see ``_read_delivery_schedule``. Its last date is the
            committed delivery date; each order line expects its goods by the
            last date that item is scheduled for.
        """
        if not schedule:
            return super().action_acknowledge_purchase_order(delivery_date=delivery_date)
        self.ensure_one()
        if not self.po_released or self.po_acknowledged:
            return super().action_acknowledge_purchase_order(delivery_date=delivery_date)
        last, slots = self._read_delivery_schedule(schedule)
        self.delivery_slot_ids.unlink()
        self.write({'delivery_slot_ids': [fields.Command.create(values) for values in slots]})
        result = super().action_acknowledge_purchase_order(delivery_date=last)
        # Per item: expected once its last part arrives.
        by_product = {}
        for slot in self.delivery_slot_ids:
            key = slot.product_name.strip().casefold()
            by_product[key] = max(by_product.get(key, slot.date), slot.date)
        orders = self.purchase_order_ids.filtered(lambda o: o.state not in ('done', 'cancel'))
        for po_line in orders.order_line.filtered(lambda l: not l.display_type):
            day = by_product.get((po_line.product_id.name or po_line.name or '').strip().casefold())
            if day:
                po_line.date_planned = datetime.combine(day, datetime.min.time()).replace(hour=12)
        schedule_text = '; '.join(
            '%s: %s' % (fields.Date.to_date(part['date']).strftime('%b %d, %Y'),
                        ', '.join(f"{item['productName']} ×{item['quantity']:g}" for item in part['items']))
            for part in self._delivery_schedule())
        count = len(set(self.delivery_slot_ids.mapped('date')))
        self._log_history(
            _("Delivery Schedule Committed"),
            _("Vendor will deliver in %(count)s part(s) — %(schedule)s.", count=count, schedule=schedule_text))
        self.message_post(body=_("Delivery schedule (%(count)s part(s)): %(schedule)s.",
                                 count=count, schedule=schedule_text))
        return result

    def action_create_purchase_order(self):
        # A replacement order starts without a schedule, as without a date.
        result = super().action_create_purchase_order()
        self.filtered(lambda r: not r.po_acknowledged).delivery_slot_ids.unlink()
        return result
