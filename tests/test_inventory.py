"""家庭库存基础接口回归测试。"""
import sys
import unittest
from datetime import date
from pathlib import Path

from fastapi import HTTPException
from sqlmodel import Session, SQLModel, create_engine

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "后端"))

from models import InventoryItem, InventoryMovement
from routers import inventory


class InventoryTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        SQLModel.metadata.create_all(self.engine, tables=[InventoryItem.__table__, InventoryMovement.__table__])
        self.session = Session(self.engine)
        self.addCleanup(self.engine.dispose)
        self.addCleanup(self.session.close)

    def test_create_and_search_inventory(self):
        item = inventory.create_inventory(InventoryItem(name="螺丝刀", quantity=2, unit="件", tags=["工具"]), self.session)
        self.assertEqual(inventory.list_inventory(q="工具", session=self.session)[0].id, item.id)

    def test_movement_updates_quantity_and_rejects_negative_stock(self):
        item = inventory.create_inventory(InventoryItem(name="洗衣液", quantity=1), self.session)
        movement = inventory.create_movement(item.id, InventoryMovement(item_id=item.id, quantity_delta=2, reason="购买"), self.session)
        self.assertEqual(movement.quantity_delta, 2)
        self.session.refresh(item)
        self.assertEqual(item.quantity, 3)
        with self.assertRaises(HTTPException):
            inventory.create_movement(item.id, InventoryMovement(item_id=item.id, quantity_delta=-4), self.session)


if __name__ == "__main__":
    unittest.main()
