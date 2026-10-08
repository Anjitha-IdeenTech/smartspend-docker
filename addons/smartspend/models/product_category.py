from odoo import fields, models


class ProductCategory(models.Model):
    _inherit = 'product.category'

    smartspend_vendor_ids = fields.Many2many(
        'res.partner', 'smartspend_product_category_vendor_rel', 'category_id', 'partner_id',
        string='Vendors', domain=[('supplier_rank', '>', 0)],
        help="Suppliers who serve this product category. They are suggested, and "
             "pre-selected, when a buyer invites vendors to bid on a request whose "
             "items fall in this category or in one of its sub-categories.")
    smartspend_expense_category_ids = fields.One2many(
        'smartspend.expense.category', 'product_category_id', string='Expense Categories',
        help="Expense categories whose items belong to this product category.")
