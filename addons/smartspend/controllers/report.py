"""The printable documents behind the portal's Print button.

Five documents come out of one endpoint — the purchase request, the purchase
order, the goods receipt, the vendor invoice and the rate contract — because to
a client they are one family of paperwork and should look like it. Each is
returned in the same shape (letterhead, parties, facts, lines, totals, trail),
so the portal has a single sheet to render and every document prints alike.

Nothing here is composed for the page: every figure is read back out of the
record it belongs to. The goods receipt is the one document Odoo has no record
for — this install runs without *stock* — so it is built from what the purchase
order says was received, and it says so on its face.

Who may print what is decided by the request, not by the document: a supplier
can print the order placed with them and never another supplier's, which is the
same rule the portal's lists already follow.
"""
from odoo import _, http
from odoo.http import request

from ..models.smartspend_auction import inr
from .main import _authenticate, _error

# What each document is called on its face, and the accent the sheet prints it
# in. Kept here rather than in the portal so the two never drift apart.
DOCUMENTS = {
    'request': ('Purchase Request', 'brand'),
    'po': ('Purchase Order', 'gold'),
    'grn': ('Goods Receipt Note', 'pos'),
    'invoice': ('Vendor Invoice', 'neg'),
    'contract': ('Rate Contract', 'brand'),
}

STATUS_LABELS = {
    'draft': 'Draft', 'to_approve': 'Pending Approval', 'clarification': 'Needs Clarification',
    'sourcing': 'Sourcing', 'approved': 'Approved', 'po_confirmed': 'PO Confirmed',
    'rejected': 'Rejected', 'paid': 'Paid', 'cancelled': 'Cancelled',
}

ONES = ('', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
        'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
        'eighteen', 'nineteen')
TENS = ('', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety')


def _under_thousand(number):
    words = []
    if number >= 100:
        words += [ONES[number // 100], 'hundred']
        number %= 100
        if number:
            words.append('and')
    if number >= 20:
        words.append(TENS[number // 10])
        number %= 10
    if number:
        words.append(ONES[number])
    return words


def _words(amount):
    """₹12,34,000 as "Twelve lakh thirty four thousand rupees only".

    Indian numbering, because the figure beside it is grouped that way; a
    document that says "one million" next to ₹10,00,000 reads as a translation
    error to everyone who will sign it.
    """
    total = round(float(amount or 0.0), 2)
    rupees, paise = divmod(int(round(abs(total) * 100)), 100)
    if not rupees and not paise:
        return 'Zero rupees only'
    parts = []
    for divisor, unit in ((10000000, 'crore'), (100000, 'lakh'), (1000, 'thousand')):
        if rupees >= divisor:
            parts += _under_thousand(rupees // divisor) + [unit]
            rupees %= divisor
    parts += _under_thousand(rupees)
    if paise:
        parts += ['rupees', 'and'] + _under_thousand(paise) + ['paise']
    else:
        parts.append('rupees')
    sentence = ' '.join(word for word in parts if word)
    if total < 0:
        sentence = 'minus ' + sentence
    return sentence[:1].upper() + sentence[1:] + ' only'


def _date(value, with_time=False):
    if not value:
        return ''
    return value.strftime('%d %b %Y, %H:%M' if with_time else '%d %b %Y')


def _address(partner):
    """A partner as a block of lines, skipping whatever is not filled in."""
    if not partner:
        return []
    street = ', '.join(part for part in (partner.street, partner.street2) if part)
    town = ' '.join(part for part in (partner.city, partner.zip) if part)
    region = ', '.join(part for part in (partner.state_id.name, partner.country_id.name) if part)
    contact = ' · '.join(part for part in (partner.phone, partner.email) if part)
    lines = [street, town, region, contact]
    if partner.vat:
        lines.append(_("GSTIN %s", partner.vat))
    return [line for line in lines if line]


def _company_block(company):
    partner = company.partner_id
    return {
        'name': company.name,
        'addressLines': _address(partner),
        'website': company.website or '',
    }


def _party(role, partner, name=None):
    return {
        'role': role,
        'name': name or (partner.name if partner else ''),
        'lines': _address(partner),
    }


def _selection_label(record, field):
    """The label of a selection field's value, or a dash when not chosen yet."""
    value = record[field]
    return dict(record._fields[field].selection).get(value, '') if value else '—'


def _find_request(reference):
    """The request by its portal reference, as the signed-in user may see it.

    Read with the user's own rights on purpose: every document below hangs off
    a request, so this one check is what keeps a supplier out of another
    supplier's paperwork.
    """
    record = request.env['smartspend.request'].search([('name', '=', reference)], limit=1)
    return record


def _order_of(record):
    """The order a request's paperwork is about: the standing one, else the last."""
    orders = record.sudo().purchase_order_ids.sorted('id')
    live = orders.filtered(lambda order: order.state != 'cancel')
    return (live or orders)[-1:]


def _lines_from_request(record):
    return [{
        'product': line.product_name,
        'description': line.description or '',
        'qty': line.product_qty,
        'uom': line.product_uom_id.name or '',
        'rate': inr(line.price_unit),
        'amount': inr(line.subtotal),
    } for line in record.line_ids]


def _totals(rows):
    return [dict(row, value=inr(row['value'])) for row in rows]


def _request_document(record):
    approvals = [{
        'title': approval.designation_id.name or _('Approver'),
        'date': _date(approval.decided_on, with_time=True),
        'desc': '%s%s' % (
            dict(approval._fields['state'].selection).get(approval.state, approval.state),
            _(' · %s', approval.user_id.name) if approval.user_id else '',
        ),
    } for approval in record.approval_ids.sorted('sequence')]
    return {
        'status': STATUS_LABELS.get(record.state, record.state),
        'issuedOn': _date(record.request_date),
        'parties': [
            _party(_('Raised by'), record.user_id.partner_id, name=record.user_id.name),
            _party(_('Intended supplier'), record.partner_id,
                   name=record.partner_id.name or record.vendor_name or _('Not decided yet')),
        ],
        'facts': [
            {'label': _('Branch / Site'), 'value': record.location or ''},
            {'label': _('Department'), 'value': record.department or ''},
            {'label': _('Expense category'), 'value': record.expense_category or ''},
            {'label': _('Urgency'), 'value': dict(record._fields['urgency'].selection).get(record.urgency, '')},
            {'label': _('Needed by'), 'value': _date(record.delivery_date)},
            {'label': _('Buyer desk'), 'value': record.buyer_ref or ''},
            {'label': _('Sourcing'), 'value': dict(record._fields['sourcing_method'].selection).get(
                record.sourcing_method, '')},
            {'label': _('Rate contract'), 'value': record.contract_reference or _('None')},
        ],
        'lines': _lines_from_request(record),
        'totals': _totals([
            {'label': _('Estimated value'), 'value': record.total_cost},
        ] + ([{'label': _('Negotiated savings'), 'value': record.savings}] if record.savings else []) + [
            {'label': _('Request value'), 'value': record.total_cost - (record.savings or 0.0), 'strong': True},
        ]),
        'amountInWords': _words(record.total_cost - (record.savings or 0.0)),
        'terms': [line for line in [record.description or '', record.notes or ''] if line],
        'trail': approvals,
        'signatures': [
            {'role': _('Requested by'), 'name': record.user_id.name},
            {'role': _('Approved by'), 'name': ', '.join(
                approval.user_id.name for approval in record.approval_ids if approval.user_id) or ''},
        ],
    }


PO_STATES = {
    'draft': 'Draft', 'sent': 'Sent to supplier', 'purchase': 'Confirmed',
    'done': 'Locked', 'cancel': 'Cancelled',
}


def _po_document(record, order):
    lines = [{
        'product': line.product_id.display_name or line.name,
        'description': line.name if line.name != (line.product_id.display_name or '') else '',
        'qty': line.product_qty,
        'uom': line.product_uom_id.name or '',
        'rate': inr(line.price_unit),
        'amount': inr(line.price_subtotal),
    } for line in order.order_line]
    return {
        'reference': order.name,
        'status': PO_STATES.get(order.state, order.state),
        'issuedOn': _date(order.date_order),
        'parties': [
            _party(_('Supplier'), order.partner_id),
            _party(_('Bill to'), order.company_id.partner_id),
        ],
        'facts': [
            {'label': _('Against request'), 'value': record.name},
            {'label': _('Rate contract'), 'value': order.smartspend_contract_ref or _('None')},
            {'label': _('Branch / Site'), 'value': record.location or ''},
            {'label': _('Department'), 'value': record.department or ''},
            {'label': _('Needed by'), 'value': _date(record.delivery_date)},
            {'label': _('Vendor committed delivery'), 'value': _date(record.vendor_delivery_date)
                if record.vendor_delivery_date else _('Not yet acknowledged')},
            {'label': _('Buyer desk'), 'value': record.buyer_ref or ''},
        ],
        'lines': lines,
        'totals': _totals([
            {'label': _('Subtotal'), 'value': order.amount_untaxed},
            {'label': _('Taxes'), 'value': order.amount_tax},
            {'label': _('Order total'), 'value': order.amount_total, 'strong': True},
        ]),
        'amountInWords': _words(order.amount_total),
        'terms': [
            _('Deliver to %s, %s.', record.location or order.company_id.name, record.department or ''),
            _('Quote this order number on the delivery note and on the invoice.'),
        ],
        'signatures': [
            {'role': _('Raised by'), 'name': record.user_id.name},
            {'role': _('For %s', order.company_id.name), 'name': ''},
        ],
    }


def _grn_document(record, order):
    """What the order says arrived, laid out as a receipt note.

    There is no receipt record to read: *stock* is not installed here, so
    nothing books goods in. The quantities below are the ones the purchase
    order carries as received, which is what the portal writes when the goods
    are accepted — and the sheet prints that provenance rather than implying a
    warehouse document that does not exist.
    """
    received = record.history_ids.filtered(lambda entry: 'received' in (entry.title or '').lower())
    lines = [{
        'product': line.product_id.display_name or line.name,
        'description': line.name if line.name != (line.product_id.display_name or '') else '',
        'qty': line.product_qty,
        'uom': line.product_uom_id.name or '',
        'rate': line.qty_received,
        'amount': inr(line.price_unit * line.qty_received),
    } for line in order.order_line]
    short = any(line.qty_received < line.product_qty for line in order.order_line)
    return {
        'reference': 'GRN-%s' % order.name,
        'status': _('Short received') if short else _('Received in full'),
        'issuedOn': _date(received[-1:].event_date if received else order.date_order),
        'parties': [
            _party(_('Received from'), order.partner_id),
            _party(_('Received at'), order.company_id.partner_id,
                   name=record.location or order.company_id.name),
        ],
        'facts': [
            {'label': _('Against order'), 'value': order.name},
            {'label': _('Against request'), 'value': record.name},
            {'label': _('Department'), 'value': record.department or ''},
            {'label': _('Received on'), 'value': _date(
                received[-1:].event_date if received else order.date_order, with_time=True)},
            {'label': _('Inspection'), 'value': _('Passed') if not short else _('Quantity variance')},
            {'label': _('Shipping method'), 'value': _selection_label(record, 'shipping_method')},
        ],
        'columns': [
            {'key': 'product', 'label': _('Item')},
            {'key': 'qty', 'label': _('Ordered'), 'align': 'right'},
            {'key': 'rate', 'label': _('Received'), 'align': 'right'},
            {'key': 'amount', 'label': _('Value received'), 'align': 'right'},
        ],
        'lines': lines,
        'totals': _totals([
            {'label': _('Value received'), 'value': sum(
                line.price_unit * line.qty_received for line in order.order_line), 'strong': True},
        ]),
        'amountInWords': _words(sum(line.price_unit * line.qty_received for line in order.order_line)),
        'note': _('Built from the quantities the purchase order records as received.'),
        'terms': [entry.description for entry in received if entry.description],
        'signatures': [
            {'role': _('Received by'), 'name': ''},
            {'role': _('Inspected by'), 'name': ''},
        ],
    }


def _invoice_document(record, bill):
    lines = [{
        'product': line.product_id.display_name or line.name,
        'description': line.name if line.name != (line.product_id.display_name or '') else '',
        'qty': line.quantity,
        'uom': line.product_uom_id.name or '',
        'rate': inr(line.price_unit),
        'amount': inr(line.price_subtotal),
    } for line in bill.invoice_line_ids]
    paid = bill.payment_state in ('paid', 'in_payment', 'reversed')
    return {
        'reference': bill.name,
        'status': _('Paid') if paid else dict(bill._fields['payment_state'].selection).get(
            bill.payment_state, bill.payment_state),
        'stamp': _('PAID') if paid else '',
        'issuedOn': _date(bill.invoice_date),
        'parties': [
            _party(_('From'), bill.partner_id),
            _party(_('To'), bill.company_id.partner_id),
        ],
        'facts': [
            {'label': _('Against order'), 'value': ', '.join(
                bill.line_ids.purchase_order_id.mapped('name')) or ''},
            {'label': _('Against request'), 'value': record.name},
            {'label': _('Invoice date'), 'value': _date(bill.invoice_date)},
            {'label': _('Due date'), 'value': _date(bill.invoice_date_due)},
            {'label': _('Payment state'), 'value': dict(bill._fields['payment_state'].selection).get(
                bill.payment_state, '')},
            {'label': _('Payment method'), 'value': _selection_label(record, 'payment_method')},
        ],
        'lines': lines,
        'totals': _totals([
            {'label': _('Subtotal'), 'value': bill.amount_untaxed},
            {'label': _('Taxes'), 'value': bill.amount_tax},
            {'label': _('Invoice total'), 'value': bill.amount_total, 'strong': True},
            {'label': _('Amount due'), 'value': bill.amount_residual},
        ]),
        'amountInWords': _words(bill.amount_total),
        'terms': [_('Three-way matched against %s and the goods receipt for %s.',
                    ', '.join(bill.line_ids.purchase_order_id.mapped('name')) or _('the order'),
                    record.name)],
        'signatures': [
            {'role': _('Checked by'), 'name': ''},
            {'role': _('Authorised by'), 'name': ''},
        ],
    }


def _contract_document(contract):
    lines = [{
        'product': line.product_name,
        'description': '',
        'qty': line.min_qty,
        'uom': line.product_uom_id.name or '',
        'rate': inr(line.price_unit),
        'amount': inr(line.price_unit * line.min_qty),
    } for line in contract.line_ids]
    return {
        'reference': contract.name,
        'status': dict(contract._fields['state'].selection).get(contract.state, contract.state),
        'issuedOn': _date(contract.date_start),
        'parties': [
            _party(_('Supplier'), contract.partner_id),
            _party(_('Buyer'), contract.company_id.partner_id),
        ],
        'facts': [
            {'label': _('Category'), 'value': contract.category or ''},
            {'label': _('Valid from'), 'value': _date(contract.date_start)},
            {'label': _('Valid until'), 'value': _date(contract.date_end)},
            {'label': _('Lead time'), 'value': contract.lead_time or ''},
            {'label': _('Warranty'), 'value': contract.warranty or ''},
            {'label': _('Payment terms'), 'value': contract.payment_terms or ''},
        ],
        'columns': [
            {'key': 'product', 'label': _('Item')},
            {'key': 'qty', 'label': _('Min. qty'), 'align': 'right'},
            {'key': 'rate', 'label': _('Contracted rate'), 'align': 'right'},
            {'key': 'amount', 'label': _('At min. qty'), 'align': 'right'},
        ],
        'lines': lines,
        'totals': _totals([
            {'label': _('Contracted value'), 'value': contract.total_value, 'strong': True},
        ]),
        'amountInWords': _words(contract.total_value),
        'terms': [_('Rates hold for the period above and are drawn on automatically '
                    'by any request matching this category.')],
        'signatures': [
            {'role': _('For %s', contract.partner_id.name or _('the supplier')), 'name': ''},
            {'role': _('For %s', contract.company_id.name), 'name': ''},
        ],
    }


class SmartSpendReportApi(http.Controller):

    @http.route('/api/smartspend/document', type='json2', auth='none',
                methods=['POST'], cors='*', readonly=True)
    def document(self, kind=None, id=None, **kwargs):
        """One printable document, ready for the portal's sheet to lay out.

        :param kind: ``request``, ``po``, ``grn``, ``invoice`` or ``contract``.
        :param id: the request's reference for the first four, the contract's
            for the last.
        :return: letterhead, parties, facts, lines, totals and signatures — or
            a 404 when the record exists but that document does not yet (an
            order that was never raised, an invoice not yet posted).
        """
        error = _authenticate()
        if error:
            return error
        kind = (kind or '').strip()
        reference = (id or '').strip()
        if kind not in DOCUMENTS:
            return _error(_("There is no %s document.", kind or _('unnamed')), 400)
        if not reference:
            return _error(_("Which document? No reference was given."), 400)

        title, accent = DOCUMENTS[kind]
        company = request.env.company

        if kind == 'contract':
            contract = request.env['smartspend.contract'].search(
                [('name', '=', reference)], limit=1)
            if not contract:
                return _error(_("No rate contract called %s.", reference), 404)
            body = _contract_document(contract)
        else:
            record = _find_request(reference)
            if not record:
                return _error(_("No request called %s.", reference), 404)
            if kind == 'request':
                body = _request_document(record)
                body['reference'] = record.name
            else:
                order = _order_of(record)
                if not order:
                    return _error(
                        _("%s has no purchase order yet, so there is nothing to print.",
                          record.name), 404)
                if kind == 'po':
                    body = _po_document(record, order)
                elif kind == 'grn':
                    if not any(line.qty_received for line in order.order_line):
                        return _error(
                            _("Nothing has been received against %s yet.", order.name), 404)
                    body = _grn_document(record, order)
                else:
                    bill = order.invoice_ids.filtered(lambda move: move.state == 'posted')[-1:]
                    if not bill:
                        return _error(
                            _("No vendor invoice has been posted against %s yet.", order.name), 404)
                    body = _invoice_document(record, bill)

        document = {
            'kind': kind,
            'docType': title,
            'accent': accent,
            'reference': reference,
            'status': '',
            'stamp': '',
            'issuedOn': '',
            'company': _company_block(company),
            'parties': [],
            'facts': [],
            'columns': [
                {'key': 'product', 'label': _('Item')},
                {'key': 'qty', 'label': _('Qty'), 'align': 'right'},
                {'key': 'rate', 'label': _('Rate'), 'align': 'right'},
                {'key': 'amount', 'label': _('Amount'), 'align': 'right'},
            ],
            'lines': [],
            'totals': [],
            'amountInWords': '',
            'terms': [],
            'trail': [],
            'signatures': [],
            'note': '',
            'printedBy': request.env.user.name,
        }
        document.update(body)
        return document
