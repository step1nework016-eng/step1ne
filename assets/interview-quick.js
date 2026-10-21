/* 面談室：阿財快速回覆按鈕（2026-10-21，Jacky 核准示意圖第 3 頁）。
 *
 * 阿財問封閉題／選擇題時（能不能通勤、要不要搬、最快何時到職、是非確認…），在那則訊息下面放 2～4 個按鈕，
 * 外加一個虛線的「我自己打字」（只把游標移到輸入框）。點按鈕＝把那句話當成人選自己打的，走頁面原本的 send()，
 * 跟打字送出完全一樣。人選送出任何東西（打字、按鈕、語音）按鈕就消失。
 *
 * 頁面只要載入這支就好（defer），不用改其他程式：
 *   - 包住頁面的 add()：阿財的新訊息畫上去之後，查 GET /chat/<token>/quick；人選的訊息畫上去就收掉按鈕。
 *   - 按鈕要不要出現由 daemon 決定（step1ne-recruit/acai_quick_replies.py，開關 site_settings acai_quick_replies）；
 *     沒開或這題不適合，API 回空清單，這支什麼都不畫。
 * 送出：新版頁面的 send({ text }) 直接帶字；舊版 send() 只讀輸入框，就先把字放進輸入框再呼叫。
 * 樣式自帶，顏色走頁面變數（--soft／--line／--accent-bg／--accent-ink／--accent-line／--ink／--fz），
 * 沒有變數的舊版頁面用 /interview/ 現在的米色＋金色當預設；深色跟著 html[data-scheme="dark"]。
 */
(function () {
  'use strict';
  if (window.AcaiQuick) return;

  var CSS = [
    '.acai-qr{display:flex;flex-wrap:wrap;gap:8px;margin:-4px 0 14px 40px;max-width:min(calc(100% - 40px),540px)}',
    '.acai-qr button{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;',
    'min-height:44px;min-width:44px;padding:8px 16px;border-radius:999px;cursor:pointer;line-height:1.4;',
    'font-family:inherit;font-size:calc(14.5px * var(--fz,1));font-weight:600;',
    'background:var(--soft,#f6f2ea);color:var(--ink,#23262d);border:1.5px solid var(--accent-line,var(--line,#d9cdb8));',
    '-webkit-tap-highlight-color:transparent;transition:background-color .15s,border-color .15s}',
    '.acai-qr button:hover{border-color:var(--accent-bg,#a67c3d)}',
    '.acai-qr button:active{background:var(--accent-bg,#a67c3d);color:var(--accent-ink,#fff)}',
    '.acai-qr button:focus-visible{outline:3px solid var(--accent-line,#a67c3d);outline-offset:2px}',
    '.acai-qr button.qr-self{background:transparent;border:1.5px dashed var(--line2,var(--line,#cbbfa8));color:var(--muted,#656972);font-weight:500}',
    'html[data-scheme="dark"] .acai-qr button{background:var(--soft,#18262F);color:var(--ink,#E6EDF2);border-color:var(--accent-line,#5BB8E6)}',
    'html[data-scheme="dark"] .acai-qr button.qr-self{background:transparent;border-color:var(--line2,#33454F);color:var(--muted,#9FB0BC)}',
    '@media (prefers-reduced-motion:reduce){.acai-qr button{transition:none}}'
  ].join('');

  var seq = 0;          // 人選每送出一次 +1，晚到的查詢結果就作廢
  var timer = null;
  var shownAfter = null;

  function $(id) { return document.getElementById(id); }
  function api() { try { return API; } catch (e) { return window.API || ''; } }       // 頁面的 var API
  function token() { try { return T; } catch (e) { return window.T || ''; } }          // 頁面的 var T（LIFF 會晚一點補上）
  function isEnded() { try { return !!ended; } catch (e) { return false; } }

  function injectCss() {
    if ($('acai-qr-css')) return;
    var s = document.createElement('style');
    s.id = 'acai-qr-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function clear() {
    var old = $('acai-qr');
    if (old) old.remove();
  }

  function sendText(text) {
    if (isEnded() || typeof window.send !== 'function') return;
    clear();
    seq++;
    if (window.send.length > 0) { window.send({ text: text }); return; }   // 新版：send({ text })
    var say = $('say');
    if (!say) return;
    say.value = text;                                                         // 舊版：send() 讀輸入框
    window.send();
  }

  function render(options, afterId) {
    var log = $('log');
    if (!log || isEnded() || !options || options.length < 2) return;
    injectCss();
    clear();
    var box = document.createElement('div');
    box.id = 'acai-qr';
    box.className = 'acai-qr';
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', '快速回覆');
    options.forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = t;
      b.addEventListener('click', function () { sendText(t); });
      box.appendChild(b);
    });
    var self = document.createElement('button');
    self.type = 'button';
    self.className = 'qr-self';
    self.textContent = '我自己打字';
    self.addEventListener('click', function () { var s = $('say'); if (s) s.focus(); });
    box.appendChild(self);
    var stick = log.scrollHeight - log.scrollTop - log.clientHeight < 120;
    log.appendChild(box);
    if (stick) log.scrollTop = log.scrollHeight;
    shownAfter = afterId;
  }

  function check() {
    var A = api(), t = token();
    if (!A || !t || t.length < 32 || isEnded()) return;
    var mine = seq;
    fetch(A + '/chat/' + encodeURIComponent(t) + '/quick').then(function (r) { return r.json(); }).then(function (d) {
      if (mine !== seq || isEnded()) return;                 // 查的時候人選已經送出了
      var opts = (d && d.options) || [];
      if (opts.length >= 2) {
        if (!($('acai-qr') && shownAfter === d.after_id)) render(opts.slice(0, 4), d.after_id);
      } else {
        clear();
      }
    }).catch(function () { /* 查不到就不畫，不打擾人選 */ });
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(check, 600);     // 阿財一輪可能連發幾則，等最後一則畫完再查
  }

  // 包住頁面的 add()：頁面裡呼叫 add(...) 會走到這裡（頂層 function 宣告就是 window.add）
  function hook() {
    var orig = window.add;
    if (typeof orig !== 'function' || orig.__acaiQuick) return false;
    var wrapped = function (m) {
      var r = orig.apply(this, arguments);
      try {
        if (m && m.role === 'candidate') { seq++; clearTimeout(timer); clear(); }
        else if (m && m.role === 'assistant') schedule();
      } catch (e) {}
      return r;
    };
    wrapped.__acaiQuick = true;
    window.add = wrapped;
    return true;
  }

  if (hook()) {
    // 重新整理時歷史訊息在這支載入前就畫好了 → 自己查一次
    setTimeout(check, 1500);
  }

  window.AcaiQuick = { check: check, clear: clear };
})();
