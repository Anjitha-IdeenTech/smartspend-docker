"""Turn a dictated or typed sentence into a draft requisition.

The portal lets an employee say "I need 20 Dell Latitude laptops and 20 docking
stations for the Bangalore office" and expects a structured requisition back.
This is a deterministic keyword parser over the catalogue below — no external
service, so the demo works offline and always returns the same answer for the
same sentence.
"""
import re

# (matcher, canonical product name, expense category, indicative unit price).
# Prices mirror the rate card the portal shows so the two agree on screen.
CATALOG = [
    (r'dock(ing)?\b|docking station', 'USB-C Docking Station', 'IT Hardware & Laptops', 8500.0),
    (r'monitor|display screen|\bdisplay\b', '24" Full-HD Monitor', 'IT Hardware & Laptops', 11000.0),
    (r'keyboard|mouse', 'Wireless Keyboard & Mouse Combo', 'IT Hardware & Laptops', 2200.0),
    (r'backpack|carry ?case|laptop bag', 'Laptop Backpack', 'IT Hardware & Laptops', 1800.0),
    (r'licen[cs]e|office 365|antivirus|software', 'MS Office 365 Business License', 'Software Licenses', 8200.0),
    (r'headset|headphone', 'Noise-Cancelling Headset', 'IT Hardware & Laptops', 3400.0),
    (r'laptop|latitude|macbook|notebook', 'Dell Latitude 5440 Laptop', 'IT Hardware & Laptops', 70000.0),
    (r'chair|seating', 'Ergonomic Office Chair', 'Office Furniture', 8000.0),
    (r'standing desk|desk|workstation|\btable\b', 'Height-Adjustable Desk', 'Office Furniture', 12500.0),
    (r'cabinet|storage unit|pedestal', 'Storage Pedestal Cabinet', 'Office Furniture', 9500.0),
    (r'server|\brack\b', '19-Inch Data Server Rack', 'Datacenter Equipment', 120000.0),
    (r'switch|router|firewall', '48-Port Network Switch', 'Datacenter Equipment', 45000.0),
    (r'\bups\b|power supply', 'Rack-Mount UPS 5kVA', 'Datacenter Equipment', 38000.0),
    (r'patch panel|cabling|\bcable', 'CAT-6A Patch Panel', 'Datacenter Equipment', 4500.0),
]

LOCATIONS = [
    (r'bangalore|bengaluru', 'Bangalore Office'),
    (r'mumbai|bombay', 'Mumbai Office'),
    (r'kochi|cochin', 'Kochi Head Office'),
    (r'delhi', 'Delhi Office'),
    (r'chennai|madras', 'Chennai Office'),
]

DEPARTMENTS = [
    (r'\bit\b|infra|network|datacenter|data cent', 'IT & Infrastructure'),
    (r'operations|\bops\b|production', 'Operations'),
    (r'facilit|admin|housekeep|pantry', 'Facilities'),
    (r'marketing|brand|event', 'Marketing'),
    (r'finance|account', 'Finance'),
]

URGENCY = [
    (r'urgent|asap|immediately|critical|today', 'High'),
    (r'when possible|no rush|whenever|low priority', 'Low'),
]

NUMBER_WORDS = {
    'a': 1, 'an': 1, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10, 'eleven': 11,
    'twelve': 12, 'fifteen': 15, 'twenty': 20, 'twenty-five': 25, 'thirty': 30,
    'forty': 40, 'fifty': 50, 'hundred': 100,
}

# Staged products sort after every product named in the sentence.
STAGED_POSITION = 10 ** 6

DEFAULT_LOCATION = 'Bangalore Office'
DEFAULT_DEPARTMENT = 'IT & Infrastructure'
DEFAULT_CATEGORY = 'IT Hardware & Laptops'


def _first_match(text, table, default=None):
    for pattern, value in table:
        if re.search(pattern, text, re.IGNORECASE):
            return value
    return default


def _quantity_before(text, position):
    """Read the quantity that precedes a product mention.

    Looks at the ~40 characters in front of the match and takes the last number
    (digits or a spelled-out word) found there, which is where a natural
    sentence puts it: "…and 20 docking stations…".
    """
    window = text[max(0, position - 40):position]
    numbers = re.findall(r'\b(\d{1,5})\b', window)
    if numbers:
        return int(numbers[-1])
    words = re.findall(r'\b([a-z\-]+)\b', window.lower())
    for word in reversed(words):
        if word in NUMBER_WORDS:
            return NUMBER_WORDS[word]
    return 1


def catalog_entry(product_name):
    """Category and indicative rate for a product label, from the catalogue.

    The composer stages products by name only (the chips carry no price), so a
    staged line is priced here rather than reaching the requisition at zero.
    """
    for pattern, _canonical, category, price in CATALOG:
        if re.search(pattern, product_name, re.IGNORECASE):
            return category, price
    return DEFAULT_CATEGORY, 0.0


def _staged_quantity(value):
    """A composer quantity is free-typed: keep it sane, never below one."""
    try:
        quantity = int(float(value))
    except (TypeError, ValueError):
        return 1
    return quantity if quantity > 0 else 1


def parse_requisition(text, items=None):
    """Parse ``text`` (and anything staged alongside it) into a requisition.

    :param items: products staged in the portal composer, as
        ``{'productName', 'productQty', 'targetPrice'}`` dicts. They are kept
        alongside whatever the sentence yields — a request that mixes a typed
        sentence with staged products keeps every line of both.
    :return: a dict with ``lineItems``, ``location``, ``department``,
        ``expenseCategory`` and ``urgency`` — never ``None``, so the caller
        always has something to open a form on.
    """
    text = (text or '').strip()
    lines, seen = [], set()

    for pattern, product_name, category, price in CATALOG:
        match = re.search(pattern, text, re.IGNORECASE)
        if not match or product_name.casefold() in seen:
            continue
        seen.add(product_name.casefold())
        lines.append({
            'productName': product_name,
            'productQty': _quantity_before(text, match.start()),
            'targetPrice': price,
            '_category': category,
            '_position': match.start(),
        })

    # Staged products follow the sentence, in the order they were added.
    for index, item in enumerate(items or []):
        product_name = (item.get('productName') or '').strip()
        if not product_name or product_name.casefold() in seen:
            continue
        seen.add(product_name.casefold())
        category, price = catalog_entry(product_name)
        lines.append({
            'productName': product_name,
            'productQty': _staged_quantity(item.get('productQty')),
            # A staged chip carries no price; fall back to the catalogue rate.
            'targetPrice': float(item.get('targetPrice') or 0.0) or price,
            '_category': category,
            '_position': STAGED_POSITION + index,
        })

    if not lines:
        # Nothing in the catalogue matched: keep the sentence itself as the item
        # so the employee can correct it on the extraction form.
        lines.append({
            'productName': text[:80] or 'New requested item',
            'productQty': _quantity_before(text, len(text)) if text else 1,
            'targetPrice': 0.0,
            '_category': DEFAULT_CATEGORY,
            '_position': 0,
        })

    lines.sort(key=lambda line: line['_position'])
    category = lines[0]['_category']
    for line in lines:
        line.pop('_category', None)
        line.pop('_position', None)

    return {
        'lineItems': lines,
        'productName': lines[0]['productName'],
        'productQty': lines[0]['productQty'],
        'targetPrice': lines[0]['targetPrice'],
        'location': _first_match(text, LOCATIONS, DEFAULT_LOCATION),
        'department': _first_match(text, DEPARTMENTS, DEFAULT_DEPARTMENT),
        'expenseCategory': category,
        'urgency': _first_match(text, URGENCY, 'Medium'),
    }
