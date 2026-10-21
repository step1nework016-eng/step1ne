// 應徵漏斗追蹤（2026-10-21，快速應徵測試）——/apply/ 與 /apply-quick/ 共用。
// 給每個瀏覽器一個不帶個資的隨機編號（anon_id），事件用 sendBeacon 送到 public-worker /t。
// ⚠️ 這支任何錯誤都不能影響表單：全部 try/catch，失敗就是少記一筆。
(function () {
  var API = 'https://step1ne-public-worker.aiagentg888.workers.dev';
  var KEY = 's1_anon_id';
  function uuid() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    });
  }
  var aid = null;
  try { aid = localStorage.getItem(KEY); } catch (e) {}
  if (!aid || !/^[0-9a-f-]{36}$/.test(aid)) {
    aid = uuid();
    try { localStorage.setItem(KEY, aid); } catch (e) {}
  }
  var sentOnce = {};
  function track(event, opts) {
    try {
      opts = opts || {};
      if (opts.once) { if (sentOnce[event]) return; sentOnce[event] = 1; }
      var d = JSON.stringify({ event: event, anon_id: aid, flow: opts.flow || null,
        job_slug: opts.job || null, props: opts.props || {} });
      if (navigator.sendBeacon && navigator.sendBeacon(API + '/t', new Blob([d], { type: 'text/plain' }))) return;
      fetch(API + '/t', { method: 'POST', body: d, keepalive: true, headers: { 'content-type': 'text/plain' } }).catch(function () {});
    } catch (e) {}
  }
  // 中途離開：shouldFire() 回 true 才送，同一頁只送一次
  function onLeave(fn) {
    var done = false;
    function go() { if (done) return; try { if (fn()) done = true; } catch (e) {} }
    window.addEventListener('pagehide', go);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') go(); });
  }
  window.S1F = { aid: aid, track: track, onLeave: onLeave };
})();
