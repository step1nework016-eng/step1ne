// 2026-10-19 收費進程第二版（Jacky 拍板）：已簽合約上傳＋AI 讀合約、每期金額＋算式、發票上傳、請款／催款信確認卡。
// 後端全部在 /admin/billing2/*（backoffice-worker src/billing_v2.js）。
// 寄信一律只產生 TG 確認卡，按「確認寄出」才會從 official@ 寄。
import { CONFIG } from './config.js';
import { api } from './core/api.js';
import { $, $$, closeOverlay, empty, modal, toast } from './core/ui.js';
import { escapeHtml, text } from './core/security.js';

const ME_KEY = 's1ne_bill_me';
const fmt = (n) => (n === null || n === undefined || n === '' || !Number.isFinite(Number(n)) ? '—' : Math.round(Number(n)).toLocaleString('en-US'));
const getMe = () => { try { return localStorage.getItem(ME_KEY) || ''; } catch { return ''; } };
const setMe = (v) => { try { localStorage.setItem(ME_KEY, v); } catch { /* 無痕模式存不了就算了 */ } };
// 2026-10-19 Jacky：檔案框太小不好拖 → 頁面上所有選檔框自動變成「把檔案拖到這裡」的大區塊（點一下也能選）。
function enhanceDropZone(input) {
  if (!input || input.dataset.dz) return;
  input.dataset.dz = '1';
  const zone = document.createElement('div');
  zone.className = 'bill2-dz';
  zone.setAttribute('role', 'button');
  zone.tabIndex = 0;
  zone.style.cssText = 'border:2px dashed #9aa6b2;border-radius:12px;padding:22px 14px;text-align:center;cursor:pointer;color:#475569;background:#f8fafc;min-height:44px;transition:background .15s,border-color .15s';
  const label = () => {
    const fs = [...(input.files || [])];
    zone.innerHTML = fs.length
      ? `<b>已選 ${fs.length} 個檔</b><div style="font-size:13px;margin-top:4px">${fs.map((f) => escapeHtml(f.name)).join('<br>')}</div><div style="font-size:12px;margin-top:6px;color:#64748b">可再拖其他檔進來替換</div>`
      : '📄 <b>把檔案拖到這裡</b><div style="font-size:13px;margin-top:4px">或點一下選檔' + (input.multiple ? '（可一次放多個）' : '') + '</div>';
  };
  input.style.display = 'none';
  input.insertAdjacentElement('afterend', zone);
  label();
  const on = (v) => { zone.style.background = v ? '#e0f2fe' : '#f8fafc'; zone.style.borderColor = v ? '#0284c7' : '#9aa6b2'; };
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); on(true); }));
  ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); on(false); }));
  zone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer; if (!dt || !dt.files || !dt.files.length) return;
    const keep = new DataTransfer();
    [...dt.files].slice(0, input.multiple ? 50 : 1).forEach((f) => keep.items.add(f));
    input.files = keep.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  input.addEventListener('change', label);
}
if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
  const scan = () => document.querySelectorAll('input[type="file"]:not([data-dz])').forEach((el) => {
    if (el.closest('.bill2-scope, #bill2-root') || el.id === 'bill2-files' || el.classList.contains('i-file')) enhanceDropZone(el);
  });
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
}
const readB64 = (f) => new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = bad; r.readAsDataURL(f); });

async function download(path, label) {
  try {
    const res = await fetch(`${CONFIG.apiBase}${path}`, { headers: { authorization: `Bearer ${localStorage.getItem(CONFIG.tokenKey) || ''}` } });
    if (!res.ok) { const b = await res.json().catch(() => null); throw new Error(b?.error || `下載失敗 HTTP ${res.status}`); }
    const blob = await res.blob();
    const m = (res.headers.get('content-disposition') || '').match(/filename\*=UTF-8''([^;]+)/);
    let name = label; if (m) { try { name = decodeURIComponent(m[1]); } catch { /* 用預設 */ } }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (e) { toast(e.message, 'error'); }
}

// 預覽：帶登入碼抓檔案 → 在頁面上開一層視窗看（PDF 用瀏覽器內建檢視、圖片用 img），不用下載。
// 用 #sub-overlay-root，蓋在人選明細視窗上面，關掉後明細還在。
async function preview(path, title) {
  const root = document.getElementById('sub-overlay-root') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'sub-overlay-root' }));
  root.innerHTML = `<div class="mask sub-mask" data-bill2-pv-close style="z-index:1000"></div><section role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}" style="position:fixed;inset:3vh 3vw;z-index:1001;background:var(--panel,#fff);border-radius:12px;display:flex;flex-direction:column;box-shadow:0 10px 40px rgba(0,0,0,.3)">
<header style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;gap:8px"><b style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(title)}</b>
<span><a href="#" class="bill2-pv-dl">下載</a>&emsp;<button type="button" class="icon-btn" data-bill2-pv-close aria-label="關閉" style="min-width:44px;min-height:44px">×</button></span></header>
<div class="bill2-pv-body" style="flex:1;min-height:0;display:flex;align-items:center;justify-content:center;background:#f1f3f5;border-radius:0 0 12px 12px;overflow:auto"><p class="help">讀取中…</p></div></section>`;
  let url = null;
  const close = () => { root.innerHTML = ''; if (url) URL.revokeObjectURL(url); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  root.querySelectorAll('[data-bill2-pv-close]').forEach((x) => { x.onclick = close; });
  root.querySelector('.bill2-pv-dl').onclick = (e) => { e.preventDefault(); download(path, title); };
  try {
    const res = await fetch(`${CONFIG.apiBase}${path}`, { headers: { authorization: `Bearer ${localStorage.getItem(CONFIG.tokenKey) || ''}` } });
    if (!res.ok) { const b = await res.json().catch(() => null); throw new Error(b?.error || `讀取失敗 HTTP ${res.status}`); }
    const blob = await res.blob();
    url = URL.createObjectURL(blob);
    const body = root.querySelector('.bill2-pv-body');
    if (!body) { URL.revokeObjectURL(url); return; }
    if (/^image\//.test(blob.type)) body.innerHTML = `<img src="${url}" alt="${escapeHtml(title)}" style="max-width:100%;max-height:100%;object-fit:contain">`;
    else if (/pdf/.test(blob.type)) body.innerHTML = `<iframe src="${url}" title="${escapeHtml(title)}" style="width:100%;height:100%;border:0"></iframe>`;
    else body.innerHTML = '<p class="help">這種檔案沒辦法預覽，請按右上角「下載」</p>';
  } catch (e) { const body = root.querySelector('.bill2-pv-body'); if (body) body.innerHTML = `<p class="help" style="color:#c62828">${escapeHtml(e.message)}</p>`; }
}

export const billing2Api = {
  client: (id) => api.get(`/admin/billing2/client?company_id=${encodeURIComponent(id)}`),
  placements: (id) => api.get(`/admin/billing2/placements${id ? `?company_id=${encodeURIComponent(id)}` : ''}`),
};

// ───────── 畫面 ─────────
function termsBlock(pack, kind, meta) {
  if (!pack) return '';
  const t = pack.terms;
  const tone = kind === 'confirmed' ? 'success' : 'warning';
  const head = kind === 'confirmed'
    ? `<span class="badge success">已生效</span> <small class="muted">${text(meta.at, '')}${meta.by ? `・${text(meta.by)}` : ''}</small>`
    : `<span class="badge warning">草稿・還沒生效</span> <small class="muted">${text(meta.at, '')}${meta.by ? `・${text(meta.by)}` : ''}</small>`;
  const mism = (pack.trial.mismatches || []).map((x) => `<div style="color:#c62828;font-weight:600">🔴 對不上：${escapeHtml(x)}</div>`).join('');
  const manual = (t.manual_items || []).length
    ? `<div style="margin-top:8px"><b>⚠️ 需人工設定（系統不猜）：</b><ul style="margin:4px 0 0 18px">${t.manual_items.map((m) => `<li>${escapeHtml(m.item)}：${escapeHtml(m.reason)}${m.quote ? `<br><small class="muted">原文：${escapeHtml(m.quote)}</small>` : ''}</li>`).join('')}</ul></div>` : '';
  return `<div class="bill2-terms ${tone}" style="border:1px solid var(--line,#ddd);border-radius:10px;padding:12px;margin-top:10px">
<div>${head}</div>
<div style="margin-top:6px;line-height:1.7">${pack.summary.map((l) => escapeHtml(l)).join('<br>')}</div>
<div style="margin-top:8px"><b>🧮 試算</b>（用來檢查有沒有讀對）<div style="line-height:1.7">${pack.trial.lines.map((l) => escapeHtml(l)).join('<br>')}</div>${mism}</div>
${manual}
<div class="actions-row" style="margin-top:10px">
  <button type="button" class="btn" data-bill2-edit="${kind}">✏️ 修改規則</button>
  <button type="button" class="btn" data-bill2-custom="${kind}" data-cat="">🧱 ＋新增自訂算法</button>
  ${(t.categories || []).filter((c) => c.fee_type === 'custom').map((c) => `<button type="button" class="btn" data-bill2-custom="${kind}" data-cat="${text(c.name)}">🧱 用積木修改「${text(c.name)}」</button>`).join('')}
  ${kind === 'draft' ? `<label style="display:inline-flex;gap:6px;align-items:center;min-height:44px"><input type="checkbox" id="bill2-apply-schedule" checked> 分期規則套用到之後報到的人選</label>
  <button type="button" class="btn primary" data-bill2-confirm>✅ 確認生效</button>` : ''}
</div></div>`;
}

export function billingV2View({ companies, companyId, planHtml, client, rows }) {
  const opts = (companies || []).map((c) => `<option value="${text(c.id)}"${companyId === c.id ? ' selected' : ''}>${text(c.display_name || c.name)}</option>`).join('');
  const me = getMe();
  const meSel = `<label class="field" style="max-width:220px"><span>我是（記錄誰操作）</span><select id="bill2-me"><option value="">－請選－</option>${['Jacky', 'Phoebe'].map((n) => `<option${me === n ? ' selected' : ''}>${n}</option>`).join('')}</select></label>`;
  let contractCard = '';
  if (companyId && client) {
    const files = client.files || [];
    const dt = client.doc_types || {};
    const fileList = files.length ? files.map((f) => `<div class="list-row"><span><b>${text(dt[f.doc_type] || f.doc_type)}</b>｜${text(f.filename)}<br><small class="muted">${text(f.uploaded_by, '—')}・${text(String(f.created_at || '').slice(0, 16))}</small></span>
<span><a href="#" data-bill2-pv="contract" data-id="${text(f.id)}" data-name="${text(f.filename)}">預覽</a>&emsp;<a href="#" data-bill2-dl="${text(f.id)}">下載</a>&emsp;<a href="#" data-bill2-del="${text(f.id)}" style="color:#c62828">移除</a></span></div>`).join('') : empty('還沒上傳已簽合約');
    const rt = client.read_task;
    const rtLine = rt ? `<p class="help">最近一次 AI 讀合約：${text(String(rt.created_at || '').slice(0, 16))}（${text(rt.created_by, '—')}）— ${rt.status === 'done' ? '已讀完' : rt.status === 'error' ? `失敗：${text(rt.error)}` : '讀取中…'}</p>` : '';
    contractCard = `<div class="card" style="margin-top:14px"><h2>已簽合約與收費規則｜${text(client.company.display_name)}</h2>
<p class="help">上傳合約正本、補充約定、更名確認書（PDF 或圖片，掃描檔也可以）。按「請 AI 讀合約」後約 2～5 分鐘，結果會貼到這家客戶的 TG 主題請你確認，也會出現在下面。收費規則只認三種型態：月薪倍數（依職級）、固定年薪百分比（依年薪級距）、固定金額；看不懂或不屬於這三種的，會標「需人工設定」，系統不猜。</p>
<p class="help">發票抬頭：${text(client.confirmed?.terms?.invoice_title || client.company.legal_name || client.company.display_name)}${(client.confirmed?.terms?.tax_id || client.company.tax_id) ? `／統編 ${text(client.confirmed?.terms?.tax_id || client.company.tax_id)}` : ''}&emsp;請款信收件人：${client.company.contact_email ? text(client.company.contact_email) : '<b style="color:#c62828">沒有設定聯絡信箱</b>'}</p>
<div class="list">${fileList}</div>
<div class="form-grid" style="margin-top:10px">
<label class="field"><span>文件類型</span><select id="bill2-doc-type">${Object.entries(dt).map(([k, v]) => `<option value="${text(k)}">${text(v)}</option>`).join('')}</select></label>
<label class="field"><span>選檔案（可多選）</span><input type="file" id="bill2-files" multiple accept=".pdf,image/png,image/jpeg,image/webp"></label>
</div>
<div class="actions-row"><button type="button" class="btn" id="bill2-upload">⬆️ 上傳</button>
<button type="button" class="btn primary" id="bill2-read" ${files.length ? '' : 'disabled'}>🤖 請 AI 讀合約</button></div>
<div id="bill2-read-status">${rtLine}</div>
${client.confirmed ? termsBlock(client.confirmed, 'confirmed', { at: client.confirmed_at, by: client.confirmed_by }) : '<p class="help" style="margin-top:10px">這家客戶還沒有「已生效」的合約規則，所以還不能算金額、擬請款信。</p>'}
${client.draft && (!client.confirmed || (client.draft_at || '') > (client.confirmed_at || '')) ? termsBlock(client.draft, 'draft', { at: client.draft_at, by: client.draft_by }) : ''}
</div>`;
  }
  // 收費進度：一人一列
  const by = new Map();
  (rows || []).forEach((r) => { if (!by.has(r.placement_id)) by.set(r.placement_id, []); by.get(r.placement_id).push(r); });
  const groups = [...by.values()];
  const list = !groups.length ? empty('目前沒有已報到、且有分期的人選') : groups.map((g) => {
    const r = g[0];
    const paid = g.filter((x) => x.paid_at).length;
    const inv = g.filter((x) => x.invoice_no).length;
    return `<div class="list-row bill2-row" style="cursor:pointer" data-pid="${text(r.placement_id)}">
<span><b>${text(r.candidate_name)}</b><small>${text(r.company_name || r.client_name)}・${text(r.job_title || r.offer_title)}・報到 ${text(r.onboard_date)}</small>
<small>${r.fee_total_taxed != null ? `服務報酬 ${fmt(r.fee_total_untaxed)}（未稅）／${fmt(r.fee_total_taxed)}（含稅）` : `<span style="color:#b26a00">${text(r.fee_note || '金額還沒算出來', '金額還沒算出來')}</span>`}</small></span>
<small>收費類別：${text(r.fee_category, '—')}${r.fee_category_status === 'uncertain' ? ' <b style="color:#b26a00">⚠️ 類別待確認</b>' : r.fee_category_status === 'manual' ? '（顧問指定）' : r.fee_category ? '（依薪資自動判定）' : ''}${r.fee_schedule_note ? ` <b style="color:#c62828">⚠️ ${text(r.fee_schedule_note)}</b>` : ''}</small></span>
<span>${paid}/${g.length} 期已收・${inv} 期已開票</span></div>`;
  }).join('');
  return `<div class="notice">收費進程：選客戶 → 上傳已簽合約、讓 AI 讀出收費規則並確認 → 系統依人選的計費月薪自動算每期金額 → 每期開好發票上傳，系統擬好請款信貼到 TG，按「確認寄出」才會寄。到期前 7 天、當天、逾期每週會在客戶的 TG 主題提醒。</div>
<div class="card"><h2>選客戶</h2><div class="form-grid"><label class="field"><span>客戶</span><select id="billing-company-select"><option value="">－－選一家客戶（不選＝看全部人選）－－</option>${opts}</select></label>${meSel}</div></div>
${contractCard}
${companyId ? scheduleCard(client, planHtml) : ''}
<div class="card" style="margin-top:14px"><h2>收費進度</h2><p class="help">點一列看每一期的金額、算式、發票，以及上傳發票、擬請款信。</p><div class="list">${list}</div></div>`;
}

const UNIT = { days: '天', months: '個月' };
function schedRow(t, i) {
  return `<tr><td><input type="text" class="s-label" value="${text(t.label, '')}" placeholder="第${i + 1}期"></td>
<td><input type="number" class="s-pct" value="${text(t.percent, '')}" min="0" max="100" step="0.1" style="width:80px"> %</td>
<td>報到滿 <input type="number" class="s-val" value="${text(t.trigger_value, '')}" min="0" style="width:70px">
<select class="s-unit">${Object.entries(UNIT).map(([k, v]) => `<option value="${k}"${t.trigger_unit === k ? ' selected' : ''}>${v}</option>`).join('')}</select></td>
<td><button type="button" class="btn danger sm s-del">刪除</button></td></tr>`;
}
// 分期範本：依合約的收費類別各一份（例：一般職員及管理職 50/25/25、高階人才一次付清）；客戶沒有類別資料才顯示舊的單一範本
function scheduleCard(client, planHtml) {
  const sch = (client && client.schedules) || {};
  const names = Object.keys(sch);
  if (!names.length) {
    return `<div class="card" style="margin-top:14px"><h2>分期範本（之後報到的人選照這個自動排期）</h2><p class="help">這家客戶還沒有已確認的合約收費類別，先用這份共用範本。合約確認生效後，會改成依收費類別各一份。改範本不會回頭改已經排好的人選。</p>${planHtml}</div>`;
  }
  const src = { manual: '顧問改過', contract: '照合約', none: '合約沒寫清楚，需人工設定' };
  return `<div class="card" style="margin-top:14px"><h2>分期範本（依收費類別各一份）</h2>
<p class="help">人選報到時，系統依這位人選的收費類別（薪資對照合約級距自動判定，或顧問指定）套對應那份分期。改範本只影響之後報到的人選，已經排好的不會改。${client.schedules_from === 'draft' ? '<b>合約規則還沒確認生效，確認後才會開始套用。</b>' : ''}</p>
${names.map((n) => `<div class="bill2-sched" data-cat="${text(n)}" style="border:1px dashed #ccc;border-radius:8px;padding:8px;margin-top:8px">
<b>${text(n)}</b> <small class="muted">（${text(src[sch[n].source] || '')}）</small>
<table><thead><tr><th>名稱</th><th>比例</th><th>觸發時機</th><th></th></tr></thead><tbody>${(sch[n].tiers || []).map((t, i) => schedRow(t, i)).join('')}</tbody></table>
<div class="actions-row"><button type="button" class="btn sm s-add">＋ 加一期</button><button type="button" class="btn primary sm s-save">儲存「${text(n)}」的分期</button></div></div>`).join('')}</div>`;
}

function instRow(r) {
  const st = r.paid_at || r.confirmed_received === 'yes' ? '<span class="badge success">已收款</span>'
    : r.invoice_no ? '<span class="badge">已開票</span>' : '<span class="badge warning">未開票</span>';
  const amt = r.amount_taxed != null
    ? `<div>未稅 ${fmt(r.amount_untaxed)}＋稅 ${fmt(r.amount_tax)}＝<b>含稅 ${fmt(r.amount_taxed)}</b></div><div class="muted" style="font-size:13px">算式：${text(r.amount_formula)}</div>`
    : '<div class="muted">金額還沒算出來（要先有計費月薪＋已生效的合約規則）</div>';
  const inv = r.invoice_no
    ? `<div>發票 ${text(r.invoice_no)}・${text(r.invoice_date)}・金額 ${fmt(r.invoice_amount)}${r.invoice_amount != null && r.amount_taxed != null && Number(r.invoice_amount) !== Number(r.amount_taxed) ? ' <b style="color:#c62828">（跟系統算的不一樣）</b>' : ''}
 <a href="#" data-bill2-pv="invoice" data-id="${text(r.id)}" data-name="發票 ${text(r.invoice_no)}">預覽發票</a>&emsp;<a href="#" data-bill2-inv-dl="${text(r.id)}">下載發票</a><br><small class="muted">${text(r.invoice_uploaded_by, '—')} 上傳於 ${text(String(r.invoice_uploaded_at || '').slice(0, 16))}</small></div>` : '';
  const mail = r.invoice_mail_action_id ? `<div class="muted" style="font-size:13px">請款信確認卡：${{ pending: '等人按確認寄出', sending: '寄送中', done: '已寄出', cancelled: '已取消', expired: '已過期', failed: '失敗' }[r.invoice_mail_status] || text(r.invoice_mail_status)}</div>` : '';
  const dun = r.dun_mail_action_id ? `<div class="muted" style="font-size:13px">催款信確認卡：${{ pending: '等人按確認寄出', done: '已寄出', cancelled: '已取消', expired: '已過期', failed: '失敗' }[r.dun_mail_status] || text(r.dun_mail_status)}</div>` : '';
  const rem = [r.reminded_pre7_at && `到期前提醒 ${String(r.reminded_pre7_at).slice(5, 10)}`, r.reminded_due_at && `到期提醒 ${String(r.reminded_due_at).slice(5, 10)}`, r.reminded_overdue_at && `逾期提醒 ${r.overdue_remind_count || 1} 次`].filter(Boolean).join('・');
  const overdue = !r.paid_at && r.due_date < new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  return `<div class="list-row" data-inst="${text(r.id)}" style="align-items:flex-start;flex-wrap:wrap;gap:8px">
<span style="flex:1 1 320px"><b>${text(r.label)} ${text(r.percent)}%</b>&emsp;到期 ${text(r.due_date)} ${st}
${amt}${inv}${mail}${dun}${rem ? `<div class="muted" style="font-size:12px">${escapeHtml(rem)}</div>` : ''}
${r.client_submitted_at ? `<div style="font-size:13px">客戶回報匯款日 ${text(r.client_transfer_date)}</div>` : ''}</span>
<span class="actions-row" style="flex-wrap:wrap">
<button type="button" class="btn sm ${r.invoice_no ? '' : 'primary'}" data-bill2-inv="${text(r.id)}">🧾 ${r.invoice_no ? '改發票' : '上傳發票'}</button>
<button type="button" class="btn sm" data-bill2-mail="${text(r.id)}" data-kind="invoice">✉️ 請款信</button>
${overdue ? `<button type="button" class="btn sm" data-bill2-mail="${text(r.id)}" data-kind="dun">✉️ 催款信</button>` : ''}
${r.paid_at ? `<button type="button" class="btn sm" data-bill2-paid="${text(r.id)}" data-v="0">標記未收款</button>` : `<button type="button" class="btn sm" data-bill2-paid="${text(r.id)}" data-v="1">✅ 已收到款</button>`}
</span>
<div class="bill2-inline" data-inline-for="${text(r.id)}" style="flex-basis:100%"></div></div>`;
}

function placementBody(g, cats) {
  const r = g[0];
  const manual = r.fee_category_status === 'manual';
  const catOpts = (cats || []).length ? `<option value=""${manual ? '' : ' selected'}>自動判定（目前：${text(r.fee_category, '—')}${r.fee_category_status === 'uncertain' ? '，待確認' : ''}）</option>`
    + cats.map((c) => `<option value="${text(c.name)}"${manual && r.fee_category === c.name ? ' selected' : ''}>${text(c.name)}</option>`).join('') : '';
  const cur = (cats || []).find((c) => c.name === (r.fee_category || cats[0]?.name));
  const lvOpts = cur && cur.levels && cur.levels.length ? cur.levels.map((l) => `<option${r.fee_level === l ? ' selected' : ''}>${text(l)}</option>`).join('') : '';
  const src = { offer_ai: 'AI 從聘書讀的', manual: '顧問手動填的' }[r.fee_salary_source] || '還沒有';
  return `<p class="muted" style="margin:0 0 6px">報到 ${text(r.onboard_date)}・聘書：${r.offer_file_id ? `${text(r.offer_file_name || '有')} <a href="#" data-bill2-pv="offer" data-id="${text(r.placement_id)}" data-name="${text(r.offer_file_name || '聘書')}">預覽</a>` : '還沒上傳'}</p>
<div class="card" style="padding:12px"><b>計費基礎</b>
<div class="form-grid" style="margin-top:6px">
<label class="field"><span>計費月薪（${escapeHtml(src)}）</span><input id="bill2-ms" inputmode="numeric" value="${r.fee_monthly_salary != null ? text(r.fee_monthly_salary) : ''}" placeholder="例：40833"></label>
<label class="field"><span>年薪（年薪百分比類才需要）</span><input id="bill2-as" inputmode="numeric" value="${r.fee_annual_salary != null ? text(r.fee_annual_salary) : ''}"></label>
<label class="field"><span>約聘月數（約聘案才需要）</span><input id="bill2-cm" inputmode="decimal" value="${r.fee_contract_months != null ? text(r.fee_contract_months) : ''}" placeholder="例：8"></label>
${(cats || []).some((c) => (c.needs || []).includes('bonus_months')) ? `<label class="field"><span>年終月數</span><input id="bill2-bm" inputmode="decimal" value="${r.fee_bonus_months != null ? text(r.fee_bonus_months) : ''}"></label>` : ''}
${catOpts ? `<label class="field"><span>收費類別</span><select id="bill2-cat">${catOpts}</select></label>` : ''}
${lvOpts ? `<label class="field"><span>職級</span><select id="bill2-lv">${lvOpts}</select></label>` : ''}
</div>
<div class="actions-row"><button type="button" class="btn primary" id="bill2-fee-save">儲存並重算</button>
${r.offer_file_id ? '<button type="button" class="btn" id="bill2-offer-read">🤖 AI 讀聘書月薪</button>' : ''}<span id="bill2-offer-status" class="muted"></span></div>
<div style="margin-top:6px">${r.fee_formula ? `服務報酬：${text(r.fee_formula)}<br>總額 未稅 ${fmt(r.fee_total_untaxed)}＋稅 ${fmt(r.fee_tax)}＝含稅 <b>${fmt(r.fee_total_taxed)}</b>` : ''}
${r.fee_note ? `<div style="color:#b26a00">${text(r.fee_note)}</div>` : ''}
${r.fee_schedule_note ? `<div style="color:#c62828;font-weight:600">⚠️ ${text(r.fee_schedule_note)}</div>` : ''}
<div class="muted" style="font-size:13px">收費類別改了（例如補上年薪變成高階）：期別都還沒開票、收款的話，系統會自動依新類別重排分期；已有開票或收款就不動，會提示要人工調整。</div></div></div>
<div class="list" style="margin-top:10px">${g.map((x) => instRow(x)).join('')}</div>`;
}

// ───────── 規則編輯（簡單文字格式，讓非工程背景也改得動） ─────────
function catToText(c) {
  if (c.fee_type === 'monthly_multiple') return (c.levels || []).map((l) => `${l.name}=${l.months}`).join('，');
  if (c.fee_type === 'annual_percent') return (c.brackets || []).map((b) => `${b.min ?? ''}-${b.max ?? ''}:${b.percent}${b.min_fee ? `:${b.min_fee}` : ''}`).join('；');
  if (c.fee_type === 'fixed_amount') return String(c.amount || '');
  if (c.fee_type === 'contract_total_percent') return (c.brackets || []).map((b) => `${b.min ?? ''}-${b.max ?? ''}:${b.percent}${b.months_override ? `:${b.months_override}` : ''}`).join('；');
  return '';
}
const instToText = (c) => (c.installments || []).map((x) => `${x.label} ${x.percent}% ${x.trigger_value}${x.trigger_unit === 'months' ? '個月' : '天'}`).join('；');
function parseCat(name, type, feeText, instText) {
  const c = { name, fee_type: type };
  const parts = String(feeText || '').split(/[，,；;\n]/).map((s) => s.trim()).filter(Boolean);
  if (type === 'monthly_multiple') c.levels = parts.map((p) => { const [n, m] = p.split(/[=＝:：]/); return { name: (n || '').trim(), months: Number(m) }; });
  if (type === 'annual_percent') c.brackets = parts.map((p) => { const [rng, pct, mf] = p.split(/[:：]/); const [mi, ma] = String(rng || '').split(/[-～~]/); return { min: mi ? Number(mi.replace(/,/g, '')) : null, max: ma ? Number(ma.replace(/,/g, '')) : null, percent: Number(pct), min_fee: mf ? Number(mf.replace(/,/g, '')) : null }; });
  if (type === 'fixed_amount') c.amount = Number(String(feeText).replace(/[,\s]/g, ''));
  // 約聘：下限-上限:百分比:計費月數（含下限、不含上限）
  if (type === 'contract_total_percent') c.brackets = parts.map((p) => { const [rng, pct, mo] = p.split(/[:：]/); const [mi, ma] = String(rng || '').split(/[-～~]/); return { min: mi ? Number(mi) : null, max: ma ? Number(ma) : null, min_inclusive: true, max_inclusive: false, percent: Number(pct), months_override: mo ? Number(mo) : null }; });
  c.installments = String(instText || '').split(/[；;\n]/).map((s) => s.trim()).filter(Boolean).map((s) => {
    const m = s.match(/^(.*?)\s*([\d.]+)\s*%\s*(\d+)\s*(個月|月|天|日)/);
    return m ? { label: m[1].trim() || undefined, percent: Number(m[2]), trigger_value: Number(m[3]), trigger_unit: /月/.test(m[4]) ? 'months' : 'days' } : { label: s, percent: null };
  });
  return c;
}
function editorBody(t) {
  const cats = (t.categories && t.categories.length ? t.categories : [{ name: '正職代招', fee_type: 'monthly_multiple', levels: [], installments: [] }]);
  const typeOpts = (v) => [['monthly_multiple', '月薪倍數（依職級）'], ['annual_percent', '固定年薪百分比（依級距）'], ['fixed_amount', '固定金額'], ['contract_total_percent', '約聘總薪資比例（依約聘月數）'], ...(v === 'custom' ? [['custom', '自訂算法（積木）']] : []), ['manual', '需人工設定（系統不算）']]
    .map(([k, l]) => `<option value="${k}"${v === k ? ' selected' : ''}>${l}</option>`).join('');
  const catRows = cats.map((c, i) => `<div class="bill2-cat" style="border:1px dashed #ccc;border-radius:8px;padding:8px;margin-bottom:8px">
<div class="form-grid"><label class="field"><span>類別名稱</span><input class="c-name" value="${text(c.name, '')}"></label>
<label class="field"><span>收費型態</span><select class="c-type">${typeOpts(c.fee_type)}</select></label>
${c.fee_type === 'custom' ? `<div class="field span-2"><span>自訂算法（要改請關掉這個視窗，在規則區塊按「🧱 用積木修改」）</span><div class="muted">${escapeHtml(c.explain_text || '')}</div><textarea class="c-json" hidden>${escapeHtml(JSON.stringify(c))}</textarea></div>` : `<label class="field span-2"><span>收費內容（月薪倍數：一般職員=1.5，管理職=2｜年薪百分比：0-1399999:20:200000；1400000-2000000:25；2000001-:26（下限-上限:百分比:最低服務費）｜固定金額：50000｜約聘：6-9:30:6；9-12:25；12-:20（約聘月數下限-上限（含下限、不含上限）:百分比:以幾個月計））</span><input class="c-fee" value="${text(catToText(c), '')}"></label>`}
<label class="field span-2"><span>分期（例：第一期 50% 30天；第二期 25% 3個月；第三期 25% 6個月｜一次付清 100% 30天）</span><input class="c-inst" value="${text(instToText(c), '')}"></label></div>
${i ? '<button type="button" class="btn danger sm c-del">刪除這類</button>' : ''}</div>`).join('');
  const b = t.bank || {};
  return `<div id="bill2-editor">${catRows}<button type="button" class="btn sm" id="bill2-add-cat">＋ 加一個收費類別</button>
<div class="form-grid" style="margin-top:10px">
<label class="field"><span>付款期限（幾日內）</span><input id="e-days" inputmode="numeric" value="${t.pay_within_days ?? ''}"></label>
<label class="field"><span>起算點</span><select id="e-from">${[['invoice', '收到發票／請款文件後'], ['onboard', '報到日起'], ['established', '報酬成立後']].map(([k, l]) => `<option value="${k}"${t.pay_from === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
<label class="field"><span>營業稅 %（外加）</span><input id="e-tax" inputmode="decimal" value="${t.tax_rate ?? ''}"></label>
<label class="field span-2"><span>逾期條款（原文，催款信才會寫）</span><input id="e-late" value="${text(t.late_fee && t.late_fee.text, '')}"></label>
<label class="field"><span>收款人</span><input id="e-payee" value="${text(b.payee, '')}"></label>
<label class="field"><span>銀行</span><input id="e-bank" value="${text(b.bank_name, '')}"></label>
<label class="field"><span>銀行代碼</span><input id="e-code" value="${text(b.bank_code, '')}"></label>
<label class="field"><span>帳號</span><input id="e-acct" value="${text(b.account, '')}"></label>
<label class="field"><span>發票抬頭</span><input id="e-title" value="${text(t.invoice_title, '')}"></label>
<label class="field"><span>統編</span><input id="e-taxid" value="${text(t.tax_id, '')}"></label>
<label class="field span-2" style="flex-direction:row;gap:8px;align-items:center"><input type="checkbox" id="e-cap" ${t.legal_cap ? 'checked' : ''}> 合約有「依法定上限」條款</label>
<label class="field"><span>上限方式（有條款才需要；不填＝照合約算）</span><select id="e-cap-type"><option value="">不設定</option><option value="months"${t.legal_cap_rule?.type === 'months' ? ' selected' : ''}>月薪幾個月</option><option value="amount"${t.legal_cap_rule?.type === 'amount' ? ' selected' : ''}>固定金額</option></select></label>
<label class="field"><span>上限數值</span><input id="e-cap-val" inputmode="decimal" value="${t.legal_cap_rule ? t.legal_cap_rule.value : ''}"></label>
</div></div>`;
}
function collectEditor(base) {
  const cats = $$('#bill2-editor .bill2-cat').map((el) => {
    if ($('.c-json', el) && $('.c-type', el).value === 'custom') {
      const c = JSON.parse($('.c-json', el).value);
      const p = parseCat('', 'custom', '', $('.c-inst', el).value);
      return { ...c, name: $('.c-name', el).value.trim() || c.name, installments: p.installments };
    }
    return parseCat($('.c-name', el).value.trim(), $('.c-type', el).value, $('.c-fee', el) ? $('.c-fee', el).value : '', $('.c-inst', el).value);
  });
  const capType = $('#e-cap-type').value;
  return { ...base, categories: cats, pay_within_days: $('#e-days').value, pay_from: $('#e-from').value, tax_rate: $('#e-tax').value,
    late_fee: { ...(base.late_fee || {}), text: $('#e-late').value || null, type: $('#e-late').value ? ((base.late_fee && base.late_fee.type !== 'none' && base.late_fee.type) || 'other') : 'none' },
    bank: { payee: $('#e-payee').value, bank_name: $('#e-bank').value, bank_code: $('#e-code').value, account: $('#e-acct').value },
    invoice_title: $('#e-title').value, tax_id: $('#e-taxid').value, legal_cap: $('#e-cap').checked,
    legal_cap_rule: capType ? { type: capType, value: $('#e-cap-val').value } : null,
    manual_items: [] };
}

// ───────── 自訂算法（積木）：只能從固定清單選，不能寫公式 ─────────
const FACTOR_OPTS = [['monthly', '月薪'], ['annual', '年薪（固定年度薪資總額）'], ['contract_months', '約聘月數'], ['bonus_months', '年終月數'], ['fixed', '固定金額']];
const VAR_OPTS = [['', '不分級距（只有一級）'], ['annual', '年薪'], ['monthly', '月薪'], ['contract_months', '約聘月數'], ['level', '職級']];
function cbRow(b = {}) {
  const v = (x) => (x === null || x === undefined ? '' : escapeHtml(String(x)));
  return `<tr class="cb-row">
<td><input class="cb-min" inputmode="decimal" value="${v(b.min)}" style="width:90px"><label style="font-size:12px"><input type="checkbox" class="cb-mini" ${b.min_inclusive === false ? '' : 'checked'}>含</label></td>
<td><input class="cb-max" inputmode="decimal" value="${v(b.max)}" style="width:90px"><label style="font-size:12px"><input type="checkbox" class="cb-maxi" ${b.max_inclusive ? 'checked' : ''}>含</label></td>
<td><input class="cb-level" value="${v(b.level)}" style="width:90px" placeholder="職級名稱"></td>
<td><select class="cb-mode"><option value="percent"${b.mode !== 'multiple' ? ' selected' : ''}>百分比 %</option><option value="multiple"${b.mode === 'multiple' ? ' selected' : ''}>倍數（幾個月／幾倍）</option></select><input class="cb-value" inputmode="decimal" value="${v(b.value)}" style="width:70px"></td>
<td><input class="cb-mo" inputmode="decimal" value="${v(b.months_override)}" style="width:60px" placeholder="—"></td>
<td><input class="cb-minfee" inputmode="numeric" value="${v(b.min_fee)}" style="width:90px" placeholder="—"></td>
<td><input class="cb-maxfee" inputmode="numeric" value="${v(b.max_fee)}" style="width:90px" placeholder="—"></td>
<td><button type="button" class="btn danger sm cb-del">刪</button></td></tr>`;
}
function openCustomBuilder({ pack, catName, cid, reload, me }) {
  const terms = (pack && pack.terms) || {};
  const cur = (terms.categories || []).find((c) => c.name === catName && c.fee_type === 'custom') || { name: '', base: ['monthly'], bracket_var: '', brackets: [{ mode: 'percent' }], installments: [{ label: '一次付清', percent: 100, trigger_unit: 'days', trigger_value: 30 }] };
  const body = `<div id="cb-root">
<p class="help">用積木組出收費算法：<b>計費基礎</b>（勾的項目相乘）×<b>這一級的倍數或百分比</b>。不用寫公式，系統只會照這些格子算。存檔後是草稿，要在規則區塊按「確認生效」才會用來算錢。</p>
<div class="form-grid"><label class="field"><span>類別名稱</span><input id="cb-name" value="${text(cur.name, '')}" placeholder="例：約聘、顧問案"></label>
<label class="field"><span>級距依據</span><select id="cb-var">${VAR_OPTS.map(([k, l]) => `<option value="${k}"${(cur.bracket_var || '') === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label></div>
<div class="field"><span>① 計費基礎（勾選的項目相乘）</span><div style="display:flex;flex-wrap:wrap;gap:12px">${FACTOR_OPTS.map(([k, l]) => `<label style="min-height:44px;display:inline-flex;gap:6px;align-items:center"><input type="checkbox" class="cb-f" value="${k}" ${(cur.base || []).includes(k) ? 'checked' : ''}>${l}</label>`).join('')}
<label style="display:inline-flex;gap:6px;align-items:center">固定金額 <input id="cb-fixed" inputmode="numeric" value="${cur.fixed_value ?? ''}" style="width:100px"></label></div></div>
<div class="field"><span>② 每一級（範圍是「級距依據」的數字；依職級時填職級名稱；計費月數＝約聘月數改用幾個月算）</span>
<div style="overflow-x:auto"><table><thead><tr><th>下限</th><th>上限</th><th>職級</th><th>倍數／百分比</th><th>計費月數</th><th>最低收費</th><th>最高收費</th><th></th></tr></thead><tbody id="cb-rows">${(cur.brackets || []).map(cbRow).join('')}</tbody></table></div>
<button type="button" class="btn sm" id="cb-add">＋ 加一級</button></div>
<label class="field"><span>③ 分期（例：一次付清 100% 10天｜第一期 50% 30天；第二期 25% 3個月；第三期 25% 6個月）</span><input id="cb-inst" value="${text(instToText(cur), '')}"></label>
<div class="card" style="padding:10px;margin-top:8px"><b>④ 試算（存檔前檢查）</b>
<div class="form-grid"><label class="field"><span>月薪</span><input class="cb-s" data-k="monthly" value="40000"></label><label class="field"><span>年薪</span><input class="cb-s" data-k="annual" value="1500000"></label>
<label class="field"><span>約聘月數</span><input class="cb-s" data-k="contract_months" value="8"></label><label class="field"><span>年終月數</span><input class="cb-s" data-k="bonus_months" value="2"></label>
<label class="field"><span>職級</span><input class="cb-s" data-k="level" value="${text(((cur.brackets || [])[0] || {}).level, '')}"></label></div>
<div id="cb-preview" class="help">填好會自動試算</div></div></div>`;
  modal({ title: catName ? `用積木修改「${catName}」` : '新增自訂算法', subtitle: '只能從固定項目選，不能寫公式——系統不會算錯', body, footer: '<button type="button" class="btn primary" id="cb-save">存成草稿</button>' });
  const collect = () => ({
    name: $('#cb-name').value.trim() || '自訂算法', fee_type: 'custom', bracket_var: $('#cb-var').value || null,
    base: $$('.cb-f').filter((x) => x.checked).map((x) => x.value), fixed_value: $('#cb-fixed').value,
    brackets: $$('#cb-rows .cb-row').map((tr) => ({
      min: $('.cb-min', tr).value || null, max: $('.cb-max', tr).value || null, min_inclusive: $('.cb-mini', tr).checked, max_inclusive: $('.cb-maxi', tr).checked,
      level: $('.cb-level', tr).value || null, mode: $('.cb-mode', tr).value, value: $('.cb-value', tr).value,
      months_override: $('.cb-mo', tr).value || null, min_fee: $('.cb-minfee', tr).value || null, max_fee: $('.cb-maxfee', tr).value || null,
    })),
    installments: parseCat('', 'custom', '', $('#cb-inst').value).installments,
  });
  let timer = null;
  const preview = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const sample = Object.fromEntries($$('.cb-s').map((x) => [x.dataset.k, x.value]));
      try {
        const r = await api.post('/admin/billing2/calc-preview', { category: collect(), sample, tax_rate: terms.tax_rate ?? 5 });
        $('#cb-preview').innerHTML = r.ok
          ? `<div>規則：${escapeHtml(r.explain || '')}</div><div style="font-weight:600;margin-top:4px">${escapeHtml(r.formula)}</div>${(r.notes || []).map((n) => `<div style="color:#b26a00">${escapeHtml(n)}</div>`).join('')}
<div style="margin-top:4px">${r.parts.map((x) => `${escapeHtml(x.label)}：${escapeHtml(x.formula)}`).join('<br>')}</div>${r.installments_ok ? '' : '<div style="color:#b26a00">分期還沒填好（各期加起來要 100%），先當一次付清試算</div>'}
<div class="muted" style="margin-top:6px">${(r.trial || []).map((l) => escapeHtml(l)).join('<br>')}</div>`
          : `<div style="color:#c62828">${escapeHtml(r.error || '還算不出來')}</div>${r.explain ? `<div>${escapeHtml(r.explain)}</div>` : ''}`;
      } catch (e) { $('#cb-preview').innerHTML = `<div style="color:#c62828">${escapeHtml(e.message)}</div>`; }
    }, 350);
  };
  const root = $('#cb-root');
  root.addEventListener('input', preview);
  root.addEventListener('change', preview);
  root.addEventListener('click', (e) => {
    if (e.target.closest('.cb-del')) { e.target.closest('tr').remove(); preview(); }
    if (e.target.closest('#cb-add')) { $('#cb-rows').insertAdjacentHTML('beforeend', cbRow({ mode: 'percent' })); }
  });
  preview();
  $('#cb-save').onclick = async () => {
    const cat = collect();
    const cats = (terms.categories || []).filter((c) => c.name !== (catName || cat.name));
    try {
      const r = await api.post('/admin/billing2/terms-save', { company_id: cid, terms: { ...terms, categories: [...cats, cat], manual_items: [] }, by: me() });
      const bad = (r.terms.categories || []).find((c) => c.name === cat.name && c.fee_type === 'manual');
      if (bad) { toast('這個算法還不完整，被存成「需人工設定」，請再檢查格子', 'error'); return; }
      closeOverlay(); toast('已存成草稿，請檢查試算後按「確認生效」', 'success'); reload();
    } catch (e) { toast(e.message, 'error'); }
  };
}

// ───────── 互動 ─────────
if (typeof document !== 'undefined' && !globalThis.__bill2PvWired) {
  globalThis.__bill2PvWired = true;
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('[data-bill2-pv]');
    if (!a) return;
    e.preventDefault();
    preview(`/admin/billing2/file?kind=${encodeURIComponent(a.dataset.bill2Pv)}&id=${encodeURIComponent(a.dataset.id)}`, a.dataset.name || '檔案');
  });
}
export function wireBillingV2({ state, reload, client, rows, cats }) {
  const me = () => getMe() || '顧問';
  const meSel = $('#bill2-me');
  if (meSel) meSel.onchange = () => setMe(meSel.value);
  const cid = state.billingCompany;
  const up = $('#bill2-upload');
  if (up) up.onclick = async () => {
    const fs = [...($('#bill2-files').files || [])];
    if (!fs.length) { toast('先選檔案', 'error'); return; }
    up.disabled = true;
    try {
      const files = [];
      for (const f of fs) files.push({ name: f.name, mime: f.type || 'application/pdf', b64: await readB64(f), doc_type: $('#bill2-doc-type').value });
      const r = await api.post('/admin/billing2/contract-upload', { company_id: cid, files, by: me() });
      toast(`已上傳 ${r.files.length} 個檔案`, 'success'); reload();
    } catch (e) { toast(e.message, 'error'); up.disabled = false; }
  };
  $$('[data-bill2-dl]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); download(`/admin/billing2/file?kind=contract&id=${encodeURIComponent(a.dataset.bill2Dl)}`, '合約'); }; });
  $$('[data-bill2-del]').forEach((a) => { a.onclick = async (e) => {
    e.preventDefault(); if (!window.confirm('從清單移除這個檔案？（已讀出的規則不受影響）')) return;
    await api.post('/admin/billing2/contract-file-delete', { id: a.dataset.bill2Del }); reload();
  }; });
  const rd = $('#bill2-read');
  if (rd) rd.onclick = async () => {
    rd.disabled = true;
    try {
      const r = await api.post('/admin/billing2/contract-read', { company_id: cid, by: me() });
      pollTask(r.task_id, $('#bill2-read-status'), '合約', reload);
    } catch (e) { toast(e.message, 'error'); rd.disabled = false; }
  };
  const confirmBtn = $('[data-bill2-confirm]');
  if (confirmBtn) confirmBtn.onclick = async () => {
    if (!window.confirm('確認這份收費規則生效？之後會用它算金額、擬請款信。')) return;
    confirmBtn.disabled = true;
    try {
      const r = await api.post('/admin/billing2/terms-confirm', { company_id: cid, by: me(), apply_schedule: !!$('#bill2-apply-schedule')?.checked });
      toast(r.message || '已生效', 'success'); reload();
    } catch (e) { toast(e.message, 'error'); confirmBtn.disabled = false; }
  };
  $$('[data-bill2-custom]').forEach((b) => { b.onclick = () => {
    const pack = b.dataset.bill2Custom === 'confirmed' ? client.confirmed : client.draft;
    openCustomBuilder({ pack, catName: b.dataset.cat || '', cid, reload, me });
  }; });
  $$('[data-bill2-edit]').forEach((b) => { b.onclick = () => {
    const pack = b.dataset.bill2Edit === 'confirmed' ? client.confirmed : client.draft;
    const base = (pack && pack.terms) || {};
    modal({ title: '修改收費規則', subtitle: '存檔後是「草稿」，要再按「確認生效」才會用來算錢', body: editorBody(base),
      footer: '<button type="button" class="btn primary" id="bill2-editor-save">存成草稿</button>' });
    $('#bill2-add-cat').onclick = () => {
      const div = document.createElement('div');
      div.innerHTML = editorBody({ categories: [{ name: '', fee_type: 'monthly_multiple', levels: [], installments: [] }] });
      const node = div.querySelector('.bill2-cat');
      node.insertAdjacentHTML('beforeend', '<button type="button" class="btn danger sm c-del">刪除這類</button>');
      $('#bill2-add-cat').before(node);
    };
    $('#bill2-editor').addEventListener('click', (e) => { if (e.target.closest('.c-del')) e.target.closest('.bill2-cat').remove(); });
    $('#bill2-editor-save').onclick = async () => {
      try {
        const r = await api.post('/admin/billing2/terms-save', { company_id: cid, terms: collectEditor(base), by: me() });
        closeOverlay();
        toast((r.terms.manual_items || []).length ? `已存成草稿，還有 ${r.terms.manual_items.length} 項需人工設定` : '已存成草稿，請檢查試算後按「確認生效」', 'success');
        reload();
      } catch (e) { toast(e.message, 'error'); }
    };
  }; });
  $$('.bill2-sched').forEach((box) => {
    box.addEventListener('click', async (e) => {
      if (e.target.closest('.s-del')) { e.target.closest('tr').remove(); return; }
      if (e.target.closest('.s-add')) { const tb = $('tbody', box); tb.insertAdjacentHTML('beforeend', schedRow({ trigger_unit: 'days', trigger_value: 30 }, tb.children.length)); return; }
      if (e.target.closest('.s-save')) {
        const tiers = $$('tbody tr', box).map((tr, i) => ({ label: $('.s-label', tr).value.trim() || `第${i + 1}期`, percent: Number($('.s-pct', tr).value) || 0, trigger_unit: $('.s-unit', tr).value, trigger_value: Number($('.s-val', tr).value) || 0 }));
        try { await api.post('/admin/billing2/schedule-save', { company_id: cid, category: box.dataset.cat, tiers }); toast(`「${box.dataset.cat}」的分期已儲存（只影響之後報到的人選）`, 'success'); reload(); }
        catch (err) { toast(err.message, 'error'); }
      }
    });
  });
  $$('.bill2-row').forEach((row) => { row.onclick = () => openPlacement(row.dataset.pid, rows, cats, reload); });
  // 從 TG 提醒卡的「上傳發票」連過來：?company=…&inst=…
  const qs = new URLSearchParams(location.search);
  const instQ = qs.get('inst');
  if (instQ && !state.billingInstOpened) {
    state.billingInstOpened = true;
    const hit = (rows || []).find((x) => String(x.id) === instQ);
    if (hit) { openPlacement(String(hit.placement_id), rows, cats, reload); setTimeout(() => $(`[data-bill2-inv="${instQ}"]`)?.click(), 50); }
  }
}

function pollTask(taskId, box, what, done) {
  let n = 0;
  const tick = async () => {
    n++;
    try {
      const s = await api.get(`/admin/billing2/read-status?id=${encodeURIComponent(taskId)}`);
      if (s.status === 'done') { if (box) box.innerHTML = `<p class="help">✅ ${escapeHtml(what)}讀完了${s.kind === 'contract' ? '，TG 也貼了確認卡' : ''}</p>`; done && done(s); return; }
      if (s.status === 'error') { if (box) box.innerHTML = `<p class="help" style="color:#c62828">❌ ${escapeHtml(s.error || '讀取失敗')}</p>`; return; }
      if (box) box.innerHTML = `<p class="help">🤖 AI 正在讀${escapeHtml(what)}…（${s.status === 'queued' ? '排隊中' : '讀取中'}，約 2～5 分鐘，可以先離開這頁）</p>`;
    } catch (e) { if (box) box.innerHTML = `<p class="help">查詢狀態失敗：${escapeHtml(e.message)}</p>`; }
    if (n < 80) setTimeout(tick, 6000);
  };
  tick();
}

function openPlacement(pid, rows, cats, reload) {
  const g = (rows || []).filter((x) => String(x.placement_id) === String(pid));
  if (!g.length) return;
  const r = g[0];
  modal({ title: `${r.candidate_name}｜收費明細`, subtitle: `${r.company_name || r.client_name || ''}・${r.job_title || r.offer_title || ''}`, body: placementBody(g, cats) });
  const me = () => getMe() || '顧問';
  const refresh = async () => {
    const d = await billing2Api.placements(r.client_id);
    const rows2 = d.installments || [];
    openPlacement(pid, rows2, d.categories || cats, reload);
    reload(true);
  };
  const save = $('#bill2-fee-save');
  if (save) save.onclick = async () => {
    const body = { placement_id: Number(pid), monthly_salary: $('#bill2-ms').value, annual_salary: $('#bill2-as').value, contract_months: $('#bill2-cm').value };
    if ($('#bill2-bm')) body.bonus_months = $('#bill2-bm').value;
    if ($('#bill2-cat')) body.category = $('#bill2-cat').value;
    if ($('#bill2-lv')) body.level = $('#bill2-lv').value;
    try {
      const x = await api.post('/admin/billing2/placement-fee', body);
      toast(x.recompute && x.recompute.ok ? '已重算' : `已存，但還算不出金額：${x.recompute && x.recompute.error}`, x.recompute && x.recompute.ok ? 'success' : 'error');
      refresh();
    } catch (e) { toast(e.message, 'error'); }
  };
  const ob = $('#bill2-offer-read');
  if (ob) ob.onclick = async () => {
    ob.disabled = true;
    try { const x = await api.post('/admin/billing2/offer-read', { placement_id: Number(pid), by: me() }); pollTask(x.task_id, $('#bill2-offer-status'), '聘書', () => refresh()); }
    catch (e) { toast(e.message, 'error'); ob.disabled = false; }
  };
  $$('[data-bill2-inv-dl]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); download(`/admin/billing2/file?kind=invoice&id=${encodeURIComponent(a.dataset.bill2InvDl)}`, '發票'); }; });
  $$('[data-bill2-paid]').forEach((b) => { b.onclick = async () => {
    try { await api.post('/admin/billing-installments/mark-paid', { id: Number(b.dataset.bill2Paid), paid: b.dataset.v === '1', by: me() }); toast('已更新', 'success'); refresh(); }
    catch (e) { toast(e.message, 'error'); }
  }; });
  $$('[data-bill2-inv]').forEach((b) => { b.onclick = () => {
    const id = b.dataset.bill2Inv;
    const it = g.find((x) => String(x.id) === id) || {};
    const box = $(`[data-inline-for="${id}"]`);
    box.innerHTML = `<div class="card" style="padding:10px;margin-top:6px"><b>${it.invoice_no ? '改發票' : '上傳發票'}（${text(it.label)}）</b>
<p class="help" style="margin:4px 0">先把發票 PDF／圖片拖進來，AI 會自動讀出號碼、日期、金額填好，你看一眼再按存檔。系統算的這一期：含稅 <b>${fmt(it.amount_taxed)}</b>（未稅 ${fmt(it.amount_untaxed)}＋稅 ${fmt(it.amount_tax)}）</p>
<label class="field span-2"><span>發票檔（PDF 或圖片）${it.invoice_file_id ? '，不選＝沿用原檔' : ''}</span><input type="file" class="i-file" accept=".pdf,image/png,image/jpeg"></label>
<div class="i-ai"></div>
<div class="form-grid"><label class="field"><span>發票號碼</span><input class="i-no" value="${text(it.invoice_no, '')}" placeholder="EC51601555"></label>
<label class="field"><span>開立日期</span><input type="date" class="i-date" value="${text(it.invoice_date, '')}"></label>
<label class="field"><span>發票金額（含稅）</span><input class="i-amt" inputmode="numeric" value="${it.invoice_amount ?? it.amount_taxed ?? ''}"></label></div>
<div class="i-check"></div>
<label style="display:flex;gap:6px;align-items:center;min-height:44px"><input type="checkbox" class="i-card" checked> 存好後擬請款信、貼確認卡到客戶的 TG 主題（按「確認寄出」才會寄）</label>
<div class="actions-row"><button type="button" class="btn primary i-save">存檔</button><button type="button" class="btn i-cancel">取消</button></div></div>`;
    let uploadedFileId = null; let aiChecks = [];
    const checkBox = $('.i-check', box); const aiBox = $('.i-ai', box);
    const renderChecks = () => {
      const amt = Number(String($('.i-amt', box).value || '').replace(/[,\s]/g, ''));
      const lines = aiChecks.filter((c) => !/^金額/.test(c.text));
      if (amt && it.amount_taxed != null) lines.unshift(amt === Number(it.amount_taxed) ? { ok: true, text: `金額對得上：含稅 ${fmt(amt)}` } : { ok: false, text: `金額對不上：發票 ${fmt(amt)}／系統 ${fmt(it.amount_taxed)}` });
      checkBox.innerHTML = lines.map((c) => `<div style="color:${c.ok ? '#2e7d32' : '#c62828'};font-weight:600">${c.ok ? '✅' : '🔴'} ${escapeHtml(c.text)}</div>`).join('');
    };
    $('.i-amt', box).addEventListener('input', renderChecks);
    renderChecks();
    const flash = (el) => { el.style.transition = 'background-color .2s'; el.style.backgroundColor = '#c8e6c9'; setTimeout(() => { el.style.transition = 'background-color 1.6s'; el.style.backgroundColor = ''; }, 900); };
    const applyResult = (x, label) => {
      const filled = [];
      if (x.invoice_no) { $('.i-no', box).value = x.invoice_no; filled.push($('.i-no', box)); }
      if (x.invoice_date) { $('.i-date', box).value = x.invoice_date; filled.push($('.i-date', box)); }
      if (x.total != null) { $('.i-amt', box).value = x.total; filled.push($('.i-amt', box)); }
      filled.forEach(flash);
      aiChecks = x.checks || [];
      aiBox.innerHTML = `<p class="help" style="color:#2e7d32;font-weight:600">✅ 已自動帶入${escapeHtml(label || '')}，請看一眼再按存檔</p><p class="help">AI 讀到：${escapeHtml([x.invoice_no, x.invoice_date, x.buyer, x.buyer_tax_id && `統編 ${x.buyer_tax_id}`, x.untaxed != null && `未稅 ${fmt(x.untaxed)}`, x.tax != null && `稅 ${fmt(x.tax)}`, x.total != null && `含稅 ${fmt(x.total)}`].filter(Boolean).join('｜'))}</p>`;
      renderChecks();
    };
    let pollGen = 0;
    const startPoll = (taskId, startedMs, label) => {
      const gen = ++pollGen;
      const timer = setInterval(() => {
        if (!box.isConnected || gen !== pollGen) { clearInterval(timer); return; }
        const sec = Math.max(0, Math.round((Date.now() - startedMs) / 1000));
        const el = $('.i-wait', box);
        if (el) el.textContent = `🤖 AI 讀發票中…（大約 1 分鐘，已等 ${sec} 秒）讀完會自動填進下面的欄位；讀不出來也可以自己填，不影響存檔。關掉這個視窗也沒關係，下次打開會自動帶入。`;
      }, 1000);
      aiBox.innerHTML = '<p class="help i-wait">🤖 AI 讀發票中…（大約 1 分鐘）</p>';
      let n = 0;
      const tick = async () => {
        if (!box.isConnected || gen !== pollGen) { clearInterval(timer); return; }
        n++;
        const st = await api.get(`/admin/billing2/read-status?id=${encodeURIComponent(taskId)}`).catch(() => null);
        if (st && st.status === 'done' && st.result) { clearInterval(timer); applyResult(st.result, label); return; }
        if (st && st.status === 'error') { clearInterval(timer); aiBox.innerHTML = `<p class="help" style="color:#b26a00">AI 沒讀出來（${escapeHtml(st.error || '')}），請自己填，檔案已經收到了</p>`; return; }
        if (n < 90) setTimeout(tick, 3000); else { clearInterval(timer); aiBox.innerHTML = '<p class="help" style="color:#b26a00">AI 讀太久了，請自己填，檔案已經收到了</p>'; }
      };
      tick();
    };
    // 上次讀過（例如讀到一半關掉視窗）→ 直接帶入或接著等
    api.get(`/admin/billing2/invoice-read-latest?id=${encodeURIComponent(id)}`).then((lr) => {
      const t = lr && lr.task;
      if (!t || !t.file_id || uploadedFileId || $('.i-file', box).files.length) return;
      uploadedFileId = t.file_id;
      const started = Date.parse(String(t.created_at).replace(' ', 'T') + '+08:00') || Date.now();
      if (t.status === 'done' || t.status === 'queued' || t.status === 'working') startPoll(t.task_id, started, `（上次讀的「${t.name || '發票'}」）`);
    }).catch(() => {});
    $('.i-file', box).addEventListener('change', async () => {
      const f = $('.i-file', box).files[0];
      if (!f) return;
      uploadedFileId = null; aiChecks = []; pollGen++;
      aiBox.innerHTML = '<p class="help">⬆️ 上傳發票檔中…</p>';
      try {
        const t0 = Date.now();
        const r = await api.post('/admin/billing2/invoice-read', { id: Number(id), file: { name: f.name, mime: f.type || 'application/pdf', b64: await readB64(f) }, by: me() });
        uploadedFileId = r.file_id;
        startPoll(r.task_id, t0, '');
      } catch (e) { aiBox.innerHTML = `<p class="help" style="color:#b26a00">檔案沒送出去：${escapeHtml(e.message)}。可以重選一次，或存檔時直接附上</p>`; }
    });
    $('.i-cancel', box).onclick = () => { box.innerHTML = ''; };
    $('.i-save', box).onclick = async () => {
      const f = $('.i-file', box).files[0];
      const body = { id: Number(id), invoice_no: $('.i-no', box).value, invoice_date: $('.i-date', box).value, amount: $('.i-amt', box).value, by: me(), post_card: $('.i-card', box).checked };
      if (uploadedFileId) body.file_id = uploadedFileId;
      else if (f) body.file = { name: f.name, mime: f.type || 'application/pdf', b64: await readB64(f) };
      $('.i-save', box).disabled = true;
      try {
        const x = await api.post('/admin/billing2/invoice', body);
        if (x.warning) toast(x.warning, 'error');
        if (x.card && !x.card.ok) toast(`發票已存，但請款信沒擬成：${x.card.error}`, 'error');
        else toast(x.card ? '發票已存，請款信確認卡已貼到 TG（還沒寄）' : '發票已存', 'success');
        refresh();
      } catch (e) { toast(e.message, 'error'); $('.i-save', box).disabled = false; }
    };
  }; });
  $$('[data-bill2-mail]').forEach((b) => { b.onclick = async () => {
    const id = b.dataset.bill2Mail; const kind = b.dataset.kind;
    const box = $(`[data-inline-for="${id}"]`);
    box.innerHTML = '<p class="help">產生預覽中…</p>';
    try {
      const m = await api.post('/admin/billing2/mail', { id: Number(id), kind });
      box.innerHTML = `<div class="card" style="padding:10px;margin-top:6px"><b>${kind === 'dun' ? '催款信' : '請款信'}預覽</b>
<div class="muted" style="font-size:13px">收件：${text(m.to)}｜主旨：${text(m.subject)}｜附件：${m.files.length ? m.files.map((f) => text(f.filename)).join('、') : '（沒有）'}</div>
<div style="font-size:13px">算式：${text(m.formula)}</div>
${m.first ? '<div style="color:#b26a00;font-weight:600">⚠️ 這是這家客戶第一次用系統請款，請對照合約確認金額</div>' : ''}
${(m.warnings || []).map((w) => `<div style="color:#b26a00">${escapeHtml(w)}</div>`).join('')}
<pre style="white-space:pre-wrap;font-family:inherit;background:var(--soft,#f6f7f9);padding:10px;border-radius:8px;max-height:360px;overflow:auto">${escapeHtml(m.text)}</pre>
<div class="actions-row"><button type="button" class="btn primary m-post">📨 貼確認卡到 TG（還不會寄）</button><button type="button" class="btn m-cancel">關閉</button></div></div>`;
      $('.m-cancel', box).onclick = () => { box.innerHTML = ''; };
      $('.m-post', box).onclick = async () => {
        $('.m-post', box).disabled = true;
        try { await api.post('/admin/billing2/mail', { id: Number(id), kind, post: true, by: me() }); toast('確認卡已貼到客戶的 TG 主題，按「確認寄出」才會寄', 'success'); refresh(); }
        catch (e) { toast(e.message, 'error'); $('.m-post', box).disabled = false; }
      };
    } catch (e) { box.innerHTML = `<p class="help" style="color:#c62828">${escapeHtml(e.message)}</p>`; }
  }; });
}
