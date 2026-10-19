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
<span><a href="#" data-bill2-dl="${text(f.id)}">下載</a>&emsp;<a href="#" data-bill2-del="${text(f.id)}" style="color:#c62828">移除</a></span></div>`).join('') : empty('還沒上傳已簽合約');
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
<span>${paid}/${g.length} 期已收・${inv} 期已開票</span></div>`;
  }).join('');
  return `<div class="notice">收費進程：選客戶 → 上傳已簽合約、讓 AI 讀出收費規則並確認 → 系統依人選的計費月薪自動算每期金額 → 每期開好發票上傳，系統擬好請款信貼到 TG，按「確認寄出」才會寄。到期前 7 天、當天、逾期每週會在客戶的 TG 主題提醒。</div>
<div class="card"><h2>選客戶</h2><div class="form-grid"><label class="field"><span>客戶</span><select id="billing-company-select"><option value="">－－選一家客戶（不選＝看全部人選）－－</option>${opts}</select></label>${meSel}</div></div>
${contractCard}
${companyId ? `<div class="card" style="margin-top:14px"><h2>分期範本（之後報到的人選照這個自動排期）</h2><p class="help">合約規則按「確認生效」時會自動帶入；也可以在這裡手動改。改範本不會回頭改已經排好的人選。</p>${planHtml}</div>` : ''}
<div class="card" style="margin-top:14px"><h2>收費進度</h2><p class="help">點一列看每一期的金額、算式、發票，以及上傳發票、擬請款信。</p><div class="list">${list}</div></div>`;
}

function instRow(r) {
  const st = r.paid_at || r.confirmed_received === 'yes' ? '<span class="badge success">已收款</span>'
    : r.invoice_no ? '<span class="badge">已開票</span>' : '<span class="badge warning">未開票</span>';
  const amt = r.amount_taxed != null
    ? `<div>未稅 ${fmt(r.amount_untaxed)}＋稅 ${fmt(r.amount_tax)}＝<b>含稅 ${fmt(r.amount_taxed)}</b></div><div class="muted" style="font-size:13px">算式：${text(r.amount_formula)}</div>`
    : '<div class="muted">金額還沒算出來（要先有計費月薪＋已生效的合約規則）</div>';
  const inv = r.invoice_no
    ? `<div>發票 ${text(r.invoice_no)}・${text(r.invoice_date)}・金額 ${fmt(r.invoice_amount)}${r.invoice_amount != null && r.amount_taxed != null && Number(r.invoice_amount) !== Number(r.amount_taxed) ? ' <b style="color:#c62828">（跟系統算的不一樣）</b>' : ''}
 <a href="#" data-bill2-inv-dl="${text(r.id)}">下載發票</a><br><small class="muted">${text(r.invoice_uploaded_by, '—')} 上傳於 ${text(String(r.invoice_uploaded_at || '').slice(0, 16))}</small></div>` : '';
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
  const catOpts = (cats || []).map((c) => `<option${(r.fee_category || cats[0]?.name) === c.name ? ' selected' : ''}>${text(c.name)}</option>`).join('');
  const cur = (cats || []).find((c) => c.name === (r.fee_category || cats[0]?.name));
  const lvOpts = cur && cur.levels && cur.levels.length ? cur.levels.map((l) => `<option${r.fee_level === l ? ' selected' : ''}>${text(l)}</option>`).join('') : '';
  const src = { offer_ai: 'AI 從聘書讀的', manual: '顧問手動填的' }[r.fee_salary_source] || '還沒有';
  return `<p class="muted" style="margin:0 0 6px">報到 ${text(r.onboard_date)}・聘書：${r.offer_file_id ? text(r.offer_file_name || '有') : '還沒上傳'}</p>
<div class="card" style="padding:12px"><b>計費基礎</b>
<div class="form-grid" style="margin-top:6px">
<label class="field"><span>計費月薪（${escapeHtml(src)}）</span><input id="bill2-ms" inputmode="numeric" value="${r.fee_monthly_salary != null ? text(r.fee_monthly_salary) : ''}" placeholder="例：40833"></label>
<label class="field"><span>年薪（年薪百分比類才需要）</span><input id="bill2-as" inputmode="numeric" value="${r.fee_annual_salary != null ? text(r.fee_annual_salary) : ''}"></label>
${catOpts ? `<label class="field"><span>收費類別</span><select id="bill2-cat">${catOpts}</select></label>` : ''}
${lvOpts ? `<label class="field"><span>職級</span><select id="bill2-lv">${lvOpts}</select></label>` : ''}
</div>
<div class="actions-row"><button type="button" class="btn primary" id="bill2-fee-save">儲存並重算</button>
${r.offer_file_id ? '<button type="button" class="btn" id="bill2-offer-read">🤖 AI 讀聘書月薪</button>' : ''}<span id="bill2-offer-status" class="muted"></span></div>
<div style="margin-top:6px">${r.fee_formula ? `服務報酬：${text(r.fee_formula)}<br>總額 未稅 ${fmt(r.fee_total_untaxed)}＋稅 ${fmt(r.fee_tax)}＝含稅 <b>${fmt(r.fee_total_taxed)}</b>` : ''}
${r.fee_note ? `<div style="color:#b26a00">${text(r.fee_note)}</div>` : ''}</div></div>
<div class="list" style="margin-top:10px">${g.map((x) => instRow(x)).join('')}</div>`;
}

// ───────── 規則編輯（簡單文字格式，讓非工程背景也改得動） ─────────
function catToText(c) {
  if (c.fee_type === 'monthly_multiple') return (c.levels || []).map((l) => `${l.name}=${l.months}`).join('，');
  if (c.fee_type === 'annual_percent') return (c.brackets || []).map((b) => `${b.min ?? ''}-${b.max ?? ''}:${b.percent}${b.min_fee ? `:${b.min_fee}` : ''}`).join('；');
  if (c.fee_type === 'fixed_amount') return String(c.amount || '');
  return '';
}
const instToText = (c) => (c.installments || []).map((x) => `${x.label} ${x.percent}% ${x.trigger_value}${x.trigger_unit === 'months' ? '個月' : '天'}`).join('；');
function parseCat(name, type, feeText, instText) {
  const c = { name, fee_type: type };
  const parts = String(feeText || '').split(/[，,；;\n]/).map((s) => s.trim()).filter(Boolean);
  if (type === 'monthly_multiple') c.levels = parts.map((p) => { const [n, m] = p.split(/[=＝:：]/); return { name: (n || '').trim(), months: Number(m) }; });
  if (type === 'annual_percent') c.brackets = parts.map((p) => { const [rng, pct, mf] = p.split(/[:：]/); const [mi, ma] = String(rng || '').split(/[-～~]/); return { min: mi ? Number(mi.replace(/,/g, '')) : null, max: ma ? Number(ma.replace(/,/g, '')) : null, percent: Number(pct), min_fee: mf ? Number(mf.replace(/,/g, '')) : null }; });
  if (type === 'fixed_amount') c.amount = Number(String(feeText).replace(/[,\s]/g, ''));
  c.installments = String(instText || '').split(/[；;\n]/).map((s) => s.trim()).filter(Boolean).map((s) => {
    const m = s.match(/^(.*?)\s*([\d.]+)\s*%\s*(\d+)\s*(個月|月|天|日)/);
    return m ? { label: m[1].trim() || undefined, percent: Number(m[2]), trigger_value: Number(m[3]), trigger_unit: /月/.test(m[4]) ? 'months' : 'days' } : { label: s, percent: null };
  });
  return c;
}
function editorBody(t) {
  const cats = (t.categories && t.categories.length ? t.categories : [{ name: '正職代招', fee_type: 'monthly_multiple', levels: [], installments: [] }]);
  const typeOpts = (v) => [['monthly_multiple', '月薪倍數（依職級）'], ['annual_percent', '固定年薪百分比（依級距）'], ['fixed_amount', '固定金額'], ['manual', '需人工設定（系統不算）']]
    .map(([k, l]) => `<option value="${k}"${v === k ? ' selected' : ''}>${l}</option>`).join('');
  const catRows = cats.map((c, i) => `<div class="bill2-cat" style="border:1px dashed #ccc;border-radius:8px;padding:8px;margin-bottom:8px">
<div class="form-grid"><label class="field"><span>類別名稱</span><input class="c-name" value="${text(c.name, '')}"></label>
<label class="field"><span>收費型態</span><select class="c-type">${typeOpts(c.fee_type)}</select></label>
<label class="field span-2"><span>收費內容（月薪倍數：一般職員=1.5，管理職=2｜年薪百分比：0-1399999:20:200000；1400000-2000000:25；2000001-:26（下限-上限:百分比:最低服務費）｜固定金額：50000）</span><input class="c-fee" value="${text(catToText(c), '')}"></label>
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
  const cats = $$('#bill2-editor .bill2-cat').map((el) => parseCat($('.c-name', el).value.trim(), $('.c-type', el).value, $('.c-fee', el).value, $('.c-inst', el).value));
  const capType = $('#e-cap-type').value;
  return { ...base, categories: cats, pay_within_days: $('#e-days').value, pay_from: $('#e-from').value, tax_rate: $('#e-tax').value,
    late_fee: { ...(base.late_fee || {}), text: $('#e-late').value || null, type: $('#e-late').value ? ((base.late_fee && base.late_fee.type !== 'none' && base.late_fee.type) || 'other') : 'none' },
    bank: { payee: $('#e-payee').value, bank_name: $('#e-bank').value, bank_code: $('#e-code').value, account: $('#e-acct').value },
    invoice_title: $('#e-title').value, tax_id: $('#e-taxid').value, legal_cap: $('#e-cap').checked,
    legal_cap_rule: capType ? { type: capType, value: $('#e-cap-val').value } : null,
    manual_items: [] };
}

// ───────── 互動 ─────────
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
    const body = { placement_id: Number(pid), monthly_salary: $('#bill2-ms').value, annual_salary: $('#bill2-as').value };
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
<div class="form-grid"><label class="field"><span>發票號碼</span><input class="i-no" value="${text(it.invoice_no, '')}" placeholder="EC51601555"></label>
<label class="field"><span>開立日期</span><input type="date" class="i-date" value="${text(it.invoice_date, '')}"></label>
<label class="field"><span>發票金額（含稅）</span><input class="i-amt" inputmode="numeric" value="${it.invoice_amount ?? it.amount_taxed ?? ''}"></label>
<label class="field"><span>發票檔（PDF 或圖片）${it.invoice_file_id ? '，不選＝沿用原檔' : ''}</span><input type="file" class="i-file" accept=".pdf,image/png,image/jpeg"></label></div>
<label style="display:flex;gap:6px;align-items:center;min-height:44px"><input type="checkbox" class="i-card" checked> 存好後擬請款信、貼確認卡到客戶的 TG 主題（按「確認寄出」才會寄）</label>
<div class="actions-row"><button type="button" class="btn primary i-save">存檔</button><button type="button" class="btn i-cancel">取消</button></div></div>`;
    $('.i-cancel', box).onclick = () => { box.innerHTML = ''; };
    $('.i-save', box).onclick = async () => {
      const f = $('.i-file', box).files[0];
      const body = { id: Number(id), invoice_no: $('.i-no', box).value, invoice_date: $('.i-date', box).value, amount: $('.i-amt', box).value, by: me(), post_card: $('.i-card', box).checked };
      if (f) body.file = { name: f.name, mime: f.type || 'application/pdf', b64: await readB64(f) };
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
