/* 履歷這一步（2026-10-12 第二版：分頁＋多張截圖）
 *
 * 為什麼有這支：9/12–10/11 手機上開始填應徵表的 49 人只有 28 人過第一頁，電腦 15 人只掉 1 人；
 * 成功送出的 46 份履歷全是 PDF／Word、0 張照片——手機裡沒有履歷檔的人就直接離開了。
 * 研究紀錄：~/下載項目/step1ne-seo-records/研究_應徵表單流失_20261012.html
 *
 * 10/12 Jacky 回饋：
 *   1. 現在很少紙本履歷，最常見是「把 PDF 履歷截圖」——一份履歷好幾頁就是好幾張截圖。
 *      → 可以一次選很多張（照頁數順序），縮圖預覽、可刪；也還是可以選一份 PDF／Word。
 *   2. 原本五個選項直直排下來，看起來要填很多 → 改成三個分頁，一次只看得到一個：
 *      「上傳截圖或檔案」（預設）｜「用 LINE 傳」｜「沒有履歷」（1 分鐘快速履歷）
 *      上傳分頁裡另有兩個小連結：貼上文字／貼雲端連結。
 *
 * 送出格式（後端 step1ne-public-worker 認得；舊版 /apply/ 不送 resume_extra，照舊運作）：
 *   resume_b64／resume_name／resume_mime：第 1 張（或那一份 PDF／Word）
 *   resume_extra：[{ b64, name, mime }]  第 2 張以後的截圖，照選取順序
 *   resume_pages：總共幾張
 * 後端會把整組截圖一起交給 OCR（parse_resumes.py），合成一份文字給阿財讀。
 *
 * 用在：/apply-beta/、/resume/（面談前補履歷）。正式版 /apply/ 目前沒用這支。
 * 用法：var rs = S1Resume.mount(el, { api, track(name, params), onChange() });
 *       rs.validate() → { ok, field, message }；await rs.payload() → 要併進送出 body 的欄位
 *       rs.getState()／rs.setState(s, submitted)：存草稿、測驗回來還原（檔案本身存不了，只記檔名）
 *       rs.showUnreadable(true)：OCR 判定照片看不清楚時，在上傳區下面顯示提示
 */
(function () {
  'use strict';
  var MAX = 8 * 1024 * 1024;          // 單一檔案上限（後端同一個數字）
  var MAX_TOTAL = 30 * 1024 * 1024;   // 整組截圖加起來的上限
  var MAX_PAGES = 10;                 // 截圖最多幾張（履歷超過 10 頁通常是作品集）
  var YEARS = ['未滿 1 年', '1–3 年', '3–5 年', '5–10 年', '10 年以上'];
  var EDU = ['國中以下', '高中職', '專科', '大學', '碩士', '博士'];
  var UNREADABLE = '照片有點看不清楚，可以再截一次圖（整頁、字大一點）嗎？';

  var CSS = '' +
    '.rs{position:relative;display:flex;flex-direction:column;gap:10px}' +
    '[hidden]{display:none!important}' +
    // 分頁（segmented control）
    '.rs-tabs{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;padding:4px;margin:0;border-radius:12px;background:#eef1f5}' +
    '.rs .rs-tab{display:flex;align-items:center;justify-content:center;min-height:46px;width:100%;margin:0;padding:6px 4px;' +
    '  border:0;border-radius:9px;background:transparent;color:var(--tx2,#4d5c72);font:inherit;font-size:14px;font-weight:600;' +
    '  line-height:1.3;text-align:center;cursor:pointer}' +
    '.rs .rs-tab[aria-selected=true]{background:#fff;color:var(--tx,#16202e);box-shadow:0 1px 3px rgba(22,32,46,.14)}' +
    '.rs .rs-tab:focus-visible,.rs-pick:focus-visible,.rs-link:focus-visible,.rs-linego:focus-visible,.rs-x:focus-visible,.rs-add:focus-visible' +
    '{outline:3px solid var(--ac,#2f5fd8);outline-offset:2px}' +
    '.rs-panel{display:flex;flex-direction:column;gap:10px}' +
    '.rs-lead{font-size:13px;color:var(--tx2,#4d5c72);margin:0;line-height:1.6}' +
    // 上傳區
    '.rs .rs-pick{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;width:100%;min-height:128px;' +
    '  margin:0;padding:18px 14px;border:2px dashed #a9b7cc;border-radius:14px;background:#f7f9fd;color:var(--tx,#16202e);' +
    '  font:inherit;text-align:center;cursor:pointer}' +
    '.rs .rs-pick.drag{border-color:var(--ac,#2f5fd8);background:#eef3ff}' +
    '.rs-pick svg{width:30px;height:30px;color:var(--ac,#2f5fd8)}' +
    '.rs-pick b{font-size:16.5px;font-weight:700;color:var(--ac,#2f5fd8)}' +
    '.rs-pick small{font-size:12.5px;color:var(--tx3,#7c8899);line-height:1.5;max-width:30em}' +
    '.rs-files{display:flex;flex-direction:column;gap:8px}' +
    '.rs-count{display:flex;align-items:center;gap:8px;font-size:14px;color:#1e7a4f;font-weight:600}' +
    '.rs-count .rs-link{margin-left:auto;font-weight:400}' +
    '.rs-thumbs{display:grid;grid-template-columns:repeat(auto-fill,minmax(76px,1fr));gap:8px;margin:0;padding:0;list-style:none}' +
    '.rs-th{position:relative;aspect-ratio:3/4;border:1px solid var(--line,#dfe4ec);border-radius:9px;overflow:hidden;background:#fff}' +
    '.rs-th img{display:block;width:100%;height:100%;object-fit:cover;object-position:top}' +
    '.rs-th .rs-no{position:absolute;left:4px;bottom:4px;padding:1px 6px;border-radius:6px;background:rgba(22,32,46,.75);color:#fff;font-size:11.5px}' +
    '.rs .rs-x{position:absolute;top:0;right:0;display:flex;align-items:flex-start;justify-content:flex-end;width:44px;height:44px;margin:0;padding:4px;' +
    '  border:0;background:transparent;cursor:pointer}' +
    '.rs-x span{display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:rgba(22,32,46,.78);color:#fff;font-size:15px;line-height:1}' +
    '.rs .rs-add{display:flex;flex-direction:column;align-items:center;justify-content:center;aspect-ratio:3/4;width:100%;margin:0;padding:4px;' +
    '  border:1.5px dashed #a9b7cc;border-radius:9px;background:#fff;color:var(--ac,#2f5fd8);font:inherit;font-size:12.5px;cursor:pointer}' +
    '.rs-add b{font-size:22px;line-height:1}' +
    '.rs-doc{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid #cfe9da;border-radius:10px;background:#eef8f2;color:#1e7a4f;font-size:14px}' +
    '.rs-doc b{font-weight:600;word-break:break-all}' +
    '.rs-doc .rs-link{margin-left:auto}' +
    '.rs-err{color:#a5312a;background:#fdecea;border:1px solid #f3c2bc;border-radius:10px;padding:10px 12px;font-size:13.5px;margin:0;line-height:1.6}' +
    '.rs-warn{color:#7a4b00;background:#fff6e0;border:1px solid #f1d58f;border-radius:10px;padding:10px 12px;font-size:14px;margin:0;line-height:1.6}' +
    '.rs-more{font-size:13px;color:var(--tx3,#7c8899);margin:0;text-align:center}' +
    '.rs .rs-link{display:inline-flex;align-items:center;background:none;border:0;padding:6px 4px;min-height:44px;margin:0;width:auto;' +
    '  color:var(--ac,#2f5fd8);font:inherit;font-size:13.5px;text-decoration:underline;cursor:pointer}' +
    '.rs-box{border:1px solid var(--line,#dfe4ec);border-radius:12px;padding:14px;background:var(--soft,#f6f8fb)}' +
    '.rs-box p{margin:0 0 8px;font-size:14px;line-height:1.65;color:var(--tx,#16202e)}' +
    '.rs-box p:last-child{margin-bottom:0}' +
    '.rs-box label{display:block;font-size:13px;margin:10px 0 5px;color:var(--tx2,#4d5c72)}' +
    '.rs-box label:first-child{margin-top:0}' +
    '.rs-linego{display:flex;align-items:center;justify-content:center;gap:8px;min-height:52px;margin:0 0 10px;padding:12px;' +
    '  border-radius:12px;background:#06a54a;color:#fff!important;text-decoration:none;font-weight:700;font-size:16px;text-align:center}' +
    '.rs-code{font-family:ui-monospace,Menlo,monospace;letter-spacing:.06em}' +
    '.rs-status{font-size:13.5px!important;color:var(--tx2,#4d5c72)!important}' +
    '.rs-status.ok{color:#1e7a4f!important;font-weight:600}' +
    '.rs-vh{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:0!important;' +
    '  overflow:hidden;clip:rect(0 0 0 0);opacity:0;border:0!important}' +
    '@media (prefers-reduced-motion:reduce){.rs *{transition:none!important}}';

  var IC = {
    upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 9"/></svg>',
    line: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3C6.5 3 2 6.6 2 11c0 3.9 3.5 7.2 8.3 7.9.3.1.8.2.9.5.1.3.1.7 0 1l-.1.9c0 .3-.2 1 .9.5s5.9-3.5 8-6C21.4 14.3 22 12.7 22 11c0-4.4-4.5-8-10-8zM8 13.4H6.1a.5.5 0 0 1-.5-.5V9.2a.5.5 0 0 1 1 0v3.2H8a.5.5 0 0 1 0 1zm2-.5a.5.5 0 0 1-1 0V9.2a.5.5 0 0 1 1 0zm4.6 0a.5.5 0 0 1-.9.3l-1.9-2.6v2.3a.5.5 0 0 1-1 0V9.2a.5.5 0 0 1 .9-.3l1.9 2.6V9.2a.5.5 0 0 1 1 0zm3-2.3a.5.5 0 0 1 0 1h-1.4v.9h1.4a.5.5 0 0 1 0 1h-1.9a.5.5 0 0 1-.5-.5V9.2a.5.5 0 0 1 .5-.5h1.9a.5.5 0 0 1 0 1h-1.4v.9z"/></svg>'
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function sizeBucket(n) {
    var mb = n / 1048576;
    return mb < 0.5 ? '<0.5MB' : mb < 2 ? '0.5-2MB' : mb < 5 ? '2-5MB' : mb < 8 ? '5-8MB' : '>8MB';
  }
  function kindOf(f) {
    var n = (f.name || '').toLowerCase(), t = f.type || '';
    if (/\.pdf$/.test(n) || t === 'application/pdf') return 'pdf';
    if (/\.docx?$/.test(n) || /word/.test(t)) return 'doc';
    if (/^image\//.test(t) || /\.(jpe?g|png|webp|heic|heif)$/.test(n)) return 'image';
    return 'other';
  }
  function readB64(blob) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(String(r.result).split(',')[1]); };
      r.onerror = rej;
      r.readAsDataURL(blob);
    });
  }
  // 手機截圖／照片動輒 2–6MB：縮到長邊 2600px 的 JPEG（PDF 截圖字小，不能縮太多，OCR 才讀得清楚）
  function shrinkImage(file) {
    return new Promise(function (res) {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 1500000) return res(file);
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        try {
          var k = Math.min(1, 2600 / Math.max(img.naturalWidth, img.naturalHeight));
          var c = document.createElement('canvas');
          c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
          var g = c.getContext('2d');
          g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);   // 透明 PNG 轉 JPEG 不要變黑底
          g.drawImage(img, 0, 0, c.width, c.height);
          c.toBlob(function (b) {
            URL.revokeObjectURL(url);
            if (!b || b.size >= file.size) return res(file);
            var name = (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg';
            res(new File([b], name, { type: 'image/jpeg' }));
          }, 'image/jpeg', 0.86);
        } catch (e) { URL.revokeObjectURL(url); res(file); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); res(file); };
      img.src = url;
    });
  }

  var TABS = [
    { id: 'upload', label: '上傳截圖或檔案' },
    { id: 'line', label: '用 LINE 傳' },
    { id: 'quick', label: '沒有履歷' }
  ];
  var seq = 0;

  function mount(root, opts) {
    opts = opts || {};
    var API = opts.api;
    var track = opts.track || function () {};
    var onChange = opts.onChange || function () {};
    if (!document.getElementById('rs-css')) {
      var st = document.createElement('style'); st.id = 'rs-css'; st.textContent = CSS;
      document.head.appendChild(st);
    }
    var uid = 'rs' + (++seq);
    var opt = function (a) { return a.map(function (x) { return '<option>' + esc(x) + '</option>'; }).join(''); };
    root.innerHTML =
      '<div class="rs">' +
      '<div class="rs-tabs" role="tablist" aria-label="交履歷的方式">' +
      TABS.map(function (t, i) {
        return '<button type="button" class="rs-tab" role="tab" id="' + uid + '-t-' + t.id + '" data-tab="' + t.id + '"' +
          ' aria-controls="' + uid + '-p-' + t.id + '" aria-selected="' + (i === 0) + '" tabindex="' + (i === 0 ? 0 : -1) + '">' +
          t.label + '</button>';
      }).join('') +
      '</div>' +
      // ── 上傳 ──
      '<div class="rs-panel" role="tabpanel" id="' + uid + '-p-upload" aria-labelledby="' + uid + '-t-upload" data-panel="upload">' +
      '  <button type="button" class="rs-pick">' + IC.upload +
      '    <b>選截圖或檔案</b>' +
      '    <small>履歷 PDF 的截圖可以一次選好幾張（照頁數順序選），也可以直接選 PDF／Word 檔</small></button>' +
      // ⚠️ 不用 hidden（display:none）：有些 App 內建瀏覽器對看不見的選檔框按 .click() 沒反應
      '  <input type="file" class="rs-in rs-vh" multiple accept="image/*,.pdf,.doc,.docx,application/pdf" tabindex="-1" aria-hidden="true">' +
      '  <div class="rs-files" hidden aria-live="polite"></div>' +
      '  <p class="rs-err rs-fileerr" role="alert" hidden></p>' +
      '  <p class="rs-warn rs-unread" role="alert" hidden>' + UNREADABLE + '</p>' +
      '  <div class="rs-box rs-pastebox" hidden><label for="' + uid + '-paste">把履歷內容貼在這裡（從 104、LinkedIn、筆記複製都可以）</label>' +
      '    <textarea id="' + uid + '-paste" class="rs-paste" rows="7" maxlength="20000" placeholder="最近的工作、職稱、做過的事、學歷…"></textarea></div>' +
      '  <div class="rs-box rs-urlbox" hidden><label for="' + uid + '-url">Google Drive／Dropbox 的「檔案」分享連結</label>' +
      '    <input id="' + uid + '-url" class="rs-url" name="resume_url" inputmode="url" placeholder="https://drive.google.com/file/d/…">' +
      '    <p class="rs-status" style="margin-top:8px">分享設定要開「知道連結的任何人都能檢視」；資料夾連結系統讀不到。</p></div>' +
      '  <p class="rs-more"><button type="button" class="rs-link" data-x="paste">改成貼上文字</button>　' +
      '    <button type="button" class="rs-link" data-x="url">貼雲端連結</button></p>' +
      '</div>' +
      // ── LINE ──
      '<div class="rs-panel" role="tabpanel" id="' + uid + '-p-line" aria-labelledby="' + uid + '-t-line" data-panel="line" hidden>' +
      '  <p class="rs-lead">手機裡找不到檔案也沒關係：可以先填表、做測驗，跟阿財面談前從 LINE 傳到就好。</p>' +
      '  <div class="rs-box rs-linebox"></div>' +
      '</div>' +
      // ── 沒有履歷：1 分鐘快速履歷 ──
      '<div class="rs-panel" role="tabpanel" id="' + uid + '-p-quick" aria-labelledby="' + uid + '-t-quick" data-panel="quick" hidden>' +
      '  <p class="rs-lead">回答 5 個小問題就好，大約 1 分鐘。</p>' +
      '  <div class="rs-box">' +
      '  <label for="' + uid + '-q1">最近一份工作的公司</label><input id="' + uid + '-q1" data-q="company" maxlength="80" autocomplete="organization" placeholder="例：某某科技（沒工作過寫「無」）">' +
      '  <label for="' + uid + '-q2">職稱</label><input id="' + uid + '-q2" data-q="title" maxlength="80" autocomplete="organization-title" placeholder="例：行政助理、作業員、工讀生">' +
      '  <label for="' + uid + '-q3">在這份工作做了多久</label><select id="' + uid + '-q3" data-q="years"><option value="">請選擇</option>' + opt(YEARS) + '</select>' +
      '  <label for="' + uid + '-q4">主要負責什麼（一句話）</label><input id="' + uid + '-q4" data-q="duty" maxlength="300" placeholder="例：每天處理訂單和出貨，管倉庫進出">' +
      '  <label for="' + uid + '-q5">最高學歷</label><select id="' + uid + '-q5" data-q="edu"><option value="">請選擇</option>' + opt(EDU) + '</select>' +
      '  </div>' +
      '</div>' +
      '</div>';

    var $ = function (s) { return root.querySelector(s); };
    // tab：目前在哪個分頁；sub：上傳分頁裡改用「貼上文字／雲端連結」
    // files：[{ file, name, kind, thumb }]——截圖可以很多張（照選取順序），PDF／Word 只能一份
    var S = { tab: 'upload', sub: '', files: [], code: '', lineUrl: '', received: false, submitted: null, touched: false };
    var pollT = null;

    function method() {
      if (S.tab === 'upload') return S.sub || 'upload';
      return S.tab;
    }

    // ── 分頁 ──
    function setTab(t, silent, focus) {
      if (S.tab !== t && !silent) { S.touched = true; track('resume_method_select', { method: t === 'upload' ? (S.sub || 'upload') : t }); }
      S.tab = t;
      root.querySelectorAll('.rs-tab').forEach(function (b) {
        var on = b.getAttribute('data-tab') === t;
        b.setAttribute('aria-selected', on ? 'true' : 'false');
        b.tabIndex = on ? 0 : -1;
        if (on && focus) b.focus();
      });
      root.querySelectorAll('[data-panel]').forEach(function (p) { p.hidden = p.getAttribute('data-panel') !== t; });
      if (t === 'line') startLine(); else stopPoll();
      onChange();
    }
    root.querySelectorAll('.rs-tab').forEach(function (b, i, all) {
      b.addEventListener('click', function () { setTab(b.getAttribute('data-tab')); });
      b.addEventListener('keydown', function (e) {
        var k = e.key, j = -1;
        if (k === 'ArrowRight' || k === 'ArrowDown') j = (i + 1) % all.length;
        else if (k === 'ArrowLeft' || k === 'ArrowUp') j = (i - 1 + all.length) % all.length;
        else if (k === 'Home') j = 0;
        else if (k === 'End') j = all.length - 1;
        if (j < 0) return;
        e.preventDefault();
        setTab(all[j].getAttribute('data-tab'), false, true);
      });
    });

    // 上傳分頁裡的「貼上文字／貼雲端連結」：再按一次收回去，回到上傳
    function setSub(x, silent) {
      if (S.sub !== x && !silent) { S.touched = true; track('resume_method_select', { method: x || 'upload' }); }
      S.sub = x;
      $('.rs-pastebox').hidden = x !== 'paste';
      $('.rs-urlbox').hidden = x !== 'url';
      $('.rs-pick').hidden = !!x;
      $('.rs-files').hidden = !!x || !(S.files.length || S.submitted);
      root.querySelectorAll('.rs-link[data-x]').forEach(function (b) {
        var k = b.getAttribute('data-x');
        b.textContent = x === k ? '改回上傳截圖或檔案' : (k === 'paste' ? '改成貼上文字' : '貼雲端連結');
      });
      onChange();
    }
    root.querySelectorAll('.rs-link[data-x]').forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-x');
        setSub(S.sub === k ? '' : k);
        if (S.sub) { var el = S.sub === 'paste' ? $('.rs-paste') : $('.rs-url'); if (el) el.focus(); }
      });
    });

    // ── 選檔 ──
    function fileErr(msg) {
      var e = $('.rs-fileerr');
      e.textContent = msg || ''; e.hidden = !msg;
    }
    function pick() {
      track('resume_file_pick', { kind: S.files.length ? 'more' : 'any' });
      $('.rs-in').click();
    }
    $('.rs-pick').addEventListener('click', pick);
    $('.rs-in').addEventListener('change', function () {
      var list = Array.prototype.slice.call(this.files || []);
      this.value = '';
      addFiles(list);
    });
    // 電腦版：直接把檔案拖進來
    var pk = $('.rs-pick');
    ['dragenter', 'dragover'].forEach(function (ev) {
      pk.addEventListener(ev, function (e) { e.preventDefault(); pk.classList.add('drag'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      pk.addEventListener(ev, function (e) { e.preventDefault(); pk.classList.remove('drag'); });
    });
    pk.addEventListener('drop', function (e) {
      var list = Array.prototype.slice.call((e.dataTransfer && e.dataTransfer.files) || []);
      if (list.length) addFiles(list);
    });

    function addFiles(list) {
      fileErr('');
      if (!list.length) return;
      var docs = list.filter(function (f) { var k = kindOf(f); return k === 'pdf' || k === 'doc'; });
      var imgs = list.filter(function (f) { return kindOf(f) === 'image'; });
      var bad = list.length - docs.length - imgs.length;
      var heic = imgs.filter(function (f) { return /heic|heif/i.test(f.type) || /\.(heic|heif)$/i.test(f.name || ''); });
      imgs = imgs.filter(function (f) { return heic.indexOf(f) < 0; });
      var notes = [];
      if (bad) notes.push('有 ' + bad + ' 個檔案格式系統讀不到（請用截圖、PDF 或 Word）');
      if (heic.length) notes.push('有 ' + heic.length + ' 張是 HEIC 格式讀不到，請改用截圖，或改「用 LINE 傳」');
      // PDF／Word 只收一份；同時選了檔案跟截圖，以檔案為準
      if (docs.length) {
        if (docs.length > 1 || imgs.length) notes.push('PDF／Word 一次只能一份，先用「' + docs[0].name + '」');
        var d = docs[0];
        if (d.size > MAX) { fileErr('檔案超過 8MB。可以改成截圖上傳，或「用 LINE 傳」'); return; }
        clearFiles(true);
        S.files = [{ file: d, name: d.name || '履歷', kind: kindOf(d) }];
        S.submitted = null; S.touched = true;
        track('resume_file_ok', { kind: kindOf(d), size_bucket: sizeBucket(d.size), count: 1 });
        afterPick(notes);
        return;
      }
      if (!imgs.length) { fileErr(notes.join('；') || '沒有選到檔案'); return; }
      // 之前選的是 PDF／Word，這次改選截圖 → 換成截圖
      if (S.files.length && S.files[0].kind !== 'image') clearFiles(true);
      var room = MAX_PAGES - S.files.length;
      if (imgs.length > room) { notes.push('截圖最多 ' + MAX_PAGES + ' 張，多的沒有加進來'); imgs = imgs.slice(0, Math.max(0, room)); }
      Promise.all(imgs.map(shrinkImage)).then(function (gs) {
        var total = S.files.reduce(function (n, x) { return n + x.file.size; }, 0);
        gs.forEach(function (g) {
          if (g.size > MAX) { notes.push('「' + (g.name || '照片') + '」超過 8MB，沒有加進來'); return; }
          if (total + g.size > MAX_TOTAL) { notes.push('截圖加起來太大了，後面幾張沒有加進來（可以改「用 LINE 傳」）'); return; }
          total += g.size;
          var th = '';
          try { th = URL.createObjectURL(g); } catch (e) { /* 舊瀏覽器沒縮圖就算了 */ }
          S.files.push({ file: g, name: g.name || '截圖', kind: 'image', thumb: th });
        });
        if (gs.length) {
          S.submitted = null; S.touched = true;
          track('resume_file_ok', { kind: 'image', size_bucket: sizeBucket(total), count: S.files.length });
        }
        afterPick(notes);
      });
    }
    function afterPick(notes) {
      if (S.sub) setSub('', true);
      showUnread(false);
      fileErr(notes.length ? notes.join('；') : '');
      renderFiles();
      onChange();
    }
    function clearFiles(silent) {
      S.files.forEach(function (x) { if (x.thumb) try { URL.revokeObjectURL(x.thumb); } catch (e) {} });
      S.files = [];
      if (!silent) { renderFiles(); onChange(); }
    }
    function renderFiles() {
      var box = $('.rs-files');
      var n = S.files.length;
      $('.rs-pick').hidden = !!S.sub || n > 0 || !!S.submitted;
      if (!n && !S.submitted) { box.hidden = true; box.innerHTML = ''; return; }
      box.hidden = !!S.sub;
      if (!n && S.submitted) {
        box.innerHTML = '<div class="rs-doc"><span>已上傳：<b>' + esc(S.submitted.label) + '</b>（不用重選）</span>' +
          '<button type="button" class="rs-link rs-redo">重新選</button></div>';
        box.querySelector('.rs-redo').addEventListener('click', function () { pick(); });
        return;
      }
      if (S.files[0].kind !== 'image') {
        box.innerHTML = '<div class="rs-doc"><span>已選好：<b>' + esc(S.files[0].name) + '</b></span>' +
          '<button type="button" class="rs-link rs-clear">換一個</button></div>';
        box.querySelector('.rs-clear').addEventListener('click', function () { clearFiles(); });
        return;
      }
      box.innerHTML = '<div class="rs-count"><span>已選 ' + n + ' 張</span>' +
        '<button type="button" class="rs-link rs-clear">全部清掉</button></div>' +
        '<ol class="rs-thumbs">' + S.files.map(function (x, i) {
          return '<li class="rs-th">' + (x.thumb ? '<img src="' + esc(x.thumb) + '" alt="第 ' + (i + 1) + ' 張">' : '') +
            '<span class="rs-no">' + (i + 1) + '</span>' +
            '<button type="button" class="rs-x" data-i="' + i + '" aria-label="拿掉第 ' + (i + 1) + ' 張"><span aria-hidden="true">×</span></button></li>';
        }).join('') +
        (n < MAX_PAGES ? '<li><button type="button" class="rs-add" aria-label="再加一張截圖"><b>＋</b>再加一張</button></li>' : '') +
        '</ol>';
      box.querySelector('.rs-clear').addEventListener('click', function () { clearFiles(); });
      var add = box.querySelector('.rs-add');
      if (add) add.addEventListener('click', pick);
      box.querySelectorAll('.rs-x').forEach(function (b) {
        b.addEventListener('click', function () {
          var i = +b.getAttribute('data-i'), x = S.files.splice(i, 1)[0];
          if (x && x.thumb) try { URL.revokeObjectURL(x.thumb); } catch (e) {}
          track('resume_file_remove', { count: S.files.length });
          renderFiles(); onChange();
          var next = box.querySelector('.rs-x[data-i="' + Math.min(i, S.files.length - 1) + '"]') || box.querySelector('.rs-add') || $('.rs-pick');
          if (next) next.focus();
        });
      });
    }
    function showUnread(on) {
      $('.rs-unread').hidden = !on;
      if (on) {
        // 看不清楚：讓他重新選，舊的那組不用留著
        S.submitted = null;
        if (S.tab !== 'upload') setTab('upload', true);
        if (S.sub) setSub('', true);
        renderFiles();
      }
    }

    // ── LINE ──
    function lineBox() {
      var box = $('.rs-linebox');
      if (!S.code) { box.innerHTML = '<p class="rs-status">準備中⋯</p>'; return; }
      box.innerHTML =
        '<a class="rs-linego" href="' + esc(S.lineUrl) + '" target="_blank" rel="noopener">' + IC.line.replace('<svg', '<svg width="22" height="22"') +
        '<span>打開 LINE，送出「我要傳履歷 <span class="rs-code">#' + esc(S.code) + '</span>」</span></a>' +
        '<p><b>送出這句，再把履歷檔或截圖傳過來就好。</b>好幾頁的話，截圖可以一次選好幾張一起傳。</p>' +
        '<p class="rs-status' + (S.received ? ' ok' : '') + '" aria-live="polite">' +
        (S.received ? '✅ 已經收到你從 LINE 傳來的履歷了' + (S.pages > 1 ? '（共 ' + S.pages + ' 頁）' : '') + '。'
          : '還沒收到——可以先繼續填表、做測驗，跟阿財面談前傳到就好。') + '</p>' +
        (S.received ? '' : '<button type="button" class="rs-link rs-check">我傳好了，檢查一下</button>');
      box.querySelector('.rs-linego').addEventListener('click', function () {
        track('resume_line_open', {});
        // 2026-10-12：跳去 LINE 前立刻存草稿（不等 400ms），回來才帶得回填過的欄位
        try { if (window.__rsSaveNow) window.__rsSaveNow(); } catch (e) {}
      });
      var ck = box.querySelector('.rs-check');
      if (ck) ck.addEventListener('click', function () { ck.textContent = '檢查中⋯'; poll(10); });
    }
    function startLine() {
      lineBox();
      if (!S.code) {
        fetch(API + '/apply/resume-code', { method: 'POST' })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (!d.ok) throw new Error(d.error);
            S.code = d.code; S.lineUrl = d.line_url; lineBox(); onChange(); poll();
          })
          .catch(function () {
            $('.rs-linebox').innerHTML = '<p class="rs-err">網路不穩，代碼沒拿到。請按一下重試。</p>' +
              '<button type="button" class="rs-link rs-retry">重試</button>';
            $('.rs-retry').addEventListener('click', startLine);
          });
      } else poll(300);
    }
    function stopPoll() { if (pollT) { clearTimeout(pollT); pollT = null; } }
    function poll(delay) {
      stopPoll();
      if (!S.code || S.received || S.tab !== 'line') return;
      pollT = setTimeout(function () {
        if (document.hidden) return poll();
        fetch(API + '/apply/resume-code/' + encodeURIComponent(S.code))
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (d && d.ok && d.received && !S.received) { S.received = true; S.pages = d.pages || 1; track('resume_line_received', {}); lineBox(); onChange(); }
            else if (d && d.ok && !d.received) { var c2 = root.querySelector('.rs-check'); if (c2) c2.textContent = '還沒收到，再檢查一次'; }
          })
          .catch(function () {})
          .then(function () { poll(); });
      }, delay || 6000);
    }
    document.addEventListener('visibilitychange', function () { if (!document.hidden && S.tab === 'line') poll(); });
    // LINE 內建瀏覽器切回來不一定觸發 visibilitychange，pageshow／focus 也補一次
    window.addEventListener('pageshow', function () { if (S.tab === 'line') poll(300); });
    window.addEventListener('focus', function () { if (S.tab === 'line') poll(300); });
    root.addEventListener('input', function () { onChange(); });

    function quickVals() {
      var o = {};
      root.querySelectorAll('[data-q]').forEach(function (el) { o[el.getAttribute('data-q')] = el.value.trim(); });
      return o;
    }
    function filesLabel() {
      if (!S.files.length) return '';
      return S.files[0].kind === 'image' ? (S.files.length + ' 張截圖') : S.files[0].name;
    }

    return {
      method: function () { return S.touched || S.files.length || S.submitted ? method() : ''; },
      code: function () { return S.code; },
      // 「這一步算完成了嗎」：給 GA 的分段事件用，不顯示錯誤
      isDone: function () { return this.validate().ok; },
      validate: function () {
        if (S.submitted) return { ok: true };
        var m = method();
        if (m === 'upload' && !S.files.length) return { ok: false, field: 'resume_file', el: $('.rs-pick'),
          message: '請交一份履歷：上傳截圖或檔案、用 LINE 傳，或在「沒有履歷」填 5 個小問題' };
        if (m === 'line' && !S.code) return { ok: false, field: 'resume_line', el: $('.rs-tab[data-tab=line]'), message: 'LINE 代碼還沒拿到，請檢查網路後再按一次「用 LINE 傳」' };
        if (m === 'quick') {
          var q = quickVals(), miss = ['company', 'title', 'years', 'duty', 'edu'].filter(function (k) { return !q[k]; });
          if (miss.length) return { ok: false, field: 'quick_' + miss[0], el: $('[data-q=' + miss[0] + ']'), message: '快速履歷還有 ' + miss.length + ' 格沒填' };
        }
        if (m === 'paste' && $('.rs-paste').value.trim().length < 30) return { ok: false, field: 'resume_paste', el: $('.rs-paste'), message: '貼上的內容太短了，至少要有最近一份工作的公司、職稱和做過的事' };
        if (m === 'url') {
          var u = $('.rs-url').value.trim();
          if (!u) return { ok: false, field: 'resume_url', el: $('.rs-url'), message: '請貼上雲端連結，或改用其他方式' };
          if (/drive\.google\.com\/drive\/folders\//i.test(u)) return { ok: false, field: 'resume_url', el: $('.rs-url'), message: '這是「資料夾」連結，系統讀不到裡面的履歷。請改貼單一檔案的分享連結，或直接上傳' };
        }
        return { ok: true };
      },
      urlToCheck: function () { return method() === 'url' ? $('.rs-url').value.trim() : ''; },
      payload: function () {
        var m = method(), o = { resume_method: m };
        if (m === 'upload' && S.files.length) {
          var total = S.files.reduce(function (n, x) { return n + x.file.size; }, 0);
          if (S.files.some(function (x) { return x.file.size > MAX; }) || total > MAX_TOTAL) {
            return Promise.reject(new Error('檔案太大了，可以改用「用 LINE 傳」'));
          }
          return Promise.all(S.files.map(function (x) { return readB64(x.file); })).then(function (bs) {
            o.resume_b64 = bs[0]; o.resume_name = S.files[0].file.name || S.files[0].name; o.resume_mime = S.files[0].file.type;
            o.resume_pages = S.files.length;
            if (S.files.length > 1) {
              o.resume_extra = S.files.slice(1).map(function (x, i) {
                return { b64: bs[i + 1], name: x.file.name || x.name, mime: x.file.type };
              });
            }
            return o;
          });
        }
        if (m === 'upload') o.resume_method = S.submitted ? 'upload' : null;
        if (m === 'line') o.resume_code = S.code;
        if (m === 'quick') o.quick_resume = quickVals();
        if (m === 'paste') o.resume_text = $('.rs-paste').value.trim();
        if (m === 'url') o.resume_url = $('.rs-url').value.trim();
        return Promise.resolve(o);
      },
      getState: function () {
        var m = this.method();
        return { method: m, code: S.code, line_url: S.lineUrl, received: S.received,
          file_name: filesLabel() || (S.submitted && S.submitted.label) || '',
          file_count: S.files.length || (S.submitted && S.submitted.count) || 0,
          quick: quickVals(), paste: $('.rs-paste').value, url: $('.rs-url').value };
      },
      // submitted=true：測驗做完回來，履歷已經在第一次送出時存進資料庫了，不用重選
      setState: function (s, submitted) {
        if (!s) return;
        S.code = s.code || ''; S.lineUrl = s.line_url || ''; S.received = !!s.received;
        var q = s.quick || {};
        root.querySelectorAll('[data-q]').forEach(function (el) { if (q[el.getAttribute('data-q')]) el.value = q[el.getAttribute('data-q')]; });
        if (s.paste) $('.rs-paste').value = s.paste;
        if (s.url) $('.rs-url').value = s.url;
        var m = s.method || '';
        if (submitted && m === 'upload' && s.file_name) {
          S.submitted = { label: s.file_name, count: s.file_count || 1 };
          S.touched = true;
        }
        if (m) S.touched = true;
        if (m === 'line' || m === 'quick') setTab(m, true);
        else if (m === 'paste' || m === 'url') { setTab('upload', true); setSub(m, true); }
        renderFiles();
      },
      // OCR 判定照片字太少（看不清楚）：上傳區下面顯示提示、讓他重選
      showUnreadable: function (on) { showUnread(on !== false); onChange(); },
      focusError: function (v) {
        if (v && v.el) {
          v.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          try { v.el.focus({ preventScroll: true }); } catch (e) { /* 舊瀏覽器 */ }
        }
      }
    };
  }

  window.S1Resume = { mount: mount, YEARS: YEARS, EDU: EDU, UNREADABLE: UNREADABLE };
})();
