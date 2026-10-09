// 思维导图：把“缩进大纲文本”解析成树，并做水平方向的 tidy-tree 自动布局。
// 后端只存原文，解析与布局都在前端完成。

export const NODE_HEIGHT = 36
const V_GAP = 16
const H_GAP = 56
const MAX_WIDTH = 260
const MIN_WIDTH = 92

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

/** 单行文本的估算宽度（中日韩全角按 14px，其余按 8px 计）。 */
function estimateWidth(text) {
  let width = 0
  for (const ch of text) {
    width += /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\uff00-\uffef]/.test(ch) ? 14 : 8
  }
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width + 32))
}

/**
 * 生成可渲染的布局数据。
 * @returns {{nodes: Array, edges: Array, width: number, height: number}}
 * 每个 node: { text, depth, x, y, width, height }
 */
export function layoutMindmap(root) {
  const records = []
  const depthWidths = []

  // 1) DFS 建扁平记录，算出每层最大宽度作为列宽
  function build(node, depth, parent) {
    const index = records.length
    const width = estimateWidth(node.text || '')
    if (!depthWidths[depth] || width > depthWidths[depth]) depthWidths[depth] = width
    records.push({
      text: node.text || '',
      depth,
      width,
      parent,
      children: [],
      y: 0,
    })
    for (const child of node.children) {
      records[index].children.push(build(child, depth + 1, index))
    }
    return index
  }
  build(root, 0, -1)

  // 2) 列 x 坐标：逐层累计列宽 + 间距
  const columnX = []
  let cursorX = 0
  for (let depth = 0; depth < depthWidths.length; depth += 1) {
    columnX[depth] = cursorX
    cursorX += (depthWidths[depth] || MIN_WIDTH) + H_GAP
  }
  const totalWidth = Math.max(0, cursorX - H_GAP)

  // 3) 后序分配 y：叶子依次下移，父节点取首末子节点中点
  let cursorY = 0
  function assignY(index) {
    const node = records[index]
    if (node.children.length === 0) {
      node.y = cursorY
      cursorY += NODE_HEIGHT + V_GAP
      return node.y
    }
    const ys = node.children.map((child) => assignY(child))
    node.y = (ys[0] + ys[ys.length - 1]) / 2
    return node.y
  }
  assignY(0)

  const nodes = records.map((rec) => ({
    ...rec,
    x: columnX[rec.depth],
    height: NODE_HEIGHT,
  }))

  const edges = []
  nodes.forEach((node) => {
    if (node.parent < 0) return
    const parent = nodes[node.parent]
    edges.push({
      x1: parent.x + parent.width,
      y1: parent.y + NODE_HEIGHT / 2,
      x2: node.x,
      y2: node.y + NODE_HEIGHT / 2,
    })
  })

  return { nodes, edges, width: totalWidth, height: Math.max(cursorY - V_GAP, NODE_HEIGHT) }
}

/** 端到端：大纲文本 -> 布局数据（含根节点归并）。 */
export function buildMindmap(outline, title = '') {
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

  return layoutMindmap(root)
}
