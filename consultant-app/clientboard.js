// 2026-11-02 Jacky：主力客戶狀態總表（唯一真相）。
// Jacky、Phoebe、各台 Claude（consultant_ops.py clients／kb）都讀同一張 client_board。
// 每家一張卡：合約、窗口、找人中的職缺（客戶確認了沒＋確認來源／日期）、已拿掉／暫停、管道限制、下一步。
// 改任何一欄都會逐欄留紀錄（誰、何時、從什麼改成什麼）——後端 client_board.js。
import { api } from './core/api.js';
import { toast, loading, errorState, drawer, closeOverlay } from './core/ui.js';
import { escapeHtml } from './core/security.js';

const esc = escapeHtml;
const FIELD_LABEL = {
  create: '新增客戶', name: '客戶名', company_id: '對應客戶帳號', aliases: '別名', contract: '合約', contacts: '窗口',
  channel_rules: '管道限制', next_step: '下一步', note: '備註', sort: '排序', archived: '封存',
  jobs: '找人中的職缺', removed: '已拿掉／暫停',
};
let root = null;
let items = [];
let showArchived = false;
let draft = null;   // 抽屜裡正在改的那一家（jobs／removed 是複本）
const me = () => (document.querySelector('[data-me-global]') || {}).value || '';
const today = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const day = (s) => String(s || '').slice(0, 16).replace('T', ' ');

export async function loadClientBoardTab(target) {
  root = target;
  root.innerHTML = loading('客戶總表讀取中');
  try {
    const r = await api.get('/admin/client-board');
    items = r.items || [];
    render();
  } catch (e) { root.innerHTML = errorState(e, 'refresh'); }
}

function jobLine(j) {
  const mark = j.confirmed ? '<span class="badge success">客戶確認</span>' : '<span class="badge warning">客戶未確認・先不要找人</span>';
  return `<li><div class="cb-jt"><b>${esc(j.title)}</b>${mark}${j.date ? `<span class="muted">${esc(j.date)}</span>` : ''}</div>
    ${j.note ? `<div class="cb-sub">${esc(j.note)}</div>` : ''}${j.source ? `<div class="cb-sub">確認來源：${esc(j.source)}</div>` : ''}</li>`;
}
function removedLine(j) {
  return `<li><div class="cb-jt"><s>${esc(j.title)}</s><span class="badge danger">${j.status === 'paused' ? '暫停' : '已拿掉'}</span><span class="muted">${esc(j.by || '')} ${esc(j.date || '')}</span></div>${j.reason ? `<div class="cb-sub">${esc(j.reason)}</div>` : ''}</li>`;
}
function cardHtml(r) {
  const lc = r.last_change;
  return `<article class="card cb-card${r.archived ? ' cb-arch' : ''}">
    <header class="cb-head"><h2>${esc(r.name)}${r.archived ? ' <span class="badge">已封存</span>' : ''}</h2>
      <div class="cb-acts"><button type="button" class="btn sm" data-cb-log="${esc(r.id)}">修改紀錄</button><button type="button" class="btn primary sm" data-cb-edit="${esc(r.id)}">編輯</button></div></header>
    <dl class="cb-dl">
      <div><dt>合約</dt><dd class="cb-pre">${esc(r.contract || '—')}</dd></div>
      <div><dt>窗口</dt><dd class="cb-pre">${esc(r.contacts || '—')}</dd></div>
      <div class="cb-wide"><dt>找人中的職缺</dt><dd>${r.jobs.length ? `<ul class="cb-jobs">${r.jobs.map(jobLine).join('')}</ul>` : '<span class="muted">無（需求未確認，先不要找人）</span>'}</dd></div>
      ${r.removed.length ? `<div class="cb-wide cb-removed"><dt>已拿掉／暫停（不准再列、不准找人）</dt><dd><ul class="cb-jobs">${r.removed.map(removedLine).join('')}</ul></dd></div>` : ''}
      <div><dt>管道限制</dt><dd class="${r.channel_rules ? 'cb-rule' : ''}">${esc(r.channel_rules || '—')}</dd></div>
      <div><dt>下一步</dt><dd>${esc(r.next_step || '—')}</dd></div>
      ${r.note ? `<div class="cb-wide"><dt>備註</dt><dd class="cb-pre">${esc(r.note)}</dd></div>` : ''}
    </dl>
    <footer class="muted cb-foot">最後修改 ${esc(day(r.updated_at))}・${esc(r.updated_by || '')}${lc && lc.field ? `（${esc(FIELD_LABEL[lc.field] || lc.field)}）` : ''}</footer>
  </article>`;
}

function render() {
  const live = items.filter((r) => !r.archived);
  const arch = items.filter((r) => r.archived);
  root.innerHTML = `<div class="cb-wrap">
    <div class="notice cb-notice"><b>這份是唯一真相。</b>Jacky、Phoebe、AI 都讀這一份——AI 列客戶、排職缺、找人之前一定先讀它。
      「已拿掉／暫停」的職缺不准再列、不准找人；只有「客戶確認」的職缺才花時間找人。改任何一欄都會留紀錄。</div>
    <div class="cb-bar"><span class="muted">主力 ${live.length} 家${arch.length ? `・已封存 ${arch.length} 家` : ''}</span>
      ${arch.length ? `<button type="button" class="btn sm" data-cb-arch>${showArchived ? '收起已封存' : '看已封存'}</button>` : ''}
      <button type="button" class="btn primary sm" data-cb-new>＋ 新增客戶</button></div>
    <div class="cb-grid">${live.map(cardHtml).join('') || '<p class="muted">總表還是空的。</p>'}${showArchived ? arch.map(cardHtml).join('') : ''}</div>
  </div>`;
  root.querySelectorAll('[data-cb-edit]').forEach((b) => { b.onclick = () => openEdit(b.dataset.cbEdit); });
  root.querySelectorAll('[data-cb-log]').forEach((b) => { b.onclick = () => openLog(b.dataset.cbLog); });
  const ar = root.querySelector('[data-cb-arch]');
  if (ar) ar.onclick = () => { showArchived = !showArchived; render(); };
  root.querySelector('[data-cb-new]').onclick = openNew;
}

// ── 編輯抽屜 ─────────────────────────────
const TEXT_FIELDS = [
  ['name', '客戶名', 'input'], ['contract', '合約狀態', 'textarea'], ['contacts', '窗口', 'textarea'],
  ['channel_rules', '管道限制（例：不准 104，只 LinkedIn）', 'input'], ['next_step', '下一步', 'input'],
  ['note', '備註', 'textarea'], ['aliases', '別名（一行一個，AI 搜尋用）', 'textarea'],
];
function editBody() {
  const d = draft;
  const fld = ([k, label, kind]) => `<label class="field cb-span"><span>${esc(label)}</span>${kind === 'textarea'
    ? `<textarea rows="2" data-cb-f="${k}">${esc(d[k] || '')}</textarea>` : `<input data-cb-f="${k}" value="${esc(d[k] || '')}">`}</label>`;
  const jobRow = (j, i) => `<fieldset class="cb-jrow"><legend class="sr-only">職缺 ${i + 1}</legend>
      <label class="field"><span>職缺名稱</span><input data-cb-j="${i}" data-k="title" value="${esc(j.title)}"></label>
      <label class="cb-check"><input type="checkbox" data-cb-j="${i}" data-k="confirmed" ${j.confirmed ? 'checked' : ''}> 客戶親自確認過</label>
      <label class="field"><span>確認來源（哪封信／哪通電話）</span><input data-cb-j="${i}" data-k="source" value="${esc(j.source || '')}"></label>
      <label class="field"><span>確認日期</span><input type="date" data-cb-j="${i}" data-k="date" value="${esc(j.date || '')}"></label>
      <label class="field cb-span"><span>條件重點</span><input data-cb-j="${i}" data-k="note" value="${esc(j.note || '')}"></label>
      <div class="cb-span cb-racts"><button type="button" class="btn danger sm" data-cb-drop="${i}">拿掉這個職缺</button><button type="button" class="btn sm" data-cb-pause="${i}">暫停</button></div>
    </fieldset>`;
  const remRow = (j, i) => `<fieldset class="cb-jrow cb-rrow"><legend class="sr-only">已拿掉 ${i + 1}</legend>
      <label class="field"><span>職缺名稱</span><input data-cb-r="${i}" data-k="title" value="${esc(j.title)}"></label>
      <label class="field"><span>狀態</span><select data-cb-r="${i}" data-k="status"><option value="removed" ${j.status !== 'paused' ? 'selected' : ''}>已拿掉</option><option value="paused" ${j.status === 'paused' ? 'selected' : ''}>暫停</option></select></label>
      <label class="field"><span>誰拿掉的</span><input data-cb-r="${i}" data-k="by" value="${esc(j.by || '')}"></label>
      <label class="field"><span>日期</span><input type="date" data-cb-r="${i}" data-k="date" value="${esc(j.date || '')}"></label>
      <label class="field cb-span"><span>原因</span><input data-cb-r="${i}" data-k="reason" value="${esc(j.reason || '')}"></label>
      <div class="cb-span cb-racts"><button type="button" class="btn sm" data-cb-restore="${i}">恢復成找人中</button></div>
    </fieldset>`;
  return `<div class="cb-edit">
    <div class="form-grid">${TEXT_FIELDS.slice(0, 5).map(fld).join('')}</div>
    <h3>找人中的職缺</h3>${d.jobs.map(jobRow).join('') || '<p class="muted">目前沒有。</p>'}
    <button type="button" class="btn sm" data-cb-addjob>＋ 加一個職缺</button>
    <h3>已拿掉／暫停</h3>${d.removed.map(remRow).join('') || '<p class="muted">沒有。</p>'}
    <div class="form-grid">${TEXT_FIELDS.slice(5).map(fld).join('')}</div>
    ${d.id ? `<label class="cb-check"><input type="checkbox" data-cb-f="archived" ${d.archived ? 'checked' : ''}> 封存（不是主力了；不刪，留查）</label>` : ''}
    <div class="cb-save"><button type="button" class="btn primary" data-cb-save>${d.id ? '儲存修改' : '新增'}</button><span class="muted">會記下：${esc(me() || '（請先在最上方選「我是」）')}、現在時間、改了哪些欄</span></div>
  </div>`;
}
function readDraft() {
  const dr = document.querySelector('.cb-edit');
  if (!dr) return;
  dr.querySelectorAll('[data-cb-f]').forEach((el) => { draft[el.dataset.cbF] = el.type === 'checkbox' ? el.checked : el.value; });
  dr.querySelectorAll('[data-cb-j]').forEach((el) => { draft.jobs[+el.dataset.cbJ][el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value; });
  dr.querySelectorAll('[data-cb-r]').forEach((el) => { draft.removed[+el.dataset.cbR][el.dataset.k] = el.value; });
}
function paint() {
  drawer({ title: draft.id ? `編輯：${draft.name}` : '新增客戶', subtitle: '改完按最下面「儲存」；每一欄的修改都會留紀錄', body: editBody() });
  const dr = document.querySelector('.cb-edit');
  const on = (sel, fn) => dr.querySelectorAll(sel).forEach((b) => { b.onclick = () => { readDraft(); fn(b); paint(); }; });
  on('[data-cb-addjob]', () => draft.jobs.push({ title: '', confirmed: false, source: '', date: today(), note: '' }));
  const move = (b, status) => {
    const i = +(b.dataset.cbDrop ?? b.dataset.cbPause);
    const j = draft.jobs[i];
    const reason = window.prompt(`「${j.title || '這個職缺'}」${status === 'paused' ? '暫停' : '拿掉'}的原因？（會記在紀錄裡）`, '') ?? null;
    if (reason === null) return;
    draft.jobs.splice(i, 1);
    draft.removed.push({ title: j.title, status, by: me(), date: today(), reason });
  };
  on('[data-cb-drop]', (b) => move(b, 'removed'));
  on('[data-cb-pause]', (b) => move(b, 'paused'));
  on('[data-cb-restore]', (b) => {
    const j = draft.removed.splice(+b.dataset.cbRestore, 1)[0];
    draft.jobs.push({ title: j.title, confirmed: false, source: '', date: today(), note: '' });
  });
  dr.querySelector('[data-cb-save]').onclick = save;
}
function openEdit(id) {
  const r = items.find((x) => x.id === id);
  if (!r) return;
  draft = JSON.parse(JSON.stringify(r));
  paint();
}
function openNew() {
  draft = { id: null, name: '', contract: '', contacts: '', channel_rules: '', next_step: '', note: '', aliases: '', jobs: [], removed: [] };
  paint();
}
async function save() {
  readDraft();
  const by = me();
  if (!by) { toast('先在畫面最上方選「我是」，系統才記得是誰改的', 'error'); document.querySelector('[data-me-global]')?.focus(); return; }
  if (!String(draft.name || '').trim()) { toast('客戶名不能空白', 'error'); return; }
  const bad = draft.jobs.find((j) => j.confirmed && !String(j.source || '').trim());
  if (bad) { toast(`「${bad.title}」標成客戶確認，請填確認來源（哪封信／哪通電話）`, 'error'); return; }
  const fields = {};
  for (const [k] of TEXT_FIELDS) fields[k] = draft[k] || '';
  fields.jobs = draft.jobs.filter((j) => String(j.title || '').trim());
  fields.removed = draft.removed.filter((j) => String(j.title || '').trim());
  try {
    if (draft.id) {
      fields.archived = !!draft.archived;
      const r = await api.post(`/admin/client-board/${encodeURIComponent(draft.id)}`, { by, fields });
      toast(r.changed ? `已儲存（改了 ${r.changed} 欄）` : '沒有改到東西', 'success');
    } else {
      await api.post('/admin/client-board', { by, ...fields });
      toast('已新增', 'success');
    }
    closeOverlay();
    await loadClientBoardTab(root);
  } catch (e) { toast(e.message || '儲存失敗', 'error'); }
}

// ── 修改紀錄 ─────────────────────────────
function fmtVal(field, v) {
  if (v == null || v === '') return '（空）';
  if (field === 'jobs' || field === 'removed') {
    try { return JSON.parse(v).map((j) => j.title + (field === 'jobs' ? (j.confirmed ? '（客戶確認）' : '（未確認）') : `（${j.status === 'paused' ? '暫停' : '已拿掉'}）`)).join('、') || '（無）'; } catch { return v; }
  }
  return v;
}
async function openLog(id) {
  const r = items.find((x) => x.id === id);
  drawer({ title: `修改紀錄：${r ? r.name : ''}`, subtitle: '最新的在上面', body: loading() });
  try {
    const d = await api.get(`/admin/client-board/${encodeURIComponent(id)}/log`);
    const body = (d.items || []).map((x) => `<li><div class="cb-jt"><b>${esc(FIELD_LABEL[x.field] || x.field)}</b><span class="muted">${esc(day(x.changed_at))}・${esc(x.changed_by)}</span></div>
      ${x.field === 'create' ? '' : `<div class="cb-sub">原本：${esc(fmtVal(x.field, x.old_value))}</div><div class="cb-sub">改成：${esc(fmtVal(x.field, x.new_value))}</div>`}</li>`).join('');
    const el = document.querySelector('.drawer-body');
    if (el) el.innerHTML = body ? `<ul class="cb-jobs cb-log">${body}</ul>` : '<p class="muted">還沒有紀錄。</p>';
  } catch (e) { const el = document.querySelector('.drawer-body'); if (el) el.innerHTML = errorState(e); }
}
