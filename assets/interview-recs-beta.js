/* 測試版（/interview-beta/ 用）：跟 interview-recs.js 一樣，另外多「無經驗通用面談」模式（2026-10-22）——
 *   GET /recs 回 mode='general' 時：最多 4 個、按鈕是「我要應徵這個」、最多選 2 個（POST /chat/<t>/general-pick），
 *   選滿 2 個其他按鈕變灰；一個都沒挑到（status=none）就畫一張「之後會有專人跟您聯絡」的小卡。
 * 面談室：阿財面談結尾的「您可能也適合這些職缺」卡片（2026-10-21，Jacky 核准樣板）。
 *
 * 頁面只要在面談結束（setEnded）時呼叫 AcaiRecs.start(API, T)，或先設 window.__acaiRecsPending = [API, T]。
 * 這支自己輪詢 GET /chat/<token>/recs（面談結束後阿財要幾十秒挑職缺，頁面原本的輪詢已經停了）：
 *   status=pending → 繼續等；ready → 畫卡片；none／error → 不畫、停止；
 *   一直是 null（開關沒開、這場不適用）→ 90 秒後停止。最多等 4 分鐘。
 * 「也幫我推這個」→ POST /chat/<token>/recs-want，按鈕變「✓ 已告訴顧問」。人選不用再填任何東西。
 * 樣式自帶，顏色走頁面變數（--soft／--line／--ink／--muted／--bg，有預設值），深色版跟著 html[data-scheme="dark"]。
 * 卡片一律中文（外語人選模式也一樣）。
 */
(function () {
  'use strict';
  var started = false;
  var CSS = [
    '.acai-rec{--ar-brand:#0F5F87;--ar-brand-soft:#E3EFF6;--ar-ok:#1E4F33;--ar-ok-soft:#E3F1E8;--ar-warn:#6B3F0C;--ar-warn-soft:#FBEFDF;--ar-btn-ink:#fff;',
    'flex:1;min-width:0;max-width:min(calc(100% - 40px),540px);background:var(--soft,#f6f2ea);border:1px solid var(--line,#eee7db);',
    'border-radius:18px;border-top-left-radius:6px;padding:12px 12px 10px;color:var(--ink,#23262d);font-size:calc(15px * var(--fz,1));line-height:1.6}',
    'html[data-scheme="dark"] .acai-rec{--ar-brand:#8CC8EA;--ar-brand-soft:#1E3442;--ar-ok:#A8E2BD;--ar-ok-soft:#173024;--ar-warn:#F2C995;--ar-warn-soft:#3A2A16;--ar-btn-ink:#10202A}',
    '.acai-rec h4{margin:2px 4px 2px;font-size:1.03em}',
    '.acai-rec .ar-sub{margin:0 4px 10px;font-size:.87em;color:var(--muted,#656972)}',
    '.acai-rec .ar-job{background:var(--bg,#fff);border:1px solid var(--line,#eee7db);border-radius:12px;margin:0 0 8px;overflow:hidden}',
    '.acai-rec .ar-head{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:10px;width:100%;min-height:52px;padding:10px 12px;cursor:pointer;color:inherit}',
    '.acai-rec .ar-head:focus-visible{outline:3px solid var(--ar-brand);outline-offset:-3px;border-radius:12px}',
    '.acai-rec .ar-num{flex:none;width:24px;height:24px;border-radius:50%;background:var(--ar-brand-soft);color:var(--ar-brand);font-weight:700;font-size:13px;display:grid;place-items:center}',
    '.acai-rec .ar-jt{flex:1;min-width:0}',
    '.acai-rec .ar-jt b{display:block;font-size:1em;line-height:1.4}',
    '.acai-rec .ar-jt small{display:block;font-size:.84em;color:var(--muted,#656972)}',
    '.acai-rec .ar-chev{flex:none;width:18px;height:18px;color:var(--muted,#656972);transition:transform .2s}',
    '.acai-rec .ar-job.open .ar-chev{transform:rotate(180deg)}',
    '.acai-rec .ar-det{display:none;padding:0 12px 12px;border-top:1px dashed var(--line,#eee7db)}',
    '.acai-rec .ar-job.open .ar-det{display:block}',
    '.acai-rec dl{display:grid;grid-template-columns:auto 1fr;gap:4px 10px;margin:10px 0;font-size:.9em}',
    '.acai-rec dt{color:var(--muted,#656972)}.acai-rec dd{margin:0}',
    '.acai-rec .ar-fit,.acai-rec .ar-gap{font-size:.9em;border-radius:8px;padding:8px 10px;margin:0 0 6px}',
    '.acai-rec .ar-fit{background:var(--ar-ok-soft);color:var(--ar-ok)}',
    '.acai-rec .ar-gap{background:var(--ar-warn-soft);color:var(--ar-warn)}',
    '.acai-rec .ar-fit b,.acai-rec .ar-gap b{display:block;font-size:.92em;margin-bottom:2px}',
    '.acai-rec .ar-acts{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}',
    '.acai-rec .ar-btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 14px;border-radius:10px;font:inherit;font-weight:700;font-size:.93em;text-decoration:none;cursor:pointer;border:0;flex:1}',
    '.acai-rec .ar-pri{background:var(--ar-brand);color:var(--ar-btn-ink)}',
    '.acai-rec .ar-sec{background:var(--bg,#fff);color:var(--ar-brand);border:1.5px solid var(--ar-brand)}',
    '.acai-rec .ar-btn:focus-visible{outline:3px solid var(--ink,#23262d);outline-offset:2px}',
    '.acai-rec .ar-btn.done,.acai-rec .ar-btn:disabled{background:var(--ar-ok-soft);color:var(--ar-ok);cursor:default}',
    '.acai-rec .ar-fine{font-size:.8em;color:var(--muted,#656972);margin:6px 4px 0}',
    '.acai-rec .ar-btn.lim:disabled{background:var(--soft,#f6f2ea);color:var(--muted,#656972);border:1px dashed var(--line,#eee7db)}',
    '.acai-rec .ar-cnt{font-size:.88em;font-weight:700;color:var(--ar-brand);margin:4px 4px 0}',
    '.acai-rec .ar-err{font-size:.86em;color:var(--ar-warn);margin:6px 4px 0}',
    '@media (prefers-reduced-motion:reduce){.acai-rec .ar-chev{transition:none}}'
  ].join('\n');

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function injectCss() {
    if (document.getElementById('acai-rec-css')) return;
    var s = document.createElement('style');
    s.id = 'acai-rec-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function render(api, token, card) {
    var log = document.getElementById('log');
    if (!log || document.getElementById('acai-rec')) return;
    injectCss();
    var row = el('div', 'airow');
    row.id = 'acai-rec';
    var av = el('img', 'av'); av.alt = ''; av.src = '/assets/acai-avatar-96.webp'; av.style.visibility = 'hidden';
    var box = el('section', 'acai-rec');
    box.setAttribute('aria-label', card.title);
    box.appendChild(el('h4', null, card.title));
    box.appendChild(el('p', 'ar-sub', card.sub));
    card.jobs.forEach(function (j, i) {
      var job = el('div', 'ar-job');
      var head = el('button', 'ar-head'); head.type = 'button';
      var detId = 'acai-rec-det-' + i;
      head.setAttribute('aria-expanded', 'false'); head.setAttribute('aria-controls', detId);
      head.appendChild(el('span', 'ar-num', String(i + 1)));
      var jt = el('span', 'ar-jt');
      jt.appendChild(el('b', null, j.title));
      jt.appendChild(el('small', null, [j.location, j.salary].filter(Boolean).join('｜')));
      head.appendChild(jt);
      var chev = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      chev.setAttribute('class', 'ar-chev'); chev.setAttribute('viewBox', '0 0 20 20'); chev.setAttribute('aria-hidden', 'true');
      var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M5 7.5l5 5 5-5'); path.setAttribute('fill', 'none'); path.setAttribute('stroke', 'currentColor');
      path.setAttribute('stroke-width', '2'); path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round');
      chev.appendChild(path); head.appendChild(chev);
      var det = el('div', 'ar-det'); det.id = detId;
      var dl = el('dl');
      [['地點', j.location], ['類型', j.employment], ['做什麼', j.duty]].forEach(function (kv) {
        if (!kv[1]) return;
        dl.appendChild(el('dt', null, kv[0])); dl.appendChild(el('dd', null, kv[1]));
      });
      det.appendChild(dl);
      var fit = el('div', 'ar-fit'); fit.appendChild(el('b', null, '為什麼可能適合')); fit.appendChild(document.createTextNode(j.why || ''));
      var gap = el('div', 'ar-gap'); gap.appendChild(el('b', null, '還要確認')); gap.appendChild(document.createTextNode(j.confirm || ''));
      det.appendChild(fit); det.appendChild(gap);
      var acts = el('div', 'ar-acts');
      var a = el('a', 'ar-btn ar-sec', '看完整職缺');
      a.href = j.url; a.target = '_blank'; a.rel = 'noopener';
      var G = card.general;
      var want = el('button', 'ar-btn ar-pri', j.wanted ? (G ? '✓ 已應徵' : '✓ 已告訴顧問') : (G ? '我要應徵這個' : '也幫我推這個'));
      want.type = 'button';
      want.setAttribute('data-slug', j.slug);
      if (j.wanted) { want.disabled = true; want.classList.add('done'); }
      if (G) {
        want.addEventListener('click', function () {
          if (want.disabled) return;
          want.disabled = true; want.textContent = '送出中…';
          fetch(api + '/chat/' + encodeURIComponent(token) + '/general-pick', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: j.slug })
          }).then(function (r) { return r.json(); }).then(function (d) {
            if (d && d.ok) { want.textContent = '✓ 已應徵'; want.classList.add('done'); j.wanted = true; syncPicks(box, card); }
            else if (d && d.limit) { want.classList.add('lim'); want.textContent = '已選滿 ' + card.max + ' 個'; syncPicks(box, card); }
            else { want.disabled = false; want.textContent = '我要應徵這個'; if (d && d.error) note(box, d.error); }
          }).catch(function () { want.disabled = false; want.textContent = '我要應徵這個'; });
        });
      }
      if (!G) want.addEventListener('click', function () {
        if (want.disabled) return;
        want.disabled = true; want.textContent = '送出中…';
        fetch(api + '/chat/' + encodeURIComponent(token) + '/recs-want', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: j.slug })
        }).then(function (r) { return r.json(); }).then(function (d) {
          if (d && d.ok) { want.textContent = '✓ 已告訴顧問'; want.classList.add('done'); }
          else { want.disabled = false; want.textContent = '也幫我推這個'; }
        }).catch(function () { want.disabled = false; want.textContent = '也幫我推這個'; });
      });
      acts.appendChild(a); acts.appendChild(want);
      det.appendChild(acts);
      head.addEventListener('click', function () {
        var open = !job.classList.contains('open');
        box.querySelectorAll('.ar-job.open').forEach(function (o) {
          o.classList.remove('open'); o.querySelector('.ar-head').setAttribute('aria-expanded', 'false');
        });
        if (open) { job.classList.add('open'); head.setAttribute('aria-expanded', 'true'); }
      });
      job.appendChild(head); job.appendChild(det);
      box.appendChild(job);
    });
    if (card.general) { var cnt = el('p', 'ar-cnt'); cnt.setAttribute('aria-live', 'polite'); box.appendChild(cnt); syncPicks(box, card); }
    box.appendChild(el('p', 'ar-fine', card.footer));
    // 2026-10-21 Jacky 測試：結束面板（時間軸）會蓋住對話，卡片放在對話裡根本看不到——
    // 頁面有 #fin_recs（新版結束面板）就放進面板最上面，沒有才放回對話裡
    var slot = document.getElementById('fin_recs');
    if (slot) {
      box.id = 'acai-rec'; box.style.margin = '0 0 18px'; box.style.maxWidth = 'none';
      slot.appendChild(box); slot.hidden = false;
      var fin = document.getElementById('fin'); if (fin) fin.scrollTop = 0;
      return;
    }
    row.appendChild(av); row.appendChild(box);
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
  }

  // 通用面談：已選幾個／選滿就把其他「我要應徵這個」變灰
  function syncPicks(box, card) {
    var n = card.jobs.filter(function (j) { return j.wanted; }).length;
    var c = box.querySelector('.ar-cnt');
    if (c) c.textContent = n >= card.max ? '已選 ' + n + ' 個（最多 ' + card.max + ' 個），之後會有專人跟您聯絡' : '已選 ' + n + '／' + card.max + ' 個';
    box.querySelectorAll('.ar-btn.ar-pri').forEach(function (b) {
      if (b.classList.contains('done')) return;
      if (n >= card.max) { b.disabled = true; b.classList.add('lim'); b.textContent = '已選滿 ' + card.max + ' 個'; }
    });
  }
  function note(box, msg) {
    var p = box.querySelector('.ar-err') || box.insertBefore(el('p', 'ar-err'), box.querySelector('.ar-fine'));
    p.textContent = msg;
  }
  function renderNone(card) {   // 通用面談一個都沒挑到：不畫空卡片，給一句交代
    if (document.getElementById('acai-rec')) return;
    injectCss();
    var box = el('section', 'acai-rec'); box.id = 'acai-rec';
    box.appendChild(el('h4', null, card.title));
    box.appendChild(el('p', 'ar-sub', card.sub));
    var slot = document.getElementById('fin_recs');
    if (slot) { box.style.margin = '0 0 18px'; box.style.maxWidth = 'none'; slot.appendChild(box); slot.hidden = false; return; }
    var log = document.getElementById('log'); if (log) log.appendChild(box);
  }

  var GCARD = {
    title: '依您今天聊的，這幾個職缺比較適合',
    sub: '點職缺看摘要。想應徵的按「我要應徵這個」，最多選 2 個，面談內容會一起帶過去，不用重新面談',
    footer: '這是依面談內容初步挑的，不代表一定錄取。都不想選也沒關係，之後會有專人跟您聯絡，再一起看有沒有更適合的。'
  };
  var GNONE = {
    title: '今天先聊到這裡',
    sub: '這次沒有挑到特別合適的無經驗職缺。之後會有專人跟您聯絡，有適合的職缺會再通知您。'
  };

  var CARD = {
    title: '您可能也適合這些職缺',
    sub: '依您今天聊的內容挑的，方向接近，顧問會再確認。點職缺看摘要',
    footer: '這是依面談內容初步挑的，不代表一定會推薦；顧問確認後會再跟您說。'
  };

  function start(api, token) {
    if (started || !api || !token || token.length < 32) return;
    started = true;
    var t0 = Date.now();
    function tick() {
      fetch(api + '/chat/' + encodeURIComponent(token) + '/recs').then(function (r) { return r.json(); }).then(function (d) {
        var st = d && d.status;
        var recs = (d && d.recs) || [];
        if (d && d.mode === 'general') {
          if (recs.length) {
            render(api, token, { title: GCARD.title, sub: GCARD.sub, footer: GCARD.footer, jobs: recs.slice(0, 4),
              general: true, max: d.max_picks || 2 });
            return;
          }
          if (st === 'none' || st === 'error') { renderNone(GNONE); return; }
        }
        if (recs.length) {
          render(api, token, { title: CARD.title, sub: CARD.sub, footer: CARD.footer, jobs: recs.slice(0, 3) });
          return;
        }
        if (st === 'none' || st === 'error' || st === 'ready') return;
        var waited = Date.now() - t0;
        if (!st && waited > 90000) return;      // 這場沒有要產（開關沒開或不適用）
        if (waited > 240000) return;
        setTimeout(tick, 5000);
      }).catch(function () {
        if (Date.now() - t0 < 240000) setTimeout(tick, 8000);
      });
    }
    tick();
  }

  window.AcaiRecs = { start: start };
  if (window.__acaiRecsPending) start(window.__acaiRecsPending[0], window.__acaiRecsPending[1]);
})();
