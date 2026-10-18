<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from 'vue'

import { api } from '@/api'
import EmptyState from '@/components/EmptyState.vue'
import Icon from '@/components/Icon.vue'
import ModalShell from '@/components/ModalShell.vue'
import { useToast } from '@/composables/useToast'
import { loadSummary } from '@/composables/useSummary'
import { usePageMenu } from '@/composables/usePageMenu'
import { formatDateTime, relativeTime } from '@/utils/format'

const toast = useToast()
const pageMenu = usePageMenu()

const items = ref([])
const loading = ref(true)
const search = ref('')
const onlyDown = ref(false)
const searchOpen = ref(false)
const searchEl = ref(null)

const modalOpen = ref(false)
const saving = ref(false)
const form = reactive({ server_name: '', service_name: '', content: '', is_success: true, extra: '' })

const inputClass =
  'w-full px-3 py-1.5 bg-slate-950 border border-white/10 rounded-xl text-white text-xs placeholder-slate-500 focus:outline-none focus:border-emerald-400 transition'

const grouped = computed(() => {
  const map = new Map()
  items.value.forEach((s) => {
    if (!map.has(s.server_name)) map.set(s.server_name, [])
    map.get(s.server_name).push(s)
  })
  return [...map.entries()].map(([name, services]) => {
    const up = services.filter((s) => s.is_success).length
    const sorted = [...services].sort((a, b) => Number(a.is_success) - Number(b.is_success) || a.service_name.localeCompare(b.service_name))
    const latest = services.reduce((acc, s) => (!acc || s.received_at > acc ? s.received_at : acc), null)
    return { name, services: sorted, up, total: services.length, rate: Math.round((up / services.length) * 100), latest }
  })
})

const visible = computed(() => {
  const q = search.value.trim().toLowerCase()
  return grouped.value
    .map((server) => {
      let services = server.services
      if (onlyDown.value) services = services.filter((s) => !s.is_success)
      if (q) {
        services = services.filter((s) =>
          [s.service_name, s.content, server.name].filter(Boolean).some((f) => String(f).toLowerCase().includes(q)),
        )
      }
      return { ...server, services }
    })
    .filter((server) => server.services.length > 0)
    .sort((a, b) => a.up / a.total - b.up / b.total || a.name.localeCompare(b.name))
})

const summaryStats = computed(() => {
  const total = items.value.length
  const up = items.value.filter((s) => s.is_success).length
  return { total, up, down: total - up, servers: grouped.value.length }
})

function extraEntries(extra) {
  if (!extra || typeof extra !== 'object') return []
  return Object.entries(extra).map(([key, value]) => ({
    key,
    value: value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value),
  }))
}

function rateClass(rate) {
  if (rate >= 99) return 'text-emerald-400'
  if (rate >= 60) return 'text-amber-300'
  return 'text-rose-400'
}

async function load(silent = false) {
  if (!silent) loading.value = true
  try {
    items.value = await api.server.list()
  } catch (err) {
    if (!silent) toast.error(`服务状态加载失败：${err.message}`)
  } finally {
    loading.value = false
  }
}

function openReport() {
  Object.assign(form, { server_name: '', service_name: '', content: '', is_success: true, extra: '' })
  modalOpen.value = true
}

async function submitReport() {
  if (!form.server_name.trim() || !form.service_name.trim() || !form.content.trim()) {
    toast.error('服务器 / 服务 / 内容均为必填')
    return
  }
  saving.value = true
  try {
    let extra = {}
    if (form.extra.trim()) {
      try {
        extra = JSON.parse(form.extra)
      } catch {
        toast.error('扩展字段不是合法 JSON')
        saving.value = false
        return
      }
    }
    await api.server.report({
      server_name: form.server_name.trim(),
      service_name: form.service_name.trim(),
      content: form.content.trim(),
      is_success: form.is_success,
      ...extra,
    })
    toast.success('状态已上报')
    modalOpen.value = false
    await load(true)
    loadSummary()
  } catch (err) {
    toast.error(`上报失败：${err.message}`)
  } finally {
    saving.value = false
  }
}

let timer = null
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
    { key: 'report', label: '上报状态', action: openReport },
    { key: 'refresh', label: '刷新', action: () => load() },
  ], '服务')
  load()
  timer = setInterval(() => load(true), 30000)
  window.addEventListener('keydown', onSearchKeydown)
})
onUnmounted(() => {
  if (timer) clearInterval(timer)
  window.removeEventListener('keydown', onSearchKeydown)
})
</script>

<template>
  <div class="h-full flex flex-col min-h-0">
    <!-- 工具条 -->
    <div class="flex-shrink-0 flex flex-wrap items-center gap-2 mb-2">
      <div class="flex items-center gap-2 font-mono text-[11px]">
        <span class="flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-400/20 text-emerald-300">
          <Icon name="activity" :size="12" /> {{ summaryStats.up }} 正常
        </span>
        <span
          class="flex items-center gap-1 px-2 py-1 rounded-lg border"
          :class="summaryStats.down ? 'bg-rose-500/10 border-rose-400/20 text-rose-300' : 'bg-white/5 border-white/10 text-slate-500'"
        >
          <Icon name="alert" :size="12" /> {{ summaryStats.down }} 异常
        </span>
        <span class="hidden sm:inline text-slate-500">{{ summaryStats.servers }} 台主机</span>
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
          class="w-full px-2.5 py-1 bg-slate-900/60 border border-white/10 focus:border-emerald-400 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none transition"
          @keydown.esc="closeSearch"
        />
      </div>

      <button
        class="px-2.5 py-1.5 rounded-xl text-xs font-mono border transition"
        :class="onlyDown ? 'bg-rose-600/80 text-white border-rose-400/30' : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'"
        @click="onlyDown = !onlyDown"
      >
        仅异常
      </button>

      <button
        class="p-1.5 rounded-xl bg-slate-900/60 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white transition"
        title="刷新"
        @click="load()"
      >
        <Icon name="refresh" :size="15" :class="{ 'animate-spin': loading }" />
      </button>

      <button
        class="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-emerald-600/80 hover:bg-emerald-600 text-white text-xs font-mono transition border border-emerald-400/30"
        @click="openReport"
      >
        <Icon name="plus" :size="14" />
        <span class="hidden xs:inline">手动上报</span>
      </button>
    </div>

    <!-- 列表 -->
    <div class="flex-1 min-h-0 overflow-y-auto custom-scroll pr-1">
      <div v-if="loading" class="h-full min-h-[12rem] flex items-center justify-center text-slate-500 font-mono text-xs">
        正在加载服务状态…
      </div>

      <EmptyState
        v-else-if="visible.length === 0"
        icon="server"
        title="暂无服务状态"
        description="探针 POST /api/server/status 上报后会出现在这里。"
      />

      <div v-else class="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
        <div
          v-for="server in visible"
          :key="server.name"
          class="rounded-2xl bg-slate-900/55 border border-white/10 overflow-hidden"
        >
          <!-- 主机头 -->
          <div class="flex items-center justify-between gap-3 px-3.5 py-2.5 border-b border-white/10">
            <div class="flex items-center gap-2 min-w-0">
              <span
                class="h-2 w-2 rounded-full shrink-0"
                :class="server.up === server.total ? 'bg-emerald-400' : server.up === 0 ? 'bg-rose-400' : 'bg-amber-400'"
              />
              <span class="text-xs font-semibold text-slate-100 font-mono truncate">{{ server.name }}</span>
              <span class="text-[10px] text-slate-500 font-mono">{{ server.up }}/{{ server.total }}</span>
            </div>
            <div class="flex items-center gap-2 font-mono text-[10px]">
              <span :class="rateClass(server.rate)">{{ server.rate }}%</span>
              <span v-if="server.latest" class="text-slate-600">{{ relativeTime(server.latest) }}</span>
            </div>
          </div>

          <!-- 服务列表 -->
          <ul class="divide-y divide-white/5">
            <li v-for="service in server.services" :key="service.id" class="px-3.5 py-2.5">
              <div class="flex items-start gap-2.5">
                <Icon
                  :name="service.is_success ? 'checkCircle' : 'alert'"
                  :size="15"
                  class="mt-0.5 shrink-0"
                  :class="service.is_success ? 'text-emerald-400' : 'text-rose-400'"
                />
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="text-xs font-semibold text-slate-200 font-mono">{{ service.service_name }}</span>
                    <span class="text-[10px] text-slate-500 font-mono">{{ formatDateTime(service.received_at) }}</span>
                  </div>
                  <p class="text-[11px] text-slate-400 mt-0.5 selectable">{{ service.content }}</p>
                  <div v-if="extraEntries(service.extra).length" class="flex items-center gap-1.5 flex-wrap mt-1.5">
                    <span
                      v-for="entry in extraEntries(service.extra)"
                      :key="entry.key"
                      class="text-[9px] font-mono px-1.5 py-px rounded-md bg-white/5 border border-white/10 text-slate-400"
                    >
                      <span class="text-slate-500">{{ entry.key }}=</span>{{ entry.value }}
                    </span>
                  </div>
                </div>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </div>

    <!-- 手动上报 -->
    <ModalShell v-model="modalOpen" title="手动上报服务状态" icon="server" max-width="max-w-sm">
      <div class="space-y-2.5 text-xs">
        <div class="grid grid-cols-2 gap-2.5">
          <div>
            <label class="block text-slate-400 mb-1">服务器名</label>
            <input v-model="form.server_name" :class="inputClass" placeholder="openwrt" />
          </div>
          <div>
            <label class="block text-slate-400 mb-1">服务名</label>
            <input v-model="form.service_name" :class="inputClass" placeholder="wan" />
          </div>
        </div>
        <div>
          <label class="block text-slate-400 mb-1">状态内容</label>
          <input v-model="form.content" :class="inputClass" placeholder="光纤在线，延迟 3ms" />
        </div>
        <div class="flex items-center justify-between p-2.5 rounded-xl bg-white/5 border border-white/10">
          <div class="text-slate-200">是否正常</div>
          <button
            class="relative w-9 h-5 rounded-full transition"
            :class="form.is_success ? 'bg-emerald-500' : 'bg-rose-500'"
            @click="form.is_success = !form.is_success"
          >
            <span
              class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform"
              :class="form.is_success ? 'translate-x-4' : ''"
            />
          </button>
        </div>
        <div>
          <label class="block text-slate-400 mb-1">扩展字段 JSON（可选）</label>
          <textarea
            v-model="form.extra"
            :class="inputClass"
            rows="2"
            placeholder='{"latency": 3, "cpu": "12%"}'
          />
        </div>
        <p class="text-[10px] text-slate-500">同一 (服务器, 服务) 会被覆盖更新，符合探针上报语义。</p>
      </div>
      <template #footer>
        <div class="flex justify-end gap-2 text-xs font-mono">
          <button class="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 transition" @click="modalOpen = false">
            取消
          </button>
          <button
            class="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-medium transition"
            :disabled="saving"
            @click="submitReport"
          >
            {{ saving ? '上报中…' : '上报' }}
          </button>
        </div>
      </template>
    </ModalShell>
  </div>
</template>
