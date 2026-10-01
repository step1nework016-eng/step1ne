// 人選評價（Google 評論式排版）— 2026-10-01 Jacky：「前端網站要做成像 Google 評論那種 UIUX」，
// 放三個地方：/reviews/ 整頁、應徵表單「還在考慮嗎？」彈窗、首頁與職缺頁的小連結。
// 資料只來自 Jacky 在 TG 按「放官網」＋人選自己勾同意公開的心得；核准不滿 3 則時 API 回空的，
// 這支就什麼都不畫（連結也不出現）——不灌假評價、也不讓只有一兩則的空蕩樣子露出來。
// 只學排版，不用 Google 的商標或字樣。
(function () {
  var API = 'https://step1ne-recruit-api.aiagentg888.workers.dev/review/public';
  var CSS = '' +
    '.s1rv{font-family:-apple-system,"PingFang TC","Noto Sans TC",sans-serif;color:#1b2433;line-height:1.7}' +
    '.s1rv-sum{display:flex;gap:22px;align-items:center;flex-wrap:wrap;padding:18px 0 20px;border-bottom:1px solid #e3e8ef}' +
    '.s1rv-big{text-align:center;min-width:110px}' +
    '.s1rv-big b{display:block;font-size:52px;font-weight:600;line-height:1;letter-spacing:-.02em}' +
    '.s1rv-big small{display:block;color:#6b7686;font-size:13px;margin-top:6px}' +
    '.s1rv-st{color:#f2a516;letter-spacing:2px;font-size:17px}' +
    '.s1rv-st .off{color:#d5dbe3}' +
    '.s1rv-bars{flex:1;min-width:200px;display:grid;gap:5px}' +
    '.s1rv-bar{display:grid;grid-template-columns:14px 1fr 28px;gap:8px;align-items:center;font-size:13px;color:#4a5568}' +
    '.s1rv-bar i{display:block;height:9px;border-radius:5px;background:#eef1f5;overflow:hidden}' +
    '.s1rv-bar i u{display:block;height:100%;background:#f2a516;border-radius:5px}' +
    '.s1rv-list{display:grid;gap:0}' +
    '.s1rv-card{padding:16px 0;border-bottom:1px solid #eef1f5}' +
    '.s1rv-hd{display:flex;gap:12px;align-items:center}' +
    '.s1rv-av{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:16px;flex:none}' +
    '.s1rv-who{font-weight:600;font-size:15px}' +
    '.s1rv-meta{font-size:12.5px;color:#6b7686}' +
    '.s1rv-line{display:flex;gap:8px;align-items:center;margin:8px 0 4px;font-size:13px;color:#6b7686}' +
    '.s1rv-txt{font-size:15px;white-space:pre-line;margin:0}' +
    '.s1rv-txt.clamp{display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}' +
    '.s1rv-more{background:none;border:0;padding:6px 0;min-height:44px;color:#2f5fd8;font:inherit;font-size:14px;cursor:pointer}' +
    '.s1rv-more:focus-visible,.s1rv-badge:focus-visible{outline:3px solid #2f5fd8;outline-offset:2px}' +
    '.s1rv-tag{display:inline-block;margin-top:8px;font-size:12.5px;color:#4a5568;background:#f3f6fa;border-radius:999px;padding:3px 10px}' +
    '.s1rv-badge{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:8px 14px;border:1px solid #e3e8ef;border-radius:999px;background:#fff;color:#1b2433;text-decoration:none;font-size:14px}' +
    '.s1rv-badge b{font-size:15px}' +
    '.s1rv-mini{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 18px;font-size:15px}' +
    '.s1rv-mini b{font-size:26px;line-height:1}' +
    '.s1rv-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}' +
    '.s1rv-grid .s1rv-card{background:#fff;border:1px solid #e3e8ef;border-radius:12px;padding:18px}' +
    '.s1rv-all{display:inline-flex;align-items:center;min-height:44px;margin-top:16px;font-weight:600}' +
    '@media (prefers-reduced-motion:reduce){.s1rv *{transition:none!important}}';

  function css() {
    if (document.getElementById('s1rv-css')) return;
    var st = document.createElement('style'); st.id = 's1rv-css'; st.textContent = CSS; document.head.appendChild(st);
  }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function stars(n) {
    n = Math.max(0, Math.min(5, Math.round(n)));
    return '<span class="s1rv-st" aria-label="' + n + ' 顆星">' + '★★★★★'.slice(0, n) + '<span class="off">' + '★★★★★'.slice(0, 5 - n) + '</span></span>';
  }
  // 頭像底色：用稱呼決定，同一個人每次同色；6 個低飽和色，白字對比都 > 4.5:1
  var AV = ['#2f5fd8', '#0f766e', '#9333ea', '#b45309', '#be123c', '#475569'];
  function avColor(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV[h % AV.length]; }
  function when(m) { if (!m) return ''; var p = String(m).split('-'); return p[0] + ' 年 ' + Number(p[1]) + ' 月'; }

  var cache = null;
  function load() {
    if (!cache) cache = fetch(API).then(function (r) { return r.json(); }).catch(function () { return { reviews: [], stats: null }; });
    return cache;
  }

  function summaryHtml(st) {
    var max = Math.max.apply(null, [1, st.dist[5], st.dist[4], st.dist[3], st.dist[2], st.dist[1]]);
    var bars = [5, 4, 3, 2, 1].map(function (k) {
      return '<div class="s1rv-bar"><span>' + k + '</span><i><u style="width:' + Math.round((st.dist[k] / max) * 100) + '%"></u></i><span>' + st.dist[k] + '</span></div>';
    }).join('');
    return '<div class="s1rv-sum"><div class="s1rv-big"><b>' + st.avg.toFixed(1) + '</b>' + stars(st.avg) +
      '<small>' + st.total + ' 則人選評價</small></div><div class="s1rv-bars" aria-label="各星等則數">' + bars + '</div></div>';
  }
  function cardHtml(r, i) {
    var who = r.who || '匿名人選';
    var init = r.who ? r.who.charAt(0) : '人';
    var tag = [r.job, r.consultant ? '負責顧問：' + r.consultant : ''].filter(Boolean).join('・');
    var long = String(r.text || '').length > 70;
    return '<article class="s1rv-card"><div class="s1rv-hd"><span class="s1rv-av" style="background:' + avColor(who + (r.job || '')) + '" aria-hidden="true">' + esc(init) + '</span>' +
      '<div><div class="s1rv-who">' + esc(who) + '</div><div class="s1rv-meta">透過 Step1ne 求職</div></div></div>' +
      '<div class="s1rv-line">' + stars(r.rating) + '<span>' + esc(when(r.month)) + '</span></div>' +
      '<p class="s1rv-txt' + (long ? ' clamp' : '') + '" id="s1rv-t' + i + '">' + esc(r.text) + '</p>' +
      (long ? '<button type="button" class="s1rv-more" data-s1rv-more="s1rv-t' + i + '" aria-expanded="false">看更多</button>' : '') +
      (tag ? '<div><span class="s1rv-tag">' + esc(tag) + '</span></div>' : '') + '</article>';
  }

  // 整塊（總覽＋卡片）畫進 el；沒資料回 false，呼叫端自己決定要不要顯示替代內容
  function renderInto(el, d, opts) {
    opts = opts || {};
    if (!el || !d || !d.stats || !(d.reviews || []).length) return false;
    css();
    var list = d.reviews.slice(0, opts.limit || d.reviews.length);
    var head = opts.compact
      ? '<div class="s1rv-mini">' + stars(d.stats.avg) + '<b>' + d.stats.avg.toFixed(1) + '</b><span>' + d.stats.total + ' 則人選評價</span></div>'
      : summaryHtml(d.stats);
    var more = opts.moreHref && (opts.compact || d.reviews.length > list.length)
      ? '<a class="s1rv-all" href="' + opts.moreHref + '">看全部 ' + d.stats.total + ' 則評價 →</a>' : '';
    el.innerHTML = '<div class="s1rv">' + head + '<div class="' + (opts.compact ? 's1rv-grid' : 's1rv-list') + '">' + list.map(cardHtml).join('') + '</div>' + more + '</div>';
    el.querySelectorAll('[data-s1rv-more]').forEach(function (b) {
      b.addEventListener('click', function () {
        var t = document.getElementById(b.getAttribute('data-s1rv-more'));
        var open = t.classList.toggle('clamp') === false;
        b.textContent = open ? '收起' : '看更多'; b.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    });
    el.hidden = false;
    return true;
  }

  // 小連結：<div data-s1-reviews-badge></div>，滿 3 則才出現
  function badges(d) {
    var els = document.querySelectorAll('[data-s1-reviews-badge]');
    if (!els.length || !d || !d.stats) return;
    css();
    els.forEach(function (el) {
      el.innerHTML = '<a class="s1rv-badge" href="/reviews/" data-cta="reviews-badge"><span class="s1rv-st" aria-hidden="true">★</span><b>' + d.stats.avg.toFixed(1) +
        '</b><span>' + d.stats.total + ' 則人選評價</span><span aria-hidden="true">→</span></a>';
      el.hidden = false;
    });
  }

  window.S1Reviews = { load: load, renderInto: renderInto };
  function boot() {
    load().then(function (d) {
      badges(d);
      // 首頁「人選怎麼說」：精簡版 3 則＋連到 /reviews/；沒資料整段維持隱藏
      var home = document.querySelector('[data-s1-reviews-home]');
      if (home && renderInto(home.querySelector('[data-s1-reviews-slot]'), d, { compact: true, limit: 3, moreHref: '/reviews/' })) home.hidden = false;
      var page = document.querySelector('[data-s1-reviews-page]');
      if (page && !renderInto(page, d)) { var e = document.querySelector('[data-s1-reviews-empty]'); if (e) e.hidden = false; }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
