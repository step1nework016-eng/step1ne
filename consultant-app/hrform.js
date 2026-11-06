// 人事資料表線上版：掛在人選卡片「客製表單」那一列底下。
// 只有 hr_form_enabled 開放的表單才會顯示；其他表單、API 掛掉都完全不影響卡片。
import { CONFIG } from './config.js';
import { escapeHtml as esc } from './core/security.js';

const API = 'https://step1ne-hrform-worker.aiagentg888.workers.dev/admin/api/';
const KEY = 's1ne_hr_key';
const hrKey = () => { try { return sessionStorage.getItem(KEY) || ''; } catch { return ''; } };
const call = (path, opt = {}) => fetch(API + path, { ...opt, headers: { 'content-type': 'application/json', authorization: `Bearer ${localStorage.getItem(CONFIG.tokenKey) || ''}`, 'x-hr-key': hrKey(), ...(opt.headers || {}) } });
const post = (path, body) => call(path, { method: 'POST', body: JSON.stringify(body || {}) }).then((r) => r.json());
const btn = (a, label, cls = 'ghost') => `<button type="button" class="btn ${cls} sm" data-hr="${a}">${label}</button>`;

function html(d) {
  const r = d.row;
  if (d.need_key) return `<small class="muted">線上版人事資料表</small> ${btn('key', '輸入專用密碼')}`;
  if (!r || !r.online) return `<small class="muted">線上版人事資料表：還沒開</small> ${btn('prep', '開線上版', 'primary')}${r && r.has_old ? btn('import', '開舊表帶入') : ''}<div data-hr-box></div>`;
  // 2026-11-06 Jacky：放行機制拿掉，人選送出就自動換給客戶；這裡只顯示客戶看到哪一版，換版失敗才出現重試鈕。
  const seen = r.released_at ? `客戶現在看到：<b>新版</b>（${esc(String(r.released_at).slice(5, 16))} 已更新）` : r.client_can_see ? '客戶現在看到：<b>舊版</b>，還看不到新版' : '客戶現在<b>還看不到</b>這份表';
  let out = `<small class="muted">線上版</small> <span class="badge">${esc(r.state)}</span> <small class="muted">${esc(r.mode)}</small><div style="font-size:13px;margin-top:2px">${seen}</div>`;
  if (r.status === 'submitted' && !r.released_at) out += `<div style="font-size:13px;margin-top:4px;padding:6px 8px;border-radius:6px;background:#FEF3C7;color:#78350F"><b>客戶專區沒換成功：</b>請按「重試換版」。</div>`;
  if (r.status !== 'submitted' && r.status !== 'purged' && r.missing.length) out += `<div class="muted" style="color:#B91C1C;font-size:12.5px">還有 ${r.missing.length} 項${r.to_confirm ? `（其中 ${r.to_confirm} 格等人選確認）` : ''}：${esc(r.missing.join('、'))}</div>`;
  if (r.sign_mode === 'paper' && r.status === 'submitted' && r.missing.length) out += `<div class="muted" style="color:#B91C1C;font-size:12.5px">手寫版：系統沒辦法判斷這些格子有沒有手寫補上，請打開看：${esc(r.missing.join('、'))}</div>`;
  if (r.close_outcome) out += `<div class="muted" style="font-size:12.5px">結案：${r.close_outcome === 'hired' ? '錄取（保存規則待確認，不會排刪除）' : `沒錄取，預計 ${esc(String(r.delete_after || '').slice(0, 10))} 可刪除`}</div>`;
  if (r.delete_due) out += `<div class="muted" style="color:#B91C1C;font-size:12.5px">已滿保存期限，請確認後刪除</div>`;
  if (r.purged_at) return `${out}<div class="muted" style="font-size:12.5px">${esc(r.purged_at)} 由 ${esc(r.purged_by)} 刪除</div>`;
  const acts = [];
  if (r.status === 'submitted') { acts.push(btn('pdf', r.released_at ? '看內容' : '看新版內容')); if (!r.released_at) acts.push(btn('release', '重試換版', 'primary')); acts.push(btn('reopen', '退回補件')); }
  else { acts.push(btn('send', r.mail_pending ? '重貼寄信確認卡' : '寄連結（TG 確認卡）', 'primary')); acts.push(btn('reopen', '重新開通')); if (r.state !== '已作廢') acts.push(btn('revoke', '作廢連結')); }
  if (r.code_locked) acts.push(btn('unlock', '解除輸入鎖定'));
  acts.push(r.close_outcome ? btn('unclose', '改回進行中') : `${btn('closeN', '結案：沒錄取')}${btn('closeH', '結案：錄取')}`);
  acts.push(btn('purge', r.delete_due ? '確認刪除' : '人選要求刪除'), btn('log', '紀錄'));
  return `${out}<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">${acts.join('')}</div><div data-hr-box></div>`;
}

async function importForm(el, ids) {
  const box = el.querySelector('[data-hr-box]');
  const d = await (await call('schema')).json();
  const input = (f) => {
    const lab = esc((f.group ? `${f.group}・` : '') + f.label);
    if (f.type === 'choice' || f.type === 'select') return `<label style="display:block;font-size:13px;margin:4px 0">${lab}<select data-im="${f.k}" style="width:100%;min-height:36px"><option value=""></option>${f.options.map((o) => `<option>${esc(o)}</option>`).join('')}</select></label>`;
    return `<label style="display:block;font-size:13px;margin:4px 0">${lab}<input data-im="${f.k}" type="${f.type === 'date' ? 'date' : f.type === 'month' ? 'month' : 'text'}" ${f.max ? `maxlength="${f.max}"` : ''} style="width:100%;min-height:36px"></label>`;
  };
  box.innerHTML = `<p class="muted" style="font-size:13px">看著舊表把內容打進來，看不清楚的留空。打的內容都會標「請確認」給人選核對。希望待遇不用打。</p>${btn('old', '下載舊表對照')}${d.steps.filter((s) => !['consent', 'skills', 'last'].includes(s.key)).map((s) => `<h4 style="margin:10px 0 2px;font-size:14px">${esc(s.title)}</h4>${s.fields.filter((f) => f.type !== 'check' && f.type !== 'multi').map(input).join('')}`).join('')}${btn('import-go', '產生線上版（不會寄出）', 'primary')}`;
  box.querySelector('[data-hr="old"]').onclick = () => download(`${ids.submission_id}/old-file`, '舊表');
  box.querySelector('[data-hr="import-go"]').onclick = async () => {
    const imported = {};
    box.querySelectorAll('[data-im]').forEach((i) => { if (i.value) imported[i.getAttribute('data-im')] = i.value; });
    const r = await post('prepare', { ...ids, imported });
    alert(r.ok ? '線上版開好了，還沒寄給任何人。' : r.error);
    load(el);
  };
}
function download(path, name) {
  return call(path).then((r) => { if (!r.ok) throw new Error(); return r.blob(); }).then((b) => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; a.click(); }).catch(() => alert('下載失敗'));
}

async function act(el, a, data) {
  const ids = { job_form_id: el.dataset.jf, application_id: el.dataset.app, company_id: el.dataset.co };
  const id = data.row && data.row.id;
  const run = async (path, body) => { const r = await post(path, body); alert(r.ok ? (r.note || '好了') + (r.link ? `\n\n新連結（只顯示這一次）：\n${r.link}` : '') : (r.error || '失敗')); load(el); };
  if (a === 'key') { const k = prompt('輸入你的專用密碼（看身分證等敏感資料用）'); if (k) { try { sessionStorage.setItem(KEY, k); } catch { /* 無痕模式 */ } load(el); } return; }
  if (a === 'prep') return run('prepare', ids);
  if (a === 'import') return importForm(el, { ...ids, submission_id: id });
  if (a === 'pdf') return download(`${id}/pdf`, '人事資料表.pdf');
  if (a === 'send') return run(`${id}/send-card`);
  if (a === 'release') return run(`${id}/release`);
  if (a === 'reopen') { const n = prompt('舊連結立刻失效，已填的內容留著，48 小時重算。\n要請人選補什麼？（人選打開會看到，可留空；系統不會通知人選）'); if (n !== null) return run(`${id}/reopen`, { note: n }); return; }
  if (a === 'revoke') { if (confirm('作廢後這條連結立刻不能用，確定？')) return run(`${id}/revoke`); return; }
  if (a === 'unlock') return run(`${id}/unlock`);
  if (a === 'closeN') return run(`${id}/close`, { outcome: 'not_hired' });
  if (a === 'closeH') return run(`${id}/close`, { outcome: 'hired' });
  if (a === 'unclose') return run(`${id}/unclose`);
  if (a === 'purge') { const w = prompt('刪除這份表、照片、簽名和舊表，刪了救不回來。\n還沒到期請填原因（例如：人選要求），到期的可留空。'); if (w !== null) return run(`${id}/purge`, { reason: w }); return; }
  if (a === 'log') { const r = await (await call(`${id}/log`)).json(); alert(r.ok ? (r.log.map((l) => `${l.at} ${l.who} ${l.action}`).join('\n') || '沒有紀錄') : r.error); }
}

async function load(el) {
  el.dataset.hrDone = '1';
  try {
    const q = new URLSearchParams({ job_form_id: el.dataset.jf, application_id: el.dataset.app, company_id: el.dataset.co });
    const d = await (await call(`card?${q}`)).json();
    if (!d.ok || !d.enabled) { el.innerHTML = ''; return; }
    el.style.cssText = 'padding:6px 10px;margin-top:2px;border-left:3px solid #2563EB';
    el.innerHTML = html(d);
    el.querySelectorAll('[data-hr]').forEach((b) => { b.onclick = () => act(el, b.dataset.hr, d); });
  } catch { el.innerHTML = ''; } // 線上版掛了不影響卡片
}

const scan = () => document.querySelectorAll('[data-hrform]:not([data-hr-done])').forEach(load);
new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
scan();
