// 2026-10-30 Jacky：文件書櫃（示意 v2 核准後做進正式後台）。
// ①公司範本：合約／公司簡介／客戶給的範本，每一層一本「使用中」（金色書籤）＝系統寄信自動附這本；舊版留著查。
// ②客戶文件櫃：左邊選客戶、上方 7 個合作階段，點階段列出文件。手動上傳的放 client_files，
//   其餘（開發信附件、推薦報告、人事資料表、offer、發票／匯款證明）後端自動帶出，不用重複上傳。
import { api } from './core/api.js';
import { toast, loading, errorState, drawer, closeOverlay } from './core/ui.js';
import { escapeHtml } from './core/security.js';
import { fileButtons, wireFileButtons } from './filepreview.js';

const esc = escapeHtml;
const STAGES = ['開發', '簽約', '職缺需求', '推薦', '面試前', '錄取到職', '請款'];
const LAYERS = [
  { k: 'contract', name: '招募委任合約書', color: 'var(--lib-contract)' },
  { k: 'profile', name: '公司簡介', color: 'var(--lib-profile)' },
  { k: 'client_tpl', name: '客戶給的範本', color: 'var(--lib-client)' },
];
const ui = { tab: 'lib', book: null, co: null, stage: null };
let books = [];
let companies = [];
let docs = [];
let root = null;
const me = () => (document.querySelector('[data-me-global]') || {}).value || '';
const fpath = (id) => `/admin/file/${encodeURIComponent(id)}`;
const day = (s) => String(s || '').slice(0, 10).replace(/-/g, '/');

export async function loadLibraryTab(target) {
  root = target;
  root.innerHTML = loading('書櫃整理中');
  try {
    const [lib, cos] = await Promise.all([api.get('/admin/library'), api.get('/admin/portal/companies')]);
    books = lib.books || [];
    companies = (cos.items || cos.companies || []).filter((c) => c && c.id && !/測試/.test(c.display_name || ''));
    if (!ui.book && books.length) ui.book = (books.find((b) => b.is_active && b.layer === 'contract') || books[0]).id;
    if (!ui.co && companies.length) ui.co = companies[0].id;
    render();
    if (ui.tab === 'cab') await loadDocs();
  } catch (e) { root.innerHTML = errorState(e, 'refresh'); }
}

function render() {
  root.innerHTML = `<div class="lib-wrap">
    <div class="lib-seg" role="tablist" aria-label="書櫃分頁">
      <button type="button" role="tab" aria-selected="${ui.tab === 'lib'}" data-lib-tab="lib">公司範本</button>
      <button type="button" role="tab" aria-selected="${ui.tab === 'cab'}" data-lib-tab="cab">客戶文件櫃</button>
    </div>
    ${ui.tab === 'lib' ? libHtml() : cabHtml()}
  </div>`;
  wire();
}

// ── 公司範本 ─────────────────────────────
function libHtml() {
  return `<div class="lib-legend"><span><b style="background:var(--lib-contract)"></b>合約</span><span><b style="background:var(--lib-profile)"></b>公司簡介</span><span><b style="background:var(--lib-client)"></b>客戶給的範本／客戶專用</span><span><b style="background:var(--lib-old)"></b>舊版（留著查）</span><span><b style="background:var(--lib-ribbon)"></b>書籤＝使用中（系統寄信自動附這本）</span></div>
  <div class="lib-shelves">${LAYERS.map((L) => {
    const xs = books.filter((b) => b.layer === L.k);
    return `<section class="lib-shelf"><h2><i style="background:${L.color}"></i>${esc(L.name)}<span class="lib-pill">${xs.length} 本</span></h2>
      <div class="lib-row">${xs.map((b) => {
        const color = b.company_id && L.k !== 'client_tpl' ? 'var(--lib-client)' : L.color;
        const old = !b.is_active && !b.company_id;
        return `<button type="button" class="lib-book${old ? ' old' : ''}" style="background:${color};height:${b.is_active ? 178 : 162}px" aria-pressed="${b.id === ui.book}" data-book="${esc(b.id)}" aria-label="${esc(b.title)}${b.is_active ? '（使用中）' : old ? '（舊版）' : ''}">${b.is_active ? '<i class="rib"></i>' : ''}<span class="t">${esc(b.short || b.title.slice(0, 6))}</span><span class="y">${esc(String(b.uploaded_at || '').slice(5, 10).replace('-', '/'))}</span></button>`;
      }).join('')}<button type="button" class="lib-book add" data-lib-up="${L.k}" aria-label="上傳新版本到${esc(L.name)}"><span class="t">＋ 新版本</span></button></div><div class="lib-board"></div></section>`;
  }).join('')}</div>
  </div>${books.length ? '' : '<p class="muted">書櫃還是空的，按「＋ 新版本」放第一本。</p>'}`;
}
function detailHtml(b) {
  const L = LAYERS.find((x) => x.k === b.layer) || {};
  const same = books.filter((x) => x.layer === b.layer && (b.layer !== 'client_tpl' || (x.company_id === b.company_id && x.short === b.short)));
  const tag = b.is_active ? '<span class="lib-pill on">📌 使用中</span>' : b.company_id && b.layer !== 'client_tpl' ? '<span class="lib-pill cl">客戶專用</span>' : '<span class="lib-pill">舊版</span>';
  return `<div class="lib-dr">${tag} <span class="lib-pill">${esc(L.name || '')}</span>${b.company_name ? ` <span class="lib-pill">${esc(b.company_name)}</span>` : ''}</div>
    <p class="muted">${esc(day(b.uploaded_at))}${b.uploaded_by ? `・${esc(b.uploaded_by)} 上傳` : ''}${b.note ? `<br>${esc(b.note)}` : ''}</p>
    <div class="lib-acts">${fileButtons(fpath(b.file_id), b.filename || `${b.title}.pdf`)}${b.is_active ? '' : `<button type="button" class="btn sm" data-lib-activate="${esc(b.id)}">設成使用中</button>`}</div>
    ${same.length > 1 ? `<div class="lib-vers"><b>同一層的版本</b>${same.map((x) => `<button type="button" data-book="${esc(x.id)}" class="${x.id === b.id ? 'cur' : ''}"><span>${esc(day(x.uploaded_at))}</span><span>${esc(x.short || x.title)}${x.is_active ? '・使用中' : ''}</span></button>`).join('')}</div>` : ''}</div>`;
}
// 2026-10-30 Jacky：點書要從右邊抽屜打開，不要顯示在書架下面
function openBook(id) {
  const b = books.find((x) => x.id === id);
  if (!b) return;
  ui.book = id;
  root.querySelectorAll('[data-book]').forEach((x) => x.setAttribute('aria-pressed', x.dataset.book === id));
  drawer({ title: b.title, subtitle: (LAYERS.find((x) => x.k === b.layer) || {}).name || '', body: detailHtml(b) });
  const box = document.getElementById('overlay-root');
  box.querySelectorAll('[data-book]').forEach((x) => x.onclick = () => openBook(x.dataset.book));
  box.querySelectorAll('[data-lib-activate]').forEach((x) => x.onclick = async () => {
    x.disabled = true;
    try { await api.post(`/admin/library/${encodeURIComponent(x.dataset.libActivate)}/activate`, {}); toast('已設成使用中，之後系統寄信改附這本', 'success'); closeOverlay(); await loadLibraryTab(root); }
    catch (e) { toast(e.message, 'error'); x.disabled = false; }
  });
  wireFileButtons(box);
}

// ── 客戶文件櫃 ─────────────────────────────
function cabHtml() {
  const co = companies.find((c) => c.id === ui.co);
  const by = Object.fromEntries(STAGES.map((s) => [s, docs.filter((d) => d.stage === s)]));
  if (!ui.stage) ui.stage = [...STAGES].reverse().find((s) => by[s].length) || STAGES[0];
  const xs = by[ui.stage] || [];
  return `<div class="lib-cab">
    <nav class="lib-clients" aria-label="客戶">${companies.map((c) => `<button type="button" aria-current="${c.id === ui.co}" data-lib-co="${esc(c.id)}"><span>${esc(c.display_name)}<small>${esc(c.relation === 'signed' ? '已簽約' : c.relation === 'private' ? '私人協助' : '未簽約')}</small></span></button>`).join('')}</nav>
    <div class="lib-main">
      <label class="lib-mcli"><span class="sr-only">選客戶</span><select data-lib-co-sel>${companies.map((c) => `<option value="${esc(c.id)}" ${c.id === ui.co ? 'selected' : ''}>${esc(c.display_name)}</option>`).join('')}</select></label>
      <div class="lib-steps" role="tablist" aria-label="合作階段">${STAGES.map((s) => `<button type="button" role="tab" class="lib-step${by[s].length ? ' has' : ''}" aria-selected="${s === ui.stage}" data-lib-stage="${s}"><i>${by[s].length}</i><span>${s}</span></button>`).join('')}</div>
      <div class="lib-list"><div class="lib-lh"><b>${esc(co ? co.display_name : '')}｜${esc(ui.stage)}</b><button type="button" class="btn primary sm" data-lib-up="cab">＋ 上傳到「${esc(ui.stage)}」</button></div>
        ${xs.length ? xs.map((d) => `<div class="lib-item"><span class="lib-ic">${esc(((d.filename || '').split('.').pop() || 'PDF').slice(0, 4).toUpperCase())}</span><div><b>${esc(d.title)}</b><small>${esc([day(d.at), d.source, d.by, d.note].filter(Boolean).join('・'))}</small></div><div class="lib-acts">${d.file_id ? fileButtons(fpath(d.file_id), d.filename || d.title) : ''}</div></div>`).join('')
          : '<div class="lib-none">這個階段還沒有文件</div>'}
      </div>
    </div></div>`;
}
async function loadDocs(keepStage = false) {
  if (!ui.co) return;
  if (!keepStage) ui.stage = null;
  const box = root.querySelector('.lib-list');
  if (box) box.innerHTML = loading('讀取文件');
  try { docs = (await api.get(`/admin/client-docs?company_id=${encodeURIComponent(ui.co)}`)).docs || []; }
  catch (e) { docs = []; toast(`讀不到這家的文件：${e.message}`, 'error'); }
  render();
}

// ── 上傳 ─────────────────────────────
function openUpload(mode) {
  const cab = mode === 'cab';
  const layer = cab ? null : mode;
  const ov = document.createElement('div');
  ov.className = 'lib-sheet';
  ov.innerHTML = `<form class="lib-box" role="dialog" aria-modal="true" aria-label="上傳">
    <h3>${cab ? '上傳到客戶文件櫃' : '上傳新版本到公司範本'}</h3>
    <label class="lib-f">檔案（PDF、Word、圖片，8MB 內）<input type="file" name="file" required></label>
    ${cab ? `<label class="lib-f">哪一家客戶<select name="co">${companies.map((c) => `<option value="${esc(c.id)}" ${c.id === ui.co ? 'selected' : ''}>${esc(c.display_name)}</option>`).join('')}</select></label>
      <div class="lib-f">放在哪一個階段<div class="lib-chips">${STAGES.map((s) => `<button type="button" aria-pressed="${s === ui.stage}" data-chip-stage="${s}">${s}</button>`).join('')}</div></div>`
    : `<div class="lib-f">放在哪一層書架<div class="lib-chips">${LAYERS.map((L) => `<button type="button" aria-pressed="${L.k === layer}" data-chip-layer="${L.k}">${esc(L.name)}</button>`).join('')}</div></div>
      <label class="lib-f" data-tplco ${layer === 'client_tpl' ? '' : 'hidden'}>哪一家客戶的範本<select name="tplco">${companies.map((c) => `<option value="${esc(c.id)}">${esc(c.display_name)}</option>`).join('')}</select></label>
      <label class="lib-f" data-tplstage ${layer === 'client_tpl' ? '' : 'hidden'}>在客戶文件櫃顯示在哪個階段<select name="stage_hint">${STAGES.map((s) => `<option ${s === '面試前' ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      <label class="lib-f">書背上的短名（6 字內，例：公版合約）<input name="short" maxlength="6"></label>
      <label class="lib-chk"><input type="checkbox" name="active" checked>設成「使用中」（舊的自動變舊版，系統寄信改附這本）</label>`}
    <label class="lib-f">文件名稱<input name="title" required placeholder="${cab ? '例：合約正本（客戶用印回傳）' : '例：招募委任合約書（正職代招）'}"></label>
    <label class="lib-f">備註（選填）<input name="note"></label>
    <div class="lib-acts"><button type="submit" class="btn primary">上傳</button><button type="button" class="btn" data-x>取消</button></div>
  </form>`;
  document.body.append(ov);
  const f = ov.querySelector('form');
  const close = () => ov.remove();
  ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('[data-x]')) close(); });
  ov.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  ov.querySelectorAll('[data-chip-stage],[data-chip-layer]').forEach((b) => b.onclick = () => {
    const attr = b.dataset.chipStage ? 'data-chip-stage' : 'data-chip-layer';
    ov.querySelectorAll(`[${attr}]`).forEach((x) => x.setAttribute('aria-pressed', x === b));
    if (b.dataset.chipLayer) { ov.querySelector('[data-tplco]').hidden = b.dataset.chipLayer !== 'client_tpl'; ov.querySelector('[data-tplstage]').hidden = b.dataset.chipLayer !== 'client_tpl'; }
  });
  f.file.onchange = () => { if (!f.title.value && f.file.files[0]) f.title.value = f.file.files[0].name.replace(/\.[^.]+$/, ''); };
  f.file.focus();
  f.onsubmit = async (e) => {
    e.preventDefault();
    const file = f.file.files[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { toast('檔案超過 8MB，請壓縮後再上傳', 'error'); return; }
    const btn = f.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = '上傳中…';
    const b64 = await new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = bad; r.readAsDataURL(file); });
    const base = { file_b64: b64, file_name: file.name, file_mime: file.type || 'application/octet-stream', title: f.title.value.trim(), note: f.note.value.trim(), by: me() };
    try {
      if (cab) {
        const stage = (ov.querySelector('[data-chip-stage][aria-pressed=true]') || {}).dataset?.chipStage;
        await api.post('/admin/client-docs/upload', { ...base, company_id: f.co.value, stage });
        ui.co = f.co.value; ui.stage = stage; close(); toast('已放進客戶文件櫃', 'success'); await loadDocs(true);
      } else {
        const ly = (ov.querySelector('[data-chip-layer][aria-pressed=true]') || {}).dataset?.chipLayer;
        const r = await api.post('/admin/library/upload', { ...base, layer: ly, short: f.short.value.trim(), set_active: f.active.checked,
          company_id: ly === 'client_tpl' ? f.tplco.value : undefined, stage_hint: ly === 'client_tpl' ? f.stage_hint.value : undefined });
        ui.book = r.id; close(); toast('已放上書架', 'success'); await loadLibraryTab(root);
      }
    } catch (err) { toast(err.message || '上傳失敗', 'error'); btn.disabled = false; btn.textContent = '上傳'; }
  };
}

function wire() {
  root.querySelectorAll('[data-lib-tab]').forEach((b) => b.onclick = async () => { ui.tab = b.dataset.libTab; render(); if (ui.tab === 'cab') await loadDocs(); });
  root.querySelectorAll('[data-book]').forEach((b) => b.onclick = () => openBook(b.dataset.book));
  root.querySelectorAll('[data-lib-up]').forEach((b) => b.onclick = () => openUpload(b.dataset.libUp));
  root.querySelectorAll('[data-lib-activate]').forEach((b) => b.onclick = async () => {
    b.disabled = true;
    try { await api.post(`/admin/library/${encodeURIComponent(b.dataset.libActivate)}/activate`, {}); toast('已設成使用中，之後系統寄信改附這本', 'success'); await loadLibraryTab(root); }
    catch (e) { toast(e.message, 'error'); b.disabled = false; }
  });
  root.querySelectorAll('[data-lib-co]').forEach((b) => b.onclick = async () => { ui.co = b.dataset.libCo; ui.stage = null; await loadDocs(); });
  const sel = root.querySelector('[data-lib-co-sel]');
  if (sel) sel.onchange = async () => { ui.co = sel.value; ui.stage = null; await loadDocs(); };
  root.querySelectorAll('[data-lib-stage]').forEach((b) => b.onclick = () => { ui.stage = b.dataset.libStage; render(); });
  wireFileButtons(root);
}
