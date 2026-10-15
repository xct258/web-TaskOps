"""账本接口：流水增删改查 + 资产/负债总额读写。

资金规则（使用 Decimal 按分计算）：
- income    收入：资产 += amount
- expense   支出：资产 -= amount
- debt_in   借入：资产 += amount，负债 += amount
- debt_out  还款：资产 -= (amount + interest)，负债 -= amount（本金）

新增/修改/删除流水时，Asset(id=1) / Liability(id=1) 自动同步。
余额仅由流水维护，禁止直接覆写余额。

调试速查::

    $ curl localhost:8481/ledger | head -c 300
    $ curl -X POST localhost:8481/ledger -H 'Content-Type: application/json' \\
        -d '{"item":"午餐","amount":22,"record_type":"expense","record_date":"2026-09-10"}'
    $ curl localhost:8481/asset
"""
from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import List, Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlmodel import Field, Session, SQLModel, select

from db import get_ledger_session
from models import Asset, Ledger, Liability, shanghai_now
from utils import get_or_create_singleton, ledger_effect

router = APIRouter()


class FinancedPurchase(SQLModel):
    item: str
    amount: float
    kind: Literal['loan', 'credit_card'] = 'credit_card'
    financing_source: str = ''
    record_date: date = Field(default_factory=lambda: shanghai_now().date())
    category: str = ''
    notes: str = ''


def purchase_entries(purchase):
    fields = dict(item=purchase.item, amount=purchase.amount, record_date=purchase.record_date,
                  category=purchase.category.strip(), notes=purchase.notes.strip(),
                  purchase_kind=purchase.kind, financing_source=purchase.financing_source.strip())
    rows = [Ledger(record_type=kind, **fields) for kind in ['debt_in', 'expense']]
    for row in rows:
        validate_entry(row)
    return rows


def get_purchase(session, purchase_id):
    rows = session.exec(select(Ledger).where(Ledger.purchase_id == purchase_id)).all()
    if not rows:
        raise HTTPException(404, '贷款购买记录不存在')
    if len(rows) != 2 or {row.record_type for row in rows} != {'debt_in', 'expense'}:
        raise HTTPException(409, '贷款购买关联流水不完整')
    return rows


@router.post('/ledger/financed-purchases', response_model=List[Ledger])
def create_financed_purchase(purchase: FinancedPurchase, session: Session = Depends(get_ledger_session)):
    rows = purchase_entries(purchase)
    purchase_id = str(uuid4())
    asset, liability = _touch_assets(session)
    for row in rows:
        row.purchase_id = purchase_id
        session.add(row)
        apply_effect(asset, liability, row)
    check_balances(session, asset, liability)
    session.commit()
    for row in rows:
        session.refresh(row)
    return rows


@router.put('/ledger/financed-purchases/{purchase_id}', response_model=List[Ledger])
def update_financed_purchase(purchase_id: str, purchase: FinancedPurchase, session: Session = Depends(get_ledger_session)):
    rows = get_purchase(session, purchase_id)
    drafts = {row.record_type: row for row in purchase_entries(purchase)}
    loan = next(row for row in rows if row.record_type == 'debt_in')
    validate_loan(session, drafts['debt_in'], loan)
    asset, liability = _touch_assets(session)
    for row in rows:
        apply_effect(asset, liability, row, -1)
        draft = drafts[row.record_type]
        for field in ['item', 'amount', 'record_date', 'category', 'notes', 'purchase_kind', 'financing_source']:
            setattr(row, field, getattr(draft, field))
        apply_effect(asset, liability, row)
        session.add(row)
    check_balances(session, asset, liability)
    session.commit()
    for row in rows:
        session.refresh(row)
    return rows


def money(value):
    try:
        result = Decimal(str(value))
        if not result.is_finite() or abs(result) > Decimal('999999999999.99'):
            raise ValueError()
        return result.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError, TypeError):
        raise HTTPException(422, '金额必须是有效数字，且不超过 999999999999.99')


def validate_entry(entry):
    if not isinstance(entry.record_type, str) or entry.record_type not in {'income', 'expense', 'debt_in', 'debt_out'}:
        raise HTTPException(422, '无效的流水类型')
    if entry.record_type != 'debt_out' and (not isinstance(entry.item, str) or not entry.item.strip()):
        raise HTTPException(422, '项目不能为空')
    amount, interest = money(entry.amount), money(entry.interest)
    if amount <= 0 or interest < 0:
        raise HTTPException(422, '金额须大于零，利息不能为负数')
    if entry.record_type != 'debt_out' and interest:
        raise HTTPException(422, '只有还款流水可以填写利息')
    entry.item = entry.item.strip() if entry.record_type != 'debt_out' else ''
    entry.amount, entry.interest = float(amount), float(interest)


def apply_effect(asset, liability, entry, direction=1):
    amount, interest = money(entry.amount), money(entry.interest)
    da, dl = ledger_effect(entry.record_type, amount, interest)
    asset.amount = float(money(asset.amount) + direction * da)
    liability.amount = float(money(liability.amount) + direction * dl)


def check_balances(session, asset, liability):
    if asset.amount < 0:
        shortfall = -money(asset.amount)
        session.rollback()
        raise HTTPException(422, f'资金不足，还差 {shortfall:.2f} 元；此操作未保存，请先核对余额或记录实际借入资金')
    if liability.amount < 0:
        session.rollback()
        raise HTTPException(422, '此操作会导致负债为负数，请检查借入记录与还款本金')


def repayments_for(session, loan_id, exclude_id=None):
    query = select(Ledger).where(Ledger.record_type == 'debt_out', Ledger.loan_id == loan_id)
    if exclude_id is not None:
        query = query.where(Ledger.id != exclude_id)
    return session.exec(query).all()


def validate_loan(session, entry, previous=None):
    if previous and previous.record_type == 'debt_in':
        repayments = repayments_for(session, previous.id)
        if repayments:
            paid = sum((money(row.amount) for row in repayments), Decimal(0))
            if entry.record_type != 'debt_in' or money(entry.amount) < paid:
                raise HTTPException(422, '该借款已有还款，不能更改类型或将本金调低至已还本金以下')
    if entry.record_type != 'debt_out':
        entry.loan_id = None
        return
    if entry.loan_id is None:
        raise HTTPException(422, '请选择要偿还的借款项目')
    loan = session.get(Ledger, entry.loan_id)
    if not loan or loan.record_type != 'debt_in' or (previous and loan.id == previous.id):
        raise HTTPException(422, '所选借款项目不存在或不是借款')
    entry.item = f'{loan.item}还款'
    paid = sum((money(row.amount) for row in repayments_for(session, loan.id, previous.id if previous else None)), Decimal(0))
    remaining = money(loan.amount) - paid
    if money(entry.amount) > remaining:
        raise HTTPException(422, f'还款本金超过该借款剩余本金（{remaining:.2f} 元）')


@router.get('/ledger/loans')
def list_loans(session: Session = Depends(get_ledger_session)):
    loans = session.exec(select(Ledger).where(Ledger.record_type == 'debt_in').order_by(Ledger.record_date.desc(), Ledger.id.desc())).all()
    repayments = session.exec(select(Ledger).where(Ledger.record_type == 'debt_out', Ledger.loan_id.is_not(None))).all()
    paid = {}
    for row in repayments:
        paid[row.loan_id] = paid.get(row.loan_id, Decimal(0)) + money(row.amount)
    return [{
        'id': loan.id, 'item': loan.item, 'record_date': loan.record_date,
        'amount': loan.amount, 'repaid': float(paid.get(loan.id, Decimal(0))),
        'remaining': float(money(loan.amount) - paid.get(loan.id, Decimal(0))),
        'purchase_kind': loan.purchase_kind, 'financing_source': loan.financing_source,
    } for loan in loans]


@router.get('/ledger/summary')
def ledger_summary(session: Session = Depends(get_ledger_session)):
    start = shanghai_now().date().replace(day=1)
    end = date(start.year + (start.month == 12), start.month % 12 + 1, 1)
    rows = session.exec(select(Ledger).where(Ledger.record_date >= start, Ledger.record_date < end)).all()
    income = sum((money(row.amount) for row in rows if row.record_type == 'income'), Decimal(0))
    interest = sum((money(row.interest) for row in rows if row.record_type == 'debt_out'), Decimal(0))
    expense = sum((money(row.amount) for row in rows if row.record_type == 'expense'), Decimal(0)) + interest
    return {'income': float(income), 'expense': float(expense), 'interest': float(interest), 'balance': float(income - expense)}


def _touch_assets(session: Session):
    """资产/负债行取出来（不存在则建 0 行）并刷新时间戳。返回 (asset, liability)。"""
    asset = get_or_create_singleton(session, Asset)
    liability = get_or_create_singleton(session, Liability)
    asset.updated_at = shanghai_now()
    liability.updated_at = shanghai_now()
    session.add(asset)
    session.add(liability)
    return asset, liability


@router.get("/ledger", response_model=List[Ledger])
def get_ledger(
    limit: int = Query(200, ge=1, le=2000),
    offset: int = Query(0, ge=0),
    session: Session = Depends(get_ledger_session),
):
    return (
        session.exec(
            select(Ledger)
            .order_by(Ledger.record_date.desc(), Ledger.id.desc())
            .limit(limit)
            .offset(offset)
        ).all()
    )


@router.post("/ledger", response_model=Ledger)
def create_ledger(ledger: Ledger, session: Session = Depends(get_ledger_session)):
    if ledger.purchase_id is not None or ledger.purchase_kind is not None or ledger.financing_source is not None:
        raise HTTPException(422, '贷款购买或信用卡消费请使用专用入口')
    validate_entry(ledger)
    validate_loan(session, ledger)
    if isinstance(ledger.record_date, str):
        ledger.record_date = date.fromisoformat(ledger.record_date)

    session.add(ledger)

    asset, liability = _touch_assets(session)
    apply_effect(asset, liability, ledger)
    check_balances(session, asset, liability)

    session.commit()
    session.refresh(ledger)
    return ledger


@router.put("/ledger/{ledger_id}", response_model=Ledger)
def update_ledger(
    ledger_id: int = Path(...),
    updated: Ledger = ...,
    session: Session = Depends(get_ledger_session),
):
    item = session.get(Ledger, ledger_id)
    if not item:
        raise HTTPException(404, "Ledger item not found")

    if item.purchase_id:
        raise HTTPException(422, '关联购买流水必须通过贷款购买入口一起修改')
    if updated.purchase_id is not None or updated.purchase_kind is not None or updated.financing_source is not None:
        raise HTTPException(422, '不能通过普通流水设置购买关联')

    validate_entry(updated)
    validate_loan(session, updated, item)

    asset, liability = _touch_assets(session)

    # 1. 冲销旧影响
    apply_effect(asset, liability, item, -1)

    # 2. 落新值
    if isinstance(updated.record_date, str):
        updated.record_date = date.fromisoformat(updated.record_date)

    item.item = updated.item
    item.amount = updated.amount
    item.interest = updated.interest
    item.record_type = updated.record_type
    item.record_date = updated.record_date
    item.category = updated.category
    item.notes = updated.notes
    item.loan_id = updated.loan_id

    # 3. 入账新影响
    apply_effect(asset, liability, item)
    check_balances(session, asset, liability)

    session.add(item)
    session.commit()
    session.refresh(item)
    return item


@router.delete("/ledger/{ledger_id}")
def delete_ledger(
    ledger_id: int = Path(...),
    session: Session = Depends(get_ledger_session),
):
    ledger = session.get(Ledger, ledger_id)
    if not ledger:
        raise HTTPException(404, "Ledger item not found")

    if ledger.purchase_id:
        rows = get_purchase(session, ledger.purchase_id)
        loan = next(row for row in rows if row.record_type == 'debt_in')
        if repayments_for(session, loan.id):
            raise HTTPException(422, '该购买已有还款记录，请先处理关联还款后再删除')
        asset, liability = _touch_assets(session)
        for row in rows:
            apply_effect(asset, liability, row, -1)
            session.delete(row)
        check_balances(session, asset, liability)
        session.commit()
        return {'message': '购买及关联借入、支出流水已删除'}

    if ledger.record_type == 'debt_in' and repayments_for(session, ledger.id):
        raise HTTPException(422, '该借款已有还款记录，请先处理关联还款后再删除')

    asset, liability = _touch_assets(session)
    apply_effect(asset, liability, ledger, -1)
    check_balances(session, asset, liability)

    session.delete(ledger)
    session.commit()
    return {"message": "Deleted"}


@router.get("/asset", response_model=Asset)
def get_asset(session: Session = Depends(get_ledger_session)):
    asset = session.get(Asset, 1)
    if not asset:
        asset = Asset(id=1, amount=0.0)
        session.add(asset)
        session.commit()
        session.refresh(asset)
    return asset


@router.get("/liability", response_model=Liability)
def get_liability(session: Session = Depends(get_ledger_session)):
    liability = session.get(Liability, 1)
    if not liability:
        liability = Liability(id=1, amount=0.0)
        session.add(liability)
        session.commit()
        session.refresh(liability)
    return liability
