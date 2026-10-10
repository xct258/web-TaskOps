<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from 'vue'

import { api } from '@/api'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import EmptyState from '@/components/EmptyState.vue'
import Icon from '@/components/Icon.vue'
import ModalShell from '@/components/ModalShell.vue'
import { useToast } from '@/composables/useToast'
import { loadSummary } from '@/composables/useSummary'
import { RECORD_TYPE_META, RECORD_TYPE_OPTIONS, formatDate, formatMoney, todayISO } from '@/utils/format'

const toast = useToast()

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
const form = reactive({
  item: '',
  amount: '',
  interest: 0,
  record_type: 'expense',
  record_date: todayISO(),
  category: '',
  notes: '',
})

const confirmOpen = ref(false)
const pendingDelete = ref(null)

// 流水操作菜单：右键 / 长按调起（Teleport 到 body 避免祖先 transform 影响 fixed 定位）。
const ctxMenu = ref(null) // { x, y, record }
let pressTimer = null
let pressFired = false

const totalsOpen = ref(false)
const totalsTarget = ref('asset')
const totalsValue = ref('')

const inputClass =
  'w-full px-3 py-1.5 bg-slate-950 border border-white/10 rounded-xl text-white text-xs placeholder-slate-500 focus:outline-none focus:border-amber-400 transition'

const net = computed(() => (Number(asset.value) || 0) - (Number(liability.value) || 0))

const monthStats = computed(() => {
  const month = todayISO().slice(0, 7)
  let income = 0
  let expense = 0
  items.value.forEach((it) => {
    if (!String(it.record_date).startsWith(month)) return
    if (it.record_type === 'income') income += Number(it.amount) || 0
    if (it.record_type === 'expense') expense += Number(it.amount) || 0
  })
  return { income, expense, balance: income - expense }
})

const visible = computed(() => {
  const q = search.value.trim().toLowerCase()
  return items.value.filter((it) => {
    if (typeFilter.value !== 'all' && it.record_type !== typeFilter.value) return false
    if (!q) return true
    return [it.item, it.category, it.notes].filter(Boolean).some((f) => String(f).toLowerCase().includes(q))
  })
})

async function load() {
  loading.value = true
  try {
    const [list, a, l] = await Promise.all([api.ledger.list(), api.ledger.getAsset(), api.ledger.getLiability()])
    items.value = list
    asset.value = a?.amount ?? 0
    liability.value = l?.amount ?? 0
  } catch (err) {
    toast.error(`账本加载失败：${err.message}`)
  } finally {
    loading.value = false
  }
}

function openAdd() {
  editing.value = null
  Object.assign(form, {
    item: '',
    amount: '',
    interest: 0,
    record_type: 'expense',
    record_date: todayISO(),
    category: '',
    notes: '',
  })
  modalOpen.value = true
}

function openEdit(record) {
  editing.value = record
  Object.assign(form, {
    item: record.item,
    amount: record.amount,
    interest: record.interest || 0,
    record_type: record.record_type,
    record_date: record.record_date,
    category: record.category || '',
    notes: record.notes || '',
  })
  modalOpen.value = true
}

async function save() {
  if (!form.item.trim() || form.amount === '' || Number.isNaN(Number(form.amount))) {
    toast.error('项目与金额为必填项')
    return
  }
  const payload = {
    item: form.item.trim(),
    amount: Number(form.amount),
    interest: Number(form.interest) || 0,
    record_type: form.record_type,
    record_date: form.record_date || todayISO(),
    category: form.category.trim(),
    notes: form.notes.trim(),
  }
  saving.value = true
  try {
    if (editing.value) {
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

function openRecordMenu(record, x, y) {
  const w = 152
  const h = 2 * 34 + 12
  const pad = 8
  ctxMenu.value = {
    record,
    x: Math.max(pad, Math.min(x ?? 0, window.innerWidth - w - pad)),
    y: Math.max(pad, Math.min(y ?? 0, window.innerHeight - h - pad)),
  }
  window.addEventListener('scroll', closeRecordMenu, { capture: true, once: true })
}

function closeRecordMenu() {
  ctxMenu.value = null
  pressFired = false
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
    openRecordMenu(record, touch.clientX, touch.clientY)
  }, 550)
}

function onRecordPressEnd() {
  if (pressTimer) {
    clearTimeout(pressTimer)
    pressTimer = null
  }
}

function ctxEdit() {
  const record = ctxMenu.value?.record
  closeRecordMenu()
  if (record) openEdit(record)
}

function ctxDelete() {
  const record = ctxMenu.value?.record
  closeRecordMenu()
  if (record) askDelete(record)
}

async function doDelete() {
  if (!pendingDelete.value) return
  try {
    await api.ledger.remove(pendingDelete.value.id)
    toast.success('流水已删除，资产已回冲')
    await load()
    loadSummary()
  } catch (err) {
    toast.error(`删除失败：${err.message}`)
  } finally {
    confirmOpen.value = false
    pendingDelete.value = null
  }
}

function openTotals(target) {
  totalsTarget.value = target
  totalsValue.value = target === 'asset' ? asset.value : liability.value
  totalsOpen.value = true
}

async function saveTotals() {
  const value = Number(totalsValue.value)
  if (Number.isNaN(value)) {
    toast.error('请输入合法数字')
    return
  }
  try {
    if (totalsTarget.value === 'asset') {
      asset.value = (await api.ledger.setAsset(value)).amount
      toast.success('资产总额已覆写')
    } else {
      liability.value = (await api.ledger.setLiability(value)).amount
      toast.success('负债总额已覆写')
    }
    totalsOpen.value = false
    loadSummary()
  } catch (err) {
    toast.error(`覆写失败：${err.message}`)
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
  if (e.key === 'Escape' && ctxMenu.value) {
    closeRecordMenu()
    return
  }
  if ((e.key === '/' && !typing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
    e.preventDefault()
    openSearch()
  }
}

onMounted(() => {
  load()
  window.addEventListener('keydown', onSearchKeydown)
})
onUnmounted(() => window.removeEventListener('keydown', onSearchKeydown))
</script>

<template>
  <div class="h-full flex flex-col min-h-0">
    <!-- 资产概览 -->
    <div class="flex-shrink-0 grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-2">
      <button
        class="text-left p-3 rounded-2xl bg-slate-900/55 backdrop-blur-md border border-white/10 hover:border-amber-400/40 transition group"
        @click="openTotals('asset')"
      >
        <div class="flex items-center justify-between">
          <span class="text-[10px] font-mono text-slate-400">资产总额</span>
          <Icon name="edit" :size="12" class="text-slate-600 group-hover:text-amber-300 transition" />
        </div>
        <div class="text-lg font-bold text-white font-mono mt-1">¥ {{ formatMoney(asset) }}</div>
      </button>

      <button
        class="text-left p-3 rounded-2xl bg-slate-900/55 backdrop-blur-md border border-white/10 hover:border-rose-400/40 transition group"
        @click="openTotals('liability')"
      >
        <div class="flex items-center justify-between">
          <span class="text-[10px] font-mono text-slate-400">负债总额</span>
          <Icon name="edit" :size="12" class="text-slate-600 group-hover:text-rose-300 transition" />
        </div>
        <div class="text-lg font-bold text-rose-300 font-mono mt-1">¥ {{ formatMoney(liability) }}</div>
      </button>

      <div class="p-3 rounded-2xl bg-slate-900/55 backdrop-blur-md border border-white/10">
        <span class="text-[10px] font-mono text-slate-400">净资产</span>
        <div class="text-lg font-bold font-mono mt-1" :class="net >= 0 ? 'text-emerald-300' : 'text-rose-300'">
          ¥ {{ formatMoney(net) }}
        </div>
      </div>

      <div class="p-3 rounded-2xl bg-slate-900/55 backdrop-blur-md border border-white/10">
        <span class="text-[10px] font-mono text-slate-400">本月收支</span>
        <div class="text-xs font-mono mt-1.5 space-y-0.5">
          <div class="text-emerald-300">收 +{{ formatMoney(monthStats.income) }}</div>
          <div class="text-rose-300">支 -{{ formatMoney(monthStats.expense) }}</div>
        </div>
      </div>
    </div>

    <!-- 工具条 -->
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
          :key="record.id"
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
              <span v-if="record.notes" class="truncate text-slate-500 selectable">· {{ record.notes }}</span>
            </div>
          </div>

          <div class="text-right shrink-0">
            <div class="text-xs font-bold font-mono" :class="RECORD_TYPE_META[record.record_type]?.color">
              {{ amountText(record) }}
            </div>
            <div v-if="record.record_type === 'debt_out' && record.interest" class="text-[9px] text-slate-500 font-mono">
              利息 {{ formatMoney(record.interest) }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 记一笔 / 编辑 -->
    <ModalShell v-model="modalOpen" :title="editing ? '编辑流水' : '记一笔流水'" icon="wallet" max-width="max-w-md">
      <div class="space-y-2.5 text-xs">
        <div class="grid grid-cols-4 gap-1.5">
          <button
            v-for="opt in RECORD_TYPE_OPTIONS"
            :key="opt.value"
            class="px-2 py-1.5 rounded-xl border text-[11px] font-mono transition"
            :class="
              form.record_type === opt.value
                ? 'bg-amber-600 text-white border-amber-400/40'
                : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10'
            "
            @click="form.record_type = opt.value"
          >
            {{ opt.label }}
          </button>
        </div>

        <div>
          <label class="block text-slate-400 mb-1">项目</label>
          <input v-model="form.item" :class="inputClass" placeholder="例如: 午餐" />
        </div>

        <div class="grid grid-cols-2 gap-2.5">
          <div>
            <label class="block text-slate-400 mb-1">{{ form.record_type === 'debt_out' ? '还款本金' : '金额' }}</label>
            <input v-model="form.amount" type="number" step="0.01" :class="inputClass" placeholder="0.00" />
          </div>
          <div>
            <label class="block text-slate-400 mb-1">日期</label>
            <input v-model="form.record_date" type="date" :class="inputClass" />
          </div>
        </div>

        <div v-if="form.record_type === 'debt_out'">
          <label class="block text-slate-400 mb-1">利息</label>
          <input v-model.number="form.interest" type="number" step="0.01" :class="inputClass" placeholder="0.00" />
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

        <div class="text-[10px] text-slate-500 p-2 rounded-lg bg-white/5 border border-white/10">
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

    <!-- 覆写总额 -->
    <ModalShell
      v-model="totalsOpen"
      :title="totalsTarget === 'asset' ? '覆写资产总额' : '覆写负债总额'"
      icon="edit"
      max-width="max-w-xs"
    >
      <div class="text-xs">
        <label class="block text-slate-400 mb-1">金额（元）</label>
        <input v-model="totalsValue" type="number" step="0.01" :class="inputClass" />
        <p class="text-[10px] text-slate-500 mt-2">直接覆写总额用于对账，不影响已有流水明细。</p>
      </div>
      <template #footer>
        <div class="flex justify-end gap-2 text-xs font-mono">
          <button class="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 transition" @click="totalsOpen = false">
            取消
          </button>
          <button class="px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-medium transition" @click="saveTotals">
            覆写
          </button>
        </div>
      </template>
    </ModalShell>

    <!-- 流水操作菜单：右键 / 长按调起；Teleport 到 body 避免祖先 transform 影响 fixed 定位 -->
    <Teleport to="body">
      <div v-if="ctxMenu" class="fixed inset-0 z-40" @click="closeRecordMenu" @contextmenu.prevent="closeRecordMenu" />
      <div
        v-if="ctxMenu"
        class="fixed z-50 w-[152px] rounded-xl bg-slate-900 border border-white/15 shadow-xl shadow-black/50 p-1 text-xs"
        :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }"
      >
        <button class="w-full text-left px-2.5 py-1.5 rounded-lg text-slate-200 hover:bg-white/10 transition" @click="ctxEdit">
          编辑
        </button>
        <button class="w-full text-left px-2.5 py-1.5 rounded-lg text-rose-400 hover:bg-rose-500/10 transition" @click="ctxDelete">
          删除
        </button>
      </div>
    </Teleport>

    <ConfirmDialog
      v-model="confirmOpen"
      title="删除流水"
      :message="pendingDelete ? `确定删除「${pendingDelete.item}」这笔流水吗？资产/负债会自动回冲。` : ''"
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
