// 利息由还款流水统一保存和扣款，列表拆出支出行，避免另存一笔时重复扣款。
export function ledgerRows(items) {
  return items.flatMap((record) => {
    const rows = [{ ...record, displayKey: `entry-${record.id}` }]
    if (record.record_type === 'debt_out' && Number(record.interest) > 0) {
      rows.push({
        ...record,
        displayKey: `interest-${record.id}`,
        item: `${record.item} · 利息`,
        record_type: 'expense',
        amount: record.interest,
        interest: 0,
        category: '借款利息',
        repayment: record,
      })
    }
    return rows
  })
}
