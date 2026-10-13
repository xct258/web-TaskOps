// 思维导图导出：把布局数据渲染成独立 SVG，并支持下载 SVG / PNG。
// 不依赖 DOM 中的节点元素，导出结果与画布上的配色一致。

import { BRANCH_COLORS, FONT_SIZE, LINE_HEIGHT, TONES } from './outline'

const BG = '#0b1120'
const PADDING = 24
const FONT_FAMILY =
  'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif'

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      default:
        return '&#39;'
    }
  })
}

function toneOf(depth) {
  return TONES[Math.min(Math.max(depth, 0), TONES.length - 1)]
}

function edgeColor(branch) {
  if (branch == null || branch < 0) return 'rgba(148,163,184,0.6)'
  return BRANCH_COLORS[((branch % BRANCH_COLORS.length) + BRANCH_COLORS.length) % BRANCH_COLORS.length]
}

/** 把布局数据转成独立 SVG 字符串。 */
export function layoutToSvg(layout) {
  const width = layout.width + PADDING * 2
  const contentRows = layout.nodes.filter((node) => String(node.content || '').trim())
  const contentHeight = contentRows.length ? 32 + contentRows.reduce((sum, node) => sum + String(node.content).split(/\r?\n/).length * 18 + 24, 0) : 0
  const height = layout.height + PADDING * 2 + contentHeight
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" fill="${BG}"/>`,
    `<g transform="translate(${PADDING},${PADDING})">`,
  ]

  for (const edge of layout.edges) {
    parts.push(
      `<path d="${edge.d}" fill="none" stroke="${edgeColor(edge.branch)}" stroke-width="1.5" stroke-linecap="round"/>`,
    )
  }

  for (const node of layout.nodes) {
    const tone = toneOf(node.depth)
    parts.push(
      `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="10" fill="${tone.fill}" stroke="${tone.border}" stroke-width="1"/>`,
    )
    const lines = node.lines || [node.text]
    const topOffset = (node.height - lines.length * LINE_HEIGHT) / 2
    lines.forEach((line, i) => {
      const y = node.y + topOffset + i * LINE_HEIGHT + LINE_HEIGHT / 2 + FONT_SIZE * 0.36
      const x = node.x + node.width / 2
      parts.push(
        `<text x="${x}" y="${y}" fill="${tone.text}" font-size="${FONT_SIZE}" font-family='${FONT_FAMILY}' font-weight="500" text-anchor="middle">${escapeXml(line)}</text>`,
      )
    })
  }

  parts.push('</g>')

  if (contentRows.length) {
    let y = layout.height + PADDING + 24
    parts.push(`<g transform="translate(${PADDING},${y})">`)
    parts.push(`<text x="0" y="0" fill="#cbd5e1" font-size="${FONT_SIZE + 1}" font-family='${FONT_FAMILY}' font-weight="600">节点内容</text>`)
    y = 24
    for (const node of contentRows) {
      parts.push(`<text x="0" y="${y}" fill="#f8fafc" font-size="${FONT_SIZE}" font-family='${FONT_FAMILY}' font-weight="600">${escapeXml(node.text || '未命名节点')}</text>`)
      y += 18
      for (const line of String(node.content).split(/\r?\n/)) {
        parts.push(`<text x="12" y="${y}" fill="#cbd5e1" font-size="${FONT_SIZE}" font-family='${FONT_FAMILY}'>${escapeXml(line)}</text>`)
        y += 18
      }
      y += 6
    }
    parts.push('</g>')
  }

  parts.push('</svg>')
  return parts.join('')
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** 下载 SVG 矢量图。 */
export function exportSvg(layout, filename) {
  downloadBlob(new Blob([layoutToSvg(layout)], { type: 'image/svg+xml;charset=utf-8' }), filename)
}

/** 下载 PNG 位图（默认 2 倍分辨率）。 */
export async function exportPng(layout, filename, pixelRatio = 2) {
  const svg = layoutToSvg(layout)
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  const width = layout.width + PADDING * 2
  const height = layout.height + PADDING * 2
  const image = await new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('SVG 渲染失败'))
    img.src = url
  })
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * pixelRatio))
  canvas.height = Math.max(1, Math.round(height * pixelRatio))
  const ctx = canvas.getContext('2d')
  ctx.scale(pixelRatio, pixelRatio)
  ctx.drawImage(image, 0, 0, width, height)
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('PNG 生成失败')
  downloadBlob(blob, filename)
}
