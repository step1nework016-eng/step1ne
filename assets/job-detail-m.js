/* 職缺詳細頁改版（2026-10-04）：版面與資訊擺放參考 CareerOS「職缺雷達」職缺頁，配色用 Step1ne logo 藍。
 * 職缺頁本體是 publish_job.py 用 jobtpl/chrome_top.tpl＋chrome_bot.html 產的靜態 HTML（SEO 用的文字都在原始碼裡），
 * 這支只在瀏覽器把同一份內容重新排版，不新增也不改動任何職缺文字：
 *   麵包屑 → 類型標籤 → 職稱 → 地點・刊登日 → 薪資卡 → 資訊表 → 職缺摘要
 *   → 分頁卡（工作內容／應徵條件／為什麼選這個機會）→ 應徵流程時間軸 → 常見問題 → 相關職缺
 *   → 底部固定「LINE 洽詢＋我要應徵」（滑到「立即應徵」區塊時自動收起）
 */
try {
(function () {
  var main = document.querySelector('main');
  var h1 = main && main.querySelector('h1');
  var spec = main && main.querySelector('dl.spec');
  if (!main || !h1 || !spec) return;
  document.body.classList.add('jv2d');

  var css = ''
    + ':root{--jv-ink:#0f1b2d;--jv-ink2:#475569;--jv-mut:#64748b;--jv-line:#e2e8f0;--jv-bg:#f6f8fb;--jv-blue:#1880B4;--jv-blue-d:#0f5f88;--jv-tint:#e8f3fa;--jv-green:#0f766e;--jv-green-bg:#e9f7f3;--jv-amber:#a15c07;--jv-amber-bg:#fdf3e2}'
    + 'body.jv2d{background:var(--jv-bg)!important}'
    + 'body.jv2d>header{background:rgba(255,255,255,.94)!important;border-bottom-color:var(--jv-line)!important}'
    + 'body.jv2d footer{background:#eef2f7!important;border-top-color:var(--jv-line)!important}'
    + '.jv2d main{font-family:"Noto Sans TC",-apple-system,"PingFang TC",sans-serif;color:var(--jv-ink)}'
    + '.jv2d main .wrap{max-width:820px}'
    + '.jd{padding-block:18px 30px}'
    + '.jd-crumb{display:flex;gap:6px;white-space:nowrap;overflow:hidden;'+'font-size:13px;color:var(--jv-mut);margin:0 0 16px}.jd-crumb a{color:var(--jv-mut)}.jd-crumb span{color:#cbd5e1}'
    + '.jd-type{display:flex;align-items:center;gap:10px;margin:0 0 10px}'
    + '.jd-logo{width:36px;height:36px;border-radius:9px;border:1px solid var(--jv-line);display:grid;place-items:center;font-weight:900;font-size:14px;color:var(--jv-blue-d);background:var(--jv-tint)}'
    + '.jd-logo.t-senior{color:var(--jv-green);background:var(--jv-green-bg)}.jd-logo.t-dispatch{color:var(--jv-amber);background:var(--jv-amber-bg)}'
    + '.jd-type b{font-size:14px}'
    + '.jv2d main h1{font-family:inherit!important;font-weight:900!important;font-size:clamp(24px,5.4vw,34px)!important;line-height:1.35!important;letter-spacing:-.3px;margin:0 0 10px!important;color:var(--jv-ink)!important}'
    + '.jd-tags{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 10px}'
    + '.jd-tags span{font-size:12.5px;font-weight:600;color:var(--jv-ink2);background:#f1f5f9;border-radius:6px;padding:3px 8px}.jd-tags span.hl{color:var(--jv-green);background:var(--jv-green-bg);border:1px solid #bfe6db}'
    + '.jd-meta{font-size:14px;color:var(--jv-mut);margin:0 0 18px}'
    + '.jd-card{background:#fff;border:1px solid var(--jv-line);border-radius:14px;padding:16px 18px;margin:0 0 12px}'
    + '.jd-k{font-size:13px;color:var(--jv-mut);margin:0 0 4px}'
    + '.jd-pay{display:flex;align-items:center;flex-wrap:wrap;gap:8px;font-size:24px;font-weight:900}'
    + '.jd-est{font-size:12px;font-weight:700;color:var(--jv-amber);background:var(--jv-amber-bg);border:1px solid #f3d9a8;border-radius:6px;padding:2px 6px}'
    + '.jd-note{font-size:13px;color:var(--jv-mut);margin:8px 0 0}'
    + '.jd-info{display:grid;grid-template-columns:88px 1fr;gap:12px 14px;font-size:14.5px}.jd-info dt{color:var(--jv-mut)}.jd-info dd{margin:0;font-weight:600}'
    + '.jd h2.jd-h{font-family:inherit!important;font-size:19px!important;font-weight:800!important;margin:28px 0 10px!important;color:var(--jv-ink)!important;border:none!important;padding:0!important}'
    + '.jd-sum{font-size:15.5px;line-height:1.8;color:var(--jv-ink2);margin:0}'
    + '.jd-tabs{display:inline-flex;gap:4px;background:#eef2f7;border-radius:10px;padding:4px;margin:0 0 12px;flex-wrap:wrap}'
    + '.jd-tabs button{font-family:inherit;font-size:14px;font-weight:700;color:var(--jv-ink2);background:none;border:none;border-radius:8px;padding:0 12px;min-height:40px;cursor:pointer}'
    + '.jd-tabs button.on{background:#fff;color:var(--jv-ink);box-shadow:0 1px 3px rgba(15,27,45,.12)}'
    + '.jd-pane h3{font-family:inherit!important;font-size:15px!important;font-weight:800!important;color:var(--jv-green)!important;margin:14px 0 6px!important}.jd-pane h3:first-child{margin-top:0!important}'
    + '.jd-pane ul{margin:0 0 6px;padding-left:0;list-style:none}.jd-pane li{position:relative;padding-left:16px;margin:0 0 6px;font-size:15px;line-height:1.7;color:var(--jv-ink)}'
    + '.jd-pane li:before{content:"";position:absolute;left:2px;top:.72em;width:6px;height:6px;border-radius:50%;background:var(--jv-green)}'
    + '.jd-pane>div{background:none!important;border:none!important;padding:0!important}.jd-pane [style*="Space Mono"]{font-family:inherit!important;font-size:13px!important;font-weight:800!important;letter-spacing:0!important;color:var(--jv-green)!important}'
    + '.jd-pane div[style*="grid"]{display:block!important}.jd-pane p{color:var(--jv-ink2)!important}'
    + '.jd-tl{list-style:none;margin:0;padding:0}.jd-tl li{position:relative;padding:0 0 14px 26px;font-size:15px;font-weight:700}'
    + '.jd-tl li:before{content:"";position:absolute;left:4px;top:5px;width:10px;height:10px;border-radius:50%;border:2px solid var(--jv-green);background:#fff}'
    + '.jd-tl li:after{content:"";position:absolute;left:9px;top:19px;bottom:0;width:2px;background:#d6e4e1}.jd-tl li:last-child:after{display:none}'
    + '.jd-tl small{display:block;font-weight:500;color:var(--jv-mut);font-size:12.5px}'
    + '.jd-apply a[href^="/apply/"]{background:var(--jv-ink)!important;border-radius:12px!important}.jd-apply a[href*="lin.ee"]{color:var(--jv-blue)!important}'
    + '.jd-faq details{border-color:var(--jv-line)!important}.jd-faq .faq-icon{color:var(--jv-blue)!important;font-family:inherit!important}'
    + '.jd-rel a{display:block;padding:14px 16px;margin:0 0 10px;background:#fff;border:1px solid var(--jv-line);border-radius:12px;color:var(--jv-ink)}'
    + '.jd-rel b{display:block;font-size:15.5px;margin:0 0 4px}.jd-rel small{font-size:14px;font-weight:800}.jd-rel em{display:block;font-style:normal;font-size:12.5px;color:var(--jv-mut);margin-top:2px}'
    + '.jd-bar{position:fixed;left:0;right:0;bottom:0;z-index:60;padding:10px 16px calc(10px + env(safe-area-inset-bottom,0px));background:rgba(255,255,255,.96);backdrop-filter:blur(10px);border-top:1px solid var(--jv-line);transition:transform .25s}'
    + '.jd-bar>div{max-width:820px;margin:0 auto;display:flex;gap:10px}.jd-bar.is-off{transform:translateY(110%)}'
    + '.jd-bar a{display:flex;align-items:center;justify-content:center;min-height:48px;border-radius:12px;font-weight:800;font-size:15.5px}'
    + '.jd-bar .go{flex:1;background:var(--jv-ink);color:#fff}.jd-bar .line{flex:0 0 36%;background:#fff;border:1px solid #cbd5e1;color:var(--jv-ink)}'
    + 'body.jv2d{padding-bottom:84px}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  var esc = function (t) { return String(t || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var rows = {}, heads = {};
  [].slice.call(spec.querySelectorAll('.spec-row')).forEach(function (r) {
    var dt = r.querySelector('dt'), dd = r.querySelector('dd');
    if (dt && dd) {
      // dd 裡的補充說明（span）跟主句之間補分隔，免得黏成「70,000 元薪資組成…」
      var main = [].slice.call(dd.childNodes).filter(function (n) { return n.nodeType === 3; }).map(function (n) { return n.textContent; }).join('').trim();
      var extra = [].slice.call(dd.children).map(function (c) { return c.textContent.trim(); }).filter(Boolean);
      var k = dt.textContent.trim();
      rows[k] = [main].concat(extra).filter(Boolean).join('；') || dd.textContent.trim();
      heads[k] = (main || dd.textContent.trim()).split('｜')[0].trim();
    }
  });
  var sub = h1.querySelector('.h1-sub');
  var summary = sub ? sub.textContent.trim() : '';
  var title = (sub ? h1.firstChild.textContent : h1.textContent).trim();
  var slug = (location.pathname.match(/\/jobs\/([^/]+)/) || [])[1] || '';

  // 依 h2 把原本內容切成段落（h2 標題 → 底下的元素）
  var body = spec.closest('.wrap');
  var groups = [], cur = null;
  [].slice.call(body.children).forEach(function (el) {
    if (el.tagName === 'H2') { cur = { t: el.textContent.trim(), h: el, els: [] }; groups.push(cur); }
    else if (cur) cur.els.push(el);
  });
  var g = function (re) { return groups.filter(function (x) { return re.test(x.t); })[0]; };
  var gSpec = g(/條件一覽/), gDuty = g(/工作內容/), gReq = g(/應徵條件/), gWhy = g(/為什麼/), gFlow = g(/應徵流程/), gApply = g(/立即應徵/), gFaq = g(/常見問題/);
  var note = gSpec ? gSpec.els.filter(function (e) { return e.tagName === 'P'; })[0] : null;

  var jd = document.createElement('div'); jd.className = 'wrap jd';
  // 2026-10-12：多數職缺頁欄位叫「薪資待遇」不是「薪資」，原本一律掉到「薪資面議」
  var payTxt = heads['薪資'] || heads['薪資待遇'] || '薪資面議';
  var info = Object.keys(rows).filter(function (k) { return k !== '薪資'; });
  jd.innerHTML = '<nav class="jd-crumb" aria-label="導覽"><a href="/jobs/">職缺專區</a><span>›</span><span id="jdCrumbType" style="color:inherit"></span><span id="jdCrumbSep" hidden>›</span><span style="color:var(--jv-ink)">' + esc(title) + '</span></nav>'
    + '<div class="jd-type"><span class="jd-logo" id="jdLogo" aria-hidden="true">職</span><b id="jdType">Step1ne 顧問接洽</b></div>'
    + '<div id="jdTitle"></div>'
    + '<div class="jd-tags">' + [rows['僱傭型態'], '可保密初談'].filter(Boolean).map(function (t, i) { return '<span' + (i === 1 ? ' class="hl"' : '') + '>' + esc(t) + '</span>'; }).join('') + '</div>'
    + '<p class="jd-meta">' + [rows['工作地點'], rows['刊登日期'] ? rows['刊登日期'] + ' 刊登' : ''].filter(Boolean).map(esc).join(' · ') + '</p>'
    + '<div class="jd-card"><div class="jd-k">薪資</div><div class="jd-pay">' + esc(payTxt) + '<span class="jd-est">依經歷調整</span>' + '</div>'
    + '<p class="jd-note" id="jdNote"></p></div>'
    + (info.length ? '<div class="jd-card"><dl class="jd-info">' + info.map(function (k) { return '<dt>' + esc(k) + '</dt><dd>' + esc(rows[k]) + '</dd>'; }).join('') + '</dl></div>' : '')
    + (summary ? '<h2 class="jd-h">職缺摘要</h2><p class="jd-sum">' + esc(summary) + '</p>' : '');
  jd.querySelector('#jdTitle').appendChild(h1);
  if (sub) sub.remove();
  if (note) { jd.querySelector('#jdNote').textContent = note.textContent.replace(/^※\s*/, ''); }

  // 分頁卡：工作內容／應徵條件／為什麼選這個機會
  var tabs = [[gDuty, '工作內容'], [gReq, '應徵條件'], [gWhy, '為什麼選這個機會']].filter(function (x) { return x[0]; });
  if (tabs.length) {
    var h = document.createElement('h2'); h.className = 'jd-h'; h.textContent = '職缺內容'; jd.appendChild(h);
    var bar = document.createElement('div'); bar.className = 'jd-tabs'; bar.setAttribute('role', 'tablist');
    var card = document.createElement('div'); card.className = 'jd-card';
    tabs.forEach(function (x, i) {
      var b = document.createElement('button'); b.type = 'button'; b.textContent = x[1]; b.setAttribute('role', 'tab');
      if (!i) b.className = 'on';
      var pane = document.createElement('div'); pane.className = 'jd-pane'; pane.hidden = i > 0;
      x[0].els.forEach(function (e) { pane.appendChild(e); });
      b.onclick = function () { [].forEach.call(bar.children, function (c) { c.classList.remove('on'); }); b.classList.add('on'); [].forEach.call(card.children, function (p) { p.hidden = p !== pane; }); };
      bar.appendChild(b); card.appendChild(pane);
    });
    jd.appendChild(bar); jd.appendChild(card);
  }
  // 應徵流程 → 時間軸
  if (gFlow) {
    var steps = [];
    gFlow.els.forEach(function (e) { [].slice.call(e.querySelectorAll('div[style*="font-weight:700"]')).forEach(function (d) { steps.push(d.textContent.trim()); }); });
    if (steps.length) {
      jd.insertAdjacentHTML('beforeend', '<h2 class="jd-h">應徵流程</h2><div class="jd-card"><ol class="jd-tl">' + steps.map(function (s, i) { return '<li>' + esc(s) + '<small>第 ' + (i + 1) + ' 步</small></li>'; }).join('') + '</ol></div>');
    }
  }
  [[gApply, 'jd-apply'], [gFaq, 'jd-faq']].forEach(function (x) {
    if (!x[0]) return;
    var w = document.createElement('div'); w.className = x[1];
    x[0].h.className = 'jd-h'; w.appendChild(x[0].h); x[0].els.forEach(function (e) { w.appendChild(e); }); jd.appendChild(w);
  });
  // 其他沒認得的段落照原順序放後面
  groups.forEach(function (x) { if ([gSpec, gDuty, gReq, gWhy, gFlow, gApply, gFaq].indexOf(x) < 0) { x.h.className = 'jd-h'; jd.appendChild(x.h); x.els.forEach(function (e) { jd.appendChild(e); }); } });
  [].slice.call(main.children).forEach(function (sec) { sec.remove(); });
  main.appendChild(jd);

  // 底部固定按鈕
  var applyA = document.querySelector('header a[href^="/apply/"]') || jd.querySelector('a[href^="/apply/"]');
  var lineA = document.querySelector('a[href*="lin.ee"]');
  var barEl = document.createElement('div'); barEl.className = 'jd-bar';
  barEl.innerHTML = '<div><a class="line" href="' + (lineA ? lineA.getAttribute('href') : 'https://lin.ee/XcSWPzM') + '" target="_blank" rel="noopener">LINE 洽詢</a>'
    + '<a class="go" href="' + (applyA ? applyA.getAttribute('href') : '/apply/') + '">我要應徵</a></div>';
  document.body.appendChild(barEl);
  var applyBox = jd.querySelector('.jd-apply');
  if (applyBox && 'IntersectionObserver' in window) {
    new IntersectionObserver(function (es) { barEl.classList.toggle('is-off', es[0].isIntersecting); }, { rootMargin: '0px 0px -30% 0px' }).observe(applyBox);
  }

  // 類型（從職缺專區那張卡片讀 data-track）＋相關職缺
  var TR = { senior: ['獵', '中高階獵才', 't-senior'], general: ['正', '正職', 't-general'], dispatch: ['派', '人力派遣', 't-dispatch'] };
  Promise.all([
    fetch('/jobs/').then(function (r) { return r.text(); }),
    fetch('https://step1ne-public-worker.aiagentg888.workers.dev/jobs-closed').then(function (r) { return r.json(); }).catch(function () { return {}; })
  ]).then(function (res) {
    var doc = new DOMParser().parseFromString(res[0], 'text/html');
    var closed = new Set((res[1] && res[1].closed) || []);
    var cards = [].slice.call(doc.querySelectorAll('#jobs a.job'));
    var mine = cards.filter(function (c) { return (c.getAttribute('href') || '').indexOf('/jobs/' + slug + '/') === 0; })[0];
    var track = mine ? mine.getAttribute('data-track') : '';
    var t = TR[track];
    if (t) {
      var logo = document.getElementById('jdLogo'); logo.textContent = t[0]; logo.className = 'jd-logo ' + t[2];
      var ind = mine.querySelector('.job-industry');
      document.getElementById('jdType').textContent = t[1] + (ind ? ' · ' + ind.textContent.trim() : '');
      document.getElementById('jdCrumbType').textContent = t[1]; document.getElementById('jdCrumbSep').hidden = false;
    }
    var cat = mine ? (mine.getAttribute('data-cat') || '').split(' ')[0] : '';
    var pool = cards.filter(function (c) { var s = ((c.getAttribute('href') || '').match(/\/jobs\/([^/]+)/) || [])[1]; return s && s !== slug && !closed.has(s); });
    var score = function (c) { return (cat && (c.getAttribute('data-cat') || '').indexOf(cat) > -1 ? 2 : 0) + (c.getAttribute('data-track') === track ? 1 : 0); };
    pool.sort(function (a, b) { return score(b) - score(a); });
    var pick = pool.slice(0, 4);
    if (!pick.length) return;
    jd.insertAdjacentHTML('beforeend', '<h2 class="jd-h">相關職缺</h2><div class="jd-rel">' + pick.map(function (c) {
      var ti = c.querySelector('.job-title'), pay = c.querySelector('.job-meta span'), ind = c.querySelector('.job-industry');
      return '<a href="' + c.getAttribute('href') + '"><b>' + esc(ti && ti.textContent) + '</b><small>' + esc(pay && pay.textContent) + '</small><em>' + esc(ind && ind.textContent) + '</em></a>';
    }).join('') + '<a href="/jobs/" style="text-align:center;color:var(--jv-blue);font-weight:800">看全部職缺 →</a></div>');
  }).catch(function () { /* 抓不到就不顯示，不影響頁面 */ });
})();
} finally { document.documentElement.classList.remove('jv-wait'); }
