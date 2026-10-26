from odoo import api, fields, models


class SmartspendFavoriteProduct(models.Model):
    """A product a user orders again and again, kept one tap away.

    Each user keeps their own list: what they usually ask for, how many and at
    what price. The portal raises a request straight from a selection of them.
    """
    _name = 'smartspend.favorite.product'
    _description = 'SmartSpend Favourite Product'
    _order = 'sequence, id'

    user_id = fields.Many2one(
        'res.users', string='User', required=True, index=True, ondelete='cascade',
        default=lambda self: self.env.user)
    product_name = fields.Char(string='Product', required=True)
    product_id = fields.Many2one('product.product', string='Odoo Product')
    category_id = fields.Many2one('smartspend.expense.category', string='Expense Category')
    default_qty = fields.Float(string='Usual Quantity', default=1.0, digits='Product Unit')
    target_price = fields.Float(string='Usual Price')
    note = fields.Char(string='Note', help="Why or for whom it is usually ordered.")
    sequence = fields.Integer(default=10)
    company_id = fields.Many2one(
        'res.company', required=True, default=lambda self: self.env.company)

    _user_product_uniq = models.Constraint(
        'UNIQUE(user_id, product_name)',
        'This product is already among your favourites.',
    )

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get('product_name'):
                vals['product_name'] = ' '.join(vals['product_name'].split())
        return super().create(vals_list)


class SmartspendFavoriteGroup(models.Model):
    """A named set of products a user orders together — "New joiner kit".

    Added to a request in one go: every item becomes a line at its usual
    quantity. Each user keeps their own groups, beside their favourites.
    """
    _name = 'smartspend.favorite.group'
    _description = 'SmartSpend Favourite Group'
    _order = 'sequence, id'

    user_id = fields.Many2one(
        'res.users', string='User', required=True, index=True, ondelete='cascade',
        default=lambda self: self.env.user)
    name = fields.Char(string='Group', required=True)
    sequence = fields.Integer(default=10)
    item_ids = fields.One2many('smartspend.favorite.group.item', 'group_id', string='Products', copy=True)
    company_id = fields.Many2one(
        'res.company', required=True, default=lambda self: self.env.company)

    _user_name_uniq = models.Constraint(
        'UNIQUE(user_id, name)',
        'You already have a group with this name.',
    )


class SmartspendFavoriteGroupItem(models.Model):
    _name = 'smartspend.favorite.group.item'
    _description = 'SmartSpend Favourite Group Product'
    _order = 'sequence, id'
    _rec_name = 'product_name'

    group_id = fields.Many2one('smartspend.favorite.group', required=True, ondelete='cascade', index=True)
    sequence = fields.Integer(default=10)
    product_name = fields.Char(string='Product', required=True)
    quantity = fields.Float(string='Quantity', default=1.0, digits='Product Unit')
    target_price = fields.Float(string='Usual Price')
