import assert from 'node:assert/strict'
import test from 'node:test'
import { ledgerRows } from '../src/utils/ledgerRows.js'

test('还款利息单独列为支出，保留本金和原还款关联', () => {
  const repayment = { id: 1, item: '房贷还款', record_type: 'debt_out', amount: 1000, interest: 50, loan_id: 9 }
  const rows = ledgerRows([repayment, { id: 2, item: '午餐', record_type: 'expense', amount: 20 }])
  const expenses = rows.filter((row) => row.record_type === 'expense')
  assert.equal(expenses.reduce((sum, row) => sum + Number(row.amount), 0), 70)
  assert.equal(rows[0].amount, 1000)
  assert.equal(expenses[0].repayment, repayment)
  assert.equal(expenses[0].loan_id, 9)
  assert.equal(new Set(rows.map((row) => row.displayKey)).size, rows.length)
  assert.equal(repayment.interest, 50)
})

test('编辑或删除还款后利息行随之更新，无息还款不产生支出行', () => {
  const record = { id: 1, record_type: 'debt_out', amount: 100, interest: 5 }
  assert.equal(ledgerRows([{ ...record, interest: 8 }])[1].amount, 8)
  assert.equal(ledgerRows([{ ...record, interest: 0 }]).length, 1)
  assert.equal(ledgerRows([]).length, 0)
})
