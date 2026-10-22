// 2026-10-22 Jacky：寄出去的合約／附件要能「在網頁上直接看」＋「下載」。
// 安全：檔案一律用 fetch 帶後台登入（Authorization header）取回，不做公開連結、權杖不進網址。
//   PDF／圖片：瀏覽器自己顯示；Word（.docx）：mammoth 轉成網頁；Excel（.xlsx/.xls/.csv）：SheetJS 轉成表格；
//   轉出來的內容放進 sandbox iframe（不准跑任何程式）。舊版 .doc、其他格式：顯示「請下載查看」。
import { CONFIG } from './config.js';
import { toast } from './core/ui.js';
import { escapeHtml } from './core/security.js';
import { previewKind, blobType } from './filekind.js';

const LIBS = {
  docx: { src: 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js', global: 'mammoth' },
  sheet: { src: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', global: 'XLSX' },
};
const loaded = {};
function loadLib(kind) {
  const lib = LIBS[kind];
  if (window[lib.global]) return Promise.resolve(window[lib.global]);
  if (!loaded[kind]) {
    loaded[kind] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = lib.src; s.async = true; s.crossOrigin = 'anonymous'; s.referrerPolicy = 'no-referrer';
      s.onload = () => (window[lib.global] ? resolve(window[lib.global]) : reject(new Error('轉檔工具載入失敗')));
      s.onerror = () => { loaded[kind] = null; reject(new Error('轉檔工具載入失敗（網路問題），請改按下載')); };
      document.head.appendChild(s);
    });
  }
  return loaded[kind];
}

// path：後台 API 路徑（/admin/file/<id> 或 /admin/mail-archive/file/<id>）；headers：額外標頭（例如私人鑰匙）
export async function fetchFile(path, headers = {}) {
  const res = await fetch(`${CONFIG.apiBase}${path}`, {
    headers: { authorization: `Bearer ${localStorage.getItem(CONFIG.tokenKey) || ''}`, ...headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || `檔案讀不到（HTTP ${res.status}）`);
  }
  return { blob: await res.blob(), mime: (res.headers.get('content-type') || '').split(';')[0] };
}

export async function downloadFile(path, name, headers = {}) {
  try {
    const { blob } = await fetchFile(path, headers);
    saveBlob(blob, name);
  } catch (e) { toast(e.message || '下載失敗', 'error'); }
}

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name || '附件'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

const DOC_CSS = 'body{font-family:"Noto Sans TC",system-ui,sans-serif;color:#172033;line-height:1.7;padding:24px;max-width:860px;margin:auto;font-size:15px}'
  + 'table{border-collapse:collapse;margin:10px 0;max-width:100%}td,th{border:1px solid #cfd8e6;padding:6px 8px;vertical-align:top;font-size:13px}'
  + 'img{max-width:100%}h1,h2,h3{line-height:1.4}.sheet-name{margin:22px 0 6px;font-size:15px;color:#2867ed}';

function closePreview() {
  const el = document.getElementById('fp-root');
  if (!el) return;
  (el._urls || []).forEach((u) => URL.revokeObjectURL(u));
  const back = el._returnFocus;
  el.remove();
  document.removeEventListener('keydown', onKey);
  if (back && back.focus) back.focus();
}
function onKey(e) { if (e.key === 'Escape') closePreview(); }

export async function openFilePreview({ path, name, headers = {}, mime = '' }) {
  closePreview();
  const root = document.createElement('div');
  root.id = 'fp-root';
  root._urls = [];
  root._returnFocus = document.activeElement;
  root.innerHTML = `<div class="fp-mask" data-fp-close></div>
    <section class="fp-box" role="dialog" aria-modal="true" aria-label="${escapeHtml(`預覽：${name || '附件'}`)}">
      <header class="fp-head"><b class="fp-name" title="${escapeHtml(name || '')}">${escapeHtml(name || '附件')}</b>
        <span class="fp-acts"><button type="button" class="btn sm" data-fp-newtab hidden>新分頁開啟</button><button type="button" class="btn sm primary" data-fp-dl>下載</button><button type="button" class="btn sm" data-fp-close aria-label="關閉預覽">關閉</button></span></header>
      <div class="fp-body" data-fp-body><div class="state"><div class="spinner"></div><p>檔案讀取中…</p></div></div>
    </section>`;
  document.body.appendChild(root);
  document.addEventListener('keydown', onKey);
  root.querySelectorAll('[data-fp-close]').forEach((b) => { b.onclick = closePreview; });
  root.querySelector('button[data-fp-close]').focus();
  const body = root.querySelector('[data-fp-body]');
  let file;
  try { file = await fetchFile(path, headers); } catch (e) {
    body.innerHTML = `<div class="state error"><strong>檔案讀不到</strong><p>${escapeHtml(e.message || '')}</p></div>`;
    return;
  }
  if (!document.body.contains(root)) return;
  root.querySelector('[data-fp-dl]').onclick = () => saveBlob(file.blob, name);
  const kind = previewKind(name, mime || file.mime);
  const typed = new Blob([file.blob], { type: blobType(kind, mime || file.mime) });
  const frame = (srcdoc) => {
    const f = document.createElement('iframe');
    f.className = 'fp-frame'; f.title = `預覽：${name || '附件'}`;
    f.setAttribute('sandbox', ''); // 不准跑程式、不准開新視窗、不准送表單
    f.srcdoc = `<!doctype html><meta charset="utf-8"><style>${DOC_CSS}</style>${srcdoc}`;
    body.innerHTML = ''; body.appendChild(f);
  };
  try {
    if (kind === 'pdf' || kind === 'image') {
      const url = URL.createObjectURL(typed);
      root._urls.push(url);
      const nt = root.querySelector('[data-fp-newtab]');
      nt.hidden = false; nt.onclick = () => window.open(url, '_blank', 'noopener');
      body.innerHTML = kind === 'pdf'
        ? `<iframe class="fp-frame" src="${url}" title="${escapeHtml(`預覽：${name || 'PDF'}`)}"></iframe><p class="help fp-tip">手機上只看到第一頁的話，按上面「新分頁開啟」。</p>`
        : `<div class="fp-img"><img src="${url}" alt="${escapeHtml(name || '附件圖片')}"></div>`;
    } else if (kind === 'docx') {
      const mammoth = await loadLib('docx');
      const r = await mammoth.convertToHtml({ arrayBuffer: await file.blob.arrayBuffer() });
      frame(`<p style="color:#69758a;font-size:12px;margin:0 0 14px">這是 Word 檔轉成網頁的樣子，排版（頁首、字型、分頁）可能跟原檔不完全一樣；要看原樣請下載。</p>${r.value || '<p>（這份檔案沒有文字內容）</p>'}`);
    } else if (kind === 'sheet') {
      const XLSX = await loadLib('sheet');
      const wb = XLSX.read(await file.blob.arrayBuffer(), { type: 'array' });
      frame(wb.SheetNames.map((sn) => `<h2 class="sheet-name">${escapeHtml(sn)}</h2>${XLSX.utils.sheet_to_html(wb.Sheets[sn], { header: '', footer: '' })}`).join('') || '<p>（空的試算表）</p>');
    } else if (kind === 'text') {
      frame(`<pre style="white-space:pre-wrap">${escapeHtml(await file.blob.text())}</pre>`);
    } else {
      body.innerHTML = `<div class="state"><strong>這種檔案不能在網頁上直接看</strong><p>${escapeHtml(name || '')}</p><p>請按右上角「下載」，用電腦上的軟體打開。</p></div>`;
    }
  } catch (e) {
    body.innerHTML = `<div class="state error"><strong>預覽失敗</strong><p>${escapeHtml(e.message || '')}</p><p>請按右上角「下載」查看。</p></div>`;
  }
}

// 附件按鈕一組：預覽＋下載。data-fp-path 放 API 路徑，data-fp-private="1" 表示要帶私人鑰匙（呼叫端處理）
export function fileButtons(path, name, extraAttrs = '') {
  return `<span class="fp-btns"><button type="button" class="btn sm" data-fp-preview="${escapeHtml(path)}" data-fp-name="${escapeHtml(name || '附件')}" ${extraAttrs}>預覽</button><button type="button" class="btn sm ghost" data-fp-download="${escapeHtml(path)}" data-fp-name="${escapeHtml(name || '附件')}" ${extraAttrs}>下載</button></span>`;
}

export function wireFileButtons(root, headersFn = () => ({})) {
  root.querySelectorAll('[data-fp-preview]').forEach((b) => {
    b.onclick = () => openFilePreview({ path: b.dataset.fpPreview, name: b.dataset.fpName, headers: headersFn(b) });
  });
  root.querySelectorAll('[data-fp-download]').forEach((b) => {
    b.onclick = () => downloadFile(b.dataset.fpDownload, b.dataset.fpName, headersFn(b));
  });
}
