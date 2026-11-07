// 轻量 Markdown 渲染器（无第三方依赖，先转义再套结构，避免 XSS）。
// 支持：标题、粗体/斜体/删除线、行内代码、围栏代码块、引用、有序/无序列表、
// 分隔线、链接、图片、表格、段落。
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function inline(text) {
  const codes = []
  let t = escapeHtml(text).replace(/`([^`]+)`/g, (_, code) => {
    codes.push(code)
    return `\u0000${codes.length - 1}\u0000`
  })

  t = t
    .replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, '<img alt="$1" src="$2" />')
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
    )
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_\n]+)_/g, '$1<em>$2</em>')

  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`)
}

const TABLE_PIPE = '\u0001'

function splitTableRow(line) {
  let value = String(line).trim().replace(/\\\|/g, TABLE_PIPE)
  if (value.startsWith('|')) value = value.slice(1)
  if (value.endsWith('|')) value = value.slice(0, -1)
  return value.split('|').map((cell) => cell.trim().split(TABLE_PIPE).join('|'))
}

function isTableDelimiter(line) {
  const cells = splitTableRow(line)
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell))
}

function tableAlignment(cell) {
  const left = cell.startsWith(':')
  const right = cell.endsWith(':')
  return left && right ? 'center' : left ? 'left' : right ? 'right' : ''
}

export function renderMarkdown(source) {
  const lines = String(source || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')

  const html = []
  let listType = null
  let inCode = false
  let codeBuf = []

  const closeList = () => {
    if (listType) {
      html.push(listType === 'ul' ? '</ul>' : '</ol>')
      listType = null
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fence = line.match(/^```\s*([\w-]*)/)
    if (fence) {
      if (inCode) {
        html.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`)
        inCode = false
        codeBuf = []
      } else {
        closeList()
        inCode = true
        codeBuf = []
      }
      continue
    }

    if (inCode) {
      codeBuf.push(line)
      continue
    }

    if (!line.trim()) {
      closeList()
      continue
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/)
    if (heading) {
      closeList()
      const level = heading[1].length
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`)
      continue
    }

    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      closeList()
      html.push('<hr />')
      continue
    }

    const quote = line.match(/^>\s?(.*)$/)
    if (quote) {
      closeList()
      html.push(`<blockquote>${inline(quote[1])}</blockquote>`)
      continue
    }

    const ul = line.match(/^\s*[-*+]\s+(.*)$/)
    if (ul) {
      if (listType !== 'ul') {
        closeList()
        html.push('<ul>')
        listType = 'ul'
      }
      html.push(`<li>${inline(ul[1])}</li>`)
      continue
    }

    const ol = line.match(/^\s*\d+\.\s+(.*)$/)
    if (ol) {
      if (listType !== 'ol') {
        closeList()
        html.push('<ol>')
        listType = 'ol'
      }
      html.push(`<li>${inline(ol[1])}</li>`)
      continue
    }

    // 表格：当前行是表头，下一行是 | --- | :---: | 分隔行
    if (line.includes('|') && i + 1 < lines.length && isTableDelimiter(lines[i + 1])) {
      closeList()
      const headers = splitTableRow(line)
      const alignments = splitTableRow(lines[i + 1]).map(tableAlignment)
      const rows = []
      let j = i + 2
      while (j < lines.length) {
        const rowLine = lines[j]
        if (!rowLine.trim() || !rowLine.includes('|')) break
        rows.push(splitTableRow(rowLine))
        j++
      }

      const style = (index) =>
        alignments[index] ? ` style="text-align:${alignments[index]}"` : ''
      const head = headers
        .map((cell, index) => `<th${style(index)}>${inline(cell)}</th>`)
        .join('')
      const body = rows
        .map(
          (row) =>
            `<tr>${headers
              .map((_, index) => `<td${style(index)}>${inline(row[index] || '')}</td>`)
              .join('')}</tr>`,
        )
        .join('')

      html.push(
        `<div class="md-table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`,
      )
      i = j - 1
      continue
    }

    closeList()
    html.push(`<p>${inline(line)}</p>`)
  }

  closeList()
  if (inCode) {
    html.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`)
  }
  return html.join('\n')
}
