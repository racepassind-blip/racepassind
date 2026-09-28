import unittest
from uuid import uuid4

from pydantic import ValidationError

from app.listings.products import Product, ProductVariant, ProductCatalog, ProductCart, ProductCartLine, price_product_order, quote_products


class ProductCatalogTests(unittest.TestCase):
    def setUp(self):
        self.variant = ProductVariant(id=uuid4(), label="Standard breakfast", price_paise=15000, stock=5)
        self.product = Product(id=uuid4(), name="Breakfast", variants=[self.variant])
        self.catalog = ProductCatalog(products=[self.product], pickup_instructions="Collect at the venue from 8 AM")

    def line(self, quantity=1, **kwargs):
        return ProductCartLine(product_id=self.product.id, variant_id=self.variant.id, quantity=quantity, **kwargs)

    def test_breakfast_needs_no_size_or_ticket(self):
        quote = quote_products(self.catalog, ProductCart(lines=[self.line(2)]))
        self.assertEqual(quote["subtotal_paise"], 30000)
        self.assertEqual(quote["lines"][0]["options"], {})

    def test_duplicate_lines_cannot_bypass_stock(self):
        with self.assertRaisesRegex(ValueError, "stock"):
            quote_products(self.catalog, ProductCart(lines=[self.line(3), self.line(3)]))

    def test_cart_wide_unit_limit_counts_every_product_line(self):
        self.catalog.max_units_per_order = 4
        with self.assertRaisesRegex(ValueError, "Maximum 4"):
            quote_products(self.catalog, ProductCart(lines=[self.line(3), self.line(2)]))

    def test_cart_cannot_supply_its_own_price(self):
        with self.assertRaises(ValidationError):
            ProductCartLine(product_id=self.product.id, variant_id=self.variant.id, quantity=1, price_paise=1)

    def test_variant_must_belong_to_product(self):
        with self.assertRaisesRegex(ValueError, "valid product option"):
            quote_products(self.catalog, ProductCart(lines=[ProductCartLine(product_id=self.product.id, variant_id=uuid4(), quantity=1)]))

    def test_inactive_product_cannot_be_ordered(self):
        self.product.active = False
        with self.assertRaisesRegex(ValueError, "no longer available"):
            quote_products(self.catalog, ProductCart(lines=[self.line()]))

    def test_jersey_options_and_customization_are_snapshotted(self):
        self.product.customization_label = "Printed name"
        self.variant.options = {"Size": "M", "Colour": "Blue"}
        quote = quote_products(self.catalog, ProductCart(lines=[self.line(customization="Pramodh")]))
        self.assertEqual(quote["lines"][0]["options"]["Size"], "M")
        self.assertEqual(quote["lines"][0]["customization"], "Pramodh")

    def test_merch_fee_is_applied_once_to_the_complete_order_subtotal(self):
        second = ProductVariant(id=uuid4(), label="Large", price_paise=200000, stock=5)
        self.product.variants.append(second)
        result = price_product_order(
            None,
            catalog=self.catalog,
            cart=ProductCart(lines=[self.line(1), ProductCartLine(product_id=self.product.id, variant_id=second.id, quantity=1)]),
            organization=None,
            fee_bearer="PARTICIPANT",
        )
        self.assertEqual(result["subtotal_paise"], 215000)
        self.assertEqual(result["platform_fee_paise"], 8600)
        self.assertEqual(result["total_paise"], 223600)

    def test_reject_unoffered_customization(self):
        with self.assertRaisesRegex(ValueError, "Customization"):
            quote_products(self.catalog, ProductCart(lines=[self.line(customization="Name")]))

    def test_listing_adapter_keeps_products_independent_of_sports(self):
        from app.listings.adapters import get_listing_adapter
        adapter = get_listing_adapter("products")
        self.assertFalse(adapter.requires_ticket)
        self.assertFalse(adapter.uses_participant_profiles)
        self.assertEqual(adapter.fee_unit, "order")
        with self.assertRaises(ValueError):
            get_listing_adapter("badminton")

    def test_quantity_requires_positive_integer(self):
        for quantity in (0, -1, 1.5, True, "2"):
            with self.assertRaises(ValidationError):
                self.line(quantity)


if __name__ == "__main__":
    unittest.main()
