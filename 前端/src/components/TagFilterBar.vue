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

const tagsAreaEl = ref(null)
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
  const area = tagsAreaEl.value
  if (!area) return
  if (!props.tags.length) {
    visibleCount.value = 0
    return
  }
  // 间距直接读计算样式，免得和 size 里的 gap 类写死对不上
  const gap = parseFloat(getComputedStyle(area).columnGap) || 0
  const avail = area.clientWidth - 4 // 留 4px 取整余量：宁可少放一个，也不裁出半个标签
  let used = 0
  let count = 0
  for (let i = 0; i < props.tags.length; i += 1) {
    const width = measureTagEls[i]?.getBoundingClientRect().width ?? 0
    const add = count === 0 ? width : gap + width
    if (used + add > avail) break
    used += add
    count += 1
  }
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
  // 容器宽度变化（窗口缩放 / 右侧按钮增减）后重算；放 rAF 里避免 ResizeObserver 同帧反复回调
  observer = new ResizeObserver(() => requestAnimationFrame(measure))
  if (tagsAreaEl.value) observer.observe(tagsAreaEl.value)
})
onUnmounted(() => {
  document.removeEventListener('click', onOutside)
  document.removeEventListener('keydown', onKeydown)
  observer?.disconnect()
})

watch(() => props.tags, () => nextTick(measure))
</script>

<template>
  <div class="flex items-center font-mono" :class="skin.root">
    <!-- 量宽镜像行：不可见、不占位、不响应交互，只为 measure() 提供标签真实宽度。
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
    </div>

    <button :class="chipClass('ALL')" @click="select('ALL')">{{ allLabel }}</button>

    <!-- 可见标签区：flex-1 吸收压缩，多余部分裁掉（裁多少由 measure() 决定） -->
    <div ref="tagsAreaEl" class="flex-1 min-w-0 flex items-center overflow-hidden" :class="skin.root">
      <button v-for="tag in visibleTags" :key="tag" :class="chipClass(tag)" @click="select(tag)">
        {{ tag }}
      </button>
    </div>

    <!-- 额外筛选按钮（如书签页的「未分类」）：复用同一套 chip 样式，避免各页各写一份 -->
    <slot :chip-class="chipClass" />

    <!-- 折叠入口：放在裁切区之外，浮层才不会被 overflow-hidden 剪掉 -->
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
  </div>
</template>

<script>
export default {
  name: 'TagFilterBar',
}
</script>
