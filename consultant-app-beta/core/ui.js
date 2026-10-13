import { escapeHtml } from './security.js';

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export function toast(message, tone = 'info') {
  const node = document.createElement('div');
  node.className = `toast ${tone}`;
  node.textContent = message;
  $('#toast-root').append(node);
  setTimeout(() => node.remove(), 4200);
}

export function loading(label = '資料載入中') {
  return `<div class="state loading"><span class="spinner"></span><div>${escapeHtml(label)}</div></div>`;
}

export function empty(title, action = '') {
  return `<div class="state"><strong>${escapeHtml(title)}</strong>${action ? `<p>${escapeHtml(action)}</p>` : ''}</div>`;
}

export function errorState(error, retryAction = '') {
  const detail = error?.name === 'ReferenceError' ? `前端執行錯誤：${error.message}` : (error?.message || '無法載入資料');
  return `<div class="state error"><strong>目前無法顯示</strong><p>${escapeHtml(detail)}</p>${retryAction ? `<button class="btn" data-action="${retryAction}">重新載入</button>` : ''}</div>`;
}

export function developmentState(description) {
  return `<div class="state development"><span class="dev-mark">API</span><strong>資料端點待接</strong><p>${escapeHtml(description)}</p></div>`;
}

export function modal({ title, subtitle = '', body, footer = '', dangerous = false }) {
  const root = $('#overlay-root');
  root.innerHTML = `<div class="mask" data-close-overlay></div><section class="modal ${dangerous ? 'dangerous' : ''}" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}"><header><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(subtitle)}</p></div><button class="icon-btn" data-close-overlay aria-label="關閉">×</button></header><div class="modal-body">${body}</div><footer>${footer}</footer></section>`;
  $('[data-close-overlay]', root)?.focus();
}

export function drawer({ title, subtitle = '', body }) {
  const root = $('#overlay-root');
  root.innerHTML = `<div class="mask" data-close-overlay></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}"><header><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(subtitle)}</p></div><button class="icon-btn" data-close-overlay aria-label="關閉">×</button></header><div class="drawer-body">${body}</div></aside>`;
}

export function closeOverlay() { $('#overlay-root').innerHTML = ''; }

// 2026-09-18 加（Phase 1.1 v1.1：整理履歷／AI 面談／查看佐證）——這三個是在
// 候選人主抽屜「之上」再開一層，不能用 drawer()／modal()，那兩支都是覆蓋
// #overlay-root，會直接把候選人主抽屜的內容整個換掉。獨立用 #sub-overlay-root
// 疊一層更高的 z-index，關掉這層時主抽屜的內容完全不受影響。
export function openSubDrawer({ title, subtitle = '', body }) {
  const root = $('#sub-overlay-root');
  root.innerHTML = `<div class="mask sub-mask" data-close-sub></div><aside class="drawer sub-drawer" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}"><header><div><h2>${escapeHtml(title)}</h2>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}</div><button class="icon-btn" data-close-sub aria-label="關閉">×</button></header><div class="drawer-body">${body}</div></aside>`;
}
export function closeSubDrawer() { $('#sub-overlay-root').innerHTML = ''; }

export function formFields(fields, values = {}) {
  if (!fields.length) return '';
  return `<div class="form-grid">${fields.map((f) => {
    const raw = values[f.name];
    const val = raw === undefined || raw === null ? (f.value ?? '') : raw;
    const req = f.required ? 'required' : '';
    if (f.type === 'select') return `<label class="field ${f.wide ? 'span-2' : ''}"><span>${escapeHtml(f.label)}</span><select name="${escapeHtml(f.name)}" ${req}>${(f.options || []).map((o) => `<option value="${escapeHtml(o.value)}" ${String(val) === String(o.value) ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}</select></label>`;
    if (f.type === 'textarea') return `<label class="field span-2"><span>${escapeHtml(f.label)}</span><textarea name="${escapeHtml(f.name)}" rows="${f.rows || 4}" ${req}>${escapeHtml(val)}</textarea></label>`;
    // 2026-09-17 加：檔案上傳欄位（電洽逐字稿檔案用）——只負責畫 input，實際
    // 讀成 base64 在 app.js 的 submitPendingAction 另外處理，這裡不碰 FileReader。
    if (f.type === 'file') return `<label class="field span-2"><span>${escapeHtml(f.label)}</span><input type="file" name="${escapeHtml(f.name)}" ${f.accept ? `accept="${escapeHtml(f.accept)}"` : ''} ${req}></label>`;
    return `<label class="field ${f.wide ? 'span-2' : ''}"><span>${escapeHtml(f.label)}</span><input ${f.type === 'date' ? 'type="date" ' : ''}name="${escapeHtml(f.name)}" value="${escapeHtml(val)}" ${req}></label>`;
  }).join('')}</div>`;
}

export async function boundary(target, task, render, retryAction = '') {
  target.innerHTML = loading();
  try { target.innerHTML = render(await task()); }
  catch (error) {
    console.error(error);
    target.innerHTML = errorState(error, retryAction);
  }
}
