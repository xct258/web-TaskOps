<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from 'vue'

import { api } from '@/api'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import EmptyState from '@/components/EmptyState.vue'
import Icon from '@/components/Icon.vue'
import ModalShell from '@/components/ModalShell.vue'
import { useToast } from '@/composables/useToast'
import { usePageMenu } from '@/composables/usePageMenu'
import { parseTags, tagColor } from '@/utils/format'

const toast = useToast()
const pageMenu = usePageMenu()
const items = ref([])
const loading = ref(true)
const search = ref('')
const searchOpen = ref(false)
const searchEl = ref(null)
const modalOpen = ref(false)
const movementOpen = ref(false)
const editing = ref(null)
const movementItem = ref(null)
const confirmOpen = ref(false)
const pendingDelete = ref(null)
const saving = ref(false)
const tagInput = ref('')
const form = reactive({ name: '', quantity: 0, unit: '件', location: '', tags: '', note: '' })
const movement = reactive({ quantity_delta: 0, reason: '购买', note: '' })

const inputClass = 'w-full px-3 py-1.5 bg-slate-950 border border-white/10 rounded-xl text-white text-xs placeholder-slate-500 focus:outline-none focus:border-teal-400 transition'

const visible = computed(() => {
  const query = search.value.trim().toLowerCase()
  return items.value.filter((item) => {
    return !query || [item.name, item.location, item.note, ...(item.tags || [])].join(' ').toLowerCase().includes(query)
  })
})

async function load() {
  loading.value = true
  try { items.value = await api.inventory.list() } catch (error) { toast.error(`库存加载失败：${error.message}`) } finally { loading.value = false }
}

function openAdd() {
  editing.value = null
  Object.assign(form, { name: '', quantity: 0, unit: '件', location: '', tags: '', note: '' })
  tagInput.value = ''
  modalOpen.value = true
}

function openEdit(item) {
  editing.value = item
  Object.assign(form, { ...item, tags: (item.tags || []).join(', ') })
  tagInput.value = ''
  modalOpen.value = true
}

function addTag() {
  const tag = tagInput.value.trim()
  if (!tag) return
  const tags = parseTags(form.tags)
  if (!tags.includes(tag)) tags.push(tag)
  form.tags = tags.join(', ')
  tagInput.value = ''
}

function removeTag(tag) {
  form.tags = parseTags(form.tags).filter((item) => item !== tag).join(', ')
}

function onTagKey(event) {
  if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
    event.preventDefault()
    addTag()
  }
  if (event.key === 'Backspace' && !tagInput.value.trim() && parseTags(form.tags).length) {
    const tags = parseTags(form.tags)
    tags.pop()
    form.tags = tags.join(', ')
  }
}

async function save() {
  if (!form.name.trim()) return toast.error('物品名称不能为空')
  const payload = { ...form, name: form.name.trim(), quantity: Number(form.quantity) || 0, tags: parseTags(form.tags) }
  saving.value = true
  try {
    const result = editing.value ? await api.inventory.update(editing.value.id, payload) : await api.inventory.create(payload)
    if (editing.value) items.value = items.value.map((item) => item.id === result.id ? result : item)
    else items.value.unshift(result)
    modalOpen.value = false
    toast.success(editing.value ? '库存已更新' : '库存已添加')
  } catch (error) { toast.error(`保存失败：${error.message}`) } finally { saving.value = false }
}

function openMovement(item) {
  movementItem.value = item
  Object.assign(movement, { quantity_delta: 0, reason: '购买', note: '' })
  movementOpen.value = true
}

async function saveMovement() {
  if (!Number(movement.quantity_delta)) return toast.error('请输入变动数量')
  try {
    const result = await api.inventory.move(movementItem.value.id, { ...movement, quantity_delta: Number(movement.quantity_delta) })
    items.value = items.value.map((item) => item.id === movementItem.value.id ? { ...item, quantity: item.quantity + result.quantity_delta, updated_at: result.created_at } : item)
    movementOpen.value = false
    toast.success('库存变动已记录')
  } catch (error) { toast.error(`记录失败：${error.message}`) }
}

function askDelete(item) { pendingDelete.value = item; confirmOpen.value = true }
async function remove() {
  try { await api.inventory.remove(pendingDelete.value.id); items.value = items.value.filter((item) => item.id !== pendingDelete.value.id); toast.success('物品已删除') } catch (error) { toast.error(`删除失败：${error.message}`) } finally { confirmOpen.value = false; pendingDelete.value = null }
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

function onSearchKeydown(event) {
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return
  if (modalOpen.value || movementOpen.value) return
  if (event.key === '/' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k')) {
    event.preventDefault()
    openSearch()
  }
}

onMounted(() => {
  pageMenu.setMenu([
    { key: 'new', label: '添加物品', action: openAdd },
    { key: 'refresh', label: '刷新', action: load },
  ], '库存')
  load()
  window.addEventListener('keydown', onSearchKeydown)
})
onUnmounted(() => window.removeEventListener('keydown', onSearchKeydown))
</script>

<template>
  <div class="h-full flex flex-col min-h-0">
    <div class="flex-shrink-0 flex flex-wrap items-center gap-2 mb-2">
      <div class="flex items-center gap-1.5 mr-auto"><Icon name="database" :size="15" class="text-teal-400" /><span class="text-sm font-semibold text-slate-100">家庭库存</span><span class="text-[10px] text-slate-500 font-mono">{{ visible.length }}</span></div>
      <button
        class="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-slate-200 transition"
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
          class="w-full px-2.5 py-1 bg-slate-900/60 border border-white/10 focus:border-teal-400 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none transition"
          @keydown.esc="closeSearch"
        />
      </div>
      <button class="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-teal-600/80 hover:bg-teal-600 text-white text-xs font-mono" @click="openAdd"><Icon name="plus" :size="14" /> 添加物品</button>
    </div>
    <div class="flex-1 min-h-0 overflow-y-auto custom-scroll pr-1">
      <div v-if="loading" class="h-full flex items-center justify-center text-slate-500 text-xs">加载中…</div>
      <EmptyState v-else-if="!visible.length" icon="database" title="暂无库存物品" description="添加家庭物品开始管理。" />
      <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5 pb-1">
        <div v-for="item in visible" :key="item.id" class="group rounded-2xl bg-slate-900/55 border border-white/10 hover:border-teal-400/40 p-3 transition">
          <div class="flex items-start gap-2"><div class="flex-1 min-w-0"><span class="text-xs font-semibold text-slate-100 truncate">{{ item.name }}</span><div class="text-xl font-semibold text-teal-300 mt-2">{{ item.quantity }} <span class="text-xs text-slate-400">{{ item.unit }}</span></div></div></div>
          <div v-if="item.location" class="flex items-center gap-2 mt-2 text-[10px] text-slate-500">位置：{{ item.location }}</div>
          <div v-if="item.tags?.length" class="flex gap-1 mt-2 flex-wrap"><span v-for="tag in item.tags" :key="tag" class="text-[9px] px-1.5 py-px rounded-md border" :class="tagColor(tag)">{{ tag }}</span></div>
          <div class="flex justify-end gap-1 mt-3"><button class="px-2 py-1 rounded-lg bg-white/5 text-[10px] text-slate-300 hover:bg-teal-500/15" @click="openMovement(item)">变动</button><button class="p-1 rounded-lg bg-white/5 text-slate-400 hover:text-white" @click="openEdit(item)"><Icon name="edit" :size="12" /></button><button class="p-1 rounded-lg bg-white/5 text-slate-400 hover:text-rose-400" @click="askDelete(item)"><Icon name="trash" :size="12" /></button></div>
        </div>
      </div>
    </div>

    <ModalShell v-model="modalOpen" :title="editing ? '编辑库存' : '添加库存物品'" icon="database" max-width="max-w-md">
      <div class="space-y-2.5 text-xs"><div><label class="block text-slate-400 mb-1">物品名称</label><input v-model="form.name" :class="inputClass" placeholder="例如：螺丝刀" /></div><div class="grid grid-cols-2 gap-2"><div><label class="block text-slate-400 mb-1">数量</label><input v-model="form.quantity" type="number" min="0" step="0.01" :class="inputClass" /></div><div><label class="block text-slate-400 mb-1">单位</label><input v-model="form.unit" :class="inputClass" placeholder="件 / 个 / 套" /></div></div><div><label class="block text-slate-400 mb-1">存放位置</label><input v-model="form.location" :class="inputClass" placeholder="储物柜 / 车库" /></div><div><label class="block text-slate-400 mb-1">标签</label><div class="flex flex-wrap gap-1.5 items-center bg-slate-950 border border-white/10 rounded-xl px-2 py-1.5 focus-within:border-teal-400 transition"><template v-for="tag in parseTags(form.tags)" :key="tag"><span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium border" :class="tagColor(tag)">{{ tag }}<button type="button" class="hover:text-white" @click="removeTag(tag)">×</button></span></template><input v-model="tagInput" class="bg-transparent outline-none text-white text-xs placeholder-slate-500 w-20 flex-1 min-w-[3rem]" placeholder="输入标签后回车" @keydown="onTagKey" /></div></div><div><label class="block text-slate-400 mb-1">备注</label><textarea v-model="form.note" :class="inputClass" rows="2" /></div></div>
      <template #footer><div class="flex justify-end gap-2 text-xs"><button class="px-3 py-1.5 rounded-lg bg-white/5 text-slate-300" @click="modalOpen = false">取消</button><button class="px-4 py-1.5 rounded-lg bg-teal-600 text-white disabled:opacity-50" :disabled="saving" @click="save">保存</button></div></template>
    </ModalShell>
    <ModalShell v-model="movementOpen" title="记录库存变动" icon="activity" max-width="max-w-sm"><div class="space-y-2.5 text-xs"><div class="text-slate-300">{{ movementItem?.name }} · 当前 {{ movementItem?.quantity }} {{ movementItem?.unit }}</div><div><label class="block text-slate-400 mb-1">变动数量（消耗填负数）</label><input v-model="movement.quantity_delta" type="number" step="0.01" :class="inputClass" /></div><div><label class="block text-slate-400 mb-1">原因</label><input v-model="movement.reason" :class="inputClass" placeholder="购买 / 消耗 / 调整" /></div><div><label class="block text-slate-400 mb-1">备注</label><input v-model="movement.note" :class="inputClass" /></div></div><template #footer><div class="flex justify-end gap-2 text-xs"><button class="px-3 py-1.5 rounded-lg bg-white/5 text-slate-300" @click="movementOpen = false">取消</button><button class="px-4 py-1.5 rounded-lg bg-teal-600 text-white" @click="saveMovement">保存变动</button></div></template></ModalShell>
    <ConfirmDialog v-model="confirmOpen" title="删除库存物品" :message="pendingDelete ? `确定删除「${pendingDelete.name}」吗？` : ''" @confirm="remove" />
  </div>
</template>
