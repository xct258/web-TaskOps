"""家庭库存接口：物品、库存变动和提醒所需的基础数据。"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlmodel import Session, select

from db import get_inventory_session
from models import InventoryItem, InventoryMovement, shanghai_now

router = APIRouter()


@router.get("/inventory", response_model=List[InventoryItem])
def list_inventory(
    q: Optional[str] = Query(None),
    session: Session = Depends(get_inventory_session),
):
    rows = session.exec(select(InventoryItem).order_by(InventoryItem.updated_at.desc())).all()
    query = (q or "").strip().lower()
    return [
        item for item in rows
        if not query or query in " ".join(str(x or "") for x in [item.name, item.location, item.note, *item.tags]).lower()
    ]


@router.post("/inventory", response_model=InventoryItem)
def create_inventory(item: InventoryItem, session: Session = Depends(get_inventory_session)):
    item.id = None
    item.updated_at = shanghai_now()
    session.add(item)
    session.commit()
    session.refresh(item)
    return item


@router.put("/inventory/{item_id}", response_model=InventoryItem)
def update_inventory(item_id: int = Path(...), payload: dict = ..., session: Session = Depends(get_inventory_session)):
    item = session.get(InventoryItem, item_id)
    if not item:
        raise HTTPException(404, "Inventory item not found")
    for field in ["name", "quantity", "unit", "location", "tags", "note"]:
        if field in payload:
            setattr(item, field, payload[field])
    item.updated_at = shanghai_now()
    session.commit()
    session.refresh(item)
    return item


@router.delete("/inventory/{item_id}")
def delete_inventory(item_id: int = Path(...), session: Session = Depends(get_inventory_session)):
    item = session.get(InventoryItem, item_id)
    if not item:
        raise HTTPException(404, "Inventory item not found")
    session.delete(item)
    for movement in session.exec(select(InventoryMovement).where(InventoryMovement.item_id == item_id)).all():
        session.delete(movement)
    session.commit()
    return {"message": "Deleted"}


@router.get("/inventory/{item_id}/movements", response_model=List[InventoryMovement])
def list_movements(item_id: int, session: Session = Depends(get_inventory_session)):
    return session.exec(
        select(InventoryMovement).where(InventoryMovement.item_id == item_id).order_by(InventoryMovement.created_at.desc())
    ).all()


@router.post("/inventory/{item_id}/movements", response_model=InventoryMovement)
def create_movement(item_id: int, movement: InventoryMovement, session: Session = Depends(get_inventory_session)):
    item = session.get(InventoryItem, item_id)
    if not item:
        raise HTTPException(404, "Inventory item not found")
    delta = float(movement.quantity_delta)
    if item.quantity + delta < 0:
        raise HTTPException(400, "库存数量不能小于 0")
    movement.id = None
    movement.item_id = item_id
    item.quantity += delta
    item.updated_at = shanghai_now()
    session.add(movement)
    session.commit()
    session.refresh(movement)
    return movement
