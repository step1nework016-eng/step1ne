// 2026-11-04 Jacky：派遣模式第一階段（畫面）。後端在 backoffice-worker src/dispatch.js，全部走 /admin/dispatch/*。
// 共用資料，只切畫面：職缺、人選卡還是原本那張。切換＝換左邊選單，不是另一套系統。
// ⚠️ 這支檔案任何人都下載得到：不准寫客戶名、費率數字；條款一律從登入後的 API 讀。
import { api } from './core/api.js';
import { ROUTES } from './config.js';
import { $, $$, closeOverlay, closeSubDrawer, empty, errorState, loading, modal, toast } from './core/ui.js';
import { escapeHtml, text } from './core/security.js';
import { fileButtons, wireFileButtons } from './filepreview.js';

const esc = escapeHtml;
const MODE_KEY = 's1ne_work_mode';
export const DISPATCH_NAV = [
  ['d_today', '今日待辦', '☑'], ['d_people', '派遣人選', '◉'], ['d_jobs', '派遣需求', '▣'],
  ['d_clients', '要派客戶', '♙'], ['d_settlement', '每月結算', '▦'], ['library', '書櫃', '▤'],
];
const DISPATCH_ONLY = new Set(DISPATCH_NAV.map(([k]) => k).filter((k) => k !== 'library'));
export const isDispatchRoute = (key) => DISPATCH_ONLY.has(key);
const readMode = () => { try { return localStorage.getItem(MODE_KEY) || 'recruit'; } catch { return 'recruit'; } };
// 網址決定模式：派遣專屬頁＝派遣；書櫃兩邊共用，維持原本的模式；其他頁＝招募。
export function modeOf(key) {
  const mode = isDispatchRoute(key) ? 'dispatch' : key === 'library' ? readMode() : 'recruit';
  try { localStorage.setItem(MODE_KEY, mode); } catch { /* 無痕模式存不了就算了 */ }
  return mode;
}
// 上次停在派遣模式，再打開後台首頁就回派遣
export const shouldOpenDispatchHome = () => location.pathname.replace(/\/?$/, '/') === ROUTES.home && readMode() === 'dispatch';
export const modeSwitchHtml = (mode) => `<div class="mode-switch" role="group" aria-label="工作模式"><button type="button" class="${mode === 'recruit' ? 'on' : ''}" data-route="daily"${mode === 'recruit' ? ' aria-pressed="true"' : ' aria-pressed="false"'}>招募</button><button type="button" class="${mode === 'dispatch' ? 'on' : ''}" data-route="d_today"${mode === 'dispatch' ? ' aria-pressed="true"' : ' aria-pressed="false"'}>派遣</button></div>`;

const head = (title, sub, actions = '') => `<div class="page-head"><div><h1>${title}</h1><p>${sub}</p></div><div class="actions">${actions}</div></div>`;
const page = (title, sub, actions = '') => head(title, sub, actions) + '<div id="page-data"></div>';
export const dispatchViews = {
  d_today: () => page('今日待辦', '只列要人處理的事，點一下就到那一頁。'),
  d_people: () => page('派遣人選', '每個人只有一個下一步，做完按它。', '<button class="btn primary" data-dsp="find-candidate">加人</button>'),
  d_jobs: () => page('派遣需求', '還在找的在上面，要你決定的在下面。'),
  d_clients: () => page('要派客戶', '每家客戶一份條款，算錢都從這裡來。', '<button class="btn" data-dsp="new-client">新增客戶</button>'),
  d_settlement: () => page('每月結算', '系統算好，核對後按確認。按確認不會寄信，也不會動錢。'),
};

const me = () => ($('[data-me-global]') || {}).value || '';
const money = (n) => (n === null || n === undefined || n === '' ? '—' : Math.round(Number(n)).toLocaleString('en-US'));
const STATE_LABEL = { bad: '要處理', warn: '要注意', ok: '沒問題' };
const STATE_BADGE = { bad: 'danger', warn: 'warning', ok: 'success' };
const CLASS_LABEL = { nontech: '非技術', tech: '技術' };
const SHEET = { visible: ['客戶表上有', 'success'], not_visible: ['客戶表上看不到', 'warning'], other_sheet: ['這張表查不到', ''], not_in_system: ['系統還沒建', 'danger'] };
const CONSENT = { pending: ['還沒問', 'warning'], agreed: ['已同意', 'success'], declined: ['不同意', 'danger'] };
const badge = (label, tone = '') => `<span class="badge ${tone}">${text(label)}</span>`;
const thisYm = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 7);
const field = (label, html, cls = '') => `<label class="field ${cls}"><span>${label}</span>${html}</label>`;
let hooks = { openCandidate: () => {}, openJob: () => {} };
const ui = { company: '', ym: '', stages: [] };

export function initDispatch(h) { hooks = { ...hooks, ...h }; }

export async function loadDispatchRoute(route, target) {
  const loaders = { d_today: loadToday, d_people: loadPeople, d_jobs: loadJobs, d_clients: loadClients, d_settlement: loadSettlement };
  target.innerHTML = loading();
  try { await loaders[route](target); } catch (e) { console.error(e); target.innerHTML = errorState(e); }
}
const reload = () => { const t = $('#page-data'); const k = Object.entries(ROUTES).find(([, p]) => p === location.pathname.replace(/\/?$/, '/')); if (t && k && isDispatchRoute(k[0])) loadDispatchRoute(k[0], t); };

// ── 今日待辦 ──
async function loadToday(target) {
  const d = await api.get('/admin/dispatch/today');
  const jump = { client: 'd_clients', jobs: 'd_jobs', person: 'd_people' };
  const sorted = [...d.todos.filter((x) => x.level === 'bad'), ...d.todos.filter((x) => x.level !== 'bad')];
  target.innerHTML = sorted.length
    ? `<div class="list">${sorted.map((x) => `<button type="button" class="list-row dsp-todo ${x.level}" data-route="${jump[x.kind] || 'd_today'}"><span><b>${text(x.title)}</b><small>${text(x.detail)}</small></span>${badge(STATE_LABEL[x.level] || '要注意', STATE_BADGE[x.level] || 'warning')}</button>`).join('')}</div>`
    : empty('今天沒有要處理的事');
}

// ── 派遣人選（進度也在這裡，不另開一頁）──
function personName(x) { return x.name || '（沒有姓名）'; }
// 每個階段只有一個下一步
const NEXT = {
  consent_pending: '人選同意了', consented: '送客戶技能確認', skill_check: '客戶確認了，簽勞動契約', contract: '開始上工', active: '結束派遣',
};
async function loadPeople(target) {
  const d = await api.get('/admin/dispatch/people');
  ui.stages = d.stages || [];
  target.__people = d.people;
  const stageLabel = Object.fromEntries(ui.stages);
  const nameBtn = (name, app) => (app ? `<button type="button" class="dsp-link" data-dsp="open-card" data-app="${esc(app)}">${text(name)}</button>` : `<b>${text(name)}</b>`);
  const row = (x) => `<article class="list-row dsp-person"><span>${nameBtn(personName(x), x.application_id)}<small>${text(stageLabel[x.stage] || x.stage)}・${text(x.company_name || '還沒配客戶')}${x.job_title ? '・' + text(x.job_title) : ''}</small></span><span class="actions-row" style="flex:none;margin:0">${NEXT[x.stage] ? `<button type="button" class="btn ${x.stage === 'active' ? '' : 'primary'} sm" data-dsp="next-step" data-id="${esc(x.id)}">${NEXT[x.stage]}</button>` : ''}<button type="button" class="btn ghost sm" data-dsp="edit-person" data-id="${esc(x.id)}">修改</button></span></article>`;
  const appRow = (a) => `<article class="list-row dsp-person"><span>${nameBtn(a.name || '（沒有姓名）', a.id)}<small>應徵派遣職缺・${text(a.company_name || '')}・${text(a.job_title || a.job_slug)}</small></span><span class="actions-row" style="flex:none;margin:0"><button type="button" class="btn primary sm" data-dsp="transfer" data-app="${esc(a.id)}" data-job="${esc(a.job_slug || '')}">記錄同意</button></span></article>`;
  const apps = (d.applicants || []).filter((a) => !a.closed_stage);
  const todo = d.people.filter((x) => !['active', 'ended', 'converted'].includes(x.stage));
  const active = d.people.filter((x) => x.stage === 'active');
  const past = d.people.filter((x) => ['ended', 'converted'].includes(x.stage));
  const n = todo.length + apps.length;
  target.innerHTML = `<article class="card"><h2>等你處理（${n}）</h2>${n ? `<div class="list">${todo.map(row).join('')}${apps.map(appRow).join('')}</div>` : '<p class="muted">目前沒有。</p>'}</article>
    <article class="card" style="margin-top:14px"><h2>在職派遣（${active.length}）</h2>${active.length ? `<div class="list">${active.map(row).join('')}</div>` : '<p class="muted">系統裡還沒有。實際有人在上班的話，按右上角「加人」登記。</p>'}</article>
    ${past.length ? `<details class="card" style="margin-top:14px"><summary><b>已結束（${past.length}）</b></summary><div class="list" style="margin-top:10px">${past.map(row).join('')}</div></details>` : ''}`;
}
function currentPeople() { return ($('#page-data') || {}).__people || []; }
const jobOptions = (items, cur) => items.map((j) => `<option value="${esc(j.slug)}"${cur === j.slug ? ' selected' : ''}>${esc(j.title)}</option>`).join('');
// 下一步：只問這一步需要的欄位，不需要就直接做
async function nextStep(id) {
  const x = currentPeople().find((p) => p.id === id);
  if (!x) return;
  const needJob = !x.job_slug;
  const jobs = needJob || x.stage === 'contract' ? await api.get('/admin/dispatch/jobs') : { items: [] };
  const form = {
    consent_pending: field('怎麼確認同意的', `<input id="dn-note" value="${esc(x.consent_note || '')}" placeholder="例：11/4 電話口頭同意">`),
    consented: needJob ? field('要送哪個職缺', `<select id="dn-job"><option value="">請選</option>${jobOptions(jobs.items, x.job_slug)}</select>`) : '',
    contract: `<div class="form-grid">${needJob ? field('派遣職缺', `<select id="dn-job"><option value="">請選</option>${jobOptions(jobs.items, x.job_slug)}</select>`, 'span-2') : ''}${x.job_class ? '' : field('技術分類', `<select id="dn-class">${Object.entries(CLASS_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>`)}${field('每月經常性薪資', `<input id="dn-salary" inputmode="numeric" value="${esc(x.regular_salary || '')}">`)}${field('派遣起日', `<input id="dn-start" type="date" value="${esc(x.start_date || '')}">`)}</div>`,
    active: field('派遣結束日', `<input id="dn-end" type="date" value="${esc(x.end_date || '')}">`),
  }[x.stage] || '';
  if (!form) { await applyNext(id); return; }
  modal({ title: `${personName(x)}：${NEXT[x.stage]}`, subtitle: '不會通知人選或客戶。', body: form, footer: `<button class="btn" data-close-overlay>取消</button><button class="btn primary" data-dsp="apply-next" data-id="${esc(id)}">確定</button>` });
}
async function applyNext(id) {
  const x = currentPeople().find((p) => p.id === id);
  const val = (s) => { const el = $(s); return el ? el.value : undefined; };
  const to = { consent_pending: 'consented', consented: 'skill_check', skill_check: 'contract', contract: 'active', active: 'ended' }[x.stage];
  const b = { by: me(), stage: to };
  if (x.stage === 'consent_pending') { b.consent_status = 'agreed'; b.consent_note = val('#dn-note'); }
  ['job_slug:#dn-job', 'job_class:#dn-class', 'regular_salary:#dn-salary', 'start_date:#dn-start', 'end_date:#dn-end'].forEach((kv) => { const [k, sel] = kv.split(':'); const v = val(sel); if (v !== undefined) b[k] = v; });
  await api.post(`/admin/dispatch/person/${encodeURIComponent(id)}`, b);
  closeOverlay(); toast('已更新', 'success'); reload();
}
async function editPerson(id) {
  const x = currentPeople().find((p) => p.id === id);
  if (!x) return;
  const jobs = await api.get('/admin/dispatch/jobs').catch(() => ({ items: [] }));
  modal({
    title: `修改 ${personName(x)}`, subtitle: '填錯才需要改。不會通知人選或客戶。',
    body: `<div class="form-grid">
      ${field('人選對派遣的意願', `<select id="dp-consent"><option value="pending"${x.consent_status === 'pending' ? ' selected' : ''}>還沒問</option><option value="agreed"${x.consent_status === 'agreed' ? ' selected' : ''}>已同意</option><option value="declined"${x.consent_status === 'declined' ? ' selected' : ''}>不同意</option></select>`)}
      ${field('階段', `<select id="dp-stage">${ui.stages.map(([k, v]) => `<option value="${k}"${x.stage === k ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select>`)}
      ${field('同意怎麼確認的', `<input id="dp-note" value="${esc(x.consent_note || '')}">`, 'span-2')}
      ${field('派遣職缺', `<select id="dp-job"><option value="">還沒配</option>${jobOptions(jobs.items, x.job_slug)}</select>`, 'span-2')}
      ${field('每月經常性薪資', `<input id="dp-salary" inputmode="numeric" value="${esc(x.regular_salary || '')}">`)}
      ${field('派遣起日', `<input id="dp-start" type="date" value="${esc(x.start_date || '')}">`)}
    </div>`,
    footer: `<button class="btn" data-close-overlay>取消</button><button class="btn primary" data-dsp="save-person" data-id="${esc(id)}">儲存</button>`,
  });
}
async function savePerson(id) {
  await api.post(`/admin/dispatch/person/${encodeURIComponent(id)}`, {
    by: me(), consent_status: $('#dp-consent').value, stage: $('#dp-stage').value, consent_note: $('#dp-note').value,
    job_slug: $('#dp-job').value, regular_salary: $('#dp-salary').value, start_date: $('#dp-start').value,
  });
  closeOverlay(); toast('已儲存', 'success'); reload();
}
async function addActive() {
  const c = await api.get('/admin/dispatch/clients');
  const jobs = await api.get('/admin/dispatch/jobs').catch(() => ({ items: [] }));
  modal({
    title: '登記已在上班的人', subtitle: '系統沒有卡、但已經在客戶那邊上班的人才用這個。',
    body: `<div class="form-grid">
      ${field('姓名', '<input id="da-name">')}
      ${field('要派客戶', `<select id="da-co">${c.items.map((x) => `<option value="${esc(x.company_id)}">${esc(x.display_name)}</option>`).join('')}</select>`)}
      ${field('職缺（選填）', `<select id="da-job"><option value="">不對應</option>${jobOptions(jobs.items)}</select>`, 'span-2')}
      ${field('技術分類', `<select id="da-class">${Object.entries(CLASS_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>`)}
      ${field('每月經常性薪資', '<input id="da-salary" inputmode="numeric">')}
      ${field('派遣起日', '<input id="da-start" type="date">')}
    </div>`,
    footer: '<button class="btn" data-close-overlay>取消</button><button class="btn primary" data-dsp="save-active">登記</button>',
  });
}

// ── 派遣需求 ──
const salaryOf = (j) => (j.salary_min || j.salary_max ? (j.salary_min && j.salary_max && j.salary_min !== j.salary_max ? `${money(j.salary_min)}～${money(j.salary_max)}` : money(j.salary_max || j.salary_min)) : '薪資沒寫');
async function loadJobs(target) {
  const d = await api.get('/admin/dispatch/jobs');
  // 分類定了就只顯示；沒定才出現選單，選完就收起來
  const classCtl = (j) => (j.job_class ? badge(CLASS_LABEL[j.job_class]) : `<select data-dsp-class="${esc(j.slug)}" aria-label="技術分類"><option value="">選分類</option>${Object.entries(CLASS_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>`);
  const row = (j, note) => `<article class="dsp-job"><div class="dsp-job-main"><button type="button" class="dsp-link" data-dsp="open-job" data-slug="${esc(j.slug)}">${text(j.title)}</button>${j.urgent ? ' ' + badge('最急', 'danger') : ''}${j.interview_flag ? ' ' + badge('寫著客戶面試', 'warning') : ''}<small>${salaryOf(j)}・應徵 ${text(j.applicants || 0)} 人${note ? '・' + text(note) : ''}</small></div><div class="dsp-job-side">${classCtl(j)}</div></article>`;
  const needAsk = (j) => ['not_visible', 'other_sheet'].includes(j.sheet_status);
  const hunting = d.items.filter((j) => !needAsk(j)).sort((a, b) => (b.urgent || 0) - (a.urgent || 0));
  const ask = d.items.filter(needAsk);
  const gapRow = (g) => `<article class="dsp-job"><div class="dsp-job-main"><b>${text(g.title_override)}</b>${g.urgent ? ' ' + badge('最急', 'danger') : ''}<small>${text(g.sheet_note || '')}</small></div><div class="dsp-job-side">${badge('要不要建', 'danger')}</div></article>`;
  const askN = ask.length + d.gaps.length;
  target.innerHTML = (hunting.length ? `<article class="card" style="margin-bottom:14px"><h2>還在找（${hunting.length}）</h2><div class="dsp-jobs">${hunting.map((j) => row(j)).join('')}</div></article>` : '')
    + (askN ? `<article class="card"><h2>要你決定（${askN}）</h2><p class="help">系統沒有關任何職缺，等你說。</p><div class="dsp-jobs">${d.gaps.map(gapRow).join('')}${ask.map((j) => row(j, j.sheet_note)).join('')}</div></article>` : '');
  if (!hunting.length && !askN) target.innerHTML = empty('目前沒有開放中的派遣職缺');
}

// ── 轉到派遣 ──
// 人選卡裡的小區塊：還沒轉就是「轉到派遣」，轉過就顯示目前狀況。
export async function mountDispatchBox(el, ref) {
  if (!el) return;
  const q = ref.application_id ? `application_id=${encodeURIComponent(ref.application_id)}` : `sourced_id=${encodeURIComponent(ref.sourced_id)}`;
  try {
    const d = await api.get(`/admin/dispatch/person-of?${q}`);
    const stage = Object.fromEntries(d.stages || [])[d.person && d.person.stage];
    el.innerHTML = d.person
      ? `<div class="dsp-box on"><span>派遣：${text(stage || '')}・${badge(...(CONSENT[d.person.consent_status] || CONSENT.pending))}${d.person.company_name ? '・' + text(d.person.company_name) : ''}</span><button type="button" class="btn sm" data-route="d_people">到派遣人選</button></div>`
      : `<div class="dsp-box"><span>這位也可以走派遣（同一張卡，不複製）</span><button type="button" class="btn sm" data-dsp="transfer" ${ref.application_id ? `data-app="${esc(ref.application_id)}"` : `data-src="${esc(ref.sourced_id)}"`}>轉到派遣</button></div>`;
  } catch { el.innerHTML = ''; }
}
async function openTransfer(btn) {
  const app = btn.getAttribute('data-app') || ''; const src = btn.getAttribute('data-src') || ''; const preJob = btn.getAttribute('data-job') || '';
  const q = app ? `application_id=${encodeURIComponent(app)}` : `sourced_id=${encodeURIComponent(src)}`;
  const [chk, jobs] = await Promise.all([api.get(`/admin/dispatch/transfer-check?${q}`), api.get('/admin/dispatch/jobs')]);
  closeSubDrawer();
  const warn = chk.warnings || [];
  modal({
    title: `轉到派遣：${chk.name || ''}`, subtitle: '同一張人選卡，不複製。這個動作不會通知人選，也不會寄任何東西。',
    body: `${warn.length ? `<div class="notice"><b>先看這 ${warn.length} 點</b><ul style="margin:6px 0 0;padding-left:18px">${warn.map((w) => `<li>${text(w.text)}</li>`).join('')}</ul><label style="display:flex;gap:8px;align-items:center;margin-top:8px;min-height:44px"><input type="checkbox" id="dt-ack"> 我看過了，還是要轉</label></div>` : ''}
      <div class="form-grid">
        ${field('人選同意做派遣了嗎？', '<select id="dt-consent"><option value="">請選</option><option value="agreed">已同意</option><option value="pending">還沒問（先放進名單）</option></select>', 'span-2')}
        <label class="field span-2" id="dt-note-wrap" hidden><span>怎麼確認的</span><input id="dt-note" placeholder="例：11/4 電話口頭同意"></label>
        ${field('要配的派遣職缺（可以之後再配）', `<select id="dt-job"><option value="">之後再配</option>${jobs.items.map((j) => `<option value="${esc(j.slug)}"${preJob === j.slug ? ' selected' : ''}>${esc(j.company_name || '')}｜${esc(j.title)}</option>`).join('')}</select>`, 'span-2')}
      </div><p class="help">派遣不能讓客戶先面試，只做工作說明及技能確認。</p>`,
    footer: `<button class="btn" data-close-overlay>取消</button><button class="btn primary" data-dsp="do-transfer" data-app="${esc(app)}" data-src="${esc(src)}">轉到派遣</button>`,
  });
  $('#dt-consent').onchange = (e) => { $('#dt-note-wrap').hidden = e.target.value !== 'agreed'; };
}
async function doTransfer(btn) {
  const app = btn.getAttribute('data-app'); const src = btn.getAttribute('data-src');
  const ack = $('#dt-ack');
  if (ack && !ack.checked) { toast('請先勾「我看過了」', 'error'); return; }
  await api.post('/admin/dispatch/transfer', { by: me(), application_id: app || null, sourced_id: src || null, consent: $('#dt-consent').value, consent_note: $('#dt-note').value, job_slug: $('#dt-job').value, ack_warnings: !!ack });
  closeOverlay(); toast('已轉到派遣', 'success');
  if (app && !isDispatchPage()) hooks.openCandidate(app); else reload();
}
const isDispatchPage = () => Object.entries(ROUTES).some(([k, p]) => p === location.pathname.replace(/\/?$/, '/') && isDispatchRoute(k));
function findCandidate() {
  modal({
    title: '加人', subtitle: '打姓名、電話、Email 或編號。找到就用同一張卡。',
    body: '<div class="filters"><input id="df-q" style="flex:1" placeholder="搜尋人選"><button class="btn primary" data-dsp="do-find">搜尋</button></div><div id="df-result"></div>',
    footer: '<button class="btn" data-dsp="add-active">系統沒有這個人，直接登記</button><button class="btn" data-close-overlay>關閉</button>',
  });
  $('#df-q').focus();
}
async function doFind() {
  const q = $('#df-q').value.trim();
  if (!q) return;
  const d = await api.get(`/admin/search?q=${encodeURIComponent(q)}`);
  const c = d.candidates || [];
  $('#df-result').innerHTML = c.length ? `<div class="list">${c.map((x) => `<div class="list-row"><span><b>${text(x.name || '')}</b><small>${text(x.job_title || '')}${x.owner ? '・' + text(x.owner) : ''}</small></span><button type="button" class="btn sm" data-dsp="transfer" data-app="${esc(x.id)}">轉到派遣</button></div>`).join('')}</div>` : '<p class="muted">找不到符合的人選。</p>';
}

// ── 要派客戶 ──
const HEALTH_ORDER = { bad: 0, warn: 1, ok: 2 };
function healthHtml(list) {
  return `<div class="dsp-health">${[...list].sort((a, b) => HEALTH_ORDER[a.state] - HEALTH_ORDER[b.state]).map((h) => `<div class="dsp-h ${h.state}"><span>${badge(STATE_LABEL[h.state], STATE_BADGE[h.state])}</span><div><b>${text(h.label)}</b><p>${text(h.detail)}</p></div></div>`).join('')}</div>`;
}
async function loadClients(target) {
  const d = await api.get('/admin/dispatch/clients');
  target.__clients = d.items;
  if (!d.items.length) { target.innerHTML = empty('還沒有要派客戶', '按右上角新增。'); return; }
  target.innerHTML = d.items.map((c) => {
    const t = c.terms;
    const problems = c.health.filter((h) => h.state !== 'ok' && h.key !== 'term');
    const cs = c.contract_status;
    const csTone = { expired: 'danger', expiring: 'warning', unknown: 'warning', active: 'success' }[cs.key];
    return `<article class="card dsp-client"><div class="card-head"><div><h2>${text(c.display_name)}</h2><p class="help">合約甲方：${text(c.party_name || '沒填')}</p></div>${c.status === 'confirmed' ? badge(`條款已確認（${c.confirmed_by || ''}）`, 'success') : badge('條款待確認', 'warning')}</div>
      <div class="dsp-contract ${cs.key}"><div><span>合約</span><b>${t.contract_start ? text(t.contract_start) : '起日沒填'}～${t.contract_end ? text(t.contract_end) : '到期日沒填'}</b>${t.auto_renew ? '<small>會自動續約</small>' : '<small>不會自動續約・到期前 60 天提醒</small>'}</div>${badge(cs.label, csTone)}<div class="dsp-contract-files">${(c.contract_files || []).map((f) => fileButtons(`/admin/file/${encodeURIComponent(f.file_id)}`, f.filename || f.title)).join('') || '<button type="button" class="btn sm" data-route="library">合約檔還沒放，到書櫃上傳</button>'}</div></div>
      <div class="dsp-terms"><div><span>招募管理費</span><b>非技術 ${text(t.recruit_rate.nontech)}%／技術 ${text(t.recruit_rate.tech)}%</b></div><div><span>行政管理費</span><b>${text(t.admin_rate)}%</b></div><div><span>免招募費</span><b>${t.recruit_free_after_months == null ? '不免' : '滿 ' + text(t.recruit_free_after_months) + ' 個月'}</b></div><div><span>付款</span><b>${t.payment_days ? text(t.payment_days) + ' 天' : '沒填'}</b></div></div>
      ${problems.length ? `<h3 style="margin:16px 0 8px">條文上的缺口（${problems.length}）</h3>${healthHtml(problems)}` : '<p class="help" style="margin-top:12px">合約體檢沒有問題。</p>'}
      <div class="actions-row" style="margin-top:14px">${c.status !== 'confirmed' ? `<button type="button" class="btn primary" data-dsp="confirm-terms" data-id="${esc(c.company_id)}">核對過，確認條款</button>` : ''}<button type="button" class="btn" data-dsp="edit-terms" data-id="${esc(c.company_id)}">改條款</button></div></article>`;
  }).join('');
  wireFileButtons(target);
}
const BASE_LABEL = { statutory: '法定保險與提撥', welfare: '福利費用', overtime: '加班費', bonus: '獎金津貼' };
function editTerms(id) {
  const c = (($('#page-data') || {}).__clients || []).find((x) => x.company_id === id);
  if (!c) return;
  const t = c.terms; const cl = t.clauses || {};
  const v = (x) => esc(x == null ? '' : x);
  const tiers = t.transfer_tiers.map((b, i) => `<div class="dsp-tier"><span>${b.under_months == null ? '滿前一階以上' : `未滿 ${esc(b.under_months)} 個月`}</span><input data-tier="${i}" data-m="${b.under_months == null ? '' : esc(b.under_months)}" inputmode="decimal" value="${v(b.percent)}" aria-label="轉任費百分比"><span>%</span></div>`).join('');
  const clause = (k) => (cl[k] ? `<small class="muted">出處：${esc(cl[k])}</small>` : '');
  modal({
    title: `${c.display_name} 的條款`, subtitle: t.source || '',
    body: `<div class="form-grid">
      ${field('合約甲方', `<input id="dc-party" value="${v(c.party_name)}">`, 'span-2')}
      ${field('合約起日', `<input id="dc-start" type="date" value="${v(t.contract_start)}">`)}
      ${field(`合約到期日 ${clause('term')}`, `<input id="dc-end" type="date" value="${v(t.contract_end)}">`)}
      ${field(`招募費・非技術 % ${clause('fee')}`, `<input id="dc-rn" inputmode="decimal" value="${v(t.recruit_rate.nontech)}">`)}
      ${field('招募費・技術 %', `<input id="dc-rt" inputmode="decimal" value="${v(t.recruit_rate.tech)}">`)}
      ${field('行政管理費 %', `<input id="dc-admin" inputmode="decimal" value="${v(t.admin_rate)}">`)}
      ${field('滿幾個月免招募費（空白＝不免）', `<input id="dc-free" inputmode="numeric" value="${v(t.recruit_free_after_months)}">`)}
      <div class="field span-2"><span>管理費要算進基礎的項目（經常性薪資一定算） ${clause('base')}</span><div class="dsp-checks">${Object.entries(BASE_LABEL).map(([k, l]) => `<label><input type="checkbox" data-base="${k}"${t.fee_base[k] ? ' checked' : ''}> ${l}</label>`).join('')}</div></div>
      ${field(`客戶可扣福利金（千分之幾） ${clause('welfare')}`, `<input id="dc-welfare" inputmode="decimal" value="${v(t.welfare_permille)}">`)}
      ${field(`付款天數 ${clause('payment')}`, `<input id="dc-pay" inputmode="numeric" value="${v(t.payment_days)}">`)}
      ${field(`遲延利息（每月 %，空白＝沒寫）`, `<input id="dc-int" inputmode="decimal" value="${v(t.overdue_interest_monthly)}">`)}
      ${field(`提前通知終止天數（空白＝沒寫） ${clause('notice')}`, `<input id="dc-notice" inputmode="numeric" value="${v(t.notice_days)}">`)}
      <div class="field span-2"><span>合約有沒有這幾條</span><div class="dsp-checks"><label><input type="checkbox" id="dc-law"${t.law_change_pass_through ? ' checked' : ''}> 法令變動成本由客戶負擔</label><label><input type="checkbox" id="dc-block"${t.block_pre_interview ? ' checked' : ''}> 禁止客戶事前面試或指定人選</label><label><input type="checkbox" id="dc-renew"${t.auto_renew ? ' checked' : ''}> 到期自動續約</label></div></div>
      <div class="field span-2"><span>轉任費（轉任後月薪的 %） ${clause('transfer')}</span>${tiers}</div>
      ${field('備註', `<textarea id="dc-note" rows="3">${esc(t.note || '')}</textarea>`, 'span-2')}
    </div><p class="help">存檔後這份條款會回到「待確認」：之前確認的是舊數字。已確認的結算不會被改動。</p>`,
    footer: `<button class="btn" data-close-overlay>取消</button><button class="btn primary" data-dsp="save-terms" data-id="${esc(id)}">儲存</button>`,
  });
  $('#overlay-root').__terms = t;
}
async function saveTerms(id) {
  const old = $('#overlay-root').__terms;
  const val = (s) => $(s).value;
  const terms = {
    ...old, contract_start: val('#dc-start'), contract_end: val('#dc-end'),
    recruit_rate: { nontech: val('#dc-rn'), tech: val('#dc-rt') }, admin_rate: val('#dc-admin'), recruit_free_after_months: val('#dc-free'),
    fee_base: Object.fromEntries($$('[data-base]').map((el) => [el.getAttribute('data-base'), el.checked])),
    welfare_permille: val('#dc-welfare'), payment_days: val('#dc-pay'), overdue_interest_monthly: val('#dc-int'), notice_days: val('#dc-notice'),
    law_change_pass_through: $('#dc-law').checked, block_pre_interview: $('#dc-block').checked, auto_renew: $('#dc-renew').checked,
    transfer_tiers: $$('[data-tier]').map((el) => ({ under_months: el.getAttribute('data-m'), percent: el.value })), note: val('#dc-note'),
  };
  await api.post(`/admin/dispatch/client/${encodeURIComponent(id)}`, { by: me(), party_name: val('#dc-party'), terms });
  closeOverlay(); toast('已儲存，條款回到待確認', 'success'); reload();
}
async function newClient() {
  const d = await api.get('/admin/portal/companies');
  const cos = (d.items || d.companies || []).filter((c) => c && c.id && !/測試/.test(c.display_name || ''));
  const have = new Set((($('#page-data') || {}).__clients || []).map((c) => c.company_id));
  modal({
    title: '新增要派客戶', subtitle: '從公司派遣合約範本開始，再照客戶談好的逐項改。範本已補好事前面試、遲延利息、法令變動、提前通知這幾個洞。',
    body: field('客戶', `<select id="dn-co"><option value="">請選</option>${cos.filter((c) => !have.has(c.id)).map((c) => `<option value="${esc(c.id)}">${esc(c.display_name)}</option>`).join('')}</select>`),
    footer: '<button class="btn" data-close-overlay>取消</button><button class="btn primary" data-dsp="save-new-client">建立</button>',
  });
}

// ── 每月結算 ──
const SETTLE_INPUTS = [['regular_salary', '經常性薪資'], ['overtime', '加班費'], ['bonus', '非經常性獎金津貼'], ['insurance', '法定保險費'], ['pension', '退休提撥金'], ['expense', '核銷工作費用'], ['other', '其他確認費用']];
const lines = (r) => `<table class="dsp-lines"><tbody>${r.lines.map((l) => `<tr><th>${text(l.label)}<small>${text(l.formula)}</small></th><td>${money(l.amount)}</td></tr>`).join('')}<tr class="sum"><th>向客戶收（未稅）</th><td>${money(r.total_untaxed)}</td></tr></tbody></table>`;
async function loadSettlement(target) {
  const c = await api.get('/admin/dispatch/clients');
  if (!c.items.length) { target.innerHTML = empty('還沒有要派客戶', '先到「要派客戶」新增。'); return; }
  if (!ui.company || !c.items.some((x) => x.company_id === ui.company)) ui.company = c.items[0].company_id;
  if (!ui.ym) ui.ym = thisYm();
  const co = c.items.find((x) => x.company_id === ui.company);
  const s = await api.get(`/admin/dispatch/settlement?company_id=${encodeURIComponent(ui.company)}&ym=${encodeURIComponent(ui.ym)}`);
  target.__rows = s.rows;
  const rowsOk = s.rows.filter((r) => !r.result.error);
  const total = rowsOk.reduce((a, r) => a + r.result.total_untaxed, 0);
  const mgmt = rowsOk.reduce((a, r) => a + r.result.management_fee, 0);
  const row = (r) => {
    const x = r.person; const done = r.status === 'confirmed';
    return `<article class="card dsp-settle" data-person="${esc(x.id)}"><div class="card-head"><div><h3>${text(personName(x))}${x.is_test ? ' ' + badge('測試') : ''}</h3><p class="help">${text(x.job_title || '')}・${text(CLASS_LABEL[x.job_class] || '沒分類')}・起日 ${text(x.start_date || '')}</p></div>${done ? badge(`已確認（${r.confirmed_by || ''}）`, 'success') : badge(r.status === 'draft' ? '草稿' : '還沒存', 'warning')}</div>
      <div data-si-result>${r.result.error ? `<div class="notice">${text(r.result.error)}</div>` : lines(r.result)}</div>
      ${done ? '' : `<details class="dsp-more"><summary>改金額（加班、獎金、保險…）</summary><div class="dsp-inputs">${SETTLE_INPUTS.map(([k, l]) => field(l, `<input data-si="${k}" inputmode="numeric" value="${esc(r.inputs[k] || '')}">`)).join('')}</div><div class="actions-row"><button class="btn" data-dsp="settle-save" data-id="${esc(x.id)}">重算</button></div></details>`}
      <div class="actions-row">${done ? `<button class="btn" data-dsp="settle-undo" data-id="${esc(x.id)}">退回修改</button>` : `<button class="btn primary" data-dsp="settle-confirm" data-id="${esc(x.id)}">核對無誤，確認</button>`}</div></article>`;
  };
  target.innerHTML = `<div class="filters"><label class="dsp-inline">客戶 <select id="ds-co">${c.items.map((x) => `<option value="${esc(x.company_id)}"${x.company_id === ui.company ? ' selected' : ''}>${esc(x.display_name)}</option>`).join('')}</select></label><label class="dsp-inline">月份 <input id="ds-ym" type="month" value="${esc(ui.ym)}"></label>${s.rows.length ? '<button class="btn" data-dsp="settle-csv">匯出這個月</button>' : ''}</div>
    ${co.status !== 'confirmed' ? '<div class="notice">這家客戶的條款還沒確認，先到「要派客戶」確認，才能確認結算。</div>' : ''}
    ${s.rows.length ? `<div class="notice dsp-sum">這個月 ${s.rows.length} 人，已確認 ${s.rows.filter((r) => r.status === 'confirmed').length} 人。向客戶收（未稅）合計 <b>${money(total)}</b>，其中管理費 ${money(mgmt)}。</div>${s.rows.map(row).join('')}`
      : `<div class="state"><strong>這個月系統裡沒有在職派遣的人</strong><p>實際有人在上班的話，到「派遣人選」按「加人」登記。</p></div>`}
    ${estimateBox(co, !s.rows.length)}`;
  $('#ds-co').onchange = (e) => { ui.company = e.target.value; loadDispatchRoute('d_settlement', target); };
  $('#ds-ym').onchange = (e) => { if (e.target.value) { ui.ym = e.target.value; loadDispatchRoute('d_settlement', target); } };
}
function estimateBox(co, open) {
  return `<details class="card dsp-more" style="margin-top:14px"${open ? ' open' : ''}><summary><b>試算一筆</b>（什麼都不會存）</summary><div class="dsp-inputs">
    ${field('每月經常性薪資', '<input id="de-salary" inputmode="numeric" placeholder="例：40000">')}
    ${field('技術分類', `<select id="de-class">${Object.entries(CLASS_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>`)}
    ${field('派遣起日（不填＝新到職）', '<input id="de-start" type="date">')}
  </div><div class="actions-row"><button class="btn primary" data-dsp="estimate">算一下</button></div><div id="de-out" style="margin-top:12px"></div></details>`;
}
async function runEstimate() {
  const d = await api.post('/admin/dispatch/estimate', { company_id: ui.company, regular_salary: $('#de-salary').value, job_class: $('#de-class').value, start_date: $('#de-start').value, ym: ui.ym });
  $('#de-out').innerHTML = lines(d.result);
}
async function saveSettle(id, confirm) {
  const card = $(`.dsp-settle[data-person="${id}"]`);
  const inputs = Object.fromEntries($$('[data-si]', card).map((el) => [el.getAttribute('data-si'), el.value]));
  await api.post('/admin/dispatch/settlement', { by: me(), person_id: id, ym: ui.ym, inputs, confirm });
  toast(confirm ? '已確認這筆' : '已存草稿', 'success'); reload();
}
function exportCsv() {
  const rows = ($('#page-data') || {}).__rows || [];
  const head = ['姓名', '職缺', '分類', '經常性薪資', '加班費', '獎金津貼', '保險費', '提撥金', '工作費用', '其他', '招募管理費', '行政管理費', '客戶可扣福利金', '向客戶收(未稅)', '狀態', '確認人'];
  const cell = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const body = rows.filter((r) => !r.result.error).map((r) => [personName(r.person), r.person.job_title, CLASS_LABEL[r.person.job_class], r.inputs.regular_salary, r.inputs.overtime, r.inputs.bonus, r.inputs.insurance, r.inputs.pension, r.inputs.expense, r.inputs.other, r.result.recruit_fee, r.result.admin_fee, r.result.welfare_deduct, r.result.total_untaxed, r.status === 'confirmed' ? '已確認' : '未確認', r.confirmed_by].map(cell).join(','));
  const url = URL.createObjectURL(new Blob(['﻿' + [head.map(cell).join(','), ...body].join('\n')], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = `派遣結算_${ui.ym}.csv`; a.click(); URL.revokeObjectURL(url);
}

// ── 操作 ──
document.addEventListener('change', async (e) => {
  const sel = e.target instanceof Element ? e.target.closest('[data-dsp-class]') : null;
  if (!sel) return;
  try { await api.post(`/admin/dispatch/job/${encodeURIComponent(sel.getAttribute('data-dsp-class'))}`, { by: me(), job_class: sel.value }); toast('已更新分類', 'success'); reload(); }
  catch (err) { toast(err.message || '存不了', 'error'); reload(); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target && e.target.id === 'df-q') { e.preventDefault(); doFind().catch((err) => toast(err.message, 'error')); } });
document.addEventListener('click', async (e) => {
  const btn = e.target instanceof Element ? e.target.closest('[data-dsp]') : null;
  if (!btn) return;
  const act = btn.getAttribute('data-dsp'); const id = btn.getAttribute('data-id');
  e.preventDefault();
  try {
    if (act === 'open-card') hooks.openCandidate(btn.getAttribute('data-app'));
    else if (act === 'open-job') hooks.openJob(btn.getAttribute('data-slug'));
    else if (act === 'find-candidate') findCandidate();
    else if (act === 'do-find') await doFind();
    else if (act === 'transfer') await openTransfer(btn);
    else if (act === 'do-transfer') await doTransfer(btn);
    else if (act === 'next-step') await nextStep(id);
    else if (act === 'apply-next') await applyNext(id);
    else if (act === 'edit-person') await editPerson(id);
    else if (act === 'save-person') await savePerson(id);
    else if (act === 'add-active') await addActive();
    else if (act === 'save-active') {
      await api.post('/admin/dispatch/person', { by: me(), name: $('#da-name').value, company_id: $('#da-co').value, job_slug: $('#da-job').value, job_class: $('#da-class').value, regular_salary: $('#da-salary').value, start_date: $('#da-start').value });
      closeOverlay(); toast('已登記', 'success'); reload();
    } else if (act === 'edit-terms') editTerms(id);
    else if (act === 'save-terms') await saveTerms(id);
    else if (act === 'confirm-terms') { await api.post(`/admin/dispatch/client/${encodeURIComponent(id)}`, { by: me(), confirm: true }); toast('條款已確認', 'success'); reload(); }
    else if (act === 'new-client') await newClient();
    else if (act === 'save-new-client') {
      const co = $('#dn-co').value;
      if (!co) { toast('請選客戶', 'error'); return; }
      await api.post(`/admin/dispatch/client/${encodeURIComponent(co)}`, { by: me(), use_template: true });
      closeOverlay(); toast('已建立，條款待確認', 'success'); reload();
    } else if (act === 'estimate') await runEstimate();
    else if (act === 'settle-save') await saveSettle(id, false);
    else if (act === 'settle-confirm') await saveSettle(id, true);
    else if (act === 'settle-undo') { await api.post('/admin/dispatch/settlement', { by: me(), person_id: id, ym: ui.ym, unconfirm: true }); toast('已退回修改', 'success'); reload(); }
    else if (act === 'settle-csv') exportCsv();
  } catch (err) { toast(err.message || '操作失敗', 'error'); }
});
