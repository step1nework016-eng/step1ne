/* 面談室／對談室共用：顯示設定（字的大小、淺色／深色）＋送出鈕空白變淡。
 * 2026-10-23 從 /interview/（2026-10-21 新版）抽出來，阿財與阿福共用同一份。
 * ⚠️ /interview/ 目前仍是頁內同一段程式（正式版先不動）；阿福測試版確認後，/interview/ 改載入這支即可。
 *
 * 用法：在 <head> 裡「不要加 defer」載入（要在畫面畫出來之前先套用深淺色，避免先閃白再變黑）：
 *   <script src="/assets/chatroom-display.js"></script>
 * 頁面要有 #aa（Aa 按鈕）、#dpanel（面板，內含 .dseg[data-key=size|theme] 按鈕）、#say、#go，
 * 樣式在 /assets/chatroom.css。設定存在 localStorage 's1n_iv_display'（跟阿財同一把，兩邊一起記住）；
 * localStorage 被擋（無痕、封鎖網站資料）時一律 try/catch，頁面照常運作。
 */
(function () {
  var KEY = 's1n_iv_display', d = document.documentElement, mq = null;
  try { mq = window.matchMedia('(prefers-color-scheme: dark)'); } catch (e) {}
  function load() {
    var p = { size: 'm', theme: 'auto' };
    try {
      var o = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (o) { if (/^(m|l|xl)$/.test(o.size)) p.size = o.size; if (/^(light|dark|auto)$/.test(o.theme)) p.theme = o.theme; }
    } catch (e) {}
    return p;
  }
  function apply(p) {
    var dark = p.theme === 'dark' || (p.theme === 'auto' && mq && mq.matches);
    d.setAttribute('data-size', p.size); d.setAttribute('data-theme', p.theme); d.setAttribute('data-scheme', dark ? 'dark' : 'light');
    try { var m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', dark ? '#15191e' : '#ffffff'); } catch (e) {}
  }
  function save(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) {} }
  window.ivDisplay = { load: load, apply: apply, save: save };
  apply(load());
  function onSys() { apply(load()); }
  if (mq) { if (mq.addEventListener) mq.addEventListener('change', onSys); else if (mq.addListener) mq.addListener(onSys); }

  function wire() {
    // 顯示設定面板：只改外觀，不碰對談流程與任何 API。
    var aa = document.getElementById('aa'), panel = document.getElementById('dpanel');
    if (aa && panel) {
      var cur = load();
      var sync = function () {
        panel.querySelectorAll('.dseg').forEach(function (seg) {
          var v = cur[seg.getAttribute('data-key')];
          seg.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-v') === v ? 'true' : 'false'); });
        });
      };
      var open = function (on) { panel.hidden = !on; aa.setAttribute('aria-expanded', on ? 'true' : 'false'); };
      aa.addEventListener('click', function (e) { e.stopPropagation(); open(panel.hidden); });
      panel.addEventListener('click', function (e) {
        var b = e.target.closest && e.target.closest('.dseg button'); if (!b) return;
        cur[b.parentNode.getAttribute('data-key')] = b.getAttribute('data-v');
        apply(cur); save(cur); sync();
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && !panel.hidden) { open(false); aa.focus(); }
      });
      document.addEventListener('click', function (e) {
        if (!panel.hidden && !panel.contains(e.target) && e.target !== aa && !aa.contains(e.target)) open(false);
      });
      sync();
    }
    // 輸入框沒字時送出鈕變淡（不鎖住，送出邏輯不動）
    var t = document.getElementById('say'), g = document.getElementById('go');
    if (t && g) {
      var u = function () { g.classList.toggle('empty', !t.value.trim()); };
      t.addEventListener('input', u);
      new MutationObserver(u).observe(t, { attributes: true });
      setInterval(u, 800); u();
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();
})();
