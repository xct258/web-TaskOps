<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from 'vue'

import { api } from '@/api'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import EmptyState from '@/components/EmptyState.vue'
import Icon from '@/components/Icon.vue'
import ModalShell from '@/components/ModalShell.vue'
import { useToast } from '@/composables/useToast'
import { loadSummary } from '@/composables/useSummary'
import { useContextMenu } from '@/composables/useContextMenu'
import { usePageMenu } from '@/composables/usePageMenu'
import { RECORD_TYPE_META, RECORD_TYPE_OPTIONS, formatDate, formatMoney, todayISO } from '@/utils/format'
import { ledgerRows } from '@/utils/ledgerRows'

const toast = useToast()
const menu = useContextMenu()
const pageMenu = usePageMenu()

const items = ref([])
const asset = ref(0)
const liability = ref(0)
const loading = ref(true)
const typeFilter = ref('all')
const search = ref('')
const searchOpen = ref(false)
const searchEl = ref(null)

const modalOpen = ref(false)
const editing = ref(null)
const saving = ref(false)
const purchaseKind = ref('cash')
const financingSource = ref('')
const loans = ref([])
const loansLoading = ref(false)
const loansError = ref(false)
const form = reactive({
  item: '',
  amount: '',
  interest: 0,
  agreed_interest: '',
  record_type: 'expense',
  category: '',
  notes: '',
  loan_id: '',
})
const purchaseMode = computed(() => form.record_type === 'expense' && purchaseKind.value !== 'cash')

function selectRecordType(type) {
  form.record_type = type
  if (!editing.value?.purchase_id) purchaseKind.value = 'cash'
}

const confirmOpen = ref(false)
const pendingDelete = ref(null)

// 流水操作菜单：右键 / 长按调起全局菜单。
let pressTimer = null
let pressFired = false

const hasMore = ref(false)
const loadingMore = ref(false)

const inputClass =
  'w-full px-3 py-1.5 bg-slate-950 border border-white/10 rounded-xl text-white text-xs placeholder-slate-500 focus:outline-none focus:border-amber-400 transition'

const net = computed(() => (Number(asset.value) || 0) - (Number(liability.value) || 0))

const monthStats = ref({ income: 0, expense: 0, interest: 0, balance: 0 })
const loanOptions = computed(() => loans.value.map((loan) => {
  const original = editing.value?.record_type === 'debt_out' && editing.value.loan_id === loan.id ? editing.value : null
  const available = (Math.round(loan.remaining * 100) + Math.round(Number(original?.amount || 0) * 100)) / 100
  const interestPaid = (Math.round(loan.interest_paid * 100) - Math.round(Number(original?.interest || 0) * 100)) / 100
  const interestRemaining = loan.agreed_interest == null ? null : Math.max(0, Math.round(loan.agreed_interest * 100) - Math.round(interestPaid * 100)) / 100
  return { ...loan, available, interestPaid, interestRemaining }
}))
const selectedLoan = computed(() => loanOptions.value.find((loan) => loan.id === Number(form.loan_id)))
const loansById = computed(() => new Map(loans.value.map((loan) => [loan.id, loan])))
const availableFunds = computed(() => {
  const record = editing.value
  let oldEffect = 0
  if (record) {
    const principal = Math.round(Number(record.amount) * 100)
    if (['income', 'debt_in'].includes(record.record_type)) oldEffect = principal
    else oldEffect = -principal - (record.record_type === 'debt_out' ? Math.round(Number(record.interest || 0) * 100) : 0)
  }
  return Math.round(Number(asset.value) * 100) - oldEffect
})
const paymentTotal = computed(() => Math.round(Number(form.amount || 0) * 100) + (form.record_type === 'debt_out' ? Math.round(Number(form.interest || 0) * 100) : 0))
const insufficientFunds = computed(() => !purchaseMode.value && ['expense', 'debt_out'].includes(form.record_type) && paymentTotal.value > availableFunds.value)

async function refreshLoans() {
  loansLoading.value = true
  loansError.value = false
  try { loans.value = await api.ledger.loans() }
  catch (err) { loansError.value = true; toast.error(`借款项目加载失败：${err.message}`) }
  finally { loansLoading.value = false }
}

const visible = computed(() => {
  const q = search.value.trim().toLowerCase()
  return ledgerRows(items.value).filter((it) => {
    if (typeFilter.value !== 'all' && it.record_type !== typeFilter.value) return false
    if (!q) return true
    return [it.item, it.category, it.notes].filter(Boolean).some((f) => String(f).toLowerCase().includes(q))
  })
})

async function load() {
  loading.value = true
  try {
    const [list, a, l, stats, loanList] = await Promise.all([api.ledger.list(), api.ledger.getAsset(), api.ledger.getLiability(), api.ledger.summary(), api.ledger.loans()])
    items.value = list
    hasMore.value = list.length === 200
    monthStats.value = stats
    loans.value = loanList
    asset.value = a?.amount ?? 0
    liability.value = l?.amount ?? 0
  } catch (err) {
    toast.error(`账本加载失败：${err.message}`)
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  loadingMore.value = true
  try {
    const list = await api.ledger.list(items.value.length)
    items.value.push(...list)
    hasMore.value = list.length === 200
  } catch (err) { toast.error(`加载失败：${err.message}`) }
  finally { loadingMore.value = false }
}

function openAdd() {
  editing.value = null
  purchaseKind.value = 'cash'
  financingSource.value = ''
  Object.assign(form, {
    item: '',
    amount: '',
    interest: 0,
    agreed_interest: '',
    record_type: 'expense',
    category: '',
    notes: '',
    loan_id: '',
  })
  modalOpen.value = true
  refreshLoans()
}

function openEdit(record) {
  editing.value = record
  purchaseKind.value = record.purchase_kind || 'cash'
  financingSource.value = record.financing_source || ''
  const purchaseLoan = record.purchase_id ? loans.value.find((loan) => loan.purchase_id === record.purchase_id) : null
  Object.assign(form, {
    item: record.item,
    amount: record.amount,
    interest: record.interest || 0,
    agreed_interest: (purchaseLoan ? purchaseLoan.agreed_interest : record.agreed_interest) ?? '',
    record_type: record.purchase_id ? 'expense' : record.record_type,
    category: record.category || '',
    notes: record.notes || '',
    loan_id: record.loan_id || '',
  })
  modalOpen.value = true
  refreshLoans()
}

async function save() {
  if (saving.value) return
  if (form.record_type === 'debt_out') {
    if (loansLoading.value || loansError.value) return toast.error('请等待借款项目加载完成，加载失败时请重新打开表单')
    if (!form.loan_id) return toast.error('请选择要偿还的借款项目')
    if (form.loan_id && (!selectedLoan.value || Math.round(Number(form.amount) * 100) > Math.round(selectedLoan.value.available * 100))) return toast.error('还款本金不能超过所选借款的可还本金')
  }
  const amount = Number(form.amount)
  const actualInterest = form.record_type === 'debt_out' ? Number(form.interest) : 0
  if ((form.record_type !== 'debt_out' && !form.item.trim()) || !Number.isFinite(amount) || !Number.isFinite(actualInterest) || actualInterest < 0 || (form.record_type === 'debt_out' ? amount < 0 || amount + actualInterest <= 0 : amount <= 0)) {
    toast.error(form.record_type === 'debt_out' ? '本金和利息不能为负，实际支付合计须大于零' : '请填写项目和正数金额')
    return
  }
  const agreedInterest = (purchaseMode.value || form.record_type === 'debt_in') && form.agreed_interest !== '' ? Number(form.agreed_interest) : null
  if (agreedInterest !== null && (!Number.isFinite(agreedInterest) || agreedInterest < 0)) return toast.error('约定总利息须为非负金额，未知可留空')
  if (insufficientFunds.value) return toast.error('资金不足，请减少支出或先记录实际借入资金')
  const payload = {
    item: form.record_type === 'debt_out' ? undefined : form.item.trim(),
    amount: Number(form.amount),
    interest: form.record_type === 'debt_out' ? Number(form.interest) || 0 : 0,
    record_type: form.record_type,
    record_date: editing.value ? editing.value.record_date : todayISO(),
    category: form.category.trim(),
    notes: form.notes.trim(),
    loan_id: form.record_type === 'debt_out' && form.loan_id ? Number(form.loan_id) : null,
    agreed_interest: form.record_type === 'debt_in' ? agreedInterest : null,
  }
  saving.value = true
  try {
    if (purchaseMode.value) {
      const purchase = {
        item: form.item.trim(), amount: Number(form.amount), kind: purchaseKind.value,
        financing_source: financingSource.value.trim(), record_date: payload.record_date,
        category: payload.category, notes: payload.notes,
        agreed_interest: agreedInterest,
      }
      if (editing.value) await api.ledger.updatePurchase(editing.value.purchase_id, purchase)
      else await api.ledger.createPurchase(purchase)
      toast.success(editing.value ? '购买及关联借入、支出已更新' : '购买已记录，已生成借入和支出流水')
    } else if (editing.value) {
      await api.ledger.update(editing.value.id, payload)
      toast.success('流水已更新')
    } else {
      await api.ledger.create(payload)
      toast.success('流水已记录')
    }
    modalOpen.value = false
    await load()
    loadSummary()
  } catch (err) {
    toast.error(`保存失败：${err.message}`)
  } finally {
    saving.value = false
  }
}

function askDelete(record) {
  pendingDelete.value = record
  confirmOpen.value = true
}

// ---- 流水操作菜单：右键 / 长按 ----

function openRecordMenu(record, x, y, fromTouch = false) {
  record = record.repayment || record
  menu.open(
    [
      { key: 'edit', label: record.purchase_id ? '编辑整次购买' : '编辑', action: () => openEdit(record) },
      { key: 'delete', label: record.purchase_id ? '删除整次购买' : '删除', danger: true, action: () => askDelete(record) },
    ],
    x,
    y,
    { width: 152, title: record.item, fromTouch },
  )
}

function onRecordCtx(record, e) {
  openRecordMenu(record, e.clientX, e.clientY)
}

function onRecordPressStart(record, e) {
  if (e.touches.length > 1) return
  pressFired = false
  const touch = e.touches[0]
  clearTimeout(pressTimer)
  pressTimer = setTimeout(() => {
    pressTimer = null
    pressFired = true
    try {
      navigator.vibrate?.(30)
    } catch (_) {}
    openRecordMenu(record, touch.clientX, touch.clientY, true)
  }, 550)
}

function onRecordPressEnd() {
  if (pressTimer) {
    clearTimeout(pressTimer)
    pressTimer = null
  }
}

async function doDelete() {
  if (!pendingDelete.value) return
  try {
    await api.ledger.remove(pendingDelete.value.id)
    toast.success(pendingDelete.value.purchase_id ? '购买及关联借入、支出已删除' : '流水已删除，资产已回冲')
    await load()
    loadSummary()
  } catch (err) {
    toast.error(`删除失败：${err.message}`)
  } finally {
    confirmOpen.value = false
    pendingDelete.value = null
  }
}

function amountText(record) {
  const meta = RECORD_TYPE_META[record.record_type] || { sign: '' }
  return `${meta.sign}${formatMoney(record.amount)}`
}

function openSearch() {
  searchOpen.value = true
  nextTick(() => searchEl.value?.focus())
}

function closeSearch() {
  search.value = ''
  searchOpen.value = false
}

function toggleSearch() {
  if (searchOpen.value) closeSearch()
  else openSearch()
}

function onSearchKeydown(e) {
  const tag = document.activeElement?.tagName
  const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(tag)
  if ((e.key === '/' && !typing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
    e.preventDefault()
    openSearch()
  }
}

onMounted(() => {
  pageMenu.setMenu([
    { key: 'new', label: '记一笔', action: openAdd },
    { key: 'refresh', label: '刷新', action: load },
  ], '账本')
  load()
  window.addEventListener('keydown', onSearchKeydown)
})
onUnmounted(() => window.removeEventListener('keydown', onSearchKeydown))
</script>

<template>
  <div class="h-full flex flex-col min-h-0">
    <!-- 资产概览 -->
    <div class="flex-shrink-0 grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-2">
      <div
        class="text-left p-3 rounded-2xl bg-slate-900/55 backdrop-blur-md border border-white/10"
      >
        <div class="flex items-center justify-between">
          <span class="text-[10px] font-mono text-slate-400">资金余额</span>
        </div>
        <div class="text-lg font-bold text-white font-mono mt-1">¥ {{ formatMoney(asset) }}</div>
      </div>

      <div
        class="text-left p-3 rounded-2xl bg-slate-900/55 backdrop-blur-md border border-white/10"
      >
        <div class="flex items-center justify-between">
          <span class="text-[10px] font-mono text-slate-400">负债总额</span>
        </div>
        <div class="text-lg font-bold text-rose-300 font-mono mt-1">¥ {{ formatMoney(liability) }}</div>
      </div>

      <div class="p-3 rounded-2xl bg-slate-900/55 backdrop-blur-md border border-white/10">
        <span class="text-[10px] font-mono text-slate-400" title="资金余额减去负债，不含房产等未记入账本的资产">净资金（余额 − 负债）</span>
        <div class="text-lg font-bold font-mono mt-1" :class="net >= 0 ? 'text-emerald-300' : 'text-rose-300'">
          ¥ {{ formatMoney(net) }}
        </div>
      </div>

      <div class="p-3 rounded-2xl bg-slate-900/55 backdrop-blur-md border border-white/10">
        <span class="text-[10px] font-mono text-slate-400">本月收支</span>
        <div class="text-xs font-mono mt-1.5 space-y-0.5">
          <div class="text-emerald-300">收 +{{ formatMoney(monthStats.income) }}</div>
          <div class="text-rose-300">支 -{{ formatMoney(monthStats.expense) }}</div>
          <div v-if="monthStats.interest" class="text-[10px] text-slate-500">含利息 {{ formatMoney(monthStats.interest) }}</div>
        </div>
      </div>
    </div>

    <!-- 工具条 -->
    <div class="flex-shrink-0 flex items-center justify-between gap-2 mb-2 text-[10px] text-slate-500">
      <span>余额由流水维护，不能直接修改。请记录实际收入、支出、借入和还款。本月收支不含借款和还款本金。</span>
    </div>
    <div class="flex-shrink-0 flex flex-wrap items-center gap-2 mb-2">
      <div class="flex items-center gap-1.5 overflow-x-auto no-scrollbar text-xs font-mono">
        <button
          class="px-2.5 py-1 rounded-xl whitespace-nowrap border transition-all"
          :class="
            typeFilter === 'all'
              ? 'bg-amber-600 text-white font-bold border-amber-400/40'
              : 'bg-white/5 hover:bg-white/10 text-slate-400 border-white/5'
          "
          @click="typeFilter = 'all'"
        >
          全部
        </button>
        <button
          v-for="opt in RECORD_TYPE_OPTIONS"
          :key="opt.value"
          class="px-2.5 py-1 rounded-xl whitespace-nowrap border transition-all"
          :class="
            typeFilter === opt.value
              ? 'bg-amber-600 text-white font-bold border-amber-400/40'
              : 'bg-white/5 hover:bg-white/10 text-slate-400 border-white/5'
          "
          @click="typeFilter = opt.value"
        >
          {{ opt.label }}
        </button>
      </div>

      <button
        class="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-slate-200 transition ml-auto"
        title="搜索（/）"
        @click="toggleSearch"
      >
        <Icon name="search" :size="13" />
      </button>
      <div v-if="searchOpen" class="relative min-w-[100px] max-w-[180px]">
        <input
          ref="searchEl"
          v-model="search"
          type="text"
          placeholder="搜索"
          class="w-full px-2.5 py-1 bg-slate-900/60 border border-white/10 focus:border-amber-400 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none transition"
          @keydown.esc="closeSearch"
        />
      </div>

      <button
        class="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-amber-600/80 hover:bg-amber-600 text-white text-xs font-mono transition border border-amber-400/30"
        @click="openAdd"
      >
        <Icon name="plus" :size="14" />
        <span class="hidden xs:inline">记一笔</span>
      </button>
    </div>

    <!-- 流水列表 -->
    <div class="flex-1 min-h-0 overflow-y-auto custom-scroll pr-1">
      <div v-if="loading" class="h-full min-h-[12rem] flex items-center justify-center text-slate-500 font-mono text-xs">
        正在加载账本…
      </div>

      <EmptyState
        v-else-if="visible.length === 0"
        icon="wallet"
        title="暂无流水记录"
        description="点击「记一笔」开始记账。"
      />

      <div v-else class="space-y-1.5">
        <div
          v-for="record in visible"
          :key="record.displayKey"
          class="group flex items-center gap-3 px-3.5 py-2.5 rounded-2xl bg-slate-900/55 hover:bg-slate-900/80 backdrop-blur-md border border-white/10 transition"
          @contextmenu.prevent="onRecordCtx(record, $event)"
          @touchstart.passive="onRecordPressStart(record, $event)"
          @touchmove="onRecordPressEnd"
          @touchend="onRecordPressEnd"
          @touchcancel="onRecordPressEnd"
        >
          <span
            class="text-[10px] font-mono px-2 py-1 rounded-lg border shrink-0 w-12 text-center"
            :class="RECORD_TYPE_META[record.record_type]?.bg"
          >
            <span :class="RECORD_TYPE_META[record.record_type]?.color">
              {{ RECORD_TYPE_META[record.record_type]?.label }}
            </span>
          </span>

          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-xs font-semibold text-slate-100 truncate">{{ record.item }}</span>
              <span
                v-if="record.category"
                class="text-[9px] font-mono px-1.5 py-px rounded-md bg-white/5 border border-white/10 text-slate-400"
              >
                {{ record.category }}
              </span>
            </div>
            <div class="flex items-center gap-2 text-[10px] text-slate-500 font-mono mt-0.5">
              <span>{{ formatDate(record.record_date) }}</span>
              <span v-if="record.notes" class="text-slate-500 selectable truncate" :title="record.notes">· {{ record.notes }}</span>
            </div>
            <div v-if="record.record_type === 'debt_out'" class="text-[10px] text-amber-300/70 mt-1 truncate">偿还：{{ loansById.get(record.loan_id)?.item }} · #{{ record.loan_id }}</div>
            <div v-if="record.repayment" class="text-[10px] text-amber-300/70 mt-1 truncate">关联还款 #{{ record.repayment.id }} · 编辑或删除将同步处理整笔还款</div>
            <div v-if="record.record_type === 'debt_in' && loansById.has(record.id)" class="text-[10px] text-amber-300/70 mt-1 space-y-0.5">
              <div>未还本金 ¥{{ formatMoney(loansById.get(record.id).remaining) }} · 已付利息 ¥{{ formatMoney(loansById.get(record.id).interest_paid) }}</div>
              <div v-if="loansById.get(record.id).agreed_interest != null">约定总利息 ¥{{ formatMoney(loansById.get(record.id).agreed_interest) }} · 预计未付利息 ¥{{ formatMoney(loansById.get(record.id).expected_interest_remaining) }} · 预计待还合计 ¥{{ formatMoney(loansById.get(record.id).expected_total_due) }}</div>
              <div v-else class="text-slate-500">未填写约定利息，预计待还合计未估算</div>
            </div>
            <div v-if="record.purchase_id" class="text-[10px] text-sky-300/80 mt-1">{{ record.purchase_kind === 'credit_card' ? '信用卡消费' : '贷款购买' }}{{ record.financing_source ? ` · ${record.financing_source}` : '' }} · 借入与支出联动</div>
          </div>

          <div class="text-right shrink-0">
            <div class="text-xs font-bold font-mono" :class="RECORD_TYPE_META[record.record_type]?.color">
              {{ amountText(record) }}
            </div>
            <div v-if="record.record_type === 'debt_out'" class="text-[9px] text-slate-500 font-mono">
              还款本金
            </div>
          </div>
        </div>
      </div>
    </div>

    <button v-if="hasMore" class="shrink-0 py-2 text-xs text-amber-300 disabled:opacity-50" :disabled="loadingMore" @click="loadMore">{{ loadingMore ? '加载中…' : '加载更早流水' }}</button>

    <!-- 记一笔 / 编辑 -->
    <ModalShell v-model="modalOpen" :title="editing ? '编辑流水' : '记一笔流水'" icon="wallet" max-width="max-w-md">
      <div class="space-y-2.5 text-xs">
        <div class="grid grid-cols-4 gap-1.5">
          <button
            v-for="opt in RECORD_TYPE_OPTIONS"
            :key="opt.value"
            class="px-2 py-1.5 rounded-xl border text-[11px] font-mono transition disabled:opacity-40 disabled:cursor-not-allowed"
            :class="
              form.record_type === opt.value
                ? 'bg-amber-600 text-white border-amber-400/40'
                : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10'
            "
            :disabled="Boolean(editing?.purchase_id) && opt.value !== 'expense'"
            @click="selectRecordType(opt.value)"
          >
            {{ opt.label }}
          </button>
        </div>

        <div v-if="form.record_type === 'expense'">
          <label class="block text-slate-400 mb-1" for="expense-payment">支付方式</label>
          <select id="expense-payment" v-model="purchaseKind" :class="inputClass">
            <option value="cash" :disabled="Boolean(editing?.purchase_id)">余额支付</option>
            <option value="loan" :disabled="Boolean(editing && !editing.purchase_id)">贷款购买</option>
            <option value="credit_card" :disabled="Boolean(editing && !editing.purchase_id)">信用卡消费</option>
          </select>
        </div>

        <div v-if="purchaseMode" class="space-y-3 rounded-xl border border-sky-400/20 bg-sky-500/5 p-3">
          <label class="block text-slate-400">{{ purchaseKind === 'credit_card' ? '银行／信用卡（可选）' : '贷款机构（可选）' }}
            <input v-model="financingSource" :class="inputClass" class="mt-1" :placeholder="purchaseKind === 'credit_card' ? '例如：招商银行信用卡' : '例如：银行手机分期'" />
          </label>
          <p class="text-[11px] text-sky-200/80">资金余额不变，负债增加购买金额。约定利息只作预估，实际利息在支付时记支出。</p>
        </div>

        <div v-if="purchaseMode || form.record_type !== 'debt_out'">
          <label class="block text-slate-400 mb-1">{{ purchaseMode ? '购买项目' : '项目' }}</label>
          <input v-model="form.item" :class="inputClass" :placeholder="purchaseMode ? '例如：手机分期、超市购物' : '例如：午餐'" />
        </div>

        <div v-if="!purchaseMode && form.record_type === 'debt_out'" class="rounded-xl border border-amber-400/20 bg-amber-500/5 p-3 space-y-2">
          <label class="block text-slate-300" for="repayment-loan">偿还的借款项目</label>
          <select id="repayment-loan" v-model="form.loan_id" :class="inputClass" :disabled="loansLoading || loansError">
            <option value="">请选择借款项目</option>
            <option v-for="loan in loanOptions" :key="loan.id" :value="loan.id">{{ loan.item }}{{ loan.financing_source ? ` · ${loan.financing_source}` : '' }} · {{ loan.record_date }} · #{{ loan.id }} · 可还 ¥{{ formatMoney(loan.available) }}</option>
          </select>
          <p v-if="loansLoading" class="text-[10px] text-slate-500">正在加载借款项目…</p>
          <p v-else-if="loansError" class="text-[10px] text-rose-300">加载失败，请重新打开表单。</p>
          <div v-else-if="selectedLoan" class="text-[10px] text-amber-200 space-y-1">
            <p>借入 ¥{{ formatMoney(selectedLoan.amount) }} · 本次可还本金 ¥{{ formatMoney(selectedLoan.available) }} · 此前已付利息 ¥{{ formatMoney(selectedLoan.interestPaid) }}</p>
            <p v-if="selectedLoan.interestRemaining != null">约定总利息 ¥{{ formatMoney(selectedLoan.agreed_interest) }} · 预计未付利息 ¥{{ formatMoney(selectedLoan.interestRemaining) }} · 预计待还合计 ¥{{ formatMoney((Math.round(selectedLoan.available * 100) + Math.round(selectedLoan.interestRemaining * 100)) / 100) }}</p>
            <p v-else class="text-slate-500">未约定总利息，请按实际账单填写本次利息。</p>
          </div>
          <p v-else-if="!loanOptions.length" class="text-[10px] text-slate-400">暂无借款，请先记录借入项目。</p>
        </div>

        <div>
          <label class="block text-slate-400 mb-1">{{ form.record_type === 'debt_out' ? '还款本金' : '金额' }}</label>
          <input v-model="form.amount" type="number" step="0.01" :class="inputClass" placeholder="0.00" />
        </div>

        <div v-if="purchaseMode || form.record_type === 'debt_in'">
          <label class="block text-slate-400 mb-1">约定总利息（可选）</label>
          <input v-model="form.agreed_interest" type="number" min="0" step="0.01" :class="inputClass" placeholder="未知留空，无息填 0" />
          <p class="text-[10px] text-slate-500 mt-1">填写整笔借款的预计总利息，仅用于预估，不立即计入支出或负债本金。</p>
        </div>

        <div v-if="!purchaseMode && form.record_type === 'debt_out'">
          <label class="block text-slate-400 mb-1">本次实际支付利息</label>
          <input v-model.number="form.interest" type="number" min="0" step="0.01" :class="inputClass" placeholder="0.00" />
          <button v-if="selectedLoan?.interestRemaining > 0" class="mt-1 text-[10px] text-amber-300 hover:text-amber-200" @click="form.interest = selectedLoan.interestRemaining">填入预计剩余全部利息 ¥{{ formatMoney(selectedLoan.interestRemaining) }}</button>
          <p class="text-[10px] text-slate-500 mt-1">按本次实际支付填写，可与约定不同；只付利息时本金填 0。</p>
        </div>

        <div v-if="!purchaseMode && ['expense', 'debt_out'].includes(form.record_type)" class="rounded-xl border p-2.5 text-[11px]" :class="insufficientFunds ? 'border-rose-400/30 bg-rose-500/10 text-rose-300' : 'border-white/10 bg-white/5 text-slate-400'">
          本次可用 ¥{{ formatMoney(availableFunds / 100) }} · {{ form.record_type === 'debt_out' ? '本金及利息合计' : '本次支出' }} ¥{{ formatMoney(paymentTotal / 100) }}
          <p v-if="insufficientFunds" class="mt-1">资金不足，还差 ¥{{ formatMoney((paymentTotal - availableFunds) / 100) }}，无法保存。</p>
        </div>

        <div class="grid grid-cols-2 gap-2.5">
          <div>
            <label class="block text-slate-400 mb-1">分类</label>
            <input v-model="form.category" :class="inputClass" placeholder="餐饮 / 工资" />
          </div>
          <div>
            <label class="block text-slate-400 mb-1">备注</label>
            <input v-model="form.notes" :class="inputClass" placeholder="可选" />
          </div>
        </div>

        <div v-if="!purchaseMode" class="text-[10px] text-slate-500 p-2 rounded-lg bg-white/5 border border-white/10">
          {{
            form.record_type === 'income'
              ? '收入：资产增加'
              : form.record_type === 'expense'
                ? '支出：资产减少'
                : form.record_type === 'debt_in'
                  ? '借入：资产与负债同时增加'
                  : '还款：资产减少（本金+利息），负债减少本金'
          }}
        </div>
      </div>

      <template #footer>
        <div class="flex justify-end gap-2 text-xs font-mono">
          <button class="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 transition" @click="modalOpen = false">
            取消
          </button>
          <button
            class="px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-60 text-white font-medium transition"
            :disabled="saving"
            @click="save"
          >
            {{ saving ? '保存中…' : editing ? '保存修改' : '记录' }}
          </button>
        </div>
      </template>
    </ModalShell>

    <!-- 流水操作菜单由全局 ContextMenu 统一渲染（右键 / 长按） -->

    <ConfirmDialog
      v-model="confirmOpen"
      title="删除流水"
      :message="pendingDelete ? (pendingDelete.purchase_id ? `确定删除「${pendingDelete.item}」整次购买吗？关联的借入和支出将一起删除并回冲。` : `确定删除「${pendingDelete.item}」这笔流水吗？资产/负债会自动回冲。`) : ''"
      @confirm="doDelete"
    />
  </div>
</template>

<style>
input[type="number"]::-webkit-outer-spin-button,
input[type="number"]::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
input[type="number"] {
  -moz-appearance: textfield;
}
</style>
