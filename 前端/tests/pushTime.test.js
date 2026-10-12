import assert from 'node:assert/strict'
import test from 'node:test'
import { formatPush, toPushInput, toPushISO } from '../src/utils/pushTime.js'

test('新增、显示和再次编辑保持所选北京时间', () => {
  const selected = '2026-10-12T20:30'
  const submitted = toPushISO(selected)
  assert.equal(submitted, '2026-10-12T20:30:00+08:00')
  assert.equal(toPushInput(submitted), selected)
  assert.equal(formatPush(submitted), '10-12 20:30')
  assert.equal(toPushInput('2026-10-12T20:30:00'), selected)
})

test('UTC 和其他偏移的返回值正确换算为北京时间', () => {
  for (const value of ['2026-10-12T12:30:00Z', '2026-10-12T08:30:00-04:00', '2026-10-12T20:30:00+0800']) {
    assert.equal(toPushInput(value), '2026-10-12T20:30')
    assert.equal(formatPush(value), '10-12 20:30')
  }
})

test('跨日和午夜的时间显示正确', () => {
  assert.equal(toPushInput('2026-12-31T16:00:00Z'), '2027-01-01T00:00')
  assert.equal(formatPush('2026-12-31T16:00:00Z'), '01-01 00:00')
  assert.equal(toPushInput('2026-10-12 20:30:00'), '2026-10-12T20:30')
})

test('空值和无效时间不生成错误排期', () => {
  for (const value of [null, '', 'invalid']) {
    assert.equal(toPushInput(value), '')
    assert.equal(toPushISO(value), '')
    assert.equal(formatPush(value), '')
  }
})
