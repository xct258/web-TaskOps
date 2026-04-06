const BackgroundSwitcher = (function () {
  const DEFAULTS = {
    silent: true,
    transitionDuration: 1000,
    zIndex: -999999,
    loaderText: '背景加载中',
    decodingText: '正在解析图片',
    applyingText: '正在显示页面',
    errorText: '加载失败，请稍后重试',
    loaderFadeDuration: 350
  };

  const HIDDEN_CSS_ID = 'bg-switcher-hidden-style';
  const LOADER_ID = 'bg-switcher-full-mask';

  let _config = {};
  let _isTransitioning = false;
  let _currentBlobUrl = null;
  let _lastImageName = '';
  let _pageHiddenBySwitcher = false;
  let _pendingColors = null;
  let _autoRefreshTimer = null;
  let _autoRefreshInterval = 0;
  let _autoRefreshUrl = '';
  let _readyCallback = null;
  let _wrapperPromise = null;
  const CONTENT_WRAPPER_ID = 'bg-switcher-content';

  function whenBodyReady(callback) {
    if (typeof document === 'undefined') return;

    if (document.body) {
      callback();
      return;
    }

    document.addEventListener('DOMContentLoaded', callback, { once: true });
  }

  function waitForBody() {
    return new Promise((resolve) => {
      whenBodyReady(resolve);
    });
  }

  function clampProgress(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, Math.round(value)));
  }

  function buildRequestUrl(url) {
    const sep = url.includes('?') ? '&' : '?';
    let result = `${url}${sep}_t=${Date.now()}`;
    if (_lastImageName) {
      result += `&exclude=${encodeURIComponent(_lastImageName)}`;
    }
    return result;
  }

  function ensureHiddenCss() {
    if (typeof document === 'undefined' || document.getElementById(HIDDEN_CSS_ID)) return;

    const mountPoint = document.head || document.documentElement;
    if (!mountPoint) return;

    const style = document.createElement('style');
    style.id = HIDDEN_CSS_ID;
    style.textContent = `
      html, body {
        margin: 0;
        padding: 0;
        height: 100%;
      }

      #${CONTENT_WRAPPER_ID} {
        position: fixed;
        inset: 0;
        overflow-y: auto;
        overflow-x: hidden;
        z-index: 1;
        -webkit-overflow-scrolling: touch;
      }

      html.bg-switcher-page-hidden > body > *:not(#${LOADER_ID}):not(.bg-switcher-layer-active):not(#${CONTENT_WRAPPER_ID}):not(#__ag_overlay):not(#__ag_style) {
        visibility: hidden !important;
      }

      html.bg-switcher-page-hidden #${CONTENT_WRAPPER_ID} {
        visibility: hidden;
        overflow: hidden;
      }

      @keyframes bg-switcher-content-reveal {
        from { opacity: 0; }
        to   { opacity: 1; }
      }

      html.bg-switcher-page-revealed #${CONTENT_WRAPPER_ID} > * {
        animation: bg-switcher-content-reveal 0.8s ease both;
      }
    `;
    mountPoint.appendChild(style);
  }

  function ensureContentWrapper() {
    if (_wrapperPromise) return _wrapperPromise;

    _wrapperPromise = new Promise((resolve) => {
      function doWrap() {
        if (document.getElementById(CONTENT_WRAPPER_ID)) { resolve(); return; }

        const wrapper = document.createElement('div');
        wrapper.id = CONTENT_WRAPPER_ID;

        // 将 body 中的所有非背景/非加载器/非脚本子元素移入 wrapper
        const children = Array.from(document.body.childNodes);
        children.forEach(function (child) {
          if (child.nodeType === 1) {
            if (child.classList && child.classList.contains('bg-switcher-layer-active')) return;
            if (child.id === LOADER_ID) return;
            if (child.tagName === 'SCRIPT') return;
          }
          wrapper.appendChild(child);
        });

        document.body.appendChild(wrapper);

        // wrapper 就绪后锁定 body 滚动，仅 wrapper 内可滚动
        document.documentElement.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';
        resolve();
      }

      // 必须等 DOM 完全解析后再移动子元素，否则后续 HTML 还未进入 DOM
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', doWrap, { once: true });
      } else {
        doWrap();
      }
    });

    return _wrapperPromise;
  }

  function setPageVisibility(hidden) {
    if (typeof document === 'undefined') return;

    ensureHiddenCss();

    const root = document.documentElement;
    if (!root) return;

    if (hidden && !_pageHiddenBySwitcher) {
      root.classList.add('bg-switcher-page-hidden');
      _pageHiddenBySwitcher = true;
      return;
    }

    if (!hidden && _pageHiddenBySwitcher) {
      root.classList.remove('bg-switcher-page-hidden');
      root.classList.add('bg-switcher-page-revealed');
      _pageHiddenBySwitcher = false;
    }
  }

  function ensureLoader() {
    if (typeof document === 'undefined' || !document.body) return null;

    let loader = document.getElementById(LOADER_ID);
    if (loader) return loader;

    loader = document.createElement('div');
    loader.id = LOADER_ID;
    loader.setAttribute('role', 'status');
    loader.setAttribute('aria-live', 'polite');

    Object.assign(loader.style, {
      position: 'fixed',
      inset: '0',
      background: '#0c0c14',
      color: '#ffffff',
      display: 'none',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: '2147483647',
      opacity: '0',
      transition: `opacity ${DEFAULTS.loaderFadeDuration}ms ease`,
      fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif'
    });

    // 圆环进度 — 周长 2π×44 ≈ 276.46
    loader.innerHTML = `
      <div style="position:relative;width:120px;height:120px;">
        <svg viewBox="0 0 100 100" style="width:100%;height:100%;transform:rotate(-90deg);">
          <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(255,255,255,.05)" stroke-width="1.5"/>
          <circle id="bg-sw-ring" cx="50" cy="50" r="44" fill="none"
            stroke="rgba(255,255,255,.25)" stroke-width="1.5" stroke-linecap="round"
            stroke-dasharray="276.46" stroke-dashoffset="276.46"
            style="transition:stroke-dashoffset .3s ease,stroke 1.5s ease;"/>
        </svg>
        <div id="bg-switcher-loader-percent" style="
          position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
          font-size:1.5rem;font-weight:200;letter-spacing:2px;opacity:.85;
        ">0%</div>
      </div>
      <div style="margin-top:20px;font-size:.75rem;font-weight:300;letter-spacing:1px;opacity:.35;text-transform:uppercase;">Loading</div>
    `;

    document.documentElement.appendChild(loader);
    return loader;
  }

  function updateLoader(text, progress) {
    const loader = ensureLoader();
    if (!loader) {
      whenBodyReady(() => updateLoader(text, progress));
      return;
    }

    const ring = document.getElementById('bg-sw-ring');
    const percentEl = document.getElementById('bg-switcher-loader-percent');
    const safeProgress = clampProgress(progress);

    if (ring) {
      // stroke-dashoffset: 276.46 (0%) → 0 (100%)
      ring.setAttribute('stroke-dashoffset', String(276.46 * (1 - safeProgress / 100)));
    }

    if (percentEl) {
      percentEl.textContent = `${safeProgress}%`;
    }
  }

  function showLoader(text, progress) {
    const loader = ensureLoader();
    if (!loader) {
      whenBodyReady(() => showLoader(text, progress));
      return;
    }

    updateLoader(text, progress);
    loader.style.display = 'flex';
    loader.offsetWidth;
    loader.style.opacity = '1';
  }

  function hideLoader(onHidden) {
    const loader = document.getElementById(LOADER_ID);
    if (!loader) {
      if (typeof onHidden === 'function') onHidden();
      return;
    }

    loader.style.opacity = '0';

    window.setTimeout(() => {
      loader.style.display = 'none';
      if (typeof onHidden === 'function') onHidden();
    }, _config.loaderFadeDuration || DEFAULTS.loaderFadeDuration);
  }

  function applyLoaderTheme(themeColor) {
    const loader = document.getElementById(LOADER_ID);
    if (!loader) return;

    // 背景柔和融入主题色
    loader.style.transition = `opacity ${DEFAULTS.loaderFadeDuration}ms ease, background-color 2s ease`;
    loader.style.backgroundColor = `color-mix(in srgb, ${themeColor} 12%, #0c0c14)`;

    // 圆环描边切换到主题色
    const ring = document.getElementById('bg-sw-ring');
    if (ring) {
      ring.style.stroke = `color-mix(in srgb, ${themeColor} 70%, #fff)`;
    }
  }

  function showLoaderRetry(errorText, retryUrl) {
    const loader = ensureLoader();
    if (!loader) return;

    loader.innerHTML =
      '<div style="display:flex;flex-direction:column;align-items:center;gap:20px;width:min(300px,75vw);text-align:center;">' +
        '<svg viewBox="0 0 24 24" width="52" height="52" fill="none" stroke="rgba(167,139,250,.6)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
          '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>' +
        '</svg>' +
        '<div style="font-size:.95rem;font-weight:300;color:rgba(255,255,255,.7);line-height:1.5;">' + errorText + '</div>' +
        '<button id="bg-switcher-retry-btn" style="' +
          'padding:.65rem 2.2rem;border:1px solid rgba(167,139,250,.3);border-radius:10px;' +
          'background:rgba(167,139,250,.08);color:rgba(255,255,255,.85);font-size:.9rem;font-weight:400;' +
          'letter-spacing:.5px;cursor:pointer;transition:all .25s ease;backdrop-filter:blur(4px);' +
        '">' + '\u91CD\u65B0\u52A0\u8F7D' + '</button>' +
      '</div>';

    loader.style.display = 'flex';
    loader.style.opacity = '1';

    var btn = document.getElementById('bg-switcher-retry-btn');
    if (btn) {
      btn.addEventListener('mouseenter', function () {
        btn.style.background = 'rgba(167,139,250,.18)';
        btn.style.borderColor = 'rgba(167,139,250,.5)';
      });
      btn.addEventListener('mouseleave', function () {
        btn.style.background = 'rgba(167,139,250,.08)';
        btn.style.borderColor = 'rgba(167,139,250,.3)';
      });
      btn.addEventListener('click', function () {
        var l = document.getElementById(LOADER_ID);
        if (l) l.remove();
        BackgroundSwitcher.init(retryUrl, { silent: false });
      });
    }
  }

  function waitForImageReady(image) {
    return new Promise((resolve, reject) => {
      if (image.complete && image.naturalWidth > 0) {
        resolve();
        return;
      }

      const onLoad = () => {
        cleanup();
        resolve();
      };

      const onError = () => {
        cleanup();
        reject(new Error('Image decode failed'));
      };

      const cleanup = () => {
        image.removeEventListener('load', onLoad);
        image.removeEventListener('error', onError);
      };

      image.addEventListener('load', onLoad, { once: true });
      image.addEventListener('error', onError, { once: true });
    });
  }

  async function decodeImage(image) {
    if (typeof image.decode === 'function') {
      try {
        await image.decode();
        return;
      } catch (error) {
        // Fall back to onload for browsers that reject decode on cached images.
      }
    }

    await waitForImageReady(image);
  }

  function extractColorHeaders(headers) {
    const map = {
      'X-Theme-Color-Hex': '--bg-image-theme-color',
      'X-Text-Color-Hex': '--bg-image-text-color'
    };
    const colors = {};
    for (const [header, cssVar] of Object.entries(map)) {
      const value = headers.get(header);
      if (value) colors[cssVar] = value;
    }
    return colors;
  }

  function applyColors(colors) {
    const root = document.documentElement;
    if (!root) return;
    for (const [cssVar, value] of Object.entries(colors)) {
      root.style.setProperty(cssVar, value);
    }
  }

  async function fetchImageAsBlob(url, onProgress, onHeaders) {
    const response = await fetch(buildRequestUrl(url));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    // 记录图片ID，用于下次请求排除
    _lastImageName = response.headers.get('X-Image-Id') || '';

    // 提取颜色信息（稍后在图片显示时应用）
    _pendingColors = extractColorHeaders(response.headers);

    // 通知调用方请求头已到达（颜色信息可用）
    if (typeof onHeaders === 'function') onHeaders(_pendingColors);

    const total = Number.parseInt(response.headers.get('Content-Length') || '0', 10);
    const hasStream = response.body && typeof response.body.getReader === 'function';

    if (!hasStream) {
      const blob = await response.blob();
      if (typeof onProgress === 'function') onProgress(90);
      return blob;
    }

    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    let fallbackChunks = 0;

    if (typeof onProgress === 'function') onProgress(0);

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      if (!value) continue;

      chunks.push(value);
      received += value.byteLength;
      fallbackChunks += 1;

      if (typeof onProgress === 'function') {
        if (total > 0) {
          onProgress((received / total) * 90);
        } else {
          onProgress(Math.min(90, 8 + fallbackChunks * 6));
        }
      }
    }

    if (typeof onProgress === 'function') onProgress(90);
    return new Blob(chunks);
  }

  return {
    async init(apiUrl, options = {}) {
      if (_isTransitioning) return;

      _config = Object.assign({}, DEFAULTS, options);
      _isTransitioning = true;

      // 每次调用 init 都重置自动刷新计时器
      if (_autoRefreshTimer) {
        clearTimeout(_autoRefreshTimer);
        _autoRefreshTimer = null;
      }

      const silent = !!_config.silent;
      let nextBlobUrl = null;

      if (!silent) {
        setPageVisibility(true);
        showLoader(_config.loaderText, 0);
      }

      try {
        await waitForBody();
        const wrapperReady = ensureContentWrapper();

        const blob = await fetchImageAsBlob(apiUrl, (progress) => {
          if (!silent) {
            const safeProgress = clampProgress(progress);
            showLoader(`${_config.loaderText} ${safeProgress}%`, safeProgress);
          }
        }, (colors) => {
          // 请求头到达 → 立即将 loader 元素切换为主题色
          if (!silent && colors['--bg-image-theme-color']) {
            applyLoaderTheme(colors['--bg-image-theme-color']);
          }
        });

        nextBlobUrl = URL.createObjectURL(blob);

        if (!silent) showLoader(`${_config.decodingText} 95%`, 95);

        const tempImg = new Image();
        tempImg.src = nextBlobUrl;
        await decodeImage(tempImg);

        // 确保 DOM 完全解析后内容已被包裹
        await wrapperReady;

        await waitForBody();

        const oldLayer = document.querySelector('.bg-switcher-layer-active');
        const newLayer = document.createElement('div');
        newLayer.className = 'bg-switcher-layer-active';

        Object.assign(newLayer.style, {
          position: 'fixed',
          inset: '0',
          zIndex: String(_config.zIndex),
          backgroundImage: `url('${nextBlobUrl}')`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          opacity: '0',
          transition: document.hidden
            ? 'none'
            : `opacity ${_config.transitionDuration}ms ease`
        });

        // 挂到 <html> 而非 <body>，避免 body opacity 过渡影响背景
        document.documentElement.appendChild(newLayer);

        // 页面不可见时跳过动画直接显示
        if (document.hidden) {
          newLayer.style.opacity = '1';
        } else {
          newLayer.getBoundingClientRect();
          newLayer.style.opacity = '1';
        }
        if (_pendingColors) {
          applyColors(_pendingColors);
          _pendingColors = null;
        }

        if (!silent) {
          showLoader(`${_config.applyingText} 100%`, 100);
          // loader 立即开始淡出，背景图同时淡入
          hideLoader(() => {
            if (_readyCallback) {
              // 有外部回调（如登录拦截）：交由回调决定何时显示页面
              _readyCallback();
              _readyCallback = null;
            } else {
              // 无拦截：欣赏 2 秒完整背景后淡入页面内容
              window.setTimeout(() => {
                setPageVisibility(false);
              }, 2000);
            }
          });
        }

        // 等待过渡动画完成后清理旧图层
        window.setTimeout(() => {
          if (oldLayer) {
            oldLayer.remove();
          }

          if (_currentBlobUrl) {
            URL.revokeObjectURL(_currentBlobUrl);
          }

          _currentBlobUrl = nextBlobUrl;
          nextBlobUrl = null;
          _isTransitioning = false;
          scheduleAutoRefresh();
        }, _config.transitionDuration + 50);
      } catch (error) {
        console.error('BackgroundSwitcher load failed:', error);

        if (nextBlobUrl) {
          URL.revokeObjectURL(nextBlobUrl);
        }

        _isTransitioning = false;

        if (!silent) {
          showLoaderRetry(_config.errorText, apiUrl);
        } else {
          scheduleAutoRefresh();
        }
      }
    },

    /**
     * 设置自动刷新参数（由自动初始化调用）
     */
    setAutoRefresh(url, intervalSec) {
      _autoRefreshUrl = url;
      _autoRefreshInterval = intervalSec > 0 ? intervalSec : 0;
    },

    /**
     * 注册背景就绪回调。设置后，首次加载完成时会调用此回调
     * 而不是自动显示页面内容。调用 revealPage() 来手动显示。
     */
    onReady(fn) {
      _readyCallback = fn;
    },

    /**
     * 手动触发页面内容显示（供登录成功后调用）
     */
    revealPage() {
      setPageVisibility(false);
    }
  };

  function scheduleAutoRefresh() {
    if (!(_autoRefreshInterval > 0) || !_autoRefreshUrl) return;
    _autoRefreshTimer = setTimeout(function () {
      _autoRefreshTimer = null;
      BackgroundSwitcher.init(_autoRefreshUrl).then(null, function () {});
    }, _autoRefreshInterval * 1000);
  }
})();

/* ═══════════════════════════════════════════════════════════════════════════
 * AuthGuard — PHP 后端验证登录拦截器
 *
 * 当 <script> 标签包含 data-auth 时自动启用。
 * 密码存储在服务端（auth-api.php），前端不暴露任何密码信息。
 * 未登录时在背景图之上显示登录遮罩，支持 Bitwarden 等密码管理器自动填充。
 *
 * data 属性：
 *   data-auth    后端验证接口地址（如 auth-api.php），设置即启用登录
 *
 * 页面中可调用 AuthGuard.logout() 退出登录。
 * ═══════════════════════════════════════════════════════════════════════════ */
var AuthGuard = (function () {
  'use strict';

  var STORAGE_KEY = '__ag_token';
  var _authApi = '';
  var _onLoginSuccess = null;

  // ── 移除登录遮罩 ──
  function dismissOverlay() {
    var ol = document.getElementById('__ag_overlay');
    if (ol) {
      ol.style.opacity = '0';
      setTimeout(function () { ol.remove(); }, 350);
    }
    var st = document.getElementById('__ag_style');
    if (st) setTimeout(function () { st.remove(); }, 400);
  }

  // ── 样式 ──
  function injectStyle() {
    if (document.getElementById('__ag_style')) return;
    var s = document.createElement('style');
    s.id = '__ag_style';
    s.textContent =
      '@keyframes __ag_fadeIn{from{opacity:0}to{opacity:1}}' +
      '@keyframes __ag_slideUp{from{opacity:0;transform:translateY(24px) scale(.96)}to{opacity:1;transform:translateY(0) scale(1)}}' +
      '@keyframes __ag_shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-6px)}40%,80%{transform:translateX(6px)}}' +

      '#__ag_overlay{' +
        'position:fixed;inset:0;z-index:2147483646;' +
        'display:flex;align-items:center;justify-content:center;' +
        'background:rgba(0,0,0,.3);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);' +
        'animation:__ag_fadeIn .5s ease;transition:opacity .35s ease;' +
        'visibility:visible;' +
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;' +
      '}' +

      '.__ag_card{' +
        'position:relative;width:360px;max-width:90vw;' +
        'background:color-mix(in srgb,var(--bg-image-theme-color,#1e293b) 25%,rgba(255,255,255,.88));' +
        'border-radius:20px;overflow:hidden;visibility:visible;' +
        'box-shadow:0 25px 50px rgba(0,0,0,.3),inset 0 1px 0 rgba(255,255,255,.5);' +
        'animation:__ag_slideUp .5s cubic-bezier(.16,1,.3,1);' +
      '}' +

      '.__ag_header{' +
        'background:linear-gradient(135deg,' +
          'color-mix(in srgb,var(--bg-image-theme-color,#667eea) 80%,#000) 0%,' +
          'var(--bg-image-theme-color,#667eea) 50%,' +
          'color-mix(in srgb,var(--bg-image-theme-color,#667eea) 70%,#fff) 100%);' +
        'padding:2rem 2rem 1.5rem;text-align:center;' +
      '}' +
      '.__ag_header svg{width:44px;height:44px;margin-bottom:.5rem;opacity:.9;}' +
      '.__ag_header h2{margin:0;font-size:1.3rem;color:var(--bg-image-text-color,#fff);font-weight:600;letter-spacing:.3px;}' +
      '.__ag_header p{margin:.3rem 0 0;font-size:.8rem;color:var(--bg-image-text-color,#fff);opacity:.7;}' +

      '.__ag_body{padding:1.5rem 2rem 1.8rem;}' +
      '.__ag_body label.field{display:block;font-size:.75rem;color:#475569;margin-bottom:.3rem;font-weight:600;letter-spacing:.3px;}' +

      '.__ag_input_wrap{position:relative;margin-bottom:.9rem;}' +
      '.__ag_input_wrap svg{position:absolute;left:.7rem;top:50%;transform:translateY(-50%);width:17px;height:17px;color:#94a3b8;pointer-events:none;}' +
      '.__ag_input_wrap input{' +
        'display:block;width:100%;box-sizing:border-box;' +
        'padding:.65rem .75rem .65rem 2.4rem;' +
        'border:1.5px solid #e2e8f0;border-radius:10px;font-size:.93rem;' +
        'background:#f8fafc;color:#1e293b;outline:none;' +
        'transition:border-color .2s,background .2s,box-shadow .2s;' +
      '}' +
      '.__ag_input_wrap input:focus{' +
        'border-color:var(--bg-image-theme-color,#667eea);background:#fff;' +
        'box-shadow:0 0 0 3px color-mix(in srgb,var(--bg-image-theme-color,#667eea) 18%,transparent);' +
      '}' +
      '.__ag_input_wrap input::placeholder{color:#94a3b8;}' +

      '.__ag_remember{' +
        'display:flex;align-items:center;margin:.3rem 0 1.1rem;cursor:pointer;' +
        '-webkit-user-select:none;user-select:none;' +
      '}' +
      '.__ag_remember input{position:absolute;opacity:0;width:0;height:0;}' +
      '.__ag_remember .check{' +
        'display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;' +
        'width:18px;height:18px;border:2px solid #cbd5e1;border-radius:4px;' +
        'margin-right:.5rem;transition:all .15s ease;background:#fff;' +
      '}' +
      '.__ag_remember input:checked~.check{' +
        'background:var(--bg-image-theme-color,#667eea);border-color:var(--bg-image-theme-color,#667eea);' +
      '}' +
      '.__ag_remember .check svg{width:12px;height:12px;stroke:#fff;stroke-width:3;fill:none;opacity:0;transition:opacity .15s;}' +
      '.__ag_remember input:checked~.check svg{opacity:1;}' +
      '.__ag_remember .text{font-size:.85rem;color:#64748b;line-height:1;}' +

      '.__ag_body button[type="submit"]{' +
        'display:block;width:100%;padding:.7rem;border:none;border-radius:10px;' +
        'background:linear-gradient(135deg,' +
          'var(--bg-image-theme-color,#667eea) 0%,' +
          'color-mix(in srgb,var(--bg-image-theme-color,#667eea) 75%,#000) 100%);' +
        'color:var(--bg-image-text-color,#fff);font-size:.95rem;font-weight:600;letter-spacing:.3px;cursor:pointer;' +
        'transition:transform .15s,box-shadow .2s,opacity .2s;' +
        'box-shadow:0 4px 14px color-mix(in srgb,var(--bg-image-theme-color,#667eea) 40%,transparent);' +
      '}' +
      '.__ag_body button[type="submit"]:hover{transform:translateY(-1px);box-shadow:0 6px 20px color-mix(in srgb,var(--bg-image-theme-color,#667eea) 50%,transparent);}' +
      '.__ag_body button[type="submit"]:active{transform:translateY(0);}' +
      '.__ag_body button[type="submit"]:disabled{opacity:.5;cursor:not-allowed;transform:none;}' +

      '.__ag_error{text-align:center;font-size:.82rem;min-height:1.2em;margin-bottom:.5rem;color:#ef4444;font-weight:500;}' +
      '.__ag_shake{animation:__ag_shake .4s ease;}';

    document.head.appendChild(s);
  }

  // ── 创建登录遮罩 ──
  function createOverlay() {
    if (document.getElementById('__ag_overlay')) return;
    injectStyle();

    var overlay = document.createElement('div');
    overlay.id = '__ag_overlay';
    overlay.innerHTML =
      '<div class="__ag_card">' +
        '<div class="__ag_header">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="var(--bg-image-text-color,#fff)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
            '<rect x="3" y="11" width="18" height="11" rx="2"/>' +
            '<path d="M7 11V7a5 5 0 0 1 10 0v4"/>' +
          '</svg>' +
          '<h2>\u6B22\u8FCE\u56DE\u6765</h2>' +
          '<p>\u8BF7\u767B\u5F55\u4EE5\u7EE7\u7EED\u8BBF\u95EE</p>' +
        '</div>' +
        '<div class="__ag_body">' +
          '<div id="__ag_err" class="__ag_error"></div>' +
          '<form id="__ag_form" onsubmit="return false">' +
            '<label class="field" for="__ag_u">\u7528\u6237\u540D</label>' +
            '<div class="__ag_input_wrap">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' +
              '<input id="__ag_u" name="username" type="text" autocomplete="username" placeholder="\u8BF7\u8F93\u5165\u7528\u6237\u540D" required />' +
            '</div>' +
            '<label class="field" for="__ag_p">\u5BC6\u7801</label>' +
            '<div class="__ag_input_wrap">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>' +
              '<input id="__ag_p" name="password" type="password" autocomplete="current-password" placeholder="\u8BF7\u8F93\u5165\u5BC6\u7801" required />' +
            '</div>' +
            '<label class="__ag_remember">' +
              '<input type="checkbox" id="__ag_rm" />' +
              '<span class="check"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></span>' +
              '<span class="text">\u8BB0\u4F4F\u767B\u5F55</span>' +
            '</label>' +
            '<button type="submit">\u767B\u0020\u0020\u5F55</button>' +
          '</form>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    var form   = document.getElementById('__ag_form');
    var userEl = document.getElementById('__ag_u');
    var passEl = document.getElementById('__ag_p');
    var errEl  = document.getElementById('__ag_err');
    var btn    = form.querySelector('button[type="submit"]');
    var card   = overlay.querySelector('.__ag_card');

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var username = userEl.value.trim();
      var password = passEl.value;
      var remember = !!document.getElementById('__ag_rm').checked;
      if (!username || !password) {
        showError('\u8BF7\u8F93\u5165\u7528\u6237\u540D\u548C\u5BC6\u7801');
        return;
      }

      btn.disabled = true;
      btn.textContent = '\u767B\u5F55\u4E2D\u2026';
      errEl.textContent = '';

      fetch(_authApi + '?action=login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username, password: password, remember: remember })
      })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.success) {
          // 记住登录 → 存 token；不记住 → 不存，刷新即失效
          if (d.token) {
            try { localStorage.setItem(STORAGE_KEY, d.token); } catch (_) {}
          }
          dismissOverlay();
          // 欣赏 2 秒背景后再显示页面内容
          if (_onLoginSuccess) {
            var cb = _onLoginSuccess;
            _onLoginSuccess = null;
            setTimeout(cb, 2000);
          }
        } else {
          showError(d.error || '\u767B\u5F55\u5931\u8D25');
          btn.disabled = false;
          btn.textContent = '\u767B\u0020\u0020\u5F55';
        }
      })
      .catch(function () {
        showError('\u7F51\u7EDC\u9519\u8BEF\uFF0C\u8BF7\u91CD\u8BD5');
        btn.disabled = false;
        btn.textContent = '\u767B\u0020\u0020\u5F55';
      });
    });

    function showError(msg) {
      errEl.textContent = msg;
      card.classList.remove('__ag_shake');
      void card.offsetWidth;
      card.classList.add('__ag_shake');
    }

    requestAnimationFrame(function () {
      if (!userEl.value) userEl.focus();
    });
  }

  return {
    /**
     * 设置 API 地址和登录成功回调，然后显示登录遮罩
     */
    show: function (authApi, onAuthenticated) {
      _authApi = authApi;
      _onLoginSuccess = onAuthenticated;
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createOverlay);
      } else {
        createOverlay();
      }
    },

    /**
     * 已登录时延迟触发回调（欣赏 2 秒背景后显示内容）
     */
    passThrough: function (authApi, onAuthenticated) {
      _authApi = authApi;
      if (onAuthenticated) setTimeout(onAuthenticated, 2000);
    },

    logout: function () {
      try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
      fetch(_authApi + '?action=logout')
        .finally(function () {
          try { location.reload(); } catch (_) { window.location.href = window.location.href; }
        });
    }
  };
})();

// ═══════════════════════════════════════════════════════════════════════════
// 自动初始化
// ═══════════════════════════════════════════════════════════════════════════
// <script src="background-switcher.js"
//         data-api="https://random-image.xct258.top/"
//         data-interval="30"
//         data-auth="auth-api.php">
// </script>
//
// data-api      背景图 API 地址（必填）
// data-interval 自动刷新间隔（秒，可选）
// data-auth     后端验证接口（可选，设置即启用登录）
(function () {
  var script = document.currentScript;
  if (!script) return;

  var apiUrl  = script.getAttribute('data-api') || script.getAttribute('data-apiUrl') || '';
  var authUrl = script.getAttribute('data-auth') || '';

  // 有 data-auth → 读取本地 token 并发起验证（与图片加载并行）
  if (authUrl) {
    var savedToken = '';
    try { savedToken = localStorage.getItem('__ag_token') || ''; } catch (_) {}

    var checkHeaders = {};
    if (savedToken) checkHeaders['X-Auth-Token'] = savedToken;

    var authChecked = fetch(authUrl + '?action=check', { headers: checkHeaders })
      .then(function (r) { return r.json(); })
      .then(function (d) { return !!d.authenticated; })
      .catch(function () { return false; });

    BackgroundSwitcher.onReady(function () {
      authChecked.then(function (ok) {
        if (ok) {
          AuthGuard.passThrough(authUrl, function () {
            BackgroundSwitcher.revealPage();
          });
        } else {
          // token 无效 → 清除
          try { localStorage.removeItem('__ag_token'); } catch (_) {}
          AuthGuard.show(authUrl, function () {
            BackgroundSwitcher.revealPage();
          });
        }
      });
    });
  }

  // ── 背景图初始化 ──
  if (apiUrl) {
    BackgroundSwitcher.init(apiUrl, { silent: false });

    var interval = parseInt(script.getAttribute('data-interval'), 10);
    if (interval > 0) {
      BackgroundSwitcher.setAutoRefresh(apiUrl, interval);
    }
  }
})();
