// 2026-11-04 Jacky：派遣模式第一階段（畫面）。後端在 backoffice-worker src/dispatch.js，全部走 /admin/dispatch/*。
// 共用資料，只切畫面：職缺、人選卡還是原本那張。切換＝換左邊選單，不是另一套系統。
// ⚠️ 這支檔案任何人都下載得到：不准寫客戶名、費率數字；條款一律從登入後的 API 讀。
import { api } from './core/api.js';
import { ROUTES } from './config.js';
import { navigate } from './core/router.js';
import { $, $$, closeOverlay, closeSubDrawer, drawer, empty, errorState, loading, modal, toast } from './core/ui.js';
import { escapeHtml, text } from './core/security.js';
import { fileButtons, wireFileButtons } from './filepreview.js';

const esc = escapeHtml;
const MODE_KEY = 's1ne_work_mode';
export const DISPATCH_NAV = [
  ['d_today', '今日待辦', '☑'], ['d_people', '派遣人選', '◉'], ['d_jobs', '派遣需求', '▣'],
  ['d_clients', '要派客戶', '♙'], ['d_settlement', '每月結算', '▦'], ['library', '書櫃', '▤'], ['d_guide', '流程與說明書', '❖'],
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
// 派遣人選兩個分頁：沿用全站 .tabs，手機自動變下拉
const PEOPLE_TABS = [['recruiting', '招募中'], ['active', '在職人員']];
const peopleTab = (t) => (PEOPLE_TABS.some(([k]) => k === t) ? t : 'active');
export const dispatchViews = {
  d_today: () => page('今日待辦', '只列要人處理的事，點一下就到那一頁。'),
  d_people: (tab) => head('派遣人選', '點一列開卡片。', '<button class="btn primary" data-dsp="find-candidate">加人</button>') + `<div class="tabs dsp-tabs">${PEOPLE_TABS.map(([k, l]) => `<button class="${peopleTab(tab) === k ? 'active' : ''}" data-tab-scope="d_people" data-tab="${k}">${l}</button>`).join('')}</div><label class="dsp-tabsel"><span>顯示</span><select data-dsp-tabsel aria-label="派遣人選分頁">${PEOPLE_TABS.map(([k, l]) => `<option value="${k}"${peopleTab(tab) === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label><div id="page-data"></div>`,
  d_jobs: () => page('派遣需求', '還在找的在上面，要你決定的在下面。'),
  d_clients: () => page('要派客戶', '每家客戶一份條款，算錢都從這裡來。', '<button class="btn" data-dsp="new-client">新增客戶</button>'),
  d_settlement: () => page('每月結算', '系統算好，核對後按確認。按確認不會寄信，也不會動錢。'),
  // 比照系統區的「AI 職務說明書」：同站靜態頁嵌在裡面，也能另開分頁。這頁公開可讀，不准寫客戶名和費率。
  d_guide: () => head('流程與說明書', '派遣從客戶簽約到結束的每一步：誰做、系統做什麼、人做什麼。', '<a class="btn primary" href="/consultant-app-beta/dispatch-guide" target="_blank" rel="noopener" style="min-height:44px;display:inline-flex;align-items:center;text-decoration:none">另開分頁看 ↗</a>') + '<div id="page-data"><iframe class="casestatus-frame" src="/consultant-app-beta/dispatch-guide" title="派遣流程與說明書" loading="lazy"></iframe></div>',
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
  if (route === 'd_guide') return;   // 畫面就是嵌入的說明書
  const loaders = { d_today: loadToday, d_people: loadPeople, d_jobs: loadJobs, d_clients: loadClients, d_settlement: loadSettlement };
  target.innerHTML = loading();
  try { await loaders[route](target); } catch (e) { console.error(e); target.innerHTML = errorState(e); }
}
const reload = () => { const t = $('#page-data'); const k = Object.entries(ROUTES).find(([, p]) => p === location.pathname.replace(/\/?$/, '/')); if (t && k && isDispatchRoute(k[0])) loadDispatchRoute(k[0], t); };

// ── 今日待辦 ──
async function loadToday(target) {
  for (let i = 0; i < 10 && !me(); i += 1) await new Promise((r) => setTimeout(r, 150));   // 等右上角「我是」載好，審核待辦才算得出來
  const d = await api.get(`/admin/dispatch/today?me=${encodeURIComponent(me())}`);
  const jump = { client: 'd_clients', jobs: 'd_jobs', person: 'd_people', settle: 'd_settlement' };
  const sorted = [...d.todos.filter((x) => x.level === 'bad'), ...d.todos.filter((x) => x.level !== 'bad')];
  target.innerHTML = sorted.length
    ? `<div class="list">${sorted.map((x) => `<button type="button" class="list-row dsp-todo ${x.level}" ${x.kind === 'client' && x.ref ? `data-dsp="todo-client" data-id="${esc(x.ref)}"` : x.kind === 'person' && x.ref ? `data-dsp="todo-person" data-id="${esc(x.ref)}" data-tab="${x.tab || 'active'}"` : `data-route="${jump[x.kind] || 'd_today'}"`}><span><b>${text(x.title)}</b><small>${text(x.detail)}</small></span>${badge(STATE_LABEL[x.level] || '要注意', STATE_BADGE[x.level] || 'warning')}</button>`).join('')}</div>`
    : empty('今天沒有要處理的事');
}

// ── 派遣人選（進度也在這裡，不另開一頁）──
function personName(x) { return x.name || '（沒有姓名）'; }
// 每個階段只有一個下一步
const NEXT = {
  consent_pending: '人選同意了', consented: '送客戶', skill_check: '客戶確認了，簽勞動契約', contract: '開始上工', active: '結束派遣',
};
async function loadPeople(target) {
  const [d, r] = await Promise.all([api.get('/admin/dispatch/people'), api.get('/admin/dispatch/roster')]);
  ui.stages = d.stages || [];
  target.__people = d.people;
  const stageLabel = Object.fromEntries(ui.stages);
  const demoTag = (x) => (x.is_test ? ' ' + badge('示範資料', 'info') : '');
  const apps = (d.applicants || []).filter((a) => !a.closed_stage);
  const todo = d.people.filter((x) => !['active', 'ended', 'converted'].includes(x.stage));
  const past = d.people.filter((x) => ['ended', 'converted'].includes(x.stage));
  const n = todo.length + apps.length;
  const payCell = (p) => `<span class="dsp-st-pill ${p.key}">${text(p.label)}${p.ym ? `<small>${text(p.ym)} 月</small>` : ''}</span>`;
  const careCell = (x) => `<span class="dsp-st-pill ${x.care.key}">${text(x.care.label)}</span>`;
  const hasDemo = d.people.some((x) => x.is_test);
  const hot = (x) => ['overdue', 'due'].includes(x.care.key) || ['need_in', 'need_out'].includes(x.insurance.key) || x.payroll.key === 'late';
  const rosterRows = r.items.map((x) => `<tr class="${x.is_test ? 'demo' : ''}${hot(x) ? ' care-due' : ''}" data-dsp="open-person" data-id="${esc(x.id)}"><td><button type="button" class="dsp-link" data-dsp="open-person" data-id="${esc(x.id)}">${text(x.name || '（沒有姓名）')}</button>${demoTag(x)}</td><td>${text(x.company_name || '—')}</td><td>${text(x.job_title || '—')}</td><td>${text(x.start_date || '—')}</td><td>${payCell(x.insurance)}</td><td>${payCell(x.payroll)}</td><td>${payCell(x.pay)}</td><td>${x.last_care ? `${text(x.last_care.care_date)}<small>${text(String(x.last_care.content).slice(0, 40))}</small>` : '<small>還沒有紀錄</small>'}</td><td>${careCell(x)}</td></tr>`).join('');
  const tab = peopleTab(new URLSearchParams(location.search).get('tab'));
  const pastRow = (x) => `<tr class="${x.is_test ? 'demo' : ''}" data-dsp="open-person" data-id="${esc(x.id)}"><td><button type="button" class="dsp-link" data-dsp="open-person" data-id="${esc(x.id)}">${text(personName(x))}</button>${demoTag(x)}</td><td>${text(x.company_name || '—')}</td><td>${text(x.job_title || '—')}</td><td>${text(x.start_date || '—')}</td><td>${text(x.end_date || '—')}</td><td>${text(stageLabel[x.stage] || x.stage)}</td></tr>`;
  const recruitRow = (x) => `<tr class="${x.is_test ? 'demo' : ''}" data-dsp="open-person" data-id="${esc(x.id)}"><td><button type="button" class="dsp-link" data-dsp="open-person" data-id="${esc(x.id)}">${text(personName(x))}</button>${demoTag(x)}</td><td>${text(x.company_name || '還沒配客戶')}</td><td>${text(x.job_title || '—')}</td><td>${text(stageLabel[x.stage] || x.stage)}</td><td>${text((CONSENT[x.consent_status] || CONSENT.pending)[0])}</td><td><button type="button" class="btn primary sm" data-dsp="next-step" data-id="${esc(x.id)}">${text(NEXT[x.stage] || '')}</button></td></tr>`;
  const appRecruitRow = (a) => `<tr data-dsp="open-card" data-app="${esc(a.id)}"><td><button type="button" class="dsp-link" data-dsp="open-card" data-app="${esc(a.id)}">${text(a.name || '（沒有姓名）')}</button></td><td>${text(a.company_name || '—')}</td><td>${text(a.job_title || a.job_slug || '—')}</td><td>應徵派遣職缺</td><td>還沒記錄</td><td><button type="button" class="btn primary sm" data-dsp="transfer" data-app="${esc(a.id)}" data-job="${esc(a.job_slug || '')}">記錄同意</button></td></tr>`;
  const demoNote = hasDemo ? '<p class="help" style="margin-top:12px">示範資料不算人數、不進報表和請款，也不會通知任何人。<button type="button" class="btn ghost sm" data-dsp="demo-delete">刪除全部示範資料</button></p>' : '';
  target.innerHTML = tab === 'recruiting'
    ? `<article class="card"><p class="help">每個人只有一個下一步，做完按它。共 ${n} 人。</p>${n ? `<div class="dsp-tablewrap"><table class="dsp-table dsp-recruit"><thead><tr><th>姓名</th><th>客戶</th><th>職缺</th><th>階段</th><th>派遣同意</th><th>下一步</th></tr></thead><tbody>${todo.map(recruitRow).join('')}${apps.map(appRecruitRow).join('')}</tbody></table></div>` : '<p class="muted">目前沒有。</p>'}</article>${demoNote}`
    : `<article class="card"><p class="help">在職真實 ${r.items.filter((x) => !x.is_test).length} 人。</p>${r.items.length ? `<div class="dsp-tablewrap"><table class="dsp-table dsp-roster"><thead><tr><th>姓名</th><th>客戶</th><th>職缺</th><th>到職日</th><th>加保</th><th>發薪</th><th>預計客戶付款日</th><th>最近關心</th><th>下次關心</th></tr></thead><tbody>${rosterRows}</tbody></table></div>` : '<p class="muted">系統裡還沒有在職的人。實際有人在上班的話，按右上角「加人」登記。</p>'}</article>
    ${past.length ? `<details class="card" style="margin-top:14px"><summary><b>已結束（${past.length}）</b></summary><div class="dsp-tablewrap" style="margin-top:10px"><table class="dsp-table dsp-recruit"><thead><tr><th>姓名</th><th>客戶</th><th>職缺</th><th>到職日</th><th>結束日</th><th>階段</th></tr></thead><tbody>${past.map(pastRow).join('')}</tbody></table></div></details>` : ''}${demoNote}`;
  if (ui.pendingOpen) { const id = ui.pendingOpen; ui.pendingOpen = null; openPerson(id).catch(() => {}); }
}
// 人員卡片：打開就看得到現況，關心紀錄直接在這裡加
async function openPerson(id) {
  const d = await api.get(`/admin/dispatch/person-card/${encodeURIComponent(id)}`);
  const x = d.person; const t = d.terms;
  ui.cardPerson = x; ui.stages = d.stages || ui.stages;
  const stageLabel = Object.fromEntries(d.stages || []);
  const need = d.settlements.find((r) => r.pay.key === 'need_invoice');
  const late = d.settlements.find((r) => r.pay.key === 'overdue');
  const draft = d.settlements.find((r) => r.status === 'draft');
  const noHours = d.settlements.find((r) => r.hours.key === 'none');
  const next = d.offboarding_left.length ? `結束派遣還有 ${d.offboarding_left.length} 項：${d.offboarding_left.join('、')}`
    : d.insurance.key === 'need_out' ? '還沒退保，辦好後在下面記退保日'
    : x.stage !== 'active' ? (NEXT[x.stage] || '沒有下一步')
    : d.insurance.key === 'need_in' ? '到職了還沒加保，辦好後在下面記加保日'
    : d.care.key === 'overdue' || d.care.key === 'due' ? '該關心了，打個電話，下面記一筆'
    : late ? `${late.ym} 月款項已過預計付款日，確認客戶付款了沒`
    : need ? `補 ${need.ym} 月的發票日`
    : noHours ? `等 ${noHours.ym} 月客戶工時`
    : draft ? `核對 ${draft.ym} 月結算` : '目前沒有要做的事';
  const last = d.settlements.find((r) => r.status === 'confirmed') || d.settlements[0];
  const payBasis = t.payment_days ? `${t.basis_label}${t.payment_note ? `，${t.payment_note}` : ''}` : '付款天數沒設定';
  const contract = `${t.contract_start || '起日沒填'}～${t.contract_end || (t.renewed ? '新到期日待補' : '到期日沒填')}（${d.contract_status.label}）`;
  const stRows = d.settlements.map((r) => `<div class="dsp-st"><div><b>${text(r.ym)}</b>${r.total_untaxed != null ? `<span>向客戶收（未稅）${money(r.total_untaxed)}</span>` : ''}<span class="dsp-st-pill ${r.hours.key}">${text(r.hours.label)}</span><span class="dsp-st-pill ${r.payroll.key}">${text(r.payroll.label)}</span><span class="dsp-pay ${r.pay.key}">${text(r.pay.label)}</span></div></div>`).join('');
  const careRows = d.cares.map((c) => `<li><b>${text(c.care_date)}</b>${c.created_by ? `<small>${text(c.created_by)}</small>` : ''}<p>${text(c.content)}</p></li>`).join('');
  const today = d.today; const plus30 = new Date(Date.parse(`${today}T00:00:00Z`) + 30 * 864e5).toISOString().slice(0, 10);
  drawer({
    title: personName(x), subtitle: `${x.company_name || '還沒配客戶'}${x.job_title ? '・' + x.job_title : ''}`,
    body: `<div class="drawer-section dsp-pcard">
      ${x.is_test ? '<div class="notice">示範資料：人和金額都是舉例，不算進真實人數、合計或請款，不會通知任何人。</div>' : ''}
      <div class="dsp-next ${d.offboarding_left.length || d.care.key === 'overdue' || d.care.key === 'due' || late || ['need_in', 'need_out'].includes(d.insurance.key) ? 'hot' : ''}"><span>目前的下一步</span><b>${text(next)}</b></div>
      <h3>基本資料</h3><dl class="dsp-dl"><div><dt>階段</dt><dd>${text(stageLabel[x.stage] || x.stage)}</dd></div><div><dt>分類</dt><dd>${text(CLASS_LABEL[x.job_class] || '沒分類')}</dd></div><div><dt>勞動契約</dt><dd>不定期</dd></div><div><dt>派遣期間（客戶端）</dt><dd><span class="dsp-st-pill ${d.dispatch_period.key === 'expired' ? 'overdue' : d.dispatch_period.key === 'expiring' ? 'waiting' : ''}">${text(d.dispatch_period.label)}</span></dd></div><div><dt>到職日</dt><dd>${text(x.start_date || '沒填')}${x.end_date ? `，結束 ${text(x.end_date)}` : ''}</dd></div><div><dt>客戶合約期間</dt><dd>${text(contract)}</dd></div><div><dt>目前每月經常性薪資</dt><dd>${money(d.current_salary)}${x.is_test ? '（示範）' : ''}</dd></div><div><dt>最近一筆向客戶收（未稅）</dt><dd>${last && last.total_untaxed != null ? `${money(last.total_untaxed)}（${text(last.ym)}）` : '還沒有結算'}</dd></div></dl>
      <h3>任用與人員資料</h3><dl class="dsp-dl"><div><dt>加保</dt><dd><span class="dsp-st-pill ${d.insurance.key}">${text(d.insurance.label)}</span></dd></div><div><dt>加保日／退保日</dt><dd>${text(x.insured_date || '沒填')}／${text(x.uninsured_date || '沒填')}</dd></div><div><dt>發薪（任用資料）</dt><dd>${x.payroll_day ? `隔月 ${text(x.payroll_day)} 日前發上月薪資` : '<span class="dsp-st-pill need_date">待填</span>'}</dd></div><div><dt>現場主管</dt><dd>${text(x.site_manager || '沒填')}${x.site_contact ? `・${text(x.site_contact)}` : ''}</dd></div><div><dt>緊急聯絡人</dt><dd>${text(x.emergency_contact || '沒填')}</dd></div><div><dt>文件</dt><dd>${d.doc_items.map(([k, l]) => `<span class="dsp-st-pill ${d.docs[k] ? 'in' : 'need_date'}">${d.docs[k] ? '有' : '缺'} ${text(l)}</span>`).join(' ')}</dd></div></dl>
      <div class="actions-row"><button type="button" class="btn sm" data-dsp="edit-profile" data-id="${esc(x.id)}">改任用與人員資料</button></div>
      ${d.milestones.length ? `<h3>到職滿期</h3><table class="dsp-lines dsp-miles"><thead><tr><th>滿期</th><th>日期</th><th>客戶轉任費比例</th></tr></thead><tbody>${d.milestones.map((m) => `<tr class="${m.soon ? 'soon' : ''}"><td>${text(m.label)}${m.note ? `<small>${text(m.note)}</small>` : ''}</td><td>${text(m.date)}${m.passed ? '<small>已滿</small>' : m.soon ? '<small>30 天內</small>' : ''}</td><td>${m.percent == null ? '—' : `轉任後月薪 ${text(m.percent)}%`}</td></tr>`).join('')}</tbody></table><p class="help">比例依這家客戶合約的轉任費設定，這裡只顯示，不計算轉任費。</p>` : ''}
      ${x.start_date ? `<h3>轉任費試算</h3><div class="dsp-inputs"><label class="field"><span>轉任日</span><input type="date" id="dt2-date" value="${esc(today)}"></label><label class="field"><span>轉任後月薪</span><input id="dt2-salary" inputmode="numeric" placeholder="例：60000"></label></div><div class="actions-row"><button type="button" class="btn sm" data-dsp="transfer-fee" data-co="${esc(x.company_id || '')}" data-start="${esc(x.start_date)}">算轉任費</button></div><div id="dt2-out" class="help"></div><p class="help">只試算，什麼都不會存，也不會開發票。</p>` : ''}
      <h3>關心紀錄</h3><div class="dsp-care-form"><label>日期<input type="date" id="dc2-date" value="${esc(today)}"></label><label>下次關心<input type="date" id="dc2-next" value="${esc(plus30)}"></label><label class="wide">這次聊了什麼<textarea id="dc2-text" rows="2" placeholder="例：工作適應，主管反應不錯"></textarea></label><button type="button" class="btn primary" data-dsp="save-care" data-id="${esc(x.id)}">記一筆</button></div>
      <p class="help">${x.application_id ? '會同步寫回人選卡片。' : '這位沒有人選卡，只記在這裡。'}不會通知人選。下次關心：<span class="dsp-care ${d.care.key}">${text(d.care.label)}</span></p>
      ${careRows ? `<ul class="dsp-care-list">${careRows}</ul>` : '<p class="muted">還沒有紀錄。</p>'}
      <h3>薪資與職務異動</h3>${d.changes.length ? `<ul class="dsp-care-list">${d.changes.map((c) => `<li><b>${text(c.effective_date)} 生效</b> ${text(CHANGE_LABEL[c.kind] || c.kind)}<small>${text(c.created_by || '')}</small><p>${text(c.old_value == null ? '空白' : c.old_value)} → ${text(c.new_value)}${c.note ? `（${text(c.note)}）` : ''}</p></li>`).join('')}</ul>` : '<p class="muted">沒有異動。</p>'}<div class="actions-row"><button type="button" class="btn sm" data-dsp="add-change" data-id="${esc(x.id)}">記一筆異動</button></div>
      <h3>每月結算與付款</h3><p class="help">預計付款日怎麼算：${text(payBasis)}。發票日和實收日到「每月結算」的收款追蹤記。</p>${stRows || '<p class="muted">還沒有結算。</p>'}
      ${x.stage === 'ended' ? offboardBox(x, d) : ''}
      <details class="dsp-more"><summary>修改紀錄（${d.logs.length}）</summary>${logList(d.logs)}</details>
      <div class="actions-row" style="margin-top:16px">${x.application_id ? `<button type="button" class="btn" data-dsp="open-card" data-app="${esc(x.application_id)}">看人選卡</button>` : ''}<button type="button" class="btn" data-dsp="edit-person" data-id="${esc(x.id)}">修改</button>${x.stage === 'active' ? `<button type="button" class="btn" data-dsp="offboard" data-id="${esc(x.id)}">結束派遣</button>` : NEXT[x.stage] ? `<button type="button" class="btn" data-dsp="next-step" data-id="${esc(x.id)}">${NEXT[x.stage]}</button>` : ''}</div>
    </div>`,
  });
}
const CHANGE_LABEL = { salary: '調薪', department: '調部門', title: '改職務' };
const logList = (items) => (items.length ? `<ul class="dsp-logs">${items.map((l) => `<li><small>${text(String(l.changed_at || '').slice(0, 16))}・${text(l.changed_by || '')}</small>${text(l.detail || '')}</li>`).join('')}</ul>` : '<p class="muted">還沒有紀錄。</p>');
function offboardBox(x, d) {
  const o = d.offboarding || {};
  const opt = (list, cur) => `<option value="">還沒定</option>${list.map((v) => `<option value="${v}"${cur === v ? ' selected' : ''}>${v}</option>`).join('')}`;
  return `<h3>結束派遣清單（還有 ${d.offboarding_left.length} 項）</h3><div class="dsp-off" data-off="${esc(x.id)}">
    <div class="form-grid">${field('最後工作日', `<input type="date" id="do-last" value="${esc(x.end_date || '')}">`)}${field('原因', `<input id="do-reason" value="${esc(o.reason || '')}">`)}
    ${field(x.insured_date ? '退保日' : '退保日（沒有加保紀錄，不用填）', `<input type="date" id="do-out" value="${esc(x.uninsured_date || '')}">`)}
    ${field('資遣費／預告工資由誰付', `<select id="do-sev">${opt(['客戶', '我方', '不適用'], o.severance_payer)}</select>`)}
    ${field('非自願離職證明', `<select id="do-cert">${opt(['已開', '不需要'], o.cert)}</select>`)}</div>
    <div class="dsp-checks"><label><input type="checkbox" id="do-pay"${o.last_pay ? ' checked' : ''}> 最後一筆薪資處理完</label><label><input type="checkbox" id="do-leave"${o.annual_leave ? ' checked' : ''}> 特休結算完</label></div>
    <div class="actions-row"><button type="button" class="btn primary" data-dsp="save-offboard" data-id="${esc(x.id)}">存清單</button></div>${d.offboarding_left.length ? `<p class="help">還沒做完的會留在今日待辦：${text(d.offboarding_left.join('、'))}。</p>` : '<p class="help">都做完了。</p>'}</div>`;
}
function openOffboard(id) {
  const x = currentPeople().find((p) => p.id === id);
  if (!x) return;
  modal({
    title: `${personName(x)}：結束派遣`, subtitle: `${x.is_test ? '示範資料。' : ''}先填這兩項，其餘在卡片上逐項完成。不會通知人選或客戶。`,
    body: `<div class="form-grid">${field('最後工作日', '<input type="date" id="do-last">')}${field('原因', '<input id="do-reason" placeholder="例：合約期滿">')}</div>`,
    footer: `<button class="btn" data-dsp="open-person" data-id="${esc(id)}">取消</button><button class="btn primary" data-dsp="start-offboard" data-id="${esc(id)}">開始結束流程</button>`,
  });
}
async function saveOffboard(id, full) {
  const body = { by: me(), last_work_day: $('#do-last').value, reason: $('#do-reason').value };
  if (full) Object.assign(body, { uninsured_date: $('#do-out').value, severance_payer: $('#do-sev').value, cert: $('#do-cert').value, last_pay: $('#do-pay').checked, annual_leave: $('#do-leave').checked });
  await api.post(`/admin/dispatch/person/${encodeURIComponent(id)}/offboard`, body);
  toast('已存', 'success'); await openPerson(id); refreshBehind();
}
function addChange(id) {
  const x = currentPeople().find((p) => p.id === id);
  if (!x) return;
  modal({
    title: `${personName(x)}：記一筆異動`, subtitle: `${x.is_test ? '示範資料。' : ''}月中調薪怎麼算合約沒寫，那個月會標待確認。`,
    body: `<div class="form-grid">${field('異動類型', `<select id="dg-kind">${Object.entries(CHANGE_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>`)}${field('生效日', '<input type="date" id="dg-date">')}${field('異動後（薪資填數字）', '<input id="dg-val">', 'span-2')}${field('備註（選填）', '<input id="dg-note">', 'span-2')}</div>`,
    footer: `<button class="btn" data-dsp="open-person" data-id="${esc(id)}">取消</button><button class="btn primary" data-dsp="save-change" data-id="${esc(id)}">儲存</button>`,
  });
}
async function saveChange(id) {
  await api.post(`/admin/dispatch/person/${encodeURIComponent(id)}/change`, { by: me(), kind: $('#dg-kind').value, effective_date: $('#dg-date').value, new_value: $('#dg-val').value, note: $('#dg-note').value });
  toast('已記', 'success'); await openPerson(id); refreshBehind();
}
async function saveCare(id) {
  await api.post(`/admin/dispatch/person/${encodeURIComponent(id)}/care`, { by: me(), care_date: $('#dc2-date').value, next_care_date: $('#dc2-next').value, content: $('#dc2-text').value });
  toast('已記一筆', 'success'); await openPerson(id); refreshBehind();
}
async function editProfile(id) {
  const d = await api.get(`/admin/dispatch/person-card/${encodeURIComponent(id)}`);
  const x = d.person;
  modal({
    title: `${personName(x)}：任用與人員資料`, subtitle: `${x.is_test ? '示範資料。' : ''}不會通知任何人。`,
    body: `<div class="form-grid">
      ${field('發薪：隔月幾日前發上月薪資（公司標準 7，可逐人改）', `<input id="dq-payday" inputmode="numeric" value="${esc(x.payroll_day || '')}">`, 'span-2')}
      ${field('加保日', `<input id="dq-in" type="date" value="${esc(x.insured_date || '')}">`)}
      ${field('退保日', `<input id="dq-out" type="date" value="${esc(x.uninsured_date || '')}">`)}
       ${field('派遣期間到期日（客戶端，不是勞動契約）', `<input id="dq-end" type="date" value="${esc(x.planned_end_date || '')}">`)}
      ${field('現場主管', `<input id="dq-mgr" value="${esc(x.site_manager || '')}">`)}
      ${field('現場主管聯絡方式', `<input id="dq-contact" value="${esc(x.site_contact || '')}">`)}
      ${field('緊急聯絡人', `<input id="dq-emg" value="${esc(x.emergency_contact || '')}">`)}
      <div class="field span-2"><span>文件是否齊全</span><div class="dsp-checks">${d.doc_items.map(([k, l]) => `<label><input type="checkbox" data-doc="${k}"${d.docs[k] ? ' checked' : ''}> ${esc(l)}</label>`).join('')}</div></div>
    </div>`,
    footer: `<button class="btn" data-dsp="open-person" data-id="${esc(id)}">取消</button><button class="btn primary" data-dsp="save-profile" data-id="${esc(id)}">儲存</button>`,
  });
}
async function saveProfile(id) {
  await api.post(`/admin/dispatch/person/${encodeURIComponent(id)}/profile`, { by: me(), payroll_day: $('#dq-payday').value, insured_date: $('#dq-in').value, uninsured_date: $('#dq-out').value, planned_end_date: $('#dq-end').value, site_manager: $('#dq-mgr').value, site_contact: $('#dq-contact').value, emergency_contact: $('#dq-emg').value, docs: Object.fromEntries($$('[data-doc]').map((el) => [el.getAttribute('data-doc'), el.checked])) });
  toast('已儲存', 'success'); await openPerson(id); refreshBehind();
}
// 卡片開著時，後面的名單也跟著更新
const refreshBehind = () => { const t = $('#page-data'); if (t && location.pathname.includes('/dispatch/people')) loadPeople(t).catch(() => {}); };
function currentPeople() { return [...(($('#page-data') || {}).__people || []), ...(ui.cardPerson ? [ui.cardPerson] : [])]; }
const jobOptions = (items, cur) => items.map((j) => `<option value="${esc(j.slug)}"${cur === j.slug ? ' selected' : ''}>${esc(j.title)}</option>`).join('');
// 下一步：只問這一步需要的欄位，不需要就直接做
async function nextStep(id) {
  const x = currentPeople().find((p) => p.id === id);
  if (!x) return;
  if (x.stage === 'active') { openOffboard(id); return; }
  const needJob = !x.job_slug;
  const jobs = needJob || x.stage === 'contract' ? await api.get('/admin/dispatch/jobs') : { items: [] };
  const form = {
    consent_pending: field('怎麼確認同意的', `<input id="dn-note" value="${esc(x.consent_note || '')}" placeholder="例：11/4 電話口頭同意">`),
    consented: needJob ? field('要送哪個職缺', `<select id="dn-job"><option value="">請選</option>${jobOptions(jobs.items, x.job_slug)}</select>`) : '',
    contract: `<div class="form-grid">${needJob ? field('派遣職缺', `<select id="dn-job"><option value="">請選</option>${jobOptions(jobs.items, x.job_slug)}</select>`, 'span-2') : ''}${x.job_class ? '' : field('技術分類', `<select id="dn-class">${Object.entries(CLASS_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>`)}${field('每月經常性薪資', `<input id="dn-salary" inputmode="numeric" value="${esc(x.regular_salary || '')}">`)}${field('派遣起日', `<input id="dn-start" type="date" value="${esc(x.start_date || '')}">`)}</div>`,
    active: field('派遣結束日', `<input id="dn-end" type="date" value="${esc(x.end_date || '')}">`),
  }[x.stage] || '';
  if (!form) { await applyNext(id); return; }
  modal({ title: `${personName(x)}：${NEXT[x.stage]}`, subtitle: x.is_test ? '示範資料。不會通知人選或客戶。' : '不會通知人選或客戶。', body: form, footer: `<button class="btn" data-close-overlay>取消</button><button class="btn primary" data-dsp="apply-next" data-id="${esc(id)}">確定</button>` });
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
    title: `修改 ${personName(x)}`, subtitle: `${x.is_test ? '示範資料。' : ''}填錯才需要改。不會通知人選或客戶。`,
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
  const row = (j, note) => `<article class="dsp-job"><div class="dsp-job-main"><button type="button" class="dsp-link" data-dsp="open-job" data-slug="${esc(j.slug)}">${text(j.title)}</button>${j.urgent ? ' ' + badge('最急', 'danger') : ''}<small>${salaryOf(j)}・應徵 ${text(j.applicants || 0)} 人${note ? '・' + text(note) : ''}</small></div><div class="dsp-job-side">${classCtl(j)}</div></article>`;
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
      </div>`,
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
  ui.clientList = d.items;
  if (!d.items.length) { target.innerHTML = empty('還沒有要派客戶', '按右上角新增。'); return; }
  if (!d.items.some((c) => c.company_id === ui.clientId)) ui.clientId = null;
  const tone = { expired: 'danger', expiring: 'warning', unknown: 'warning', active: 'success', renewed: 'success' };
  target.innerHTML = `<p class="help">點客戶展開合約和費率，再點收起。一次只開一家。</p><div class="dsp-acc">${d.items.map((c) => `<article class="dsp-acc-item${c.company_id === ui.clientId ? ' open' : ''}"><button type="button" class="dsp-acc-head" data-dsp="open-client" data-id="${esc(c.company_id)}" aria-expanded="${c.company_id === ui.clientId}" aria-controls="dc-${esc(c.company_id)}"><span class="dsp-acc-caret" aria-hidden="true">▸</span><b>${text(c.display_name)}</b><span class="dsp-acc-badges">${badge(`合約${c.contract_status.label}`, tone[c.contract_status.key])}${c.missing.length ? badge(`還沒填完 ${c.missing.length} 項`, 'danger') : c.status === 'confirmed' ? badge('條款已確認', 'success') : badge('條款待確認', 'warning')}${c.pending_requests ? badge('調整待審', 'danger') : ''}</span><small>開放需求 ${text(c.open_jobs)}・在職 ${text(c.active_people)}</small></button><div class="dsp-acc-body" id="dc-${esc(c.company_id)}"${c.company_id === ui.clientId ? '' : ' hidden'}></div></article>`).join('')}</div>`;
  if (ui.clientId) await loadClientDetail(ui.clientId);
}
async function toggleClient(id) {
  const opening = ui.clientId !== id;
  $$('.dsp-acc-item').forEach((el) => { const on = opening && el.querySelector('.dsp-acc-head').getAttribute('data-id') === id; el.classList.toggle('open', on); el.querySelector('.dsp-acc-head').setAttribute('aria-expanded', on); const body = el.querySelector('.dsp-acc-body'); body.hidden = !on; if (!on) body.innerHTML = ''; });
  ui.clientId = opening ? id : null;
  if (opening) await loadClientDetail(id);
}
function requestsHtml(c) {
  if (!c.requests.length) return '';
  return `<div class="dsp-reqs">${c.requests.map((q) => `<div class="dsp-req ${q.status}"><div class="card-head"><b>${q.status === 'pending' ? '調整待審' : `已核准，${text(q.effective_ym)} 起生效`}</b><small>${text(q.requested_by)} 申請・${text(String(q.requested_at).slice(0, 16))}</small></div><table class="dsp-lines dsp-req-t"><thead><tr><th>項目</th><th>舊值</th><th>新值</th></tr></thead><tbody>${q.changes.map((x) => `<tr><th>${text(x.label)}</th><td>${text(x.old)}</td><td><b>${text(x.new)}</b></td></tr>`).join('')}</tbody></table><p class="help">理由：${text(q.reason)}。生效月份：${text(q.effective_ym)}。${q.status === 'pending' ? '核准前算錢繼續用舊值；核准後只影響生效月份以後，已確認的結算不重算。' : ''}</p>${q.can_review ? `<div class="form-grid"><label class="field span-2"><span>退回原因（退回才要寫）</span><input data-req-note="${esc(q.id)}"></label></div><div class="actions-row"><button type="button" class="btn primary" data-dsp="review-terms" data-action="approve" data-id="${esc(q.id)}">核准</button><button type="button" class="btn danger" data-dsp="review-terms" data-action="reject" data-id="${esc(q.id)}">退回</button></div>` : q.status === 'pending' ? `<p class="help">${q.requested_by === me() ? '自己提的不能自己批，等另一位審核。' : '只有 Jacky、Phoebe 能審核；請確認右上角「我是」。'}</p>` : ''}</div>`).join('')}</div>`;
}
async function loadClientDetail(id) {
  const box = document.getElementById(`dc-${id}`);
  if (!box) return;
  box.innerHTML = loading();
  const c = await api.get(`/admin/dispatch/client/${encodeURIComponent(id)}?me=${encodeURIComponent(me())}`);
  ui.clientDetail = c;
  const t = c.terms;
  const pct = (v) => (v == null ? '沒填' : `${text(v)}%`);
  const problems = c.health.filter((h) => h.state !== 'ok' && h.key !== 'term');
  const cs = c.contract_status;
  const csTone = { expired: 'danger', expiring: 'warning', unknown: 'warning', active: 'success', renewed: 'success' }[cs.key];
  const pending = c.requests.some((q) => q.status === 'pending');
  box.innerHTML = `<p class="help">合約甲方：${text(c.party_name || '沒填')}。${c.status === 'confirmed' ? `條款已確認（${text(c.confirmed_by || '')}）。` : '條款待確認。'}</p>
      ${requestsHtml(c)}
      ${c.missing.length ? `<div class="notice">還沒填，請按「改條款」補：${text(c.missing.join('、'))}。沒填完算不出金額。</div>` : ''}
      <div class="dsp-contract ${cs.key}"><div><span>合約</span><b>${t.contract_start ? text(t.contract_start) : '起日沒填'}～${t.contract_end ? text(t.contract_end) : (t.renewed ? '新到期日待補' : '到期日沒填')}</b>${cs.key === 'renewed' ? '<small>續約文件和新到期日待補，有日期才開始提醒</small>' : t.auto_renew ? '<small>會自動續約</small>' : '<small>不會自動續約・到期前 60 天提醒</small>'}</div>${badge(cs.label, csTone)}<div class="dsp-contract-files">${c.contract_files.map((f) => fileButtons(`/admin/file/${encodeURIComponent(f.file_id)}`, f.filename || f.title)).join('') || '<button type="button" class="btn sm" data-route="library">合約檔還沒放，到書櫃上傳</button>'}</div></div>
      <div class="dsp-terms"><div><span>招募管理費</span><b>非技術 ${pct(t.recruit_rate.nontech)}／技術 ${pct(t.recruit_rate.tech)}</b></div><div><span>行政管理費</span><b>${pct(t.admin_rate)}</b></div><div><span>免招募費</span><b>${t.recruit_free_never ? '不免' : t.recruit_free_after_months == null ? '沒填' : '滿 ' + text(t.recruit_free_after_months) + ' 個月'}</b></div><div><span>付款</span><b>${t.payment_days ? (t.payment_basis === 'invoice_plus' ? `發票日＋${text(t.payment_days)} 天` : t.payment_basis === 'month_end_plus' ? `當月底＋${text(t.payment_days)} 天` : `${text(t.payment_days)} 天，算法待確認`) : '沒填'}</b>${t.payment_note ? `<small>${text(t.payment_note)}</small>` : ''}</div><div><span>客戶合約的發票期限</span><b>${t.invoice_due_day ? `每月 ${text(t.invoice_due_day)} 日前` : '沒填'}</b></div><div><span>發票開給</span><b>${t.invoice_to ? text(t.invoice_to) : '沒填'}</b>${t.invoice_note ? `<small>${text(t.invoice_note)}</small>` : ''}</div>${t.payroll_contact ? `<div><span>薪資窗口</span><b>${text(t.payroll_contact)}</b></div>` : ''}<div><span>福利金扣除</span><b>${t.welfare_permille == null ? '沒填' : '千分之 ' + text(t.welfare_permille)}</b>${t.welfare_note ? `<small>${text(t.welfare_note)}</small>` : ''}</div><div><span>轉任費比例</span><b>${t.transfer_tiers.length ? t.transfer_tiers.map((x) => text(x.percent == null ? '沒填' : `${x.percent}%`)).join('／') : '沒填'}</b></div></div>
      ${problems.length ? `<details class="dsp-more" style="margin-top:10px"><summary>條文上的缺口（${problems.length}），談新合約時再看</summary>${healthHtml(problems)}</details>` : ''}
      <div class="actions-row" style="margin-top:14px">${c.status !== 'confirmed' ? `<button type="button" class="btn primary" data-dsp="confirm-terms" data-id="${esc(id)}"${c.missing.length ? ' disabled' : ''}>核對過，確認條款</button>` : ''}<button type="button" class="btn" data-dsp="edit-terms" data-id="${esc(id)}"${pending ? ' title="這家已有一筆待審"' : ''}>改條款</button></div>
      <details class="dsp-more"><summary>修改紀錄（${c.logs.length}）</summary>${logList(c.logs)}</details>`;
  wireFileButtons(box);
}
const BASE_LABEL = { statutory: '法定保險與提撥', welfare: '福利費用', overtime: '加班費', bonus: '獎金津貼' };
const BLANK_TIERS = [{ under_months: 3, percent: null }, { under_months: 6, percent: null }, { under_months: 9, percent: null }, { under_months: null, percent: null }];
const BLANK_TERMS = { recruit_rate: {}, fee_base: {}, transfer_tiers: [], clauses: {} };
// 6 項數字：舊客戶改了要審核；新增客戶存好就生效
function numbersForm(t) {
  const cl = t.clauses || {}; const v = (x) => esc(x == null ? '' : x);
  const clause = (k) => (cl[k] ? `<small class="muted">出處：${esc(cl[k])}</small>` : '');
  const rr = t.recruit_rate || {};
  const tiers = (t.transfer_tiers && t.transfer_tiers.length ? t.transfer_tiers : BLANK_TIERS).map((b, i) => `<div class="dsp-tier"><span>${b.under_months == null ? '滿前一階以上' : `未滿 ${esc(b.under_months)} 個月`}</span><input data-tier="${i}" data-m="${b.under_months == null ? '' : esc(b.under_months)}" inputmode="decimal" value="${v(b.percent)}" aria-label="轉任費百分比"><span>%</span></div>`).join('');
  return `<div class="form-grid">
      ${field(`招募費・非技術 % ${clause('fee')}`, `<input id="dc-rn" inputmode="decimal" value="${v(rr.nontech)}">`)}
      ${field('招募費・技術 %', `<input id="dc-rt" inputmode="decimal" value="${v(rr.tech)}">`)}
      ${field('行政管理費 %', `<input id="dc-admin" inputmode="decimal" value="${v(t.admin_rate)}">`)}
      ${field('滿幾個月免招募費', `<input id="dc-free" inputmode="numeric" value="${v(t.recruit_free_after_months)}">`)}
      <div class="field"><span>或這家不免</span><div class="dsp-checks"><label><input type="checkbox" id="dc-never"${t.recruit_free_never ? ' checked' : ''}> 招募費一直收</label></div></div>
      ${field(`客戶可扣福利金（千分之幾） ${clause('welfare')}`, `<input id="dc-welfare" inputmode="decimal" value="${v(t.welfare_permille)}">`)}
      ${field(`付款天數 ${clause('payment')}`, `<input id="dc-pay" inputmode="numeric" value="${v(t.payment_days)}">`)}
      ${field('付款算法', `<select id="dc-basis"><option value=""${!t.payment_basis ? ' selected' : ''}>待確認</option><option value="invoice_plus"${t.payment_basis === 'invoice_plus' ? ' selected' : ''}>發票日＋天數</option><option value="month_end_plus"${t.payment_basis === 'month_end_plus' ? ' selected' : ''}>發票當月底＋天數</option></select>`)}
      ${field('客戶合約的發票期限（每月幾日前開前月份發票）', `<input id="dc-invday" inputmode="numeric" value="${v(t.invoice_due_day)}">`)}
      <div class="field span-2"><span>轉任費（轉任後月薪的 %） ${clause('transfer')}</span>${tiers}</div></div>`;
}
function otherForm(t, party) {
  const cl = t.clauses || {}; const v = (x) => esc(x == null ? '' : x); const fb = t.fee_base || {};
  const clause = (k) => (cl[k] ? `<small class="muted">出處：${esc(cl[k])}</small>` : '');
  return `<div class="form-grid">
      ${field('合約甲方', `<input id="dc-party" value="${v(party)}">`, 'span-2')}
      ${field('合約起日', `<input id="dc-start" type="date" value="${v(t.contract_start)}">`)}
      ${field(`合約到期日 ${clause('term')}`, `<input id="dc-end" type="date" value="${v(t.contract_end)}">`)}
      ${field('滿一年當月招募費怎麼算', `<select id="dc-ann"><option value=""${!t.anniversary_rule ? ' selected' : ''}>待確認</option><option value="charge"${t.anniversary_rule === 'charge' ? ' selected' : ''}>當月照收，次月起免</option><option value="free"${t.anniversary_rule === 'free' ? ' selected' : ''}>當月就免</option></select>`)}
      ${field('付款備註', `<input id="dc-paynote" value="${v(t.payment_note)}" placeholder="例：依舊版，續約版待確認">`)}
      ${field('發票開給', `<input id="dc-invto" value="${v(t.invoice_to)}">`)}
      ${field('發票備註', `<input id="dc-invnote" value="${v(t.invoice_note)}">`)}
      ${field('福利金備註', `<input id="dc-wnote" value="${v(t.welfare_note)}">`)}
      ${field('薪資窗口（附來源和日期）', `<input id="dc-payc" value="${v(t.payroll_contact)}">`)}
      ${field('遲延利息（每月 %，空白＝沒寫）', `<input id="dc-int" inputmode="decimal" value="${v(t.overdue_interest_monthly)}">`)}
      ${field(`提前通知終止天數（空白＝沒寫） ${clause('notice')}`, `<input id="dc-notice" inputmode="numeric" value="${v(t.notice_days)}">`)}
      <div class="field span-2"><span>管理費要算進基礎的項目（經常性薪資一定算） ${clause('base')}</span><div class="dsp-checks">${Object.entries(BASE_LABEL).map(([k, l]) => `<label><input type="checkbox" data-base="${k}"${fb[k] ? ' checked' : ''}> ${l}</label>`).join('')}</div></div>
      <div class="field span-2"><span>合約有沒有這幾條</span><div class="dsp-checks"><label><input type="checkbox" id="dc-law"${t.law_change_pass_through ? ' checked' : ''}> 法令變動成本由客戶負擔</label><label><input type="checkbox" id="dc-block"${t.block_pre_interview ? ' checked' : ''}> 禁止客戶事前面試或指定人選</label><label><input type="checkbox" id="dc-renew"${t.auto_renew ? ' checked' : ''}> 到期自動續約</label><label><input type="checkbox" id="dc-renewed"${t.renewed ? ' checked' : ''}> 已續約（文件待補）</label></div></div>
      ${field('備註', `<textarea id="dc-note" rows="3">${esc(t.note || '')}</textarea>`, 'span-2')}</div>`;
}
function collectTerms(old) {
  const val = (x) => $(x).value;
  return {
    ...old, contract_start: val('#dc-start'), contract_end: val('#dc-end'),
    recruit_rate: { nontech: val('#dc-rn'), tech: val('#dc-rt') }, admin_rate: val('#dc-admin'), recruit_free_after_months: val('#dc-free'), recruit_free_never: $('#dc-never').checked, anniversary_rule: val('#dc-ann'),
    fee_base: Object.fromEntries($$('[data-base]').map((el) => [el.getAttribute('data-base'), el.checked])),
    welfare_permille: val('#dc-welfare'), payment_days: val('#dc-pay'), payment_basis: val('#dc-basis'), payment_note: val('#dc-paynote'), invoice_to: val('#dc-invto'), invoice_note: val('#dc-invnote'), welfare_note: val('#dc-wnote'), payroll_contact: val('#dc-payc'), invoice_due_day: val('#dc-invday'), overdue_interest_monthly: val('#dc-int'), notice_days: val('#dc-notice'),
    law_change_pass_through: $('#dc-law').checked, block_pre_interview: $('#dc-block').checked, auto_renew: $('#dc-renew').checked, renewed: $('#dc-renewed').checked,
    transfer_tiers: $$('[data-tier]').map((el) => ({ under_months: el.getAttribute('data-m'), percent: el.value })), note: val('#dc-note'),
  };
}
const nextYm = () => { const d = new Date(Date.now() + 8 * 3600e3); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 7); };
function editTerms() {
  const c = ui.clientDetail;
  if (!c) return;
  const id = c.company_id; const t = c.latest_terms;
  const pending = c.requests.some((q) => q.status === 'pending');
  modal({
    title: `${c.display_name} 的條款`, subtitle: t.source || '',
    body: `<h3 class="dsp-form-h">6 項數字：送出後要審核才生效</h3>${pending ? '<div class="notice">這家已有一筆待審，等審完才能再送數字調整。其他資料還是可以改。</div>' : ''}
      <p class="help">Jacky、Phoebe 互審，不能自己批自己；其他顧問提的，兩位任一位核准。核准前算錢繼續用舊值。</p>${numbersForm(t)}
      <div class="form-grid dsp-reason">${field('調整理由（改數字才要寫）', '<input id="dc-reason">', 'span-2')}${field('生效月份', `<input id="dc-eff" type="month" value="${nextYm()}">`)}</div>
      <h3 class="dsp-form-h">其他資料：存了就生效</h3>${otherForm(t, c.party_name)}`,
    footer: `<button class="btn" data-close-overlay>取消</button><button class="btn primary" data-dsp="save-terms" data-id="${esc(id)}">儲存／送出申請</button>`,
  });
  $('#overlay-root').__terms = t;
}
async function saveTerms(id) {
  const old = $('#overlay-root').__terms;
  const d = await api.post(`/admin/dispatch/client/${encodeURIComponent(id)}`, { by: me(), party_name: $('#dc-party').value, terms: collectTerms(old), reason: $('#dc-reason').value, effective_ym: $('#dc-eff').value });
  closeOverlay(); ui.clientId = id; toast(d.request_id ? '已送出申請，等審核；核准前算錢用舊值' : '已儲存', 'success'); reload();
}
async function reviewTerms(btn) {
  const id = btn.getAttribute('data-id'); const action = btn.getAttribute('data-action');
  const noteEl = $(`[data-req-note="${id}"]`);
  await api.post(`/admin/dispatch/terms-request/${encodeURIComponent(id)}`, { by: me(), action, note: noteEl ? noteEl.value : '' });
  toast(action === 'approve' ? '已核准' : '已退回', 'success'); reload();
}
async function newClient() {
  const d = await api.get('/admin/portal/companies');
  const cos = (d.items || d.companies || []).filter((c) => c && c.id && !/測試/.test(c.display_name || ''));
  const have = new Set((ui.clientList || []).map((c) => c.company_id));
  const render = (t, co) => {
    modal({
      title: '新增要派客戶', subtitle: '新客戶存好就生效，不用審核。之後再改就要審核。沒填的數字會提醒，也算不出金額；不會帶入別家的數字。',
      body: `${field('客戶', `<select id="dn-co"><option value="">請選</option>${cos.filter((c) => !have.has(c.id)).map((c) => `<option value="${esc(c.id)}"${co === c.id ? ' selected' : ''}>${esc(c.display_name)}</option>`).join('')}</select>`)}
        <div class="actions-row"><button type="button" class="btn sm" data-dsp="fill-template">帶入公司範本（看得到數字，可再改）</button></div>
        <h3 class="dsp-form-h">這家客戶的數字</h3>${numbersForm(t)}<h3 class="dsp-form-h">其他資料</h3>${otherForm(t, '')}`,
      footer: '<button class="btn" data-close-overlay>取消</button><button class="btn primary" data-dsp="save-new-client">建立</button>',
    });
    $('#overlay-root').__terms = t;
  };
  ui.renderNewClient = render;
  render(BLANK_TERMS, '');
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
  const real = s.rows.filter((r) => !r.person.is_test);
  const demo = s.rows.filter((r) => r.person.is_test);
  const extra = (r) => (r.result.error ? 0 : ['overtime', 'bonus', 'insurance', 'pension', 'expense', 'other'].reduce((a, k) => a + Number(r.inputs[k] || 0), 0));
  const sum = (list, f) => list.filter((r) => !r.result.error).reduce((a, r) => a + Number(f(r) || 0), 0);
  const cell = (st) => `<span class="dsp-st-pill ${st.key}">${text(st.label)}</span>`;
  const confirmCell = (r) => (r.status === 'confirmed' ? `<span class="dsp-st-pill in">已確認${r.confirmed_by ? `（${text(r.confirmed_by)}）` : ''}</span>` : `<span class="dsp-st-pill need_date">${r.status === 'draft' ? '草稿' : '還沒存'}</span>`);
  const num = (n) => `<td class="n">${money(n)}</td>`;
  const row = (r) => {
    const x = r.person;
    const money5 = r.result.error ? `<td class="n" colspan="5">${text(r.result.error)}</td>` : `${num(r.inputs.regular_salary)}${num(r.result.recruit_fee)}${num(r.result.admin_fee)}${num(extra(r))}${num(r.result.total_untaxed)}`;
    return `<tr class="${x.is_test ? 'demo' : ''}${r.hours.key === 'none' ? ' care-due' : ''}" data-dsp="open-settle" data-id="${esc(x.id)}"><td><button type="button" class="dsp-link" data-dsp="open-settle" data-id="${esc(x.id)}">${text(personName(x))}</button>${x.is_test ? ' ' + badge('示範資料', 'info') : ''}</td><td>${text(x.company_name || '')}</td><td>${text(x.job_title || '—')}</td><td>${text(CLASS_LABEL[x.job_class] || '沒分類')}</td>${money5}<td>${cell(r.hours)}</td><td>${cell(r.payroll)}</td><td>${confirmCell(r)}${r.salary_pending ? '<small class="dsp-warn-t">月中調薪待確認</small>' : ''}</td></tr>`;
  };
  const totalRow = (label, list, cls) => `<tr class="total ${cls}"><td>${label}</td><td colspan="3">${list.length} 人</td>${num(sum(list, (r) => r.inputs.regular_salary))}${num(sum(list, (r) => r.result.recruit_fee))}${num(sum(list, (r) => r.result.admin_fee))}${num(sum(list, extra))}${num(sum(list, (r) => r.result.total_untaxed))}<td colspan="3">工時未回 ${list.filter((r) => r.hours.key === 'none').length} 人</td></tr>`;
  const advM = sum(real, (r) => r.advance); const advD = sum(demo, (r) => r.advance);
  const recv = await api.get(`/admin/dispatch/receivables?company_id=${encodeURIComponent(ui.company)}`);
  target.__recv = recv.items;
  const recvRow = (x) => `<tr class="${x.is_test ? 'demo' : ''}${x.status.key === 'overdue' ? ' care-due' : ''}" data-dsp="open-recv" data-ym="${esc(x.ym)}" data-test="${x.is_test}"><td>${text(x.ym)}${x.is_test ? ' ' + badge('示範資料', 'info') : ''}</td><td>${text(co.display_name)}</td><td class="n">${money(x.amount)}</td><td>${text(x.invoice_date || '—')}</td><td>${x.due_label ? text(x.due_label) : '—'}</td><td>${text(x.paid_date || '—')}</td><td class="n">${x.paid_amount == null ? '—' : money(x.paid_amount)}</td><td class="n">${x.shortfall == null ? '—' : `<span class="${x.shortfall ? 'dsp-warn-t' : ''}">${money(x.shortfall)}</span>`}</td><td>${cell(x.status.key === 'waiting' ? { key: 'waiting', label: '待收款' } : x.status.key === 'maybe_overdue' ? { key: 'overdue', label: '可能已逾期' } : x.status.key === 'overdue' ? { key: 'overdue', label: '逾期' } : x.status.key === 'paid' ? { key: 'paid', label: '已收款' } : x.status)}</td></tr>`;
  target.innerHTML = `<div class="filters"><label class="dsp-inline">客戶 <select id="ds-co">${c.items.map((x) => `<option value="${esc(x.company_id)}"${x.company_id === ui.company ? ' selected' : ''}>${esc(x.display_name)}</option>`).join('')}</select></label><label class="dsp-inline">月份 <input id="ds-ym" type="month" value="${esc(ui.ym)}"></label>${real.length ? '<button class="btn" data-dsp="settle-csv">匯出這個月</button><button class="btn" data-dsp="ledger-csv">匯出工資清冊</button>' : ''}</div>
    ${co.status !== 'confirmed' ? '<div class="notice">這家客戶的條款還沒確認，先到「要派客戶」確認，才能確認結算。</div>' : ''}
    <div class="dsp-adv"><div><span>這個月先墊（已發薪、客戶還沒付）</span><b>${money(advM)}</b></div><div><span>目前累計先墊</span><b>${money(s.advance_total)}</b></div>${demo.length ? `<div class="demo"><span>示範資料先墊（不算）</span><b>這個月 ${money(advD)}・累計 ${money(s.advance_total_demo)}</b></div>` : ''}</div>
    ${s.rows.length ? `<article class="card"><div class="dsp-tablewrap"><table class="dsp-table dsp-settle-table"><thead><tr><th>姓名</th><th>客戶</th><th>職缺</th><th>分類</th><th class="n">月薪</th><th class="n">招募管理費</th><th class="n">行政管理費</th><th class="n">加班與其他</th><th class="n">向客戶收（未稅）</th><th>工時回收</th><th>發薪</th><th>確認狀態</th></tr></thead><tbody>${s.rows.map(row).join('')}</tbody><tfoot>${totalRow('當月合計（真實人員）', real, '')}${demo.length ? totalRow('示範小計（不算進合計）', demo, 'demo') : ''}</tfoot></table></div><p class="help">點一列看細項、改金額、按確認。向客戶收已扣客戶可扣福利金。${demo.length ? '目前表上是示範資料，薪資和金額都是舉例。' : ''}</p></article>`
      : '<div class="state"><strong>這個月系統裡沒有在職派遣的人</strong><p>實際有人在上班的話，到「派遣人選」按「加人」登記。</p></div>'}
    <article class="card" style="margin-top:14px"><h2>收款追蹤</h2><p class="help">一客戶一月一列，結算確認後才出現。點一列記發票日、實收日和實收金額；實收可能比請款少，例如匯款手續費。只手動登記，不開發票、不串金流。</p>${recv.items.length ? `<div class="dsp-tablewrap"><table class="dsp-table dsp-recv"><thead><tr><th>月份</th><th>客戶</th><th class="n">金額（未稅）</th><th>發票日</th><th>到期日</th><th>實收日</th><th class="n">實收金額</th><th class="n">差額</th><th>狀態</th></tr></thead><tbody>${recv.items.map(recvRow).join('')}</tbody></table></div>` : '<p class="muted">還沒有確認過的結算。</p>'}</article>
    ${estimateBox(co, !s.rows.length)}`;
  $('#ds-co').onchange = (e) => { ui.company = e.target.value; loadDispatchRoute('d_settlement', target); };
  $('#ds-ym').onchange = (e) => { if (e.target.value) { ui.ym = e.target.value; loadDispatchRoute('d_settlement', target); } };
}
// 一列的細項：先看算好的結果，要改才點開
function openSettleRow(id) {
  const r = (($('#page-data') || {}).__rows || []).find((x) => x.person.id === id);
  if (!r) return;
  const x = r.person; const done = r.status === 'confirmed';
  const noHours = r.hours.key === 'none';
  drawer({
    title: `${personName(x)}・${ui.ym} 結算`, subtitle: `${x.job_title || ''}・${CLASS_LABEL[x.job_class] || '沒分類'}・到職 ${x.start_date || ''}`,
    body: `<div class="drawer-section dsp-settle" data-person="${esc(x.id)}">
      ${x.is_test ? '<div class="notice">示範資料：薪資和金額都是舉例，不是客戶給的數字，也不是對外的費率案例；不算進合計、匯出或請款。</div>' : ''}
      ${r.salary_pending ? `<div class="notice">這個月有月中調薪（${text(r.salary_change.effective_date)} 生效，${text(r.salary_change.old_value || '')} → ${text(r.salary_change.new_value)}）。怎麼算合約沒寫，待確認，先列舊薪資。</div>` : ''}
      ${!r.salary_pending && r.status !== 'confirmed' && Number(r.inputs.regular_salary) !== Number(r.expected_salary) ? `<div class="notice">依異動紀錄，這個月薪資應為 ${money(r.expected_salary)}，目前是 ${money(r.inputs.regular_salary)}。請點「改金額」確認。</div>` : ''}
      ${r.result.anniversary_pending ? '<div class="notice">這個月是滿一年當月，招募管理費怎麼算待確認。先到「要派客戶」的「改條款」選好才能確認。</div>' : ''}
      ${r.result.error ? `<div class="notice">${text(r.result.error)}</div>` : lines(r.result)}
      <h3>工時與發薪</h3><div class="dsp-inputs"><label class="field"><span>客戶工時收到日${noHours ? '（還沒收到）' : ''}</span><input type="date" id="dso-hours" value="${esc(r.hours_received_date || '')}"></label><label class="field"><span>發薪日（這個月另有安排才填${x.payroll_day ? `，平常隔月 ${text(x.payroll_day)} 日前` : ''}）</span><input type="date" id="dso-payroll" value="${esc(r.payroll_date || '')}"></label><label class="field"><span>實際發薪日</span><input type="date" id="dso-paid" value="${esc(r.salary_paid_date || '')}"></label></div>
      <div class="actions-row"><button class="btn" data-dsp="save-ops" data-id="${esc(x.id)}">存工時與發薪</button></div><p class="help">只記日期，不會發薪、不會動錢。</p>
      <h3>逐日出勤檔</h3><p class="help">客戶提供的 Excel 或 PDF，每人每月一份。勞基法 30 條要保存五年，舊檔留著不覆蓋。</p>${r.attendance.length ? `<ul class="dsp-logs">${r.attendance.map((a) => `<li><small>${text(String(a.uploaded_at).slice(0, 16))}・${text(a.uploaded_by || '')}</small><div class="dsp-file-row">${text(a.filename || '逐日出勤檔')} ${fileButtons(`/admin/file/${encodeURIComponent(a.file_id)}`, a.filename || '逐日出勤檔')}</div></li>`).join('')}</ul>` : '<p class="dsp-warn-t">還沒有逐日出勤檔。</p>'}<div class="actions-row"><input type="file" id="dso-att" accept=".xlsx,.xls,.csv,.pdf" aria-label="選逐日出勤檔"><button class="btn" data-dsp="upload-attendance" data-id="${esc(x.id)}">上傳</button></div>
      ${r.ledger_versions ? `<p class="help">工資清冊已留存 ${r.ledger_versions} 版。退回修改再確認會多一版，舊版不會被覆蓋。</p>` : ''}
      ${done ? '' : `<details class="dsp-more"><summary>改金額（加班、獎金、保險…）</summary><div class="dsp-inputs">${SETTLE_INPUTS.map(([k, l]) => field(l, `<input data-si="${k}" inputmode="numeric" value="${esc(r.inputs[k] || '')}">`)).join('')}</div><div class="actions-row"><button class="btn" data-dsp="settle-save" data-id="${esc(x.id)}">重算</button></div></details>`}
      <div class="actions-row" style="margin-top:14px">${done ? `<button class="btn" data-dsp="settle-undo" data-id="${esc(x.id)}">退回修改</button>` : noHours ? '<button class="btn primary" disabled>工時還沒回，先不能確認</button>' : `<button class="btn primary" data-dsp="settle-confirm" data-id="${esc(x.id)}">核對無誤，確認</button>`}<button class="btn ghost" data-dsp="open-person" data-id="${esc(x.id)}">看人員卡片</button></div>
      <details class="dsp-more" data-logs="${esc(x.id)}"><summary>這個月的修改紀錄</summary><div data-logs-box></div></details>
    </div>`,
  });
  wireFileButtons($('.drawer .dsp-settle'));
  const det = $('.drawer [data-logs]');
  if (det) det.addEventListener('toggle', async () => { if (det.open) { const l = await api.get(`/admin/dispatch/logs?ref=${encodeURIComponent(x.id)}&ym=${encodeURIComponent(ui.ym)}`).catch(() => ({ items: [] })); $('[data-logs-box]', det).innerHTML = logList(l.items); } });
}
async function openRecv(btn) {
  const ym = btn.getAttribute('data-ym'); const test = btn.getAttribute('data-test') === '1';
  const x = (($('#page-data') || {}).__recv || []).find((r) => r.ym === ym && !!r.is_test === test);
  if (!x) return;
  const logs = await api.get(`/admin/dispatch/receivable-log?company_id=${encodeURIComponent(ui.company)}&is_test=${test ? 1 : 0}&ym=${encodeURIComponent(ym)}`).catch(() => ({ items: [] }));
  modal({
    title: `${ym} 收款`, subtitle: `${test ? '示範資料。' : ''}金額（未稅）${money(x.amount)}，${x.people} 人。到期日依這家客戶的付款設定算。`,
    body: `<div class="form-grid">${field('客戶收到發票日', `<input type="date" id="dr-inv" value="${esc(x.invoice_date || '')}">`)}${field('實收日', `<input type="date" id="dr-paid" value="${esc(x.paid_date || '')}">`)}${field('實收金額', `<input inputmode="numeric" id="dr-amt" value="${esc(x.paid_amount == null ? '' : x.paid_amount)}">`)}<div class="field"><span>差額</span><b>${x.shortfall == null ? '填實收金額後算出來' : money(x.shortfall)}</b></div></div><p class="help">到期日：${text(x.due_label || '填發票日後算出來')}。${text(x.basis_label)}。</p><details class="dsp-more"><summary>修改紀錄（${logs.items.length}）</summary>${logList(logs.items)}</details>`,
    footer: `<button class="btn" data-dsp="invoice-detail" data-ym="${esc(ym)}" data-test="${test ? 1 : 0}">看請款明細</button><button class="btn" data-close-overlay>取消</button><button class="btn primary" data-dsp="save-recv" data-ym="${esc(ym)}" data-test="${test ? 1 : 0}">儲存</button>`,
  });
}
// 請款明細：照已確認結算列出，可下載或列印後自己送客戶；系統不寄、不開發票。
async function openInvoice(btn) {
  const d = await api.get(`/admin/dispatch/invoice-detail?company_id=${encodeURIComponent(ui.company)}&ym=${encodeURIComponent(btn.getAttribute('data-ym'))}&is_test=${btn.getAttribute('data-test') === '1' ? 1 : 0}`);
  const t = d.totals;
  const rows = d.items.map((x) => `<tr><td>${text(x.name)}</td><td>${text(x.job)}</td><td class="n">${money(x.recruit)}</td><td class="n">${money(x.admin)}</td><td class="n">${money(x.passthrough)}</td><td class="n">${x.welfare ? '-' + money(x.welfare) : '—'}</td><td class="n">${money(x.total)}</td></tr>`).join('');
  const table = `<div class="dsp-tablewrap"><table class="dsp-table"><thead><tr><th>姓名</th><th>職缺</th><th class="n">招募管理費</th><th class="n">行政管理費</th><th class="n">實際代付</th><th class="n">福利金</th><th class="n">未稅小計</th></tr></thead><tbody>${rows}</tbody></table></div>
    <dl class="dsp-dl"><div><dt>未稅合計</dt><dd><b>${money(t.untaxed)}</b></dd></div><div><dt>營業稅 5%</dt><dd>${money(t.tax)}</dd></div><div><dt>含稅合計</dt><dd><b>${money(t.with_tax)}</b></dd></div></dl>`;
  ui.invoice = { d, table };
  modal({
    title: `${d.ym} 請款明細`, subtitle: `${d.is_test ? '示範資料，不能拿去請款。' : ''}${d.company}${d.invoice_to ? `，開給 ${d.invoice_to}` : ''}`,
    body: `${d.invoice_note ? `<div class="notice">${text(d.invoice_note)}</div>` : ''}${table}<p class="help">只列已確認的結算。稅額是提醒，開票前請會計確認；逐日工時請另外附上。系統不會寄出，也不會開發票。</p>`,
    footer: `<button class="btn" data-close-overlay>關閉</button><button class="btn" data-dsp="invoice-csv">下載 Excel 可開的檔</button><button class="btn primary" data-dsp="invoice-print">列印／存 PDF</button>`,
  });
}
function invoiceCsv() {
  const { d } = ui.invoice;
  const q = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const t = d.totals;
  const csv = [['姓名', '職缺', '招募管理費', '行政管理費', '實際代付', '福利金', '未稅小計'], ...d.items.map((x) => [x.name, x.job, x.recruit, x.admin, x.passthrough, -x.welfare, x.total]), [], ['未稅合計', '', '', '', '', '', t.untaxed], ['營業稅 5%', '', '', '', '', '', t.tax], ['含稅合計', '', '', '', '', '', t.with_tax]].map((r) => r.map(q).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `請款明細_${d.company}_${d.ym}${d.is_test ? '_示範' : ''}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function invoicePrint() {
  const { d, table } = ui.invoice;
  const w = window.open('', '_blank');
  if (!w) { toast('瀏覽器擋了新視窗，請允許後再按一次', 'error'); return; }
  w.document.write(`<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>${esc(d.ym)} 請款明細</title><style>body{font:14px "Noto Sans TC","PingFang TC",sans-serif;color:#111;margin:32px}table{width:100%;border-collapse:collapse;margin:16px 0}th,td{border:1px solid #999;padding:6px 8px;text-align:left}.n{text-align:right}dl{display:flex;gap:32px;justify-content:flex-end}dt{color:#555}dd{margin:0;font-size:16px}</style><h2>${esc(d.ym)} 請款明細</h2><p>${esc(d.company)}${d.invoice_to ? `（開給 ${esc(d.invoice_to)}）` : ''}｜德仁管理顧問有限公司${d.is_test ? '｜示範資料，不能拿去請款' : ''}</p>${table}</html>`);
  w.document.close(); w.focus(); w.print();
}
async function runTransferFee(btn) {
  const d = await api.post('/admin/dispatch/transfer-fee', { company_id: btn.getAttribute('data-co'), start_date: btn.getAttribute('data-start'), transfer_date: $('#dt2-date').value, transfer_salary: $('#dt2-salary').value });
  $('#dt2-out').innerHTML = `<b>轉任費 ${money(d.fee)}</b>（${text(d.formula)}，未稅與否依合約）`;
}
async function saveRecv(btn) {
  await api.post('/admin/dispatch/receivable', { by: me(), company_id: ui.company, ym: btn.getAttribute('data-ym'), is_test: btn.getAttribute('data-test') === '1', invoice_date: $('#dr-inv').value, paid_date: $('#dr-paid').value, paid_amount: $('#dr-amt').value });
  closeOverlay(); toast('已存', 'success'); reload();
}
const reloadSettle = async (id) => { const t = $('#page-data'); await loadDispatchRoute('d_settlement', t); if (id) openSettleRow(id); };
async function uploadAttendance(id) {
  const f = $('#dso-att').files[0];
  if (!f) { toast('請先選檔案', 'error'); return; }
  const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(f); });
  await api.post('/admin/dispatch/attendance', { by: me(), person_id: id, ym: ui.ym, file_b64: b64, file_name: f.name, file_mime: f.type });
  toast('已上傳', 'success'); await reloadSettle(id);
}
async function exportLedger() {
  const d = await api.get(`/admin/dispatch/ledger?company_id=${encodeURIComponent(ui.company)}&ym=${encodeURIComponent(ui.ym)}`);
  if (!d.items.length) { toast('這個月還沒有確認過的真實結算', 'error'); return; }
  const head = ['姓名', '職缺', '月份', '版本', '經常性薪資', '加班費', '獎金津貼', '確認人', '確認時間'];
  const cell = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const body = d.items.map((r) => [r.person_name, r.job_title, ui.ym, r.version, r.inputs.regular_salary, r.inputs.overtime, r.inputs.bonus, r.confirmed_by, r.confirmed_at].map(cell).join(','));
  const url = URL.createObjectURL(new Blob(['\ufeff' + [head.map(cell).join(','), ...body].join('\n')], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = `工資清冊_${ui.ym}.csv`; a.click(); URL.revokeObjectURL(url);
}
async function saveOps(id) {
  await api.post('/admin/dispatch/settlement/ops', { by: me(), person_id: id, ym: ui.ym, hours_received_date: $('#dso-hours').value, payroll_date: $('#dso-payroll').value, salary_paid_date: $('#dso-paid').value });
  toast('已存', 'success'); await reloadSettle(id);
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
  toast(confirm ? '已確認這筆' : '已重算', 'success'); await reloadSettle(id);
}
function exportCsv() {
  const rows = ($('#page-data') || {}).__rows || [];
  const head = ['姓名', '職缺', '分類', '經常性薪資', '加班費', '獎金津貼', '保險費', '提撥金', '工作費用', '其他', '招募管理費', '行政管理費', '客戶可扣福利金', '向客戶收(未稅)', '工時回收', '發薪', '狀態', '確認人'];
  const cell = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const body = rows.filter((r) => !r.result.error && !r.person.is_test).map((r) => [personName(r.person), r.person.job_title, CLASS_LABEL[r.person.job_class], r.inputs.regular_salary, r.inputs.overtime, r.inputs.bonus, r.inputs.insurance, r.inputs.pension, r.inputs.expense, r.inputs.other, r.result.recruit_fee, r.result.admin_fee, r.result.welfare_deduct, r.result.total_untaxed, r.hours.label, r.payroll.label, r.status === 'confirmed' ? '已確認' : '未確認', r.confirmed_by].map(cell).join(','));
  const url = URL.createObjectURL(new Blob(['﻿' + [head.map(cell).join(','), ...body].join('\n')], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = `派遣結算_${ui.ym}.csv`; a.click(); URL.revokeObjectURL(url);
}

// ── 操作 ──
document.addEventListener('change', (e) => {
  const sel = e.target instanceof Element ? e.target.closest('[data-dsp-tabsel]') : null;
  if (sel) navigate('d_people', sel.value);
});
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
    if (act === 'todo-client') { ui.clientId = id; navigate('d_clients'); }
    else if (act === 'todo-person') { ui.pendingOpen = id; navigate('d_people', btn.getAttribute('data-tab')); }
    else if (act === 'open-person') await openPerson(id);
    else if (act === 'save-care') await saveCare(id);
    else if (act === 'edit-profile') await editProfile(id);
    else if (act === 'save-profile') await saveProfile(id);
    else if (act === 'open-settle') openSettleRow(id);
    else if (act === 'save-ops') await saveOps(id);
    else if (act === 'offboard') openOffboard(id);
    else if (act === 'start-offboard') await saveOffboard(id, false);
    else if (act === 'save-offboard') await saveOffboard(id, true);
    else if (act === 'add-change') addChange(id);
    else if (act === 'save-change') await saveChange(id);
    else if (act === 'open-recv') await openRecv(btn);
    else if (act === 'invoice-detail') await openInvoice(btn);
    else if (act === 'invoice-csv') invoiceCsv();
    else if (act === 'invoice-print') invoicePrint();
    else if (act === 'transfer-fee') await runTransferFee(btn);
    else if (act === 'save-recv') await saveRecv(btn);
    else if (act === 'open-card') hooks.openCandidate(btn.getAttribute('data-app'));
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
    } else if (act === 'open-client') await toggleClient(id);
    else if (act === 'review-terms') await reviewTerms(btn);
    else if (act === 'fill-template') { const co = $('#dn-co').value; const tp = await api.get('/admin/dispatch/template'); ui.renderNewClient(tp.terms, co); }
    else if (act === 'upload-attendance') await uploadAttendance(id);
    else if (act === 'ledger-csv') await exportLedger();
    else if (act === 'edit-terms') editTerms(id);
    else if (act === 'save-terms') await saveTerms(id);
    else if (act === 'confirm-terms') { await api.post(`/admin/dispatch/client/${encodeURIComponent(id)}`, { by: me(), confirm: true }); toast('條款已確認', 'success'); reload(); }
    else if (act === 'new-client') await newClient();
    else if (act === 'save-new-client') {
      const co = $('#dn-co').value;
      if (!co) { toast('請選客戶', 'error'); return; }
      await api.post(`/admin/dispatch/client/${encodeURIComponent(co)}`, { by: me(), party_name: $('#dc-party').value, terms: collectTerms($('#overlay-root').__terms) });
      ui.clientId = co; closeOverlay(); toast('已建立，條款生效', 'success'); reload();
} else if (act === 'estimate') await runEstimate();
    else if (act === 'settle-save') await saveSettle(id, false);
    else if (act === 'settle-confirm') await saveSettle(id, true);
    else if (act === 'settle-undo') { await api.post('/admin/dispatch/settlement', { by: me(), person_id: id, ym: ui.ym, unconfirm: true }); toast('已退回修改', 'success'); await reloadSettle(id); }
    else if (act === 'settle-csv') exportCsv();
    else if (act === 'demo-delete') {
      modal({ title: '刪除示範資料', subtitle: '只會刪示範人選和它的結算，真實人選不受影響。刪了就不見了。', body: '<p>確定要刪嗎？</p>', footer: '<button class="btn" data-close-overlay>取消</button><button class="btn danger" data-dsp="demo-delete-go">確定刪除</button>' });
    } else if (act === 'demo-delete-go') {
      await api.post('/admin/dispatch/demo-delete', { by: me() });
      closeOverlay(); toast('示範資料已刪除', 'success'); reload();
    }
  } catch (err) { toast(err.message || '操作失敗', 'error'); }
});
