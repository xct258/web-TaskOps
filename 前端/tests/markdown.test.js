import assert from 'node:assert/strict'
import test from 'node:test'

import { renderMarkdown } from '../src/utils/markdown.js'

test('Markdown 表格渲染为 table/thead/tbody', () => {
  const html = renderMarkdown(`主机：nas-backup

| 任务 | 状态 | 归档 | 大小 | 耗时 | 远端 |
| --- | --- | --- | --- | --- | --- |
| docker | 成功 | docker-20261108-031757.tar.zst.gpg | 998.2 KB | 19.6s | webdav:甲骨文-1-debian-2/2026-11-08/docker/docker-20261108-031757.tar.zst.gpg |`)

  assert.match(html, /<table>/)
  assert.match(html, /<thead><tr><th>任务<\/th>/)
  assert.match(html, /<td>docker<\/td>/)
  assert.match(html, /<td>webdav:甲骨文-1-debian-2\/2026-11-08\/docker\/docker-20261108-031757\.tar\.zst\.gpg<\/td>/)
  assert.doesNotMatch(html, /\| --- \|/)
  assert.doesNotMatch(html, /<p>\| 任务 \|/)
})

test('表格支持对齐和单元格行内格式', () => {
  const html = renderMarkdown(`| 左 | 中 | 右 |
| :--- | :---: | ---: |
| **粗体** | \`code\` | 结束 |`)

  assert.match(html, /<th style="text-align:left">左<\/th>/)
  assert.match(html, /<th style="text-align:center">中<\/th>/)
  assert.match(html, /<th style="text-align:right">右<\/th>/)
  assert.match(html, /<td style="text-align:left"><strong>粗体<\/strong><\/td>/)
  assert.match(html, /<td style="text-align:center"><code>code<\/code><\/td>/)
})

test('cron 表达式里的星号不会被当成斜体', () => {
  const html = renderMarkdown('调度：0 3 * * *（Asia/Shanghai）')

  assert.equal(html, '<p>调度：0 3 * * *（Asia/Shanghai）</p>')
  assert.doesNotMatch(html, /<em>/)
})

test('普通段落里的竖线不会被误判为表格', () => {
  const html = renderMarkdown('命令：cat file | grep xxx')

  assert.equal(html, '<p>命令：cat file | grep xxx</p>')
})

test('表格单元格会转义 HTML', () => {
  const html = renderMarkdown(`| 值 |
| --- |
| <script>alert(1)</script> |`)

  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.doesNotMatch(html, /<script>/)
})
