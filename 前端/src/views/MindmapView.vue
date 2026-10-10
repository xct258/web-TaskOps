<script setup>
import { computed, onMounted, reactive, ref } from 'vue'

import { api } from '@/api'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import EmptyState from '@/components/EmptyState.vue'
import Icon from '@/components/Icon.vue'
import { useToast } from '@/composables/useToast'
import { loadSummary } from '@/composables/useSummary'
import { relativeTime } from '@/utils/format'
import { buildMindmap } from '@/utils/outline'

const toast = useToast()

const items = ref([])
const loading = ref(true)
const selectedId = ref(null) // number | 'new' | null
const mode = ref('graph') // graph | edit
const scale = ref(1)
const saving = ref(false)
const confirmOpen = ref(false)

const draft = reactive({ title: '', outline: '' })

const inputClass =
  'w-full px-3 py-1.5 bg-slate-950 border border-white/10 rounded-xl text-white text-xs placeholder-slate-500 focus:outline-none focus:border-rose-400 transition'

const DEFAULT_OUTLINE = '中心主题\n  分支一\n    叶子节点\n  分支二\n    另一个叶子'

const layout = computed(() => buildMindmap(draft.outline, draft.title))

// 按层级循环取色。
const TONES = [
  'bg-indigo-600 border-indigo-400 text-white shadow-indigo-500/20',
  'bg-slate-800/95 border-white/15 text-slate-100',
  'bg-slate-900/85 border-white/10 text-slate-300',
]
function nodeTone(depth) {
  return TONES[Math.min(depth, TONES.length - 1)]
}

const activeMap = computed(() => items.value.find((m) => m.id === selectedId.value) || null)

async function load() {
  loading.value = true
  try {
    items.value = await api.mindmaps.list()
  } catch (err) {
    toast.error(`导图加载失败：${err.message}`)
  } finally {
    loading.value = false
  }
}

function openMap(map) {
  selectedId.value = map.id
  Object.assign(draft, { title: map.title, outline: map.outline || '' })
  mode.value = 'graph'
  scale.value = 1
}

function startNew() {
  selectedId.value = 'new'
  Object.assign(draft, { title: '新建导图', outline: DEFAULT_OUTLINE })
  mode.value = 'edit'
  scale.value = 1
}

function closeEditor() {
  selectedId.value = null
}

async function save() {
  if (!draft.title.trim()) {
    toast.error('标题不能为空')
    return
  }
  const payload = { title: draft.title.trim(), outline: draft.outline }
  saving.value = true
  try {
    if (selectedId.value === 'new') {
      const created = await api.mindmaps.create(payload)
      items.value.unshift(created)
      selectedId.value = created.id
      toast.success('导图已创建')
    } else {
      const updated = await api.mindmaps.update(selectedId.value, payload)
      const idx = items.value.findIndex((m) => m.id === updated.id)
      if (idx >= 0) items.value[idx] = updated
      const [item] = items.value.splice(idx, 1)
      items.value.unshift(item)
      toast.success('导图已保存')
    }
    mode.value = 'graph'
    loadSummary()
  } catch (err) {
    toast.error(`保存失败：${err.message}`)
  } finally {
    saving.value = false
  }
}

async function doDelete() {
  const id = selectedId.value
  try {
    await api.mindmaps.remove(id)
    items.value = items.value.filter((m) => m.id !== id)
    selectedId.value = null
    toast.success('导图已删除')
    loadSummary()
  } catch (err) {
    toast.error(`删除失败：${err.message}`)
  } finally {
    confirmOpen.value = false
  }
}

function zoom(delta) {
  scale.value = Math.min(1.8, Math.max(0.4, Number((scale.value + delta).toFixed(2))))
}
function resetZoom() {
  scale.value = 1
}

onMounted(load)
</script>

<template>
  <div class="h-full flex flex-col min-h-0">
    <div class="flex-1 min-h-0 flex gap-2.5">
      <!-- 左侧列表 -->
      <div class="flex-col min-h-0 w-full md:w-56 lg:w-64 shrink-0" :class="selectedId != null ? 'hidden md:flex' : 'flex'">
        <div class="flex-shrink-0 flex items-center gap-1.5 mb-2">
          <span class="text-xs font-mono text-slate-400 flex-1">思维导图</span>
          <button
            class="p-1.5 rounded-xl bg-rose-600/80 hover:bg-rose-600 text-white border border-rose-400/30 transition"
            title="新建导图"
            @click="startNew"
          >
            <Icon name="plus" :size="15" />
          </button>
        </div>

        <div class="flex-1 min-h-0 overflow-y-auto custom-scroll pr-1 space-y-1.5">
          <div v-if="loading" class="h-full min-h-[8rem] flex items-center justify-center text-slate-500 font-mono text-xs">加载中…</div>
          <EmptyState v-else-if="items.length === 0" icon="mindmap" title="暂无导图" description="点击 + 用缩进大纲创建。" />
          <button
            v-for="map in items"
            :key="map.id"
            class="w-full text-left p-2.5 rounded-xl border transition"
            :class="
              selectedId === map.id ? 'bg-rose-600/20 border-rose-400/40' : 'bg-slate-900/55 border-white/10 hover:border-rose-400/30'
            "
            @click="openMap(map)"
          >
            <div class="text-xs font-semibold text-slate-100 truncate">{{ map.title }}</div>
            <div class="text-[9px] text-slate-500 font-mono mt-0.5">{{ relativeTime(map.updated_at) }}</div>
          </button>
        </div>
      </div>

      <!-- 右侧画布 -->
      <div class="flex-1 min-h-0 flex-col gap-2" :class="selectedId != null ? 'flex' : 'hidden md:flex'">
        <template v-if="selectedId != null">
          <!-- 工具条 -->
          <div class="flex-shrink-0 flex items-center gap-2">
            <button
              class="md:hidden p-1.5 rounded-xl bg-white/5 border border-white/10 text-slate-300"
              title="返回列表"
              @click="closeEditor"
            >
              <Icon name="chevronLeft" :size="15" />
            </button>
            <input
              v-model="draft.title"
              :class="inputClass"
              class="flex-1 !text-sm font-semibold"
              placeholder="导图标题"
            />

            <div class="flex items-center gap-0.5 bg-white/5 border border-white/10 rounded-xl p-0.5">
              <button class="px-1.5 py-1 rounded-lg text-slate-300 hover:bg-white/10 transition" title="缩小" @click="zoom(-0.2)">
                <Icon name="minus" :size="13" />
              </button>
              <button
                class="px-1.5 text-[10px] font-mono text-slate-400 hover:text-white transition w-10 text-center"
                title="重置缩放"
                @click="resetZoom"
              >
                {{ Math.round(scale * 100) }}%
              </button>
              <button class="px-1.5 py-1 rounded-lg text-slate-300 hover:bg-white/10 transition" title="放大" @click="zoom(0.2)">
                <Icon name="plus" :size="13" />
              </button>
            </div>

            <button
              class="p-1.5 rounded-xl border transition"
              :class="mode === 'edit' ? 'bg-rose-600/80 text-white border-rose-400/30' : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'"
              :title="mode === 'edit' ? '查看导图' : '编辑大纲'"
              @click="mode = mode === 'edit' ? 'graph' : 'edit'"
            >
              <Icon :name="mode === 'edit' ? 'mindmap' : 'edit'" :size="15" />
            </button>

            <button
              class="hidden lg:flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-rose-600/80 hover:bg-rose-600 disabled:opacity-60 text-white text-xs font-mono border border-rose-400/30 transition"
              :disabled="saving"
              @click="save"
            >
              <Icon name="check" :size="14" /> 保存
            </button>

            <button
              v-if="selectedId !== 'new'"
              class="p-1.5 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-rose-400 transition"
              title="删除"
              @click="confirmOpen = true"
            >
              <Icon name="trash" :size="15" />
            </button>
          </div>

          <!-- 编辑：大纲文本 -->
          <textarea
            v-if="mode === 'edit'"
            v-model="draft.outline"
            class="flex-1 min-h-0 w-full resize-none rounded-2xl bg-slate-900/55 backdrop-blur-md border border-white/10 p-3.5 text-xs text-slate-200 font-mono leading-relaxed focus:outline-none focus:border-rose-400/40 selectable"
            placeholder="每行一个节点，用缩进表示层级：&#10;中心主题&#10;  分支一&#10;    叶子&#10;  分支二"
          />

          <!-- 预览：自动布局导图 -->
          <div
            v-else
            class="flex-1 min-h-0 rounded-2xl bg-slate-900/45 backdrop-blur-md border border-white/10 overflow-auto custom-scroll"
          >
            <div
              :style="{ width: `${layout.width * scale + 48}px`, height: `${layout.height * scale + 48}px` }"
              class="relative"
            >
              <div
                :style="{
                  width: `${layout.width}px`,
                  height: `${layout.height}px`,
                  transform: `scale(${scale})`,
                  transformOrigin: 'top left',
                }"
                class="absolute top-6 left-6"
              >
                <svg
                  :width="layout.width"
                  :height="layout.height"
                  class="absolute inset-0 pointer-events-none"
                  :viewBox="`0 0 ${Math.max(layout.width, 1)} ${Math.max(layout.height, 1)}`"
                >
                  <path
                    v-for="(edge, i) in layout.edges"
                    :key="i"
                    :d="`M ${edge.x1} ${edge.y1} C ${(edge.x1 + edge.x2) / 2} ${edge.y1}, ${(edge.x1 + edge.x2) / 2} ${edge.y2}, ${edge.x2} ${edge.y2}`"
                    fill="none"
                    stroke="rgba(148,163,184,0.5)"
                    stroke-width="1.5"
                  />
                </svg>

                <div
                  v-for="(node, i) in layout.nodes"
                  :key="i"
                  class="absolute flex items-center rounded-xl border px-2.5 text-[11px] font-medium shadow-md overflow-hidden"
                  :class="nodeTone(node.depth)"
                  :style="{ left: `${node.x}px`, top: `${node.y}px`, width: `${node.width}px`, height: `${node.height}px` }"
                  :title="node.text"
                >
                  <span class="truncate">{{ node.text }}</span>
                </div>
              </div>
            </div>
          </div>

          <div class="flex-shrink-0 flex items-center justify-between gap-2">
            <span class="text-[10px] text-slate-500 font-mono">
              <template v-if="activeMap">最近编辑 {{ relativeTime(activeMap.updated_at) }} · 节点 {{ layout.nodes.length }}</template>
              <template v-else>新导图</template>
            </span>
            <button
              class="lg:hidden flex items-center gap-1 px-3 py-1.5 rounded-xl bg-rose-600/80 hover:bg-rose-600 disabled:opacity-60 text-white text-xs font-mono border border-rose-400/30 transition"
              :disabled="saving"
              @click="save"
            >
              <Icon name="check" :size="14" /> 保存
            </button>
          </div>
        </template>

        <div v-else class="flex-1 flex items-center justify-center">
          <EmptyState icon="mindmap" title="选择一张导图" description="从左侧列表选择，或点击 + 新建。" />
        </div>
      </div>
    </div>

    <ConfirmDialog
      v-model="confirmOpen"
      title="删除导图"
      :message="draft.title ? `确定删除「${draft.title}」吗？` : '确定删除这张导图吗？'"
      @confirm="doDelete"
    />
  </div>
</template>
