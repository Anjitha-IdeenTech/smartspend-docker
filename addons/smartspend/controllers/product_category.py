"""Product categories on the portal's Master Data console.

Each product category carries the suppliers who serve it. When a buyer invites
vendors to a reverse auction, the suppliers assigned to the request's product
categories (or to a parent of them) are suggested and pre-ticked — see
``auction_vendors``.

Everyone on the buying side can read the list; only an SCM buyer (or a
procurement manager, who is one) creates or changes a category. Suppliers do not
see it: who else supplies a category is not their business.
"""
from odoo import _, http
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.http import request

from .auction import _is_buyer, _is_vendor
from .main import _authenticate, _error, _refused


def _row(category):
    return {
        'id': category.id,
        'name': category.name,
        'completeName': category.complete_name or category.name,
        'parentId': category.parent_id.id or False,
        'parentName': category.parent_id.complete_name or '',
        'vendorIds': category.smartspend_vendor_ids.ids,
        'vendors': category.smartspend_vendor_ids.mapped('name'),
        'expenseCategoryIds': category.smartspend_expense_category_ids.ids,
        'expenseCategories': category.smartspend_expense_category_ids.mapped('name'),
        'productCount': category.product_count,
    }


def _ids(values):
    return [int(value) for value in (values or [])]


class SmartSpendProductCategory(http.Controller):

    @http.route('/api/smartspend/product-categories', type='json2', auth='none',
                methods=['GET'], cors='*', readonly=True)
    def product_categories(self, **kwargs):
        """The product categories, their vendors, and what the form offers.

        :return: ``{'canEdit', 'categories': [...], 'vendors': [...],
            'expenseCategories': [...]}``
        """
        error = _authenticate()
        if error:
            return error
        user = request.env.user
        if _is_vendor(user):
            return _error(_("Product categories are for the buying side only."), 403)
        # Read as superuser: a requester holds no rights on product categories
        # or suppliers, and this hands back names only.
        env = request.env(su=True)
        categories = env['product.category'].search([], order='complete_name')
        vendors = env['res.partner'].search([('supplier_rank', '>', 0)], order='name', limit=500)
        expense = env['smartspend.expense.category'].search([])
        return {
            'canEdit': _is_buyer(user),
            'categories': [_row(category) for category in categories],
            'vendors': [{'id': vendor.id, 'name': vendor.name} for vendor in vendors],
            'expenseCategories': [{'id': cat.id, 'name': cat.name} for cat in expense],
        }

    @http.route('/api/smartspend/product-categories/save', type='json2', auth='none',
                methods=['POST'], cors='*', readonly=False)
    def save_product_category(self, id=None, name=None, parentId=None, vendorIds=None,
                              expenseCategoryIds=None, **kwargs):
        """Create a product category, or change one when ``id`` is given.

        :param vendorIds: the suppliers assigned to it — replaces the list.
        :param expenseCategoryIds: optional; the expense categories whose items
            fall in it. Left out, they are not touched.
        :return: the saved category, as listed.
        """
        error = _authenticate()
        if error:
            return error
        if not _is_buyer(request.env.user):
            return _error(_("Only an SCM buyer maintains product categories."), 403)
        name = (name or '').strip()
        if not name:
            return _error(_("A product category needs a name."), 400)
        try:
            vendor_ids = _ids(vendorIds)
            parent_id = int(parentId) if parentId else False
            category_id = int(id) if id else False
            expense_ids = None if expenseCategoryIds is None else _ids(expenseCategoryIds)
        except (TypeError, ValueError):
            return _error(_("Category, parent and vendors have to be ids."), 400)
        # The buyer was checked above; product categories themselves are
        # inventory configuration a buyer holds no write right on.
        env = request.env(su=True)
        Category = env['product.category']
        suppliers = env['res.partner'].browse(vendor_ids).exists().filtered(lambda p: p.supplier_rank > 0)
        if len(suppliers) != len(set(vendor_ids)):
            return _error(_("Only existing suppliers can be assigned to a product category."), 400)
        values = {
            'name': name,
            'parent_id': parent_id,
            'smartspend_vendor_ids': [(6, 0, suppliers.ids)],
        }
        try:
            if category_id:
                category = Category.browse(category_id).exists()
                if not category:
                    return _error(_("That product category no longer exists."), 404)
                category.write(values)
            else:
                category = Category.create(values)
            if expense_ids is not None:
                Expense = env['smartspend.expense.category']
                Expense.search([('product_category_id', '=', category.id),
                                ('id', 'not in', expense_ids)]).product_category_id = False
                Expense.browse(expense_ids).exists().product_category_id = category
        except (AccessError, UserError, ValidationError) as exc:
            return _refused(exc)
        return _row(category)
