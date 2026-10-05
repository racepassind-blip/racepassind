import importlib.util
from pathlib import Path
import unittest

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect, text


class CheckoutPaymentMigrationTests(unittest.TestCase):
    def test_upgrade_and_empty_downgrade(self):
        path = Path(__file__).resolve().parents[1] / "migrations/versions/0067_checkout_payments.py"
        spec = importlib.util.spec_from_file_location("checkout_migration", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        engine = create_engine("sqlite://")
        try:
            with engine.begin() as connection:
                connection.execute(text("CREATE TABLE product_orders (id CHAR(32) PRIMARY KEY)"))
                connection.execute(text("CREATE TABLE orders (id CHAR(32) PRIMARY KEY)"))
                with Operations.context(MigrationContext.configure(connection)):
                    module.upgrade()
                    self.assertIn("checkout_receipts", inspect(connection).get_table_names())
                    self.assertIn("archived_at", [c["name"] for c in inspect(connection).get_columns("product_orders")])
                    module.downgrade()
                    self.assertNotIn("checkout_payments", inspect(connection).get_table_names())
        finally:
            engine.dispose()
