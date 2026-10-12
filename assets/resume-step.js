/* 履歷這一步：三條路（2026-10-12）
 *
 * 為什麼有這支：9/12–10/11 手機上開始填應徵表的 49 人只有 28 人過第一頁，電腦 15 人只掉 1 人；
 * 成功送出的 46 份履歷全是 PDF／Word、0 張照片——手機裡沒有履歷檔的人就直接離開了。
 * 研究紀錄：~/下載項目/step1ne-seo-records/研究_應徵表單流失_20261012.html
 *
 * 三條路（照畫面順序）：
 *   1. 上傳檔案：大按鈕「拍照／截圖上傳」（手機直接叫出相機／相簿）＋小按鈕「選 PDF／Word 檔」
 *   2. 我用 LINE 傳：拿一組代碼，打開官方帳號送出「我要傳履歷 #XXXXX」，再把檔案或照片傳過去。
 *      表單跟測驗可以先做；面談室入口會擋到真的收到為止（Jacky 硬規則：阿財開口前一定要有履歷）。
 *   3. 沒有履歷？1 分鐘快速履歷：5 格（公司、職稱、做了幾年、主要負責、最高學歷）
 *   ＋ 小連結：直接貼上履歷文字／貼雲端連結
 *
 * 用在：/apply/（新版）、/apply-beta/、/resume/（面談前補履歷）。
 * 用法：var rs = S1Resume.mount(el, { api, track(name, params), onChange() });
 *       rs.validate() → { ok, field, message }；await rs.payload() → 要併進送出 body 的欄位
 *       rs.getState()／rs.setState(s)：存草稿、測驗回來還原（檔案本身存不了，只記檔名）
 */
(function () {
  'use strict';
  var MAX = 8 * 1024 * 1024;
  var YEARS = ['未滿 1 年', '1–3 年', '3–5 年', '5–10 年', '10 年以上'];
  var EDU = ['國中以下', '高中職', '專科', '大學', '碩士', '博士'];

  var CSS = '' +
    '.rs{display:flex;flex-direction:column;gap:10px}' +
    '.rs-lead{font-size:13px;color:var(--tx2,#4d5c72);margin:0 0 2px;line-height:1.6}' +
    '.rs-big{display:flex;align-items:center;gap:12px;width:100%;min-height:58px;margin:0;padding:12px 14px;' +
    '  border:1.5px solid var(--line,#dfe4ec);border-radius:12px;background:#fff;color:var(--tx,#16202e);' +
    '  font:inherit;font-size:16px;font-weight:600;text-align:left;cursor:pointer}' +
    '.rs-big svg{flex:0 0 26px;width:26px;height:26px}' +
    '.rs-big small{display:block;font-size:12.5px;font-weight:400;color:var(--tx3,#7c8899);margin-top:1px;line-height:1.45}' +
    '.rs-big[aria-pressed=true]{border-color:var(--ac,#2f5fd8);background:#f3f7ff;box-shadow:0 0 0 3px rgba(47,95,216,.12)}' +
    '.rs-big:focus-visible,.rs-sub:focus-visible,.rs-link:focus-visible,.rs-linego:focus-visible{outline:3px solid var(--ac,#2f5fd8);outline-offset:2px}' +
    '.rs-photo{border-color:var(--ac,#2f5fd8);color:var(--ac,#2f5fd8)}' +
    '.rs-sub{display:block;width:100%;min-height:44px;margin:0;padding:10px 12px;border:1px dashed #b9c3d2;border-radius:10px;' +
    '  background:#fff;color:var(--tx2,#4d5c72);font:inherit;font-size:14px;cursor:pointer}' +
    '.rs-picked{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:14px;color:#1e7a4f;background:#eef8f2;' +
    '  border:1px solid #cfe9da;border-radius:10px;padding:10px 12px}' +
    '.rs-picked b{font-weight:600;word-break:break-all}' +
    '.rs-picked .rs-link{margin-left:auto}' +
    '.rs-or{display:flex;align-items:center;gap:10px;font-size:12px;color:var(--tx3,#7c8899);margin:2px 0}' +
    '.rs-or:before,.rs-or:after{content:"";flex:1;border-top:1px solid var(--line,#dfe4ec)}' +
    '.rs-line svg{color:#06a54a}' +
    '.rs-box{border:1px solid var(--line,#dfe4ec);border-radius:12px;padding:14px;background:var(--soft,#f6f8fb)}' +
    '.rs-box p{margin:0 0 8px;font-size:14px;line-height:1.65;color:var(--tx,#16202e)}' +
    '.rs-box p:last-child{margin-bottom:0}' +
    '.rs-linego{display:flex;align-items:center;justify-content:center;gap:8px;min-height:52px;margin:0 0 10px;padding:12px;' +
    '  border-radius:12px;background:#06a54a;color:#fff!important;text-decoration:none;font-weight:700;font-size:16px;text-align:center}' +
    '.rs-code{font-family:ui-monospace,Menlo,monospace;letter-spacing:.06em}' +
    '.rs-status{font-size:13.5px!important;color:var(--tx2,#4d5c72)!important}' +
    '.rs-status.ok{color:#1e7a4f!important;font-weight:600}' +
    '.rs-box label{display:block;font-size:13px;margin:10px 0 5px;color:var(--tx2,#4d5c72)}' +
    '.rs-box label:first-child{margin-top:0}' +
    '.rs-more{font-size:13px;color:var(--tx3,#7c8899);margin:2px 0 0;text-align:center}' +
    '.rs-link{background:none;border:0;padding:6px 2px;min-height:44px;margin:0;width:auto;color:var(--ac,#2f5fd8);' +
    '  font:inherit;font-size:13.5px;text-decoration:underline;cursor:pointer}' +
    '.rs-err{color:#a5312a;font-size:13px;margin:6px 0 0}' +
    '.rs-vh{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:0!important;' +
    '  overflow:hidden;clip:rect(0 0 0 0);opacity:0;border:0!important}' +
    '.rs{position:relative}';

  var IC = {
    camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/></svg>',
    line: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3C6.5 3 2 6.6 2 11c0 3.9 3.5 7.2 8.3 7.9.3.1.8.2.9.5.1.3.1.7 0 1l-.1.9c0 .3-.2 1 .9.5s5.9-3.5 8-6C21.4 14.3 22 12.7 22 11c0-4.4-4.5-8-10-8zM8 13.4H6.1a.5.5 0 0 1-.5-.5V9.2a.5.5 0 0 1 1 0v3.2H8a.5.5 0 0 1 0 1zm2-.5a.5.5 0 0 1-1 0V9.2a.5.5 0 0 1 1 0zm4.6 0a.5.5 0 0 1-.9.3l-1.9-2.6v2.3a.5.5 0 0 1-1 0V9.2a.5.5 0 0 1 .9-.3l1.9 2.6V9.2a.5.5 0 0 1 1 0zm3-2.3a.5.5 0 0 1 0 1h-1.4v.9h1.4a.5.5 0 0 1 0 1h-1.9a.5.5 0 0 1-.5-.5V9.2a.5.5 0 0 1 .5-.5h1.9a.5.5 0 0 1 0 1h-1.4v.9z"/></svg>',
    form: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/></svg>'
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
  // 手機照片動輒 3–6MB：縮到長邊 2000px 的 JPEG（OCR 一樣讀得清楚），上傳快、也不會撞 8MB 上限
  function shrinkImage(file) {
    return new Promise(function (res) {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 1200000) return res(file);
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        try {
          var k = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
          var c = document.createElement('canvas');
          c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          c.toBlob(function (b) {
            URL.revokeObjectURL(url);
            if (!b || b.size >= file.size) return res(file);
            var name = (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg';
            res(new File([b], name, { type: 'image/jpeg' }));
          }, 'image/jpeg', 0.85);
        } catch (e) { URL.revokeObjectURL(url); res(file); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); res(file); };
      img.src = url;
    });
  }

  function mount(root, opts) {
    opts = opts || {};
    var API = opts.api;
    var track = opts.track || function () {};
    var onChange = opts.onChange || function () {};
    if (!document.getElementById('rs-css')) {
      var st = document.createElement('style'); st.id = 'rs-css'; st.textContent = CSS;
      document.head.appendChild(st);
    }
    var opt = function (a) { return a.map(function (x) { return '<option>' + esc(x) + '</option>'; }).join(''); };
    root.innerHTML =
      '<div class="rs">' +
      '<p class="rs-lead">選一種方式就好。跟 AI 阿財面談前會先讀過，面談時就不用從頭講一次。</p>' +
      '<button type="button" class="rs-big rs-photo" data-m="upload" data-k="photo" aria-pressed="false">' + IC.camera +
      '<span>拍照／截圖上傳<small>紙本履歷、104 或 LinkedIn 個人頁的截圖都可以</small></span></button>' +
      '<button type="button" class="rs-sub" data-k="file">手機或電腦裡有 PDF／Word 檔？選檔案上傳</button>' +
      // ⚠️ 不用 hidden（display:none）：有些 App 內建瀏覽器對看不見的選檔框按 .click() 沒反應
      '<input type="file" class="rs-in-photo rs-vh" accept="image/*" tabindex="-1" aria-hidden="true">' +
      '<input type="file" class="rs-in-file rs-vh" accept=".pdf,.doc,.docx,image/*" tabindex="-1" aria-hidden="true">' +
      '<div class="rs-picked" hidden aria-live="polite"></div>' +
      '<div class="rs-or">或</div>' +
      '<button type="button" class="rs-big rs-line" data-m="line" aria-pressed="false" aria-expanded="false">' + IC.line +
      '<span>我用 LINE 傳<small>手機裡沒有檔案也沒關係，可以先填表、做測驗</small></span></button>' +
      '<div class="rs-box rs-linebox" hidden></div>' +
      '<button type="button" class="rs-big rs-quick" data-m="quick" aria-pressed="false" aria-expanded="false">' + IC.form +
      '<span>沒有履歷？1 分鐘快速履歷<small>回答 5 個小問題就好</small></span></button>' +
      '<div class="rs-box rs-quickbox" hidden>' +
      '  <label for="rsq-company">最近一份工作的公司</label><input id="rsq-company" data-q="company" maxlength="80" autocomplete="organization" placeholder="例：某某科技（沒工作過寫「無」）">' +
      '  <label for="rsq-title">職稱</label><input id="rsq-title" data-q="title" maxlength="80" autocomplete="organization-title" placeholder="例：行政助理、作業員、工讀生">' +
      '  <label for="rsq-years">在這份工作做了多久</label><select id="rsq-years" data-q="years"><option value="">請選擇</option>' + opt(YEARS) + '</select>' +
      '  <label for="rsq-duty">主要負責什麼（一句話）</label><input id="rsq-duty" data-q="duty" maxlength="300" placeholder="例：每天處理訂單和出貨，管倉庫進出">' +
      '  <label for="rsq-edu">最高學歷</label><select id="rsq-edu" data-q="edu"><option value="">請選擇</option>' + opt(EDU) + '</select>' +
      '</div>' +
      '<p class="rs-more"><button type="button" class="rs-link" data-x="paste">也可以直接貼上履歷文字</button>　' +
      '<button type="button" class="rs-link" data-x="url">貼雲端連結</button></p>' +
      '<div class="rs-box rs-pastebox" hidden><label for="rs-paste">把履歷內容貼在這裡（從 104、LinkedIn、筆記複製都可以）</label>' +
      '  <textarea id="rs-paste" rows="7" maxlength="20000" placeholder="最近的工作、職稱、做過的事、學歷…"></textarea></div>' +
      '<div class="rs-box rs-urlbox" hidden><label for="rs-url">Google Drive／Dropbox 的「檔案」分享連結</label>' +
      '  <input id="rs-url" name="resume_url" inputmode="url" placeholder="https://drive.google.com/file/d/…">' +
      '  <p class="rs-status" style="margin-top:8px">分享設定要開「知道連結的任何人都能檢視」；資料夾連結系統讀不到。</p></div>' +
      '</div>';

    var $ = function (s) { return root.querySelector(s); };
    var S = { method: '', file: null, fileName: '', code: '', lineUrl: '', received: false, submitted: null };
    var pollT = null;

    function setMethod(m, silent) {
      if (S.method !== m && !silent) track('resume_method_select', { method: m });
      S.method = m;
      root.querySelectorAll('.rs-big').forEach(function (b) {
        b.setAttribute('aria-pressed', b.getAttribute('data-m') === m ? 'true' : 'false');
      });
      $('.rs-linebox').hidden = m !== 'line';
      $('.rs-quickbox').hidden = m !== 'quick';
      $('.rs-pastebox').hidden = m !== 'paste';
      $('.rs-urlbox').hidden = m !== 'url';
      $('.rs-line').setAttribute('aria-expanded', m === 'line' ? 'true' : 'false');
      $('.rs-quick').setAttribute('aria-expanded', m === 'quick' ? 'true' : 'false');
      if (m === 'line') startLine(); else stopPoll();
      onChange();
    }

    // ── 上傳 ──
    function pick(kind) {
      track('resume_file_pick', { kind: kind });
      (kind === 'photo' ? $('.rs-in-photo') : $('.rs-in-file')).click();
    }
    $('.rs-photo').addEventListener('click', function () { pick('photo'); });
    $('.rs-sub').addEventListener('click', function () { pick('file'); });
    function onFile(input) {
      var f = input.files && input.files[0];
      input.value = '';
      if (!f) return;
      var k = kindOf(f);
      if (k === 'other') { showPicked(null, '這個檔案格式系統讀不到，請選 PDF、Word 或照片'); return; }
      if (/heic|heif/i.test(f.type) || /\.(heic|heif)$/i.test(f.name || '')) {
        showPicked(null, '這種照片格式（HEIC）系統讀不到，請改用截圖，或選「我用 LINE 傳」');
        return;
      }
      Promise.resolve(k === 'image' ? shrinkImage(f) : f).then(function (g) {
        if (g.size > MAX) { showPicked(null, '檔案超過 8MB。照片可以改用截圖，或選「我用 LINE 傳」'); return; }
        S.file = g; S.fileName = g.name || '履歷'; S.submitted = null;
        track('resume_file_ok', { kind: k, size_bucket: sizeBucket(g.size) });
        showPicked(S.fileName);
        setMethod('upload');
      });
    }
    $('.rs-in-photo').addEventListener('change', function () { onFile(this); });
    $('.rs-in-file').addEventListener('change', function () { onFile(this); });
    function showPicked(name, err) {
      var box = $('.rs-picked');
      box.hidden = false;
      if (err) {
        box.style.cssText = 'color:#a5312a;background:#fdecea;border-color:#f3c2bc';
        box.textContent = err;
        return;
      }
      box.style.cssText = '';
      box.innerHTML = '<span>已選好：<b>' + esc(name) + '</b></span>' +
        '<button type="button" class="rs-link rs-clear">換一個</button>';
      box.querySelector('.rs-clear').addEventListener('click', function () {
        S.file = null; S.fileName = ''; S.submitted = null; box.hidden = true;
        if (S.method === 'upload') { S.method = ''; setMethod('', true); }
      });
    }

    // ── LINE ──
    function lineBox() {
      var box = $('.rs-linebox');
      if (!S.code) { box.innerHTML = '<p class="rs-status">準備中⋯</p>'; return; }
      box.innerHTML =
        '<a class="rs-linego" href="' + esc(S.lineUrl) + '" target="_blank" rel="noopener">' + IC.line.replace('<svg', '<svg width="22" height="22"') +
        '<span>打開 LINE，送出「我要傳履歷 <span class="rs-code">#' + esc(S.code) + '</span>」</span></a>' +
        '<p><b>送出這句，再把履歷檔或照片傳過來就好。</b>多頁的話一張一張傳。</p>' +
        '<p class="rs-status' + (S.received ? ' ok' : '') + '" aria-live="polite">' +
        (S.received ? '已經收到你從 LINE 傳來的履歷了。'
          : '還沒收到——可以先繼續填表、做測驗，跟阿財面談前傳到就好。') + '</p>';
      box.querySelector('.rs-linego').addEventListener('click', function () { track('resume_line_open', {}); });
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
      if (!S.code || S.received || S.method !== 'line') return;
      pollT = setTimeout(function () {
        if (document.hidden) return poll();
        fetch(API + '/apply/resume-code/' + encodeURIComponent(S.code))
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (d && d.ok && d.received && !S.received) { S.received = true; track('resume_line_received', {}); lineBox(); onChange(); }
          })
          .catch(function () {})
          .then(function () { poll(); });
      }, delay || 6000);
    }
    document.addEventListener('visibilitychange', function () { if (!document.hidden && S.method === 'line') poll(); });
    $('.rs-line').addEventListener('click', function () { setMethod('line'); });
    $('.rs-quick').addEventListener('click', function () {
      setMethod('quick');
      var first = $('#rsq-company'); if (first && !first.value) first.focus();
    });
    root.querySelectorAll('.rs-link[data-x]').forEach(function (b) {
      b.addEventListener('click', function () {
        setMethod(b.getAttribute('data-x'));
        var el = b.getAttribute('data-x') === 'paste' ? $('#rs-paste') : $('#rs-url');
        if (el) el.focus();
      });
    });
    root.addEventListener('input', function () { onChange(); });

    function quickVals() {
      var o = {};
      root.querySelectorAll('[data-q]').forEach(function (el) { o[el.getAttribute('data-q')] = el.value.trim(); });
      return o;
    }

    return {
      method: function () { return S.method; },
      code: function () { return S.code; },
      // 「這一步算完成了嗎」：給 GA 的分段事件用，不顯示錯誤
      isDone: function () { return this.validate().ok; },
      validate: function () {
        if (S.submitted) return { ok: true };
        var m = S.method;
        if (!m) return { ok: false, field: 'resume', el: $('.rs-photo'),
          message: '請選一種方式交履歷：拍照上傳、用 LINE 傳，或填 1 分鐘快速履歷' };
        if (m === 'upload' && !S.file) return { ok: false, field: 'resume_file', el: $('.rs-photo'), message: '還沒選到檔案，請再按一次「拍照／截圖上傳」' };
        if (m === 'line' && !S.code) return { ok: false, field: 'resume_line', el: $('.rs-line'), message: 'LINE 代碼還沒拿到，請檢查網路後再按一次「我用 LINE 傳」' };
        if (m === 'quick') {
          var q = quickVals(), miss = ['company', 'title', 'years', 'duty', 'edu'].filter(function (k) { return !q[k]; });
          if (miss.length) return { ok: false, field: 'quick_' + miss[0], el: $('[data-q=' + miss[0] + ']'), message: '快速履歷還有 ' + miss.length + ' 格沒填' };
        }
        if (m === 'paste' && $('#rs-paste').value.trim().length < 30) return { ok: false, field: 'resume_paste', el: $('#rs-paste'), message: '貼上的內容太短了，至少要有最近一份工作的公司、職稱和做過的事' };
        if (m === 'url') {
          var u = $('#rs-url').value.trim();
          if (!u) return { ok: false, field: 'resume_url', el: $('#rs-url'), message: '請貼上雲端連結，或改用其他方式' };
          if (/drive\.google\.com\/drive\/folders\//i.test(u)) return { ok: false, field: 'resume_url', el: $('#rs-url'), message: '這是「資料夾」連結，系統讀不到裡面的履歷。請改貼單一檔案的分享連結，或直接上傳' };
        }
        return { ok: true };
      },
      urlToCheck: function () { return S.method === 'url' ? $('#rs-url').value.trim() : ''; },
      payload: function () {
        var m = S.method, o = { resume_method: m || null };
        if (m === 'upload' && S.file) {
          if (S.file.size > MAX) return Promise.reject(new Error('履歷檔超過 8MB，可以改用「我用 LINE 傳」'));
          return readB64(S.file).then(function (b64) {
            o.resume_b64 = b64; o.resume_name = S.file.name; o.resume_mime = S.file.type; return o;
          });
        }
        if (m === 'line') o.resume_code = S.code;
        if (m === 'quick') o.quick_resume = quickVals();
        if (m === 'paste') o.resume_text = $('#rs-paste').value.trim();
        if (m === 'url') o.resume_url = $('#rs-url').value.trim();
        return Promise.resolve(o);
      },
      getState: function () {
        return { method: S.method, code: S.code, line_url: S.lineUrl, received: S.received,
          file_name: S.file ? S.fileName : (S.submitted && S.submitted.file_name) || '',
          quick: quickVals(), paste: $('#rs-paste').value, url: $('#rs-url').value };
      },
      // submitted=true：測驗做完回來，履歷已經在第一次送出時存進資料庫了，不用重選
      setState: function (s, submitted) {
        if (!s) return;
        S.code = s.code || ''; S.lineUrl = s.line_url || ''; S.received = !!s.received;
        var q = s.quick || {};
        root.querySelectorAll('[data-q]').forEach(function (el) { if (q[el.getAttribute('data-q')]) el.value = q[el.getAttribute('data-q')]; });
        if (s.paste) $('#rs-paste').value = s.paste;
        if (s.url) $('#rs-url').value = s.url;
        if (submitted && s.method === 'upload' && s.file_name) {
          S.submitted = { file_name: s.file_name };
          showPicked(s.file_name + '（已上傳，不用重選）');
        }
        if (s.method && (s.method !== 'upload' || S.submitted)) setMethod(s.method, true);
      },
      focusError: function (v) {
        if (v && v.el) {
          v.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          try { v.el.focus({ preventScroll: true }); } catch (e) { /* 舊瀏覽器 */ }
        }
      }
    };
  }

  window.S1Resume = { mount: mount, YEARS: YEARS, EDU: EDU };
})();
