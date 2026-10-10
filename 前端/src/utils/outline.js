// 思维导图：把“缩进大纲文本”解析成树，再做自动布局。
// 支持两种布局：水平 tidy-tree（tree）与中心放射（radial）。
// 节点文本自动换行、按 depth 配色、按顶层分支着色连线。
// 后端只存原文，解析 / 布局 / 配色都在前端完成。

export const FONT_SIZE = 11
export const LINE_HEIGHT = 15
export const PAD_X = 10
export const PAD_Y = 6

const NODE_MIN_WIDTH = 84
const NODE_MAX_WIDTH = 240
const GAP_X = 54 // 水平树列/径向环间距
const GAP_Y = 14 // 同层节点垂直间距
const RING_GAP = 68 // 径向相邻环的基础间距
const MAX_LINES = 8 // 单节点最多换行数，超出省略

// 按 depth 循环取色：根节点（indigo）→ 主分支（slate-800）→ 叶子（slate-900）。
export const TONES = [
  { fill: '#4f46e5', border: '#818cf8', text: '#ffffff' },
  { fill: '#1e293b', border: 'rgba(255,255,255,0.18)', text: '#f1f5f9' },
  { fill: '#0f172a', border: 'rgba(255,255,255,0.14)', text: '#cbd5e1' },
]

// 连线按顶层分支循环取色，让同一大分支视觉同色。
export const BRANCH_COLORS = [
  '#818cf8',
  '#38bdf8',
  '#34d399',
  '#fbbf24',
  '#fb7185',
  '#a78bfa',
  '#22d3ee',
  '#fb923c',
  '#f472b6',
  '#4ade80',
]

export function toneForDepth(depth) {
  return TONES[Math.min(Math.max(depth, 0), TONES.length - 1)]
}

export function branchColor(branch) {
  const n = BRANCH_COLORS.length
  return BRANCH_COLORS[((branch % n) + n) % n]
}

/** 每行缩进宽度：Tab 记 2 空格，其余按前导空格数。 */
function indentWidth(line) {
  let width = 0
  for (const ch of line) {
    if (ch === ' ') width += 1
    else if (ch === '\t') width += 2
    else break
  }
  return width
}

/** 解析缩进大纲为节点树（合成一个空文本根节点）。 */
export function parseOutline(text) {
  const root = { text: '', children: [], indent: -1 }
  const stack = [root]

  for (const raw of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
    if (!raw.trim()) continue
    const indent = indentWidth(raw)
    const node = { text: raw.trim(), children: [], indent }
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop()
    stack[stack.length - 1].children.push(node)
    stack.push(node)
  }
  return root
}

/** 单字符估算宽度：中日韩全角按 11px，其余按 6px。 */
function charWidth(ch) {
  return /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\uff00-\uffef]/.test(ch) ? FONT_SIZE : 6
}

function textWidth(text) {
  let width = 0
  for (const ch of text) width += charWidth(ch)
  return width
}

/** 按宽度贪心换行，超过 MAX_LINES 截断并加省略号。 */
function wrapText(text, maxWidth) {
  const raw = String(text || '').trim() || '（空）'
  const lines = []
  let cur = ''
  let curW = 0
  for (const ch of raw) {
    const w = charWidth(ch)
    if (cur && curW + w > maxWidth) {
      if (lines.length === MAX_LINES - 1) {
        lines.push(`${cur}…`)
        return lines
      }
      lines.push(cur)
      cur = ''
      curW = 0
    }
    cur += ch
    curW += w
  }
  if (cur) lines.push(cur)
  return lines.length ? lines : ['（空）']
}

function measure(text) {
  const lines = wrapText(text, NODE_MAX_WIDTH - PAD_X * 2)
  const maxLine = lines.reduce((m, l) => Math.max(m, textWidth(l)), 0)
  const width = Math.min(NODE_MAX_WIDTH, Math.max(NODE_MIN_WIDTH, maxLine + PAD_X * 2))
  const height = lines.length * LINE_HEIGHT + PAD_Y * 2
  return { lines, width, height }
}

/** DFS 展平为记录数组；branch 记录所属的顶层分支序号（根为 -1）。 */
function buildRecords(root) {
  const records = []
  function build(node, depth, parent, branch) {
    const id = records.length
    const { lines, width, height } = measure(node.text)
    records.push({
      id,
      uid: node.uid ?? id,
      text: node.text || '',
      lines,
      depth,
      parent,
      branch,
      children: [],
      width,
      height,
      x: 0,
      y: 0,
    })
    node.children.forEach((child, i) => {
      records[id].children.push(build(child, depth + 1, id, depth === 0 ? i : branch))
    })
    return id
  }
  build(root, 0, -1, -1)
  return records
}

/** 水平树连线：从父右侧中点拐到子左侧中点的圆角折线。 */
function elbowPath(x1, y1, x2, y2) {
  if (x2 <= x1 + 0.5 || Math.abs(y2 - y1) < 0.5) return `M ${x1} ${y1} L ${x2} ${y2}`
  const midX = x1 + (x2 - x1) / 2
  const dir = y2 > y1 ? 1 : -1
  const r = Math.max(0, Math.min(12, Math.abs(y2 - y1) / 2, midX - x1, x2 - midX))
  return [
    `M ${x1} ${y1}`,
    `H ${midX - r}`,
    `Q ${midX} ${y1} ${midX} ${y1 + dir * r}`,
    `V ${y2 - dir * r}`,
    `Q ${midX} ${y2} ${midX + r} ${y2}`,
    `H ${x2}`,
  ].join(' ')
}

/** 从矩形中心朝目标方向射出，求与矩形边界的交点。 */
function rayRectExit(cx, cy, tx, ty, rect) {
  const dx = tx - cx
  const dy = ty - cy
  if (dx === 0 && dy === 0) return { x: cx, y: cy }
  const hw = rect.width / 2
  const hh = rect.height / 2
  const sx = dx !== 0 ? hw / Math.abs(dx) : Infinity
  const sy = dy !== 0 ? hh / Math.abs(dy) : Infinity
  const s = Math.min(sx, sy)
  return { x: cx + dx * s, y: cy + dy * s }
}

/** 水平 tidy-tree：按层分列，父节点在其子树块中垂直居中。 */
function layoutTree(records) {
  const depthMax = []
  for (const rec of records) depthMax[rec.depth] = Math.max(depthMax[rec.depth] || 0, rec.width)

  const columnX = []
  let cursorX = 0
  for (let depth = 0; depth < depthMax.length; depth += 1) {
    columnX[depth] = cursorX
    cursorX += (depthMax[depth] || NODE_MIN_WIDTH) + GAP_X
  }
  const width = Math.max(cursorX - GAP_X, 0)

  const blockH = new Array(records.length)
  function calcBlock(id) {
    const rec = records[id]
    if (!rec.children.length) {
      blockH[id] = rec.height
      return rec.height
    }
    let h = 0
    for (const child of rec.children) h += calcBlock(child)
    h += GAP_Y * (rec.children.length - 1)
    blockH[id] = h
    return h
  }
  calcBlock(0)

  function place(id, top) {
    const rec = records[id]
    rec.x = columnX[rec.depth]
    rec.y = top + (blockH[id] - rec.height) / 2
    let cy = top
    for (const child of rec.children) {
      place(child, cy)
      cy += blockH[child] + GAP_Y
    }
  }
  place(0, 0)

  const edges = []
  for (const rec of records) {
    if (rec.parent < 0) continue
    const parent = records[rec.parent]
    edges.push({
      parent: parent.id,
      child: rec.id,
      branch: rec.branch,
      d: elbowPath(
        parent.x + parent.width,
        parent.y + parent.height / 2,
        rec.x,
        rec.y + rec.height / 2,
      ),
    })
  }

  const height = Math.max(blockH[0] || 0, 1)
  return { nodes: records, edges, width, height, fontSize: FONT_SIZE, lineHeight: LINE_HEIGHT }
}

/** 中心放射：叶子均分角度，父节点取子树角度（圆环均值），环半径按同层节点数扩张。 */
function layoutRadial(records) {
  const leaves = records.filter((rec) => !rec.children.length)
  const total = leaves.length || 1

  leaves.forEach((rec, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / total
    rec._a = angle
    rec._sin = Math.sin(angle)
    rec._cos = Math.cos(angle)
    rec._cnt = 1
  })

  function aggregate(id) {
    const rec = records[id]
    if (!rec.children.length) return
    let sin = 0
    let cos = 0
    let cnt = 0
    for (const child of rec.children) {
      aggregate(child)
      const node = records[child]
      sin += node._sin
      cos += node._cos
      cnt += node._cnt
    }
    rec._sin = sin
    rec._cos = cos
    rec._cnt = cnt
    rec._a = Math.atan2(sin, cos)
  }
  if (records[0]) aggregate(0)

  const perDepth = []
  for (const rec of records) {
    const entry = (perDepth[rec.depth] = perDepth[rec.depth] || { count: 0, maxW: 0 })
    entry.count += 1
    entry.maxW = Math.max(entry.maxW, rec.width)
  }

  const radius = []
  for (let depth = 0; depth < perDepth.length; depth += 1) {
    if (depth === 0) {
      radius[0] = 0
      continue
    }
    const base =
      radius[depth - 1] + (perDepth[depth - 1]?.maxW || 0) / 2 + RING_GAP + perDepth[depth].maxW / 2
    const need = (perDepth[depth].count * (perDepth[depth].maxW + GAP_X)) / (2 * Math.PI)
    radius[depth] = Math.max(base, need)
  }

  for (const rec of records) {
    const r = radius[rec.depth]
    if (rec.depth === 0) {
      rec._cx = 0
      rec._cy = 0
    } else {
      rec._cx = r * Math.cos(rec._a)
      rec._cy = r * Math.sin(rec._a)
    }
  }

  const PAD = 16
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const rec of records) {
    minX = Math.min(minX, rec._cx - rec.width / 2)
    maxX = Math.max(maxX, rec._cx + rec.width / 2)
    minY = Math.min(minY, rec._cy - rec.height / 2)
    maxY = Math.max(maxY, rec._cy + rec.height / 2)
  }
  const offX = PAD - minX
  const offY = PAD - minY
  for (const rec of records) {
    rec._cx += offX
    rec._cy += offY
    rec.x = rec._cx - rec.width / 2
    rec.y = rec._cy - rec.height / 2
  }

  const edges = []
  for (const rec of records) {
    if (rec.parent < 0) continue
    const parent = records[rec.parent]
    const p1 = rayRectExit(parent._cx, parent._cy, rec._cx, rec._cy, parent)
    const p2 = rayRectExit(rec._cx, rec._cy, parent._cx, parent._cy, rec)
    edges.push({
      parent: parent.id,
      child: rec.id,
      branch: rec.branch,
      d: `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`,
    })
  }

  return {
    nodes: records,
    edges,
    width: Math.max(maxX - minX + PAD * 2, 1),
    height: Math.max(maxY - minY + PAD * 2, 1),
    fontSize: FONT_SIZE,
    lineHeight: LINE_HEIGHT,
  }
}

/**
 * 端到端：大纲文本 -> 布局数据（含根节点归并）。
 * @param {string} outline 缩进大纲
 * @param {string} title 标题（空大纲时作为根节点文本）
 * @param {'tree'|'radial'} layoutMode 布局方式
 * @returns {{nodes: Array, edges: Array, width: number, height: number, fontSize: number, lineHeight: number}}
 */
export function buildMindmap(outline, title = '', layoutMode = 'tree') {
  let root = parseOutline(outline)

  // 大纲只有一层子节点时，直接把它当根，避免多出一层空根。
  if (!root.text) {
    if (root.children.length === 1) {
      root = root.children[0]
    } else if (root.children.length === 0) {
      root = { text: title || '（空大纲）', children: [] }
    } else {
      root = { text: title || '中心主题', children: root.children }
    }
  }

  const records = buildRecords(root)
  return layoutMode === 'radial' ? layoutRadial(records) : layoutTree(records)
}

// ---------------------------------------------------------------------------
// 可编辑树：给每个节点分配稳定 uid，支持 树 <-> 大纲 互转与直接布局。
// 供“在导图界面内联编辑节点”使用。
// ---------------------------------------------------------------------------

let uidCounter = 0

export function newUid() {
  uidCounter += 1
  return `n${uidCounter}`
}

function withUid(node) {
  return { uid: newUid(), text: node.text || '', children: (node.children || []).map(withUid) }
}

/** 大纲文本 -> 可编辑树（含根节点归并，节点带 uid）。 */
export function treeFromOutline(outline, title = '') {
  const parsed = parseOutline(outline)
  let root = parsed
  if (!parsed.text) {
    if (parsed.children.length === 1) root = parsed.children[0]
    else if (parsed.children.length === 0) root = { text: title || '中心主题', children: [] }
    else root = { text: title || '中心主题', children: parsed.children }
  }
  return withUid(root)
}

/** 可编辑树 -> 缩进大纲文本。 */
export function outlineFromTree(root) {
  const lines = []
  function walk(node, depth) {
    lines.push(`${'  '.repeat(depth)}${String(node.text || '').trim()}`)
    for (const child of node.children) walk(child, depth + 1)
  }
  if (root) walk(root, 0)
  return lines.join('\n')
}

/** 直接对可编辑树做布局。 */
export function layoutFromTree(root, layoutMode = 'tree') {
  const records = buildRecords(root)
  return layoutMode === 'radial' ? layoutRadial(records) : layoutTree(records)
}

/** 深度优先查找 uid 对应节点，返回 { node, parent }。 */
export function findNode(root, uid, parent = null) {
  if (!root) return null
  if (root.uid === uid) return { node: root, parent }
  for (const child of root.children) {
    const found = findNode(child, uid, root)
    if (found) return found
  }
  return null
}

