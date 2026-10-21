/* 「先送出，晚點再聊」（2026-10-21 Jacky 核准示意圖：先送出晚點再聊_示意圖_20261021.html）
 *
 * 應徵送出後「現在就開始／約一個時間」下面多一個選項。選了之後：
 *   - POST /apply/later：應徵先算數、狀態變「已應徵、還沒面談」、寄一封帶面談連結的信（7 天內有效）
 *   - 畫面換成「應徵已送出！」＋下一步＋三顆按鈕：傳到我的 LINE／複製連結／其實現在就有空
 * 用在 /apply-beta/、/apply-quick-beta/（以及 /id/、/vi/ 的 apply-quick-beta，文字由 T 傳進來）。
 *
 * 用法：ApplyLater.attach({ api, token, jobTitle, after: <元素>, screen: <要換掉內容的區塊>, T: {可省略，覆寫文字} })
 */
(function () {
  var ZH = {
    opt_title: '先送出，晚點再聊',
    opt_sub: '應徵先算數，7 天內有空再點連結跟阿財聊',
    sending: '送出中…',
    err: '沒有送出成功，請再按一次',
    done_h: '應徵已送出！',
    next_h: '接下來',
    s1: '<b>應徵已送出</b>，資料已經收到',
    s2: '<b>7 天內</b>點連結跟阿財聊 15～25 分鐘（隨時都可以，半夜也行）',
    s3: '聊完 1～2 個工作天內，會有人跟您聯絡',
    line_btn: '把面談連結傳到我的 LINE',
    copy_btn: '複製連結',
    now_btn: '其實現在就有空，開始聊',
    fine: '面談連結也寄到您的信箱了。明天還沒聊的話，會再提醒您一次。',
    copied: '已複製連結',
    copy_fail: '複製不了，請長按下面的連結自己複製',
    share_text: 'Step1ne 面談連結｜{job}\n7 天內點開就能跟阿財聊 15～25 分鐘：\n{url}'
  };

  var CSS = '' +
    '.al{--al-ink:#0D1B24;--al-mu:#4A5A66;--al-line:#D9E0E6;--al-soft:#EEF3F7;--al-brand:#167EB2;--al-deep:#0F5F87;' +
    '--al-ok:#2F7A4D;--al-ok-soft:#E3F1E8;--al-green:#06C755;--al-green-ink:#05652C;color:var(--al-ink)}' +
    '.al-opt{display:flex;gap:12px;align-items:flex-start;width:100%;margin:10px 0 0;padding:13px 14px;min-height:56px;' +
    'border:1.5px dashed var(--al-line);border-radius:14px;background:#fff;color:var(--al-ink);font:inherit;text-align:left;cursor:pointer}' +
    '.al-opt:hover{border-color:var(--al-brand);background:var(--al-soft)}' +
    '.al-opt:focus-visible,.al a:focus-visible,.al button:focus-visible{outline:3px solid var(--al-deep);outline-offset:2px}' +
    '.al-opt[disabled]{opacity:.6;cursor:wait}' +
    '.al-ic{width:36px;height:36px;border-radius:10px;background:var(--al-soft);color:var(--al-deep);display:grid;place-items:center;flex:none}' +
    '.al-opt b{display:block;font-size:15px}.al-opt small{display:block;color:var(--al-mu);font-size:13px;line-height:1.5;margin-top:2px}' +
    '.al-err{color:#B3261E;font-size:14px;margin:8px 2px 0}' +
    '.al-top{text-align:center;margin:4px 0 14px}' +
    '.al-c{width:56px;height:56px;border-radius:50%;background:var(--al-ok-soft);color:var(--al-ok);display:grid;place-items:center;margin:0 auto 8px}' +
    '.al-top h2{margin:0 0 2px;font-size:20px;line-height:1.4}.al-top p{margin:0;color:var(--al-mu);font-size:14px}' +
    '.al-box{background:var(--al-soft);border-radius:14px;padding:14px;margin:0 0 14px}' +
    '.al-box h3{margin:0 0 8px;font-size:15px}' +
    '.al-row{display:flex;gap:10px;align-items:flex-start;font-size:14.5px;line-height:1.6;margin:0 0 8px;color:var(--al-ink)}.al-row:last-child{margin:0}' +
    '.al-d{width:20px;height:20px;border-radius:50%;flex:none;display:grid;place-items:center;font-size:11px;color:#fff;background:var(--al-ok);margin-top:2px}' +
    '.al-d.o{background:#fff;border:2px solid #9AA8B3}' +
    '.al-btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;min-height:48px;margin:0 0 10px;padding:10px 14px;' +
    'border-radius:12px;font:inherit;font-weight:700;font-size:15.5px;text-decoration:none;cursor:pointer;border:1.5px solid transparent;box-sizing:border-box}' +
    /* LINE 綠底白字對比只有約 2.3:1（不到 4.5:1）→ 改淺綠底＋深綠字＋綠框，一樣看得出是 LINE */
    '.al-btn.lg{background:#E6F8EE;color:var(--al-green-ink);border-color:var(--al-green)}' +
    '.al-btn.sec{background:#fff;color:var(--al-ink);border-color:var(--al-line)}' +
    '.al-btn.pri{background:var(--al-deep);color:#fff}' +
    '.al-url{display:block;word-break:break-all;font-size:12.5px;color:var(--al-mu);margin:-4px 2px 12px}' +
    '.al-fine{font-size:13px;color:var(--al-mu);text-align:center;margin:6px 0 0;line-height:1.6}' +
    '.al-toast{position:fixed;left:50%;bottom:calc(24px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);' +
    'background:var(--al-ink,#0D1B24);color:#fff;padding:10px 16px;border-radius:10px;font-size:14px;z-index:9999;max-width:calc(100vw - 32px)}' +
    '@media (prefers-reduced-motion:no-preference){.al-opt,.al-btn{transition:background .15s,border-color .15s}}';

  var ICON_CLOCK = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>';
  var ICON_OK = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" aria-hidden="true"><path d="M5 13l4 4L19 7"/></svg>';
  var ICON_LINE = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 4C7 4 3 7.2 3 11.2c0 3.6 3.2 6.6 7.6 7.1l-.4 2.2c-.1.4.3.7.7.5L15 18c3.6-.9 6-3.6 6-6.8C21 7.2 17 4 12 4z"/></svg>';
  var ICON_COPY = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>';

  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function css() {
    if (document.getElementById('al-css')) return;
    var s = document.createElement('style'); s.id = 'al-css'; s.textContent = CSS; document.head.appendChild(s);
  }
  function toast(msg) {
    var t = document.createElement('div'); t.className = 'al-toast'; t.setAttribute('role', 'status'); t.textContent = msg;
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2600);
  }
  function copy(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (ok, no) {
      var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', '');
      ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy') ? ok() : no(); } catch (e) { no(e); } ta.remove();
    });
  }
  function track(name) { try { if (window.gtag) gtag('event', name, { page_path: location.pathname }); } catch (e) {} }

  function renderDone(o, T, d) {
    var room = d.room_url, liff = d.liff_url || room;
    var share = T.share_text.replace('{job}', o.jobTitle || '').replace('{url}', liff);
    o.screen.innerHTML =
      '<div class="al">' +
      '<div class="al-top"><div class="al-c">' + ICON_OK + '</div><h2 id="al-h" tabindex="-1">' + esc(T.done_h) + '</h2>' +
      (o.jobTitle ? '<p>' + esc(o.jobTitle) + '</p>' : '') + '</div>' +
      '<div class="al-box"><h3>' + esc(T.next_h) + '</h3>' +
      '<div class="al-row"><span class="al-d" aria-hidden="true">✓</span><span>' + T.s1 + '</span></div>' +
      '<div class="al-row"><span class="al-d o" aria-hidden="true"></span><span>' + T.s2 + '</span></div>' +
      '<div class="al-row"><span class="al-d o" aria-hidden="true"></span><span>' + esc(T.s3) + '</span></div></div>' +
      '<a class="al-btn lg" id="al-line" href="https://line.me/R/msg/text/?' + encodeURIComponent(share) + '" target="_blank" rel="noopener">' + ICON_LINE + esc(T.line_btn) + '</a>' +
      '<button type="button" class="al-btn sec" id="al-copy">' + ICON_COPY + esc(T.copy_btn) + '</button>' +
      '<span class="al-url" id="al-url" hidden>' + esc(room) + '</span>' +
      '<a class="al-btn pri" id="al-now" href="' + esc(room) + '">' + esc(T.now_btn) + '</a>' +
      '<p class="al-fine">' + esc(T.fine) + '</p></div>';
    var h = document.getElementById('al-h'); if (h) h.focus({ preventScroll: true });
    scrollTo(0, 0);
    document.getElementById('al-line').addEventListener('click', function () { track('interview_later_line_share'); });
    document.getElementById('al-now').addEventListener('click', function () { track('interview_later_start_now'); });
    document.getElementById('al-copy').addEventListener('click', function () {
      copy(room).then(function () { toast(T.copied); track('interview_later_copy'); },
        function () { document.getElementById('al-url').hidden = false; toast(T.copy_fail); });
    });
  }

  window.ApplyLater = {
    attach: function (o) {
      if (!o || !o.after || !o.screen || !o.token) return;
      css();
      var T = {}; var k; for (k in ZH) T[k] = ZH[k]; if (o.T) for (k in o.T) if (o.T[k]) T[k] = o.T[k];
      var wrap = document.createElement('div'); wrap.className = 'al';
      wrap.innerHTML = '<button type="button" class="al-opt" id="al-opt"><span class="al-ic">' + ICON_CLOCK + '</span>' +
        '<span><b>' + esc(T.opt_title) + '</b><small>' + esc(T.opt_sub) + '</small></span></button>' +
        '<p class="al-err" id="al-err" role="alert" hidden></p>';
      o.after.parentNode.insertBefore(wrap, o.after.nextSibling);
      var btn = wrap.querySelector('#al-opt'), err = wrap.querySelector('#al-err');
      btn.addEventListener('click', function () {
        btn.disabled = true; err.hidden = true;
        var b = btn.querySelector('b'), orig = b.textContent; b.textContent = T.sending;
        fetch(o.api + '/apply/later', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: o.token }) })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (d && d.ok) { track('interview_later_chosen'); renderDone(o, T, d); return; }
            if (d && d.started) { location.href = '/interview/?t=' + encodeURIComponent(o.token); return; }
            throw new Error((d && d.error) || T.err);
          })
          .catch(function () { btn.disabled = false; b.textContent = orig; err.textContent = T.err; err.hidden = false; });
      });
      return wrap;
    }
  };
})();
