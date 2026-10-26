"""When a requester brings a problem, not a product.

"Electricity is not coming on the 2nd floor", "water supply is not proper":
the requester needs a service, not an item. A message that names an area
(power, water, cooling…) together with something wrong with it ("not working",
"no", "leak", "cut"…) is read as a problem. The chat then gives a few quick,
safe checks to try meanwhile and offers the services that fix it — real
service products in the master (``data/smartspend_service_data.xml``), so the
request goes through like any other, without a product creation request.

Deterministic, like the requisition parser: the same message always gets the
same answer.
"""
import re

from odoo.http import request

from .parser import CATALOG, _item_phrase

CATALOG_PATTERN = '|'.join(f'(?:{pattern})' for pattern, *_rest in CATALOG)

# Something is wrong — as opposed to "I need 2 ACs".
_TROUBLE = re.compile(
    r"\b(?:not|isn'?t|aren'?t|wasn'?t|doesn'?t|don'?t|didn'?t|won'?t|can'?t|cannot|no|zero)\s+"
    r"(?:\w+\s+){0,2}?(?:working|getting|coming|available|proper(?:ly)?|cooling|starting|running|"
    r"turning on|switching on|stable|enough|flowing|connecting|reaching|there|power|electricity|current|"
    r"water|supply|internet|wi-?fi|network|signal|cooling|light|lights)\b"
    r"|\b(?:down|broken|broke|leak(?:s|ing|age)?|outage|fail(?:ed|s|ing|ure)?|fault(?:y)?|problem|issue|"
    r"trouble|damaged|blocked|clogged|choked|tripp(?:ed|ing)|trips|cut|dead|stuck|overflow(?:ing|s)?|"
    r"low pressure|fluctuat\w*|spark(?:s|ing)?|shock|infest\w*|stopped|dripping|smell(?:s|ing|y)?|"
    r"stink(?:s|ing)?|dirty|noisy|too hot|very hot|unbearable|errors?|hang(?:s|ing)?|frozen|freez(?:es|ing))\b"
    # "not printing", "not charging", "isn't booting"
    r"|\b(?:not|isn'?t|doesn'?t|won'?t)\s+\w+ing\b",
    re.IGNORECASE)

# "I need 3 monitors — the old ones are broken" is an order, not a repair:
# asking to buy a catalogue item wins, unless they ask for it to be fixed.
_ORDERING = re.compile(r"\b(?:need|needs|want|order|buy|purchase|procure|require|replace|replacement|new)\b", re.IGNORECASE)
_FIXING = re.compile(r"\b(?:repair|fix|service|servicing|technician|mechanic|electrician|plumber|help)\w*\b", re.IGNORECASE)

# (key, area matcher, what to call it, expense category, quick checks, services)
# A service is (product name in the master, what it is for, indicative price).
PROBLEMS = [
    ('power', r'electric|\bpower\b|\bcurrent\b|voltage|\blights?\b|\bmcb\b|rccb|elcb|\btripp|\bsockets?\b|'
              r'switch ?board|wiring|short circuit|\bfuse\b|\bdb box\b',
     'power problem', 'MRO Supplies',
     ["See whether the whole floor or building is out, or only one room — it tells the electrician where to start.",
      "Check the MCB / RCCB in the distribution board. Switch a tripped one back on once; if it trips again, leave it off.",
      "Ask the building or the electricity board whether there is a scheduled outage.",
      "Keep everyone away from sparking sockets, burning smells or exposed wires."],
     [('Electrician Visit — Diagnosis & Repair', 'An electrician finds and fixes the fault', 1500.0),
      ('Diesel Generator on Hire (per day)', 'Keeps the site running through a long outage', 8000.0),
      ('UPS / Inverter Repair Service', 'When the backup itself is not holding', 2500.0)]),
    ('water', r'\bwater\b|\btaps?\b|\bpipes?\b|pipeline|plumb|\bleak|\bdrain|toilet|wash ?rooms?|rest ?rooms?|'
              r'\bflush|\bsump\b|overhead tank|\btanks?\b|\bmotor\b|\bpump\b|\btanker\b|\bsink\b|\bgeyser\b',
     'water supply problem', 'MRO Supplies',
     ["Check the overhead tank and the sump — the supply may simply have run out.",
      "Check that the water pump / motor runs and that the valves on the line are open.",
      "For a leak, close the nearest valve (or the main valve) and keep electrical points nearby dry.",
      "Ask the building or the municipal office whether the supply is off in the area."],
     [('Plumber Visit — Diagnosis & Repair', 'A plumber fixes leaks, blockages and low pressure', 1200.0),
      ('Water Tanker Supply (per load)', 'Water now, while the supply is restored', 2500.0),
      ('Water Pump / Motor Repair Service', 'When the pump or motor is not lifting water', 3000.0)]),
    ('cooling', r'\bacs?\b|a/c|air ?condition\w*|\bcooling\b|\bhvac\b|too hot|very hot|\bheat\b',
     'cooling problem', 'MRO Supplies',
     ["Make sure the AC is in Cool mode and set to about 24 °C, with doors and windows closed.",
      "Check that the outdoor unit is running and has power.",
      "A clogged filter is the usual cause of weak cooling — note when it was last cleaned.",
      "Switch it off if water is dripping inside or it smells of burning."],
     [('AC Service & Gas Top-up', 'Cleans filters and coils and tops up the gas', 3500.0),
      ('AC Repair Technician Visit', 'Finds and fixes a unit that will not cool or start', 1500.0)]),
    ('internet', r'internet|wi-?fi|\bnetwork\b|\blan\b|broadband|connectivity|\brouter\b|\bnet\b|leased line',
     'internet / network problem', 'Professional Services',
     ["Restart the router or switch — off for 30 seconds, then on.",
      "Check that the cables are firmly in and the link lights are on.",
      "See whether only you or everyone is affected; if everyone, it is likely the provider.",
      "Check the internet provider's outage page or helpline."],
     [('Network Technician Visit', 'Fixes cabling, switch and Wi-Fi faults on site', 2000.0),
      ('Backup 4G Internet Connection (monthly)', 'Keeps people working while the main line is down', 1500.0)]),
    ('it', r'\blaptops?\b|\bcomputers?\b|\bdesktops?\b|\bpcs?\b|\bprinters?\b|\bscanners?\b|\bmonitors?\b|'
           r'\bprojectors?\b|\bkeyboards?\b|\bmouse\b|\bscreens?\b|\bmacbooks?\b',
     'IT equipment problem', 'Professional Services',
     ["Restart it, and check the power cable, adapter and battery charge.",
      "Note any error message or beep — it helps the technician bring the right part.",
      "Save your work elsewhere if it still turns on; do not open the device yourself."],
     [('IT Hardware Repair — Technician Visit', 'A technician diagnoses and repairs it on site', 1500.0),
      ('Standby Laptop on Rent (per month)', 'Keeps you working while yours is repaired', 3000.0)]),
    ('lift', r'\blifts?\b|elevators?',
     'lift problem', 'MRO Supplies',
     ["Stop people from using the lift and put a notice at each floor.",
      "If someone is stuck inside, call the emergency number on the lift panel straight away.",
      "Do not try to open the lift doors by hand."],
     [('Lift / Elevator Breakdown Service', "The lift maintenance company's breakdown call-out", 5000.0)]),
    ('pest', r'\bpests?\b|\brats?\b|rodent|cockroach|termite|mosquito|insects?\b|bed ?bugs?|\bants\b|lizard',
     'pest problem', 'MRO Supplies',
     ["Keep food covered and clear waste out daily until treatment.",
      "Note where they are seen most — it helps target the treatment."],
     [('Pest Control Treatment', 'General, rodent or termite treatment of the premises', 4000.0)]),
    ('cleaning', r'\bclean\w*|\bdirty\b|garbage|\bwaste\b|housekeep\w*|\bsmell\w*|\bstink\w*|\bdust\w*',
     'cleaning problem', 'MRO Supplies',
     ["Tell the housekeeping supervisor which areas need attention.",
      "For a spill or a bad smell, ventilate the area and keep people away until it is cleaned."],
     [('Deep Cleaning Service (per visit)', 'A full clean of the affected area', 6000.0)]),
]

_TIE_ORDER = ['power', 'cooling', 'internet', 'it', 'lift', 'pest', 'cleaning', 'water']

# Every service, by product name — for the data file and its prices.
SERVICES = {name: (purpose, price) for *_rest, services in PROBLEMS for name, purpose, price in services}


def detect_problem(text):
    """The problem a message describes, or None.

    Needs both an area ("water") and a sign of trouble ("not coming"). The
    area named most often wins; on a tie, the one listed in ``_TIE_ORDER``
    first ("the washroom is dirty" is a cleaning problem, not a plumbing one).
    """
    text = text or ''
    if not _TROUBLE.search(text):
        return None
    if re.search(CATALOG_PATTERN, text, re.IGNORECASE) and _ORDERING.search(text) and not _FIXING.search(text):
        return None
    hits = {key: len(re.findall(area, text, re.IGNORECASE)) for key, area, *_rest in PROBLEMS}
    best = max(hits.values())
    if not best:
        return None
    key = next(k for k in _TIE_ORDER if hits[k] == best)
    _key, _area, title, category, checks, services = next(p for p in PROBLEMS if p[0] == key)
    return {'key': key, 'title': title, 'category': category, 'checks': checks, 'services': services}


def offer_problem_services(parsed, text):
    """Turn a problem message into one line offering the services that fix it.

    :return: True when the message was read as a problem.
    """
    problem = detect_problem(text)
    if not problem:
        return False
    # Price from the master when the service is there, else the indicative one.
    Product = request.env['product.product'].sudo()
    options = []
    for name, purpose, price in problem['services']:
        product = Product.search([('name', '=', name), ('purchase_ok', '=', True)], limit=1)
        options.append({'name': name, 'purpose': purpose,
                        'price': (product.list_price or product.standard_price) if product else price})
    asked = _item_phrase(text) or problem['title'].capitalize()
    parsed['lineItems'] = [{
        'productName': problem['title'][:1].upper() + problem['title'][1:],
        'productQty': 1,
        'targetPrice': 0.0,
        'family': problem['title'],
        'options': options,
        'problem': {'title': problem['title'], 'checks': problem['checks'], 'asked': asked[:80]},
    }]
    first = parsed['lineItems'][0]
    parsed.update(productName=first['productName'], productQty=1, targetPrice=0.0,
                  expenseCategory=problem['category'], urgency='High')
    return True
