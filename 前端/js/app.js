/* app.js：控制台前端逻辑（五视图 + 壁纸）。
 * 依赖：notify.js（Toast）、index.php 内联注入的 window.API_BASE。
 * 约定：渲染全部输出到 index.php 预置的容器；onclick 内联函数挂全局。
 * 添加/编辑走弹窗表单（遮罩单层滚动，键盘只滚表单不改页面布局）；
 * 删除走行内两步确认（点一次变“确认删？”，3 秒内再点执行）。
'use strict';

/* ═════════ 后端接口层（地址改这里一处即可；https 页面调 http 会被浏览器拦截） ═════════ */
var BACKEND = 'http://' + location.hostname + ':8000';

/* 全局在飞请求计数：网络慢时给统一加载反馈（延迟 180ms 显示，避免快请求闪一下）。
   首屏加载（_boot）期间不显示，内容登场后才开始提示。 */
var _pending = 0, _netTimer = null, _boot = true;
function netStart() {
  _pending++;
  if (_pending === 1) {
    if (_netTimer) clearTimeout(_netTimer);
    _netTimer = setTimeout(function () { if (_pending > 0 && !_boot) document.body.classList.add('loading'); }, 180);
  }
}
function netEnd() {
  _pending = Math.max(0, _pending - 1);
  if (_pending === 0) {
    if (_netTimer) { clearTimeout(_netTimer); _netTimer = null; }
    document.body.classList.remove('loading');
  }
}

function api(path, method, body) {
  /* GET 不带 Content-Type：跨域下避免多余 OPTIONS 预检，列表加载更快 */
  var opts = { method: method || 'GET' };
  if (body) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  /* 只有写操作（增/改/删）才显示「加载中…」；读取列表不打断体验 */
  var track = opts.method !== 'GET';
  if (track) netStart();
  return fetch(BACKEND + path, opts).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }).finally(function () { if (track) netEnd(); });
}

function $(id) { return document.getElementById(id); }

function esc(s) {
  var d = document.createElement('div');
  d.textContent = s == null ? '' : s;
  return d.innerHTML;
}

function todayStr() {
  /* 与后端一致：统一按 Asia/Shanghai 取当天（避免跨时区判断提醒/逾期不一致） */
  try {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  } catch (_e) {
    return new Date().toLocaleDateString('sv-SE');
  }
}
function daysUntil(iso) {
  if (!iso) return null;
  var a = new Date(String(iso).slice(0, 10) + 'T00:00:00');
  var b = new Date(todayStr() + 'T00:00:00');
  return Math.round((a - b) / 86400000);
}
/* 时间戳格式化：后端存的是带时区 UTC 串，统一按 Asia/Shanghai 显示到分钟 */
function fmtDateTime(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso).replace('T', ' ').slice(0, 16);
  try {
    return d.toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).replace(/\//g, '-');
  } catch (_e) {
    return String(iso).replace('T', ' ').slice(0, 16);
  }
}

/* 后端失败提示：2 秒内只弹一次，启动 4 路并行失败不再刷屏 */
var _failAt = 0;
function failToast() {
  var now = Date.now();
  if (now - _failAt < 2000) return;
  _failAt = now;
  Toast.error('后端连接失败');
}

/* 行内两步删除确认：第一次点变“确认删？”，3 秒内再点才执行 */
function armDelete(btn, fn) {
  if (btn.hasAttribute('data-armed')) {
    btn.removeAttribute('data-armed');
    btn.classList.remove('armed');
    btn.textContent = btn.getAttribute('data-orig') || '删除';
    fn();
    return;
  }
  if (!btn.hasAttribute('data-orig')) btn.setAttribute('data-orig', btn.textContent);
  btn.setAttribute('data-armed', '1');
  btn.classList.add('armed');
  btn.textContent = '确认删？';
  setTimeout(function () {
    if (btn.isConnected && btn.hasAttribute('data-armed')) {
      btn.removeAttribute('data-armed');
      btn.classList.remove('armed');
      btn.textContent = btn.getAttribute('data-orig') || '删除';
    }
  }, 3000);
}

/* 表单弹窗显隐与通用交互 */
function hideForm(id) {
  var el = $(id);
  el.hidden = true;
  el.style.removeProperty('--vvt');
  el.style.removeProperty('--vvh');
  closePicker();
  closeISelect();
  resetPageScroll();
  setTimeout(resetPageScroll, 200);
}
/* 打开表单弹窗：显示 → 贴合可视视口 → 置顶；桌面聚焦首字段（触屏不聚焦，避免键盘直接弹起） */
function openForm(wrapId, focusId) {
  var wrap = $(wrapId);
  closePicker();
  closeISelect();
  wrap.hidden = false;
  fitViewport(wrap);
  wrap.scrollTop = 0;
  var card = wrap.querySelector('.iform'); /* 卡片固定高度、内容内滚：打开回到顶部 */
  if (card) card.scrollTop = 0;
  resetPageScroll();
  var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  var f = focusId && $(focusId);
  if (f && !coarse) setTimeout(function () {
    try { f.focus({ preventScroll: true }); } catch (_e) { f.focus(); }
    if (f.select) { try { f.select(); } catch (_e) {} }
    resetPageScroll();
  }, 30);
}
/* 必填校验失败：标红 + 聚焦 */
function markInvalid(el) {
  if (!el) return;
  el.classList.add('invalid');
  el.focus();
}
/* 表单内 Enter 保存（textarea 换行除外）、Esc 关闭 */
function wireFormKeys(wrapId, saveFn) {
  $(wrapId).addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (_pick.field) { closePicker(); e.stopPropagation(); return; } /* 日历开着先收日历 */
      if (_isel) { closeISelect(); e.stopPropagation(); return; }       /* 下拉开着先收下拉 */
      hideForm(wrapId);
      return;
    }
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') { e.preventDefault(); saveFn(); }
  });
}
/* 输入即清除校验红框 */
document.addEventListener('input', function (e) {
  if (e.target && e.target.classList) e.target.classList.remove('invalid');
});
/* iOS 聚焦输入时会把页面/可视视口顶走：本页不滚动，统一压回原点，位置交给弹窗自身处理 */
function resetPageScroll() {
  if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
}
/* 点遮罩空白 / 任意位置 Esc 关闭已打开的弹窗 */
document.addEventListener('click', function (e) {
  var t = e.target;
  if (t && t.classList && t.classList.contains('iform-wrap')) hideForm(t.id);
});
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape') return;
  if (_pick.field) { closePicker(); return; } /* 日历优先收起，再关弹窗 */
  if (_isel) { closeISelect(); return; }       /* 下拉优先收起，再关弹窗 */
  var wraps = document.querySelectorAll('.iform-wrap');
  for (var i = 0; i < wraps.length; i++) { if (!wraps[i].hidden) hideForm(wraps[i].id); }
});

/* ═════════ 状态与缓存 ═════════ */
var DB = { reminders: [], ledger: [], servers: [], bookmarks: [], notes: [], mindmaps: [] };
var FQ = { reminders: '', expenses: '', servers: '', bookmarks: '', notes: '', mindmaps: '' };
var LT = {};

function matchQ(q, s) {
  return !q || String(s == null ? '' : s).toLowerCase().indexOf(q) !== -1;
}

/* 30 秒内且有缓存则直接重画，不发请求 */
function fresh(k) {
  return (Date.now() - (LT[k] || 0)) < 30000 && DB[k] && DB[k].length;
}

/* ═════════ 视图切换与标题 ═════════ */
var VIEW_MAP = { '主页': 'home', '仪表': 'dash', '待办': 'reminders', '笔记': 'notes', '记账': 'expenses', '监控': 'monitor', '书签': 'bookmarks', '思维导图': 'mindmaps' };
/* 右侧动作区按版块切换显隐；主页/仪表无动作 */
var ACTS = { '主页': '', '仪表': '', '待办': 'act-todo', '笔记': 'act-note', '记账': 'act-exp', '监控': 'act-mon', '书签': 'act-bm', '思维导图': 'act-mm' };
var SUBS = {};
var currentView = '主页';

function setSub(k, v) { if (SUBS[k] === v) return; SUBS[k] = v; syncTitle(); }

function syncTitle() {
  /* 主页是书签板：不设顶栏（body.home 切样式），只有「★ 书签」+「▦ 仪表」 */
  document.body.classList.toggle('home', currentView === '主页');
  $('view-ttl').style.display = (currentView === '主页') ? 'none' : '';
  $('view-title').textContent = currentView;
  $('view-sub').textContent = SUBS[currentView] || '';
  var show = ACTS[currentView] || '';
  for (var k in ACTS) {
    if (!ACTS.hasOwnProperty(k) || !ACTS[k]) continue;
    $(ACTS[k]).style.display = (ACTS[k] === show) ? '' : 'none';
  }
  var navBtns = document.querySelectorAll('.nav-item');
  for (var i = 0; i < navBtns.length; i++) {
    navBtns[i].classList.toggle('active', navBtns[i].getAttribute('data-view') === currentView);
  }
  /* 顶部搜索键：仅可搜索的版块显示；非搜索版块收起搜索框 */
  var scfg = SEARCH_VIEW[currentView] || null;
  $('act-search').style.display = scfg ? '' : 'none';
  if (scfg) $('search-input').placeholder = scfg.ph;
  else { $('searchbox').hidden = true; $('act-search').classList.remove('active'); }
}

/* 视图切换：display 硬切，无过渡。先挂新视图再摘旧视图，
   同一板块重复点击直接返回，避免重挂 .active 造成闪一下。 */
function goView(name) {
  if (name === currentView) return;
  var id = VIEW_MAP[name] || 'home';
  var next = $('view-' + id);
  if (next) next.classList.add('active');
  var views = document.querySelectorAll('.view');
  for (var i = 0; i < views.length; i++) { if (views[i] !== next) views[i].classList.remove('active'); }

  currentView = name;
  resetSearchFor(name); /* 切换版块收起搜索、清空过滤 */
  /* 主页只有书签；仪表汇总各路数据 */
  if (name === '主页') loadBookmarks();
  else if (name === '仪表') { loadReminders(); loadLedger(); loadServers(); loadBookmarks(); loadNotes(); loadMindMaps(); }
  else if (name === '待办') loadReminders();
  else if (name === '笔记') loadNotes();
  else if (name === '记账') loadLedger();
  else if (name === '监控') loadServers();
  else if (name === '书签') loadBookmarks();
  else if (name === '思维导图') loadMindMaps();
  syncTitle();
}

/* ═════════ 书签 ═════════ */
var BMCOLORS = [
  ['#60a5fa', 'rgba(96,165,250,.15)'],
  ['#22d3ee', 'rgba(34,211,238,.15)'],
  ['#fbbf24', 'rgba(251,191,36,.15)'],
  ['#34d399', 'rgba(52,211,153,.15)'],
  ['#fb7185', 'rgba(251,113,133,.15)'],
  ['#a78bfa', 'rgba(167,139,250,.15)']
];
function bmColor(s) {
  var h = 0;
  s = String(s || '?');
  for (var i = 0; i < s.length; i++) h = ((h * 31) + s.charCodeAt(i)) >>> 0;
  return BMCOLORS[h % BMCOLORS.length];
}
/* 书签副行：只显示描述，无描述则不渲染 */
function bmSub(b) {
  var d = b.description || '';
  return d ? '<small>' + esc(d) + '</small>' : '';
}
function bmCardHtml(b, withActions) {
  var c = bmColor(b.title);
  var letter = esc(String(b.title || '?').slice(0, 1));
  return '<div class="bm-card">' +
    '<a target="_blank" rel="noopener" href="' + esc(b.url) + '" onclick="hitBookmark(' + b.id + ')">' +
    '<span class="bm-icon" style="color:' + c[0] + ';background:' + c[1] + ';border-color:' + c[0] + '55">' + letter + '</span>' +
    '<span class="bm-txt"><b>' + esc(b.title) + '</b>' + bmSub(b) + '</span></a>' +
    (withActions
      ? '<button class="bm-del" title="删除" onclick="delBookmark(this,' + b.id + ')">✕</button>' +
        '<button class="bm-edit" title="编辑" onclick="openEditBookmarkForm(' + b.id + ')">编辑</button>'
      : '') +
    '</div>';
}
function bmGridHtml(list, withActions) {
  var groups = {}, order = [], i, g;
  for (i = 0; i < list.length; i++) {
    g = (list[i].tags && list[i].tags[0]) || '未分类';
    if (!groups[g]) { groups[g] = []; order.push(g); }
    groups[g].push(list[i]);
  }
  return order.map(function (cat) {
    return '<div class="bm-cat">' + esc(cat) + '</div><div class="bm-grid">' +
      groups[cat].map(function (b) { return bmCardHtml(b, withActions); }).join('') +
      '</div>';
  }).join('');
}
function hitBookmark(id) {
  for (var i = 0; i < DB.bookmarks.length; i++) {
    if (DB.bookmarks[i].id === id) DB.bookmarks[i].visit_count = (Number(DB.bookmarks[i].visit_count) || 0) + 1;
  }
  api('/bookmarks/' + id + '/visit', 'POST').catch(function () {});
}
/* 主页：只显示书签 */
function paintHome() {
  var bm = DB.bookmarks || [];
  $('home-bookmarks').innerHTML = bm.length
    ? bmGridHtml(bm, false)
    : '<div class="empty"><i>★</i>暂无书签</div>';
}

/* 仪表：各版块简略消息（点击卡片进对应版块） */
function paintDash() {
  var today = todayStr();
  var unp = (DB.reminders || []).filter(function (r) { return !r.processed; });
  var overdue = unp.filter(function (r) {
    return r.need_remind && r.due_time && r.due_time !== NO_DATE && r.due_time < today;
  }).length;
  var todayN = unp.filter(function (r) {
    return r.need_remind && r.due_time && r.due_time !== NO_DATE && r.due_time === today;
  }).length;
  var futureN = unp.filter(function (r) {
    return r.need_remind && !remindArrived(r);
  }).length;
  $('dash-todo').textContent = unp.length ? unp.length + ' 项' : '全部完成';
  $('dash-todo').className = 'dash-v ' + (unp.length ? 'c-warn' : 'c-ok');
  var subParts = [];
  if (overdue) subParts.push('逾期 ' + overdue);
  if (todayN) subParts.push('今日 ' + todayN);
  if (futureN) subParts.push('未到 ' + futureN);
  $('dash-todo-sub').textContent = unp.length ? (subParts.length ? subParts.join(' · ') : '暂无逾期') : '';

  var list = DB.servers || [];
  var bad = list.filter(function (s) { return !s.is_success; });
  $('dash-mon').textContent = !list.length ? '无数据' : (bad.length ? bad.length + ' 异常' : '全部正常');
  $('dash-mon').className = 'dash-v ' + (!list.length ? 'muted' : (bad.length ? 'c-bad' : 'c-ok'));
  $('dash-mon-sub').textContent = list.length ? list.length + ' 个服务' : '';

  $('dash-bm').textContent = (DB.bookmarks || []).length + ' 个';
  $('dash-bm').className = 'dash-v c-blue';
  $('dash-bm-sub').textContent = '';

  $('dash-note').textContent = (DB.notes || []).length + ' 篇';
  $('dash-note').className = 'dash-v c-cyan';
  $('dash-note-sub').textContent = '';

  $('dash-mm').textContent = (DB.mindmaps || []).length + ' 张';
  $('dash-mm').className = 'dash-v c-blue';
  $('dash-mm-sub').textContent = '';

  /* 主页「仪表」键：仅「需要提醒且已到提醒日」的待办 + 服务异常才算重要消息；
     无提醒的待办不改变按键样式 */
  var dash = $('act-dash');
  if (dash) {
    var dueTodos = (DB.reminders || []).filter(function (r) {
      return !r.processed && r.need_remind && remindArrived(r);
    }).length;
    var n = dueTodos + bad.length;
    dash.classList.toggle('alert', n > 0);
    var badge = $('dash-badge');
    badge.hidden = (n === 0);
    badge.textContent = n > 99 ? '99+' : (n || '');
  }

  updateDashMoney();
}
function paintBookmarks(list) {
  DB.bookmarks = list;
  var f = list.filter(function (b) {
    return matchQ(FQ.bookmarks, b.title) || matchQ(FQ.bookmarks, b.url) || matchQ(FQ.bookmarks, (b.tags || []).join(' '));
  });
  $('list-bookmarks').innerHTML = f.length
    ? bmGridHtml(f, true)
    : '<div class="empty"><i>★</i>' + (list.length ? '无匹配' : '暂无书签') + '</div>';
  paintHome();
  paintDash();
}
function loadBookmarks(force) {
  if (!force && fresh('bookmarks')) { paintBookmarks(DB.bookmarks); return Promise.resolve(); }
  return api('/bookmarks').then(function (d) { LT.bookmarks = Date.now(); paintBookmarks(d); }).catch(function () {
    failToast();
    $('list-bookmarks').innerHTML = '<div class="empty"><i>★</i>加载失败</div>';
  });
}
function delBookmark(btn, id) {
  var b = null, i;
  for (i = 0; i < DB.bookmarks.length; i++) { if (DB.bookmarks[i].id === id) b = DB.bookmarks[i]; }
  if (!b) return;
  armDelete(btn, function () {
    api('/bookmarks/' + id, 'DELETE').then(function () {
      Toast.success('已删除');
      loadBookmarks(true);
    }).catch(failToast);
  });
}
/* 书签新建/编辑：书签版块内联表单 */
function openBookmarkForm() {
  $('fb-id').value = '';
  $('fb-heading').textContent = '新建书签';
  $('fb-title').value = '';
  $('fb-url').value = '';
  $('fb-desc').value = '';
  $('fb-tags').value = '';
  openForm('iform-bookmarks', 'fb-title');
}
function openEditBookmarkForm(id) {
  var b = null;
  for (var i = 0; i < DB.bookmarks.length; i++) {
    if (DB.bookmarks[i].id === id) b = DB.bookmarks[i];
  }
  if (!b) return;
  if (currentView !== '书签') goView('书签');
  $('fb-id').value = b.id;
  $('fb-heading').textContent = '编辑书签';
  $('fb-title').value = b.title || '';
  $('fb-url').value = b.url || '';
  $('fb-desc').value = b.description || '';
  $('fb-tags').value = (b.tags || []).join(', ');
  openForm('iform-bookmarks', 'fb-title');
}
/* 链接没写协议时自动补：本机/内网 IP 用 http，其余 https */
function fixUrl(u) {
  u = String(u || '').trim();
  if (!u || /^[a-z][a-z0-9+.-]*:\/\//i.test(u)) return u;
  var local = /^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?([\/?#]|$)/i.test(u);
  return (local ? 'http://' : 'https://') + u;
}
function saveBookmarkForm() {
  var id = $('fb-id').value;
  var title = $('fb-title').value.trim();
  var url = fixUrl($('fb-url').value);
  if (!title) { markInvalid($('fb-title')); Toast.warning('标题必填'); return; }
  if (!url) { markInvalid($('fb-url')); Toast.warning('链接必填'); return; }
  var tagArr = $('fb-tags').value.split(',').map(function (t) { return t.trim(); }).filter(function (t) { return t; });
  var body = { title: title, url: url, description: $('fb-desc').value.trim() || null, tags: tagArr };
  if (id) {
    api('/bookmarks/' + id, 'PUT', body).then(function () {
      Toast.success('已保存');
      hideForm('iform-bookmarks');
      loadBookmarks(true);
    }).catch(failToast);
  } else {
    api('/bookmarks', 'POST', body).then(function () {
      Toast.success('已保存书签');
      hideForm('iform-bookmarks');
      loadBookmarks(true);
    }).catch(failToast);
  }
}

/* ═════════ 笔记（数据走 /notes，正文 Markdown 前端渲染） ═════════ */
/* 行内 Markdown：`代码` / **粗体** / *斜体* / [文字](链接)。入参须已转义。 */
function mdInline(s) {
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return s;
}
/* 块级 Markdown：标题 / 无序·有序列表 / 引用 / 代码块 / 分隔线 / 段落。 */
function mdToHtml(src) {
  var lines = String(src == null ? '' : src).replace(/\r\n?/g, '\n').split('\n');
  var out = [], inUl = false, inOl = false, inQuote = false, inCode = false, buf = [];
  function closeLists() { if (inUl) { out.push('</ul>'); inUl = false; } if (inOl) { out.push('</ol>'); inOl = false; } }
  function closeQuote() { if (inQuote) { out.push('</blockquote>'); inQuote = false; } }
  for (var i = 0; i < lines.length; i++) {
    var ln = lines[i];
    if (inCode) {
      if (/^```/.test(ln)) { out.push('<pre><code>' + esc(buf.join('\n')) + '</code></pre>'); buf = []; inCode = false; }
      else buf.push(ln);
      continue;
    }
    if (/^```/.test(ln)) { closeLists(); closeQuote(); inCode = true; continue; }
    if (!ln.trim()) { closeLists(); closeQuote(); continue; }
    var h = ln.match(/^(#{1,6})\s+(.*)$/);
    if (h) { closeLists(); closeQuote(); var lv = h[1].length; out.push('<h' + lv + '>' + mdInline(esc(h[2])) + '</h' + lv + '>'); continue; }
    if (/^\s*>\s?/.test(ln)) { closeLists(); if (!inQuote) { out.push('<blockquote>'); inQuote = true; } out.push('<p>' + mdInline(esc(ln.replace(/^\s*>\s?/, ''))) + '</p>'); continue; }
    closeQuote();
    if (/^\s*[-*+]\s+/.test(ln)) { if (inOl) { out.push('</ol>'); inOl = false; } if (!inUl) { out.push('<ul>'); inUl = true; } out.push('<li>' + mdInline(esc(ln.replace(/^\s*[-*+]\s+/, ''))) + '</li>'); continue; }
    if (/^\s*\d+[.)]\s+/.test(ln)) { if (inUl) { out.push('</ul>'); inUl = false; } if (!inOl) { out.push('<ol>'); inOl = true; } out.push('<li>' + mdInline(esc(ln.replace(/^\s*\d+[.)]\s+/, ''))) + '</li>'); continue; }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(ln)) { closeLists(); out.push('<hr>'); continue; }
    closeLists();
    out.push('<p>' + mdInline(esc(ln)) + '</p>');
  }
  if (inCode) out.push('<pre><code>' + esc(buf.join('\n')) + '</code></pre>');
  closeLists(); closeQuote();
  return out.join('');
}
function noteTagsHtml(n) {
  var t = n.tags || [];
  return t.length
    ? '<div class="note-tags">' + t.map(function (x) { return '<span class="ntag">' + esc(x) + '</span>'; }).join('') + '</div>'
    : '';
}
function noteCardHtml(n) {
  var upd = fmtDateTime(n.updated_at);
  return '<article class="note-card">' +
    '<div class="note-head"><b class="note-title">' + esc(n.title) + '</b>' +
      '<span class="note-acts">' +
        '<button class="link blue" onclick="openEditNoteForm(' + n.id + ')">编辑</button>' +
        '<button class="link bad" onclick="delNote(this,' + n.id + ')">删除</button>' +
      '</span></div>' +
    noteTagsHtml(n) +
    '<div class="note-body md">' + mdToHtml(n.content || '') + '</div>' +
    (upd ? '<div class="note-meta">更新 ' + esc(upd) + '</div>' : '') +
    '</article>';
}
function paintNotes(list) {
  DB.notes = list;
  var f = list.filter(function (n) {
    return matchQ(FQ.notes, n.title) || matchQ(FQ.notes, n.content) || matchQ(FQ.notes, (n.tags || []).join(' '));
  });
  $('list-notes').innerHTML = f.length
    ? f.map(noteCardHtml).join('')
    : '<div class="empty"><i>✎</i>' + (list.length ? '无匹配' : '暂无笔记') + '</div>';
  setSub('笔记', list.length ? list.length + ' 篇' : '');
  paintDash();
}
function loadNotes(force) {
  if (!force && fresh('notes')) { paintNotes(DB.notes); return Promise.resolve(); }
  return api('/notes').then(function (d) { LT.notes = Date.now(); paintNotes(d); }).catch(function () {
    failToast();
    $('list-notes').innerHTML = '<div class="empty"><i>✎</i>加载失败</div>';
  });
}
function delNote(btn, id) {
  armDelete(btn, function () {
    api('/notes/' + id, 'DELETE').then(function () { Toast.success('已删除'); loadNotes(true); }).catch(failToast);
  });
}
function openNoteForm() {
  $('fn-id').value = '';
  $('fn-heading').textContent = '新建笔记';
  $('fn-title').value = '';
  $('fn-tags').value = '';
  $('fn-content').value = '';
  openForm('iform-notes', 'fn-title');
}
function openEditNoteForm(id) {
  var n = null;
  for (var i = 0; i < DB.notes.length; i++) { if (DB.notes[i].id === id) n = DB.notes[i]; }
  if (!n) return;
  if (currentView !== '笔记') goView('笔记');
  $('fn-id').value = n.id;
  $('fn-heading').textContent = '编辑笔记';
  $('fn-title').value = n.title || '';
  $('fn-tags').value = (n.tags || []).join(', ');
  $('fn-content').value = n.content || '';
  openForm('iform-notes', 'fn-title');
}
function saveNoteForm() {
  var id = $('fn-id').value;
  var title = $('fn-title').value.trim();
  if (!title) { markInvalid($('fn-title')); Toast.warning('标题必填'); return; }
  var tagArr = $('fn-tags').value.split(',').map(function (t) { return t.trim(); }).filter(function (t) { return t; });
  var body = { title: title, content: $('fn-content').value, tags: tagArr };
  var req = id ? api('/notes/' + id, 'PUT', body) : api('/notes', 'POST', body);
  req.then(function () { Toast.success('已保存'); hideForm('iform-notes'); loadNotes(true); }).catch(failToast);
}

/* ═════════ 思维导图（数据走 /mindmaps，大纲文本 → 自动布局导图） ═════════ */
var MM_COLORS = ['#22d3ee', '#60a5fa', '#a78bfa', '#34d399', '#fbbf24', '#fb7185'];
var _mmSeq = 0;            /* 节点自增 key（稳定，增删后仍指向同一节点） */
var _mmRoot = null;        /* 当前编辑中的树 */
var _mmCollapsed = {};     /* 节点 key → 折叠态 */
var _mmSelectedKey = null; /* 当前选中的节点 key */
var _mmView = { x: 0, y: 0, k: 1 };
var _mmBBox = null;
function mmNewKey() { return ++_mmSeq; }
/* 估算文字像素宽：CJK/全角按 13px、其余 7.2px（用于节点宽度，无需精确） */
function mmTextWidth(s) {
  s = String(s || '');
  var w = 0;
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    var wide = c >= 0x1100 && (c <= 0x115f || c === 0x2329 || c === 0x232a || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6));
    w += wide ? 13 : 7.2;
  }
  return w;
}
/* 给节点及其子树统一上色（同一分支同色） */
function mmColor(node, color) {
  node.color = color;
  for (var i = 0; i < node.children.length; i++) mmColor(node.children[i], color);
}
/* 重排分支色：根用主题色，根的直接子节点各取一色，其后代继承 */
function mmRecolor(root) {
  if (!root) return;
  root.color = MM_COLORS[0];
  for (var i = 0; i < root.children.length; i++) mmColor(root.children[i], MM_COLORS[i % MM_COLORS.length]);
}
/* 解析缩进大纲为树；withKeys 时赋稳定 key（列表预览不需要）。 */
function mmParse(text, withKeys) {
  var lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
  var items = [];
  for (var i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    var m = lines[i].match(/^([ \t]*)(.*)$/);
    var ind = 0, s = m[1];
    for (var j = 0; j < s.length; j++) ind += (s[j] === '\t' ? 4 : 1);
    items.push({ indent: ind, label: m[2].replace(/\s+$/, '') || '(空)' });
  }
  if (!items.length) return null;
  if (withKeys) _mmSeq = 0;
  var root = { label: items[0].label, indent: items[0].indent, children: [], depth: 0, key: withKeys ? mmNewKey() : 0 };
  var stack = [root];
  for (var k = 1; k < items.length; k++) {
    var it = items[k];
    while (stack.length > 1 && stack[stack.length - 1].indent >= it.indent) stack.pop();
    var parent = stack[stack.length - 1];
    var node = { label: it.label, indent: it.indent, children: [], depth: parent.depth + 1, key: withKeys ? mmNewKey() : 0 };
    parent.children.push(node);
    stack.push(node);
  }
  mmRecolor(root);
  return root;
}
/* 序列化回缩进大纲（持久化格式）：每层缩进两个空格。 */
function mmSerialize(node, depth) {
  var pad = '', i;
  for (i = 0; i < depth; i++) pad += '  ';
  var lines = [pad + node.label];
  for (i = 0; i < node.children.length; i++) lines.push(mmSerialize(node.children[i], depth + 1));
  return lines.join('\n');
}

/* 分层布局：列按深度排（列宽取该层最宽节点），行取叶子游标、父节点居中。 */
function mmLayout(root) {
  var VGAP = 34, HGAP = 46, PADX = 12, NODEH = 30;
  var cols = [], cursor = 0, placed = [];
  function width(n) { return Math.max(56, Math.min(240, PADX * 2 + mmTextWidth(n.label))); }
  (function walk(n) {
    (cols[n.depth] = cols[n.depth] || []).push(n);
    if (!_mmCollapsed[n.key]) for (var i = 0; i < n.children.length; i++) walk(n.children[i]);
  })(root);
  var colX = [0];
  for (var d = 1; d < cols.length; d++) {
    var pmax = 0;
    for (var i = 0; i < cols[d - 1].length; i++) pmax = Math.max(pmax, width(cols[d - 1][i]));
    colX[d] = colX[d - 1] + pmax + HGAP;
  }
  (function place(n) {
    n._w = width(n);
    n._x = colX[n.depth];
    var kids = _mmCollapsed[n.key] ? [] : n.children;
    if (!kids.length) { n._y = cursor; cursor += VGAP; }
    else {
      for (var i = 0; i < kids.length; i++) place(kids[i]);
      n._y = (kids[0]._y + kids[kids.length - 1]._y) / 2;
    }
    placed.push(n);
  })(root);
  var edges = [];
  (function edgeOf(n) {
    var kids = _mmCollapsed[n.key] ? [] : n.children;
    for (var i = 0; i < kids.length; i++) { edges.push([n, kids[i]]); edgeOf(kids[i]); }
  })(root);
  var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (var j = 0; j < placed.length; j++) {
    var n = placed[j];
    minX = Math.min(minX, n._x); maxX = Math.max(maxX, n._x + n._w);
    minY = Math.min(minY, n._y - NODEH / 2); maxY = Math.max(maxY, n._y + NODEH / 2);
  }
  return { nodes: placed, edges: edges, bbox: { minX: minX, minY: minY, maxX: maxX, maxY: maxY }, NODEH: NODEH, PADX: PADX };
}

function mmApplyTransform() {
  var g = $('mm-view');
  if (g) g.setAttribute('transform', 'translate(' + _mmView.x + ' ' + _mmView.y + ') scale(' + _mmView.k + ')');
}
function mmZoom(dir) {
  var stage = $('mm-stage');
  var cx = (stage.clientWidth || 400) / 2, cy = (stage.clientHeight || 300) / 2;
  var f = dir > 0 ? 1.2 : 1 / 1.2;
  _mmView.k = Math.max(0.2, Math.min(3, _mmView.k * f));
  _mmView.x = cx - (cx - _mmView.x) * f;
  _mmView.y = cy - (cy - _mmView.y) * f;
  mmApplyTransform();
}
function mmFit() {
  if (!_mmBBox) return;
  var stage = $('mm-stage');
  var W = stage.clientWidth || 400, H = stage.clientHeight || 300;
  var bw = Math.max(1, _mmBBox.maxX - _mmBBox.minX), bh = Math.max(1, _mmBBox.maxY - _mmBBox.minY);
  var k = Math.max(0.2, Math.min(1.6, Math.min((W - 48) / bw, (H - 48) / bh)));
  _mmView.k = k;
  _mmView.x = (W - bw * k) / 2 - _mmBBox.minX * k;
  _mmView.y = (H - bh * k) / 2 - _mmBBox.minY * k;
  mmApplyTransform();
}
function mmRender() {
  var root = _mmRoot;
  var svg = $('mm-svg');
  if (!root) { svg.innerHTML = ''; _mmBBox = null; mmSyncTools(); return; }
  var L = mmLayout(root), H = L.NODEH, PADX = L.PADX, parts = ['<g id="mm-view">'];
  for (var i = 0; i < L.edges.length; i++) {
    var e0 = L.edges[i][0], e1 = L.edges[i][1];
    var x1 = e0._x + e0._w, y1 = e0._y, x2 = e1._x, y2 = e1._y, mx = (x1 + x2) / 2;
    parts.push('<path class="mm-link" d="M' + x1 + ' ' + y1 + ' C' + mx + ' ' + y1 + ' ' + mx + ' ' + y2 + ' ' + x2 + ' ' + y2 + '" style="stroke:' + e1.color + '"/>');
  }
  for (var j = 0; j < L.nodes.length; j++) {
    var n = L.nodes[j];
    var col = _mmCollapsed[n.key];
    var cls = 'mm-node d' + Math.min(n.depth, 4) + (col ? ' collapsed' : '') + (n.depth === 0 ? ' root' : '') + (n.key === _mmSelectedKey ? ' sel' : '');
    var x = n._x, y = n._y - H / 2;
    parts.push('<g class="' + cls + '" style="--mmc:' + n.color + '" data-key="' + n.key + '">' +
      '<rect x="' + x + '" y="' + y + '" width="' + n._w + '" height="' + H + '" rx="8"/>' +
      '<text x="' + (x + PADX) + '" y="' + n._y + '">' + esc(n.label) + '</text>' +
      (n.children.length ? '<text class="mm-toggle" x="' + (x + n._w + 3) + '" y="' + n._y + '" data-toggle="1">' + (col ? '＋' : '－') + '</text>' : '') +
      '</g>');
  }
  parts.push('</g>');
  svg.innerHTML = parts.join('');
  _mmBBox = L.bbox;
  mmApplyTransform();
  mmSyncTools();
}

/* ── 图上直接操作：查找 / 选中 / 增删改 ── */
function mmFindNode(key) {
  var found = null;
  (function walk(n) {
    if (found || !n) return;
    if (n.key === key) { found = n; return; }
    for (var i = 0; i < n.children.length; i++) walk(n.children[i]);
  })(_mmRoot);
  return found;
}
function mmFindParent(root, node) {
  if (!root) return null;
  for (var i = 0; i < root.children.length; i++) {
    if (root.children[i] === node) return root;
    var p = mmFindParent(root.children[i], node);
    if (p) return p;
  }
  return null;
}
function mmSelect(key) { _mmSelectedKey = key; mmRender(); }
function mmSyncTools() {
  var bar = $('mm-node-tools');
  if (!bar) return;
  var node = _mmSelectedKey != null ? mmFindNode(_mmSelectedKey) : null;
  bar.hidden = !node;
  if (!node) return;
  $('mm-sel-label').textContent = node.label;
  var isRoot = !mmFindParent(_mmRoot, node);
  $('mm-btn-sibling').disabled = isRoot;
  $('mm-btn-delete').disabled = isRoot;
}
function mmAddChild() {
  var parent = _mmSelectedKey != null ? mmFindNode(_mmSelectedKey) : _mmRoot;
  if (!parent) return false;
  var node = { label: '新节点', children: [], depth: parent.depth + 1, indent: 0, key: mmNewKey() };
  parent.children.push(node);
  _mmCollapsed[parent.key] = false;
  mmRecolor(_mmRoot);
  _mmSelectedKey = node.key;
  mmRender();
  mmBeginRename(node);
  return false;
}
function mmAddSibling() {
  var sel = _mmSelectedKey != null ? mmFindNode(_mmSelectedKey) : null;
  if (!sel) return mmAddChild();
  var parent = mmFindParent(_mmRoot, sel);
  if (!parent) return false; /* 根节点没有同级 */
  var node = { label: '新节点', children: [], depth: sel.depth, indent: 0, key: mmNewKey() };
  parent.children.splice(parent.children.indexOf(sel) + 1, 0, node);
  mmRecolor(_mmRoot);
  _mmSelectedKey = node.key;
  mmRender();
  mmBeginRename(node);
  return false;
}
function mmDeleteNode() {
  var sel = _mmSelectedKey != null ? mmFindNode(_mmSelectedKey) : null;
  if (!sel) return false;
  var parent = mmFindParent(_mmRoot, sel);
  if (!parent) { Toast.warning('中心主题不能删除'); return false; }
  parent.children.splice(parent.children.indexOf(sel), 1);
  delete _mmCollapsed[sel.key];
  _mmSelectedKey = parent.key;
  mmRecolor(_mmRoot);
  mmRender();
  return false;
}
function mmRenameSelected() {
  var node = _mmSelectedKey != null ? mmFindNode(_mmSelectedKey) : null;
  if (node) mmBeginRename(node);
  return false;
}
/* 就地重命名：把输入框浮到节点上，回车/失焦提交，Esc 取消 */
var _mmRenaming = null;
function mmBeginRename(node) {
  if (!node) return;
  var inp = $('mm-rename');
  if (!inp) return;
  _mmRenaming = node;
  inp.value = node.label === '(空)' ? '' : node.label;
  var k = _mmView.k;
  inp.style.left = Math.round(_mmView.x + node._x * k) + 'px';
  inp.style.top = Math.round(_mmView.y + (node._y - 15) * k) + 'px';
  inp.style.width = Math.round(Math.max(96, node._w * k)) + 'px';
  inp.hidden = false;
  setTimeout(function () { try { inp.focus(); inp.select(); } catch (_e) {} }, 0);
}
function mmCommitRename() {
  if (!_mmRenaming) return;
  var v = $('mm-rename').value.trim();
  if (v) _mmRenaming.label = v;
  _mmRenaming = null;
  $('mm-rename').hidden = true;
  mmRender();
}
function mmCancelRename() {
  _mmRenaming = null;
  $('mm-rename').hidden = true;
}

function mmCount(root) {
  if (!root) return 0;
  var n = 1;
  for (var i = 0; i < root.children.length; i++) n += mmCount(root.children[i]);
  return n;
}
function mmCardPreview(root) {
  var lines = [];
  (function walk(n, d) {
    if (lines.length >= 6) return;
    lines.push(new Array(d + 1).join('· ') + n.label);
    for (var i = 0; i < n.children.length; i++) walk(n.children[i], d + 1);
  })(root, 0);
  return '<pre class="mm-mini">' + esc(lines.join('\n')) + '</pre>';
}
function mmCardHtml(m) {
  var root = mmParse(m.outline || '', false);
  var upd = fmtDateTime(m.updated_at);
  return '<article class="mm-card">' +
    '<div class="mm-card-head"><b class="note-title">' + esc(m.title) + '</b>' +
      '<span class="note-acts">' +
        '<button class="link blue" onclick="openEditMindMapForm(' + m.id + ')">编辑</button>' +
        '<button class="link bad" onclick="delMindMap(this,' + m.id + ')">删除</button>' +
      '</span></div>' +
    '<div class="mm-card-sub">' + mmCount(root) + ' 个节点' + (upd ? ' · 更新 ' + esc(upd) : '') + '</div>' +
    '<div class="mm-card-preview">' + (root ? mmCardPreview(root) : '<span class="muted">空导图</span>') + '</div>' +
    '</article>';
}
function paintMindMaps(list) {
  DB.mindmaps = list;
  var f = list.filter(function (m) { return matchQ(FQ.mindmaps, m.title) || matchQ(FQ.mindmaps, m.outline); });
  $('list-mindmaps').innerHTML = f.length
    ? f.map(mmCardHtml).join('')
    : '<div class="empty"><i>❖</i>' + (list.length ? '无匹配' : '暂无思维导图') + '</div>';
  setSub('思维导图', list.length ? list.length + ' 张' : '');
  paintDash();
}
function loadMindMaps(force) {
  if (!force && fresh('mindmaps')) { paintMindMaps(DB.mindmaps); return Promise.resolve(); }
  return api('/mindmaps').then(function (d) { LT.mindmaps = Date.now(); paintMindMaps(d); }).catch(function () {
    failToast();
    $('list-mindmaps').innerHTML = '<div class="empty"><i>❖</i>加载失败</div>';
  });
}
function delMindMap(btn, id) {
  armDelete(btn, function () {
    api('/mindmaps/' + id, 'DELETE').then(function () { Toast.success('已删除'); loadMindMaps(true); }).catch(failToast);
  });
}

/* 新建时的默认骨架：中心主题 + 两个分支 */
function mmSeedRoot() {
  _mmSeq = 0;
  var root = { label: '中心主题', children: [], depth: 0, indent: 0, key: mmNewKey() };
  root.children.push({ label: '分支一', children: [], depth: 1, indent: 0, key: mmNewKey() });
  root.children.push({ label: '分支二', children: [], depth: 1, indent: 0, key: mmNewKey() });
  _mmRoot = root;
  mmRecolor(_mmRoot);
}
function mmResetEditor(root, title) {
  $('fm-title').value = title || '';
  _mmRoot = root;
  _mmCollapsed = {};
  _mmSelectedKey = null;
  _mmRenaming = null;
  var inp = $('mm-rename');
  if (inp) inp.hidden = true;
  _mmView = { x: 0, y: 0, k: 1 };
  openForm('iform-mindmaps', 'fm-title');
  requestAnimationFrame(function () { mmRender(); mmFit(); });
  setTimeout(function () { if (!$('iform-mindmaps').hidden) mmFit(); }, 200);
}
function openMindMapForm() {
  $('fm-id').value = '';
  $('fm-heading').textContent = '新建思维导图';
  mmSeedRoot();
  mmResetEditor(_mmRoot, '');
}
function openEditMindMapForm(id) {
  var m = null;
  for (var i = 0; i < DB.mindmaps.length; i++) { if (DB.mindmaps[i].id === id) m = DB.mindmaps[i]; }
  if (!m) return;
  if (currentView !== '思维导图') goView('思维导图');
  $('fm-id').value = m.id;
  $('fm-heading').textContent = '编辑思维导图';
  var root = mmParse(m.outline || '', true);
  if (!root) mmSeedRoot(); else _mmRoot = root;
  mmResetEditor(_mmRoot, m.title || '');
}
function saveMindMapForm() {
  var id = $('fm-id').value;
  var title = $('fm-title').value.trim();
  if (!title) { markInvalid($('fm-title')); Toast.warning('标题必填'); return; }
  if (!_mmRoot) { Toast.warning('导图为空'); return; }
  var body = { title: title, outline: mmSerialize(_mmRoot, 0) };
  var req = id ? api('/mindmaps/' + id, 'PUT', body) : api('/mindmaps', 'POST', body);
  req.then(function () { Toast.success('已保存'); hideForm('iform-mindmaps'); loadMindMaps(true); }).catch(failToast);
}

/* ═════════ 待办（数据走 /todos） ═════════ */
var CYCLE_TXT = { daily: '每天', weekly: '每周', monthly: '每月', month_start: '每月', yearly: '每年' };
var NO_DATE = '9999-12-31'; /* 后端免提醒哨兵日期，展示层直接跳过 */
function cycleTxt(r) {
  if (!r.recurring || r.cycle_mode === 'none') return '';
  if (r.cycle_mode === 'days') return '每' + (r.cycle_days || 1) + '天';
  return CYCLE_TXT[r.cycle_mode] || '循环';
}
/* 提醒日未到时不允许完成（一次性/循环同理）；无提醒日的随时可完成 */
function todoLocked(r) {
  if (r.processed || !r.need_remind) return false;
  var rd = (r.remind_time && r.remind_time !== NO_DATE) ? String(r.remind_time).slice(0, 10) : '';
  return !!rd && rd > todayStr();
}
/* 提醒是否已到：无提醒日 / 已完成 视为已到，其余按 remind_time <= 今天 */
function remindArrived(r) {
  if (r.processed || !r.need_remind) return true;
  var rd = (r.remind_time && r.remind_time !== NO_DATE) ? String(r.remind_time).slice(0, 10) : '';
  return !rd || rd <= todayStr();
}
var P_TXT = { '1': '低', '2': '中', '3': '高' };
/* 日期压缩：同年只显示 MM-DD，跨年才带年份 */
function shortDate(s) {
  if (!s || s === NO_DATE) return '';
  s = String(s).slice(0, 10);
  return s.slice(0, 4) === todayStr().slice(0, 4) ? s.slice(5) : s;
}
function reminderRowHtml(r) {
  var today = todayStr();
  var pr = Number(r.priority) || 0;
  var locked = todoLocked(r);
  var tags = [];
  if (r.need_remind && r.due_time && r.due_time !== NO_DATE) {
    var late = !r.processed && r.due_time < today;
    var isToday = !r.processed && r.due_time === today;
    var cls = late ? 'tag-due late' : (isToday ? 'tag-due today' : 'tag-due');
    tags.push('<span class="tag ' + cls + '" title="到期日 ' + esc(String(r.due_time).slice(0, 10)) + '">到期 ' + esc(shortDate(r.due_time)) +
      (late ? ' · 逾期' : (isToday ? ' · 今天' : '')) + '</span>');
  }
  if (r.need_remind && r.remind_time && r.remind_time !== r.due_time && r.remind_time !== NO_DATE) {
    tags.push('<span class="tag tag-remind" title="提醒日 ' + esc(String(r.remind_time).slice(0, 10)) + '">提醒 ' + esc(shortDate(r.remind_time)) + '</span>');
  }
  /* 未到提醒：显示“还有 N 天” */
  if (r.need_remind && !r.processed && r.remind_time && r.remind_time !== NO_DATE && r.remind_time > today) {
    var dleft = daysUntil(r.remind_time);
    if (dleft != null && dleft > 0) tags.push('<span class="tag tag-soon">还有 ' + dleft + ' 天</span>');
  }
  var cyc = cycleTxt(r);
  if (cyc) tags.push('<span class="tag tag-cycle">' + esc(cyc) + '</span>');
  if (r.catch_up) tags.push('<span class="tag tag-catchup">补做</span>');
  if (r.recurring && r.last_completed_date && r.last_completed_date !== NO_DATE) tags.push('<span class="tag tag-last">上次 ' + esc(shortDate(r.last_completed_date)) + '</span>');

  var btitle = r.processed ? '重新打开（撤销完成）'
    : (locked ? '未到提醒日，' + String(r.remind_time).slice(0, 10) + ' 后可完成' : '完成');
  var doneBtn = r.processed
    ? '<button class="link ok" title="重新打开（撤销完成）" onclick="reopenReminder(' + r.id + ', this)">重开</button>'
    : '<button class="link ok" title="' + btitle + '"' + (locked ? ' disabled' : '') + ' onclick="doneReminder(' + r.id + ', this)">完成</button>';
  var snooze = (!r.processed && r.need_remind)
    ? '<button class="link" title="推迟' + (r.recurring ? '一个周期' : '一天') + '" onclick="snoozeReminder(' + r.id + ', this)">推迟</button>'
    : '';
  var undo = (r.id === _undoId) ? '<button class="link ok" onclick="undoReminder(' + r.id + ', this)">撤销</button>' : '';

  var prTag = pr ? '<span class="ptag p' + pr + '" title="' + (P_TXT[pr] || '') + '优先级">' + (P_TXT[pr] || '') + '</span>' : '';
  var desc = (r.title && r.content) ? '<div class="tdesc">' + esc(r.content) + '</div>' : '';
  var meta = tags.length ? '<div class="tmeta">' + tags.join('') + '</div>' : '';

  return '<div class="trow p' + pr + (r.processed ? ' done' : '') + (locked ? ' locked' : '') + '">' +
    '<span class="tbar" aria-hidden="true"></span>' +
    '<div class="tmain">' +
      '<div class="ttop"><span class="ttitle">' + esc(r.title || r.content) + '</span>' + prTag + '</div>' +
      desc + meta +
    '</div>' +
    '<div class="tacts">' + undo + doneBtn + snooze +
      '<button class="link blue" onclick="openEditReminderForm(' + r.id + ')">编辑</button>' +
      '<button class="link bad" onclick="delReminder(this,' + r.id + ')">删除</button>' +
    '</div>' +
    '</div>';
}
var _showFuture = false; /* 是否展开「未到提醒」分组 */
var _showDone = false;   /* 是否展开「已完成」分组 */
var _undoId = null;      /* 刚完成、短期可撤销的待办 id */
function toggleFutureReminders() { _showFuture = !_showFuture; paintReminders(DB.reminders); }
function toggleDoneReminders() { _showDone = !_showDone; paintReminders(DB.reminders); }
/* 组内排序：优先级高在前 → 到期日早在前（逾期自然靠前） → id */
function sortReminders(arr) {
  return arr.slice().sort(function (a, b) {
    var pa = Number(a.priority) || 0, pb = Number(b.priority) || 0;
    if (pa !== pb) return pb - pa;
    var da = (a.due_time && a.due_time !== NO_DATE) ? String(a.due_time) : '9999-99-99';
    var db = (b.due_time && b.due_time !== NO_DATE) ? String(b.due_time) : '9999-99-99';
    if (da !== db) return da < db ? -1 : 1;
    return (a.id || 0) - (b.id || 0);
  });
}
/* 分组标题：名称 + 数量角标 */
function tgroupHtml(name, n) {
  return '<div class="tgroup"><span class="tg-name">' + name + '</span><span class="tg-count">' + n + '</span></div>';
}
function paintReminders(list) {
  DB.reminders = list;
  var q = FQ.reminders;
  var matches = list.filter(function (r) { return matchQ(q, r.title) || matchQ(q, r.content); });
  /* 分组：无提醒 / 已到提醒 / 未到提醒（默认收起）/ 已完成（默认收起） */
  var noRemind = [], due = [], future = [], done = [];
  matches.forEach(function (r) {
    if (r.processed) done.push(r);
    else if (!r.need_remind) noRemind.push(r);
    else if (remindArrived(r)) due.push(r);
    else future.push(r);
  });
  noRemind = sortReminders(noRemind);
  due = sortReminders(due);
  future = sortReminders(future);
  done.sort(function (a, b) { return (b.id || 0) - (a.id || 0); });

  var parts = [];
  if (noRemind.length) parts.push(tgroupHtml('待办', noRemind.length) + noRemind.map(reminderRowHtml).join(''));
  if (due.length) parts.push(tgroupHtml('提醒', due.length) + due.map(reminderRowHtml).join(''));
  if (future.length) {
    if (_showFuture || q) {
      parts.push(tgroupHtml('未到提醒', future.length) + future.map(reminderRowHtml).join(''));
    } else {
      parts.push('<button class="tgroup-toggle" onclick="toggleFutureReminders()"><span class="tg-name">未到提醒<span class="tg-count">' + future.length + '</span></span><span class="link">展开 ›</span></button>');
    }
  }
  if (done.length) {
    if (_showDone || q) {
      parts.push(tgroupHtml('已完成', done.length) + done.map(reminderRowHtml).join(''));
    } else {
      parts.push('<button class="tgroup-toggle" onclick="toggleDoneReminders()"><span class="tg-name">已完成<span class="tg-count">' + done.length + '</span></span><span class="link">展开 ›</span></button>');
    }
  }

  $('list-reminders').innerHTML = parts.length
    ? parts.join('')
    : '<div class="empty"><i>✓</i>' + (list.length ? '无匹配' : '暂无待办') + '</div>';

  var unp = list.filter(function (r) { return !r.processed; }).length;
  setSub('待办', list.length ? (unp + ' 项未完成 / 共 ' + list.length + ' 项') : '');
  paintDash();
}
function loadReminders(force) {
  if (!force && fresh('reminders')) { paintReminders(DB.reminders); return Promise.resolve(); }
  return api('/todos').then(function (d) { LT.reminders = Date.now(); paintReminders(d); }).catch(function () {
    failToast();
    $('list-reminders').innerHTML = '<div class="empty"><i>✓</i>加载失败</div>';
  });
}
/* 就地替换列表中的一条，避免完成后为了刷新再发一次 GET */
function updateReminderLocal(r) {
  for (var i = 0; i < DB.reminders.length; i++) {
    if (DB.reminders[i].id === r.id) { DB.reminders[i] = r; return; }
  }
  DB.reminders.push(r);
}
function doneReminder(id, btn) {
  if (btn) btn.classList.add('busy'); /* 立即反馈，别等网络 */
  api('/todos/' + id + '/processed', 'PUT').then(function (r) {
    if (btn) btn.classList.remove('busy');
    if (r && typeof r.id !== 'undefined') {
      /* 用 PUT 返回的对象就地更新，省掉第二次 GET */
      updateReminderLocal(r);
      LT.reminders = Date.now();
      if (r.recurring && r.due_time) Toast.success('已完成，顺延到 ' + String(r.due_time).slice(0, 10));
      else Toast.success('已完成');
      offerUndo(id); /* 约 6 秒内可撤销这次完成 */
      paintReminders(DB.reminders);
    } else {
      loadReminders(true);
    }
  }).catch(function () {
    if (btn) btn.classList.remove('busy');
    failToast();
  });
}
/* 完成后提供「撤销」（后端 /undo 回滚日期/状态），保留约 30 秒 */
function offerUndo(id) {
  _undoId = id;
  setTimeout(function () {
    if (_undoId === id) { _undoId = null; paintReminders(DB.reminders); }
  }, 30000);
}
function undoReminder(id, btn) {
  _undoId = null;
  if (btn) btn.classList.add('busy');
  api('/todos/' + id + '/undo', 'POST').then(function (r) {
    if (r && typeof r.id !== 'undefined') {
      updateReminderLocal(r);
      LT.reminders = Date.now();
      paintReminders(DB.reminders);
    } else {
      loadReminders(true);
    }
  }).catch(function () { if (btn) btn.classList.remove('busy'); failToast(); });
}
/* 行内推迟：循环一个周期 / 一次性 +1 天（`POST /snooze`） */
function snoozeReminder(id, btn) {
  if (btn) btn.classList.add('busy');
  api('/todos/' + id + '/snooze', 'POST').then(function (r) {
    if (btn) btn.classList.remove('busy');
    if (r && typeof r.id !== 'undefined') {
      updateReminderLocal(r);
      LT.reminders = Date.now();
      paintReminders(DB.reminders);
    } else {
      loadReminders(true);
    }
  }).catch(function () { if (btn) btn.classList.remove('busy'); failToast(); });
}
function reopenReminder(id, btn) {
  if (btn) btn.classList.add('busy');
  api('/todos/' + id, 'PUT', { processed: false }).then(function (r) {
    if (btn) btn.classList.remove('busy');
    if (r && typeof r.id !== 'undefined') {
      updateReminderLocal(r);
      LT.reminders = Date.now();
      Toast.success('已重新打开');
      paintReminders(DB.reminders);
    } else {
      loadReminders(true);
    }
  }).catch(function () {
    if (btn) btn.classList.remove('busy');
    failToast();
  });
}

/* 「循环」联动：每天免日期；每 N 天显示天数；补做只对非每天循环显示 */
function syncCycle() {
  var mode = $('fr-cycle').value || 'once';
  var daily = (mode === 'daily');
  var days = (mode === 'days');
  var recurring = (mode !== 'once');
  $('fr-days-row').hidden = !days;
  $('fr-dates').hidden = daily;
  $('fr-daily-hint').hidden = !daily;
  $('fr-date-hint').hidden = daily;
  $('fr-catchup-wrap').hidden = !(recurring && !daily);
}

/* 待办新建/编辑：待办版块内联表单（是否提醒勾选后展开日期区） */
function openReminderForm() {
  $('fr-id').value = '';
  $('fr-heading').textContent = '新建待办';
  $('fr-title').value = '';
  $('fr-content').value = '';
  $('fr-need').checked = false;
  $('fr-remind-box').hidden = true;
  setDate('fr-due', '');
  setDate('fr-remind', '');
  setISelect('fr-cycle', 'once');
  setISelect('fr-priority', '0');
  $('fr-cycle-days').value = '7';
  $('fr-catchup').checked = false;
  syncCycle();
  openForm('iform-reminders', 'fr-title');
}
function openEditReminderForm(id) {
  var r = null;
  for (var i = 0; i < DB.reminders.length; i++) {
    if (DB.reminders[i].id === id) r = DB.reminders[i];
  }
  if (!r) return;
  if (currentView !== '待办') goView('待办');
  $('fr-id').value = r.id;
  $('fr-heading').textContent = '编辑待办';
  $('fr-title').value = r.title || '';
  $('fr-content').value = r.content || '';
  var need = !!r.need_remind;
  $('fr-need').checked = need;
  $('fr-remind-box').hidden = !need;
  setDate('fr-due', (r.due_time && r.due_time !== NO_DATE) ? String(r.due_time).slice(0, 10) : '');
  setDate('fr-remind', (r.remind_time && r.remind_time !== NO_DATE) ? String(r.remind_time).slice(0, 10) : '');
  var cyc = r.cycle_mode || 'once';
  if (!/^(once|daily|weekly|monthly|yearly|days)$/.test(cyc)) cyc = 'once';
  setISelect('fr-cycle', cyc);
  setISelect('fr-priority', String(Number(r.priority) || 0));
  $('fr-cycle-days').value = String(r.cycle_days || 7);
  $('fr-catchup').checked = !!r.catch_up;
  syncCycle();
  openForm('iform-reminders', 'fr-title');
}
function saveReminderForm() {
  var id = $('fr-id').value;
  var title = $('fr-title').value.trim(), content = $('fr-content').value.trim();
  if (!title) { markInvalid($('fr-title')); Toast.warning('标题必填'); return; }
  if (!content) { markInvalid($('fr-content')); Toast.warning('内容必填'); return; }
  var body = { title: title, content: content, need_remind: $('fr-need').checked, priority: Number($('fr-priority').value) || 0 };
  if (body.need_remind) {
    body.cycle_mode = $('fr-cycle').value || 'once';
    if (body.cycle_mode === 'days') {
      var cd = parseInt(($('fr-cycle-days').value || '').replace(/[^0-9]/g, ''), 10);
      body.cycle_days = (cd > 0) ? Math.min(cd, 365) : 7;
    }
    /* 错过后逐期补做：只对非每天循环有效 */
    body.catch_up = (body.cycle_mode !== 'once' && body.cycle_mode !== 'daily') ? !!$('fr-catchup').checked : false;
    if (body.cycle_mode === 'daily') {
      /* 每天：不用选日期，按今天起算；已是 daily 的沿用当前顺延位置，避免编辑标题时重置 */
      var cur = null;
      if (id) {
        for (var i = 0; i < DB.reminders.length; i++) {
          if (String(DB.reminders[i].id) === String(id)) { cur = DB.reminders[i]; break; }
        }
      }
      if (!(cur && cur.recurring && cur.cycle_mode === 'daily')) {
        var now = todayStr();
        body.due_time = now;
        body.remind_time = now;
      }
      body.advance_days = 0; /* 每天提醒即当天，不提前 */
    } else {
      var due = dateVal('fr-due'), rem = dateVal('fr-remind');
      if (!due) { markInvalid($('fr-due')); return; } /* 到期日必须手动选择 */
      body.due_time = due.slice(0, 10);
      if (rem) {
        body.remind_time = rem.slice(0, 10);
        /* 提前天数 = 到期日 - 提醒日，供循环顺延时保留同一提前量 */
        body.advance_days = Math.max(0, Math.round((new Date(due) - new Date(rem)) / 86400000));
      } else {
        body.advance_days = 3; /* 未设置提醒日：默认提前 3 天 */
      }
    }
  }
  var done = function () {
    Toast.success(id ? '已保存' : '已保存待办');
    hideForm('iform-reminders');
    loadReminders(true);
  };
  if (id) api('/todos/' + id, 'PUT', body).then(done).catch(failToast);
  else api('/todos', 'POST', body).then(done).catch(failToast);
}
function delReminder(btn, id) {
  var r = null, i;
  for (i = 0; i < DB.reminders.length; i++) { if (DB.reminders[i].id === id) r = DB.reminders[i]; }
  if (!r) return;
  armDelete(btn, function () {
    api('/todos/' + id, 'DELETE').then(function () {
      Toast.success('已删除');
      loadReminders(true);
    }).catch(failToast);
  });
}

/* ═════════ 记账 ═════════ */
function moneyCls(t) { return t === 'income' ? 'c-ok' : 'c-bad'; }
function moneySign(t, a) { return (t === 'income' ? '+' : '-') + '¥' + Number(a).toFixed(2); }

/* ═════════ 记账（内联表单） ═════════ */
function delExpense(btn, id) {
  var e = null, i;
  for (i = 0; i < DB.ledger.length; i++) { if (DB.ledger[i].id === id) e = DB.ledger[i]; }
  if (!e) return;
  armDelete(btn, function () {
    api('/ledger/' + id, 'DELETE').then(function () {
      Toast.success('已删除');
      loadLedger(true);
    }).catch(failToast);
  });
}
/* 利息仅还款（debt_out）时显示 */
function syncInterest() {
  $('fe-interest-wrap').hidden = ($('fe-type').value !== 'debt_out');
}
function openExpenseForm() {
  hideForm('iform-asset');
  $('fe-id').value = '';
  $('fe-heading').textContent = '新建记账';
  setISelect('fe-type', 'expense');
  $('fe-amount').value = '';
  $('fe-interest').value = '';
  $('fe-desc').value = '';
  $('fe-category').value = '';
  setDate('fe-date', todayStr());
  syncInterest();
  openForm('iform-expenses', 'fe-amount');
}
/* 编辑账单：整行回填（后端 PUT 要完整对象，notes 从缓存原样带回） */
function openEditExpenseForm(id) {
  var e = null;
  for (var i = 0; i < DB.ledger.length; i++) {
    if (DB.ledger[i].id === id) e = DB.ledger[i];
  }
  if (!e) return;
  if (currentView !== '记账') goView('记账');
  hideForm('iform-asset');
  $('fe-id').value = e.id;
  $('fe-heading').textContent = '编辑账单';
  setISelect('fe-type', e.record_type || 'expense');
  $('fe-amount').value = (e.amount != null ? e.amount : '');
  $('fe-interest').value = e.interest || '';
  $('fe-desc').value = e.item || '';
  $('fe-category').value = e.category || '';
  setDate('fe-date', String(e.record_date || '').slice(0, 10));
  syncInterest();
  openForm('iform-expenses', 'fe-amount');
}
function saveExpenseForm() {
  var id = $('fe-id').value;
  var amount = parseFloat($('fe-amount').value);
  if (!(amount > 0)) { markInvalid($('fe-amount')); Toast.warning('金额需大于 0'); return; }
  var date = dateVal('fe-date');
  var body = {
    item: $('fe-desc').value.trim() || '支出',
    amount: amount,
    interest: parseFloat($('fe-interest').value) || 0,
    record_type: $('fe-type').value,
    record_date: date ? date.slice(0, 10) : todayStr(),
    category: $('fe-category').value.trim() || null
  };
  if (id) {
    for (var i = 0; i < DB.ledger.length; i++) {
      if (String(DB.ledger[i].id) === String(id)) { body.notes = DB.ledger[i].notes || null; break; }
    }
    api('/ledger/' + id, 'PUT', body).then(function () {
      Toast.success('已保存');
      hideForm('iform-expenses');
      loadLedger(true);
    }).catch(failToast);
  } else {
    api('/ledger', 'POST', body).then(function () {
      Toast.success('已记账');
      hideForm('iform-expenses');
      loadLedger(true);
    }).catch(failToast);
  }
}
/* 余额/负债校准：记账版块内联小表单（对账用，流水不动） */
function openAssetForm(which) {
  if (currentView !== '记账') goView('记账');
  var isAsset = (which === 'asset');
  hideForm('iform-expenses');
  $('fa-which').value = which;
  $('fa-heading').textContent = isAsset ? '校准余额' : '校准负债';
  $('fa-amount').value = '';
  openForm('iform-asset', 'fa-amount');
}
function saveAssetForm() {
  var which = $('fa-which').value || 'asset';
  var raw = $('fa-amount').value.trim();
  if (raw === '') { markInvalid($('fa-amount')); return; }
  var amount = parseFloat(raw);
  if (!isFinite(amount)) { markInvalid($('fa-amount')); Toast.warning('金额不对'); return; }
  api('/' + which, 'POST', { amount: amount }).then(function () {
    Toast.success('已校准');
    hideForm('iform-asset');
    loadLedger(true);
  }).catch(failToast);
}
function paintLedger(list) {
  DB.ledger = list;
  var f = list.filter(function (e) { return matchQ(FQ.expenses, e.item) || matchQ(FQ.expenses, e.category); }).slice(0, 100);
  $('list-expenses').innerHTML = f.length
    ? f.map(function (e) {
        return '<div class="row"><span class="grow">' + esc(e.item) +
          '<small class="sub">' + esc(e.record_date || '') + (e.category ? ' · ' + esc(e.category) : '') + '</small></span>' +
          '<span class="mono ' + moneyCls(e.record_type) + '">' + moneySign(e.record_type, e.amount) + '</span>' +
          '<button class="link blue" onclick="openEditExpenseForm(' + e.id + ')">编辑</button>' +
          '<button class="link bad" onclick="delExpense(this,' + e.id + ')">删除</button></div>';
      }).join('')
    : '<div class="empty"><i>¥</i>' + (list.length ? '无匹配' : '暂无账单') + '</div>';
  setSub('记账', list.length ? (list.length + ' 笔流水') : '');
  paintDash();
}
/* 余额/负债只供仪表「记账」卡用（顶栏的 asset-total / liability-total 已移除） */
var MONEY = { asset: null, liab: null };
function paintTotals() {
  api('/asset').then(function (a) {
    MONEY.asset = Number(a.amount || 0);
    updateDashMoney();
  }).catch(function () {});
  api('/liability').then(function (l) {
    MONEY.liab = Number(l.amount || 0);
    updateDashMoney();
  }).catch(function () {});
}
/* 仪表「记账」卡：余额 + 负债（值来自 paintTotals，缓存复用） */
function updateDashMoney() {
  var m = $('dash-money');
  if (!m) return;
  m.textContent = MONEY.asset == null ? '–' : '¥' + MONEY.asset.toFixed(2);
  m.className = 'dash-v ' + (MONEY.asset == null ? 'muted' : (MONEY.asset >= 0 ? 'c-ok' : 'c-bad'));
  $('dash-money-sub').textContent = MONEY.liab == null ? '' : ('负债 ¥' + MONEY.liab.toFixed(2));
}
function loadLedger(force) {
  if (!force && fresh('ledger')) { paintLedger(DB.ledger); return Promise.resolve(); }
  return api('/ledger').then(function (d) {
    LT.ledger = Date.now();
    paintLedger(d);
    paintTotals();
  }).catch(function () {
    failToast();
    $('list-expenses').innerHTML = '<div class="empty"><i>¥</i>加载失败</div>';
  });
}
/* ═════════ 监控 ═════════ */
function paintServers(list) {
  DB.servers = list;
  var bad = 0, i;
  for (i = 0; i < list.length; i++) {
    if (!list[i].is_success) bad++;
  }
  var okTxt = list.length ? (bad ? bad + ' 异常' : '全部正常') : '无数据';
  var okCls = list.length ? (bad ? 'c-bad' : 'c-ok') : 'muted';
  $('server-summary').textContent = okTxt;
  $('server-summary').className = okCls;
  var fs = list.filter(function (s) {
    return matchQ(FQ.servers, s.server_name) || matchQ(FQ.servers, s.service_name) || matchQ(FQ.servers, s.content);
  }).slice(0, 100);
  $('list-servers').innerHTML = fs.length
    ? fs.map(function (s) {
        return '<div class="row"><span class="dot ' + (s.is_success ? 'ok' : 'bad') + '"></span>' +
          '<span class="grow">' + esc(s.server_name) + ' / ' + esc(s.service_name) +
          '<small class="sub">' + esc(s.content || '') + ' · ' + esc(s.time || '') + '</small></span>' +
          '<span class="' + (s.is_success ? 'c-ok' : 'c-bad') + '">' + (s.is_success ? '正常' : '异常') + '</span></div>';
      }).join('')
    : '<div class="empty"><i>●</i>' + (list.length ? '无匹配' : '无数据') + '</div>';
  setSub('监控', list.length ? okTxt : '');
  paintDash();
}
function loadServers(force) {
  if (!force && fresh('servers')) { paintServers(DB.servers); return Promise.resolve(); }
  return api('/server/status?limit=50').then(function (d) { LT.servers = Date.now(); paintServers(d); }).catch(function () {
    failToast();
    $('list-servers').innerHTML = '<div class="empty"><i>●</i>加载失败</div>';
  });
}

/* ═════════ 菜单/导航/搜索绑定与启动 ═════════ */
/* 菜单（导航 + 换壁纸，仅非主页顶栏显示）：点外部、选导航、Esc 关闭 */
var _menuOpen = false;
function setMenu(open) {
  _menuOpen = open;
  $('menu').classList.toggle('open', open);
  var trs = document.querySelectorAll('.menu-trigger');
  for (var i = 0; i < trs.length; i++) trs[i].classList.toggle('active', open);
}
function toggleMenu() { setMenu(!_menuOpen); }
function closeMenu() { if (_menuOpen) setMenu(false); }
document.addEventListener('click', function (e) {
  if (!_menuOpen) return;
  var t = e.target;
  if ($('menu').contains(t) || (t.closest && t.closest('.menu-trigger'))) return;
  closeMenu();
});
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });

var navBtns = document.querySelectorAll('.nav-item[data-view]');
for (var _i = 0; _i < navBtns.length; _i++) {
  navBtns[_i].addEventListener('click', function () {
    goView(this.getAttribute('data-view'));
    closeMenu();
  });
}

/* 顶部搜索控件：四个版块共用一个搜索框（按当前版块过滤，输入即本地重画） */
var SEARCH_VIEW = {
  '待办': { ph: '搜索标题或内容…', key: 'reminders', paint: function () { paintReminders(DB.reminders); } },
  '记账': { ph: '搜索账单或分类…', key: 'expenses', paint: function () { paintLedger(DB.ledger); } },
  '监控': { ph: '搜索服务或内容…', key: 'servers', paint: function () { paintServers(DB.servers); } },
  '书签': { ph: '搜索标题 / 网址 / 标签…', key: 'bookmarks', paint: function () { paintBookmarks(DB.bookmarks); } },
  '笔记': { ph: '搜索标题 / 正文 / 标签…', key: 'notes', paint: function () { paintNotes(DB.notes); } },
  '思维导图': { ph: '搜索标题 / 大纲…', key: 'mindmaps', paint: function () { paintMindMaps(DB.mindmaps); } }
};
function toggleSearchBar() {
  var box = $('searchbox');
  var inp = $('search-input');
  var btn = $('act-search');
  var show = box.hidden;
  box.hidden = !show;
  btn.classList.toggle('active', show);
  if (show) {
    try { inp.focus({ preventScroll: true }); } catch (_e) { inp.focus(); }
  } else {
    inp.value = '';
    var cfg = SEARCH_VIEW[currentView];
    if (cfg) { FQ[cfg.key] = ''; cfg.paint(); }
  }
}
/* 切换版块：收起搜索、清空过滤，避免用上一版块的词过滤新列表 */
function resetSearchFor(name) {
  var cfg = SEARCH_VIEW[name];
  $('searchbox').hidden = true;
  $('act-search').classList.remove('active');
  $('search-input').value = '';
  if (cfg) { FQ[cfg.key] = ''; $('search-input').placeholder = cfg.ph; }
}
$('search-input').addEventListener('input', function () {
  var cfg = SEARCH_VIEW[currentView];
  if (!cfg) return;
  FQ[cfg.key] = this.value.trim().toLowerCase();
  cfg.paint();
});

/* 内联表单绑定：保存/取消/关闭 + 回车保存 + Esc 关闭 + 条件字段 */
function bindForm(wrapId, saveId, cancelId, closeId, saveFn) {
  $(saveId).addEventListener('click', saveFn);
  $(cancelId).addEventListener('click', function () { hideForm(wrapId); });
  $(closeId).addEventListener('click', function () { hideForm(wrapId); });
  wireFormKeys(wrapId, saveFn);
}
bindForm('iform-reminders', 'fr-save', 'fr-cancel', 'fr-close', saveReminderForm);
bindForm('iform-expenses', 'fe-save', 'fe-cancel', 'fe-close', saveExpenseForm);
bindForm('iform-asset', 'fa-save', 'fa-cancel', 'fa-close', saveAssetForm);
bindForm('iform-bookmarks', 'fb-save', 'fb-cancel', 'fb-close', saveBookmarkForm);
bindForm('iform-notes', 'fn-save', 'fn-cancel', 'fn-close', saveNoteForm);
bindForm('iform-mindmaps', 'fm-save', 'fm-cancel', 'fm-close', saveMindMapForm);
$('fr-need').addEventListener('change', function () { $('fr-remind-box').hidden = !this.checked; syncCycle(); });
$('fr-cycle').addEventListener('change', syncCycle);
$('fe-type').addEventListener('change', syncInterest);

/* ── 思维导图交互：滚轮缩放 / 拖动平移 / 轻点选中 / 点 ⊖⊕ 折叠 ── */
$('mm-stage').addEventListener('wheel', function (e) {
  e.preventDefault();
  var r = this.getBoundingClientRect();
  var mx = e.clientX - r.left, my = e.clientY - r.top;
  var f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  _mmView.k = Math.max(0.2, Math.min(3, _mmView.k * f));
  _mmView.x = mx - (mx - _mmView.x) * f;
  _mmView.y = my - (my - _mmView.y) * f;
  mmApplyTransform();
}, { passive: false });
/* 指针手势：按下记起点；移动超过阈值算拖动平移，未移动的轻点算选中/折叠。
   不依赖 click，避免「从节点上拖动」被误判成点节点。 */
var _mmDown = null;
$('mm-stage').addEventListener('pointerdown', function (e) {
  if (e.target && e.target.id === 'mm-rename') return; /* 正在改字的输入框，交给它自己 */
  var g = e.target.closest ? e.target.closest('.mm-node') : null;
  var isToggle = !!(e.target.closest && e.target.closest('.mm-toggle'));
  _mmDown = {
    x: e.clientX, y: e.clientY, vx: _mmView.x, vy: _mmView.y, moved: false,
    nodeKey: g ? Number(g.getAttribute('data-key')) : null,
    toggleKey: (isToggle && g) ? Number(g.getAttribute('data-key')) : null
  };
  if (this.setPointerCapture) this.setPointerCapture(e.pointerId);
});
$('mm-stage').addEventListener('pointermove', function (e) {
  if (!_mmDown) return;
  var dx = e.clientX - _mmDown.x, dy = e.clientY - _mmDown.y;
  if (!_mmDown.moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
    _mmDown.moved = true;
    mmCommitRename(); /* 开始拖动即提交正在编辑的文字 */
  }
  if (!_mmDown.moved) return;
  _mmView.x = _mmDown.vx + dx;
  _mmView.y = _mmDown.vy + dy;
  mmApplyTransform();
});
$('mm-stage').addEventListener('pointerup', function () {
  if (!_mmDown) return;
  var d = _mmDown;
  _mmDown = null;
  if (d.moved) return;
  if (d.toggleKey != null) {              /* 点 ⊖ / ⊕：折叠展开 */
    _mmCollapsed[d.toggleKey] = !_mmCollapsed[d.toggleKey];
    mmRender();
    return;
  }
  if (d.nodeKey != null) {                /* 点节点：选中（正在改这个节点则忽略） */
    if (_mmRenaming && _mmRenaming.key === d.nodeKey) return;
    mmSelect(d.nodeKey);
    return;
  }
  _mmSelectedKey = null;                   /* 点空白：取消选中 */
  mmRender();
});
$('mm-stage').addEventListener('pointercancel', function () { _mmDown = null; });

/* 就地重命名的输入框：回车提交、失焦提交、Esc 取消（并拦住冒泡，别触发保存/关弹窗） */
$('mm-rename').addEventListener('keydown', function (e) {
  if (e.key === 'Enter' || e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Enter') mmCommitRename(); else mmCancelRename();
  }
});
$('mm-rename').addEventListener('blur', mmCommitRename);

/* ── 自定义日期选择（不用原生日期控件）：字段为按钮，日历在居中二级弹窗里 ── */
var _pick = { field: null, y: 0, m: 0 };
var _pickPending = ''; /* 弹窗里已选但未点「确定」的值 */
function dateVal(id) { return $(id).getAttribute('data-value') || ''; }
/* 取字段所属 .ifield 的标签文字（用于弹窗标题） */
function fieldLabel(el) {
  var f = el && el.closest ? el.closest('.ifield') : null;
  var s = f ? f.querySelector('span') : null;
  return s ? s.textContent.trim() : '';
}
function dateLabel(v) {
  var d = new Date(v + 'T00:00:00');
  var w = '日一二三四五六'.charAt(d.getDay());
  if (v === todayStr()) return '今天 · 周' + w;
  return v + ' 周' + w;
}
function setDate(id, v) {
  var el = $(id);
  el.setAttribute('data-value', v || '');
  el.querySelector('.idate-txt').textContent = v ? dateLabel(v) : (el.getAttribute('data-ph') || '选择日期');
  el.classList.toggle('on', !!v);
  el.classList.remove('invalid');
}
function renderPicker() {
  var y = _pick.y, m = _pick.m;
  var start = (new Date(y, m, 1).getDay() + 6) % 7; /* 周一第一列 */
  var days = new Date(y, m + 1, 0).getDate();
  var prevDays = new Date(y, m, 0).getDate();
  var sel = _pickPending || '';
  var today = todayStr();
  var cells = [];
  for (var i = 0; i < 42; i++) {
    var dn, dim = false, off = 0;
    if (i < start) { dn = prevDays - start + 1 + i; dim = true; off = -1; }
    else if (i >= start + days) { dn = i - start - days + 1; dim = true; off = 1; }
    else dn = i - start + 1;
    var iso = new Date(y, m + off, dn).toLocaleDateString('sv-SE');
    cells.push('<button type="button" class="ip-day' + (dim ? ' dim' : '') +
      (iso === today ? ' today' : '') + (iso === sel ? ' sel' : '') +
      '" data-d="' + iso + '">' + dn + '</button>');
  }
  $('ipicker').innerHTML =
    '<div class="ip-head"><button type="button" class="ip-nav" data-nav="-1">‹</button>' +
    '<span class="ip-title">' + y + '年' + (m + 1) + '月</span>' +
    '<button type="button" class="ip-nav" data-nav="1">›</button></div>' +
    '<div class="ip-week"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div>' +
    '<div class="ip-days">' + cells.join('') + '</div>';
  var sub = $('ipicker-sub');
  if (sub) sub.textContent = sel ? '已选 ' + sel : '未选择';
}
function openPicker(fieldId) {
  var el = $(fieldId);
  _pick.field = fieldId;
  _pickPending = dateVal(fieldId) || '';
  var base = _pickPending ? new Date(_pickPending + 'T00:00:00') : new Date();
  _pick.y = base.getFullYear();
  _pick.m = base.getMonth();
  $('ipicker-title').textContent = fieldLabel(el) || '选择日期';
  el.classList.add('open');
  renderPicker();
  $('ipicker-wrap').hidden = false;
}
function closePicker() {
  var wrap = $('ipicker-wrap');
  if (wrap) wrap.hidden = true;
  if (_pick.field) {
    var el = $(_pick.field);
    if (el) el.classList.remove('open');
  }
  _pick.field = null;
  _pickPending = '';
}
function applyDate(v) {
  var id = _pick.field;
  if (id) setDate(id, v);
  closePicker();
}
$('ipicker').addEventListener('click', function (e) {
  var t = e.target;
  var nav = t.getAttribute && t.getAttribute('data-nav');
  if (nav) {
    _pick.m += Number(nav);
    if (_pick.m < 0) { _pick.m = 11; _pick.y--; }
    if (_pick.m > 11) { _pick.m = 0; _pick.y++; }
    renderPicker();
    return;
  }
  var day = t.getAttribute && t.getAttribute('data-d');
  if (day) { _pickPending = day; renderPicker(); return; }
});
$('ipicker-ok').addEventListener('click', function () { applyDate(_pickPending); });
$('ipicker-cancel').addEventListener('click', closePicker);
$('ipicker-clear').addEventListener('click', function () { _pickPending = ''; renderPicker(); });
$('ipicker-wrap').addEventListener('click', function (e) { if (e.target === this) closePicker(); });
var dateBtns = document.querySelectorAll('.idate');
for (var _d = 0; _d < dateBtns.length; _d++) {
  dateBtns[_d].addEventListener('click', function () {
    if (_pick.field === this.id) { closePicker(); return; }
    openPicker(this.id);
  });
}

/* ── 自定义下拉（替代原生 select）：.isel 仅作选项数据源，真正界面是 #isel-wrap 居中弹窗 ── */
var _isel = null;
var _iselPending = null;
var _iselFieldId = null;
function iselText(sel, v) {
  var opts = sel.querySelectorAll('.isel-opt');
  for (var i = 0; i < opts.length; i++) {
    if (opts[i].getAttribute('data-value') === v) return opts[i].textContent;
  }
  return '';
}
function syncISelect(id) {
  var sel = $(id + '-sel');
  if (!sel) return;
  var v = $(id).value;
  sel.querySelector('.isel-txt').textContent = iselText(sel, v);
  var opts = sel.querySelectorAll('.isel-opt');
  for (var i = 0; i < opts.length; i++) {
    opts[i].classList.toggle('sel', opts[i].getAttribute('data-value') === v);
  }
}
function setISelect(id, v) { $(id).value = v; syncISelect(id); }
/* 只更新弹窗里「已选」高亮，不写回隐藏值（等点确定） */
function paintIselectPending() {
  var opts = $('isel-body').querySelectorAll('.picker-opt');
  for (var i = 0; i < opts.length; i++) {
    opts[i].classList.toggle('sel', opts[i].getAttribute('data-value') === _iselPending);
  }
}
/* 打开居中下拉弹窗：从 .isel 里的 .isel-menu 读选项，标题取字段标签 */
function openISelectModal(selId) {
  var sel = $(selId);
  if (!sel) return;
  _isel = sel;
  _iselFieldId = selId.replace(/-sel$/, '');
  _iselPending = $(_iselFieldId).value;
  $('isel-title').textContent = fieldLabel(sel) || '请选择';
  var opts = sel.querySelectorAll('.isel-opt');
  var html = '';
  for (var i = 0; i < opts.length; i++) {
    html += '<button type="button" class="picker-opt" data-value="' + esc(opts[i].getAttribute('data-value')) + '">' +
      esc(opts[i].textContent) + '</button>';
  }
  $('isel-body').innerHTML = html;
  paintIselectPending();
  sel.classList.add('open');
  $('isel-wrap').hidden = false;
}
function closeISelect() {
  if (!_isel) return;
  _isel.classList.remove('open');
  $('isel-wrap').hidden = true;
  _isel = null;
  _iselPending = null;
  _iselFieldId = null;
}
/* 点确定：把待选值写回隐藏 input 并触发 change（与旧下拉行为一致） */
function confirmISelect() {
  if (!_isel) return;
  var id = _iselFieldId, v = _iselPending;
  closeISelect();
  setISelect(id, v);
  $(id).dispatchEvent(new Event('change'));
}
function toggleISelect(selId) {
  if (_isel && _isel.id === selId) { closeISelect(); return; }
  if (_isel) closeISelect();
  openISelectModal(selId);
}
$('isel-body').addEventListener('click', function (e) {
  var t = e.target.closest && e.target.closest('.picker-opt');
  if (!t) return;
  _iselPending = t.getAttribute('data-value');
  paintIselectPending();
});
$('isel-ok').addEventListener('click', confirmISelect);
$('isel-cancel').addEventListener('click', closeISelect);
$('isel-wrap').addEventListener('click', function (e) { if (e.target === this) closeISelect(); });

/* ── 弹窗键盘适配：遮罩高度/位置实时贴合 visualViewport（键盘弹起后只占键盘上方），
   布局视口不动（页面不重排、背景不跳），聚焦项再滚进遮罩可视区 ── */
function fitViewport(wrap) {
  var vv = window.visualViewport;
  var list = wrap ? [wrap] : document.querySelectorAll('.iform-wrap');
  for (var i = 0; i < list.length; i++) {
    var w = list[i];
    if (!w || !w.style || w.hidden) continue;
    if (vv) {
      w.style.setProperty('--vvt', Math.round(vv.offsetTop || 0) + 'px');
      w.style.setProperty('--vvh', Math.round(vv.height) + 'px');
    } else {
      w.style.removeProperty('--vvt');
      w.style.removeProperty('--vvh');
    }
  }
}
function revealField(el) {
  if (!el || document.activeElement !== el) return;
  var sc = el.closest('.iform-scroll, .panel-scroll, .home-scroll');
  var vv = window.visualViewport;
  if (!vv || !sc) return;
  var r = el.getBoundingClientRect();
  var visTop = vv.offsetTop || 0;
  var visBottom = visTop + vv.height;
  /* 手动滚容器，不用 scrollIntoView（避免连带滚动页面/可视视口） */
  var over = r.bottom - visBottom + 12;
  if (over > 0) sc.scrollTop += over;
  var under = visTop + 8 - r.top;
  if (under > 0) sc.scrollTop -= under;
}
document.addEventListener('focusin', function (e) {
  var t = e.target;
  if (!t || !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
  setTimeout(function () { fitViewport(); resetPageScroll(); revealField(t); }, 60);
  setTimeout(function () { fitViewport(); resetPageScroll(); revealField(t); }, 320);
});
document.addEventListener('focusout', function () {
  setTimeout(resetPageScroll, 150);
});
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', function () {
    fitViewport();
    resetPageScroll();
    var ae = document.activeElement;
    if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) setTimeout(function () { revealField(ae); }, 60);
  });
  window.visualViewport.addEventListener('scroll', function () { fitViewport(); resetPageScroll(); });
}
window.addEventListener('resize', function () { fitViewport(); resetPageScroll(); });
window.addEventListener('orientationchange', function () { setTimeout(function () { fitViewport(); }, 200); });
window.addEventListener('scroll', resetPageScroll);

syncTitle();
loadReminders(); loadLedger(); loadServers(); loadBookmarks(); loadNotes(); loadMindMaps();

/* ═════════ 壁纸：自有图接口，加载提示 → 壁纸淡入 → 内容登场（不再有全屏调色层，省性能） ═════════ */
var _bgShown = false;
function showContent() {
  if (_bgShown) return;
  _bgShown = true;
  document.body.classList.add('bg-ready');
  setTimeout(function () {
    document.body.classList.add('content-ready');
    /* boot：内容入场动画只跑一次，跑完摘掉，板块切换不再闪 */
    document.body.classList.add('boot');
    setTimeout(function () { document.body.classList.remove('boot'); }, 600);
    _boot = false; /* 首屏结束，之后的请求才显示「加载中…」 */
  }, 2100);
}
/* 壁纸跟色：只跟主题色到 --accent；玻璃与文字固定暗调，不跟头走 */
function applyTheme(thHex) {
  if (thHex) document.documentElement.style.setProperty('--accent', thHex);
}
var _bgObj = null;
var _bgBusy = false;
function fetchBg(initial) {
  if (_bgBusy) return;
  _bgBusy = true;
  /* 壁纸加载不显示全局「加载中…」（换壁纸只淡出→换图，不给加载反馈） */
  var url = API_BASE + '?_t=' + Date.now();
  /* 同一次 fetch 既读色头又取图：no-store 下分两次请求会拿到两张不同的图 */
  fetch(url).then(function (res) {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    applyTheme(res.headers.get('X-Theme-Color-Hex'));
    return res.blob();
  }).then(function (blob) {
    if (_bgObj) URL.revokeObjectURL(_bgObj);
    _bgObj = URL.createObjectURL(blob);
    var el = $('anime-bg');
    el.style.backgroundImage = 'url("' + _bgObj + '")';
    el.style.opacity = '';
    if (initial) showContent();
    _bgBusy = false;
  }).catch(function () {
    var el = $('anime-bg');
    el.style.opacity = '';
    if (initial) showContent();
    _bgBusy = false;
  });
  if (initial) setTimeout(showContent, 5000);
}
function refreshBg() {
  $('anime-bg').style.opacity = '0';
  fetchBg(false);
}
fetchBg(true);
