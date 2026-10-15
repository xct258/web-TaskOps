"""账本流水、借还款、余额约束和完整月度统计测试（独立内存数据库）。"""
import sys
import unittest
from datetime import timedelta
from pathlib import Path

from fastapi import HTTPException
from sqlmodel import Session, SQLModel, create_engine

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / '后端'))
from models import Asset, Ledger, Liability, shanghai_now
from routers import ledger


class LedgerTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://')
        SQLModel.metadata.create_all(self.engine, tables=[
            Asset.__table__, Liability.__table__, Ledger.__table__,
        ])
        self.session = Session(self.engine)
        self.addCleanup(self.engine.dispose)
        self.addCleanup(self.session.close)

    def entry(self, kind, amount, interest=0, loan_id=None):
        return ledger.create_ledger(Ledger(item='测试', amount=amount, interest=interest,
            record_type=kind, record_date=shanghai_now().date(), loan_id=loan_id), self.session)

    def balances(self):
        return (ledger.get_asset(self.session).amount, ledger.get_liability(self.session).amount)

    def test_borrow_repay_and_interest(self):
        self.entry('income', 10000)
        loan = self.entry('debt_in', 3000)
        self.entry('expense', 1000)
        self.entry('debt_out', 2000, 100, loan.id)
        self.assertEqual(self.balances(), (9900, 1000))
        stats = ledger.ledger_summary(self.session)
        self.assertEqual(stats['expense'], 1100)
        self.assertEqual(stats['interest'], 100)

    def test_edit_and_delete_reverse_original_effect(self):
        self.entry('income', 100)
        item = self.entry('expense', 10)
        ledger.update_ledger(item.id, Ledger(item='更新', record_type='expense', amount=25), self.session)
        self.assertEqual(self.balances(), (75, 0))
        ledger.delete_ledger(item.id, self.session)
        self.assertEqual(self.balances(), (100, 0))

    def test_decimal_rounding_and_repeated_operations(self):
        for _ in range(10):
            self.entry('income', 0.1)
        self.assertEqual(self.balances(), (1, 0))
        self.entry('expense', 0.105)
        self.assertEqual(self.balances(), (0.89, 0))

    def test_summary_not_limited_to_first_page(self):
        for _ in range(205):
            self.entry('income', 1)
        self.assertEqual(len(ledger.get_ledger(limit=200, offset=0, session=self.session)), 200)
        self.assertEqual(len(ledger.get_ledger(limit=200, offset=200, session=self.session)), 5)
        self.assertEqual(ledger.ledger_summary(self.session)['income'], 205)

    def test_summary_excludes_other_months(self):
        current = shanghai_now().date()
        previous = current.replace(day=1) - timedelta(days=1)
        ledger.create_ledger(Ledger(item='上月', amount=100, record_type='income', record_date=previous), self.session)
        self.entry('income', 20)
        self.assertEqual(ledger.ledger_summary(self.session)['income'], 20)

    def test_deleting_borrow_after_repayment_is_rejected(self):
        borrowed = self.entry('debt_in', 100)
        self.entry('debt_out', 50, loan_id=borrowed.id)
        with self.assertRaises(HTTPException):
            ledger.delete_ledger(borrowed.id, self.session)
        self.assertEqual(self.balances(), (50, 50))

    def test_direct_balance_write_routes_are_removed(self):
        for route in ledger.router.routes:
            if route.path in {'/asset', '/liability'}:
                self.assertEqual(route.methods, {'GET'})
        self.assertFalse(hasattr(ledger, 'update_asset'))
        self.assertFalse(hasattr(ledger, 'update_liability'))

    def test_reject_invalid_entries_without_balance_changes(self):
        for kind, amount, interest in [('unknown', 1, 0), ('income', -1, 0),
                ('expense', 0, 0), ('income', float('inf'), 0),
                ('debt_out', 1, -1), ('expense', 1, 1)]:
            with self.subTest(kind=kind, amount=amount, interest=interest):
                with self.assertRaises(HTTPException):
                    self.entry(kind, amount, interest)
        self.assertEqual(self.balances(), (0, 0))

    def test_repayment_cannot_exceed_debt_and_rolls_back(self):
        loan = self.entry('debt_in', 10)
        with self.assertRaises(HTTPException):
            self.entry('debt_out', 11, loan_id=loan.id)
        self.assertEqual(self.balances(), (10, 10))
        self.assertEqual(len(ledger.get_ledger(limit=200, offset=0, session=self.session)), 1)

    def test_invalid_edit_rolls_back_both_entry_and_balances(self):
        loan = self.entry('debt_in', 100)
        repayment = self.entry('debt_out', 50, loan_id=loan.id)
        repayment_id = repayment.id
        with self.assertRaises(HTTPException):
            ledger.update_ledger(repayment_id, Ledger(item='超额还款', amount=101, record_type='debt_out', loan_id=loan.id), self.session)
        self.assertEqual(self.balances(), (50, 50))
        self.assertEqual(self.session.get(Ledger, repayment_id).amount, 50)

    def test_expense_cannot_exceed_available_funds(self):
        self.entry('income', 100)
        with self.assertRaises(HTTPException) as error:
            self.entry('expense', 100.01)
        self.assertIn('资金不足', error.exception.detail)
        self.assertEqual(self.balances(), (100, 0))
        self.assertEqual(ledger.ledger_summary(self.session)['expense'], 0)
        self.entry('expense', 100)
        self.assertEqual(self.balances(), (0, 0))

    def test_repayment_must_cover_both_principal_and_interest(self):
        loan = self.entry('debt_in', 100)
        with self.assertRaises(HTTPException):
            self.entry('debt_out', 100, 0.01, loan.id)
        self.assertEqual(self.balances(), (100, 100))
        self.assertEqual(ledger.list_loans(self.session)[0]['remaining'], 100)
        self.entry('debt_out', 99, 1, loan.id)
        self.assertEqual(self.balances(), (0, 1))

    def test_edit_expense_checks_final_balance_and_rolls_back(self):
        self.entry('income', 100)
        expense = self.entry('expense', 40)
        expense_id = expense.id
        with self.assertRaises(HTTPException):
            ledger.update_ledger(expense_id, Ledger(item='超支', amount=101, record_type='expense'), self.session)
        self.assertEqual(self.balances(), (60, 0))
        self.assertEqual(self.session.get(Ledger, expense_id).amount, 40)
        ledger.update_ledger(expense_id, Ledger(item='全部花完', amount=100, record_type='expense'), self.session)
        self.assertEqual(self.balances(), (0, 0))

    def test_income_cannot_be_deleted_or_reduced_if_funds_spent(self):
        income = self.entry('income', 100)
        income_id = income.id
        self.entry('expense', 80)
        with self.assertRaises(HTTPException):
            ledger.delete_ledger(income_id, self.session)
        self.assertEqual(self.balances(), (20, 0))
        with self.assertRaises(HTTPException):
            ledger.update_ledger(income_id, Ledger(item='减少收入', amount=79, record_type='income'), self.session)
        self.assertEqual(self.balances(), (20, 0))
        self.assertEqual(self.session.get(Ledger, income_id).amount, 100)

    def test_edit_repayment_with_interest_cannot_overdraw(self):
        loan = self.entry('debt_in', 100)
        repayment = self.entry('debt_out', 50, loan_id=loan.id)
        repayment_id = repayment.id
        with self.assertRaises(HTTPException):
            ledger.update_ledger(repayment_id, Ledger(item='超支还款', amount=100, interest=1, record_type='debt_out', loan_id=loan.id), self.session)
        self.assertEqual(self.balances(), (50, 50))
        self.assertEqual(self.session.get(Ledger, repayment_id).amount, 50)
        self.assertEqual(ledger.list_loans(self.session)[0]['remaining'], 50)

    def test_repayments_are_checked_per_loan(self):
        first = self.entry('debt_in', 100)
        second = self.entry('debt_in', 1000)
        self.entry('debt_out', 60, 5, first.id)
        with self.assertRaises(HTTPException):
            self.entry('debt_out', 41, loan_id=first.id)
        loans = {row['id']: row for row in ledger.list_loans(self.session)}
        self.assertEqual(loans[first.id]['remaining'], 40)
        self.assertEqual(loans[second.id]['remaining'], 1000)
        self.assertEqual(self.balances(), (1035, 1040))

    def test_repayment_requires_valid_loan(self):
        income = self.entry('income', 100)
        for loan_id in [None, 9999, income.id]:
            with self.assertRaises(HTTPException):
                self.entry('debt_out', 10, loan_id=loan_id)
        self.assertEqual(self.balances(), (100, 0))

    def test_edit_repayment_can_keep_full_amount_or_move_to_another_loan(self):
        first = self.entry('debt_in', 100)
        second = self.entry('debt_in', 200)
        repayment = self.entry('debt_out', 100, loan_id=first.id)
        ledger.update_ledger(repayment.id, Ledger(item='保持', amount=100, record_type='debt_out', loan_id=first.id), self.session)
        ledger.update_ledger(repayment.id, Ledger(item='改关联', amount=100, record_type='debt_out', loan_id=second.id), self.session)
        loans = {row['id']: row for row in ledger.list_loans(self.session)}
        self.assertEqual(loans[first.id]['remaining'], 100)
        self.assertEqual(loans[second.id]['remaining'], 100)
        ledger.delete_ledger(repayment.id, self.session)
        self.assertEqual(self.balances(), (300, 300))

    def test_loan_cannot_change_type_or_shrink_below_paid_principal(self):
        loan = self.entry('debt_in', 100)
        self.entry('debt_in', 1000)
        self.entry('debt_out', 60, loan_id=loan.id)
        for kind, amount in [('income', 100), ('debt_in', 59)]:
            with self.assertRaises(HTTPException):
                ledger.update_ledger(loan.id, Ledger(item='调整', record_type=kind, amount=amount), self.session)
        with self.assertRaises(HTTPException):
            ledger.delete_ledger(loan.id, self.session)
        self.assertEqual(self.balances(), (1040, 1040))

    def test_new_ledger_starts_at_zero(self):
        self.assertEqual(ledger.get_ledger(limit=200, offset=0, session=self.session), [])
        self.assertEqual(self.balances(), (0, 0))
        self.entry('income', 100)
        self.entry('expense', 20)
        self.assertEqual(len(ledger.get_ledger(limit=200, offset=0, session=self.session)), 2)
        self.assertEqual(self.balances(), (80, 0))

    def test_edit_repayment_cannot_remove_loan_reference(self):
        loan = self.entry('debt_in', 100)
        repayment = self.entry('debt_out', 20, loan_id=loan.id)
        with self.assertRaises(HTTPException):
            ledger.update_ledger(repayment.id, Ledger(item='还款', amount=20, record_type='debt_out'), self.session)
        self.assertEqual(self.balances(), (80, 80))
        self.assertEqual(self.session.get(Ledger, repayment.id).loan_id, loan.id)

    def test_repayment_name_is_generated_from_loan(self):
        loan = ledger.create_ledger(Ledger(item='房贷', record_type='debt_in', amount=100), self.session)
        repayment = ledger.create_ledger(Ledger(record_type='debt_out', amount=20, loan_id=loan.id), self.session)
        self.assertEqual(repayment.item, '房贷还款')
        second = ledger.create_ledger(Ledger(item='车贷', record_type='debt_in', amount=100), self.session)
        updated = ledger.update_ledger(repayment.id, Ledger(item='不使用单独名称', record_type='debt_out', amount=20, loan_id=second.id), self.session)
        self.assertEqual(updated.item, '车贷还款')

    def test_non_repayment_still_requires_project_name(self):
        for kind in ['income', 'expense', 'debt_in']:
            with self.assertRaises(HTTPException):
                ledger.create_ledger(Ledger(record_type=kind, amount=10), self.session)

    def purchase(self, amount=100, kind='credit_card', source='招商银行信用卡'):
        return ledger.create_financed_purchase(ledger.FinancedPurchase(
            item='买手机', amount=amount, kind=kind, financing_source=source,
            record_date=shanghai_now().date(), category='数码', notes='测试购买',
        ), self.session)

    def test_credit_purchase_at_zero_balance_creates_two_linked_entries(self):
        rows = self.purchase(6000)
        self.assertEqual({row.record_type for row in rows}, {'debt_in', 'expense'})
        self.assertEqual(len({row.purchase_id for row in rows}), 1)
        self.assertTrue(rows[0].purchase_id)
        for row in rows:
            self.assertEqual(row.amount, 6000)
            self.assertEqual(row.financing_source, '招商银行信用卡')
            self.assertEqual(row.purchase_kind, 'credit_card')
            self.assertEqual(row.record_date, shanghai_now().date())
        self.assertEqual(self.balances(), (0, 6000))
        self.assertEqual(ledger.ledger_summary(self.session)['expense'], 6000)
        self.assertEqual(ledger.ledger_summary(self.session)['income'], 0)

    def test_loan_purchase_preserves_existing_cash_and_rounds_both_entries(self):
        self.entry('income', 123.45)
        rows = self.purchase(100.005, kind='loan', source='银行分期')
        self.assertTrue(all(row.amount == 100.01 and row.purchase_kind == 'loan' for row in rows))
        self.assertEqual(self.balances(), (123.45, 100.01))

    def test_financed_purchase_can_be_repaid_only_with_available_cash(self):
        rows = self.purchase(1000)
        loan = next(row for row in rows if row.record_type == 'debt_in')
        self.assertEqual(ledger.list_loans(self.session)[0]['id'], loan.id)
        with self.assertRaises(HTTPException):
            self.entry('debt_out', 100, loan_id=loan.id)
        self.entry('income', 150)
        self.entry('debt_out', 100, 10, loan.id)
        self.assertEqual(self.balances(), (40, 900))
        self.assertEqual(ledger.list_loans(self.session)[0]['remaining'], 900)
        self.assertEqual(ledger.ledger_summary(self.session)['expense'], 1010)

    def test_purchase_edit_updates_both_entries_without_changing_cash(self):
        rows = self.purchase(1000)
        purchase_id = rows[0].purchase_id
        updated = ledger.update_financed_purchase(purchase_id, ledger.FinancedPurchase(
            item='买电脑', amount=2000, kind='loan', financing_source='银行分期',
            record_date=shanghai_now().date(), category='办公', notes='修正项目',
        ), self.session)
        self.assertEqual({row.id for row in updated}, {row.id for row in rows})
        for row in updated:
            self.assertEqual((row.item, row.amount, row.financing_source, row.category), ('买电脑', 2000, '银行分期', '办公'))
        self.assertEqual(self.balances(), (0, 2000))
        self.assertEqual(ledger.ledger_summary(self.session)['expense'], 2000)
        with self.assertRaises(HTTPException):
            ledger.update_ledger(rows[0].id, Ledger(item='单改', amount=20, record_type=rows[0].record_type), self.session)

    def test_delete_either_purchase_entry_removes_entire_pair(self):
        self.entry('income', 10)
        for kind in ['debt_in', 'expense']:
            with self.subTest(kind=kind):
                rows = self.purchase(100)
                target = next(row for row in rows if row.record_type == kind)
                ledger.delete_ledger(target.id, self.session)
                self.assertEqual(self.balances(), (10, 0))
                self.assertEqual(len(ledger.get_ledger(limit=200, offset=0, session=self.session)), 1)
                self.assertEqual(ledger.ledger_summary(self.session)['expense'], 0)

    def test_repaid_purchase_cannot_be_deleted_or_reduced_below_paid_principal(self):
        rows = self.purchase(1000)
        purchase_id = rows[0].purchase_id
        loan = next(row for row in rows if row.record_type == 'debt_in')
        self.entry('income', 1000)
        self.entry('debt_out', 600, loan_id=loan.id)
        for row in rows:
            with self.assertRaises(HTTPException):
                ledger.delete_ledger(row.id, self.session)
        with self.assertRaises(HTTPException):
            ledger.update_financed_purchase(purchase_id, ledger.FinancedPurchase(item='调低', amount=599), self.session)
        self.assertEqual(self.balances(), (400, 400))
        ledger.update_financed_purchase(purchase_id, ledger.FinancedPurchase(item='调低', amount=600), self.session)
        self.assertEqual(self.balances(), (400, 0))
        self.assertEqual(ledger.list_loans(self.session)[0]['remaining'], 0)

    def test_invalid_purchase_creates_neither_entry_nor_debt(self):
        for amount in [0, -1, float('inf')]:
            with self.assertRaises(HTTPException):
                self.purchase(amount)
        with self.assertRaises(HTTPException):
            ledger.create_financed_purchase(ledger.FinancedPurchase(item=' ', amount=100), self.session)
        self.assertEqual(self.balances(), (0, 0))
        self.assertEqual(ledger.get_ledger(limit=200, offset=0, session=self.session), [])

    def test_generic_entry_cannot_forge_purchase_link(self):
        with self.assertRaises(HTTPException):
            ledger.create_ledger(Ledger(item='伪造', amount=100, record_type='debt_in', purchase_id='fake'), self.session)
        income = self.entry('income', 100)
        with self.assertRaises(HTTPException):
            ledger.update_ledger(income.id, Ledger(item='伪造', amount=100, record_type='income', purchase_kind='credit_card'), self.session)
        self.assertEqual(self.balances(), (100, 0))


if __name__ == '__main__':
    unittest.main()
