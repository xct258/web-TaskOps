<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

/**
 * 标签过滤条：放不下的标签折叠进「更多 ▾」，不做横向滚动。
 *
 * 为什么不用横向滚动：滚动条一隐藏（no-scrollbar），就没人知道右边还藏着内容，
 * 鼠标用户只能靠 Shift+滚轮才发现得了。折叠则始终把「还有多少」摆在明面上。
 *
 * 显示几个由 measure() 按容器实际宽度算：先用隐藏镜像行量出每个标签的真实宽度，
 * 再从「全部」右边往右塞，塞不下的进下拉。
 */
const props = defineProps({
  tags: { type: Array, default: () => [] },
  active: { type: String, default: 'ALL' },
  allLabel: { type: String, default: '全部' },
  accent: { type: String, default: 'indigo' },
  size: { type: String, default: 'md' },
})
const emit = defineEmits(['select'])

// Tailwind JIT 只认完整类名字面量，颜色/尺寸只能写成整串映射（与 AppHeader 的 ACTIVE 同款）。
const ACCENTS = {
  indigo: {
    active: 'bg-indigo-600 text-white border-indigo-400/40',
    idle: 'bg-white/5 hover:bg-white/10 text-slate-400 hover:text-slate-200 border-white/5',
    item: 'bg-indigo-600 text-white',
  },
  violet: {
    active: 'bg-violet-600 text-white border-violet-400/40',
    idle: 'bg-white/5 hover:bg-white/10 text-slate-400 hover:text-slate-200 border-white/5',
    item: 'bg-violet-600 text-white',
  },
  rose: {
    active: 'bg-rose-600 text-white border-rose-400/40',
    idle: 'bg-white/5 hover:bg-white/10 text-slate-400 hover:text-slate-200 border-white/5',
    item: 'bg-rose-600 text-white',
  },
}

const SIZES = {
  md: { root: 'gap-1.5 text-xs', chip: 'px-3 py-1 rounded-xl' },
  sm: { root: 'gap-1 text-[11px]', chip: 'px-2 py-0.5 rounded-lg' },
}

// flex-shrink-0 不能少：默认 flex-shrink:1 会让塞不下的标签被逐个压扁，而不是整块裁掉。
const CHIP = 'whitespace-nowrap border transition-all flex-shrink-0'

const tone = computed(() => ACCENTS[props.accent] || ACCENTS.indigo)
const skin = computed(() => SIZES[props.size] || SIZES.md)
const chipClass = (value, highlight = false) => [
  CHIP,
  skin.value.chip,
  highlight || props.active === value ? tone.value.active : tone.value.idle,
]

/* 测量用：整行的可用宽度（rowEl 是 flex-1 min-w-0，宽度由工具栏决定，与内容无关），
 * 减去「全部」、插槽按钮和「更多」占的位置，剩下的才是标签能用的。 */
const rowEl = ref(null)
const allChipEl = ref(null)
const slotEl = ref(null)
const moreMirrorEl = ref(null) // 「更多」宽度的量取副本（真实按钮可能还没渲染）
const measureTagEls = [] // 镜像行里各标签的 DOM，只用于量宽度
const visibleCount = ref(0)
const moreOpen = ref(false)
const moreWrap = ref(null)
let observer = null

const visibleTags = computed(() => props.tags.slice(0, visibleCount.value))
const hiddenTags = computed(() => props.tags.slice(visibleCount.value))
// 当前选中项被折叠时高亮「更多」，否则用户看不出列表为什么变了
const moreActive = computed(() => hiddenTags.value.includes(props.active))

function measure() {
  const row = rowEl.value
  if (!row) return
  if (!props.tags.length) {
    visibleCount.value = 0
    return
  }
  // 间距直接读计算样式，免得和 size 里的 gap 类写死对不上
  const gap = parseFloat(getComputedStyle(row).columnGap) || 0
  const width = (el) => el?.getBoundingClientRect().width ?? 0
  const widths = props.tags.map((_, i) => width(measureTagEls[i]))

  // 除标签外都固定不动：全部 + 一个 gap + 插槽（未分类之类，空则宽 0）
  const base = width(allChipEl.value) + gap + width(slotEl.value)
  // 2px 取整余量：宁可少放一个，也不裁出半个标签
  const budgetNoMore = row.clientWidth - base - 2
  const budgetWithMore = budgetNoMore - (gap + width(moreMirrorEl.value))

  const countIn = (budget) => {
    let used = 0
    let count = 0
    while (count < widths.length && used + gap + widths[count] <= budget) {
      used += gap + widths[count]
      count += 1
    }
    return count
  }

  let count = countIn(budgetNoMore)
  if (count < widths.length) count = countIn(budgetWithMore) // 放不下 → 要给「更多」腾位置，重算
  visibleCount.value = count
}

function select(value) {
  emit('select', value)
  moreOpen.value = false
}

function onOutside(e) {
  if (moreOpen.value && moreWrap.value && !moreWrap.value.contains(e.target)) moreOpen.value = false
}

function onKeydown(e) {
  if (e.key === 'Escape') moreOpen.value = false
}

onMounted(() => {
  document.addEventListener('click', onOutside)
  document.addEventListener('keydown', onKeydown)
  nextTick(measure)
  // 宽度变化就重算：整行（窗口缩放 / 右侧按钮增减）+ 插槽（「未分类」出现或消失）。
  // 放 rAF 里避免 ResizeObserver 同帧反复回调。
  observer = new ResizeObserver(() => requestAnimationFrame(measure))
  if (rowEl.value) observer.observe(rowEl.value)
  if (slotEl.value) observer.observe(slotEl.value)
})
onUnmounted(() => {
  document.removeEventListener('click', onOutside)
  document.removeEventListener('keydown', onKeydown)
  observer?.disconnect()
})

watch(() => props.tags, () => nextTick(measure))
</script>

<template>
  <div ref="rowEl" class="flex items-center min-w-0 font-mono" :class="skin.root">
    <!-- 量宽镜像行：不可见、不占位、不响应交互，只为 measure() 提供各元素真实宽度。
         width:max-content 必须有，否则绝对定位元素按 shrink-to-fit 收缩，量出来的宽度会偏小。 -->
    <div
      aria-hidden="true"
      class="flex items-center whitespace-nowrap pointer-events-none opacity-0"
      :class="skin.root"
      style="position: absolute; left: -9999px; top: 0; width: max-content"
    >
      <button
        v-for="(tag, i) in tags"
        :key="tag"
        :ref="(el) => (measureTagEls[i] = el)"
        class="whitespace-nowrap border border-white/5 flex-shrink-0"
        :class="skin.chip"
      >
        {{ tag }}
      </button>
      <button ref="moreMirrorEl" class="whitespace-nowrap border border-white/5 flex-shrink-0" :class="skin.chip">
        更多 ▾
      </button>
    </div>

    <button ref="allChipEl" :class="chipClass('ALL')" @click="select('ALL')">{{ allLabel }}</button>

    <!-- 可见标签区：不设 flex-1，宽度就是这几个标签的总宽，这样「更多」紧跟在最后一个标签后面；
         万一算错也只是这里被裁剪，不会压到右侧的搜索/新建按钮（其余子项都是 flex-shrink-0）。 -->
    <div class="min-w-0 flex items-center overflow-hidden" :class="skin.root">
      <button v-for="tag in visibleTags" :key="tag" :class="chipClass(tag)" @click="select(tag)">
        {{ tag }}
      </button>
    </div>

    <!-- 折叠入口：紧跟最后一个标签，而不是被顶到行尾（贴着搜索框） -->
    <div v-if="hiddenTags.length" ref="moreWrap" class="relative flex-shrink-0">
      <button
        :class="chipClass('', moreActive)"
        :title="`还有 ${hiddenTags.length} 个标签`"
        @click="moreOpen = !moreOpen"
      >
        更多 ▾
      </button>
      <div
        v-if="moreOpen"
        class="absolute right-0 top-full mt-1.5 z-50 w-48 max-h-56 overflow-y-auto custom-scroll rounded-xl bg-slate-900/95 border border-white/10 shadow-2xl p-1.5"
      >
        <button
          v-for="t in hiddenTags"
          :key="t"
          class="block w-full text-left px-2.5 py-1.5 rounded-lg font-mono transition-colors"
          :class="active === t ? tone.item : 'text-slate-300 hover:bg-white/10 hover:text-white'"
          @click="select(t)"
        >
          {{ t }}
        </button>
      </div>
    </div>

    <!-- 额外筛选按钮（如书签页的「未分类」）：复用同一套 chip 样式。
         空插槽宽度为 0，测宽时按 0 计入。 -->
    <span ref="slotEl" class="flex items-center flex-shrink-0" :class="skin.root">
      <slot :chip-class="chipClass" />
    </span>
  </div>
</template>

<script>
export default {
  name: 'TagFilterBar',
}
</script>
