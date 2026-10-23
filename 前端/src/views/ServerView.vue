<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import { api } from '@/api'
import EmptyState from '@/components/EmptyState.vue'
import Icon from '@/components/Icon.vue'
import ModalShell from '@/components/ModalShell.vue'
import { useToast } from '@/composables/useToast'
import { usePageMenu } from '@/composables/usePageMenu'
import { loadSummary } from '@/composables/useSummary'
import { formatDateTime, relativeTime } from '@/utils/format'
import { renderMarkdown } from '@/utils/markdown'

const toast = useToast()
const pageMenu = usePageMenu()

const SEVERITY_META = {
  error: {
    label: '异常',
    icon: 'alert',
    iconClass: 'text-rose-400',
    dot: 'bg-rose-400',
    border: 'border-rose-400/30',
    bg: 'bg-rose-500/[0.06]',
    chip: 'bg-rose-500/15 text-rose-200 border-rose-400/30',
  },
  warn: {
    label: '警告',
    icon: 'warning',
    iconClass: 'text-amber-400',
    dot: 'bg-amber-400',
    border: 'border-amber-400/25',
    bg: 'bg-amber-500/[0.04]',
    chip: 'bg-amber-500/15 text-amber-200 border-amber-400/30',
  },
  ok: {
    label: '正常',
    icon: 'checkCircle',
    iconClass: 'text-emerald-400',
    dot: 'bg-emerald-400',
    border: 'border-white/10',
    bg: 'bg-slate-900/55',
    chip: 'bg-emerald-500/10 text-emerald-200 border-emerald-400/25',
  },
  info: {
    label: '信息',
    icon: 'info',
    iconClass: 'text-sky-400',
    dot: 'bg-sky-400',
    border: 'border-sky-400/20',
    bg: 'bg-sky-500/[0.04]',
    chip: 'bg-sky-500/10 text-sky-200 border-sky-400/25',
  },
}

const SEVERITY_RANK = { error: 0, warn: 1, ok: 2, info: 3 }

function meta(severity) {
  return SEVERITY_META[severity] || SEVERITY_META.ok
}

const servers = ref([])
const recordsTotal = ref(0)
const lastFetched = ref('')
const loading = ref(true)
const search = ref('')
const searchOpen = ref(false)
const searchEl = ref(null)
const filter = ref('all') // all | error | warn | ok
const helpOpen = ref(false)
const detailOpen = ref(false)
const selectedName = ref('')
const activeProject = ref('')
const activeService = ref('')
const contentPage = ref(1)
const contentTop = ref(null)
const mobilePickerOpen = ref(false)
const mobileServiceTop = ref(null)
const recordBusy = ref('')
const RECORDS_PER_PAGE = 5

const selectedServer = computed(
  () => servers.value.find((server) => server.server_name === selectedName.value) || null,
)

const groupedRecords = computed(() => {
  const projects = new Map()

  for (const record of selectedServer.value?.records || []) {
    // 按去掉 server/ 前缀后的项目名归组，避免 server/foo 和 foo 被拆成两个项目。
    const topic = record.topic ? displayTopic(record.topic) : '未命名项目'
    const title = record.title || '（无标题）'

    if (!projects.has(topic)) {
      projects.set(topic, { topic, name: topic, scripts: new Map() })
    }
    const project = projects.get(topic)

    if (!project.scripts.has(title)) {
      project.scripts.set(title, {
        key: `${topic}\u0000${title}`,
        title,
        records: [],
      })
    }
    project.scripts.get(title).records.push(record)
  }

  return Array.from(projects.values())
    .map((project) => {
      const scripts = Array.from(project.scripts.values())
        .map((script) => {
          script.records.sort(compareRecordsDesc)
          const latestActive = script.records.find((record) => !record.acked)
          const latest = latestActive || script.records[0]
          return {
            ...script,
            count: script.records.length,
            latest,
            latestActive,
            severity: latestActive?.severity || 'ok',
          }
        })
        .sort((a, b) => {
          const bySeverity = severityRank(a.severity) - severityRank(b.severity)
          if (bySeverity) return bySeverity
          return compareRecordsDesc(a.latestActive || a.latest, b.latestActive || b.latest)
        })

      const severity =
        scripts.reduce(
          (worst, script) =>
            !worst || severityRank(script.severity) < severityRank(worst)
              ? script.severity
              : worst,
          null,
        ) || 'ok'
      const latestActive = scripts.reduce((newest, script) => {
        const candidate = script.latestActive
        if (!candidate) return newest
        return String(candidate.created_at || '') > String(newest?.created_at || '') ? candidate : newest
      }, null)
      const latest = latestActive || scripts[0]?.latest || null

      return {
        topic: project.topic,
        name: project.name,
        scripts,
        severity,
        latest,
        count: scripts.reduce((sum, script) => sum + script.count, 0),
      }
    })
    .sort((a, b) => {
      const bySeverity = severityRank(a.severity) - severityRank(b.severity)
      if (bySeverity) return bySeverity
      return compareRecordsDesc(a.latest, b.latest)
    })
})

const serviceTotal = computed(() =>
  groupedRecords.value.reduce((sum, project) => sum + project.scripts.length, 0),
)

const activeProjectGroup = computed(
  () => groupedRecords.value.find((project) => project.topic === activeProject.value) || null,
)

const serviceOptions = computed(() => {
  const projects = activeProject.value
    ? groupedRecords.value.filter((project) => project.topic === activeProject.value)
    : groupedRecords.value

  return projects.flatMap((project) =>
    project.scripts.map((script) => ({
      ...script,
      projectName: project.name,
      projectTopic: project.topic,
    })),
  )
})

const activeServiceOption = computed(
  () => serviceOptions.value.find((service) => service.key === activeService.value) || null,
)

const contentRecords = computed(() => {
  const records = selectedServer.value?.records || []
  const project = activeProject.value
  const serviceKey = activeService.value

  return records
    .filter((record) => {
      const topic = record.topic ? displayTopic(record.topic) : '未命名项目'
      if (project && topic !== project) return false
      if (serviceKey) {
        const title = record.title || '（无标题）'
        if (`${topic}\u0000${title}` !== serviceKey) return false
      }
      return true
    })
    .sort(compareRecordsDesc)
})

const contentTitle = computed(() => {
  if (activeServiceOption.value) return activeServiceOption.value.title
  if (activeProjectGroup.value) return `${activeProjectGroup.value.name} · 全部服务`
  return '全部记录'
})

const contentScope = computed(() => {
  const project =
    activeProjectGroup.value?.name || activeServiceOption.value?.projectName || '全部项目'
  const service = activeServiceOption.value?.title || '全部服务'
  return `${project} / ${service}`
})

const pickerButtonLabel = computed(() => {
  if (activeServiceOption.value) return activeServiceOption.value.title
  if (activeProjectGroup.value) return activeProjectGroup.value.name
  return '全部项目'
})

const contentSeverity = computed(() => {
  if (activeServiceOption.value) return activeServiceOption.value.severity
  if (activeProjectGroup.value) return activeProjectGroup.value.severity
  return selectedServer.value?.severity || 'ok'
})

const contentLatest = computed(() => {
  if (activeServiceOption.value) return activeServiceOption.value.latest
  if (activeProjectGroup.value) return activeProjectGroup.value.latest
  return selectedServer.value?.latest || null
})

const contentPageCount = computed(() =>
  Math.max(1, Math.ceil(contentRecords.value.length / RECORDS_PER_PAGE)),
)

const currentContentPage = computed(() =>
  Math.min(Math.max(1, contentPage.value), contentPageCount.value),
)

const pagedContentRecords = computed(() => {
  const start = (currentContentPage.value - 1) * RECORDS_PER_PAGE
  return contentRecords.value.slice(start, start + RECORDS_PER_PAGE)
})

const contentPageNumbers = computed(() => {
  const pages = contentPageCount.value
  const current = currentContentPage.value
  const start = Math.max(1, Math.min(current - 2, pages - 4))
  const end = Math.min(pages, start + 4)
  return Array.from({ length: end - start + 1 }, (_, index) => start + index)
})

function severityRank(severity) {
  return SEVERITY_RANK[severity] ?? 9
}

function compareRecordsDesc(a, b) {
  const byTime = String(b?.created_at || '').localeCompare(String(a?.created_at || ''))
  if (byTime) return byTime
  return Number(b?.id || 0) - Number(a?.id || 0)
}

function scrollContentTop() {
  nextTick(() => {
    contentTop.value?.scrollTo({ top: 0, behavior: 'smooth' })
  })
}

function selectProject(topic) {
  activeProject.value = topic
  activeService.value = ''
  contentPage.value = 1
  scrollContentTop()
}

function selectService(key) {
  activeService.value = key
  contentPage.value = 1
  scrollContentTop()
}

function selectProjectFromPicker(topic) {
  selectProject(topic)
  nextTick(() => mobileServiceTop.value?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
}

function selectServiceFromPicker(key) {
  selectService(key)
  mobilePickerOpen.value = false
}

function goContentPage(page) {
  const target = Math.min(Math.max(1, page), contentPageCount.value)
  if (target === currentContentPage.value) return
  contentPage.value = target
  scrollContentTop()
}

function recordContext(record) {
  if (activeService.value) return ''
  const title = record.title || '（无标题）'
  if (activeProject.value) return title
  const project = record.topic ? displayTopic(record.topic) : '未命名项目'
  return `${project} / ${title}`
}

function openDetail(server) {
  selectedName.value = server.server_name
  activeProject.value = ''
  activeService.value = ''
  contentPage.value = 1
  mobilePickerOpen.value = false
  detailOpen.value = true
}

watch(selectedServer, (server) => {
  if (!server) detailOpen.value = false
})

watch(detailOpen, (open) => {
  if (!open) mobilePickerOpen.value = false
})

watch(groupedRecords, (projects) => {
  if (activeProject.value && !projects.some((project) => project.topic === activeProject.value)) {
    activeProject.value = ''
    activeService.value = ''
  }
  if (activeService.value && !serviceOptions.value.some((service) => service.key === activeService.value)) {
    activeService.value = ''
  }
})

watch(contentPageCount, (pages) => {
  if (contentPage.value > pages) contentPage.value = pages
})

const stats = computed(() => {
  const counts = { error: 0, warn: 0, ok: 0, info: 0 }
  servers.value.forEach((server) => {
    counts[server.severity] = (counts[server.severity] || 0) + 1
  })
  return { total: servers.value.length, ...counts, normal: counts.ok + counts.info }
})

const chips = computed(() => [
  {
    value: 'all',
    label: '全部',
    count: stats.value.total,
    dot: 'bg-slate-400',
    base: 'text-slate-300 border-white/10 bg-white/5 hover:bg-white/10',
    active: 'text-white border-white/25 bg-white/15',
  },
  {
    value: 'error',
    label: '异常',
    count: stats.value.error,
    dot: 'bg-rose-400',
    base: 'text-slate-400 border-white/10 bg-white/5 hover:bg-white/10',
    active: 'text-rose-200 border-rose-400/40 bg-rose-500/15',
  },
  {
    value: 'warn',
    label: '警告',
    count: stats.value.warn,
    dot: 'bg-amber-400',
    base: 'text-slate-400 border-white/10 bg-white/5 hover:bg-white/10',
    active: 'text-amber-200 border-amber-400/40 bg-amber-500/15',
  },
  {
    value: 'normal',
    label: '正常',
    count: stats.value.normal,
    dot: 'bg-emerald-400',
    base: 'text-slate-400 border-white/10 bg-white/5 hover:bg-white/10',
    active: 'text-emerald-200 border-emerald-400/40 bg-emerald-500/15',
  },
])

function matchFilter(server, value) {
  if (value === 'all') return true
  if (value === 'normal') return server.severity === 'ok' || server.severity === 'info'
  return server.severity === value
}

const visible = computed(() => {
  const keyword = search.value.trim().toLowerCase()

  const rows = servers.value.filter((server) => {
    if (!matchFilter(server, filter.value)) return false
    if (!keyword) return true
    return [server.server_name, server.topic, ...(server.records || []).map((record) => record.message)]
      .filter(Boolean)
      .some((field) => String(field).toLowerCase().includes(keyword))
  })

  // 异常 → 警告 → 正常；同级别内按最新上报时间倒序。
  return rows.sort((a, b) => {
    const rank = (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9)
    if (rank) return rank
    return String(b.latest?.created_at || '').localeCompare(String(a.latest?.created_at || ''))
  })
})

function preview(message) {
  const text = String(message || '')
    .split('\n')
    .filter((line) => !/^#{1,6}\s/.test(line) && !/^\d{4}-\d{2}-\d{2}/.test(line.trim()))
    .join(' ')
    .replace(/[*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > 72 ? `${text.slice(0, 72)}…` : text || '（无正文）'
}

function displayTopic(topic) {
  return String(topic || '').replace(/^server\//i, '') || '—'
}

async function load(silent = false) {
  if (!silent) loading.value = true
  try {
    const data = await api.monitor.servers()
    servers.value = data?.servers || []
    recordsTotal.value = data?.records_total || 0
    lastFetched.value = data?.fetched_at || ''
  } catch (err) {
    if (!silent) toast.error(`服务信息加载失败：${err.message}`)
  } finally {
    loading.value = false
  }
}

function recordBusyKey(record) {
  return `${selectedName.value}:${record?.id ?? record?.created_at ?? ''}`
}

async function ackRecord(record, event) {
  event?.stopPropagation()
  if (!record || recordBusy.value) return
  const key = recordBusyKey(record)
  recordBusy.value = key
  try {
    await api.monitor.ackRecord(selectedName.value, record.id ?? 0, {
      created_at: record.created_at || '',
    })
    toast.success('已消除这条报警')
    await load(true)
    loadSummary()
  } catch (err) {
    toast.error(`消除报警失败：${err.message}`)
  } finally {
    recordBusy.value = ''
  }
}

async function restoreRecord(record, event) {
  event?.stopPropagation()
  if (!record || recordBusy.value) return
  const key = recordBusyKey(record)
  recordBusy.value = key
  try {
    await api.monitor.restoreRecord(selectedName.value, record.id ?? 0)
    toast.success('已恢复这条报警')
    await load(true)
    loadSummary()
  } catch (err) {
    toast.error(`恢复报警失败：${err.message}`)
  } finally {
    recordBusy.value = ''
  }
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

const PUSH_URL = 'https://push-server.o1-1.xct258.top'

const EXAMPLE_PUSH = `curl -X POST ${PUSH_URL}/api/push \\
  -H 'Content-Type: application/json' \\
  -d '{
    "server_name": "o1-debian-1",
    "topic": "server/khx-live",
    "title": "录播备份上传脚本",
    "message": "上传成功",
    "status": "ok",
    "push_to_mqtt": false,
    "msg_type": "markdown",
    "mode": "append"
  }'`

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success('已复制')
  } catch {
    toast.error('复制失败，请手动选择')
  }
}

let timer = null
onMounted(() => {
  pageMenu.setMenu(
    [
      { key: 'help', label: '上报说明', action: () => (helpOpen.value = true) },
      { key: 'refresh', label: '刷新', action: () => load() },
    ],
    '服务',
  )
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
    <!-- 工具条：级别筛选 + 操作 -->
    <div class="flex-shrink-0 flex flex-wrap items-center gap-2 mb-3">
      <div class="flex items-center gap-1.5 flex-wrap">
        <button
          v-for="chip in chips"
          :key="chip.value"
          class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-mono transition"
          :class="[filter === chip.value ? chip.active : chip.base, chip.count === 0 && chip.value !== 'all' ? 'opacity-40' : '']"
          @click="filter = chip.value"
        >
          <span class="h-1.5 w-1.5 rounded-full" :class="chip.dot" />
          {{ chip.label }}
          <span class="tabular-nums font-semibold">{{ chip.count }}</span>
        </button>
        <span class="hidden sm:inline text-[10px] font-mono text-slate-500 ml-1">
          {{ stats.total }} 台服务器 · {{ recordsTotal }} 条记录
        </span>
      </div>

      <div class="flex items-center gap-2 ml-auto">
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
            placeholder="搜索服务器 / 消息"
            class="w-full px-2.5 py-1 bg-slate-900/60 border border-white/10 focus:border-emerald-400 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none transition"
            @keydown.esc="closeSearch"
          />
        </div>

        <span v-if="lastFetched" class="hidden md:inline text-[10px] font-mono text-slate-500" :title="lastFetched">
          {{ lastFetched.slice(11, 19) }}
        </span>

        <button
          class="p-1.5 rounded-xl bg-slate-900/60 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white transition"
          title="刷新"
          @click="load()"
        >
          <Icon name="refresh" :size="15" :class="{ 'animate-spin': loading }" />
        </button>

        <button
          class="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-900/60 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white text-xs font-mono transition"
          @click="helpOpen = true"
        >
          <Icon name="info" :size="14" />
          <span class="hidden xs:inline">上报说明</span>
        </button>
      </div>
    </div>

    <!-- 按服务器分组 -->
    <div class="flex-1 min-h-0 overflow-y-auto custom-scroll">
      <div v-if="loading" class="h-full min-h-[12rem] flex items-center justify-center text-slate-500 font-mono text-xs">
        正在加载…
      </div>

      <EmptyState
        v-else-if="visible.length === 0"
        icon="server"
        :title="servers.length ? '没有匹配的服务器' : '还没有收到上报'"
        :description="servers.length ? '换个关键词，或切换上面的状态筛选。' : '服务器脚本把消息发到 push-server 后，会按服务器分组显示在这里。'"
      >
        <button
          v-if="!servers.length"
          class="mt-1 px-3 py-1.5 rounded-lg bg-emerald-600/80 hover:bg-emerald-600 text-white text-[11px] font-mono transition"
          @click="helpOpen = true"
        >
          查看上报方式
        </button>
      </EmptyState>

      <div v-else class="grid grid-cols-1 xl:grid-cols-2 gap-3 pb-2">
        <article
          v-for="server in visible"
          :key="server.server_name"
          role="button"
          tabindex="0"
          :aria-label="`查看 ${server.server_name} 详情`"
          class="group rounded-2xl border overflow-hidden transition cursor-pointer hover:border-white/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
          :class="[meta(server.severity).border, meta(server.severity).bg]"
          @click="openDetail(server)"
          @keydown.enter="openDetail(server)"
          @keydown.space.prevent="openDetail(server)"
        >
          <header class="flex items-start gap-2.5 px-3.5 pt-3 pb-2">
            <Icon
              :name="meta(server.severity).icon"
              :size="15"
              class="mt-0.5 shrink-0"
              :class="meta(server.severity).iconClass"
            />
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 flex-wrap">
                <h3 class="text-sm font-mono font-bold text-white truncate">{{ server.server_name }}</h3>
                <span
                  class="text-[10px] font-mono px-1.5 py-0.5 rounded-md border"
                  :class="
                    server.all_acked
                      ? 'bg-slate-500/15 text-slate-300 border-white/15'
                      : meta(server.severity).chip
                  "
                >
                  {{ server.all_acked ? '已消除' : meta(server.severity).label }}
                </span>
              </div>
              <div class="flex items-center gap-1.5 flex-wrap text-[10px] font-mono text-slate-500 mt-1">
                <span :title="formatDateTime(server.latest?.created_at)">{{ relativeTime(server.latest?.created_at) }}</span>
                <span>·</span>
                <span>{{ server.count }} 条记录</span>
              </div>
            </div>
            <Icon
              name="chevronRight"
              :size="14"
              class="shrink-0 mt-1 text-slate-600 group-hover:text-slate-300 transition-colors"
            />
          </header>

          <!-- 摘要：点击卡片后看全文 -->
          <div class="px-3.5 pb-2">
            <p
              v-if="server.latest?.title"
              class="text-[12px] font-semibold text-slate-100 truncate mb-1"
              :title="server.latest.title"
            >
              {{ server.latest.title }}
            </p>
            <p
              class="text-[11px] leading-relaxed text-slate-400"
              style="display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden"
            >
              {{ preview(server.latest?.message || '') }}
            </p>
          </div>

          <footer class="flex items-center justify-between gap-2 px-3.5 pb-3 text-[10px] font-mono text-slate-500">
            <span class="truncate">{{ displayTopic(server.topic) }}</span>
            <span class="shrink-0 text-slate-400 group-hover:text-slate-200 transition-colors">查看全部</span>
          </footer>
        </article>
      </div>
    </div>

    <!-- 服务记录：服务器 → 项目 → 服务 → 内容 -->
    <ModalShell
      v-model="detailOpen"
      :title="selectedServer?.server_name || '服务详情'"
      icon="server"
      max-width="max-w-4xl"
    >
      <template #header-actions>
        <button
          class="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.06] px-2.5 py-1.5 text-[10px] font-mono text-slate-200 transition active:bg-white/15 lg:hidden"
          :title="`当前：${contentScope}；点击选择项目 / 服务`"
          :aria-label="`当前：${contentScope}；点击选择项目 / 服务`"
          @click="mobilePickerOpen = true"
        >
          <Icon name="list" :size="13" class="shrink-0 text-indigo-300" />
          <span class="max-w-[5.5rem] truncate sm:max-w-[9rem]">{{ pickerButtonLabel }}</span>
          <Icon name="chevronDown" :size="11" class="shrink-0 text-slate-500" />
        </button>
      </template>

      <div v-if="selectedServer" class="space-y-3">
        <div class="grid gap-3 h-[60vh] lg:h-[68vh] lg:grid-cols-[16rem_minmax(0,1fr)]">
          <!-- 桌面端左侧：项目 + 服务 -->
          <aside
            class="hidden min-h-0 rounded-xl border border-white/10 bg-white/[0.02] p-3 custom-scroll lg:block lg:overflow-y-auto"
          >
            <div class="mb-3 flex flex-wrap items-center gap-2 border-b border-white/10 pb-3">
              <span
                class="text-[10px] font-mono px-1.5 py-0.5 rounded-md border"
                :class="
                  selectedServer.all_acked
                    ? 'bg-slate-500/15 text-slate-300 border-white/15'
                    : meta(selectedServer.severity).chip
                "
              >
                {{ selectedServer.all_acked ? '已消除' : meta(selectedServer.severity).label }}
              </span>
              <span class="text-[10px] font-mono text-slate-500">
                {{ groupedRecords.length }} 个项目 · {{ serviceTotal }} 个服务 · {{ selectedServer.count }} 条
              </span>
            </div>

            <div class="mb-1 flex items-center justify-between px-2">
              <span class="text-[10px] font-mono text-slate-500">项目</span>
              <span class="text-[9px] font-mono text-slate-600">{{ groupedRecords.length }}</span>
            </div>
            <div class="space-y-0.5">
              <button
                class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] font-mono transition"
                :class="
                  !activeProject
                    ? 'bg-white/15 text-white'
                    : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                "
                @click="selectProject('')"
              >
                <span class="h-1.5 w-1.5 rounded-full shrink-0" :class="meta(selectedServer.severity).dot" />
                <span class="min-w-0 flex-1 truncate">全部项目</span>
                <span class="text-[10px] tabular-nums text-slate-500">{{ selectedServer.count }}</span>
              </button>
              <button
                v-for="project in groupedRecords"
                :key="project.topic"
                class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] font-mono transition"
                :class="
                  activeProject === project.topic
                    ? 'bg-white/15 text-white'
                    : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                "
                :title="project.name"
                @click="selectProject(project.topic)"
              >
                <span class="h-1.5 w-1.5 rounded-full shrink-0" :class="meta(project.severity).dot" />
                <span class="min-w-0 flex-1 truncate">{{ project.name }}</span>
                <span class="text-[10px] tabular-nums text-slate-500">{{ project.count }}</span>
              </button>
            </div>

            <div class="mb-1 mt-4 flex items-center justify-between gap-2 px-2">
              <span class="text-[10px] font-mono text-slate-500">服务</span>
              <span class="truncate text-[9px] font-mono text-slate-600">
                {{ activeProjectGroup?.name || '全部项目' }}
              </span>
            </div>
            <div class="space-y-0.5">
              <button
                class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] font-mono transition"
                :class="
                  !activeService
                    ? 'bg-white/15 text-white'
                    : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                "
                @click="selectService('')"
              >
                <span
                  class="h-1.5 w-1.5 rounded-full shrink-0"
                  :class="meta(activeProjectGroup ? activeProjectGroup.severity : selectedServer.severity).dot"
                />
                <span class="min-w-0 flex-1 truncate">全部服务</span>
                <span class="text-[10px] tabular-nums text-slate-500">
                  {{ activeProjectGroup ? activeProjectGroup.count : selectedServer.count }}
                </span>
              </button>
              <button
                v-for="service in serviceOptions"
                :key="service.key"
                class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] font-mono transition"
                :class="
                  activeService === service.key
                    ? 'bg-white/15 text-white'
                    : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                "
                :title="activeProject ? service.title : `${service.projectName} / ${service.title}`"
                @click="selectService(service.key)"
              >
                <span class="h-1.5 w-1.5 rounded-full shrink-0" :class="meta(service.severity).dot" />
                <span class="min-w-0 flex-1">
                  <span class="block truncate">{{ service.title }}</span>
                  <span v-if="!activeProject" class="block truncate text-[9px] text-slate-500">
                    {{ service.projectName }}
                  </span>
                </span>
                <span class="text-[10px] tabular-nums text-slate-500">{{ service.count }}</span>
              </button>
              <p v-if="serviceOptions.length === 0" class="px-2 py-2 text-[10px] font-mono text-slate-600">
                暂无服务
              </p>
            </div>
          </aside>

          <!-- 右侧：当前项目 / 服务的内容 -->
          <section
            class="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-white/10 bg-slate-950/30"
          >
            <header class="shrink-0 border-b border-white/10 px-3.5 py-3">
              <div class="flex flex-wrap items-center gap-2 text-[10px] font-mono text-slate-500">
                <span class="truncate">{{ contentScope }}</span>
                <span class="ml-auto" :title="formatDateTime(contentLatest?.created_at)">
                  {{ relativeTime(contentLatest?.created_at) }}
                </span>
              </div>
              <div class="mt-1.5 flex flex-wrap items-center gap-2">
                <h4 class="text-sm font-semibold text-white">{{ contentTitle }}</h4>
                <span
                  class="text-[10px] font-mono px-1.5 py-0.5 rounded-md border"
                  :class="meta(contentSeverity).chip"
                >
                  {{ meta(contentSeverity).label }}
                </span>
                <span class="text-[10px] font-mono text-slate-500">{{ contentRecords.length }} 条记录</span>
              </div>
            </header>

            <div
              ref="contentTop"
              class="space-y-2 p-3 custom-scroll min-h-0 flex-1 overflow-y-auto"
            >
              <article
                v-for="record in pagedContentRecords"
                :key="record.id"
                class="rounded-xl border border-white/5 bg-white/[0.02] overflow-hidden"
                :class="record.acked ? 'opacity-60' : ''"
              >
                <header class="flex flex-wrap items-center gap-2 px-3.5 py-2 border-b border-white/5">
                  <span
                    class="text-[10px] font-mono px-1.5 py-0.5 rounded-md border shrink-0"
                    :class="
                      record.acked
                        ? 'bg-slate-500/15 text-slate-400 border-white/10'
                        : meta(record.severity).chip
                    "
                  >
                    {{ record.acked ? '已消除' : meta(record.severity).label }}
                  </span>
                  <span class="text-[10px] font-mono text-slate-500">
                    {{ formatDateTime(record.created_at) }}
                  </span>
                  <span
                    v-if="recordContext(record)"
                    class="min-w-0 truncate text-[10px] font-mono text-slate-400"
                    :title="recordContext(record)"
                  >
                    {{ recordContext(record) }}
                  </span>
                  <button
                    v-if="record.acked"
                    class="ml-auto shrink-0 rounded-md border border-white/10 px-1.5 py-0.5 text-[10px] font-mono text-slate-400 transition hover:border-white/20 hover:text-slate-200 disabled:opacity-50"
                    :disabled="recordBusy === recordBusyKey(record)"
                    @click="restoreRecord(record, $event)"
                  >
                    恢复
                  </button>
                  <button
                    v-else-if="record.severity === 'error' || record.severity === 'warn'"
                    class="ml-auto flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-mono transition disabled:opacity-50"
                    :class="
                      record.severity === 'error'
                        ? 'border-rose-400/30 text-rose-200 hover:bg-rose-500/15'
                        : 'border-amber-400/30 text-amber-200 hover:bg-amber-500/15'
                    "
                    :disabled="recordBusy === recordBusyKey(record)"
                    @click="ackRecord(record, $event)"
                  >
                    <Icon name="check" :size="10" class="shrink-0" />
                    {{ recordBusy === recordBusyKey(record) ? '处理中…' : '消除报警' }}
                  </button>
                </header>
                <div class="px-3.5 py-3">
                  <div class="md-preview" v-html="renderMarkdown(record.message || '')" />
                </div>
              </article>

              <div
                v-if="contentRecords.length === 0"
                class="flex h-full min-h-[10rem] items-center justify-center text-[11px] font-mono text-slate-600"
              >
                当前范围暂无记录
              </div>
            </div>

            <footer
              v-if="contentPageCount > 1"
              class="shrink-0 border-t border-white/10 px-3.5 py-2.5"
            >
              <div class="flex flex-wrap items-center justify-between gap-2">
                <span class="text-[10px] font-mono text-slate-500">
                  第 {{ currentContentPage }} / {{ contentPageCount }} 页
                </span>
                <div class="flex flex-wrap items-center gap-1">
                  <button
                    class="px-2 py-1 rounded-lg border border-white/10 bg-white/5 text-[10px] font-mono text-slate-300 hover:bg-white/10 transition disabled:opacity-30 disabled:cursor-not-allowed"
                    :disabled="currentContentPage <= 1"
                    @click="goContentPage(currentContentPage - 1)"
                  >
                    上一页
                  </button>
                  <button
                    v-for="page in contentPageNumbers"
                    :key="page"
                    class="w-6 h-6 rounded-lg border text-[10px] font-mono transition"
                    :class="
                      page === currentContentPage
                        ? 'border-white/25 bg-white/15 text-white'
                        : 'border-white/10 bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-200'
                    "
                    @click="goContentPage(page)"
                  >
                    {{ page }}
                  </button>
                  <button
                    class="px-2 py-1 rounded-lg border border-white/10 bg-white/5 text-[10px] font-mono text-slate-300 hover:bg-white/10 transition disabled:opacity-30 disabled:cursor-not-allowed"
                    :disabled="currentContentPage >= contentPageCount"
                    @click="goContentPage(currentContentPage + 1)"
                  >
                    下一页
                  </button>
                </div>
              </div>
            </footer>
          </section>
        </div>
      </div>
    </ModalShell>

    <!-- 移动端：选择项目 / 服务 -->
    <ModalShell
      v-model="mobilePickerOpen"
      title="选择项目 / 服务"
      icon="list"
      max-width="max-w-md"
      :z-index="60"
    >
      <div v-if="selectedServer" class="space-y-4">
        <div class="border-b border-white/10 pb-3">
          <div class="flex flex-wrap items-center gap-2">
            <span
              class="text-[10px] font-mono px-1.5 py-0.5 rounded-md border"
              :class="meta(selectedServer.severity).chip"
            >
              {{ meta(selectedServer.severity).label }}
            </span>
            <span class="text-[10px] font-mono text-slate-500">
              {{ selectedServer.server_name }} · {{ groupedRecords.length }} 个项目 ·
              {{ serviceTotal }} 个服务
            </span>
          </div>
          <p class="mt-1.5 text-[10px] text-slate-500 leading-relaxed">
            先选项目，再选服务；也可以直接查看当前范围。
          </p>
        </div>

        <div>
          <div class="mb-1.5 flex items-center justify-between px-1">
            <span class="text-[11px] font-mono text-slate-400">项目</span>
            <span class="text-[10px] font-mono text-slate-600">{{ groupedRecords.length }}</span>
          </div>
          <div class="space-y-1">
            <button
              class="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-[12px] font-mono transition"
              :class="
                !activeProject
                  ? 'bg-white/15 text-white'
                  : 'text-slate-400 active:bg-white/10'
              "
              @click="selectProjectFromPicker('')"
            >
              <span class="h-2 w-2 rounded-full shrink-0" :class="meta(selectedServer.severity).dot" />
              <span class="min-w-0 flex-1 truncate">全部项目</span>
              <span class="text-[10px] tabular-nums text-slate-500">{{ selectedServer.count }}</span>
            </button>
            <button
              v-for="project in groupedRecords"
              :key="project.topic"
              class="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-[12px] font-mono transition"
              :class="
                activeProject === project.topic
                  ? 'bg-white/15 text-white'
                  : 'text-slate-400 active:bg-white/10'
              "
              @click="selectProjectFromPicker(project.topic)"
            >
              <span class="h-2 w-2 rounded-full shrink-0" :class="meta(project.severity).dot" />
              <span class="min-w-0 flex-1 truncate">{{ project.name }}</span>
              <span class="text-[10px] tabular-nums text-slate-500">{{ project.count }}</span>
            </button>
          </div>
        </div>

        <div ref="mobileServiceTop" class="scroll-mt-3">
          <div class="mb-1.5 flex items-center justify-between gap-2 px-1">
            <span class="text-[11px] font-mono text-slate-400">服务</span>
            <span class="truncate text-[10px] font-mono text-slate-600">
              {{ activeProjectGroup?.name || '全部项目' }}
            </span>
          </div>
          <div class="space-y-1">
            <button
              class="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-[12px] font-mono transition"
              :class="
                !activeService
                  ? 'bg-white/15 text-white'
                  : 'text-slate-400 active:bg-white/10'
              "
              @click="selectServiceFromPicker('')"
            >
              <span
                class="h-2 w-2 rounded-full shrink-0"
                :class="meta(activeProjectGroup ? activeProjectGroup.severity : selectedServer.severity).dot"
              />
              <span class="min-w-0 flex-1 truncate">全部服务</span>
              <span class="text-[10px] tabular-nums text-slate-500">
                {{ activeProjectGroup ? activeProjectGroup.count : selectedServer.count }}
              </span>
            </button>
            <button
              v-for="service in serviceOptions"
              :key="service.key"
              class="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-[12px] font-mono transition"
              :class="
                activeService === service.key
                  ? 'bg-white/15 text-white'
                  : 'text-slate-400 active:bg-white/10'
              "
              @click="selectServiceFromPicker(service.key)"
            >
              <span class="h-2 w-2 rounded-full shrink-0" :class="meta(service.severity).dot" />
              <span class="min-w-0 flex-1">
                <span class="block truncate">{{ service.title }}</span>
                <span v-if="!activeProject" class="block truncate text-[9px] text-slate-500">
                  {{ service.projectName }}
                </span>
              </span>
              <span class="text-[10px] tabular-nums text-slate-500">{{ service.count }}</span>
            </button>
            <p v-if="serviceOptions.length === 0" class="px-2 py-2 text-[10px] font-mono text-slate-600">
              暂无服务
            </p>
          </div>
        </div>
      </div>

      <template #footer>
        <button
          class="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-[11px] font-mono text-slate-300 transition active:bg-white/10"
          @click="mobilePickerOpen = false"
        >
          查看当前范围
        </button>
      </template>
    </ModalShell>

    <!-- 上报说明 -->
    <ModalShell v-model="helpOpen" title="服务上报方式" icon="server" max-width="max-w-xl">
      <div class="space-y-3 text-xs">
        <p class="text-slate-400 leading-relaxed">
          服务器脚本把状态消息发到 <code class="text-emerald-300">push-server</code> 的
          <code class="text-emerald-300">POST /api/push</code>。层级是
          <code class="text-slate-200">server_name</code>（服务器）→
          <code class="text-slate-200">topic</code>（项目）→
          <code class="text-slate-200">title</code>（项目里的服务）；本页按
          <code class="text-slate-200">server_name</code> 分组，点击卡片后在弹窗左侧选择
          <code class="text-slate-200">topic</code>（项目）和 <code class="text-slate-200">title</code>（服务），
          右侧查看当前范围的记录，每页 {{ RECORDS_PER_PAGE }} 条。移动端点击服务器名称
          旁边显示当前范围的按钮打开选择弹窗。
        </p>

        <div>
          <div class="flex items-center justify-between mb-1">
            <span class="text-slate-400 font-mono text-[11px]">上报示例</span>
            <button class="text-[10px] text-emerald-300 hover:text-emerald-200 transition" @click="copy(EXAMPLE_PUSH)">
              复制
            </button>
          </div>
          <pre
            class="whitespace-pre-wrap break-words rounded-xl bg-slate-950/80 border border-white/10 p-3 text-[10px] leading-relaxed text-slate-300 font-mono"
          >{{ EXAMPLE_PUSH }}</pre>
        </div>

        <div class="rounded-xl bg-white/5 border border-white/10 p-3 space-y-1 text-[10px] text-slate-400 leading-relaxed">
          <p><span class="text-slate-200 font-mono">server_name</span>：服务器名，页面按它分组</p>
          <p>
            <span class="text-slate-200 font-mono">topic</span>：项目 / 服务主题，例如
            <code>server/khx-live</code>，不需要重复服务器名
          </p>
          <p>
            <span class="text-slate-200 font-mono">title</span>：项目里的服务名称（脚本 / 任务名），例如
            <code>录播备份上传脚本</code>，<b class="text-slate-200">必填</b>
          </p>
          <p><span class="text-slate-200 font-mono">message</span>：脚本执行结果 / 详情，Markdown 原样渲染</p>
          <p>
            <span class="text-slate-200 font-mono">status</span>：<b class="text-slate-200">必填</b>，
            <span class="text-emerald-300">ok</span> /
            <span class="text-amber-300">warn</span> /
            <span class="text-rose-300">error</span> /
            <span class="text-sky-300">info</span>，页面按它显示级别
          </p>
          <p>
            <span class="text-slate-200 font-mono">mode</span>：<code>append</code> 保留多条记录；
            <code>overwrite</code> 当 <code>server_name</code>、<code>topic</code>、<code>title</code> 都一致时只留最新一条
          </p>
          <p>
            <span class="text-slate-200 font-mono">push_to_mqtt</span>：是否同时推到 MQTT，传
            <code>true</code> / <code>false</code>
          </p>
        </div>

        <div class="rounded-xl bg-amber-500/[0.06] border border-amber-400/20 p-3 text-[10px] text-amber-200/80 leading-relaxed">
          状态由上报时的 <code class="font-mono">status</code> 字段决定（必填）。点击卡片后，在弹窗左侧选择项目和该项目下的服务，右侧查看对应记录；也可以选择「全部项目」或「全部服务」查看汇总。
        </div>
      </div>
    </ModalShell>
  </div>
</template>
