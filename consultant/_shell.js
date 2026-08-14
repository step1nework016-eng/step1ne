/*
 * Step1ne 顧問後台 — 共用導覽外殼
 * ------------------------------------------------------------
 * 純視覺／導覽用的殼，不呼叫任何 admin API、不碰任何頁面既有的
 * 業務邏輯。每支 consultant 目錄下的 index.html 只要在 <head> 或 <body>
 * 加一行：
 *   <script defer src="/consultant/_shell.js"></script>
 * 就會套用：
 *   - 桌面（≥1024px）：左側固定 sidebar
 *   - 手機／平板（<1024px）：底部固定 tab bar（常用 4 頁）＋「更多」
 *     收合剩下的頁面
 *
 * 這支檔案只會「新增」DOM（一個 fixed 定位的殼），不會刪除或修改
 * 頁面原本的任何元素。原本每頁 header 裡手刻的那排導覽連結
 * （含「登出」、reports 頁的「＋新增候選人」按鈕、人數計數器等）
 * 完全不動——刻意不去動它們，因為部分頁面把導覽連結跟功能按鈕混在
 * 同一個容器裡，用 CSS/JS 硬摘連結有誤傷功能元件的風險。
 * 這批連結目前功能正常，只是跟新的 sidebar／bottom tab 有一點視覺
 * 重複，如果之後要清掉，需要另外評估、逐頁處理。
 *
 * 有沒有登入（#gate / #app 的 hidden 狀態）由本殼透過 MutationObserver
 * 鏡射，沒有 #app 元素的頁面（面談規格頁，本來就沒有權杖門檻）視為
 * 一律已登入。
 */
(function () {
  'use strict';
  if (window.__s1shellLoaded) return;
  window.__s1shellLoaded = true;

  var PAGES = [
    { href: '/consultant/jobs/',           label: '職缺分類', icon: 'funnel', primary: true  },
    { href: '/consultant/reports/',        label: '初篩報告', icon: 'doc',    primary: true  },
    { href: '/consultant/clients/',        label: '客戶名單', icon: 'people', primary: true  },
    { href: '/consultant/bd/',             label: '開發客戶', icon: 'target', primary: true  },
    { href: '/consultant/job-intake/',     label: '新增職缺', icon: 'plus',   primary: false },
    { href: '/consultant/job-draft/',      label: '改擬稿',   icon: 'pencil', primary: false },
    { href: '/consultant/interview-spec/', label: '面談規格', icon: 'clip',   primary: false },
    { href: '/consultant/checkups/',       label: '阿福健檢', icon: 'pulse',  primary: false },
    { href: '/consultant/line-bindings/',  label: 'LINE 進度綁定', icon: 'clip', primary: false },
    { href: '/consultant/token-usage/',    label: 'Token 用量', icon: 'chart', primary: false }
  ];

  var ICONS = {
    funnel: '<path d="M3 4h14l-5.2 6.2v4.6L8.2 16v-5.8L3 4z"/>',
    doc:    '<path d="M6 2.5h6l3.5 3.5V17a.5.5 0 0 1-.5.5H6a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5z"/><path d="M12 2.5V6h3.5" stroke-linejoin="round"/><path d="M7.5 10.5h5M7.5 13h5M7.5 8h3" />',
    people: '<circle cx="7" cy="6.2" r="2.2"/><circle cx="14" cy="7.4" r="1.8"/><path d="M2.6 16.2c.5-3 2.2-4.6 4.4-4.6s3.9 1.6 4.4 4.6" /><path d="M12.4 12.4c1.8.1 3.1 1.5 3.5 3.8" />',
    target: '<circle cx="10" cy="10" r="7"/><circle cx="10" cy="10" r="3.6"/><circle cx="10" cy="10" r=".6" fill="currentColor" stroke="none"/>',
    plus:   '<circle cx="10" cy="10" r="7.3"/><path d="M10 6.6v6.8M6.6 10h6.8"/>',
    pencil: '<path d="M12.6 3.4l3 3-8.9 8.9-3.6.6.6-3.6 8.9-8.9z"/><path d="M10.8 5.2l3 3"/>',
    clip:   '<path d="M6.2 4h7.6a1 1 0 0 1 1 1v11.2a1 1 0 0 1-1 1H6.2a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/><path d="M7.7 2.8h4.6a.6.6 0 0 1 .6.6v1.2a.6.6 0 0 1-.6.6H7.7a.6.6 0 0 1-.6-.6V3.4a.6.6 0 0 1 .6-.6z" fill="#fff"/><path d="M7 9h6M7 11.6h6M7 14.2h4" />',
    more:   '<circle cx="4.5" cy="10" r="1.3" fill="currentColor" stroke="none"/><circle cx="10" cy="10" r="1.3" fill="currentColor" stroke="none"/><circle cx="15.5" cy="10" r="1.3" fill="currentColor" stroke="none"/>',
    collapse: '<rect x="2.5" y="3.5" width="15" height="13" rx="2"/><path d="M8 3.5v13"/><path d="M5.6 8.2l-1.6 1.8 1.6 1.8" />',
    pulse: '<path d="M2 10.5h3.2l1.6-4 2.6 8 1.8-6.5 1.4 2.5H18" />',
    chart: '<rect x="3" y="10.5" width="3" height="6.5" rx=".5"/><rect x="8.5" y="6" width="3" height="11" rx=".5"/><rect x="14" y="3" width="3" height="14" rx=".5"/>'
  };

  function svg(name) {
    return '<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" ' +
      'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (ICONS[name] || '') + '</svg>';
  }

  function normPath(p) {
    if (p.length > 1 && p.charAt(p.length - 1) !== '/') p += '/';
    return p;
  }
  var HERE = normPath(location.pathname);

  function isActive(href) { return HERE === href; }

  var STYLE = '' +
    '#s1shell-root{font-family:-apple-system,BlinkMacSystemFont,"Noto Sans TC","PingFang TC",sans-serif}' +
    '#s1shell-root a{text-decoration:none}' +
    /* sidebar */
    '#s1shell-sidebar{display:none;position:fixed;top:0;left:0;bottom:0;width:212px;z-index:30;' +
      'background:#fff;border-right:1px solid #eee7db;flex-direction:column;overflow-y:auto}' +
    '#s1shell-sidebar .s1-brand{display:flex;align-items:center;gap:10px;padding:18px 10px 16px 18px;' +
      'border-bottom:1px solid #eee7db;margin-bottom:8px}' +
    '#s1shell-sidebar .s1-brand img{height:24px;flex:none}' +
    '#s1shell-sidebar .s1-brand b{font-size:13px;color:#8a8d95;font-weight:600;letter-spacing:.02em;flex:1}' +
    '#s1shell-collapse-btn{flex:none;width:28px;height:28px;border:0;background:#f2efe8;border-radius:8px;' +
      'display:flex;align-items:center;justify-content:center;cursor:pointer;color:#4d5563}' +
    '#s1shell-collapse-btn:hover{background:#eee7db}' +
    '#s1shell-reopen-btn{display:none;position:fixed;top:16px;left:16px;z-index:31;width:36px;height:36px;' +
      'border:1px solid #eee7db;background:#fff;border-radius:10px;align-items:center;justify-content:center;' +
      'cursor:pointer;color:#4d5563;box-shadow:0 2px 10px rgba(35,38,45,.08)}' +
    '#s1shell-reopen-btn:hover{background:#faf8f3}' +
    'html.s1shell-sb-collapsed #s1shell-sidebar{display:none!important}' +
    'html.s1shell-sb-collapsed body{padding-left:0!important}' +
    '@media(min-width:1024px){html.s1shell-authed.s1shell-sb-collapsed #s1shell-reopen-btn{display:flex}}' +
    '#s1shell-sidebar nav{padding:0 10px;display:flex;flex-direction:column;gap:2px}' +
    '#s1shell-sidebar nav a{display:flex;align-items:center;gap:11px;padding:10px 12px;border-radius:10px;' +
      'color:#4d5563;font-size:14px;font-weight:500;min-height:40px}' +
    '#s1shell-sidebar nav a svg{color:#8a8d95;flex:none}' +
    '#s1shell-sidebar nav a:hover{background:#faf8f3}' +
    '#s1shell-sidebar nav a.on{background:#23262d;color:#fff}' +
    '#s1shell-sidebar nav a.on svg{color:#fff}' +
    '#s1shell-sidebar .s1-sep{height:1px;background:#eee7db;margin:10px 16px}' +
    /* bottom tab bar */
    '#s1shell-tabbar{display:none;position:fixed;left:0;right:0;bottom:0;z-index:30;' +
      'background:#fff;border-top:1px solid #eee7db;box-shadow:0 -2px 14px rgba(35,38,45,.06);' +
      'padding-bottom:env(safe-area-inset-bottom,0)}' +
    '#s1shell-tabbar .s1-row{display:flex;align-items:stretch}' +
    '#s1shell-tabbar a,#s1shell-tabbar button{flex:1 1 0;display:flex;flex-direction:column;' +
      'align-items:center;justify-content:center;gap:3px;min-height:56px;padding:6px 2px;' +
      'color:#8a8d95;font-size:10.5px;font-weight:600;background:none;border:0;font-family:inherit;' +
      'cursor:pointer;-webkit-tap-highlight-color:transparent}' +
    '#s1shell-tabbar a svg,#s1shell-tabbar button svg{color:inherit}' +
    '#s1shell-tabbar a.on,#s1shell-tabbar button.on{color:#a67c3d}' +
    /* more sheet */
    '#s1shell-more-backdrop{display:none;position:fixed;inset:0;background:rgba(35,38,45,.4);z-index:31}' +
    '#s1shell-more-backdrop.on{display:block}' +
    '#s1shell-more-sheet{display:none;position:fixed;left:0;right:0;bottom:0;z-index:32;background:#fff;' +
      'border-radius:16px 16px 0 0;box-shadow:0 -8px 30px rgba(0,0,0,.18);' +
      'padding:6px 10px calc(14px + env(safe-area-inset-bottom,0))}' +
    '#s1shell-more-sheet.on{display:block}' +
    '#s1shell-more-sheet .s1-hd{display:flex;align-items:center;justify-content:space-between;' +
      'padding:10px 8px 6px;font-size:13px;font-weight:700;color:#23262d}' +
    '#s1shell-more-sheet .s1-hd button{border:0;background:#f2efe8;border-radius:8px;width:28px;height:28px;' +
      'font-size:15px;line-height:1;cursor:pointer;color:#4d5563}' +
    '#s1shell-more-sheet a{display:flex;align-items:center;gap:12px;padding:12px 10px;border-radius:10px;' +
      'color:#23262d;font-size:14.5px;font-weight:500;min-height:44px}' +
    '#s1shell-more-sheet a:active{background:#faf8f3}' +
    '#s1shell-more-sheet a svg{color:#a67c3d;flex:none}' +
    /* 每頁 header 裡原本手刻的導覽連結現在由 sidebar／bottom tab 取代。
       只精準隱藏「連到其他 consultant 頁面」的連結本身，範圍鎖在 header
       裡面——不動 #out（登出，href="#"，不會中招）、不動 reports 頁混在
       同一列的「＋新增候選人」按鈕／人數計數器，也不會碰到頁面內容區
       動態產生的深連結（例如漏斗彈窗裡的「處置」連結，那不在 header 裡）。 */
    'html.s1shell-authed header nav a[href^="/consultant/"],' +
    'html.s1shell-authed header .mut a[href^="/consultant/"]{display:none}' +
    /* layout reservation — only once authenticated content is showing */
    '@media(min-width:1024px){' +
      'html.s1shell-authed #s1shell-sidebar{display:flex}' +
      'html.s1shell-authed body{padding-left:212px}' +
    '}' +
    '@media(max-width:1023.98px){' +
      'html.s1shell-authed #s1shell-tabbar{display:block}' +
      'html.s1shell-authed body{padding-bottom:calc(60px + env(safe-area-inset-bottom,0))}' +
    '}';

  function injectStyle() {
    var s = document.createElement('style');
    s.id = 's1shell-style';
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  function buildSidebar() {
    var el = document.createElement('div');
    el.id = 's1shell-sidebar';
    var html = '<div class="s1-brand"><img src="/assets/step1ne-logo.png" alt="Step1ne">' +
      '<b>顧問後台</b><button type="button" id="s1shell-collapse-btn" title="隱藏側邊欄" aria-label="隱藏側邊欄">' +
      svg('collapse') + '</button></div><nav>';
    PAGES.forEach(function (p) {
      html += '<a href="' + p.href + '"' + (isActive(p.href) ? ' class="on"' : '') + '>' +
        svg(p.icon) + '<span>' + p.label + '</span></a>';
    });
    html += '</nav>';
    el.innerHTML = html;
    return el;
  }

  function buildTabbar() {
    var el = document.createElement('div');
    el.id = 's1shell-tabbar';
    var primary = PAGES.filter(function (p) { return p.primary; });
    var overflow = PAGES.filter(function (p) { return !p.primary; });
    var overflowActive = overflow.some(function (p) { return isActive(p.href); });
    var html = '<div class="s1-row">';
    primary.forEach(function (p) {
      html += '<a href="' + p.href + '"' + (isActive(p.href) ? ' class="on"' : '') + '>' +
        svg(p.icon) + '<span>' + p.label + '</span></a>';
    });
    html += '<button type="button" id="s1shell-more-btn"' + (overflowActive ? ' class="on"' : '') + '>' +
      svg('more') + '<span>更多</span></button>';
    html += '</div>';
    el.innerHTML = html;
    return el;
  }

  function buildMoreSheet() {
    var overflow = PAGES.filter(function (p) { return !p.primary; });
    var backdrop = document.createElement('div');
    backdrop.id = 's1shell-more-backdrop';
    var sheet = document.createElement('div');
    sheet.id = 's1shell-more-sheet';
    var html = '<div class="s1-hd"><span>更多頁面</span><button type="button" id="s1shell-more-close" aria-label="關閉">×</button></div>';
    overflow.forEach(function (p) {
      html += '<a href="' + p.href + '"' + (isActive(p.href) ? ' style="color:#a67c3d"' : '') + '>' +
        svg(p.icon) + '<span>' + p.label + '</span></a>';
    });
    sheet.innerHTML = html;
    return { backdrop: backdrop, sheet: sheet };
  }

  function wireMoreSheet(backdrop, sheet, btn) {
    function open() { backdrop.className = 'on'; sheet.className = 'on'; }
    function close() { backdrop.className = ''; sheet.className = ''; }
    btn.addEventListener('click', function (e) { e.stopPropagation(); open(); });
    backdrop.addEventListener('click', close);
    var closeBtn = sheet.querySelector('#s1shell-more-close');
    if (closeBtn) closeBtn.addEventListener('click', close);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  }

  function syncAuthState() {
    var appEl = document.getElementById('app');
    function apply() {
      var authed = appEl ? !appEl.hidden : true;
      document.documentElement.classList.toggle('s1shell-authed', authed);
    }
    apply();
    if (appEl && window.MutationObserver) {
      new MutationObserver(apply).observe(appEl, { attributes: true, attributeFilter: ['hidden'] });
    }
  }

  var COLLAPSE_KEY = 's1shell-sidebar-collapsed';

  function wireCollapse(sidebar) {
    var reopenBtn = document.createElement('button');
    reopenBtn.type = 'button';
    reopenBtn.id = 's1shell-reopen-btn';
    reopenBtn.title = '顯示側邊欄';
    reopenBtn.setAttribute('aria-label', '顯示側邊欄');
    reopenBtn.innerHTML = svg('collapse');
    document.body.appendChild(reopenBtn);

    function setCollapsed(collapsed) {
      document.documentElement.classList.toggle('s1shell-sb-collapsed', collapsed);
      try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch (e) {}
    }

    // 側邊欄只在桌面寬度才有意義，手機/平板本來就是 bottom tab，
    // 這個狀態只影響 ≥1024px 的版面，記住的值跨分頁/整個網域共用。
    var saved = false;
    try { saved = localStorage.getItem(COLLAPSE_KEY) === '1'; } catch (e) {}
    if (saved) setCollapsed(true);

    var collapseBtn = sidebar.querySelector('#s1shell-collapse-btn');
    if (collapseBtn) collapseBtn.addEventListener('click', function () { setCollapsed(true); });
    reopenBtn.addEventListener('click', function () { setCollapsed(false); });
  }

  function init() {
    injectStyle();

    var root = document.createElement('div');
    root.id = 's1shell-root';

    var sidebar = buildSidebar();
    var tabbar = buildTabbar();
    var more = buildMoreSheet();

    root.appendChild(sidebar);
    root.appendChild(tabbar);
    root.appendChild(more.backdrop);
    root.appendChild(more.sheet);
    document.body.appendChild(root);

    var moreBtn = tabbar.querySelector('#s1shell-more-btn');
    if (moreBtn) wireMoreSheet(more.backdrop, more.sheet, moreBtn);

    wireCollapse(sidebar);
    syncAuthState();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
