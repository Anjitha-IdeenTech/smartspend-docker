"""Product descriptions on the master, and finding products by them.

Each product in Odoo carries a description (its Purchase Description — what a
product creation request's brand and specification become when a manager
approves it). The portal's Master Data console shows and edits it, and the
requester's chat uses it: when someone asks for something in their own words
("a cycle for the site staff to commute"), the products whose name or
description match are offered to pick from, instead of raising a new product.

Reading needs a signed-in buying-side user; only an SCM buyer (or a
procurement manager, who is one) changes a description.
"""
import re

from odoo import _, http
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.http import request

from .auction import _is_buyer
from .main import _authenticate, _error, _refused
from .parser import DEPARTMENTS, LOCATIONS

# Words that say how something is asked for, not what is asked for.
_STOPWORDS = set("""
a an the and or of for with to in on at by from into per via as is are be it its this that these those
i i'd i'm im we our us me my you your they them their he she his her
hi hello hey please pls kindly thanks thank can could would should will shall may might
need needs needed want wants wanted require requires required requesting request requests
order orders buy buying purchase procure procuring get getting some any about around approx approximately
new good best nice quality urgent urgently asap immediately soon next this week weeks month months
day days year years today tomorrow before within deliver delivered delivery
unit units nos pcs piece pieces qty quantity item items thing things something stuff one ones
office branch head team staff people employee employees department use used using also like just
""".split())


def _stem(word):
    """Fold the common plural endings: "cycles" → "cycle", "batteries" → "battery"."""
    if len(word) > 4 and word.endswith('ies'):
        return word[:-3] + 'y'
    if len(word) > 4 and word.endswith(('ches', 'shes', 'sses', 'xes', 'zes')):
        return word[:-2]
    if len(word) > 3 and word.endswith('s') and not word.endswith('ss'):
        return word[:-1]
    return word


def _words(text):
    return {_stem(w) for w in re.findall(r"[a-z0-9][a-z0-9'\-]*", (text or '').lower())}


def _keywords(text):
    """What the message names, without branch, department and filler words."""
    text = text or ''
    for pattern, _value in LOCATIONS + DEPARTMENTS:
        text = re.sub(pattern, ' ', text, flags=re.IGNORECASE)
    return {w for w in _words(text)
            if len(w) >= 3 and not w.isdigit() and w not in _STOPWORDS and _stem(w) not in _STOPWORDS}


def _hit(keyword, words):
    """A keyword matches a word that is it, or — when long enough — contains it
    ("cycle" in "bicycle")."""
    return keyword in words or (len(keyword) >= 5 and any(keyword in w for w in words))


def _description(product):
    return (product.description_purchase or '').strip()


def match_products(text, limit=5):
    """Purchasable products whose name or description match ``text``, best first.

    A word that names the product counts double a word found only in its
    description. Products scoring under half the best are left out.

    :return: ``[{'id', 'name', 'description', 'category', 'price', 'score'}]``
    """
    keywords = _keywords(text)
    if not keywords:
        return []
    # Names and descriptions only; a requester holds no product rights.
    products = request.env['product.product'].sudo().search([('purchase_ok', '=', True)])
    scored = []
    for product in products:
        name_words = _words(product.name)
        description_words = _words(_description(product))
        score = 0
        for keyword in keywords:
            if _hit(keyword, name_words):
                score += 2
            elif _hit(keyword, description_words):
                score += 1
        if score:
            scored.append((score, product))
    if not scored:
        return []
    best = max(score for score, _product in scored)
    scored = [(s, p) for s, p in scored if s * 2 >= best]
    scored.sort(key=lambda pair: (-pair[0], pair[1].name.casefold()))
    return [{
        'id': product.id,
        'name': product.name,
        'description': _description(product),
        'category': product.categ_id.name or '',
        'price': product.list_price or product.standard_price or 0.0,
        'score': score,
    } for score, product in scored[:limit]]


class SmartSpendProductMaster(http.Controller):

    @http.route('/api/smartspend/products/description', type='json2', auth='none',
                methods=['POST'], cors='*', readonly=False)
    def save_description(self, id=None, description=None, **kwargs):
        """Set a product's description (its Purchase Description in Odoo).

        :return: ``{'id', 'name', 'description'}``
        """
        error = _authenticate()
        if error:
            return error
        if not _is_buyer(request.env.user):
            return _error(_("Only an SCM buyer maintains product descriptions."), 403)
        try:
            product_id = int(id)
        except (TypeError, ValueError):
            return _error(_("Which product? Send its id."), 400)
        # The buyer was checked above; products are configuration a buyer
        # holds no write right on.
        product = request.env['product.product'].sudo().browse(product_id).exists()
        if not product:
            return _error(_("That product no longer exists."), 404)
        try:
            product.description_purchase = (description or '').strip()[:2000] or False
        except (AccessError, UserError, ValidationError) as exc:
            return _refused(exc)
        return {'id': product.id, 'name': product.name, 'description': _description(product)}
