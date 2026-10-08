"""The requester's chat: what a message would become, without saving anything.

The portal's New Request screen is a conversation. Each message the requester
sends is read here by the same parser that /parse uses, so what the chat shows
is exactly what the request will hold — but nothing is written: the draft
request is only created when the requester decides to review and submit.

On top of the parsed lines it says which details the message actually named,
as opposed to the parser's defaults, so the chat knows what is still missing
and asks for it instead of quietly assuming "Bangalore Office".
"""
import re

from odoo import _, http
from odoo.http import request

from .main import _authenticate, _error
from .parser import CATALOG, DEPARTMENTS, LOCATIONS, NUMBER_WORDS, parse_requisition


# What a family of goods actually comes in, and what each one is for. The
# parser knows one canonical product per family ("laptop" → Dell Latitude); a
# requester asking for "laptops" is asking for a family, so the chat offers the
# models with the job each is meant for and prices what they pick. Naming a
# model ("MacBook", "firewall") picks it straight away. Indicative prices, like
# the rest of the catalogue.
MODEL_OPTIONS = {
    'Dell Latitude 5440 Laptop': ('laptop', [
        ('Dell Latitude 5440 (14")', 'Everyday office work — mail, spreadsheets, calls', 70000, ('latitude', '5440')),
        ('HP EliteBook 840 G10', 'Travels well: lighter, longer battery for field staff', 92000, ('elitebook', '840 g10')),
        ('Lenovo ThinkPad E14', 'Budget workhorse for shift and temporary staff', 52000, ('thinkpad', 'e14', 'lenovo')),
        ('Dell Precision 3581 Mobile Workstation', 'CAD, engineering and design workloads', 145000, ('precision', '3581', 'workstation')),
        ('Apple MacBook Pro 14"', 'Creative, video and app development', 185000, ('macbook', 'apple', 'mac')),
    ]),
    '24" Full-HD Monitor': ('monitor', [
        ('24" Full-HD Monitor', 'The standard desk setup', 11000, ('24"', '24-inch', '24 inch', 'full-hd')),
        ('27" QHD Monitor', 'More room for finance and analysis work', 19500, ('27"', '27-inch', '27 inch', 'qhd')),
        ('32" 4K Monitor', 'Design and detailed drawing work', 38000, ('32"', '32-inch', '32 inch', '4k')),
        ('34" Ultrawide Monitor', 'Trading desks and multi-window monitoring', 52000, ('34"', '34-inch', '34 inch', 'ultrawide')),
    ]),
    'Ergonomic Office Chair': ('chair', [
        ('Ergonomic Task Chair', 'Standard staff seating, adjustable', 8000, ('task', 'ergonomic')),
        ('High-Back Executive Chair', 'Cabins and senior staff', 18500, ('executive', 'high-back', 'high back')),
        ('Conference / Visitor Chair', 'Meeting rooms and reception', 4500, ('visitor', 'conference')),
    ]),
    'Height-Adjustable Desk': ('desk', [
        ('Height-Adjustable Sit-Stand Desk', 'Daily desk work, sit or stand', 12500, ('sit-stand', 'standing', 'adjustable')),
        ('Fixed Workstation Desk', 'Standard floor workstation', 8500, ('fixed', 'workstation')),
        ('Executive Desk', 'Cabins and senior staff', 26000, ('executive',)),
    ]),
    '48-Port Network Switch': ('network device', [
        ('48-Port Network Switch', 'Floor switch for up to 48 users', 45000, ('48-port', '48 port')),
        ('24-Port PoE Switch', 'Smaller floors; powers IP phones and cameras', 28000, ('24-port', '24 port', 'poe')),
        ('Next-Gen Firewall Appliance', 'Perimeter security for a branch', 145000, ('firewall',)),
        ('Wi-Fi 6 Access Point', 'Wireless coverage, one per floor area', 18000, ('wifi', 'wi-fi', 'access point')),
    ]),
    'Rack-Mount UPS 5kVA': ('UPS', [
        ('Rack-Mount UPS 5kVA', 'Backup for a server rack', 38000, ('5kva', 'rack-mount', 'rack mount')),
        ('Industrial UPS 10kVA', 'Site and plant backup', 85000, ('10kva', 'industrial')),
        ('Desktop UPS 1kVA', 'Backup for a single desk or till', 6500, ('1kva', 'desktop')),
    ]),
    '19-Inch Data Server Rack': ('rack', [
        ('19-Inch 42U Server Rack', 'Full rack for the server room', 120000, ('42u', '19-inch')),
        ('12U Wall-Mount Rack', 'Small branch communications cabinet', 28000, ('12u', 'wall-mount', 'wall mount')),
    ]),
    'MS Office 365 Business License': ('licence', [
        ('MS 365 Business Standard', 'Office apps, mail and 1 TB storage, per user/year', 8200, ('business standard', '365 business')),
        ('MS 365 E3', 'Adds compliance, device management and archiving', 16500, ('e3',)),
        ('Adobe Creative Cloud', 'Design and video teams, per user/year', 52000, ('adobe', 'creative cloud')),
    ]),
}


def _names_model(text, token):
    """Whether the message names this model, plural or not ("MacBooks", "48-port")."""
    return re.search(r'(?<![a-z0-9])%s(?:e?s)?(?![a-z0-9])' % re.escape(token), text, re.IGNORECASE)


def _offer_models(parsed, text):
    """Name the model the message asked for, or offer the family's models.

    A line the requester named a model for is repriced to that model. One that
    only named the family carries ``options``, and the chat asks which.

    :return: True when a size was mistaken for the quantity ("a 27-inch
        monitor" is one monitor), so the caller stops calling it a quantity.
    """
    size_taken_as_quantity = False
    for line in parsed['lineItems']:
        family = MODEL_OPTIONS.get(line['productName'])
        if not family:
            continue
        label, models = family
        named = next(((model, token) for model in models for token in model[3]
                      if _names_model(text, token)), None)
        if named:
            model, token = named
            line['productName'], line['targetPrice'] = model[0], model[2]
            # "27-inch", "48-port": the parser reads the size in front of the
            # product as the quantity. A size is not an order quantity.
            size = re.match(r'(\d+)', token)
            if size and line['productQty'] == int(size.group(1)):
                line['productQty'] = 1
                size_taken_as_quantity = True
            continue
        line['family'] = label
        line['options'] = [
            {'name': name, 'purpose': purpose, 'price': price} for name, purpose, price, _tokens in models
        ]
    return size_taken_as_quantity


def _mentions(text, table):
    return any(re.search(pattern, text, re.IGNORECASE) for pattern, *_rest in table)


def _states_quantity(text):
    """Whether the message gives a number, not just a product."""
    if re.search(r'\b\d{1,5}\b', text):
        return True
    words = re.findall(r'[a-z\-]+', text.lower())
    # "a laptop" names a product, not a considered quantity.
    return any(word in NUMBER_WORDS and word not in ('a', 'an') for word in words)


class SmartSpendChatApi(http.Controller):

    @http.route('/api/smartspend/parse-preview', type='json2', auth='none',
                methods=['POST'], cors='*', readonly=True)
    def parse_preview(self, text=None, items=None, **kwargs):
        """Parse a chat message into requisition lines and details, read-only.

        :return: what /parse would file (``lineItems``, ``location``,
            ``department``, ``expenseCategory``, ``urgency``), plus ``found``:
            which of those the message itself named.
        """
        error = _authenticate()
        if error:
            return error
        items = [
            item for item in (items or [])
            if isinstance(item, dict) and (item.get('productName') or '').strip()
        ]
        text = (text or '').strip()
        if not text and not items:
            return _error(_("Nothing to parse."), 400)
        parsed = parse_requisition(text, items)
        size_as_quantity = _offer_models(parsed, text)
        parsed['found'] = {
            'products': bool(items) or _mentions(text, CATALOG),
            'quantity': _states_quantity(text) and not size_as_quantity,
            'location': _mentions(text, LOCATIONS),
            'department': _mentions(text, DEPARTMENTS),
        }
        return parsed
