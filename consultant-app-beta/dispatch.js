// 2026-11-04 Jacky：派遣模式第一階段（畫面）。後端在 backoffice-worker src/dispatch.js，全部走 /admin/dispatch/*。
// 共用資料，只切畫面：職缺、人選卡還是原本那張。切換＝換左邊選單，不是另一套系統。
// ⚠️ 這支檔案任何人都下載得到：不准寫客戶名、費率數字；條款一律從登入後的 API 讀。
import { api } from './core/api.js';
import { ROUTES } from './config.js';
import { $, $$, closeOverlay, closeSubDrawer, empty, errorState, loading, modal, toast } from './core/ui.js';
import { escapeHtml, text } from './core/security.js';

const esc = escapeHtml;
const MODE_KEY = 's1ne_work_mode';
export const DISPATCH_NAV = [
  ['d_today', '今日待辦', '☑'], ['d_people', '派遣人選', '◉'], ['d_jobs', '派遣需求', '▣'], ['d_progress', '派遣進度', '▥'],
  ['d_clients', '要派客戶', '♙'], ['d_settlement', '每月結算', '▦'], ['d_billing', '請款收款', '＄'], ['library', '書櫃', '▤'],
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
  d_today: () => page('今日待辦', '派遣這邊今天只要人處理的例外。沒列出來的，系統自己顧。'),
  d_people: () => page('派遣人選', '跟招募同一張人選卡，不複製。沒有人選本人同意，不能往下推薦。', '<button class="btn" data-dsp="find-candidate">從人才庫轉入</button><button class="btn primary" data-dsp="add-active">登記已在職的人</button>'),
  d_jobs: () => page('派遣需求', '跟「職缺」同一批資料。客戶需求表上看不到的先列出來，關不關由人決定。'),
  d_progress: () => page('派遣進度', '派遣不走客戶面試：推薦後只做工作說明及技能確認，簽完勞動契約才上工。'),
  d_clients: () => page('要派客戶', '每家客戶一份自己的條款，算錢都從這裡來。費率不對其他客戶外流。', '<button class="btn primary" data-dsp="new-client">新增要派客戶</button>'),
  d_settlement: () => page('每月結算', '系統先算好，人核對、按確認才算數。按確認不會寄信也不會動錢。'),
  d_billing: () => page('請款收款', '第二階段才做。') ,
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
  const loaders = { d_today: loadToday, d_people: loadPeople, d_jobs: loadJobs, d_progress: loadProgress, d_clients: loadClients, d_settlement: loadSettlement, d_billing: loadBilling };
  target.innerHTML = loading();
  try { await loaders[route](target); } catch (e) { console.error(e); target.innerHTML = errorState(e); }
}
const reload = () => { const t = $('#page-data'); const k = Object.entries(ROUTES).find(([, p]) => p === location.pathname.replace(/\/?$/, '/')); if (t && k && isDispatchRoute(k[0])) loadDispatchRoute(k[0], t); };

// ── 今日待辦 ──
async function loadToday(target) {
  const d = await api.get('/admin/dispatch/today');
  const jump = { client: 'd_clients', jobs: 'd_jobs', person: 'd_progress' };
  const bad = d.todos.filter((x) => x.level === 'bad');
  const warn = d.todos.filter((x) => x.level !== 'bad');
  const row = (x) => `<button type="button" class="list-row dsp-todo ${x.level}" data-route="${jump[x.kind] || 'd_today'}"><span><b>${text(x.title)}</b><small>${text(x.detail)}</small></span>${badge(STATE_LABEL[x.level] || '要注意', STATE_BADGE[x.level] || 'warning')}</button>`;
  target.innerHTML = `<div class="kpi-grid"><article class="kpi"><span>在職派遣人數（系統紀錄）</span><strong>${text(d.active)}</strong><small>實際人數待確認</small></article><article class="kpi"><span>開放中派遣需求</span><strong>${text(d.jobs_open)}</strong></article><article class="kpi ${bad.length ? 'warn' : ''}"><span>要處理</span><strong>${bad.length}</strong></article><article class="kpi"><span>要注意</span><strong>${warn.length}</strong></article></div>
    ${d.todos.length ? `<div class="list">${[...bad, ...warn].map(row).join('')}</div>` : empty('今天沒有要人處理的例外')}`;
}

// ── 派遣人選 ──
function personName(x) { return x.name || '（沒有姓名）'; }
const openBtn = (x, label) => (x.application_id ? `<button type="button" class="btn sm" data-dsp="open-card" data-app="${esc(x.application_id)}">${label || '看人選卡'}</button>` : '');
async function loadPeople(target) {
  const d = await api.get('/admin/dispatch/people');
  ui.stages = d.stages || [];
  const stageLabel = Object.fromEntries(ui.stages);
  const rows = d.people.map((x) => `<article class="list-row"><span><b>${text(personName(x))}</b>${x.is_test ? ' ' + badge('測試') : ''}<small>${text(x.company_name || '還沒配客戶')}${x.job_title ? '・' + text(x.job_title) : ''}・${text(stageLabel[x.stage] || x.stage)}</small></span>${badge(...(CONSENT[x.consent_status] || CONSENT.pending))}<span class="actions-row" style="flex:none;margin:0">${openBtn(x)}<button type="button" class="btn sm" data-dsp="edit-person" data-id="${esc(x.id)}">更新</button></span></article>`);
  const apps = (d.applicants || []).map((a) => `<article class="list-row"><span><b>${text(a.name || '（沒有姓名）')}</b><small>${text(a.company_name || '')}・${text(a.job_title || a.job_slug)}・${text(String(a.created_at || '').slice(0, 10))}</small></span>${badge('應徵派遣缺')}<span class="actions-row" style="flex:none;margin:0"><button type="button" class="btn sm" data-dsp="open-card" data-app="${esc(a.id)}">看人選卡</button><button type="button" class="btn sm" data-dsp="transfer" data-app="${esc(a.id)}" data-job="${esc(a.job_slug || '')}">記錄同意</button></span></article>`);
  target.innerHTML = `<article class="card"><h2>已轉入派遣（${d.people.length}）</h2>${rows.length ? `<div class="list">${rows.join('')}</div>` : '<p class="muted">還沒有。打開任何一張人選卡，總覽最上面就有「轉到派遣」。</p>'}</article>
    <article class="card" style="margin-top:14px"><h2>直接應徵派遣職缺的人（${apps.length}）</h2><p class="help">他們本來就在這些職缺的流程裡，顯示在這邊方便看；要往派遣走時按「記錄同意」。</p>${apps.length ? `<div class="list">${apps.join('')}</div>` : '<p class="muted">目前沒有。</p>'}</article>`;
  target.__people = d.people;
}

// ── 派遣需求 ──
const salaryOf = (j) => (j.salary_min || j.salary_max ? (j.salary_min && j.salary_max && j.salary_min !== j.salary_max ? `${money(j.salary_min)}～${money(j.salary_max)}` : money(j.salary_max || j.salary_min)) : '薪資沒寫');
async function loadJobs(target) {
  const d = await api.get('/admin/dispatch/jobs');
  const classSel = (j) => `<select data-dsp-class="${esc(j.slug)}" aria-label="技術分類"><option value="">未定</option>${Object.entries(CLASS_LABEL).map(([k, v]) => `<option value="${k}"${j.job_class === k ? ' selected' : ''}>${v}</option>`).join('')}</select>`;
  const flags = (j) => [
    j.urgent ? badge('最急', 'danger') : '',
    j.sheet_status ? badge(...(SHEET[j.sheet_status] || ['', ''])) : '',
    j.interview_flag ? badge('寫著客戶面試', 'warning') : '',
    j.service_line_empty ? badge('服務線空白', 'warning') : '',
  ].join('');
  const row = (j) => `<article class="dsp-job"><div class="dsp-job-main"><button type="button" class="dsp-link" data-dsp="open-job" data-slug="${esc(j.slug)}">${text(j.title)}</button><div class="dsp-flags">${flags(j)}</div><small>${text(j.company_name || '')}・${salaryOf(j)}・應徵 ${text(j.applicants || 0)} 人</small>${j.sheet_note ? `<small>${text(j.sheet_note)}（${text(j.sheet_checked_at || '')} 查）</small>` : ''}${j.interview_flag ? `<small class="dsp-warn">職缺資料寫：${text(j.interview_flag)}</small>` : ''}${j.class_note ? `<small>分類依據：${text(j.class_note)}</small>` : ''}</div><div class="dsp-job-side">${classSel(j)}</div></article>`;
  const urgent = d.items.filter((j) => j.urgent);
  const visible = d.items.filter((j) => !j.urgent && j.sheet_status === 'visible');
  const gone = d.items.filter((j) => j.sheet_status === 'not_visible');
  const other = d.items.filter((j) => !j.urgent && !['visible', 'not_visible'].includes(j.sheet_status));
  const sec = (title, list, help = '') => (list.length ? `<article class="card" style="margin-bottom:14px"><h2>${title}（${list.length}）</h2>${help ? `<p class="help">${help}</p>` : ''}<div class="dsp-jobs">${list.map(row).join('')}</div></article>` : '');
  const gaps = d.gaps.length ? `<article class="card" style="margin-bottom:14px"><h2>客戶要、系統還沒有（${d.gaps.length}）</h2><div class="list">${d.gaps.map((g) => `<div class="list-row"><span><b>${text(g.title_override)}</b>${g.urgent ? ' ' + badge('最急', 'danger') : ''}<small>${text(g.company_name || '')}・${text(g.sheet_note || '')}</small></span>${badge('系統還沒建', 'danger')}</div>`).join('')}</div></article>` : '';
  target.innerHTML = gaps + sec('最急', urgent, '客戶 11/2 來信點名的缺。') + sec('客戶表上還有', visible) + sec('客戶表上看不到', gone, '可能客戶已經不找了。系統沒有關，等人確認。') + sec('需要從別的地方確認', other);
  if (!d.items.length && !d.gaps.length) target.innerHTML = empty('目前沒有開放中的派遣職缺');
}

// ── 派遣進度 ──
async function loadProgress(target) {
  const d = await api.get('/admin/dispatch/people');
  ui.stages = d.stages || [];
  target.__people = d.people;
  target.innerHTML = `<div class="dsp-board">${ui.stages.map(([k, label]) => {
    const list = d.people.filter((x) => x.stage === k);
    return `<section class="dsp-col"><h3>${text(label)}<span>${list.length}</span></h3>${list.map((x) => `<button type="button" class="dsp-card" data-dsp="edit-person" data-id="${esc(x.id)}"><b>${text(personName(x))}</b><small>${text(x.company_name || '還沒配客戶')}</small><small>${text(x.job_title || '')}</small></button>`).join('') || '<p class="muted">—</p>'}</section>`;
  }).join('')}</div>`;
}
function currentPeople() { return ($('#page-data') || {}).__people || []; }
async function editPerson(id) {
  const x = currentPeople().find((p) => p.id === id);
  if (!x) return;
  const jobs = await api.get('/admin/dispatch/jobs').catch(() => ({ items: [] }));
  if (!ui.stages.length) ui.stages = (await api.get('/admin/dispatch/people')).stages || [];
  modal({
    title: personName(x), subtitle: `${x.company_name || '還沒配客戶'}${x.job_title ? '・' + x.job_title : ''}`,
    body: `<div class="form-grid">
      ${field('人選對派遣的意願', `<select id="dp-consent"><option value="pending"${x.consent_status === 'pending' ? ' selected' : ''}>還沒問</option><option value="agreed"${x.consent_status === 'agreed' ? ' selected' : ''}>已同意</option><option value="declined"${x.consent_status === 'declined' ? ' selected' : ''}>不同意</option></select>`)}
      ${field('階段', `<select id="dp-stage">${ui.stages.map(([k, v]) => `<option value="${k}"${x.stage === k ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select>`)}
      ${field('同意怎麼確認的', `<input id="dp-note" value="${esc(x.consent_note || '')}" placeholder="例：11/4 電話口頭同意">`, 'span-2')}
      ${field('派遣職缺', `<select id="dp-job"><option value="">還沒配</option>${jobs.items.map((j) => `<option value="${esc(j.slug)}"${x.job_slug === j.slug ? ' selected' : ''}>${esc(j.title)}</option>`).join('')}</select>`, 'span-2')}
      ${field('技術分類', `<select id="dp-class"><option value="">跟職缺</option>${Object.entries(CLASS_LABEL).map(([k, v]) => `<option value="${k}"${x.job_class === k ? ' selected' : ''}>${v}</option>`).join('')}</select>`)}
      ${field('每月經常性薪資', `<input id="dp-salary" inputmode="numeric" value="${esc(x.regular_salary || '')}">`)}
      ${field('派遣起日', `<input id="dp-start" type="date" value="${esc(x.start_date || '')}">`)}
      ${field('派遣結束日', `<input id="dp-end" type="date" value="${esc(x.end_date || '')}">`)}
    </div><p class="help">改這裡不會通知人選或客戶。</p>`,
    footer: `<button class="btn" data-close-overlay>取消</button><button class="btn primary" data-dsp="save-person" data-id="${esc(id)}">儲存</button>`,
  });
}
async function savePerson(id) {
  await api.post(`/admin/dispatch/person/${encodeURIComponent(id)}`, {
    by: me(), consent_status: $('#dp-consent').value, stage: $('#dp-stage').value, consent_note: $('#dp-note').value,
    job_slug: $('#dp-job').value, job_class: $('#dp-class').value, regular_salary: $('#dp-salary').value, start_date: $('#dp-start').value, end_date: $('#dp-end').value,
  });
  closeOverlay(); toast('已儲存', 'success'); reload();
}
async function addActive() {
  const c = await api.get('/admin/dispatch/clients');
  const jobs = await api.get('/admin/dispatch/jobs').catch(() => ({ items: [] }));
  modal({
    title: '登記已在職的派遣人員', subtitle: '系統沒有卡、但已經在客戶那邊上班的人才用這個。其他人請從人選卡轉入。',
    body: `<div class="form-grid">
      ${field('姓名', '<input id="da-name">')}
      ${field('要派客戶', `<select id="da-co">${c.items.map((x) => `<option value="${esc(x.company_id)}">${esc(x.display_name)}</option>`).join('')}</select>`)}
      ${field('職缺（選填）', `<select id="da-job"><option value="">不對應</option>${jobs.items.map((j) => `<option value="${esc(j.slug)}">${esc(j.title)}</option>`).join('')}</select>`, 'span-2')}
      ${field('技術分類', `<select id="da-class">${Object.entries(CLASS_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>`)}
      ${field('每月經常性薪資', '<input id="da-salary" inputmode="numeric">')}
      ${field('派遣起日', '<input id="da-start" type="date">')}
    </div>`,
    footer: '<button class="btn" data-close-overlay>取消</button><button class="btn primary" data-dsp="save-active">登記</button>',
  });
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
        ${field('怎麼確認的（已同意才要寫）', '<input id="dt-note" placeholder="例：11/4 電話口頭同意">', 'span-2')}
        ${field('要配的派遣職缺（可以之後再配）', `<select id="dt-job"><option value="">之後再配</option>${jobs.items.map((j) => `<option value="${esc(j.slug)}"${preJob === j.slug ? ' selected' : ''}>${esc(j.company_name || '')}｜${esc(j.title)}</option>`).join('')}</select>`, 'span-2')}
      </div><p class="help">派遣不能讓客戶先面試。推薦後只做工作說明及技能確認，簽完勞動契約才上工。</p>`,
    footer: `<button class="btn" data-close-overlay>取消</button><button class="btn primary" data-dsp="do-transfer" data-app="${esc(app)}" data-src="${esc(src)}">轉到派遣</button>`,
  });
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
    title: '從人才庫轉入', subtitle: '打姓名、電話、Email 或編號。',
    body: '<div class="filters"><input id="df-q" style="flex:1" placeholder="搜尋人選"><button class="btn primary" data-dsp="do-find">搜尋</button></div><div id="df-result"></div>',
    footer: '<button class="btn" data-close-overlay>關閉</button>',
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
    const bad = c.health.filter((h) => h.state === 'bad').length;
    return `<article class="card dsp-client"><div class="card-head"><div><h2>${text(c.display_name)}</h2><p class="help">合約甲方：${text(c.party_name || '沒填')}・開放中需求 ${text(c.open_jobs)}・在職 ${text(c.active_people)} 人（系統紀錄）</p></div><div class="actions-row" style="margin:0">${c.status === 'confirmed' ? badge(`條款已確認（${c.confirmed_by || ''}）`, 'success') : badge('條款待確認', 'warning')}${bad ? badge(`${bad} 項要處理`, 'danger') : ''}</div></div>
      <div class="dsp-terms"><div><span>招募管理費</span><b>非技術 ${text(t.recruit_rate.nontech)}%／技術 ${text(t.recruit_rate.tech)}%</b></div><div><span>行政管理費</span><b>${text(t.admin_rate)}%</b></div><div><span>滿幾個月免招募費</span><b>${t.recruit_free_after_months == null ? '不免' : text(t.recruit_free_after_months) + ' 個月'}</b></div><div><span>付款</span><b>${t.payment_days ? text(t.payment_days) + ' 天' : '沒填'}</b></div></div>
      <h3 style="margin:16px 0 8px">合約體檢</h3>${healthHtml(c.health)}
      <div class="actions-row" style="margin-top:14px"><button type="button" class="btn primary" data-dsp="edit-terms" data-id="${esc(c.company_id)}">看／改條款</button>${c.status !== 'confirmed' ? `<button type="button" class="btn" data-dsp="confirm-terms" data-id="${esc(c.company_id)}">我核對過，確認條款</button>` : ''}</div></article>`;
  }).join('');
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
      <div class="dsp-inputs">${SETTLE_INPUTS.map(([k, l]) => field(l, `<input data-si="${k}" inputmode="numeric" value="${esc(r.inputs[k] || '')}"${done ? ' disabled' : ''}>`)).join('')}</div>
      <div data-si-result>${r.result.error ? `<div class="notice">${text(r.result.error)}</div>` : lines(r.result)}</div>
      <div class="actions-row">${done ? `<button class="btn" data-dsp="settle-undo" data-id="${esc(x.id)}">退回修改</button>` : `<button class="btn" data-dsp="settle-save" data-id="${esc(x.id)}">存草稿並重算</button><button class="btn primary" data-dsp="settle-confirm" data-id="${esc(x.id)}">核對無誤，確認這筆</button>`}</div></article>`;
  };
  target.innerHTML = `<div class="filters"><label class="dsp-inline">客戶 <select id="ds-co">${c.items.map((x) => `<option value="${esc(x.company_id)}"${x.company_id === ui.company ? ' selected' : ''}>${esc(x.display_name)}</option>`).join('')}</select></label><label class="dsp-inline">月份 <input id="ds-ym" type="month" value="${esc(ui.ym)}"></label>${s.rows.length ? '<button class="btn" data-dsp="settle-csv">匯出這個月</button>' : ''}</div>
    ${co.status !== 'confirmed' ? '<div class="notice">這家客戶的條款還沒確認，可以試算和存草稿，但不能確認結算。</div>' : ''}
    ${s.rows.length ? `<div class="kpi-grid"><article class="kpi"><span>這個月人數</span><strong>${s.rows.length}</strong></article><article class="kpi"><span>管理費合計（未稅）</span><strong>${money(mgmt)}</strong></article><article class="kpi"><span>向客戶收合計（未稅）</span><strong>${money(total)}</strong></article><article class="kpi"><span>已確認</span><strong>${s.rows.filter((r) => r.status === 'confirmed').length}</strong></article></div>${s.rows.map(row).join('')}`
      : `<div class="state"><strong>這個月系統裡沒有在職派遣人員</strong><p>系統沒有這家客戶在職派遣的紀錄。如果實際上有人在上班，到「派遣人選」按「登記已在職的人」。</p></div>`}
    ${estimateBox(co)}`;
  $('#ds-co').onchange = (e) => { ui.company = e.target.value; loadDispatchRoute('d_settlement', target); };
  $('#ds-ym').onchange = (e) => { if (e.target.value) { ui.ym = e.target.value; loadDispatchRoute('d_settlement', target); } };
}
function estimateBox(co) {
  return `<article class="card" style="margin-top:14px"><h2>試算（什麼都不會存）</h2><p class="help">照 ${text(co.display_name)} 的條款算。派遣起日不填就當新到職。</p><div class="dsp-inputs">
    ${field('每月經常性薪資', '<input id="de-salary" inputmode="numeric" placeholder="例：40000">')}
    ${field('技術分類', `<select id="de-class">${Object.entries(CLASS_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>`)}
    ${field('派遣起日', '<input id="de-start" type="date">')}
    ${field('結算月份', `<input id="de-ym" type="month" value="${esc(ui.ym || thisYm())}">`)}
    ${field('轉任日（選填）', '<input id="de-tdate" type="date">')}
    ${field('轉任後月薪（選填）', '<input id="de-tsalary" inputmode="numeric">')}
  </div><div class="actions-row"><button class="btn primary" data-dsp="estimate">算一下</button></div><div id="de-out" style="margin-top:12px"></div></article>`;
}
async function runEstimate() {
  const d = await api.post('/admin/dispatch/estimate', { company_id: ui.company, regular_salary: $('#de-salary').value, job_class: $('#de-class').value, start_date: $('#de-start').value, ym: $('#de-ym').value, transfer_date: $('#de-tdate').value, transfer_salary: $('#de-tsalary').value });
  const t = d.transfer;
  $('#de-out').innerHTML = lines(d.result) + (t ? (t.error ? `<div class="notice">${text(t.error)}</div>` : `<table class="dsp-lines"><tbody><tr class="sum"><th>轉任費<small>${text(t.formula)}</small></th><td>${money(t.fee)}</td></tr></tbody></table>`) : '');
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

// ── 請款收款（第二階段）──
async function loadBilling(target) {
  target.innerHTML = `<div class="state development"><strong>第二階段才做</strong><p>每月結算確認後，這裡會產請款明細、記發票與收款。現在還沒有動作可以做，也不會寄任何東西。</p><button class="btn" data-route="d_settlement">先去每月結算</button></div>`;
}

// ── 操作 ──
document.addEventListener('change', async (e) => {
  const sel = e.target instanceof Element ? e.target.closest('[data-dsp-class]') : null;
  if (!sel) return;
  try { await api.post(`/admin/dispatch/job/${encodeURIComponent(sel.getAttribute('data-dsp-class'))}`, { by: me(), job_class: sel.value }); toast('已更新分類', 'success'); }
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
