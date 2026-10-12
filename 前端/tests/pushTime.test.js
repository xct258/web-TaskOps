import assert from 'node:assert/strict'
import test from 'node:test'
import { daysUntil, shiftDate } from '../src/utils/format.js'
import {
  beijingTodayYMD,
  formatPush,
  joinPushInput,
  parsePushInput,
  pushRelative,
  shiftYMD,
  toPushInput,
  toPushISO,
  ymdWeekday,
} from '../src/utils/pushTime.js'

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

test('日期推算与周几和浏览器时区无关', () => {
  assert.equal(shiftYMD('2026-10-12', 0), '2026-10-12')
  assert.equal(shiftYMD('2026-10-12', 1), '2026-10-13')
  assert.equal(shiftYMD('2026-10-13', -1), '2026-10-12')
  assert.equal(shiftYMD('2026-12-31', 1), '2027-01-01')
  assert.equal(ymdWeekday('2026-10-12'), '周一')
  assert.equal(ymdWeekday('2026-10-13'), '周二')
  assert.equal(ymdWeekday('2026-10-18'), '周日')
  assert.equal(ymdWeekday('bad'), '')
  assert.match(beijingTodayYMD(), /^\d{4}-\d{2}-\d{2}$/)
})

test('选择器值解析与拼接往返一致', () => {
  assert.deepEqual(parsePushInput('2026-10-12T20:30'), { date: '2026-10-12', hour: '20', minute: '30' })
  assert.deepEqual(parsePushInput('2026-10-12T20:30:00+08:00'), { date: '2026-10-12', hour: '20', minute: '30' })
  assert.equal(parsePushInput('invalid'), null)
  assert.equal(joinPushInput('2026-10-12', '20', '30'), '2026-10-12T20:30')
  assert.equal(joinPushInput('bad', '20', '30'), '')
})

test('相对时间提示正确', () => {
  // 2026-10-12T12:00:00Z == 北京时间 20:00
  const now = Date.parse('2026-10-12T12:00:00Z')
  assert.equal(pushRelative('2026-10-12T20:30', now), '约30分钟后')
  assert.equal(pushRelative('2026-10-12T22:00', now), '约2小时后')
  assert.equal(pushRelative('2026-10-13T21:30', now), '约1天1小时后')
  assert.equal(pushRelative('2026-10-12T19:00', now), '已过去')
  assert.equal(pushRelative('', now), '')
})

test('待办日期按北京时间和纯日期计算', () => {
  assert.equal(shiftDate('2026-01-01', -1), '2025-12-31')
  assert.equal(shiftDate('2026-02-28', 1), '2026-03-01')
  assert.equal(shiftDate('2026-12-31', 1), '2027-01-01')
  assert.equal(daysUntil('2026-10-12T00:00:00'), daysUntil('2026-10-12'))
})
