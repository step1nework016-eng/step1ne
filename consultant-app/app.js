import { CONFIG } from './config.js';
import { api, ApiError } from './core/api.js';
import { resolveRoute, navigate } from './core/router.js';
import { $, $$, boundary, closeOverlay, closeSubDrawer, drawer, errorState, formFields, loading, modal, openSubDrawer, toast } from './core/ui.js';
import { escapeHtml, text } from './core/security.js';
import { adapters, analyticsAdapter } from './adapters.js';
import { views, actionBtn, rowActions, actionMenu, shell, boardView, boardCandItems, boardClientItems, CAND_COLS, CLIENT_COLS } from './views.js';
import { ACTIONS } from './actions.js';
import { jdFieldParse } from './jd_fields.js';
import { initMail, loadMailTab, injectMailSection } from './mail.js';
import { initConsultantSetup, loadConsultantSetupTab } from './consultant_setup.js';
import { initChannels, loadChannelsTab, openChannel } from './channels.js';
import { loadLibraryTab } from './library.js';
import { wireBdCard, bdShowStageRemind, bdShowTagRemind } from './bdcard.js';
import { loadDealTerms } from './dealterms.js';
import { wireBdJobs } from './bdjobs.js';
import { loadDailyTab } from './daily.js';
import { loadCallList, loadBdCalls } from './calllist.js';
import { billingV2View, wireBillingV2, billing2Api } from './billing2.js';
import { initResumeLink, resumeLinkButtons } from './resumelink.js';
import { loadSpecialCheck } from './special_check.js';

// 2026-09-15 補：使用者反映「不知道要看哪個是自己的」——沒有登入系統，只能靠
// 這組「切換選擇」記住上次選的是誰，換分頁/重新整理都不用重選（存在瀏覽器
// localStorage，跟 ADMIN_TOKEN 一樣是這台裝置/這個瀏覽器記得，不是帳號登入）。
const OWNER_KEY = 's1ne_candidate_owner';
const VIEW_KEY = 's1ne_candidate_view';
const SIDEBAR_KEY = 's1ne_sidebar_collapsed';
const state = { route: 'daily', sub: '', candidateRows: [], poll: null, sourcedItems: [], sourcedSelected: new Set(), pendingAction: null, pendingRouteFilter: null, jobContentRetry: null, social: { month: null, data: null }, candidateOwner: localStorage.getItem(OWNER_KEY) || '', candidateView: localStorage.getItem(VIEW_KEY) || 'card', sidebarCollapsed: localStorage.getItem(SIDEBAR_KEY) === '1', consultantsCache: null, companiesCache: null, jobsCache: null, openCandidateId: null, precallCardCache: null, linechat: { owner: localStorage.getItem('s1ne_linechat_owner') || '', candidates: [], activeAppId: null, poll: null } };

function hasToken() { return Boolean(localStorage.getItem(CONFIG.tokenKey)); }

function render() {
  stopPolling();
  stopLinechatPolling();
  state.openCandidateId = null;
  const route = resolveRoute();
  state.route = route.key;
  state.sub = route.sub;
  if (route.legacy) navigate(route.key, route.sub, true);
  const view = views[route.key] || views.home;
  $('#app').innerHTML = shell(route.key, view(route.sub), state.sidebarCollapsed);
  fillMeGlobal();
  if (!hasToken()) {
    openTokenModal('請先輸入目前的 ADMIN_TOKEN');
    $('#page-data').innerHTML = '<div class="state"><strong>尚未登入</strong><p>輸入 ADMIN_TOKEN 後才會讀取 Production 資料。</p></div>';
    return;
  }
  loadRoute();
}

async function loadRoute() {
  const target = $('#page-data');
  if (!target) return;
  if (state.route === 'daily') {
    return loadDailyTab(target, state.sub);
  }
  if (state.route === 'casestatus' || state.route === 'roles' || state.route === 'paths' || state.route === 'billflow') return;   // 帶案狀況：畫面裡就是嵌入的外部儀表板，不用另外抓資料
  if (state.route === 'calllist') return loadCallList(target);
  if (state.route === 'bdcalls') return loadBdCalls(target);
  if (state.route === 'board') return loadBoardTab(target);
  if (state.route === 'home') return boundary(target, adapters.home, views.homeData, 'refresh');
  if (state.route === 'recruitment') return boundary(target, async () => ({ ...(await adapters.recruitment()), analytics: await analyticsAdapter.recruitment() }), views.recruitmentData, 'refresh');
  if (state.route === 'candidates') return loadCandidateTab(target);
  if (state.route === 'jobs') return loadJobTab(target);
  if (state.route === 'interviews') {
    // 阿財分流（原首頁）：/admin/overview 較重，10 分鐘內共用同一份，不跟著面談輪詢一直重抓（D1 額度）
    const ov = state.routeOverview && Date.now() - state.routeOverview.at < 600000 ? state.routeOverview.data
      : await api.get('/admin/overview').then((d) => { state.routeOverview = { at: Date.now(), data: d }; return d; }).catch(() => null);
    await boundary(target, adapters.interviews, (data) => views.routeBlock(ov) + views.interviewRows(filterSessions(data)), 'refresh');
    startPolling();
    return;
  }
  if (state.route === 'linechat') return loadLinechatTab(target);
  if (state.route === 'social') return loadSocialTab(target);
  if (state.route === 'clients') return loadClientsTab(target);
  if (state.route === 'system') return loadSystemTab(target);
  if (state.route === 'mail') return loadMailTab(target);
  if (state.route === 'onboarding') return loadConsultantSetupTab(target);
  if (state.route === 'channels') return loadChannelsTab(target);
  if (state.route === 'library') return loadLibraryTab(target);
}

// 2026-09-17 加：顧問人選面談室。owner 選單沿用跟人選工作台一樣的
// ensureConsultants() 快取，不重打一次 /admin/consultants。
async function loadLinechatTab(target) {
  await ensureConsultants();
  const sel = target.parentElement.querySelector('[data-action="linechat-owner"]');
  if (sel) {
    sel.innerHTML = '<option value="">選顧問…</option>' +
      state.consultantsCache.filter((c) => c.is_active).map((c) => `<option value="${escapeHtml(c.id)}" ${c.id === state.linechat.owner ? 'selected' : ''}>${escapeHtml(c.display_name)}</option>`).join('');
    sel.onchange = () => {
      state.linechat.owner = sel.value;
      localStorage.setItem('s1ne_linechat_owner', sel.value);
      state.linechat.activeAppId = null;
      loadLinechatTab(target);
    };
  }
  const quotaEl = target.parentElement.querySelector('#linechat-quota');
  if (quotaEl) {
    adapters.lineQuota().then((q) => {
      quotaEl.textContent = views.linechatQuota(q);
      const remain = (q.limit != null && q.used != null) ? q.limit - q.used : null;
      quotaEl.classList.toggle('warn', remain !== null && remain < 30);
    }).catch(() => { quotaEl.textContent = '額度查不到'; });
  }
  if (!state.linechat.owner) {
    target.innerHTML = views.linechatEmptyOwner();
    return;
  }
  target.innerHTML = loading();
  try {
    const candidates = await adapters.linechatCandidates(state.linechat.owner);
    state.linechat.candidates = candidates;
    renderLinechatLayout(target);
  } catch (error) {
    target.innerHTML = errorState(error, 'refresh');
  }
}

// 未讀：人選最後一則是「對方傳來」且比你上次點開這位的時間新。第一次使用時，現有的全部當已讀，之後新來的才標。
const LC_SEEN_KEY = 's1ne_linechat_seen';
function lcSeen() { try { return JSON.parse(localStorage.getItem(LC_SEEN_KEY) || 'null'); } catch { return null; } }
function lcSaveSeen(m) { try { localStorage.setItem(LC_SEEN_KEY, JSON.stringify(m)); } catch { /* 沒關係 */ } }
function lcMarkUnread(cands) {
  let seen = lcSeen();
  const nowIso = new Date().toISOString();
  if (!seen) { seen = {}; cands.forEach((c) => { seen[c.application_id] = nowIso; }); lcSaveSeen(seen); }
  cands.forEach((c) => {
    const m = c.last_message;
    const t = m && m.created_at ? new Date(String(m.created_at).replace(' ', 'T') + (/[zZ+]/.test(String(m.created_at).slice(10)) ? '' : '+08:00')).toISOString() : '';
    c._unread = !!(m && m.direction !== 'out' && t && (!seen[c.application_id] || t > seen[c.application_id]) && c.application_id !== state.linechat.activeAppId);
  });
  if (state.linechat.activeAppId) { seen[state.linechat.activeAppId] = nowIso; lcSaveSeen(seen); }
}
function renderLinechatLayout(target) {
  lcMarkUnread(state.linechat.candidates || []);
  const active = state.linechat.candidates.find((c) => c.application_id === state.linechat.activeAppId) || null;
  target.innerHTML = `<div class="linechat-grid"><aside class="linechat-list">${views.linechatCandList(state.linechat.candidates, state.linechat.activeAppId)}</aside><div class="linechat-panel">${views.linechatPanel(active)}</div></div>`;
  $$('[data-linechat-select]', target).forEach((btn) => {
    btn.onclick = () => { state.linechat.activeAppId = btn.getAttribute('data-linechat-select'); openLinechat(target); };
  });
  if (active) wireLinechatPanel(target, active);
}

async function openLinechat(target) {
  renderLinechatLayout(target);
  const appId = state.linechat.activeAppId;
  if (!appId) return;
  await refreshLinechatMessages(target, appId);
  stopLinechatPolling();
  state.linechat.poll = setInterval(() => {
    if (!document.hidden && state.route === 'linechat' && state.linechat.activeAppId === appId) refreshLinechatMessages(target, appId);
  }, CONFIG.detailPollMs);
}

async function refreshLinechatMessages(target, appId) {
  const box = $('#linechat-transcript', target);
  if (!box) return;
  try {
    const messages = await adapters.linechatMessages(appId);
    box.innerHTML = views.linechatMessages(messages);
    box.scrollTop = box.scrollHeight;
  } catch (error) { console.error(error); }
}

function wireLinechatPanel(target, cand) {
  $$('[data-linechat-view]', target).forEach((btn) => {
    btn.onclick = () => {
      const kind = btn.getAttribute('data-linechat-view');
      if (kind === 'forward') openForwardCandidate(cand.application_id);
      else openCandidate(cand.application_id); // 人選卡片／面談進度共用同一個既有抽屜，見 views.js 註解
    };
  });
  const form = $('#linechat-form', target);
  if (form) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const input = $('#linechat-input', target);
      const text = input.value.trim();
      if (!text) return;
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        await adapters.linechatSend(cand.application_id, text, state.linechat.owner);
        input.value = '';
        await refreshLinechatMessages(target, cand.application_id);
        // 送出後順手把左邊列表的「最後一則訊息」預覽資料刷新，但不重畫整個
        // 面板——重畫會把剛更新好的對話串跟輸入框一起洗掉，只更新左側清單
        // 那一塊 DOM 就好。
        try {
          state.linechat.candidates = await adapters.linechatCandidates(state.linechat.owner);
          const listEl = $('.linechat-list', target);
          if (listEl) {
            lcMarkUnread(state.linechat.candidates || []);
            listEl.innerHTML = views.linechatCandList(state.linechat.candidates, state.linechat.activeAppId);
            $$('[data-linechat-select]', target).forEach((b) => {
              b.onclick = () => { state.linechat.activeAppId = b.getAttribute('data-linechat-select'); openLinechat(target); };
            });
          }
        } catch { /* 補畫面細節失敗不影響主流程 */ }
      } catch (error) {
        toast(error.message || '發送失敗', 'error');
      } finally {
        btn.disabled = false;
      }
    };
  }
}

function stopLinechatPolling() { if (state.linechat.poll) clearInterval(state.linechat.poll); state.linechat.poll = null; }

function filterSessions(data) {
  const all = [...data.live, ...data.sessions.filter((item) => !data.live.some((live) => (live.id || live.application_id) === (item.id || item.application_id)))];
  if (!state.sub || state.sub === 'live') return all.filter((item) => ['active', 'talking', ''].includes(String(item.interview_state || item.state || 'active')));
  if (state.sub === 'paused') return all.filter((item) => ['paused', 'awaiting_booking'].includes(String(item.interview_state || item.state)));
  if (state.sub === 'done') return all.filter((item) => ['done', 'interviewed', 'reported'].includes(String(item.interview_state || item.state)));
  return all.filter((item) => item.report_error || item.error);
}

async function loadCandidateTab(target) {
  // 待審核（screening，2026-09-29 加，補新舊後台對照表抓到的缺口）：
  // 後端 /admin/screening 早就有（一支獨立列表，篩「硬條件卡住、還沒處置」
  // 的應徵），新版一直沒有對應的獨立清單頁，只有打開單一人選詳情才看得到
  // 那個警示標籤——這裡補上跟舊版一致的清單頁，決策動作沿用既有的
  // screen-decide（單一人選詳情本來就在用同一支）。
  if (state.sub === 'screening') return boundary(target, async () => (await adapters.screening()).pending || [], views.screeningTab, 'refresh');
  if (state.sub === 'aimatch') return loadAiMatchTab(target);
  if (state.sub === 'triage') return loadTriageTab(target);
  const loaders = { workbench: adapters.candidates, pool: adapters.sourced, reports: adapters.reports, outreach: adapters.outreach, checkups: adapters.checkups };
  const tab = loaders[state.sub] ? state.sub : 'workbench';
  if (tab === 'workbench') {
    await boundary(target, () => adapters.candidates(state.candidateOwner), (items) => { state.candidateRows = items; return (state.candidateView === 'table' && !isPhone()) ? views.candidateTableRows(items) : views.candidateRows(items); }, 'refresh');
    populateOwnerFilter();
    annotateRouteFilterCounts();
    applyPendingRouteFilter();
    return;
  }
  if (tab === 'pool') {
    state.sourcedSelected.clear();
    return boundary(target, adapters.sourced, (items) => { state.sourcedItems = items; return views.sourcedTab(items); }, 'refresh');
  }
  if (tab === 'reports') return boundary(target, adapters.reports, (items) => views.reportRows(items), 'refresh');
  if (tab === 'outreach') return boundary(target, adapters.outreach, (data) => views.outreachTab(data), 'refresh');
  if (tab === 'checkups') return boundary(target, adapters.checkups, (items) => views.checkupRows(items), 'refresh');
  return boundary(target, loaders[tab], (items) => genericRows(items), 'refresh');
}

// ── 2026-10-01 AI 配對頁（人選中心 →「AI 配對」）──────────────────────────
// 篩選條件跟「我是誰」記在瀏覽器（沒有登入系統，跟人選工作台的顧問選擇同一套做法）。
// 「我是誰」會寫進資料庫的 email_sent_by／outreach_sent_by，沒選就不准發。
const AM_KEY = 's1ne_aimatch_ui';
// 推薦人顯示：舊資料寫「顧問」「consultant」或空白，看不出是誰，就老實寫「未記錄」。
function forwarderName(by) {
  const v = String(by || '').trim().toLowerCase();
  if (!v || v === '顧問' || v === 'consultant' || v === 'backfill') return '未記錄';
  if (v.includes('jacky')) return 'Jacky';
  if (v.includes('phoebe') || v === 'behe10' || v === 'ph') return 'Phoebe';
  return String(by).trim();
}
// 2026-10-27 RU_LINK_V2：寄上傳履歷連結——「我是」顯示名稱→顧問 id（連結的 by=，人選上傳後自動指派）
initResumeLink({
  me: () => amUi().me || '',
  meId: () => { const me = amUi().me || ''; const c = (state.consultantsCache || []).find((x) => x.display_name === me); return c ? c.id : ''; },
  jobs: () => ensureJobs(),
  jobLabel: (j) => jobOptLabel(j),
});
function amUi() {
  if (!state.aiMatch) {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(AM_KEY) || '{}') || {}; } catch { saved = {}; }
    state.aiMatch = { view: 'todo', job: '', owner: '', confidence: '', source: '', me: '', ...saved, items: [] };
  }
  return state.aiMatch;
}
function amSave() {
  const u = amUi();
  try { localStorage.setItem(AM_KEY, JSON.stringify({ view: u.view, job: u.job, owner: u.owner, confidence: u.confidence, source: u.source, me: u.me })); } catch { /* 私密視窗存不了就算了 */ }
}
async function loadAiMatchTab(target) {
  const filters = target.parentElement.querySelector(':scope > .filters');
  if (filters) filters.hidden = true;   // 人選工作台那排篩選在這一頁用不到
  const ui = amUi();
  await ensureConsultants();
  await boundary(target, async () => {
    const data = await adapters.aiMatches({ view: ui.view, job: ui.job, owner: ui.owner, confidence: ui.confidence, source: ui.source });
    ui.items = data.items || [];
    return data;
  }, (data) => views.aiMatchTab(data, { ...ui, consultants: state.consultantsCache || [] }), 'refresh');
  target.querySelectorAll('[data-am-filter]').forEach((el) => {
    el.onchange = () => { ui[el.getAttribute('data-am-filter')] = el.value; amSave(); if (el.getAttribute('data-am-filter') !== 'me') loadAiMatchTab(target); };
  });
}
function amRequireMe() {
  const me = amUi().me;
  if (!me) { toast('請先在上方「我是」選你的名字，系統才記得是誰發的', 'error'); document.querySelector('[data-am-filter="me"]')?.focus(); }
  return me;
}
async function amEmailPreview(recId, why) {
  const rec = amUi().items.find((x) => x.id === recId) || {};
  let d;
  try { d = await adapters.aiMatchEmailPreview(recId, why); } catch (e) { d = { ...(e.body || {}), error: (e.body && e.body.error) || e.message }; }
  amUi().preview = { recId, d };
  const canSend = !d.error && !d.blocked;
  modal({ title: '寄信邀請預覽', subtitle: `${rec.candidate_name || ''} → ${rec.job_title || ''}`, body: views.aiMatchEmailPreview(d),
    footer: `<button class="btn" data-close-overlay>取消</button>
      <button class="btn" data-am-action="mail-refresh">更新預覽</button>
      <button class="btn" data-am-action="mail-test" ${d.error ? 'disabled' : ''} title="寄一封一模一樣的信到 Jacky 的信箱，不會寄給人選、不改任何狀態">寄測試信給 Jacky 看</button>
      <button class="btn primary" data-am-action="mail-send" ${canSend ? '' : 'disabled'}>確認寄給人選</button>` });
}
async function amHandle(btn) {
  const act = btn.getAttribute('data-am-action');
  const card = btn.closest('[data-rec-id]');
  const recId = card ? card.getAttribute('data-rec-id') : (amUi().preview || {}).recId;
  const target = $('#page-data');
  const rec = amUi().items.find((x) => x.id === recId) || {};
  if (act === 'open') { openCandidate(btn.getAttribute('data-app-id')); return; }
  if (act === 'run') {
    const me = amRequireMe(); if (!me) return;
    const slug = document.querySelector('[data-am-run-job]')?.value;
    if (!slug) return;
    btn.disabled = true;
    try { const r = await adapters.aiMatchRun(slug, me); toast(`已排入：${r.job}。約 1～3 分鐘後重新整理`, 'success'); }
    catch (e) { toast(e.message, 'error'); }
    finally { btn.disabled = false; }
    return;
  }
  if (act === 'email') { amEmailPreview(recId); return; }
  if (act === 'mail-refresh') { amEmailPreview(recId, $('#am-why')?.value); return; }
  if (act === 'mail-test' || act === 'mail-send') {
    const me = amRequireMe(); if (!me) return;
    const why = $('#am-why')?.value;
    if (act === 'mail-send' && !window.confirm(`確定要寄這封信給 ${rec.candidate_name || '這位人選'}（${(amUi().preview?.d || {}).to || ''}）嗎？寄出就收不回來了。`)) return;
    btn.disabled = true;
    try {
      const r = await adapters.aiMatchEmailSend(recId, me, why, act === 'mail-test');
      if (act === 'mail-test') { toast(`測試信已寄到 ${r.to}`, 'success'); btn.disabled = false; return; }
      toast(`已寄出邀請信給 ${rec.candidate_name || '人選'}`, 'success');
      closeOverlay();
      if (target) loadAiMatchTab(target);
    } catch (e) { toast(e.message, 'error'); btn.disabled = false; }
    return;
  }
  if (act === 'line') {
    const me = amRequireMe(); if (!me) return;
    if (!window.confirm(`要現在用 LINE 問 ${rec.candidate_name || '這位人選'} 有沒有興趣了解「${rec.job_title || ''}」嗎？\n\n按「確定」會立刻送出一則 LINE 訊息（有三個按鈕：想了解看看／這次不用／我有問題）。`)) return;
    btn.disabled = true;
    try { await adapters.aiMatchLineSend(recId, me); toast(`已用 LINE 發給 ${rec.candidate_name || '人選'}`, 'success'); }
    catch (e) { toast(e.message || '沒有發出去', 'error'); }
    if (target) loadAiMatchTab(target);
    return;
  }
  if (act === 'reject') {
    const me = amRequireMe(); if (!me) return;
    const reason = window.prompt(`「${rec.candidate_name || ''} → ${rec.job_title || ''}」不適合的原因？（可以不填，直接按確定）`);
    if (reason === null) return;
    try { await adapters.aiMatchReject(recId, me, reason); toast('已記錄：不適合', 'success'); }
    catch (e) { toast(e.message, 'error'); }
    if (target) loadAiMatchTab(target);
  }
}
document.addEventListener('click', (event) => {
  const btn = event.target instanceof Element ? event.target.closest('[data-am-action]') : null;
  if (!btn || btn.disabled) return;
  event.preventDefault();
  amHandle(btn);
});

// ── 2026-10-02 快速判斷（人選中心 →「快速判斷」）────────────────────────────
// 「我是誰」跟 AI 配對頁共用（amUi().me）；篩選記在瀏覽器。
const TRI_KEY = 's1ne_triage_ui';
function triUi() {
  if (!state.triage) {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(TRI_KEY) || '{}') || {}; } catch { saved = {}; }
    // 2026-10-28 檢查：預設只看 7 天，更早還沒決定的報告（例：10/12 的）就看不到。預設改 30 天；之前存過 7 天的也改成 30 一次
    state.triage = { view: 'todo', job: '', days: '30', ...saved, items: [] };
    if (!saved.days30 && state.triage.days === '7') state.triage.days = '30';
  }
  return state.triage;
}
async function loadTriageTab(target) {
  const filters = target.parentElement.querySelector(':scope > .filters');
  if (filters) filters.hidden = true;
  const ui = triUi();
  await ensureConsultants();
  await boundary(target, async () => {
    const data = await adapters.triage({ view: ui.view, job: ui.job, days: ui.days });
    ui.items = data.items || [];
    return data;
  }, (data) => views.triageTab(data, { ...ui, me: amUi().me, consultants: state.consultantsCache || [] }), 'refresh');
  target.querySelectorAll('[data-tri-filter]').forEach((el) => {
    el.onchange = () => {
      const k = el.getAttribute('data-tri-filter');
      if (k === 'me') { amUi().me = el.value; amSave(); return; }
      ui[k] = el.value;
      try { localStorage.setItem(TRI_KEY, JSON.stringify({ view: ui.view, job: ui.job, days: ui.days, days30: true })); } catch { /* 存不了就算了 */ }
      loadTriageTab(target);
    };
  });
  // TG「要打電話」通知裡的連結會帶 ?app=，直接打開那位人選
  const qApp = new URLSearchParams(location.search).get('app');
  if (qApp && !state.triageDeepOpened) { state.triageDeepOpened = true; openCandidate(qApp); }
}
document.addEventListener('click', async (event) => {
  const btn = event.target instanceof Element ? event.target.closest('[data-tri-action]') : null;
  if (!btn || btn.disabled) return;
  event.preventDefault();
  const card = btn.closest('[data-tri-app]');
  if (!card) return;
  const appId = card.getAttribute('data-tri-app');
  const name = card.getAttribute('data-tri-name') || '這位人選';
  const act = btn.getAttribute('data-tri-action');
  if (act === 'open') { openCandidate(appId); return; }
  const decision = act === 'undo' ? '' : act;
  let note = null;
  if (decision) {
    const me = amUi().me;
    if (!me) { toast('請先在上方「我是」選你的名字', 'error'); document.querySelector('[data-tri-filter="me"]')?.focus(); return; }
    if (decision === 'call') {
      note = window.prompt(`要請負責顧問打給 ${name}。有什麼要先問清楚的嗎？（可以不填，直接按確定）`);
      if (note === null) return;
    }
  }
  card.querySelectorAll('button').forEach((b) => { b.disabled = true; });
  try {
    await adapters.triageDecide(appId, decision, amUi().me, note);
    const LB = { push: '推', call: '要打電話（已在 TG 通知負責顧問）', no: '不推', '': '已放回「還沒決定」' };
    toast(`${name}：${LB[decision]}`, 'success');
    card.remove();
    const left = document.querySelectorAll('.tri-card').length;
    if (!left) loadTriageTab($('#page-data'));
  } catch (e) {
    toast(e.message || '沒有存到，請再按一次', 'error');
    card.querySelectorAll('button').forEach((b) => { b.disabled = false; });
  }
});

// 寄公司介紹預覽：顧問改完字可以自己複製主旨／內文（2026-10-02 Jacky）
document.addEventListener('click', (e) => {
  const b = e.target instanceof Element ? e.target.closest('[data-pack-copy]') : null;
  if (!b) return;
  const box = b.closest('[data-pack-out]');
  const el = box && box.querySelector(b.getAttribute('data-pack-copy') === 'subj' ? '[data-pack-subj]' : '[data-pack-body]');
  if (!el) return;
  navigator.clipboard.writeText(el.value || '').then(() => toast(b.getAttribute('data-pack-copy') === 'subj' ? '已複製主旨' : '已複製內文', 'success'))
    .catch(() => { el.select(); toast('自動複製失敗，已幫你選好文字，按 Cmd＋C', 'error'); });
});

// 客戶卡片「通話紀錄與進度」的兩個分頁（進度／AI 建議）
document.addEventListener('click', (e) => {
  const b = e.target instanceof Element ? e.target.closest('[data-bdp-tab]') : null;
  if (!b) return;
  const box = b.closest('[data-bdp]');
  const key = b.getAttribute('data-bdp-tab');
  box.querySelectorAll('[data-bdp-tab]').forEach((x) => { const on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-selected', on ? 'true' : 'false'); });
  box.querySelectorAll('[data-bdp-pane]').forEach((x) => { x.hidden = x.getAttribute('data-bdp-pane') !== key; });
});

// 2026-10-14 依職缺開發：篩選與「加入開發進度／不要」
document.addEventListener('change', (e) => {
  const t = e.target instanceof Element ? e.target : null;
  const f = t && t.closest('[data-hl-cat],[data-hl-show],[data-hl-age],[data-hl-assignee]');
  if (!f) return;
  const u = amUi();
  if (f.hasAttribute('data-hl-cat')) u.hlCat = f.value;
  if (f.hasAttribute('data-hl-show')) u.hlShow = f.value;
  if (f.hasAttribute('data-hl-age')) u.hlAge = f.value;
  if (f.hasAttribute('data-hl-assignee')) u.hlAssignee = f.value;
  amSave();
  loadClientsTab($('#page-data'));
});
document.addEventListener('click', async (e) => {
  const t = e.target instanceof Element ? e.target : null;
  const act = t && t.closest('[data-hl-act]');
  if (!act) return;
  e.preventDefault();
  const u = amUi();
  if (!u.me) { toast('請先在上方「我是」選你的名字', 'error'); document.querySelector('[data-cb-me]')?.focus(); return; }
  const row = act.closest('[data-hl-id]');
  act.disabled = true;
  try {
    const pick = act.getAttribute('data-hl-act') === 'pick';
    const r = await adapters.hiringLeadDecide(row.getAttribute('data-hl-id'), act.getAttribute('data-hl-act'), u.me, u.hlAssignee);
    toast(pick ? (r.existed ? '這家原本就在開發進度，已補上職缺資訊' : `已加入開發進度（負責人：${u.hlAssignee || u.me}）`) : '已標記不要', 'success');
    loadClientsTab($('#page-data'));
  } catch (err) { toast(err.message || '沒有成功', 'error'); act.disabled = false; }
});

// 2026-10-14 客戶卡片「從現有人選配對」＋「針對這個職缺的匿名摘要」
function bdmEsc(x) { return escapeHtml(String(x == null ? '' : x)); }
function bdmRender(out, data) {
  const res = data.result || {};
  const picks = res.picks || [];
  const briefs = Object.fromEntries((data.briefs || []).map((x) => [x.application_id, x]));
  if (data.run.status === 'error') { out.innerHTML = `<div class="notice">配對失敗：${bdmEsc(data.run.error)}。可以再按一次。</div>`; return; }
  if (data.run.status !== 'done') { out.innerHTML = `<p class="help">AI 正在現有人選裡找，約 3～8 分鐘（${data.run.status === 'queued' ? '排隊中' : '比對中'}）…這個畫面不用等，做好後重開這張卡片就會自動看到結果。</p>`; return; }
  if (!picks.length) { out.innerHTML = `<p class="help">${bdmEsc(res.note || '現有人選裡沒有適合的人。')}（比對了 ${bdmEsc(res.pool_size || 0)} 位）</p>`; return; }
  const FIT = { '高': 'success', '中': 'warning', '低': '' };
  const rows = picks.map((p) => {
    const an = (data.anon || {})[p.application_id];
    const bs = an && an.file_id
      ? `<span class="badge success">匿名履歷已做好（${bdmEsc(an.code)}）</span> <button type="button" class="bdj-btn sm primary" data-bdm-preview="${bdmEsc(an.file_id)}">預覽</button> <button type="button" class="bdj-btn sm" data-download-file="${bdmEsc(an.file_id)}">下載</button>`
      : `<button type="button" class="bdj-btn sm primary" data-bdm-one="${bdmEsc(p.application_id)}">產生匿名履歷</button>`;
    return `<label class="bdm-row">
      <div><b>${bdmEsc(p.code)}</b> ${bdmEsc(p.name)} <span class="badge ${FIT[p.fit] || ''}">符合度：${bdmEsc(p.fit)}</span> ${bs}
      <small class="muted">原應徵：${bdmEsc(p.applied_for)}｜期望：${bdmEsc(p.expected || '未填')}｜到職：${bdmEsc(p.available || '未填')}</small>
      <ul class="bdm-ok">${(p.matches || []).map((x) => `<li>✓ ${bdmEsc(x)}</li>`).join('')}</ul>
      <ul class="bdm-gap">${(p.gaps || []).map((x) => `<li>△ ${bdmEsc(x)}</li>`).join('')}</ul>
      ${p.note ? `<div class="bdm-note">建議：${bdmEsc(p.note)}</div>` : ''}</div></label>`;
  }).join('');
  const anyDone = (data.briefs || []).some((x) => x.status === 'done');
  out.innerHTML = `<div class="bdm-head">配對結果（比對了 ${bdmEsc(res.pool_size || 0)} 位；<b>✓</b>＝符合、<b>△</b>＝落差或要確認）</div>${rows}
    <div class="bdm-act"><small class="muted">匿名履歷用你平常那一套：名字改代號、公司改產業描述；按「產生」後草稿會貼到 TG「客戶履歷人工確認」，你確認才會做出 PDF。做好後這裡就有預覽／下載，寄信時也能在「從人選挑匿名履歷附上」選到。</small></div>`;
}
async function bdmPoll(out, runId, tries) {
  let data;
  try { data = await api.get(`/admin/bd/job-match?run_id=${encodeURIComponent(runId)}`); } catch (err) { out.innerHTML = `<div class="notice">${bdmEsc(err.message || '讀不到結果')}</div>`; return; }
  out.dataset.run = runId;
  try { const ar = await api.get('/admin/anon-reports'); data.anon = Object.fromEntries((ar.rows || []).map((x) => [x.application_id, x])); } catch { data.anon = {}; }
  bdmRender(out, data);
  const chip = out.closest('[data-bdj-slug]')?.querySelector('[data-bdm-chip]');
  if (chip) { const n = ((data.result || {}).picks || []).length; chip.textContent = data.run.status === 'done' ? (n ? `配對到 ${n} 人` : '配對：沒有合適') : data.run.status === 'error' ? '配對失敗' : '配對中…'; chip.className = 'bdj-mchip ' + (data.run.status === 'done' && n ? 'on' : ''); }
  const pending = data.run.status === 'queued' || data.run.status === 'working' || (data.briefs || []).some((x) => x.status === 'queued' || x.status === 'working');
  if (pending && tries < 200 && out.isConnected) setTimeout(() => bdmPoll(out, runId, tries + 1), 5000);
}
// 開客戶卡片時，把每個職缺最近一次配對結果自動帶出來（不用再按一次按鈕）
async function bdmAutoload(root, company) {
  let data;
  try { data = await api.get(`/admin/bd/job-match-latest?company=${encodeURIComponent(company)}`); } catch { return; }
  for (const r of (data.runs || [])) {
    const art = [...root.querySelectorAll('[data-bdj-slug]')].find((a) => a.getAttribute('data-bdj-slug') === r.job_ref);
    if (!art) continue;
    const chip = art.querySelector('[data-bdm-chip]');
    const out = art.querySelector('[data-bdm-out]');
    if (chip) chip.textContent = r.status === 'done' ? (r.picks ? `配對到 ${r.picks} 人` : '配對：沒有合適') : (r.status === 'error' ? '配對失敗' : '配對中…');
    if (chip) chip.className = 'bdj-mchip ' + (r.status === 'done' && r.picks ? 'on' : '');
    if (out) { out.hidden = false; bdmPoll(out, r.run_id, 0); }
  }
}
document.addEventListener('click', async (e) => {
  const t = e.target instanceof Element ? e.target : null;
  if (!t) return;
  const go = t.closest('[data-bdm-go]');
  if (go) {
    e.preventDefault();
    const sec = go.closest('[data-bdj]'); const art = go.closest('[data-bdj-slug]'); const out = go.closest('[data-bdm]').querySelector('[data-bdm-out]');
    const company = sec ? sec.getAttribute('data-bdj-company') : '';
    out.hidden = false; out.innerHTML = '<p class="help">送出中…</p>'; go.disabled = true;
    try {
      const r = await api.post('/admin/bd/job-match', { company, job_slug: art.getAttribute('data-bdj-slug'), by: amUi().me || '' });
      bdmPoll(out, r.run_id, 0);
    } catch (err) { out.innerHTML = `<div class="notice">${bdmEsc(err.message || '沒有排進去')}</div>`; }
    go.disabled = false;
    return;
  }
  const pv = t.closest('[data-bdm-preview]');
  if (pv) {
    e.preventDefault();
    const id = pv.getAttribute('data-bdm-preview');
    try {
      const res = await fetch(`${CONFIG.apiBase}/admin/file/${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${localStorage.getItem(CONFIG.tokenKey) || ''}` } });
      if (!res.ok) throw new Error(`預覽失敗 HTTP ${res.status}`);
      const blob = await res.blob();
      window.open(URL.createObjectURL(new Blob([blob], { type: 'application/pdf' })), '_blank');
    } catch (err) { toast(err.message || '預覽失敗', 'error'); }
    return;
  }
  const one = t.closest('[data-bdm-one]');
  if (one) {
    e.preventDefault();
    const out = one.closest('[data-bdm-out]');
    one.disabled = true;
    try { await api.post(`/admin/application/${encodeURIComponent(one.getAttribute('data-bdm-one'))}/client-formal-report`, { anonymous: true, by: amUi().me || '顧問' }); toast('已開始製作，草稿 1～2 分鐘後貼到 TG「客戶履歷人工確認」，你確認後這裡就能預覽下載', 'success'); one.textContent = '已送出，等 TG 確認'; }
    catch (err) { toast(err.message || '沒有排進去', 'error'); one.disabled = false; }
    return;
  }
  const br = t.closest('[data-bdm-brief]');
  if (br) {
    e.preventDefault();
    const out = br.closest('[data-bdm-out]');
    const ids = [...out.querySelectorAll('[data-bdm-pick]:checked:not(:disabled)')].map((x) => x.value);
    if (!ids.length) { toast('請先勾選要做摘要的人選', 'error'); return; }
    if (!window.confirm(`替 ${ids.length} 位人選各做一份「針對這個職缺」的匿名摘要？\n\n約 3～6 分鐘；做好會放進這家客戶的匿名履歷清單，不會自動寄出。`)) return;
    br.disabled = true;
    try { await api.post('/admin/bd/job-brief', { run_id: out.dataset.run, application_ids: ids }); toast('已開始產生，做好會顯示在這裡', 'success'); bdmPoll(out, out.dataset.run, 0); }
    catch (err) { toast(err.message || '沒有排進去', 'error'); br.disabled = false; }
    return;
  }
  const tm = t.closest('[data-bdm-tomail]');
  if (tm) {
    e.preventDefault();
    document.querySelector('#bd-detail-tabs [data-bd-detail-tab="mail"]')?.click();
    toast('已切到「寄公司介紹信」，在「匿名履歷」清單勾選剛做好的摘要', 'info');
  }
});

// 2026-10-14 認識公司「請 AI 研究這家公司」按鈕
document.addEventListener('click', async (e) => {
  const b = e.target instanceof Element ? e.target.closest('[data-rs-go]') : null;
  if (!b || b.disabled) return;
  e.preventDefault();
  const company = b.getAttribute('data-rs-go');
  const me = amUi().me || document.querySelector('.cg-pack')?.dataset.packBy || '';
  if (!window.confirm(`要讓 AI 研究「${company}」嗎？\n\nAI 會去查公開資料、員工評價、104 職缺，約 10～20 分鐘；好了 TG 會通知，結果放在這張卡片的「認識公司」。`)) return;
  b.disabled = true;
  try {
    const r = await api.post('/admin/bd/company-research', { company, by: me });
    b.textContent = '研究中…';
    toast(r.already ? '這家已經在研究了，好了會通知' : '已開始研究，約 10～20 分鐘，好了 TG 會通知', 'success');
  } catch (err) { toast(err.message || '沒有排進去', 'error'); b.disabled = false; }
});
// 2026-10-14 認識公司研究卡：分頁切換＋「我讀懂了嗎」暫存在這台瀏覽器
document.addEventListener('click', (e) => {
  const b = e.target instanceof Element ? e.target.closest('[data-rs-tab]') : null;
  if (!b) return;
  const box = b.closest('[data-rs]');
  if (!box) return;
  const key = b.getAttribute('data-rs-tab');
  box.querySelectorAll('[data-rs-tab]').forEach((x) => { const on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-selected', on ? 'true' : 'false'); });
  box.querySelectorAll('[data-rs-pane]').forEach((x) => { x.hidden = x.getAttribute('data-rs-pane') !== key; });
});
document.addEventListener('input', (e) => {
  const ta = e.target instanceof Element ? e.target.closest('[data-rs-sc]') : null;
  if (!ta) return;
  const box = ta.closest('[data-rs]');
  try { localStorage.setItem(`rs-sc:${box.getAttribute('data-rs')}:${ta.getAttribute('data-rs-sc')}`, ta.value); } catch { /* 瀏覽器不給存就算了 */ }
});
document.addEventListener('focusin', (e) => {
  const ta = e.target instanceof Element ? e.target.closest('[data-rs-sc]') : null;
  if (!ta || ta.dataset.rsLoaded) return;
  ta.dataset.rsLoaded = '1';
  try { const v = localStorage.getItem(`rs-sc:${ta.closest('[data-rs]').getAttribute('data-rs')}:${ta.getAttribute('data-rs-sc')}`); if (v && !ta.value) ta.value = v; } catch { /* 同上 */ }
});

// 2026-10-02 人選敲門：人選卡片按鈕＋名單頁的「加入開發進度／不要」
document.addEventListener('change', (e) => {
  const sel = e.target instanceof Element ? e.target.closest('[data-cb-me]') : null;
  if (sel) { amUi().me = sel.value; amSave(); }
});
document.addEventListener('click', async (e) => {
  const t = e.target instanceof Element ? e.target : null;
  const runBtn = t && t.closest('[data-cand-bd]');
  if (runBtn) {
    e.preventDefault();
    const me = amUi().me || window.prompt('你是誰？（Jacky／Phoebe）', 'Jacky');
    if (!me) return;
    amUi().me = me; amSave();
    if (!window.confirm('要讓 AI 找「可能需要這位人選」的公司嗎？\n\n找到的公司只會放在「客戶 → 人選敲門名單」，不會自動聯繫、也不會進開發進度，要你篩過才加入。')) return;
    runBtn.disabled = true;
    try { await adapters.candBdRun(runBtn.getAttribute('data-cand-bd'), me); toast('已開始找，約 3～5 分鐘後到「客戶 → 人選敲門名單」看（TG 客戶群組也會通知）', 'success'); }
    catch (err) { toast(err.message || '沒有排進去', 'error'); runBtn.disabled = false; }
    return;
  }
  const open = t && t.closest('[data-cb-open]');
  if (open) { e.preventDefault(); openCandidate(open.getAttribute('data-cb-open')); return; }
  const act = t && t.closest('[data-cb-act]');
  if (!act) return;
  e.preventDefault();
  const me = amUi().me;
  if (!me) { toast('請先在上方「我是」選你的名字', 'error'); document.querySelector('[data-cb-me]')?.focus(); return; }
  const row = act.closest('[data-cb-id]');
  if (act.getAttribute('data-cb-act') === 'mail') {
    // 寄信：還沒加入開發進度就先加，再打開寄信頁，預先選好「手上有人選」＋匿名重點
    act.disabled = true;
    const needPick = !!row.querySelector('[data-cb-act="pick"]');
    try {
      if (needPick) await adapters.candBdDecide(row.getAttribute('data-cb-id'), 'pick', me);
      state.mailPreset = { scenario: 'candidate', brief: act.closest('[data-cb-brief]')?.getAttribute('data-cb-brief') || '' };
      openBdDetail(act.getAttribute('data-cb-company'), 'mail');
    } catch (err) { toast(err.message || '沒有成功', 'error'); act.disabled = false; }
    return;
  }
  act.disabled = true;
  try {
    const r = await adapters.candBdDecide(row.getAttribute('data-cb-id'), act.getAttribute('data-cb-act'), me);
    toast(act.getAttribute('data-cb-act') === 'pick' ? (r.existed ? '這家原本就在開發進度，已補上人選敲門資訊' : '已加入開發進度（負責人是你），可以開始打了') : '已標記不要', 'success');
    loadClientsTab($('#page-data'));
  } catch (err) { toast(err.message || '沒有成功', 'error'); act.disabled = false; }
});

// AI 名單 → 加入開發進度
document.addEventListener('click', async (e) => {
  const b = e.target instanceof Element ? e.target.closest('[data-bd-promote]') : null;
  if (!b) return;
  e.preventDefault(); e.stopPropagation();
  const me = amUi().me || window.prompt('負責人是誰？（Jacky／Phoebe）', 'Jacky');
  if (!me) return;
  amUi().me = me; amSave();
  b.disabled = true;
  try {
    await api.post('/admin/bd/promote-ai', { company: b.getAttribute('data-bd-promote'), by: me });
    toast(`已移到開發進度，負責人：${me}`, 'success');
    b.closest('.bd-dash-row')?.remove();
  } catch (err) { toast(err.message || '沒有成功', 'error'); b.disabled = false; }
}, true);

// 開發進度卡片可以用鍵盤打開（Tab 到卡片按 Enter）
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !(e.target instanceof Element) || !e.target.matches('[data-bd-open]')) return;
  e.preventDefault(); openBdDetail(e.target.getAttribute('data-bd-open'));
});

// ── 2026-10-02 寄信約電話（沒綁 LINE 的人選）──────────────────────────────
// 快速判斷卡片和人選卡片共用；「我是誰」跟 AI 配對頁共用 amUi().me。
// 預覽畫面上目前的選擇（加一句話、要不要附履歷、要問哪幾項、自己加的那一項）
function cmPicks() {
  const ar = document.querySelector('[data-cm-ask-resume]');
  const tb = [...document.querySelectorAll('[data-cm-topic]')];
  return {
    note: $('#cm-note')?.value || '',
    askResume: ar ? ar.checked : undefined,
    topics: tb.length ? tb.filter((x) => x.checked).map((x) => x.getAttribute('data-cm-topic')) : undefined,
    topicExtra: $('#cm-topic-extra')?.value || '',
  };
}
async function cmOpen(appId, name, picks) {
  const p = picks || {};
  state.cm = { appId, name, picks: p };
  const keep = document.querySelector('#sub-overlay-root .drawer-body')?.scrollTop || 0;
  if (!document.querySelector('#sub-overlay-root .cm-wrap')) openSubDrawer({ title: '寄信約電話', subtitle: `${name || ''}｜先看信的內容，按「確認寄給人選」才會寄`, body: loading() });
  await ensureConsultants();
  let d;
  try { d = await adapters.callMail(appId, 'preview', amUi().me || null, p); } catch (e) { d = { error: (e.body && e.body.error) || e.message }; }
  const body = $('#sub-overlay-root .drawer-body');
  if (body) { body.innerHTML = views.callMailPreview(d, { me: amUi().me, note: p.note, consultants: state.consultantsCache || [] }); body.scrollTop = keep; }
}
// 2026-10-07：人選卡片拿掉額外的履歷（只拿掉清單上的這份，檔案本身還留在系統）
document.addEventListener('click', async (event) => {
  const btn = event.target instanceof Element ? event.target.closest('[data-resume-remove]') : null;
  if (!btn || btn.disabled) return;
  event.preventDefault();
  if (!window.confirm('要把這份履歷從人選卡片拿掉嗎？\n（檔案本身不會刪，只是不再列在這裡；拿掉主要那份時，第 2 份會自動變成主要履歷）')) return;
  btn.disabled = true;
  try {
    await api.post('/admin/application/resume/remove', { application_id: btn.getAttribute('data-resume-app'), file_id: btn.getAttribute('data-resume-remove') });
    toast('已拿掉這份履歷', 'success');
    openCandidate(btn.getAttribute('data-resume-app'));
  } catch (e) { btn.disabled = false; toast((e.body && e.body.error) || e.message || '沒拿掉', 'error'); }
});
// 2026-10-07：人選卡片「取消改談」——阿財面談前自動改談其他職缺，顧問不要就按這顆還原原應徵職缺
document.addEventListener('click', async (event) => {
  const btn = event.target instanceof Element ? event.target.closest('[data-job-switch-cancel]') : null;
  if (!btn || btn.disabled) return;
  event.preventDefault();
  const me = amUi().me;
  if (!me) { toast('先在畫面最上方選「我是」，系統才記得是誰取消的', 'error'); document.querySelector('[data-me-global]')?.focus(); return; }
  if (!window.confirm('取消改談？職缺會還原成人選原本應徵的那個，阿財開場就不會提改談。')) return;
  btn.disabled = true;
  try {
    await api.post('/admin/application/job-switch/cancel', { switch_id: btn.getAttribute('data-job-switch-cancel'), by: me });
    toast('已取消改談，職缺還原成原應徵', 'success');
    openCandidate(btn.getAttribute('data-job-switch-app'));
  } catch (e) { btn.disabled = false; toast((e.body && e.body.error) || e.message || '沒有取消成功', 'error'); }
});
// 2026-10-08：最上面的搜尋框原本沒接功能。打完按 Enter：人選（姓名／電話／Email／#編號／匿名代號 S-082、舊代號 A-03）、職缺、客戶。
document.addEventListener('keydown', async (event) => {
  const inp = event.target instanceof Element ? event.target.closest('[data-action="global-search"]') : null;
  if (!inp || event.key !== 'Enter' || event.isComposing) return;
  event.preventDefault();
  const q = inp.value.trim();
  if (!q) return;
  let d;
  try { d = await api.get(`/admin/search?q=${encodeURIComponent(q)}`); } catch (e) { toast(e.message || '搜尋失敗', 'error'); return; }
  const e2 = escapeHtml;
  const c = d.candidates || [], j = d.jobs || [], co = d.companies || [];
  if (c.length === 1 && !j.length && !co.length) { inp.value = ''; openCandidate(c[0].id); return; }
  const row = (attr, id, main, sub) => `<button type="button" class="btn" style="display:block;width:100%;text-align:left;min-height:48px;margin:4px 0" ${attr}="${e2(id)}"><b>${main}</b><br><small class="muted">${sub}</small></button>`;
  const body = (c.length ? `<h3 style="margin:8px 0 4px">人選（${c.length}）</h3>` + c.map((x) => row('data-gs-cand', x.id,
      `${x.seq_no ? '#' + e2(x.seq_no) + ' ' : ''}${e2(x.name || '')}${x.anon_code ? `　<span class="badge info">${e2(x.anon_code)}${x.anon_old_code ? '（舊 ' + e2(x.anon_old_code) + '）' : ''}</span>` : ''}`,
      `${e2(x.job_title || '')}${x.owner ? '・' + e2(x.owner) : ''}`)).join('') : '')
    + (j.length ? `<h3 style="margin:12px 0 4px">職缺（${j.length}）</h3>` + j.map((x) => row('data-gs-job', x.slug, e2(x.title || x.slug), `${e2(x.client_name || '')}${x.status === 'social_only' ? '・🔒 未簽約職缺' : ''}`)).join('') : '')
    + (co.length ? `<h3 style="margin:12px 0 4px">客戶（${co.length}）</h3>` + co.map((x) => row('data-gs-co', x.id, e2(x.display_name || ''), '')).join('') : '')
    || '<p class="muted">找不到符合的人選、職缺或客戶。可以打姓名、電話、Email、#編號、匿名代號（例如 S-082）。</p>';
  modal({ title: `搜尋「${q}」`, subtitle: '點一下打開', body, footer: '<button class="btn" data-close-overlay>關閉</button>' });
  document.querySelectorAll('[data-gs-cand]').forEach((b) => { b.onclick = () => { closeOverlay(); openCandidate(b.getAttribute('data-gs-cand')); }; });
  document.querySelectorAll('[data-gs-job]').forEach((b) => { b.onclick = () => { closeOverlay(); openJobManage(b.getAttribute('data-gs-job')); }; });
  document.querySelectorAll('[data-gs-co]').forEach((b) => { b.onclick = () => { closeOverlay(); openCompanyManage(b.getAttribute('data-gs-co')); }; });
});
// 2026-10-07 Jacky：一鍵婉拒信——跟「寄信約電話」一樣，先產草稿、可以改，按確認才寄
function dmBody(d) {
  const e = escapeHtml;
  if (d.error) return `<div class="notice">${e(d.error)}</div>`;
  return `<div class="dm-wrap" style="display:grid;gap:12px">
    ${d.already ? `<div class="notice">⚠️ ${e(d.already)}。<label style="display:inline-flex;gap:6px;align-items:center;margin-left:6px"><input type="checkbox" id="dm-again"> 再寄一次</label></div>` : ''}
    ${d.warn ? `<div class="notice" style="border-color:var(--danger,#c0392b)">🚫 ${e(d.warn)}</div>` : ''}
    <div class="card" style="display:grid;gap:10px">
      <label class="field"><span>婉拒原因（選了會重新產生內文）</span>
        <select id="dm-reason" style="min-height:44px">${(d.reasons || []).map(([k, v]) => `<option value="${e(k)}" ${k === d.reason ? 'selected' : ''}>${e(v)}</option>`).join('')}</select></label>
      <label class="field"><span>想多加一句（選填，例如：這次需要日文商務能力）</span>
        <input id="dm-extra" value="${e(d.extra || '')}" placeholder="不要寫年齡、性別這類原因；「客戶」請寫「用人單位」"></label>
      <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="dm-keep" ${d.keep !== false ? 'checked' : ''}> 加一句「資料會保留，有適合的機會再聯繫」</label>
      <button type="button" class="btn" data-dm-action="refresh" style="min-height:44px">依上面選項重新產生內文</button>
    </div>
    <label class="field"><span>寄給</span><input value="${e(d.to || '')}" disabled></label>
    <label class="field"><span>主旨（可以直接改）</span><input id="dm-subject" value="${e(d.subject || '')}"></label>
    <label class="field"><span>內文（可以直接改，按寄出就照這裡寄）</span><textarea id="dm-text" rows="16" style="width:100%;font:inherit;line-height:1.7">${e(d.text || '')}</textarea></label>
    <p class="help">從 official@ 寄出，人選回信會接在同一串。寄出後會記在人選卡片的備註裡，系統的自動婉拒信也不會再重複寄。</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button type="button" class="btn" data-dm-action="test" style="min-height:44px">先寄測試信給我看</button>
      <button type="button" class="btn primary" data-dm-action="send" style="min-height:44px">確認寄給人選</button>
    </div></div>`;
}
async function dmOpen(appId, name, body) {
  state.dm = { appId, name };
  if (!document.querySelector('#sub-overlay-root .dm-wrap')) openSubDrawer({ title: '寄婉拒信', subtitle: `${name || ''}｜先看信的內容、可以改，按「確認寄給人選」才會寄`, body: loading() });
  let d;
  try { d = await adapters.declineMail(appId, { action: 'preview', by: amUi().me || null, ...(body || {}) }); } catch (e) { d = { ...(e.body || {}), error: (e.body && e.body.error) || e.message }; }
  const el = $('#sub-overlay-root .drawer-body');
  if (el) el.innerHTML = dmBody(d);
}
document.addEventListener('click', async (event) => {
  const t = event.target instanceof Element ? event.target : null;
  const open = t && t.closest('[data-decline-mail]');
  if (open) { event.preventDefault(); document.querySelector('#sub-overlay-root .dm-wrap')?.remove(); dmOpen(open.getAttribute('data-decline-mail'), open.getAttribute('data-call-mail-name')); return; }
  const btn = t && t.closest('[data-dm-action]');
  if (!btn || btn.disabled || !state.dm) return;
  event.preventDefault();
  const act = btn.getAttribute('data-dm-action');
  const opts = { reason: $('#dm-reason')?.value, extra: $('#dm-extra')?.value || '', keep: !!$('#dm-keep')?.checked };
  if (act === 'refresh') { dmOpen(state.dm.appId, state.dm.name, opts); return; }
  const me = amUi().me;
  if (!me) { toast('請先在畫面最上方「我是」選你的名字，系統才記得是誰寄的', 'error'); document.querySelector('[data-me-global]')?.focus(); return; }
  const payload = { action: act, by: me, ...opts, subject: $('#dm-subject')?.value || '', text: $('#dm-text')?.value || '', again: !!$('#dm-again')?.checked };
  if (act === 'send' && !window.confirm(`確定要寄婉拒信給 ${state.dm.name || '這位人選'} 嗎？寄出就收不回來了。`)) return;
  btn.disabled = true;
  try {
    const r = await adapters.declineMail(state.dm.appId, payload);
    if (act === 'test') { toast(`測試信已寄到 ${r.to}`, 'success'); btn.disabled = false; return; }
    toast(`已寄婉拒信給 ${state.dm.name || '人選'}`, 'success');
    closeSubDrawer();
  } catch (e) { toast((e.body && e.body.error) || e.message || '沒有寄出去', 'error'); btn.disabled = false; }
});
// 2026-10-03：職缺「AI 找的人」分頁改外部找人選設定
document.addEventListener('click', async (event) => {
  const btn = event.target instanceof Element ? event.target.closest('[data-sourcing-mode-save]') : null;
  if (!btn || btn.disabled) return;
  event.preventDefault();
  const slug = btn.getAttribute('data-sourcing-mode-save');
  const sel = document.querySelector(`[data-sourcing-mode="${CSS.escape(slug)}"]`);
  const me = amUi().me;
  if (!me) { toast('先在畫面最上方選「我是」，系統才記得是誰改的', 'error'); document.querySelector('[data-me-global]')?.focus(); return; }
  btn.disabled = true;
  try { await adapters.jobSourcingMode(slug, sel.value, me); toast('已儲存，今晚夜間找人照新設定挑職缺', 'success'); }
  catch (e) { toast((e.body && e.body.error) || e.message, 'error'); } finally { btn.disabled = false; }
});
// 2026-10-07：「AI 挖角」——儲存挖角公司／目標職級、立刻挖角
document.addEventListener('click', async (event) => {
  const t = event.target instanceof Element ? event.target : null;
  const btn = t ? t.closest('[data-poach-save],[data-poach-run]') : null;
  if (!btn || btn.disabled) return;
  event.preventDefault();
  const run = btn.hasAttribute('data-poach-run');
  const slug = btn.getAttribute(run ? 'data-poach-run' : 'data-poach-save');
  const comp = document.querySelector(`[data-poach-companies="${CSS.escape(slug)}"]`);
  const tit = document.querySelector(`[data-poach-titles="${CSS.escape(slug)}"]`);
  const me = amUi().me;
  if (!me) { toast('先在畫面最上方選「我是」，系統才記得是誰改的', 'error'); document.querySelector('[data-me-global]')?.focus(); return; }
  const companies = (comp ? comp.value : '').split('\n').map((x) => x.trim()).filter(Boolean);
  if (run && !companies.length) { toast('先填挖角公司（一行一家）', 'error'); comp?.focus(); return; }
  if (run && !window.confirm(`要現在請 AI 去這 ${companies.length} 家公司找人嗎？\n\n${companies.slice(0, 12).join('、')}${companies.length > 12 ? '…' : ''}\n\n大約 20–40 分鐘，名單會傳到 TG。AI 只會寫好 LinkedIn 訊息，不會自動送出。`)) return;
  btn.disabled = true;
  try {
    // 立刻挖角前一律先存一次，確保 AI 用的是畫面上這份名單
    await adapters.jobPoachSave(slug, companies.join('\n'), tit ? tit.value : '', me);
    if (run) { await adapters.jobPoachRun(slug, me); toast('已排入，大約 20–40 分鐘，名單會傳到 TG', 'success'); }
    else toast(`已儲存 ${companies.length} 家挖角公司`, 'success');
  } catch (e) { toast((e.body && e.body.error) || e.message, 'error'); } finally { btn.disabled = false; }
});
// 2026-10-07：資料卡的 LinkedIn 訊息「複製」
document.addEventListener('click', (event) => {
  const b = event.target instanceof Element ? event.target.closest('[data-sc-copy]') : null;
  if (!b) return;
  event.preventDefault();
  const el = document.getElementById(b.getAttribute('data-sc-copy'));
  const txt = el ? el.value : '';
  (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject())
    .then(() => toast('已複製，可以貼到 LinkedIn', 'success'))
    .catch(() => { if (el) { el.focus(); el.select(); } toast('複製不了，已幫你選取，請按 Ctrl+C／⌘+C', 'error'); });
});
// 2026-10-03：職缺「阿財的理解」分頁改面談層級
document.addEventListener('click', async (event) => {
  const btn = event.target instanceof Element ? event.target.closest('[data-screen-tier-save]') : null;
  if (!btn || btn.disabled) return;
  event.preventDefault();
  const slug = btn.getAttribute('data-screen-tier-save');
  const sel = document.querySelector(`[data-screen-tier="${CSS.escape(slug)}"]`);
  const me = amUi().me;
  if (!me) { toast('先在畫面最上方選「我是」，系統才記得是誰改的', 'error'); document.querySelector('[data-me-global]')?.focus(); return; }
  btn.disabled = true;
  try { await adapters.jobScreenTier(slug, sel.value, me); toast('已改層級，下一場面談開始照新層級問', 'success'); }
  catch (e) { toast((e.body && e.body.error) || e.message, 'error'); } finally { btn.disabled = false; }
});
// 2026-10-03：人選回信給了時段 → 顧問填約好的時間，看過信再寄。
document.addEventListener('click', async (event) => {
  const btn = event.target instanceof Element ? event.target.closest('[data-call-confirm]') : null;
  if (!btn || btn.disabled) return;
  event.preventDefault();
  const appId = btn.getAttribute('data-call-confirm');
  const name = btn.getAttribute('data-call-mail-name') || '';
  const me = amUi().me;
  if (!me) { toast('先在畫面最上方選「我是」，系統才記得是誰寄的', 'error'); document.querySelector('[data-me-global]')?.focus(); return; }
  const slot = window.prompt(`跟 ${name} 約好的時間（照人選給的時段寫，例如：10/6（二）下午 2:00）`);
  if (!slot || !slot.trim()) return;
  const sal = window.prompt('信的開頭怎麼稱呼？（人選信裡署名英文名就填英文名，空白＝用本名）', name) || name;
  btn.disabled = true;
  try {
    const pv = await adapters.callConfirm(appId, 'preview', me, slot.trim(), sal.trim());
    if (!window.confirm(`寄給 ${pv.to}\n主旨：${pv.subject}\n\n${pv.text}\n\n確認寄出？`)) return;
    await adapters.callConfirm(appId, 'send', me, slot.trim(), sal.trim());
    toast(`已寄給 ${name}：約 ${slot.trim()}`, 'success');
  } catch (e) { toast((e.body && e.body.error) || e.message, 'error'); } finally { btn.disabled = false; }
});
document.addEventListener('change', (e) => {
  if (!state.cm || !(e.target instanceof Element)) return;
  const sel = e.target.closest('[data-cm-me]');
  if (sel) { amUi().me = sel.value; amSave(); }
  if (sel || e.target.closest('[data-cm-ask-resume],[data-cm-topic],#cm-topic-extra')) cmOpen(state.cm.appId, state.cm.name, cmPicks());
});
document.addEventListener('click', async (event) => {
  const t = event.target instanceof Element ? event.target : null;
  const open = t && t.closest('[data-call-mail]');
  if (open) { event.preventDefault(); document.querySelector('#sub-overlay-root .cm-wrap')?.remove(); cmOpen(open.getAttribute('data-call-mail'), open.getAttribute('data-call-mail-name')); return; }
  const btn = t && t.closest('[data-cm-action]');
  if (!btn || btn.disabled || !state.cm) return;
  event.preventDefault();
  const act = btn.getAttribute('data-cm-action');
  const picks = cmPicks();
  if (act === 'refresh') { cmOpen(state.cm.appId, state.cm.name, picks); return; }
  const me = amUi().me;
  if (!me) { toast('請先在上方「我是」選你的名字', 'error'); document.querySelector('[data-cm-me]')?.focus(); return; }
  if (act === 'send' && !window.confirm(`確定要寄這封信給 ${state.cm.name || '這位人選'} 嗎？寄出就收不回來了。`)) return;
  btn.disabled = true;
  try {
    const r = await adapters.callMail(state.cm.appId, act, me, picks);
    if (act === 'test') { toast(`測試信已寄到 ${r.to}`, 'success'); btn.disabled = false; return; }
    toast(`已寄信給 ${state.cm.name || '人選'}，人選回信會出現在 TG`, 'success');
    closeSubDrawer();
    if (state.route === 'candidates' && state.sub === 'triage') loadTriageTab($('#page-data'));
  } catch (e) { toast((e.body && e.body.error) || e.message || '沒有寄出去', 'error'); btn.disabled = false; }
});

// ── 2026-10-01 外部人選資料卡＋Email 邀請 ───────────────────────────────────
// 疊在職缺抽屜／人才池清單「之上」的一層（openSubDrawer），關掉不影響底下的抽屜。
// 「我是誰」跟 AI 配對頁共用同一個（amUi().me），選一次兩邊都記得。
async function scOpen(id, job) {
  state.sc = { id, job: job || null };
  openSubDrawer({ title: '人選資料卡', subtitle: '看完再決定：寄信邀請／不適合／先跳過', body: loading() });
  await ensureConsultants();
  let d;
  try { d = await adapters.sourcedCard(id, job); }
  catch (e) { $('#sub-overlay-root .drawer-body').innerHTML = `<div class="notice">${text(e.message || '載入失敗')}</div>`; return; }
  state.sc.card = d;
  state.sc.job = (d.job && d.job.slug) || job || null;
  $('#sub-overlay-root .drawer-body').innerHTML = views.sourcedCard(d, { me: amUi().me, consultants: state.consultantsCache || [] });
}
async function scPreview(why) {
  const { id, job } = state.sc || {};
  const body = $('#sub-overlay-root .drawer-body');
  if (!body) return;
  body.innerHTML = loading();
  let d;
  try { d = await adapters.sourcedMailPreview(id, job, why); } catch (e) { d = { ...(e.body || {}), error: (e.body && e.body.error) || e.message }; }
  state.sc.preview = d;
  body.innerHTML = views.sourcedMailPreview(d);
}
function scRequireMe() {
  const me = amUi().me;
  if (!me) { toast('請先在資料卡下方「我是」選你的名字，系統才記得是誰寄的', 'error'); }
  return me;
}
function scAfterChange() {
  const job = state.sc && state.sc.job;
  closeSubDrawer();
  if ($('#job-tab-sourced') && job) { openJobManage(job, 'sourced'); return; }
  const target = $('#page-data');
  if (target && state.route === 'candidates' && state.sub === 'pool') loadCandidateTab(target);
}
async function scHandle(btn) {
  const act = btn.getAttribute('data-sc-action');
  if (act === 'open') { scOpen(btn.getAttribute('data-sourced-id'), btn.getAttribute('data-sc-job') || null); return; }
  if (!state.sc) return;
  if (act === 'skip') { closeSubDrawer(); return; }
  if (act === 'back') { scOpen(state.sc.id, state.sc.job); return; }
  if (act === 'mail') { if (!scRequireMe()) return; scPreview(); return; }
  if (act === 'refresh') { scPreview($('#sc-why')?.value); return; }
  if (act === 'unfit-show') { const box = $('#sub-overlay-root .sc-unfit'); if (box) { box.hidden = false; box.querySelector('select')?.focus(); } return; }
  if (act === 'unfit-confirm') {
    const me = scRequireMe(); if (!me) return;
    const reason = $('#sub-overlay-root [data-sc-reason]')?.value;
    if (!reason) { toast('請選一個不適合的原因', 'error'); return; }
    btn.disabled = true;
    try { await adapters.sourcedUnfit(state.sc.id, me, reason); toast('已記錄：不適合', 'success'); scAfterChange(); }
    catch (e) { toast(e.message, 'error'); btn.disabled = false; }
    return;
  }
  if (act === 'test' || act === 'send') {
    const me = scRequireMe(); if (!me) return;
    const why = $('#sc-why')?.value;
    const name = (state.sc.card && state.sc.card.person && state.sc.card.person.name) || '這位人選';
    if (act === 'send' && !window.confirm(`確定要寄這封信給 ${name}（${(state.sc.preview || {}).to || ''}）嗎？寄出就收不回來了。`)) return;
    btn.disabled = true;
    try {
      const r = await adapters.sourcedMailSend(state.sc.id, state.sc.job, me, why, act === 'test');
      if (act === 'test') { toast(`測試信已寄到 ${r.to}`, 'success'); btn.disabled = false; return; }
      toast(`已寄出邀請信給 ${name}`, 'success');
      scAfterChange();
    } catch (e) { toast(e.message, 'error'); btn.disabled = false; }
  }
}
document.addEventListener('click', (event) => {
  const btn = event.target instanceof Element ? event.target.closest('[data-sc-action]') : null;
  if (!btn || btn.disabled) return;
  event.preventDefault();
  scHandle(btn);
});
// 2026-10-28：左側大項底下的分頁列，手機寬度是原生下拉選單，選了就換頁（桌機是按鈕，走 data-route）。
document.addEventListener('change', (event) => {
  const sel = event.target instanceof Element ? event.target.closest('[data-grp-select]') : null;
  if (sel && sel.value) navigate(sel.value);
});
document.addEventListener('change', (event) => {
  const el = event.target instanceof Element ? event.target.closest('[data-sc-me]') : null;
  if (!el) return;
  amUi().me = el.value; amSave();
});

// 顧問／客戶名單快取（後端本來就有 45 秒快取，這裡再存一次省得每次開下拉選單都重打）。
// 2026-10-05 手機版（Jacky：「手機版都沒設計，不在螢幕前很難用」）——先顧 4 件事：看報告、快速判斷、約電話、記通話結果。
// 不改每一頁的畫面程式，只在手機寬度自動加兩個東西：
//   ① 分頁列（.tabs、職缺抽屜分頁）旁邊加一個原生下拉選單，手機上用下拉切分頁（手機篩選／分類一律用下拉的規則）
//   ② 頁面上的篩選列收進一顆「篩選」按鈕，點了才展開
// 其餘（按鈕加大、表格可左右滑、抽屜標題固定）都在 styles.css 的手機段落。
function isPhone() { return window.matchMedia && matchMedia('(max-width:720px)').matches; }
function enhanceMobile(root) {
  if (!isPhone()) return;
  const scope = root || document;
  scope.querySelectorAll('.tabs:not([data-m-enh]), .drawer [data-jobtab]:not([data-m-enh-btn])').forEach((el) => {
    const bar = el.classList.contains('tabs') ? el : el.parentElement;
    if (!bar || bar.hasAttribute('data-m-enh')) return;
    const btns = [...bar.querySelectorAll(':scope > button')];
    if (btns.length < 3) return;
    bar.setAttribute('data-m-enh', '1');
    btns.forEach((b) => b.setAttribute('data-m-enh-btn', '1'));
    const sel = document.createElement('select');
    sel.className = 'm-tabsel';
    sel.setAttribute('aria-label', '切換分頁');
    sel.innerHTML = btns.map((b, i) => `<option value="${i}" ${b.classList.contains('active') ? 'selected' : ''}>${escapeHtml(b.textContent.trim())}</option>`).join('');
    sel.addEventListener('change', () => { const b = btns[Number(sel.value)]; if (b) b.click(); });
    bar.insertAdjacentElement('afterend', sel);
    new MutationObserver(() => { const i = btns.findIndex((b) => b.classList.contains('active')); if (i >= 0) sel.value = String(i); })
      .observe(bar, { subtree: true, attributes: true, attributeFilter: ['class'] });
  });
  scope.querySelectorAll('.content .filters:not([data-m-enh])').forEach((f) => {
    if (f.children.length < 3 || f.hidden || getComputedStyle(f).display === 'none') return;   // 別的分頁藏起來的篩選列不要加按鈕
    f.setAttribute('data-m-enh', '1');
    f.classList.add('m-collapsed');
    const t = document.createElement('button');
    t.type = 'button'; t.className = 'btn m-filter-toggle'; t.textContent = '篩選條件 ▾';
    t.addEventListener('click', () => { const open = f.classList.toggle('m-collapsed') === false; t.textContent = open ? '收起篩選 ▴' : '篩選條件 ▾'; });
    f.insertAdjacentElement('beforebegin', t);
    new MutationObserver(() => { t.hidden = f.hidden; }).observe(f, { attributes: true, attributeFilter: ['hidden'] });
  });
}
new MutationObserver(() => { clearTimeout(enhanceMobile._t); enhanceMobile._t = setTimeout(() => enhanceMobile(), 80); })
  .observe(document.body, { childList: true, subtree: true });

// 2026-10-03：「我是」放到最上方工具列，每一頁都看得到（以前只在人選中心幾個分頁裡，
// 職缺抽屜改設定時跳「先選我是」卻找不到地方選——Jacky 回報）。跟各分頁的「我是」共用同一個值。
async function fillMeGlobal() {
  const sel = document.querySelector('[data-me-global]');
  if (!sel) return;
  const cons = (await ensureConsultants()).filter((c) => c.is_active);
  const me = amUi().me || '';
  sel.innerHTML = `<option value="">選擇…</option>${cons.map((c) => `<option value="${escapeHtml(c.display_name)}" ${c.display_name === me ? 'selected' : ''}>${escapeHtml(c.display_name)}</option>`).join('')}`;
}
document.addEventListener('change', (e) => {
  const sel = e.target instanceof Element ? e.target.closest('[data-me-global]') : null;
  if (!sel) return;
  amUi().me = sel.value; amSave();
  // 看板跟著換成這位顧問的卡片（換了「我是」就重新以他為準）
  if (state.board) {
    state.board.owner = sel.value; state.board.clientOwner = sel.value; state.board.ownerSet = false;
    try { localStorage.setItem(BOARD_KEY, JSON.stringify({ owner: sel.value, showClosed: state.board.showClosed, clientOwner: sel.value, ownerSet: false })); } catch { /* 存不了就算了 */ }
    if (state.boardTarget && document.body.contains(state.boardTarget)) loadBoardTab(state.boardTarget);
  } else { try { localStorage.removeItem(BOARD_KEY); } catch { /* 存不了就算了 */ } }
  document.querySelectorAll('[data-am-filter="me"],[data-tri-filter="me"],[data-cm-me]').forEach((x) => { x.value = sel.value; });
  toast(sel.value ? `已設定：我是 ${sel.value}` : '已清除「我是」', 'success');
});
async function ensureConsultants() {
  if (!state.consultantsCache) {
    try { state.consultantsCache = (await api.get('/admin/consultants')).consultants || []; }
    catch (error) { console.error(error); state.consultantsCache = []; }
  }
  return state.consultantsCache;
}
async function ensureCompanies() {
  if (!state.companiesCache) {
    try { const body = await api.get('/admin/portal/companies'); state.companiesCache = body.companies || body.items || []; }
    catch (error) { console.error(error); state.companiesCache = []; }
  }
  return state.companiesCache;
}
async function ensureJobs() {
  if (!state.jobsCache) {
    try { const body = await api.get('/admin/jobs'); state.jobsCache = body.jobs || body.items || []; }
    catch (error) { console.error(error); state.jobsCache = []; }
  }
  return state.jobsCache;
}

async function populateOwnerFilter() {
  const sel = $('#candidate-owner');
  if (!sel) return;
  await ensureConsultants();
  const current = state.candidateOwner;
  sel.innerHTML = '<option value="">所有顧問</option><option value="unassigned">未指派</option>' +
    state.consultantsCache.filter((c) => c.is_active).map((c) => `<option value="${escapeHtml(c.id)}" ${c.id === current ? 'selected' : ''}>${escapeHtml(c.display_name)}</option>`).join('');
  if (current === 'unassigned') sel.value = 'unassigned';
  sel.onchange = () => { state.candidateOwner = sel.value; localStorage.setItem(OWNER_KEY, sel.value); loadRoute(); };
  syncCandidateViewButtons();
}

// 2026-09-21 加：把每一類的人數寫進分流下拉的選項標籤（「A｜優先聯繫（6）」）。
// 沒有數字的話顧問得一個一個選過去才知道今天有沒有人要打，選到空的還會以為
// 是壞掉了。人數是從已載入的 candidateRows 算的，不另外打 API。
function annotateRouteFilterCounts() {
  const sel = $('#candidate-route');
  if (!sel) return;
  const rows = state.candidateRows || [];
  const countOf = (code) => {
    if (code === 'none') return rows.filter((r) => !r.routeCode).length;
    if (code === 'silent') return rows.filter((r) => r.silentInterview).length;
    return rows.filter((r) => String(r.routeCode || '').toUpperCase() === code).length;
  };
  for (const opt of sel.options) {
    const base = opt.getAttribute('data-base') || opt.textContent;
    opt.setAttribute('data-base', base);
    opt.textContent = opt.value ? `${base}（${countOf(opt.value)}）` : `${base}（${rows.length}）`;
  }
}

// 從首頁分流卡跳過來時，把那一格的篩選套上去並重畫一次。
function applyPendingRouteFilter() {
  const code = state.pendingRouteFilter;
  state.pendingRouteFilter = null;
  const sel = $('#candidate-route');
  if (!code || !sel) return;
  sel.value = code;
  sel.dispatchEvent(new Event('input', { bubbles: true }));
}

function syncCandidateViewButtons() {
  const cardBtn = $('[data-action="candidate-view-card"]');
  const tableBtn = $('[data-action="candidate-view-table"]');
  if (cardBtn) cardBtn.classList.toggle('active', state.candidateView === 'card');
  if (tableBtn) tableBtn.classList.toggle('active', state.candidateView === 'table');
}

async function loadJobTab(target) {
  if (state.sub === 'drafts') return boundary(target, adapters.jobDrafts, (items) => views.jobDraftRows(items), 'refresh');
  if (state.sub === 'card') {
    const res = await boundary(target, async () => {
      const [jobs, unmatched] = await Promise.all([adapters.jobCards(), adapters.unmatchedCandidates()]);
      return { jobs, unmatched };
    }, ({ jobs, unmatched }) => views.jobCardWallTab(jobs, state.jobCardFilter || 'open', state.jobCardClientFilter || 'all', unmatched), 'refresh');
    wireJobCardWall();
    return res;
  }
  if (state.sub === 'ops') {
    const scopeSlug = state.opsJobScope || 'all';
    const res = await boundary(target, async () => {
      const [trend, jobs] = await Promise.all([adapters.operationsTrend(), adapters.jobCards()]);
      const jobTrend = scopeSlug === 'all' ? null : await adapters.jobOperationsTrend(scopeSlug);
      return { trend, jobs, jobTrend };
    }, ({ trend, jobs, jobTrend }) => views.opsData({
      ...trend, _gran: state.opsGranularity || 'week', _jobs: jobs, _scopeSlug: scopeSlug, _jobTrend: jobTrend,
    }), 'refresh');
    const sel = $('#ops-granularity');
    if (sel) sel.onchange = () => { state.opsGranularity = sel.value; loadRoute(); };
    const jobSel = $('#ops-job-scope');
    if (jobSel) jobSel.onchange = () => { state.opsJobScope = jobSel.value; loadRoute(); };
    return res;
  }
  let listJobs = null;
  const res = await boundary(target, adapters.jobs, (data) => {
    if (state.sub === 'intake') return views.jobDraftRows(data.intakes);
    if (state.sub === 'checks') return views.jobCheckRows(data.checks);
    if (state.sub === 'expertise') return views.expertiseRuler()
      + views.jobExpertiseMissingRows(data.expertiseMissing, data.expertiseBuilding)
      + views.jobExpertiseRows(data.expertise, data.expertiseBuilding);
    listJobs = data.jobs;
    return views.jobListTab(data.jobs, jobListState());
  }, 'refresh');
  if (listJobs) wireJobList(listJobs);
  return res;
}

// 職缺代號（J-0001…）：載入一次，職缺列表與社群選單用。職缺名稱可以重複，代號不會。
async function loadJobCodes() {
  try { const r = await api.get('/admin/job-codes'); window.__JOB_CODES = r.codes || {}; } catch { /* 沒有代號就不顯示 */ }
}
loadJobCodes();
setInterval(loadJobCodes, 120000);

// 職缺總覽的篩選（2026-10-01）：選單一換就整頁重畫（選項數字要跟著變），
// 打字只換結果區，游標不會跳掉。
function jobListState() {
  state.jobListFilter = state.jobListFilter || { q: '', status: 'open', client: 'all', line: 'all' };
  return state.jobListFilter;
}
function wireJobList(jobs) {
  const f = jobListState();
  if (!window.__JOB_CODES) loadJobCodes().then(() => { const out = $('#joblist-results'); if (out) out.innerHTML = views.jobListResults(jobs, f); });
  const redraw = () => {
    const box = $('#page-data');
    if (box) box.innerHTML = views.jobListTab(jobs, f);
    wireJobList(jobs);
  };
  [['#joblist-status', 'status'], ['#joblist-client', 'client'], ['#joblist-line', 'line']].forEach(([sel, key]) => {
    const el = $(sel);
    if (el) el.onchange = () => { f[key] = el.value; redraw(); };
  });
  const sd = document.querySelector('[data-joblist-showdraft]');
  if (sd) sd.onclick = () => { f.status = 'draft'; f.client = 'all'; f.line = 'all'; f.q = ''; redraw(); };
  const q = $('#joblist-q');
  if (q) q.oninput = () => {
    f.q = q.value;
    const out = $('#joblist-results');
    if (out) out.innerHTML = views.jobListResults(jobs, f);
  };
}

async function loadSocialTab(target) {
  if (state.sub === 'today' || !state.sub) {
    const res = await boundary(target, () => adapters.topicsToday(state.topicDate || ''), views.topicsTodayView, 'refresh');
    wireTopicsToday();
    // 2026-09-24：可以回看前幾天的菜單（Jacky 問「之前的會留下來嗎」——會，只是原本看不到）
    const dSel = document.getElementById('tp-date');
    if (dSel) dSel.onchange = () => { state.topicDate = dSel.value; loadRoute(); };
    return res;
  }
  if (state.sub === 'workbench') {
    // 2026-09-22：這一頁原本只有佇列清單、不能發文。加回「一鍵發文」表單。
    const res = await boundary(target, async () => ({
      composer: await adapters.socialComposer(),
      queue: (await adapters.social()).queue,
    }), ({ composer, queue }) => views.socialComposer(composer)
        + '<h2 style="font-size:16px;margin:18px 0 8px">排隊列表</h2>'
        + views.socialWorkbenchTab(queue), 'refresh');
    wireSocialComposer();
    return res;
  }
  if (state.sub === 'replies') {
    const res = await boundary(target, adapters.candidateSummaries, views.socialRepliesTab, 'refresh');
    wireSocialReplies();
    return res;
  }
  if (state.sub === 'threads') {
    const res = await boundary(target, async () => {
      const [social, fol] = await Promise.all([adapters.social(), api.get('/admin/social/followers').catch(() => ({ items: [] }))]);
      return { queue: social.queue, followers: (fol && fol.items) || [], joins: (fol && fol.joins) || [] };
    }, views.socialThreadsTab, 'refresh');
    wireThreadsPerf();
    return res;
  }
  if (state.sub === 'schedule') return loadScheduleTab(target);
  // 2026-09-24：「招募轉換」換成「手動匯入貼文」。舊書籤 conversion 一律導到新分頁。
  if (state.sub === 'import' || state.sub === 'conversion') {
    const res = await boundary(target, async () => {
      const [composer, imports] = await Promise.all([adapters.socialComposer(), api.get('/admin/social/imports')]);
      return { composer, imports: (imports && imports.rows) || [] };
    }, views.socialImportTab, 'refresh');
    wireSocialImport();
    return res;
  }
  // 2026-09-23：話題與公式拆成兩個分頁。舊的 'content' 仍然接受（舊書籤／舊連結），
  // 一律當成「話題 Prompt」。兩邊都要 wireSocialContent()——新增／編輯／刪除的
  // 事件綁定是共用的，只綁一半會變成「按了沒反應」。
  if (state.sub === 'content' || state.sub === 'topics') {
    const res = await boundary(target, adapters.socialPrompts, views.socialTopicsTab, 'refresh');
    wireSocialContent();
    return res;
  }
  if (state.sub === 'formulas') {
    const res = await boundary(target, adapters.socialPrompts, views.socialFormulasTab, 'refresh');
    wireSocialContent();
    return res;
  }
  if (state.sub === 'accounts') return boundary(target, async () => ({ accounts: (await adapters.social()).accounts, consultants: await adapters.socialConsultants() }), views.socialAccountsTab, 'refresh');
  return boundary(target, async () => ({ ...(await adapters.social()), trend: await analyticsAdapter.socialTrend() }), views.socialData, 'refresh');
}

// 一鍵發文表單的行為。⚠️ 每次重畫這一頁都要重新接一次（innerHTML 換掉之後
// 舊的事件監聽就跟著沒了）。
// 今日話題：每張卡片各自一個「指定顧問 → 產生草稿」。
// ⚠️ 跟一鍵發文同一個後端（/admin/social-post-request，帶 topic_id + account_id），
// 不另開一套。按下去之後這張卡的按鈕鎖住不解，避免顧問以為沒反應狂按
// （產稿要 1–2 分鐘，跟一鍵發文同一個坑）。
// 內容庫：公式（寫法 Prompt）與話題 Prompt 的新增／編輯／刪除。
// 後端 POST /admin/style-prompts 帶 id 就是更新、不帶就是新增；delete 走
// /admin/style-prompts/delete。話題 Prompt 同一套（/admin/topic-prompts）。
function wireSocialImport() {
  const form = $('#imp-form');
  if (!form) return;
  let DATA = { styles: [], topics: [] };
  try { DATA = JSON.parse($('#imp-data').textContent || '{}'); } catch { /* 空的就空的 */ }
  const f = (n) => form.querySelector(`[name="${n}"]`);
  const syncStyles = () => {
    const way = f('formula').value;
    $('#imp-style-wrap').hidden = way === 'default';
    const list = DATA.styles.filter((s) => s.subtype === way).sort((x, y) => x.id - y.id);
    f('style_id').innerHTML = list.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join('')
      || '<option value="">這一類還沒有公式</option>';
  };
  const syncKind = () => {
    const k = f('kind').value;
    $('#imp-job').hidden = k !== 'job'; $('#imp-topic').hidden = k !== 'topic';
    $$('[data-imp-kind]').forEach((b) => b.classList.toggle('active', b.dataset.impKind === k));
  };
  $$('[data-imp-kind]').forEach((b) => b.addEventListener('click', () => { f('kind').value = b.dataset.impKind; syncKind(); }));
  f('formula').addEventListener('change', syncStyles);
  syncStyles(); syncKind();

  $('#imp-go').onclick = async () => {
    const pick = f('kind').value;
    if (!pick) return toast('請選這篇是職缺文還是話題文', 'error');
    const kind = pick;
    const body = { url: f('url').value.trim(), account_id: Number(f('account_id').value), kind, extract: f('extract').checked };
    if (!body.url) return toast('請貼貼文網址', 'error');
    if (!body.account_id) return toast('請選是哪個帳號發的', 'error');
    if (kind === 'job') {
      Object.assign(body, { formula: f('formula').value, style_id: Number(f('style_id').value) || null, job_slug: f('job_slug').value });
      if (!body.job_slug) return toast('請選職缺', 'error');
    } else {
      body.topic_label = f('topic_label').value.trim();
      if (!body.topic_label) return toast('請寫一句這篇在談什麼', 'error');
    }
    const btn = $('#imp-go'); btn.disabled = true;
    try {
      const d = await api.post('/admin/social/import-post', body);
      toast(`已匯入：${d.summary}${d.extraction_id ? '，拆解中（1–3 分鐘）' : ''}。瀏覽／讚／留言 1 小時後開始抓`, 'success');
      loadRoute();
    } catch (e) { toast(e.message, 'error'); btn.disabled = false; }
  };

  $$('[data-imp-act]').forEach((b) => b.addEventListener('click', async () => {
    const act = b.dataset.impAct;
    if (act === 'imp-ext-go') {
      b.disabled = true;
      try { await api.post('/admin/social/extract', { queue_id: Number(b.dataset.qid) }); toast('開始拆解，1–3 分鐘後回來看', 'success'); loadRoute(); }
      catch (e) { toast(e.message, 'error'); b.disabled = false; }
      return;
    }
    if (act === 'imp-ext-view') {
      let x;
      try { x = (await api.get(`/admin/social/extraction/${encodeURIComponent(b.dataset.ext)}`)).extraction; }
      catch (e) { return toast(e.message, 'error'); }
      modal({ title: `拆解結果：${(x.result && x.result.name) || ''}`, subtitle: '確認沒問題再存進公式庫，存了之後產稿就選得到。',
        body: views.socialExtractionBody(x),
        footer: '<button class="btn" data-imp-drop>丟掉</button><button class="btn primary" data-imp-save>存進公式庫</button>' });
      $('[data-imp-save]').onclick = async () => {
        const sf = $('#imp-save-form');
        try {
          const d = await api.post(`/admin/social/extraction/${encodeURIComponent(x.id)}/save`,
            { name: sf.querySelector('[name=name]').value, subtype: sf.querySelector('[name=subtype]').value });
          closeOverlay(); toast(`已存進公式庫：${d.name}`, 'success'); loadRoute();
        } catch (e) { toast(e.message, 'error'); }
      };
      $('[data-imp-drop]').onclick = async () => {
        try { await api.post(`/admin/social/extraction/${encodeURIComponent(x.id)}/drop`, {}); closeOverlay(); toast('已丟掉', 'success'); loadRoute(); }
        catch (e) { toast(e.message, 'error'); }
      };
    }
  }));
}

function wireSocialContent() {
  const readJSON = (id) => { try { const el = document.getElementById(id); return el ? JSON.parse(el.textContent) : []; } catch { return []; } };
  const styles = readJSON('style-prompts-data');
  const topics = readJSON('topic-prompts-data');

  const openStyle = (s) => {
    modal({
      title: s.id ? '編輯公式' : '新增公式',
      subtitle: s.id ? s.name : '',
      body: views.stylePromptEditor(s),
      footer: `${s.id ? '<button class="btn danger" id="sp-del">刪除</button>' : ''}<button class="btn" data-close-overlay>取消</button><button class="btn primary" id="sp-save">儲存</button>`,
    });
    const msg = document.getElementById('sp-msg');
    // 2026-09-23 加：從 .md 檔帶入公式內容。
    // 只讀檔、填進 textarea，不直接送出——顧問帶入後還要自己確認、選分類再存。
    // 名稱空著的話順便用檔名補上（去掉副檔名），少打一次字。
    const spFile = document.getElementById('sp-file');
    if (spFile) {
      spFile.addEventListener('change', () => {
        const f = spFile.files && spFile.files[0];
        if (!f) return;
        if (f.size > 200 * 1024) { msg.textContent = '檔案太大（上限 200KB）。'; return; }
        const reader = new FileReader();
        reader.onload = () => {
          document.getElementById('sp-body').value = String(reader.result || '');
          const nameEl = document.getElementById('sp-name');
          if (!nameEl.value.trim()) nameEl.value = f.name.replace(/\.(md|markdown|txt)$/i, '').slice(0, 100);
          msg.textContent = `已帶入「${f.name}」，確認內容跟分類再按儲存。`;
        };
        reader.onerror = () => { msg.textContent = '檔案讀取失敗，請重選。'; };
        reader.readAsText(f, 'utf-8');
      });
    }
    document.getElementById('sp-save').addEventListener('click', async () => {
      const name = document.getElementById('sp-name').value.trim();
      const body = document.getElementById('sp-body').value.trim();
      const subtype = document.getElementById('sp-subtype').value;
      if (!name || !body) { msg.textContent = '名稱跟內容都要填。'; return; }
      msg.textContent = '儲存中…';
      try {
        await api.post('/admin/style-prompts', { id: s.id || undefined, name, body, subtype });
        toast('已儲存'); closeOverlay();
        loadSocialTab($('#page-data') || document.querySelector('main'));
      } catch (e) { msg.textContent = '儲存失敗：' + (e && e.message ? e.message : e); }
    });
    const del = document.getElementById('sp-del');
    if (del) del.addEventListener('click', async () => {
      if (!confirm(`確定刪除公式「${s.name}」？顧問已指定用它的地方會一併清掉。`)) return;
      try {
        await api.post('/admin/style-prompts/delete', { id: s.id });
        toast('已刪除'); closeOverlay();
        loadSocialTab($('#page-data') || document.querySelector('main'));
      } catch (e) { msg.textContent = '刪除失敗：' + (e && e.message ? e.message : e); }
    });
  };

  const openTopic = (t) => {
    modal({
      title: t.id ? '編輯話題' : '新增話題',
      body: views.topicPromptEditor(t),
      footer: '<button class="btn" data-close-overlay>取消</button><button class="btn primary" id="tpp-save">儲存</button>',
    });
    const msg = document.getElementById('tpp-msg');
    document.getElementById('tpp-save').addEventListener('click', async () => {
      const name = document.getElementById('tpp-name').value.trim();
      const body = document.getElementById('tpp-body').value.trim();
      if (!name || !body) { msg.textContent = '名稱跟內容都要填。'; return; }
      msg.textContent = '儲存中…';
      try {
        await api.post('/admin/topic-prompts', { id: t.id || undefined, name, body, category: 'general' });
        toast('已儲存'); closeOverlay();
        loadSocialTab($('#page-data') || document.querySelector('main'));
      } catch (e) { msg.textContent = '儲存失敗：' + (e && e.message ? e.message : e); }
    });
  };

  // 公式「我的最愛」（顧問認證）。先選「我是」才能按；按完只重畫這一頁，不整頁重載。
  const favMe = document.getElementById('fav-me');
  if (favMe) favMe.addEventListener('change', () => {
    try { localStorage.setItem('s1_fav_me', favMe.value); } catch { /* 無痕模式存不了就算了 */ }
    loadRoute();
  });
  document.querySelectorAll('[data-fav-id]').forEach((b) => b.addEventListener('click', async () => {
    const who = favMe && favMe.value;
    if (!who) { toast('先在上面「我是」選你自己', 'error'); favMe && favMe.focus(); return; }
    const on = b.getAttribute('aria-pressed') !== 'true';
    b.disabled = true;
    try {
      await api.post('/admin/style-prompts/favorite', { id: Number(b.dataset.favId), consultant: who, on });
      toast(on ? '已認證這個公式' : '已取消認證', 'success');
      loadRoute();
    } catch (e) { b.disabled = false; toast(`沒存成功：${e.message || e}`, 'error'); }
  }));
  document.querySelectorAll('.style-prompt-edit').forEach((b) => b.addEventListener('click', () => {
    openStyle(styles.find((s) => String(s.id) === b.dataset.id) || {});
  }));
  const spNew = document.querySelector('[data-style-prompt-new]');
  if (spNew) spNew.addEventListener('click', () => openStyle({}));
  document.querySelectorAll('.topic-prompt-edit').forEach((b) => b.addEventListener('click', () => {
    openTopic(topics.find((t) => String(t.id) === b.dataset.id) || {});
  }));
  const tpNew = document.querySelector('[data-topic-prompt-new]');
  if (tpNew) tpNew.addEventListener('click', () => openTopic({}));
}

function wireTopicsToday() {
  // 「已排入產稿 ×N｜看誰發過」→ 彈窗列出哪位顧問、什麼時候、目前狀態。
  const STATUS_ZH = {
    pending: '排隊中', drafted: '已產稿待審核', posting: '發布中',
    posted: '已發布', skipped: '顧問不發', blocked: '被稽核擋下',
    needs_material: '素材不足', claimed: '產稿中', deleted: '已刪除',
  };
  document.querySelectorAll('.topic-picked-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const holder = document.querySelector(`.topic-picks-data[data-for="${btn.dataset.topicId}"]`);
      let picks = [];
      try { const p = JSON.parse(holder ? holder.textContent : '[]'); if (Array.isArray(p)) picks = p; } catch { /* 壞掉就用空陣列 */ }
      const rows = picks.length
        ? picks.map((p) => `<div class="list-row"><span><b>${escapeHtml(p.account_label)}</b><small>${escapeHtml((p.requested_at || '').slice(0, 16))}</small></span><span class="badge">${escapeHtml(STATUS_ZH[p.status] || p.status)}</span></div>`).join('')
        : '<p class="help">還沒有人排過這一則。</p>';
      modal({
        title: '誰發過這個話題',
        subtitle: `共 ${picks.length} 次`,
        body: `<div class="drawer-section">${rows}<p class="help" style="margin-top:10px">同一個話題可以給不同顧問各自發一次（角度會自動換），但同一位顧問重複排會被擋。</p></div>`,
        footer: '<button class="btn" data-close-overlay>關閉</button>',
      });
    });
  });
  // 挑題彈窗需要的平台／顧問／公式清單（整頁共用一份）。
  let picker = { accounts: [], styles: [], platforms: [] };
  try {
    const holder = document.getElementById('topic-picker-data');
    if (holder) picker = JSON.parse(holder.textContent);
  } catch { /* 用空的 */ }
  const PLAT_ZH = { threads: 'Threads', linkedin: 'LinkedIn', line_community: 'LINE 社群' };

  document.querySelectorAll('.topic-open').forEach((openBtn) => {
    openBtn.addEventListener('click', () => {
      const topicId = Number(openBtn.dataset.topicId);
      modal({
        title: '選這則來發',
        subtitle: openBtn.dataset.topicName || '',
        body: views.topicPickerBody(),
        footer: '<button class="btn" data-close-overlay>取消</button><button class="btn primary" id="tp-go">產生草稿</button>',
      });
      const chSel = document.getElementById('tp-channel');
      const acSel = document.getElementById('tp-account');
      const stSel = document.getElementById('tp-style');
      const msg = document.getElementById('tp-msg');
      const goBtn = document.getElementById('tp-go');
      // 平台
      picker.platforms.forEach((p) => {
        const o = document.createElement('option'); o.value = p; o.textContent = PLAT_ZH[p] || p; chSel.appendChild(o);
      });
      // 公式（對話討論型／純CTA型都列）
      picker.styles.forEach((s) => {
        const o = document.createElement('option'); o.value = s.id;
        o.textContent = `${s.name}（${s.subtype === 'pure' ? '純CTA型' : '對話討論型'}）`; stSel.appendChild(o);
      });
      // 顧問（依平台過濾）
      const fillAccounts = () => {
        const ch = chSel.value;
        acSel.innerHTML = '<option value="">請選擇…</option>';
        picker.accounts.filter((a) => !ch || a.platform === ch).forEach((a) => {
          const o = document.createElement('option'); o.value = a.id; o.textContent = a.label; acSel.appendChild(o);
        });
      };
      fillAccounts();
      chSel.addEventListener('change', fillAccounts);
      goBtn.addEventListener('click', async () => {
        if (!acSel.value) { msg.textContent = '先選一位顧問的口吻。'; return; }
        goBtn.disabled = true; msg.textContent = '排入產稿中…';
        try {
          const hookV = (document.getElementById('tp-hook')?.value || '').trim();
          const r = await adapters.socialPostRequest({
            topic_id: topicId, account_id: acSel.value,
            style_id: stSel.value || undefined,
            ...(hookV ? { topic_hook: hookV.slice(0, 40) } : {}),
          });
          msg.textContent = (r && r.message) || '已排入產稿，1–2 分鐘後到 Telegram「社群發文審核」按確認才會發。';
          toast('已排入產稿');
          setTimeout(() => { closeOverlay(); loadSocialTab($('#page-data') || document.querySelector('main')); }, 1200);
        } catch (e) {
          msg.textContent = '排入失敗：' + (e && e.message ? e.message : e);
          goBtn.disabled = false;
        }
      });
    });
  });
}

// 2026-10-01 加：「用這篇的寫法再排一則」。排隊列表跟一鍵發文表單在同一頁
// （社群／發文／一鍵發文），直接操作表單 DOM，不用另外開彈窗或換頁。
// 只動「寫法」相關欄位（管道／寫法類型／公式），帳號跟職缺留白——
// 業主明確要求「顧問還是要自己選帳號跟職缺」，不要替他決定要對誰發。
function prefillSocialRepost(btn) {
  if (!btn) return;
  const $$id = (id) => document.getElementById(id);
  const typeSel = $$id('sc-type'), chSel = $$id('sc-channel'), waySel = $$id('sc-way');
  if (!typeSel || !waySel) { toast('表單還沒載入，稍等一下再試', 'error'); return; }
  const fire = (el) => el && el.dispatchEvent(new Event('change'));

  typeSel.value = 'job'; fire(typeSel);

  const platform = btn.getAttribute('data-platform');
  if (platform && chSel) { chSel.value = platform; fire(chSel); }

  const subtype = btn.getAttribute('data-subtype');
  const styleId = btn.getAttribute('data-style-id');
  if (subtype === 'pure') {
    waySel.value = 'pure'; fire(waySel);
    const sel = $$id('sc-pstyle');
    if (sel && styleId) sel.value = styleId;
  } else if (subtype === 'dialog') {
    waySel.value = 'dialog'; fire(waySel);
    const sel = $$id('sc-style');
    if (sel && styleId) sel.value = styleId;
  } else {
    // 沒有 style_id（原始格式）或查不到 subtype，退回原始格式——
    // 跟這則貼文當初的寫法一致，不要瞎猜成某個公式。
    waySel.value = 'default'; fire(waySel);
  }

  $$id('sc-account')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  toast('已帶入這篇的寫法，請選擇帳號與職缺', 'success');
}

function wireSocialComposer() {
  const $$id = (id) => document.getElementById(id);
  const typeSel = $$id('sc-type'), accSel = $$id('sc-account'), waySel = $$id('sc-way');
  const go = $$id('sc-go');
  if (!typeSel || !go) return;

  const syncType = () => {
    const isJob = typeSel.value === 'job', isAnon = typeSel.value === 'anon';
    $$id('sc-job-only').hidden = !isJob;
    $$id('sc-topic-only').hidden = isJob || isAnon;
    if ($$id('sc-anon-only')) $$id('sc-anon-only').hidden = !isAnon;
  };
  // 2026-10-07 匿名人選文：打字搜尋人選
  const aq = $$id('sc-anon-q');
  if (aq) {
    let t = null;
    aq.oninput = () => {
      clearTimeout(t);
      t = setTimeout(async () => {
        const v = aq.value.trim(); const sel = $$id('sc-anon-app');
        if (!v) { sel.innerHTML = '<option value="">先在上面搜尋…</option>'; return; }
        try {
          const r = await api.get(`/admin/anon-post/candidates?q=${encodeURIComponent(v)}`);
          const rows = (r && r.rows) || [];
          sel.innerHTML = rows.length ? rows.map((x) => `<option value="${escapeHtml(x.id)}">${escapeHtml(x.name || '')}｜${escapeHtml(x.job_title || '')}｜${escapeHtml(x.owner_name || '未指派')}${x.code ? '｜' + escapeHtml(x.code) : ''}${Number(x.n_report) ? '' : '｜只有履歷'}</option>`).join('')
            : '<option value="">找不到，換個關鍵字</option>';
        } catch (e) { sel.innerHTML = '<option value="">搜尋失敗，再試一次</option>'; }
      }, 300);
    };
  }
  const syncWay = () => {
    $$id('sc-style-wrap').hidden = waySel.value !== 'dialog';
    $$id('sc-pstyle-wrap').hidden = waySel.value !== 'pure';
  };
  const syncPreview = () => {
    const d = $$id('sc-date').value;
    const h = $$id('sc-hour').value, m = $$id('sc-min').value;
    const hm = (h || m) ? `${h || '00'}:${m || '00'}` : '';
    $$id('sc-preview').textContent = d
      ? `＝ ${d} ${hm ? hm + '（24 小時制）' : '（時間留空，當天排程一跑到就送出確認）'}`
      : '';
  };
  // 換職缺／換帳號才把按鈕重新亮起來——見 views 裡那段「不自動解鎖」的說明。
  const unlock = () => { go.disabled = false; go.textContent = '排入產稿'; };

  typeSel.onchange = () => { syncType(); unlock(); };
  waySel.onchange = () => { syncWay(); unlock(); };
  $$id('sc-job').onchange = unlock;
  $$id('sc-tstyle').onchange = unlock;
  if ($$id('sc-hook')) $$id('sc-hook').oninput = unlock;   // 換話題＝另一篇，按鈕重新亮
  $$id('sc-date').onchange = syncPreview;
  $$id('sc-hour').onchange = syncPreview;
  $$id('sc-min').onchange = syncPreview;
  accSel.onchange = unlock;

  // 管道下拉：只留該管道的帳號。⚠️ 用 hidden 而不是砍掉 option——
  // 砍掉的話切回「全部管道」要重建，而且會弄丟使用者已經選的那個。
  const chSel = $$id('sc-channel');
  if (chSel) {
    chSel.onchange = () => {
      const want = chSel.value;
      let keep = 0;
      for (const o of accSel.options) {
        if (!o.value) continue;
        const ok = !want || o.getAttribute('data-platform') === want;
        o.hidden = !ok;
        if (ok) keep += 1;
      }
      // 已經選的那個不屬於這個管道就清掉，不然畫面顯示的帳號跟管道對不起來
      const cur = accSel.selectedOptions[0];
      if (cur && cur.value && cur.hidden) accSel.value = '';
      unlock();
      if (!keep) toast('這個管道底下沒有可用的帳號', 'error');
    };
  }

  // 話題照「這篇是哪一種」的分類列，**不看顧問**。
  // ⚠️ 2026-09-11 Jacky 明確拿掉「顧問指派」那道關卡：新增任何話題／風格，
  //    全站顧問要能直接選，不用先去「顧問與話題設定」手動勾。
  //    我第一版把那道關卡加回去了，這裡是修正。
  let TOPICS = [];
  try { TOPICS = JSON.parse($$id('sc-topics-data').textContent || '[]'); } catch { TOPICS = []; }
  const syncTopics = () => {
    const sel = $$id('sc-topic');
    const cat = typeSel.value;              // general ／ ai
    const list = TOPICS.filter((t) => t.category === cat);
    sel.innerHTML = list.length
      ? '<option value="">請選擇…</option>' + list.map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`).join('')
      : '<option value="">這個分類底下還沒有話題（到「內容庫／Prompt」新增）</option>';
  };
  typeSel.addEventListener('change', syncTopics);
  syncType(); syncWay(); syncPreview(); syncTopics();

  go.onclick = async () => {
    const accountId = Number(accSel.value);
    if (!accountId) return toast('請先選發文帳號', 'error');
    const isJob = typeSel.value === 'job';
    const payload = { account_id: accountId };
    if (typeSel.value === 'anon') {
      const aid = $$id('sc-anon-app').value;
      if (!aid) return toast('請先搜尋並選一位人選', 'error');
      payload.anon_application_id = aid;
      const asid = Number($$id('sc-astyle').value || 0);
      if (asid) payload.style_id = asid;
      if ($$id('sc-date').value) return toast('匿名人選文目前只能「立刻排入產稿」，排程時間請留空', 'error');
    } else if (isJob) {
      const slug = $$id('sc-job').value;
      if (!slug) return toast('請先選職缺', 'error');
      payload.slug = slug;
      const way = waySel.value;
      if (way === 'dialog') {
        const sid = Number($$id('sc-style').value);
        if (!sid) return toast('對話討論型要選一個公式', 'error');
        payload.style_id = sid;
      } else if (way === 'pure') {
        // ⚠️ 純CTA型也要送 style_id。第一版送 way='pure'，後端不認這個參數，
        //    整筆被當成「沒選公式」＝原始格式——Jacky 實測時 TG 通知直接寫
        //    「公式：原始格式」才抓到。
        const pureId = Number($$id('sc-pstyle').value || 0);
        if (!pureId) return toast('系統找不到「純CTA型」這個公式，請先到內容庫確認它還在', 'error');
        payload.style_id = pureId;
      }
    } else {
      const tid = Number($$id('sc-topic').value);
      if (!tid) return toast('請先選話題', 'error');
      payload.topic_id = tid;
      payload.mission = typeSel.value === 'ai' ? 'trust_building' : 'engagement';
      const tsid = Number($$id('sc-tstyle').value || 0);
      if (tsid) payload.style_id = tsid;
    }
    const date = $$id('sc-date').value;
    const h = $$id('sc-hour').value, m = $$id('sc-min').value;
    // 2026-10-22：今天想搭的話題（選填）。立刻排入跟排程都會帶；空的就不送，行為跟以前一樣。
    const hook = ($$id('sc-hook')?.value || '').trim();
    if (hook) payload.topic_hook = hook.slice(0, 40);
    go.disabled = true; go.textContent = '排入中⋯';
    try {
      if (date) {
        const sp = { ...payload, post_date: date };
        if (h || m) sp.post_time = `${h || '00'}:${m || '00'}`;
        if (sp.slug) { sp.job_slug = sp.slug; delete sp.slug; }
        await adapters.socialSchedule(sp);
        go.textContent = '✅ 已排程';
        toast(`已排到 ${date}${(h || m) ? ' ' + (h || '00') + ':' + (m || '00') : ''}（24 小時制），到時間才會送出確認`, 'success');
      } else {
        const r = await adapters.socialPostRequest(payload);
        if (r && r.duplicate) {
          go.textContent = '✅ 已經排過了';
          toast(r.message || '這一筆已經排過了，不用重複按', 'success');
        } else {
          go.textContent = '✅ 已排入，等 Telegram';
          toast('已排入。產稿要 1–2 分鐘，會出現在 Telegram「社群發文審核」，不用重複按。', 'success');
        }
      }
    } catch (err) {
      unlock();
      toast(err.message || '排入失敗', 'error');
    }
  };
}

// 職缺社群回覆的篩選與複製。
// ⚠️ 複製出來的連結是轉址頁（ctx=reply），不是顧問真正的 LINE 連結——
//    候選人點了才記得到「這則回覆換到人加 LINE 了嗎」。不要改成直接貼 line_link。
const CS_ACCOUNT_KEY = 's1ne_cs_account';
async function wireSocialReplies() {
  const list = document.getElementById('cs-list');
  if (!list) return;
  let data;
  try { data = await adapters.candidateSummaries(); } catch { return; }
  const accSel = document.getElementById('cs-account');
  const saved = localStorage.getItem(CS_ACCOUNT_KEY);
  if (saved && accSel) {
    accSel.value = saved;
    // 以前存的是某個帳號 id（可能是同一人的 LinkedIn）：換成同一位顧問現在這一行
    if (accSel.value !== saved) {
      const old = (data.accounts || []).find((a) => String(a.id) === String(saved));
      const opt = old && [...accSel.options].find((o) => o.dataset.person === (old.consultant_name || old.label));
      if (opt) accSel.value = opt.value;
    }
  }
  let shown = [];
  const render = () => {
    const q = (document.getElementById('cs-search')?.value || '').trim().toLowerCase();
    const client = document.getElementById('cs-client')?.value || '';
    shown = (data.jobs || []).filter((j) => {
      if (client && j.client_name !== client) return false;
      if (!q) return true;
      return String(j.title || '').toLowerCase().includes(q)
          || String(j.client_name || '').toLowerCase().includes(q);
    });
    list.innerHTML = views.socialReplyCards(shown);
  };
  ['cs-search', 'cs-client'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.oninput = el.onchange = render;
  });
  if (accSel) accSel.onchange = () => localStorage.setItem(CS_ACCOUNT_KEY, accSel.value || '');
  list.onclick = (ev) => {
    const btn = ev.target.closest('[data-action="cs-copy"]');
    if (!btn) return;
    const j = shown[Number(btn.getAttribute('data-i'))];
    const accId = accSel ? accSel.value : '';
    if (!accId) return toast('請先在上面選你自己是哪位顧問', 'error');
    const link = `https://step1ne.com/go/?c=${encodeURIComponent(accId)}&j=${encodeURIComponent(j.slug || '')}&ctx=reply`;
    let txt = String(j.summary_text || '').split('{{LINE_LINK}}').join(link);
    if (!txt.includes(link)) txt += `\n\n${link}`;   // 保底：摘要裡沒有佔位符時
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject())
      .then(() => toast('已複製，可以直接貼到私訊', 'success'))
      .catch(() => window.prompt('複製不了，請自己選取這段複製：', txt));
  };
  render();
}

// LINE 綁定清單的篩選。純前端過濾已經畫好的列，不重打 API——42 列而已，
// 換一次條件再跑一次查詢只是浪費。
function wireBindFilter() {
  const sel = document.getElementById('bind-filter');
  const box = document.getElementById('bind-list');
  if (!sel || !box) return;
  const search = document.getElementById('bind-search');
  const empty = document.getElementById('bind-empty');
  const apply = () => {
    const v = sel.value;
    const q = (search?.value || '').trim().toLowerCase();
    let shown = 0;
    for (const r of box.querySelectorAll('.list-row')) {
      const st = r.getAttribute('data-bind-state') || '';
      const can = r.getAttribute('data-can-notify') === '1';
      const okState = !v || (v === 'can_notify' ? can : st === v);
      const okText = !q || r.innerText.toLowerCase().includes(q);
      const ok = okState && okText;
      r.hidden = !ok;
      if (ok) shown += 1;
    }
    if (empty) empty.hidden = shown > 0;
    // ⚠️ 2026-09-22：Jacky 說「下拉點了沒有反應」。實際上有過濾，只是他選
    //    「已綁定」時最上面幾列本來就是已綁定的人，畫面看起來一模一樣。
    //    加一行「顯示 X 位」，選什麼都看得到數字在動，才知道系統有回應。
    const counter = document.getElementById('bind-count');
    if (counter) {
      const total = box.querySelectorAll('.list-row').length;
      counter.textContent = (shown === total)
        ? `顯示全部 ${total} 位`
        : `顯示 ${shown} 位（全部 ${total} 位）`;
    }
  };
  sel.onchange = apply;
  if (search) search.oninput = apply;
}

function currentMonthKey() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }

// planned（social_schedule，排好還沒發）跟 actual（social_post_queue，已發或排隊）
// 合併成同一份時間軸——跟舊版 consultant/social-post 的 loadCal() 邏輯一致。
// actual 要濾掉 skipped/deleted：後端 GET 只擋掉帳號對不到（a.id IS NULL），
// 顧問在 TG 按「❌ 拒絕」的稿子還是會回傳，不濾會被誤當成「已發」畫進月曆。
function mergeCalendar(raw) {
  const ev = (raw.planned || []).map((p) => ({ id: p.id, d: p.d, t: p.post_time, slug: p.job_slug, title: p.job_title, label: p.label, platform: p.platform, category: p.category, status: 'planned', planned: true }))
    .concat((raw.actual || []).filter((a) => a.status !== 'skipped' && a.status !== 'deleted').map((a) => ({ id: a.id, d: a.d, slug: a.job_slug, title: a.job_title, label: a.label, platform: a.platform, category: a.category, status: a.status, planned: false })));
  return { month: raw.month || state.social.month, accounts: raw.accounts || [], jobs: raw.jobs || [], ev, recentIv: raw.recentInterviews || {} };
}

async function loadScheduleTab(target) {
  if (!state.social.month) state.social.month = currentMonthKey();
  await boundary(target, () => adapters.socialCalendar(state.social.month), (raw) => {
    state.social.data = mergeCalendar(raw);
    return views.socialCalendarTab(state.social.data);
  }, 'refresh');
}

function shiftScheduleMonth(delta) {
  const base = state.social.month || currentMonthKey();
  const [y, m] = base.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  state.social.month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const target = $('#page-data');
  if (target) loadScheduleTab(target);
}

function openScheduleDay(k) {
  const data = state.social.data;
  if (!data) return;
  state.social.openDay = k;
  const weekday = ['日', '一', '二', '三', '四', '五', '六'][new Date(k).getDay()];
  drawer({ title: k, subtitle: `星期${weekday}`, body: views.scheduleDayBody({ k, ev: data.ev, accounts: data.accounts, jobs: data.jobs }) });
  wireScheduleDayForm(k);
}

function wireScheduleDayForm(k) {
  const form = $('#cal-add-form');
  const data = state.social.data;
  if (!form || !data) return;
  const check = () => {
    const accId = form.elements.account_id.value, jobSlug = form.elements.job_slug.value;
    const box = $('#cal-add-check');
    if (!accId || !jobSlug || !box) { if (box) box.innerHTML = ''; return; }
    const acc = data.accounts.find((a) => String(a.id) === accId);
    if (!acc) return;
    const onDay = data.ev.filter((e) => e.d === k);
    const sameDaySameAcc = onDay.some((e) => e.slug === jobSlug && e.label === acc.label);
    const sameDayOther = onDay.filter((e) => e.slug === jobSlug && e.label !== acc.label);
    const d0 = new Date(k);
    const recent = data.ev.filter((e) => e.slug === jobSlug && e.label === acc.label && (d0 - new Date(e.d)) / 86400000 > 0 && (d0 - new Date(e.d)) / 86400000 <= 7);
    let html;
    if (sameDaySameAcc) html = `<div class="notice" style="background:#ffe5e7;border-color:#eab8bc;color:#a72f3a">🚫 這一天已經排過同一個職缺了，同一個人不能重複發。</div>`;
    else {
      html = sameDayOther.length ? `<div class="notice" style="background:#e2f8ed;border-color:#bfe3c8;color:#14794c">✅ 可以排。同一天 <b>${escapeHtml(sameDayOther.map((e) => e.label).join('、'))}</b> 也會發這個職缺——不同人發同一個缺沒問題。</div>` : `<div class="notice" style="background:#e2f8ed;border-color:#bfe3c8;color:#14794c">✅ 沒有衝突，可以排。</div>`;
      if (recent.length) html += `<div class="notice">📅 這個職缺 7 天內剛發過（${escapeHtml(recent.map((e) => e.d.slice(5)).join('、'))}），間隔太近效果會遞減。</div>`;
    }
    box.innerHTML = html;
    const submitBtn = $('[data-action="cal-add-submit"]');
    if (submitBtn) submitBtn.disabled = sameDaySameAcc;
  };
  form.elements.account_id.onchange = check;
  form.elements.job_slug.onchange = check;
  const accSel = $('#cal-suggest-acc');
  if (accSel) accSel.onchange = () => {
    const acc = data.accounts.find((a) => String(a.id) === accSel.value);
    const box = $('#cal-suggest-body');
    if (box) box.innerHTML = views.scheduleSuggestBody({ k, acc, ev: data.ev, jobs: data.jobs, recentIv: data.recentIv });
    wireSuggestAddButtons(k);
  };
}

function wireSuggestAddButtons(k) {
  $$('[data-suggest-add]').forEach((btn) => {
    btn.onclick = () => {
      const accSel = $('#cal-suggest-acc');
      const acc = state.social.data?.accounts.find((a) => String(a.id) === accSel?.value);
      if (!acc) return;
      addScheduleEntry(k, btn.getAttribute('data-suggest-add'), acc.id).then(() => openScheduleDay(k));
    };
  });
}

// 排一則新的排程。硬規則（同顧問同天同職缺）由後端 UNIQUE 擋，前端只負責把
// 409 錯誤講清楚，不用自己重算一次規則。
async function addScheduleEntry(date, jobSlug, accountId, time) {
  try {
    const result = await api.post('/admin/social/schedule', { post_date: date, post_time: time || undefined, job_slug: jobSlug, account_id: Number(accountId) });
    if (!result.ok) { toast(result.error || '排程失敗', 'error'); return false; }
    toast('已排入', 'success');
    const target = $('#page-data');
    if (target) await loadScheduleTab(target);
    return true;
  } catch (error) { console.error(error); toast(error.message, 'error'); return false; }
}

async function submitScheduleAdd(day) {
  const form = $('#cal-add-form');
  if (!form?.reportValidity()) return;
  const accountId = form.elements.account_id.value, jobSlug = form.elements.job_slug.value, time = form.elements.post_time.value;
  const ok = await addScheduleEntry(day, jobSlug, accountId, time);
  if (ok) openScheduleDay(day);
}

// 「這個月發最少」的帳號優先（讓量平均）→「那天排最少」的日子（一天最多 4 則，
// 不要洗版）→ 避開同一個顧問 7 天內剛發過同一個職缺 → 從明天起找，不排到過去。
function findScheduleSlot(slug) {
  const data = state.social.data;
  if (!data) return null;
  const start = new Date();
  const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const cnt = {};
  data.accounts.forEach((a) => { cnt[a.label] = 0; });
  data.ev.filter((e) => e.d.startsWith(monthKey(start))).forEach((e) => { if (cnt[e.label] !== undefined) cnt[e.label]++; });
  const accs = data.accounts.slice().sort((a, b) => cnt[a.label] - cnt[b.label]);
  for (let i = 1; i <= 21; i++) {
    const d = new Date(start); d.setDate(d.getDate() + i);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const onDay = data.ev.filter((e) => e.d === k);
    if (onDay.length >= 4) continue;
    for (const a of accs) {
      if (onDay.some((e) => e.slug === slug && e.label === a.label)) continue;
      const tooSoon = data.ev.some((e) => e.slug === slug && e.label === a.label && Math.abs((d - new Date(e.d)) / 86400000) <= 7);
      if (tooSoon) continue;
      return { date: k, account: a };
    }
  }
  return null;
}

async function openScheduleMissing() {
  const data = state.social.data;
  if (!data) return;
  const [y, m] = (state.social.month || currentMonthKey()).split('-');
  const had = new Set(data.ev.filter((e) => e.d.startsWith(`${y}-${m}`)).map((e) => e.slug));
  const missing = data.jobs.filter((j) => !had.has(j.slug));
  modal({ title: '還有哪些沒發', subtitle: `${y} 年 ${Number(m)} 月`, body: views.scheduleMissingBody({ missing, gaps: null }), footer: '<button class="btn" data-close-overlay>關閉</button>' });
  try {
    const coverage = await api.get('/admin/social/coverage?days=30');
    const box = $('.modal-body');
    if (box) box.innerHTML = views.scheduleMissingBody({ missing, gaps: coverage?.gaps || [] });
    wireScheduleMissingButtons(missing);
  } catch (error) { console.error(error); }
  wireScheduleMissingButtons(missing);
}

function wireScheduleMissingButtons(missing) {
  $$('[data-missing-add]').forEach((btn) => {
    btn.onclick = async () => {
      const slug = btn.getAttribute('data-missing-add');
      const slot = findScheduleSlot(slug);
      if (!slot) { toast('三週內找不到合適的空檔，請自己在行事曆上挑一天排', 'error'); return; }
      btn.disabled = true;
      const ok = await addScheduleEntry(slot.date, slug, slot.account.id);
      if (ok) {
        const row = $(`[data-missing-row="${slug}"]`);
        if (row) row.outerHTML = `<div class="list-row"><span>${escapeHtml(row.querySelector('span')?.textContent || '')}</span><span class="badge success">已排 ${slot.date.slice(5)} · ${escapeHtml(slot.account.label)}</span></div>`;
      } else btn.disabled = false;
    };
  });
  const allBtn = $('[data-action="cal-missing-all"]');
  if (allBtn) allBtn.onclick = async () => {
    allBtn.disabled = true;
    const done = [];
    for (const j of missing) {
      const slot = findScheduleSlot(j.slug);
      if (!slot) continue;
      const ok = await addScheduleEntry(slot.date, j.slug, slot.account.id);
      if (ok) done.push(`${slot.date.slice(5)} ${slot.account.label}｜${j.title}`);
    }
    toast(`排好 ${done.length} 則`, 'success');
    closeOverlay();
  };
}

async function loadClientsTab(target) {
  if (state.sub === 'bd') return boundary(target, async () => ({ bd: (await adapters.clients()).bd, talentPool: await adapters.talentPool() }), views.clientsBdTab, 'refresh');
  if (state.sub === 'scripts') {
    target.innerHTML = views.scriptsTab();
    wireScripts(target);
    return null;
  }
  if (state.sub === 'hiringleads') {
    await ensureConsultants();
    const u = amUi();
    return boundary(target, () => adapters.hiringLeads(u.hlCat), (d) => views.hiringLeadsTab(d, { me: u.me, consultants: state.consultantsCache || [], hlShow: u.hlShow, hlAge: u.hlAge, hlAssignee: u.hlAssignee }), 'refresh');
  }
  if (state.sub === 'candbd') {
    await ensureConsultants();
    return boundary(target, adapters.candBd, (d) => views.candBdTab(d, { me: amUi().me, consultants: state.consultantsCache || [] }), 'refresh');
  }
  // 2026-10-02 Jacky：夜間 AI 找來、還沒人碰過的放「AI 名單」分頁，開發進度只放顧問碰過的
  if (state.sub === 'bd-ai') {
    const res = await boundary(target, adapters.bdDashboard, (d) => views.bdDashboard({ ...d, rows: (d.rows || []).filter((r) => r.ai_untouched) }, 'ai'), 'refresh');
    wireBdDashboardFilter();
    return res;
  }
  if (state.sub === 'bd-progress') {
    const res = await boundary(target, async () => { const [d, bd] = await Promise.all([adapters.bdDashboard(), api.get('/admin/bd').catch(() => null)]); return { ...d, _drafts: bd ? (bd.rows || bd.items || bd.opportunities || []) : [] }; },
      (d) => views.bdDraftsBlock(d._drafts) + views.bdDashboard({ ...d, rows: (d.rows || []).filter((r) => !r.ai_untouched) }), 'refresh');
    wireBdDashboardFilter();
    return res;
  }
  if (state.sub === 'bd-wrapup') {
    const res = await boundary(target, adapters.bdWrapup, views.bdWrapup, 'refresh');
    wireWrapup(target);
    return res;
  }
  if (state.sub === 'requests') return boundary(target, async () => (await adapters.clients()).requests, views.clientsRequestsTab, 'refresh');
  if (state.sub === 'hiring') return boundary(target, adapters.hiringSubmissions, views.clientsHiringTab, 'refresh');
  if (state.sub === 'billing') return loadBillingTab(target);
  return boundary(target, adapters.clients, views.clientsData, 'refresh');
}

// 收費進程（2026-09-29，總指揮交辦）：company_id 存在 state 裡，切公司不用
// 重新整理整頁——跟卡片牆的篩選器同一種模式（select onchange → loadRoute()）。
async function loadBillingTab(target) {
  // 2026-10-19 收費進程第二版：TG 提醒卡連過來會帶 ?company=…&inst=…
  if (state.billingCompany === undefined) {
    const qc = new URLSearchParams(location.search).get('company');
    state.billingCompany = qc || '';
  }
  const companyId = state.billingCompany || '';
  let ctx = {};
  const res = await boundary(target, async () => {
    const [companiesResp, plan, client, list] = await Promise.all([
      adapters.clients(),
      companyId ? adapters.billingPlan(companyId) : Promise.resolve(null),
      companyId ? billing2Api.client(companyId) : Promise.resolve(null),
      billing2Api.placements(companyId),
    ]);
    ctx = { client, rows: list.installments || [], cats: list.categories || [] };
    const tiers = (plan && plan.tiers) || [];
    const planHtml = `<div id="billing-plan-box"><table><thead><tr><th>名稱</th><th>比例</th><th>觸發時機</th><th></th></tr></thead>
<tbody id="billing-plan-rows">${tiers.map((t, i) => views.billingPlanRow(t, i)).join('')}</tbody></table>
<div class="actions-row"><button type="button" class="btn" id="billing-add-row">＋ 加一期</button>
<button type="button" class="btn primary" id="billing-save-plan">儲存範本</button></div></div>`;
    return { companies: companiesResp.companies, planHtml, client, rows: ctx.rows, noSched: list.no_schedule || [] };
  }, ({ companies, planHtml, client, rows, noSched }) => (noSched && noSched.length ? `<div class="notice" style="margin-bottom:12px;border-color:#e0a03a">⚠️ 已報到但還沒有分期（不會被請款）：${noSched.map((x) => escapeHtml(`${x.candidate_name}（${x.company_name || ''}，${x.onboard_date} 報到）`)).join('、')}。請到該客戶設定分期範本，存檔時系統會自動補排。</div>` : '') + `<div class="notice" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px">客戶付款後記得按「✅ 已收到款」——不知道下一步輪到誰，看流程圖。<a class="btn" href="/consultant-app/billing-flow.html" target="_blank" rel="noopener" style="min-height:44px;display:inline-flex;align-items:center;text-decoration:none">看收費流程圖 ↗</a></div>` + billingV2View({ companies, companyId, planHtml, client, rows }), 'refresh');
  wireBillingTab();
  wireBillingV2({ state, reload: () => loadRoute(), client: ctx.client, rows: ctx.rows, cats: ctx.cats });
  return res;
}

function wireBillingTab() {
  const sel = $('#billing-company-select');
  if (sel) sel.onchange = () => { state.billingCompany = sel.value; loadRoute(); };
  const addBtn = $('#billing-add-row');
  if (addBtn) addBtn.onclick = () => {
    const tbody = $('#billing-plan-rows');
    const i = tbody.children.length;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><input type="text" class="bp-label" placeholder="第${i + 1}期"></td>
<td><input type="number" class="bp-percent" value="0" min="0" max="100" step="0.1" style="width:80px"> %</td>
<td>報到滿 <input type="number" class="bp-value" value="30" min="0" style="width:70px">
<select class="bp-unit"><option value="days">天</option><option value="months">個月</option></select></td>
<td><button type="button" class="btn danger sm bp-remove">刪除</button></td>`;
    tbody.appendChild(tr);
  };
  const planBox = $('#billing-plan-box');
  if (planBox) planBox.addEventListener('click', (e) => {
    if (e.target.closest('.bp-remove')) e.target.closest('tr').remove();
  });
  const saveBtn = $('#billing-save-plan');
  if (saveBtn) saveBtn.onclick = async () => {
    const tiers = $$('#billing-plan-rows tr').map((tr, i) => ({
      seq: i + 1,
      label: tr.querySelector('.bp-label').value.trim() || `第${i + 1}期`,
      percent: Number(tr.querySelector('.bp-percent').value) || 0,
      trigger_unit: tr.querySelector('.bp-unit').value,
      trigger_value: Number(tr.querySelector('.bp-value').value) || 0,
    }));
    saveBtn.disabled = true;
    try {
      const r = await adapters.saveBillingPlan(state.billingCompany, tiers);
      if (!r.ok) { toast(r.error || '儲存失敗', 'error'); saveBtn.disabled = false; return; }
      toast(r.backfilled ? `已儲存，順便幫 ${r.backfilled} 位已報到但還沒展開過的人選補上分期` : '已儲存', 'success');
      loadRoute();
    } catch (error) { console.error(error); toast(error.message, 'error'); saveBtn.disabled = false; }
  };
  $$('.billing-group-row').forEach((row) => {
    row.onclick = () => openBillingDetail(JSON.parse(row.getAttribute('data-rows')));
  });
}

function billingTenureText(onboardDate) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const od = new Date(`${onboardDate}T00:00:00`);
  const days = Math.round((today - od) / 86400000);
  if (days < 0) return `尚未到職（還有 ${-days} 天）`;
  if (days === 0) return '今天到職';
  if (days < 30) return `已到職 ${days} 天`;
  return `已到職約 ${Math.floor(days / 30)} 個月（${days} 天）`;
}

function openBillingDetail(rows) {
  modal({ title: rows[0].candidate_name, subtitle: `${rows[0].client_name} · ${rows[0].job_title}`,
    body: views.billingDetailBody(rows, billingTenureText(rows[0].onboard_date)) });
  $$('[data-proof-download]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); downloadBillingProof(a.getAttribute('data-proof-download')); }; });
}

// 開發進度看板的篩選——跟 wireBindFilter() 同一套做法：篩選鍵已經印在每一列
// 的 data 屬性上，這裡純粹 show/hide，不重打 API。漏斗那一排按鈕也是設同一個
// <select>，兩種操作方式共用同一份篩選邏輯，不寫兩套。
function wireBdDashboardFilter() {
  const sel = document.getElementById('bd-dash-filter');
  const box = document.getElementById('bd-dash-list');
  const counter = document.getElementById('bd-dash-count');
  if (!sel || !box) return;
  const ind = document.getElementById('bd-dash-industry');
  const who = document.getElementById('bd-dash-assignee');
  const ph = document.getElementById('bd-dash-phone');
  const ct = document.getElementById('bd-dash-contacted');
  const qc = document.getElementById('bd-dash-qc');
  const src = document.getElementById('bd-dash-source');
  const qbox = document.getElementById('bd-dash-q');
  // 2026-10-13 Jacky：總攬最上面「今天要處理」四格＋客戶標籤，點了篩選，再點一次取消
  let quick = ''; let tagSel = '';
  const paintOverview = () => {
    for (const b of document.querySelectorAll('[data-bdo-quick]')) b.classList.toggle('on', b.dataset.bdoQuick === quick);
    for (const b of document.querySelectorAll('[data-bdo-tag]')) { const on = b.dataset.bdoTag === tagSel; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }
  };
  const apply = () => {
    paintOverview();
    const v = sel.value;
    let shown = 0;
    for (const r of box.querySelectorAll('.bd-dash-row')) {
      const stage = r.getAttribute('data-bd-stage') || '';
      const hasTodo = r.getAttribute('data-bd-has-todo') === '1';
      let ok = true;
      if (v === 'todo') ok = hasTodo;
      else if (v === 'replied') ok = ['replied', 'jd_shared', 'closed'].includes(stage);
      else if (v.startsWith('stage:')) ok = stage === v.slice('stage:'.length);
      // 2026-10-02 Jacky：可以直接打公司名稱找
      if (ok && qbox && qbox.value.trim()) ok = (r.dataset.bdName || '').includes(qbox.value.trim().toLowerCase());
      if (ok && quick) ok = quick === 'late' ? r.dataset.bdLate === '1' : quick === 'today' ? r.dataset.bdToday === '1' : quick === 'hot' ? r.dataset.bdTag === 'HOT' : r.dataset.bdTag === 'MATERIAL';
      if (ok && tagSel) ok = r.dataset.bdTag === tagSel;
      if (ok && src && src.value) ok = r.dataset.bdSource === src.value;
      if (ok && ind && ind.value) ok = r.dataset.bdIndustry === ind.value;
      if (ok && who && who.value) ok = who.value === '__none' ? !r.dataset.bdAssignee : r.dataset.bdAssignee === who.value;
      // 備選池（2026-09-30 Jacky）：只有選「備選池」才看得到，其他篩選一律藏起來
      const parked = r.dataset.bdParked === '1';
      if (ct && ct.value === 'parked') ok = ok && parked;
      else if (parked) ok = false;
      if (ok && ct && ct.value && ct.value !== 'parked') ok = ct.value === 'yes' ? r.dataset.bdContacted === '1' : r.dataset.bdContacted !== '1';
      if (ok && qc && qc.value) ok = qc.value === 'ok' ? r.dataset.bdQc === '1' : r.dataset.bdQc !== '1';
      if (ok && ph && ph.value) ok = ph.value === 'hr' ? r.dataset.bdPhone === 'hr' : ph.value === 'any' ? r.dataset.bdPhone !== 'none' : r.dataset.bdPhone === 'none';
      r.hidden = !ok;
      if (ok) shown += 1;
    }
    // 產業標題：底下沒有顯示中的公司就藏起來
    for (const h of box.querySelectorAll('[data-bd-group-head]')) {
      h.hidden = ![...box.querySelectorAll(`.bd-dash-row[data-bd-industry="${CSS.escape(h.dataset.bdGroupHead)}"]`)].some((r) => !r.hidden);
    }
    const total = box.querySelectorAll('.bd-dash-row').length;
    if (counter) counter.textContent = shown === total ? `顯示全部 ${total} 家` : `顯示 ${shown} 家（全部 ${total} 家）`;
  };
  sel.onchange = apply;
  [ind, who, ph, ct, qc, src].forEach((x) => { if (x) x.onchange = apply; });
  if (qbox) qbox.oninput = apply;
  for (const b of document.querySelectorAll('[data-bdo-quick]')) b.onclick = () => { quick = quick === b.dataset.bdoQuick ? '' : b.dataset.bdoQuick; apply(); };
  for (const b of document.querySelectorAll('[data-bdo-tag]')) b.onclick = () => { tagSel = tagSel === b.dataset.bdoTag ? '' : b.dataset.bdoTag; apply(); };
  // 已聯繫打勾（2026-09-30 Jacky）：勾了就存，記錄是誰（用這列的負責人）
  for (const cb of box.querySelectorAll('[data-bd-contacted-box]')) {
    cb.onchange = async () => {
      const row = cb.closest('.bd-dash-row');
      try {
        await api.post('/admin/bd/contacted', { company: cb.dataset.bdContactedBox, checked: cb.checked, by: row.dataset.bdAssignee || '' });
        row.dataset.bdContacted = cb.checked ? '1' : '0';
        toast(cb.checked ? '已標記聯繫過' : '已取消聯繫標記', 'success');
      } catch (e) { cb.checked = !cb.checked; toast(`存檔失敗：${e.message || e}`, 'error'); }
    };
  }
  // 指派顧問：選了就存，不用另外按儲存
  for (const s2 of box.querySelectorAll('[data-bd-assign]')) {
    s2.onchange = async () => {
      s2.disabled = true;
      try {
        await api.post('/admin/bd/assign', { company: s2.dataset.bdAssign, assignee: s2.value });
        s2.closest('.bd-dash-row').dataset.bdAssignee = s2.value;
        toast(s2.value ? `已指派給 ${s2.value}` : '已取消指派', 'success');
      } catch (e) {
        toast(`指派失敗：${e.message || e}`, 'error');
        // 2026-09-29：沒電話不能指派（後端回 400），選單退回原本的人，不要顯示成已經指派
        s2.value = s2.closest('.bd-dash-row').dataset.bdAssignee || '';
      }
      s2.disabled = false;
    };
  }
  for (const btn of $$('.bd-funnel-step')) {
    btn.onclick = () => { sel.value = `stage:${btn.getAttribute('data-bd-filter-stage')}`; apply(); };
  }
  apply();
}

async function openBdDetail(company, focus) {
  state.openBdCompany = company;
  // 2026-10-13 Jacky：「寄信」「新增職缺」不再開獨立頁／彈窗，一律開卡片、直接跳到那個分頁
  state.bdMailMode = focus === 'mail';
  const sub = '開發進度';
  drawer({ title: company, subtitle: sub, body: loading() });
  try {
    const detail = await adapters.bdDashboardDetail(company);
    drawer({ title: company, subtitle: sub, body: views.bdDashboardDetail({ ...detail, company }) });
    wireBdDetailTabs();
    const dr = document.querySelector('.bd-status-card')?.parentElement;
    if (dr) wireCompanyStatus(dr);
    // 2026-10-13 客戶開發卡片改版：下一步／標籤／階段／進度紀錄
    const body = document.querySelector('.drawer-body') || document.body;
    wireBdCard(body, { ...detail, company }, async (opt = {}) => {
      await openBdDetail(company);
      if (opt.openLog) document.querySelector('[data-bd-detail-tab="log"]')?.click();
      if (opt.remindTag) bdShowTagRemind(document.querySelector('.drawer-body') || document.body, opt.remindTag);
      if (opt.remindStage) bdShowStageRemind(document.querySelector('.drawer-body') || document.body, ((detail.company_status || {}).stage) || '');
    });
    loadDealTerms(body, { ...detail, company });
    wireBdAi(body, company);
    wireBdJobs(body, { ...detail, company }, async (opt = {}) => {
      await openBdDetail(company);
      if (opt.openJobs) document.querySelector('[data-bd-detail-tab="jobs"]')?.click();
    });
    bdmAutoload(body, company);
    wireBdProfile(body);
    if (focus === 'mail') {
      document.querySelector('[data-bd-detail-tab="mail"]')?.click();
      const root = document.getElementById('bd-detail-pane-mail');
      // 從人選敲門名單按「寄信」進來：預先選好「手上有人選」，帶入匿名人選重點
      const pre = state.mailPreset; state.mailPreset = null;
      if (root && pre) {
        const sc = root.querySelector('[data-pack-scenario]');
        const br = root.querySelector('[data-pack-brief]');
        if (br && pre.brief) br.value = pre.brief;
        if (sc && pre.scenario) { sc.value = pre.scenario; sc.dispatchEvent(new Event('change')); }
      }
      root?.scrollIntoView({ block: 'start' });
    } else if (focus === 'jobs') {
      document.querySelector('[data-bd-detail-tab="jobs"]')?.click();
      document.querySelector('[data-bdj-add]')?.click();
    }
    const mailPane = document.getElementById('bd-detail-pane-mail');
    if (mailPane) wireContractPack(mailPane);
  } catch (error) {
    console.error(error);
    drawer({ title: company, body: errorState(error) });
  }
}

// 2026-10-13：認識公司 預覽／設定模式
function wireBdProfile(root) {
  const box = root.querySelector('[data-bdk]');
  if (!box) return;
  const company = box.dataset.bdk;
  const view = box.querySelector('[data-bdk-view]'); const edit = box.querySelector('[data-bdk-edit]');
  box.querySelectorAll('[name=bdk-m]').forEach((r) => {
    r.onchange = () => { const e = box.querySelector('[name=bdk-m]:checked').value === 'edit'; view.hidden = e; edit.hidden = !e; };
  });
  box.querySelectorAll('[data-bdk-k]').forEach((el) => {
    el.onchange = async () => {
      try { await api.post('/admin/bd/profile-update', { company, [el.dataset.bdkK]: el.value, by: document.querySelector('.cg-pack')?.dataset.packBy || '' }); toast('已儲存', 'success'); }
      catch (err) { toast(err.message || '儲存失敗', 'error'); }
    };
  });
}

// 2026-10-13：匯入電洽內容讓 AI 整理（沿用原本的 /admin/bd/transcript）
function wireBdAi(root, company) {
  const box = root.querySelector('[data-bdc-ai]');
  if (!box) return;
  const ta = box.querySelector('[data-bdc-ai-text]');
  box.querySelector('[data-bdc-ai-file]')?.addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) ta.value = await f.text();
  });
  box.querySelector('[data-bdc-ai-go]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (!ta.value.trim()) { toast('先貼上逐字稿', 'error'); return; }
    btn.disabled = true;
    try {
      await api.post('/admin/bd/transcript', { company, transcript: ta.value });
      toast('已送去 AI 整理，約 1～3 分鐘後重開卡片就看得到', 'success');
      ta.value = '';
    } catch (err) { toast(err.message || '送出失敗', 'error'); }
    btn.disabled = false;
  });
}

// 企業卡片裡「時間軸／信件」跟「開發引導」兩個分頁——drawer 內容是整段
// innerHTML 換掉的，不是路由切換，所以用最簡單的 show/hide，不用另外
// 掛路由狀態。
function wireBdDetailTabs() {
  const tabs = $$('#bd-detail-tabs [data-bd-detail-tab]');
  if (!tabs.length) return;
  for (const btn of tabs) {
    btn.onclick = () => {
      const key = btn.getAttribute('data-bd-detail-tab');
      for (const b of tabs) b.classList.toggle('active', b === btn);
      for (const k of ['log', 'jobs', 'mail']) { const el = document.getElementById(`bd-detail-pane-${k}`); if (el) el.hidden = key !== k; }
      const timelinePane = document.getElementById('bd-detail-pane-timeline');
      const playbookPane = document.getElementById('bd-detail-pane-playbook');
      const profilePane = document.getElementById('bd-detail-pane-profile');
      if (profilePane) profilePane.hidden = key !== 'profile';
      if (timelinePane) timelinePane.hidden = key !== 'timeline';
      if (playbookPane) playbookPane.hidden = key !== 'playbook';
    };
  }
  wireCallGuide();
  const sq = document.querySelector('.sc-quick');
  if (sq) wireScripts(sq);
}

// 話術快查／話術手冊：搜尋＋情境按鈕，純前端篩選
function wireScripts(root) {
  const wrap = root.querySelector('.sc-wrap');
  if (!wrap) return;
  const items = [...wrap.querySelectorAll('.sc-item')];
  const input = wrap.querySelector('.sc-search');
  const hint = wrap.querySelector('.sc-hint');
  const list = wrap.querySelector('.sc-list');
  let cat = '';
  // 我的最愛（2026-09-29 Jacky）：顧問點星星收藏，固定排最上面並直接展開。跟負責人篩選一樣存這台裝置。
  const FAV_KEY = 's1_script_favs';
  let favs;
  try { favs = new Set(JSON.parse(localStorage.getItem(FAV_KEY) || '[]')); } catch { favs = new Set(); }
  const isFav = (it) => favs.has(it.dataset.scId);
  const syncFavs = () => {
    try { localStorage.setItem(FAV_KEY, JSON.stringify([...favs])); } catch { /* 無痕模式存不了就算了 */ }
    for (const it of items) {
      const on = isFav(it);
      it.classList.toggle('fav', on);
      const b = it.querySelector('[data-sc-star]');
      if (b) { b.setAttribute('aria-pressed', String(on)); b.setAttribute('aria-label', on ? '從我的最愛移除' : '加入我的最愛'); b.title = b.getAttribute('aria-label'); }
    }
    // 最愛排前面，其他維持原本順序
    [...items.filter(isFav), ...items.filter((it) => !isFav(it))].forEach((it) => list.appendChild(it));
    const cnt = wrap.querySelector('[data-sc-fav-n]');
    if (cnt) cnt.textContent = String(favs.size);
  };
  const apply = () => {
    const kw = (input?.value || '').trim().toLowerCase();
    const compact = !!hint;
    const idle = !cat && !kw;
    let n = 0;
    for (const it of items) {
      const ok = (!cat || (cat === 'fav' ? isFav(it) : it.dataset.scCatOf === cat)) && (!kw || kw.split(/\s+/).every((w) => it.dataset.scText.includes(w)));
      it.hidden = compact && idle ? !isFav(it) : !ok;
      if (!it.hidden) n += 1;
    }
    if (hint) hint.hidden = !idle || favs.size > 0;
    // 最愛直接展開（照著唸）；其他只剩一兩張時才展開，省一次點擊
    items.filter((it) => !it.hidden).forEach((it) => { it.open = ((idle || cat === 'fav') && isFav(it)) || n <= 2; });
  };
  wrap.querySelectorAll('[data-sc-star]').forEach((b) => b.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation(); // 點星星不要順便開合那一段
    const id = b.closest('.sc-item').dataset.scId;
    if (favs.has(id)) favs.delete(id); else favs.add(id);
    syncFavs(); apply();
  }));
  syncFavs();
  input?.addEventListener('input', apply);
  wrap.querySelectorAll('[data-sc-cat]').forEach((b) => b.addEventListener('click', () => {
    cat = cat === b.dataset.scCat ? '' : b.dataset.scCat;
    wrap.querySelectorAll('[data-sc-cat]').forEach((x) => x.classList.toggle('active', x.dataset.scCat === cat));
    apply();
  }));
  // 手機版用下拉選單（跟分類按鈕同步）
  const catSel = wrap.querySelector('.sc-cat-select');
  catSel?.addEventListener('change', () => {
    cat = catSel.value;
    wrap.querySelectorAll('[data-sc-cat]').forEach((x) => x.classList.toggle('active', x.dataset.scCat === cat));
    apply();
  });
  apply();
}

// 電話引導 v2：上一步／下一步、有沒有人資切換講稿、點結果就記錄。
function wireCallGuide() {
  const root = document.querySelector('.cg');
  if (!root) return;
  const steps = [...root.querySelectorAll('[data-cg-step]')];
  let cur = 0;
  const go = (i) => {
    cur = Math.max(0, Math.min(steps.length - 1, i));
    steps.forEach((el, k) => { el.hidden = k !== cur; });
    root.querySelectorAll('[data-cg-go]').forEach((b) => b.classList.toggle('on', Number(b.dataset.cgGo) === cur));
    const prev = root.querySelector('[data-cg-prev]'), next = root.querySelector('[data-cg-next]');
    if (prev) prev.disabled = cur === 0;
    if (next) next.hidden = cur === steps.length - 1;
    // 2026-09-30 Jacky：切到哪一步，上面的話術對照就自動跳到那一步的話術（我的最愛照樣在最上面）
    const CAT = { 1: 'gate', 2: 'open', 3: 'ask', 4: 'object', 5: 'close' };
    const box = document.querySelector('.sc-quick .sc-wrap');
    if (box) {
      const want = CAT[cur] || '';
      const active = box.querySelector('[data-sc-cat].active');
      if ((active ? active.dataset.scCat : '') !== want) {
        if (want) box.querySelector(`[data-sc-cat="${want}"]`)?.click();
        else active?.click();
      }
      const sel = box.querySelector('.sc-cat-select'); if (sel) sel.value = want;
    }
  };
  root.querySelectorAll('[data-cg-go]').forEach((b) => b.addEventListener('click', () => go(Number(b.dataset.cgGo))));
  root.querySelector('[data-cg-prev]')?.addEventListener('click', () => go(cur - 1));
  root.querySelector('[data-cg-next]')?.addEventListener('click', () => go(cur + 1));
  root.querySelectorAll('input[name="cg-type"]').forEach((r) => r.addEventListener('change', () => {
    root.querySelectorAll('[data-when]').forEach((el) => { el.hidden = el.dataset.when !== r.value; });
  }));
  // 新手／高手打法切換（兩者共用過總機、拒絕、收尾；功課、開場、問需求各有一版）
  root.querySelectorAll('[data-cg-mode]').forEach((b) => b.addEventListener('click', () => {
    const m = b.dataset.cgMode;
    root.querySelectorAll('[data-cg-mode]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
    root.querySelectorAll('[data-mode]').forEach((el) => { el.hidden = el.dataset.mode !== m; });
  }));
  // 高手打法：選哪個理由就顯示哪一段開場，填的字即時帶進開場白
  const syncPro = () => {
    const a = root.querySelector('input[name="cg-angle"]:checked')?.value || 'trigger';
    root.querySelectorAll('[data-cg-pro]').forEach((el) => { el.hidden = el.dataset.cgPro !== a; });
  };
  root.querySelectorAll('input[name="cg-angle"]').forEach((r) => r.addEventListener('change', syncPro));
  root.querySelectorAll('[data-cg-fill]').forEach((inp) => inp.addEventListener('input', () => {
    const k = inp.dataset.cgFill;
    root.querySelectorAll(`.cg-fill[data-fill="${k}"]`).forEach((el) => { el.textContent = inp.value.trim() || el.dataset.ph || el.textContent; });
    const radio = inp.closest('.cg-angle')?.querySelector('input[type=radio]');
    if (radio && inp.value.trim()) { radio.checked = true; syncPro(); }
  }));
  root.querySelectorAll('.cg-fill').forEach((el) => { el.dataset.ph = el.textContent; });
  // 有新消息或人選可以帶的，打開就停在高手打法（2026-09-30 Jacky）
  if (root.dataset.defaultMode === 'pro') root.querySelector('[data-cg-mode="pro"]')?.click();
  // 自動帶入的內容先套進開場白（不用顧問自己打）
  root.querySelectorAll('[data-cg-fill]').forEach((inp) => {
    if (!inp.value.trim()) return;
    root.querySelectorAll(`.cg-fill[data-fill="${inp.dataset.cgFill}"]`).forEach((el) => { el.textContent = inp.value.trim(); });
  });
  syncPro();
  let result = '';
  const form = root.querySelector('.cg-form');
  root.querySelectorAll('[data-cg-result]').forEach((b) => b.addEventListener('click', () => {
    result = b.dataset.cgResult;
    root.querySelectorAll('[data-cg-result]').forEach((x) => x.classList.toggle('primary', x === b));
    if (form) form.querySelector('textarea[name=note]')?.focus();
  }));
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = root.dataset.bdId;
    if (!id || !result) { toast('先點上面的結果', 'error'); return; }
    const fd = new FormData(form);
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const trBox = root.querySelector('[data-cg-transcript]');
      const transcript = (trBox?.value || '').trim();
      const r = await api.post(`/admin/bd/${encodeURIComponent(id)}/call-result`,
        { result, caller: fd.get('caller') || '', contact_name: fd.get('contact_name') || '', email: fd.get('email') || '', note: fd.get('note') || '', transcript });
      toast((r && r.retry_at ? `已記錄，${String(r.retry_at).slice(5, 10)} 會提醒再打` : '已記錄') + (r && r.transcript_id ? '；逐字稿 AI 分析中' : ''), 'success');
      form.reset(); result = ''; root.querySelectorAll('[data-cg-result]').forEach((x) => x.classList.remove('primary'));
      if (r && r.transcript_id && trBox) trBox.value = '';
    } catch (err) { toast(err.message || '記錄失敗', 'error'); }
    btn.disabled = false;
  });
  // 2026-09-30：只上傳逐字稿讓 AI 看（不記錄電話結果）
  root.querySelector('[data-cg-tr-only]')?.addEventListener('click', async (e) => {
    const btn2 = e.currentTarget;
    const trBox = root.querySelector('[data-cg-transcript]');
    const transcript = (trBox?.value || '').trim();
    if (!transcript) { toast('先貼逐字稿或上傳 .md／.txt 檔', 'error'); return; }
    const company = root.closest('[data-bd-company]')?.dataset.bdCompany || state.openBdCompany || '';
    const note = form ? String(new FormData(form).get('note') || '') : '';
    btn2.disabled = true;
    try {
      await api.post('/admin/bd/transcript', { outreach_id: root.dataset.bdId || '', company, transcript, note });
      toast('已送出，AI 約 1～3 分鐘後看完，會出現在「通話心得」', 'success');
      if (trBox) trBox.value = '';
    } catch (err) { toast(err.message || '送出失敗', 'error'); }
    btn2.disabled = false;
  });
  go(0);
  wireContractPack(root);
}

// 2026-09-30：開發引導第 5 步「寄公司介紹＋合約」——上傳合約、預覽、擬信送 TG（Jacky 核准才寄）
function wireContractPack(scope) {
  const box = scope.querySelector('.cg-pack');
  if (!box) return;
  const company = box.dataset.packCompany;
  const out = box.querySelector('[data-pack-out]');
  const fileIn = box.querySelector('[data-pack-file]');
  const scSel = box.querySelector('[data-pack-scenario]');
  const anSel = box.querySelector('[data-pack-angle]');
  const briefWrap = box.querySelector('[data-pack-brief-wrap]');
  const subjIn = box.querySelector('[data-pack-subj]');
  const bodyIn = box.querySelector('[data-pack-body]');
  let orig = null; // 上一次系統擬的主旨／內文；顧問改過才送 override
  const opts = () => {
    const sel = box.querySelector('[data-pack-contract]');
    const o = {
      scenario: scSel?.value || 'followup',
      style: box.querySelector('[data-pack-style]')?.value || 'short',
      angle: anSel?.value || '',
      attach_intro: !!box.querySelector('[data-pack-intro]')?.checked,
      candidate_brief: box.querySelector('[data-pack-brief]')?.value || '',
      ...(box.querySelector('[data-pack-to]')?.value.trim() ? { to_override: box.querySelector('[data-pack-to]').value.trim() } : {}),
      resume_ids: [...box.querySelectorAll('[data-pack-cv]:checked')].map((x) => x.value),
      anon_app_ids: [...box.querySelectorAll('[data-pack-anon]:checked')].map((x) => x.value),
      ...(sel && sel.value ? { contract_id: sel.value } : { no_contract: true }),
    };
    if (orig && !out.hidden) {
      if (subjIn.value.trim() !== orig.subject) o.subject_override = subjIn.value;
      if (bodyIn.value.trim() !== orig.body) o.body_override = bodyIn.value;
    }
    return o;
  };
  const syncBrief = () => { if (briefWrap) briefWrap.hidden = scSel?.value !== 'candidate'; };
  syncBrief();
  fileIn?.addEventListener('change', async () => {
    const f = fileIn.files && fileIn.files[0];
    if (!f) return;
    if (!/\.(pdf|docx)$/i.test(f.name)) { toast('附件只收 PDF 或 DOCX', 'error'); fileIn.value = ''; return; }
    if (f.size > 8 * 1024 * 1024) { toast('檔案超過 8MB', 'error'); fileIn.value = ''; return; }
    fileIn.disabled = true;
    try {
      const b64 = await new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = bad; r.readAsDataURL(f); });
      await api.post('/admin/bd/contract-file', { company, file_b64: b64, file_name: f.name, file_mime: f.type, contract_type: box.querySelector('[data-pack-ctype]')?.value || '', by: box.dataset.packBy || '' });
      toast(box.querySelector('[data-pack-ctype]')?.value === '匿名履歷' ? '匿名履歷已上傳，已幫你勾成附件' : '合約已上傳', 'success');
      openBdDetail(company, state.bdMailMode ? 'mail' : undefined);
    } catch (err) { toast(err.message || '上傳失敗', 'error'); }
    fileIn.disabled = false;
  });
  const preview = async (btn) => {
    if (btn) btn.disabled = true;
    try {
      const o = opts(); delete o.subject_override; delete o.body_override;
      const r = await api.post('/admin/bd/contract-pack', { company, dry_run: true, by: box.dataset.packBy || '', ...o });
      const d = r.draft || {};
      orig = { subject: String(d.subject || '').trim(), body: String(d.body || '').trim() };
      out.hidden = false;
      box.querySelector('[data-pack-meta]').textContent = `收件：${d.to || ''}｜附件：${(d.attachments || []).map((a) => a.filename).join('、') || '沒有附件'}`;
      subjIn.value = d.subject || '';
      bodyIn.value = d.body || '';
    } catch (err) { toast(err.message || '擬信失敗', 'error'); }
    if (btn) btn.disabled = false;
  };
  // 換情境／切角／附件：預覽開著就重擬（改過的字會被換掉，先提醒）
  const onChange = () => {
    syncBrief();
    if (out.hidden) return;
    const edited = orig && (subjIn.value.trim() !== orig.subject || bodyIn.value.trim() !== orig.body);
    if (edited) toast('換了選項，信件重新擬過（剛剛改的字沒有保留）', 'info');
    preview(null);
  };
  [scSel, anSel, box.querySelector('[data-pack-style]'), box.querySelector('[data-pack-intro]'), box.querySelector('[data-pack-contract]'), ...box.querySelectorAll('[data-pack-cv]')].forEach((el) => el?.addEventListener('change', onChange));
  box.querySelector('[data-pack-brief]')?.addEventListener('change', () => { if (!out.hidden) onChange(); });
  box.querySelector('[data-pack-preview]')?.addEventListener('click', (e) => preview(e.currentTarget));
  // 2026-10-06：從人選庫挑匿名履歷（姓名／負責顧問／配對過的職缺）
  const anonBox = box.querySelector('[data-pack-anon-box]');
  if (anonBox) {
    const ownerSel = anonBox.querySelector('[data-anon-owner]');
    const jobSel = anonBox.querySelector('[data-anon-job]');
    const resBox = anonBox.querySelector('[data-anon-results]');
    anonBox.addEventListener('toggle', async () => {
      if (!anonBox.open || anonBox.dataset.loaded) return;
      anonBox.dataset.loaded = '1';
      try {
        const cons = (await ensureConsultants()).filter((c) => c.is_active);
        ownerSel.insertAdjacentHTML('beforeend', cons.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.display_name)}</option>`).join(''));
        const jobs = await api.get('/admin/jobs');
        const list = (jobs.jobs || jobs.items || []).filter((j) => (j.status || 'open') !== 'closed');
        jobSel.insertAdjacentHTML('beforeend', list.map((j) => `<option value="${escapeHtml(j.slug)}">${escapeHtml(j.title || j.slug)}</option>`).join(''));
      } catch (err) { console.error(err); }
    });
    anonBox.querySelector('[data-anon-search]')?.addEventListener('click', async () => {
      resBox.innerHTML = '<small class="muted">找尋中…</small>';
      try {
        const qs = new URLSearchParams({ q: anonBox.querySelector('[data-anon-q]').value.trim(), owner: ownerSel.value, job: jobSel.value });
        const r = await api.get(`/admin/anon-reports?${qs}`);
        const rows = r.rows || [];
        resBox.innerHTML = rows.length
          ? rows.map((x) => `<label><input type="checkbox" data-pack-anon value="${escapeHtml(x.application_id)}"> <b>${escapeHtml(x.code)}</b>（${escapeHtml(x.name || '')}・${escapeHtml(x.job_title || '')}${x.owner_name ? '・' + escapeHtml(x.owner_name) : ''}）<small>${escapeHtml(String(x.updated_at || '').slice(5, 16))}</small></label>`).join('')
          : '<small class="muted">找不到已做好的匿名履歷。先到人選卡片按「製作匿名履歷」，在 TG 確認後就會出現在這裡。</small>';
        // 一封信最多 5 位人選（上傳的匿名履歷＋從人選挑的合計），超過就不讓勾
        resBox.querySelectorAll('[data-pack-anon]').forEach((el) => el.addEventListener('change', () => {
          const n = box.querySelectorAll('[data-pack-anon]:checked, [data-pack-cv]:checked').length;
          if (n > 5) { el.checked = false; toast('一封信最多附 5 位人選的履歷', 'error'); }
        }));
      } catch (err) { resBox.innerHTML = `<small class="muted">找不到：${escapeHtml(err.message || '')}</small>`; }
    });
  }
  box.querySelector('[data-pack-send]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const r = await api.post('/admin/bd/contract-pack', { company, by: box.dataset.packBy || '', ...opts() });
      toast(r.tg_sent ? '已送到 TG，等 Jacky 或 Phoebe 按核准才會寄。順手在「跟進」排下一步' : '已存好，但 TG 沒送出去，請通知 Jacky', r.tg_sent ? 'success' : 'error');
      // 2026-10-02 Jacky：寄完要跳回客戶卡片的「跟進」，順手排下一步
      await openBdDetail(company);
      document.querySelector('.bd-status-card')?.scrollIntoView({ block: 'start' });
    } catch (err) { toast(err.message || '擬信失敗', 'error'); }
    btn.disabled = false;
  });
}

// 2026-09-30 Jacky：移到備選池／拉回來（開發進度列表、客戶跟進、卡片共用）
// 2026-10-01 Jacky：從網頁／PDF／LINE 複製信箱會夾帶看不見的空白（不斷行空白、零寬字元），
// 瀏覽器就擋「@ 後面不應包含空白」，人眼看不出哪裡錯。所有 Email 欄位輸入／貼上時自動清掉。
const INVISIBLE_SPACES = /[\s\u00a0\u200b-\u200d\u2060\ufeff\u3000]/g;
document.addEventListener('input', (event) => {
  const el = event.target;
  if (!(el instanceof HTMLInputElement) || el.type !== 'email') return;
  const cleaned = el.value.replace(INVISIBLE_SPACES, '');
  if (cleaned !== el.value) el.value = cleaned;
}, true);

document.addEventListener('click', async (event) => {
  const btn = event.target instanceof Element ? event.target.closest('[data-park]') : null;
  if (!btn) return;
  const company = btn.dataset.park;
  const on = btn.dataset.parkOn === '1';
  let reason = '';
  if (on) {
    reason = window.prompt(`「${company}」移到備選池：以後開發進度、客戶跟進、日報都不會再出現（篩選「備選池」看得到，可以拉回來）。\n原因（可以不填）：`, '');
    if (reason === null) return;
  }
  btn.disabled = true;
  try {
    await api.post('/admin/bd/park', { company, parked: on, reason, by: btn.dataset.parkBy || '' });
    toast(on ? '已移到備選池' : '已拉回來', 'success');
    if (btn.closest('.drawer, [role="dialog"]')) openBdDetail(company); else loadRoute();
  } catch (err) { toast(err.message || '操作失敗', 'error'); btn.disabled = false; }
});

// 2026-09-30 Jacky：跟進便利貼（卡片最上面／客戶跟進分頁共用）
function followPayload(root, prefix) {
  return {
    next_action: root.querySelector(`[data-${prefix}-action]`).value,
    next_due: root.querySelector(`[data-${prefix}-due]`).value,
    next_step: root.querySelector(`[data-${prefix}-memo]`).value,
    adjust_note: '', // 舊的「要調整的地方」已經併進備註
  };
}
function wireDueQuick(root, prefix, onSet) {
  for (const b of root.querySelectorAll('[data-due-quick]')) {
    b.onclick = () => {
      const d = new Date(Date.now() + 8 * 3600000);
      const k = b.dataset.dueQuick;
      if (k === 'mon') d.setUTCDate(d.getUTCDate() + (((8 - d.getUTCDay()) % 7) || 7));
      else d.setUTCDate(d.getUTCDate() + Number(k));
      root.querySelector(`[data-${prefix}-due]`).value = d.toISOString().slice(0, 10);
      if (onSet) onSet();
    };
  }
}
// AI 建議：採用＝把建議填進欄位並存；不用＝標記略過
function wireAiSuggest(root, prefix, company, by, after) {
  const box = root.querySelector('[data-ai-box]');
  if (!box) return;
  const post = (extra) => api.post('/admin/bd/company-status', { company, ...followPayload(root, prefix), by, ...extra });
  box.querySelector('[data-ai-accept]').onclick = async () => {
    const a = box.dataset;
    if (a.aiAction) root.querySelector(`[data-${prefix}-action]`).value = a.aiAction;
    if (a.aiDue) root.querySelector(`[data-${prefix}-due]`).value = a.aiDue;
    const memo = root.querySelector(`[data-${prefix}-memo]`);
    if (a.aiMemo && !memo.value.includes(a.aiMemo)) memo.value = memo.value.trim() ? `${memo.value.trim()}\n${a.aiMemo}` : a.aiMemo;
    try { await post({ ai_state: 'accepted' }); box.remove(); toast('已採用 AI 建議', 'success'); if (after) after(); } catch (err) { toast(err.message || '儲存失敗', 'error'); }
  };
  box.querySelector('[data-ai-dismiss]').onclick = async () => {
    try { await post({ ai_state: 'dismissed' }); box.remove(); toast('已略過這次 AI 建議', 'success'); } catch (err) { toast(err.message || '儲存失敗', 'error'); }
  };
}
function wireCompanyStatus(root) {
  const box = root.querySelector('.bd-status-card');
  if (!box) return;
  wireDueQuick(box, 'status');
  wireAiSuggest(box, 'status', box.dataset.statusCompany, document.querySelector('.cg-pack')?.dataset.packBy || '');
  box.querySelector('[data-status-save]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const r = await api.post('/admin/bd/company-status', {
        company: box.dataset.statusCompany, ...followPayload(box, 'status'),
        by: document.querySelector('.cg-pack')?.dataset.packBy || '',
      });
      box.querySelector('[data-status-at]').textContent = `已儲存 ${String(r.updated_at || '').slice(5, 16)}`;
      toast('已儲存', 'success');
    } catch (err) { toast(err.message || '儲存失敗', 'error'); }
    btn.disabled = false;
  });
}

// 2026-09-30 Jacky：客戶跟進分頁（原「收尾」）
function wireWrapup(root) {
  const list = root.querySelector('.wu-list');
  if (!list) return;
  const rows = () => [...list.querySelectorAll('.wu-row')];
  const bar = root.querySelector('.wu-bar');
  const outAll = root.querySelector('#wu-batch-out');
  const itemOf = (row) => {
    const c = row.querySelector('[data-wu-contract]');
    return {
      company: row.dataset.wuCompany,
      scenario: row.querySelector('[data-wu-scenario]').value,
      style: row.querySelector('[data-wu-style]')?.value || 'short',
      angle: row.querySelector('[data-wu-angle]').value,
      attach_intro: row.querySelector('[data-wu-intro]').checked,
      candidate_brief: row.querySelector('[data-wu-brief]').value,
      ...(c && c.value ? { contract_id: c.value } : { no_contract: true }),
    };
  };
  const picked = () => rows().filter((r) => !r.hidden && !r.querySelector('.wu-mail').hidden && r.querySelector('[data-wu-pick]').checked);
  const sync = () => {
    const n = picked().length;
    bar.querySelector('[data-wu-picked]').textContent = `要寄的信：已勾 ${n} 家${n > 12 ? '（一次最多 12 封）' : ''}`;
    bar.querySelectorAll('button').forEach((b) => { b.disabled = !n || n > 12; });
    const shown = rows().filter((r) => !r.hidden).length;
    const cnt = root.querySelector('#wu-count');
    if (cnt) cnt.textContent = `顯示 ${shown} 家`;
  };
  const who = root.querySelector('#wu-assignee');
  const show = root.querySelector('#wu-show');
  const applyFilter = () => {
    rows().forEach((r) => {
      const parked = r.dataset.wuParked === '1';
      r.hidden = (!!who.value && r.dataset.wuAssignee !== who.value)
        || (show.value === 'parked' ? !parked : parked)
        || (show.value === 'need' && r.dataset.wuNeeds !== '1');
      if (r.hidden) r.querySelector('[data-wu-pick]').checked = false;
    });
    sync();
  };
  who.onchange = applyFilter;
  show.onchange = applyFilter;
  for (const row of rows()) {
    row.querySelector('[data-wu-pick]').onchange = sync;
    const sc = row.querySelector('[data-wu-scenario]');
    const syncBrief = () => { row.querySelector('.wu-brief').hidden = sc.value !== 'candidate'; };
    sc.addEventListener('change', syncBrief);
    syncBrief();
    // 下一步／日期／備註：改了就自動存；下一步選「寄信」才打開寄信設定
    const saved = row.querySelector('[data-wu-saved]');
    let memoTimer = null;
    const save = async () => {
      try {
        await api.post('/admin/bd/company-status', { company: row.dataset.wuCompany, ...followPayload(row, 'wu'), by: row.dataset.wuAssignee || '' });
        const t = new Date(Date.now() + 8 * 3600000).toISOString().slice(11, 16);
        saved.textContent = `✓ 已儲存 ${t}`;
        return true;
      } catch (err) { saved.textContent = ''; toast(err.message || '儲存失敗', 'error'); }
    };
    for (const inp of row.querySelectorAll('[data-wu-action],[data-wu-due],[data-wu-memo]')) inp.addEventListener('change', save);
    row.querySelector('[data-wu-save]').onclick = async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      clearTimeout(memoTimer);
      if (await save()) toast('已儲存', 'success');
      b.disabled = false;
    };
    // 備註邊打邊存（停手 1 秒就存），不用等游標離開
    row.querySelector('[data-wu-memo]').addEventListener('input', () => {
      saved.textContent = '輸入中…';
      clearTimeout(memoTimer);
      memoTimer = setTimeout(save, 1000);
    });
    wireDueQuick(row, 'wu', save);
    wireAiSuggest(row, 'wu', row.dataset.wuCompany, row.dataset.wuAssignee || '', () => {
      row.querySelector('.wu-mail').hidden = row.querySelector('[data-wu-action]').value !== 'mail';
      saved.textContent = '✓ 已採用 AI 建議';
    });
    const mail = row.querySelector('.wu-mail');
    row.querySelector('[data-wu-action]').addEventListener('change', (e) => {
      mail.hidden = e.target.value !== 'mail';
      if (mail.hidden) { row.querySelector('[data-wu-pick]').checked = false; sync(); }
    });
    row.querySelector('[data-wu-preview]').onclick = async (e) => {
      const btn = e.currentTarget; const out = row.querySelector('[data-wu-out]');
      btn.disabled = true;
      try {
        const r = await api.post('/admin/bd/contract-pack', { ...itemOf(row), dry_run: true });
        const d = r.draft || {};
        out.hidden = false;
        out.textContent = `收件：${d.to || ''}\n附件：${(d.attachments || []).map((a) => a.filename).join('、') || '沒有附件'}\n主旨：${d.subject || ''}\n\n${d.body || ''}`;
      } catch (err) { toast(err.message || '擬信失敗', 'error'); }
      btn.disabled = false;
    };
  }
  const batch = async (dry, btn) => {
    const items = picked().map(itemOf);
    if (!items.length) return;
    if (!dry && !window.confirm(`確定把 ${items.length} 封信送到 TG，等 Jacky／Phoebe 核准？（按了還不會寄出）`)) return;
    btn.disabled = true;
    try {
      const r = await api.post('/admin/bd/contract-pack-batch', { items, dry_run: dry, by: root.querySelector('#wu-assignee')?.value || '' });
      const sk = (r.skipped || []).map((x) => `<li>${text(x.company)}：${text(x.error)}</li>`).join('');
      if (dry) {
        outAll.innerHTML = `<div class="card"><h3 style="font-size:14px;margin:0 0 8px">預覽 ${text((r.drafts || []).length)} 封</h3>${sk ? `<div class="notice">這幾家擬不了：<ul>${sk}</ul></div>` : ''}${(r.drafts || []).map((d) => `<details class="bd-letter"><summary>${text(d.company)}｜${text(d.scenario_label)}${d.angle_label ? '｜' + text(d.angle_label) : ''}</summary><pre class="bd-letter-body">${text(`收件：${d.to}\n附件：${(d.attachments || []).map((a) => a.filename).join('、') || '沒有附件'}\n主旨：${d.subject}\n\n${d.body}`)}</pre></details>`).join('')}</div>`;
        outAll.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        toast(r.tg_sent ? `${r.count} 封已送到 TG，等 Jacky 按「全部核准」` : '已存好，但 TG 沒送出去，請通知 Jacky', r.tg_sent ? 'success' : 'error');
        if (sk) outAll.innerHTML = `<div class="notice">這幾家沒有擬信：<ul>${sk}</ul></div>`;
        loadRoute();
      }
    } catch (err) { toast(err.message || '擬信失敗', 'error'); }
    btn.disabled = false;
  };
  bar.querySelector('[data-wu-batch-preview]').onclick = (e) => batch(true, e.currentTarget);
  bar.querySelector('[data-wu-batch-send]').onclick = (e) => batch(false, e.currentTarget);
  applyFilter();
}

// 2026-09-30：逐字稿檔（.md／.txt）讀成文字放進同一個表單的逐字稿欄位
document.addEventListener('change', (event) => {
  const inp = event.target instanceof HTMLInputElement ? event.target : null;
  if (!inp || inp.type !== 'file' || !(inp.matches('[data-transcript-file]') || inp.name === 'transcript_file')) return;
  const file = inp.files?.[0];
  if (!file) return;
  if (!/\.(md|txt|markdown)$/i.test(file.name) && !/^text\//.test(file.type)) { toast('只收 .md 或 .txt 檔', 'error'); inp.value = ''; return; }
  if (file.size > 2 * 1024 * 1024) { toast('檔案太大（上限 2MB）', 'error'); inp.value = ''; return; }
  const scope = inp.closest('form, .cg-tr, .cg') || document;
  const box = scope.querySelector('[data-cg-transcript], textarea[name="transcript"]');
  const reader = new FileReader();
  reader.onload = () => { if (box) { box.value = String(reader.result || ''); toast(`已讀入「${file.name}」`, 'success'); } };
  reader.onerror = () => toast('檔案讀取失敗', 'error');
  reader.readAsText(file, 'utf-8');
});

async function loadSystemTab(target) {
  if (state.sub === 'kpi') return boundary(target, async () => (await adapters.system()).kpi, views.systemKpiTab, 'refresh');
  if (state.sub === 'settings') return boundary(target, async () => { const s = await adapters.system(); return { consultants: s.consultants, settings: s.settings }; }, views.systemSettingsTab, 'refresh');
  if (state.sub === 'token') return boundary(target, adapters.tokenUsage, views.systemTokenTab, 'refresh');
  if (state.sub === 'spec') return boundary(target, async () => null, views.systemSpecTab, 'refresh');
  if (state.sub === 'health') return boundary(target, adapters.featureUsage, views.systemHealthTab, 'refresh');
  if (state.sub === 'codes') {
    const res = await boundary(target, async () => { const [c, j] = await Promise.all([api.get('/admin/job-codes'), api.get('/admin/jobs')]); window.__JOB_CODES = c.codes || window.__JOB_CODES; return { codes: c.codes, clients: c.clients, jobs: j.jobs || j.items || [] }; }, views.systemCodesTab, 'refresh');
    const q = $('#codes-q');
    if (q) q.oninput = () => {
      const k = q.value.trim().toLowerCase();
      document.querySelectorAll('[data-codes-row]').forEach((r) => { r.hidden = !!k && !r.getAttribute('data-q').includes(k); });
      document.querySelectorAll('[data-codes-block]').forEach((b) => { b.hidden = ![...b.querySelectorAll('[data-codes-row]')].some((r) => !r.hidden); });
    };
    return res;
  }
  if (state.sub === 'line') {
    const res = await boundary(target, async () => { const s = await adapters.system(); return { overdue: s.line, bindings: s.bindings }; }, views.systemLineTab, 'refresh');
    wireBindFilter();
    return res;
  }
  return boundary(target, adapters.system, views.systemData, 'refresh');
}

function genericRows(items) {
  if (!items.length) return '<div class="state"><strong>目前沒有資料</strong><p>此清單已成功連線，但沒有符合項目。</p></div>';
  return `<div class="list">${items.map((item) => `<article class="list-row"><span><b>${text(item.name || item.title || item.candidate_name || item.job_title || item.id)}</b><small>${text(item.status || item.owner || item.created_at)}</small></span></article>`).join('')}</div>`;
}

function openTokenModal(subtitle = '') {
  modal({ title: 'Production API 登入', subtitle, body: views.tokenModal(), footer: '<button class="btn primary" data-action="save-token">儲存並連線</button>' });
}

// 2026-09-15 查證更正：這個抽屜原本三處都在讀不存在的欄位，永遠是空的——
// application.next_action/next_step 從沒存在過（applications 表沒有這兩欄）；
// card.ai_summary/summary 也不存在；「最近歷程」讀 card.activities/stage_events，
// 但 /admin/application/:id/card 真正回傳的頂層欄位叫 timeline（已經是後端合併
// 好的顧問備註＋阿財面談＋推薦紀錄＋客戶婉拒時間軸），三個位置全部對錯欄位名。
// 這次順便把 applications 表裡真的存在、但這張卡從沒顯示過的基本資料
// （聯絡方式／期望薪資／可上班日／履歷／DISC／來源／顧問備註清單）補上——
// 操作按鈕維持原樣不動，使用者要求都要留著。
// 舊版 hasContact()／isPlaceholderEmail() 一字不差搬過來——沒填 email/電話時
// 後端會塞一個佔位 email（xxx@no-email.step1ne.local，不是真的信箱，只是拿來
// 當資料庫識別鍵用），不能把它當成真的聯絡方式顯示或判斷「有沒有填」。
function isPlaceholderEmail(email) { return !!(email && /@no-email\.step1ne\.local$/i.test(String(email).trim())); }
function hasContact(a) { return !!((a.phone && a.phone.trim()) || (a.email && !isPlaceholderEmail(a.email))); }

// 服務心得連結（2026-10-01 Jacky：「網址後面那一串不可能自己打，人選卡片要能直接產生」）。
// 帶好顧問、面試職缺、人選稱呼；階段是錄取／到職的，錄取職缺也先填成同一個。
// ref＝應徵單 id，收到的心得就知道是哪一張應徵單。
// 2026-10-27 Jacky：人選卡片「總覽」的基本資料區——
// ① 期望薪資／可上班日／來源／LINE／DISC 排成小格子；LINE 沒綁時給「複製綁定說明」貼給人選
// ② 按鈕分三組：聯絡人選（寄信約電話＝主按鈕、回信確認時間、給人選連結）／其他（更多動作下拉）／結案（寄婉拒信，最右、淡色）
// ③ DISC 格子點了才展開分數＋測驗連結（原本「風格測驗」單獨一大格）
// 按鈕的 data-* 屬性跟原本 reviewLinkRow 一樣，沿用既有的全站點擊處理，不另寫一套。
const LINE_BIND_HOWTO = '加入全民獵才 LINE 官方帳號（https://lin.ee/XcSWPzM），點下方選單「追蹤面試進度」填一下表單，之後面試進度就會直接用 LINE 通知你。';
function candBasicsBlock(app, applicationId, { channelTag, lineHtml, lineBound, disc, styleHtml, lineId = '' }) {
  const e = escapeHtml;
  const mail = String(app.email || '').trim();
  const hasMail = !!mail && !isPlaceholderEmail(mail);
  const nm = e(app.name || '');
  const qs = new URLSearchParams();
  if (app.owner) qs.set('c', app.owner);
  const job = app.job_title && app.job_slug !== 'unspecified' ? app.job_title : '';
  if (job) qs.set('j', job);
  if (job && /錄取|到職|offer|onboard|hired/i.test(String(app.manual_stage || ''))) qs.set('o', job);
  if (app.name) qs.set('n', app.name);
  qs.set('ref', applicationId);
  const reviewUrl = `https://step1ne.com/review/?${qs.toString()}`;
  const cell = (lb, val, extra = '') => `<div class="cf-cell"><span>${lb}</span><b>${val}</b>${extra}</div>`;
  const discCell = `<div class="cf-cell"><span>DISC</span><button type="button" class="cf-link" data-cf-disc aria-expanded="false">${app.disc_primary ? `主型 ${text(app.disc_primary)}` : '還沒測'}<small>${app.disc_primary ? '看詳情' : '產生測驗連結'}</small></button></div>`;
  const lineCell = cell('LINE', lineBound ? lineHtml : (lineHtml.includes('需重新綁定') ? '<span class="badge warning">需重新綁定</span>' : '<span class="muted">未綁定</span>'),
    (lineBound ? '' : `<button type="button" class="cf-link" data-copy-text="${e(LINE_BIND_HOWTO)}"><small>複製綁定說明</small></button>`)
    + `<small style="display:block;margin-top:4px">ID：${lineId ? text(lineId) : '<span class="muted">未填</span>'}</small>`
    + actionBtn(lineId ? '修改 ID' : '輸入 ID', 'cand-line-id', { idParams: { application_id: applicationId }, record: { line_id: lineId } }));
  const facts = `<div class="cand-facts">${cell('期望薪資', text(app.expected_salary || '—'))}${cell('可上班日', text(app.available_date || '—'))}${cell('來源', channelTag + (app.resume_source ? `<small class="muted">履歷：${text(app.resume_source)}</small>` : ''))}${lineCell}${discCell}</div>
    <div class="cf-disc-detail" data-cf-disc-detail hidden><p class="help" style="margin:0 0 6px">分數：${disc}</p>${styleHtml}</div>`;
  const ruMenu = resumeLinkButtons({ appId: applicationId, email: hasMail ? mail : '', name: app.name || '', jobSlug: app.job_slug || '', jobTitle: app.job_title || '' });
  const contact = `<div class="ag"><small>聯絡人選</small><div class="ag-btns">${hasMail
      ? `<button type="button" class="btn sm primary" data-call-mail="${e(applicationId)}" data-call-mail-name="${nm}">寄信約電話</button><button type="button" class="btn sm" data-call-confirm="${e(applicationId)}" data-call-mail-name="${nm}" title="人選回信給了時段，回一封「那就約這個時間」">回信確認電話時間</button>`
      : '<span class="help">沒有 Email，用電話或 LINE 聯絡</span>'}
    ${ruMenu}</div></div>`;
  const more = `<div class="ag"><small>其他</small><div class="ag-btns"><details class="cand-dd"><summary class="btn sm">更多動作 ▾</summary><div class="cand-dd-menu">
      ${actionBtn('編輯應徵單', 'application-update', { idParams: { application_id: applicationId }, record: app })}
      <button type="button" class="btn sm" data-cand-bd="${e(applicationId)}" title="AI 找可能需要這種人的公司，放進「人選敲門名單」，顧問篩過才進開發進度">🧲 拿這位人選去開發客戶</button>
      <button type="button" class="btn sm" data-copy-text="${e(reviewUrl)}" title="複製後直接貼給人選，顧問、職缺都幫他填好了">複製服務心得連結</button>
    </div></details></div></div>`;
  const close = hasMail ? `<div class="ag ag-end"><small>結案</small><div class="ag-btns"><button type="button" class="btn sm cf-quiet" data-decline-mail="${e(applicationId)}" data-call-mail-name="${nm}" title="先看信、可以改，按確認才寄">寄婉拒信</button></div></div>` : '';
  return `${facts}<div class="cand-actgroups">${contact}${more}${close}</div>`;
}
// 下拉選單：點選單外面就收起來；選單裡按了按鈕也收起來
document.addEventListener('click', (ev) => {
  const t = ev.target instanceof Element ? ev.target : null;
  document.querySelectorAll('details.cand-dd[open]').forEach((d) => {
    if (!t || !d.contains(t) || (t.closest('.cand-dd-menu') && t.closest('button'))) d.open = false;
  });
  const discBtn = t && t.closest('[data-cf-disc]');
  if (discBtn) {
    const box = document.querySelector('#overlay-root [data-cf-disc-detail]');
    if (box) { box.hidden = !box.hidden; discBtn.setAttribute('aria-expanded', String(!box.hidden)); }
  }
});

function reviewLinkRow(app, applicationId) {
  const qs = new URLSearchParams();
  if (app.owner) qs.set('c', app.owner);
  const job = app.job_title && app.job_slug !== 'unspecified' ? app.job_title : '';
  if (job) qs.set('j', job);
  if (job && /錄取|到職|offer|onboard|hired/i.test(String(app.manual_stage || ''))) qs.set('o', job);
  if (app.name) qs.set('n', app.name);
  qs.set('ref', applicationId);
  const url = `https://step1ne.com/review/?${qs.toString()}`;
  const mail = String(app.email || '').trim();
  const candBdBtn = `<button type="button" class="btn sm" data-cand-bd="${escapeHtml(applicationId)}" title="AI 找可能需要這種人的公司，放進「人選敲門名單」，顧問篩過才進開發進度">🧲 拿這位人選去開發客戶</button>`;
  const callMailBtn = mail && !isPlaceholderEmail(mail)
    ? `<button type="button" class="btn sm" data-call-mail="${escapeHtml(applicationId)}" data-call-mail-name="${escapeHtml(app.name || '')}">寄信約電話</button><button type="button" class="btn sm" data-call-confirm="${escapeHtml(applicationId)}" data-call-mail-name="${escapeHtml(app.name || '')}" title="人選回信給了時段，回一封「那就約這個時間」">回信確認電話時間</button><button type="button" class="btn sm" data-decline-mail="${escapeHtml(applicationId)}" data-call-mail-name="${escapeHtml(app.name || '')}" title="先看信、可以改，按確認才寄">寄婉拒信</button>` : '';
  return `<div class="actions-row" style="margin-top:8px">${callMailBtn}${candBdBtn}<button type="button" class="btn sm" data-copy-text="${escapeHtml(url)}">複製服務心得連結</button><span class="help" style="align-self:center">複製後直接貼給人選，顧問、職缺都幫他填好了</span></div>`
    // 2026-10-23 寄／複製「上傳履歷」連結（人選自己上傳履歷，不經阿財）
    + `<div class="actions-row" style="margin-top:6px">${resumeLinkButtons({ appId: applicationId, email: mail && !isPlaceholderEmail(mail) ? mail : '', name: app.name || '', jobSlug: app.job_slug || '', jobTitle: app.job_title || '' })}</div>`;
}

// 先選客戶 → 再選職缺（views.clientJobPicker）。全站共用一個監聽，哪個畫面用到都會動。
document.addEventListener('change', (e) => {
  const sel = e.target.closest && e.target.closest('.job-client-pick');
  if (!sel) return;
  const field = sel.closest('.field');
  const target = field && field.nextElementSibling && field.nextElementSibling.querySelector('select');
  if (!target) return;
  let map = {};
  try { map = JSON.parse(sel.dataset.jobs || '{}'); } catch { map = {}; }
  const list = map[sel.value] || [];
  target.innerHTML = sel.value
    ? `<option value="">請選擇職缺…</option>${list.map((j) => `<option value="${escapeHtml(j.slug)}">${escapeHtml(jobOptLabel(j))}</option>`).join('')}`
    : '<option value="">先選上面的客戶</option>';
  target.disabled = !sel.value;
  if (list.length === 1) target.value = list[0].slug;   // 只有一個職缺就直接選好
  target.dispatchEvent(new Event('change', { bubbles: true }));
});

// 2026-10-16 Jacky：人選卡片每次打開、每次設定完都要轉一圈載入。
// 改成：同一張卡片重新整理時不清空（停在原本捲動位置）；打開過的卡片先用上次的資料立刻顯示，背景再抓最新的換上。
const cardCache = new Map();
// 2026-10-27 Jacky：同一家客戶有三個「BIM 工程師(儲備培訓)」同名，推薦選單分不出哪個地區——職缺名稱後面補地點。
function jobOptLabel(j) {
  const s = String(j.slug || '');
  let loc = String(j.locations || j.location || '').replace(/[\[\]'"]/g, '').split(/[、,，;；\n（(]/)[0].trim();
  if (!loc) loc = /houli/.test(s) ? '台中后里' : /tongluo/.test(s) ? '苗栗銅鑼' : /hsinchu/.test(s) ? '新竹' : '';
  return loc ? `${j.title}｜${loc}` : j.title;
}

async function openCandidate(applicationId, opts = {}) {
  const sameOpen = state.openCandidateId === applicationId && !!document.querySelector('#overlay-root .drawer [data-cand-card]');
  state.openCandidateId = applicationId;
  const cached = cardCache.get(applicationId);
  const keepScroll = sameOpen ? (document.querySelector('#overlay-root .drawer') || {}).scrollTop || 0 : 0;
  if (sameOpen) document.querySelector('#overlay-root .drawer')?.classList.add('is-refreshing');
  else if (!cached) {
    // 2026-10-27 B 方案：打開先秀封面（姓名／職缺），不要整片空白等全部資料到齊
    const row = (state.candidateRows || []).find((r) => r.applicationId === applicationId);
    drawer({ title: row ? ((row.seqNo ? `#${row.seqNo} ` : '') + (row.name || '應徵單')) : '載入應徵單…', subtitle: row ? (row.job || '') : '', body: loading('人選資料載入中') });
  }
  // 顧問名單跟人選資料同時抓，不再一個等完才抓下一個
  const consListP = ensureConsultants().catch(() => []);
  try {
    // opts.patch：剛存完的小改動已經寫進快取，直接用快取重畫，不再重抓整張卡（/card 要 4～5 秒）
    const useCache = !!cached && (opts.patch || (!sameOpen && !opts.fresh));
    const card = useCache ? cached : await adapters.candidateCard(applicationId);
    if (state.openCandidateId !== applicationId) return;   // 等資料的時候已經換看別人了
    cardCache.set(applicationId, card);
    if (useCache && !opts.patch) setTimeout(() => { if (state.openCandidateId === applicationId) openCandidate(applicationId, { fresh: true }); }, 0);
    const application = card.application || card;
    const forwards = card.forwards || [];
    const notes = card.notes || [];
    const timeline = card.timeline || [];
    state.callHist = timeline.filter((t) => t.type === '電洽紀錄');
    const report = card.report || null;
    const dupNotice = card.dup_notice || null;
    const lineBinding = card.line_binding || null;
    const ctxId = { idParams: { application_id: applicationId } };
    // 逐客戶推進／不推進：/admin/pipeline/forward-decision 的真實語意是「顧問自己
    // 標記不推薦」，不是客戶決策（見 actions.js 的查證更正）——依目前狀態顯示
    // 對應那一顆按鈕，不是兩顆都show。
    // 2026-10-27 Jacky 選 B 方案（分頁資料夾）：「推薦客戶」分頁每家客戶一張小卡。
    // 原本一列最多疊 10 顆按鈕，「寄送表單」壓在最底下的小字裡找不到——改成三步
    // （推薦履歷 → 人事資料表 → 客戶回覆）看得到哪步還沒做，常用的放主按鈕，
    // 不常用的（標不推進／已放棄／傳訊息／改 LINE ID／不報到／取消推薦）收進「其他動作」。
    // 推薦人：後端 /card 的 forwards 沒有回 forwarded_by（查證 2026-10-27），所以舊版永遠顯示
    // 「未記錄」——這裡改顯示推薦日期，不再顯示一個必定是錯的欄位。
    const fwCards = forwards.length ? forwards.map((f) => {
      const companyId = f.company_id;
      const ids = { idParams: { application_id: applicationId, company_id: companyId } };
      const nr = f.advisor_not_recommended_at;
      const cfr = f.client_formal_report;
      const forms = f.forms || [];
      const cfrDone = !!(cfr && cfr.consultant_confirmed_at);
      const formsDone = forms.length > 0 && forms.every((x) => x.status === 'submitted');
      const formsNow = forms.some((x) => x.status !== 'submitted');
      const step = (lb, cls) => `<div class="fw-step ${cls}">${text(lb)}</div>`;
      const steps = `<div class="fw-steps">${step(cfrDone ? '推薦履歷 ✓' : '推薦履歷', cfrDone ? 'done' : 'now')}${step(!forms.length ? '人事資料表（未設定）' : formsDone ? '人事資料表 ✓' : '人事資料表', formsDone ? 'done' : (cfrDone && formsNow ? 'now' : ''))}${step('客戶：' + (f.stage_label || '等回覆'), f.client_rejected_at ? 'bad' : '')}</div>`;
      const cfrRow = `<div class="fw-row"><span><b>推薦履歷</b><small>${!cfr ? '還沒上傳，客戶看不到' : cfr.pdf_pending ? 'AI 產生中（1～2 分鐘）' : cfrDone ? `客戶看得到（${text(String(cfr.consultant_confirmed_at).slice(5, 16))} 上傳）` : '只有 AI 草稿，客戶還看不到'}</small></span>${rowActions([
        cfr && cfr.pdf_pending ? '' : actionBtn(cfr ? '重新製作 AI 草稿' : '製作 AI 草稿', 'client-formal-report', ids),
        cfr && !cfrDone && !cfr.pdf_pending && cfr.file_id ? `<button type="button" class="btn ghost sm" data-download-file="${text(cfr.file_id)}">下載 AI 草稿</button>` : '',
        actionBtn(cfrDone ? '換一份' : '上傳推薦履歷', 'client-formal-report-upload', ids, cfrDone ? '' : 'primary'),
        cfrDone && cfr.file_id ? `<button type="button" class="btn ghost sm" data-download-file="${text(cfr.file_id)}">下載</button>` : '',
      ].filter(Boolean))}</div>`;
      const formsRows = forms.length ? views.candidateFormsBlock(forms, applicationId, companyId)
        : '<div class="fw-row"><span><b>人事資料表</b><small>這個職缺還沒設定要人選填的表單（到職缺頁「客戶指定表單」設定後，這裡就會出現「寄送表單」）</small></span></div>';
      const warn = [
        nr ? `⚠ 標了不推進：${text(f.advisor_not_recommended_reason || '')}` : '',
        f.client_rejected_at ? `✕ 客戶婉拒：${text(f.client_reject_reason || '')}` : '',
        f.no_show_at ? `⚠ 不報到：${text(f.no_show_reason || '')}` : '',
        f.candidate_withdrawn_at ? `人選已放棄：${text(f.candidate_withdraw_reason || '')}` : '',
      ].filter(Boolean).map((w) => `<div class="fw-warn">${w}</div>`).join('');
      // 2026-10-27 Jacky：原本收在 <details>「其他動作」裡，沒展開看起來是空的——改成直接攤開。
      // 標不推進用醒目但非危險色；取消推薦（真的刪紀錄）單獨放最右、紅字。
      const more = [
        nr ? actionBtn('改回推進', 'pipeline-recommended-again', ids) : actionBtn('標不推進', 'pipeline-not-recommended', ids, 'warn'),
        f.candidate_withdrawn_at ? actionBtn('收回「已放棄」', 'pipeline-candidate-withdraw-undo', ids) : actionBtn('人選已放棄', 'pipeline-candidate-withdraw', ids),
        actionBtn('傳訊息給客戶', 'pipeline-message-client', ids),
        actionBtn('編輯客戶備註', 'forward-detail-update', { idParams: ids.idParams, record: { client_note: f.client_note || '' } }),
        f.onboard_date && !f.no_show_at ? actionBtn('標記不報到', 'placement-no-show', ids) : '',
      ].filter(Boolean);
      const meta = [`推薦於 ${text(String(f.forwarded_at || '').slice(0, 10) || '—')}`, f.client_note ? '客戶備註：' + text(f.client_note) : '', f.line_id_given ? 'LINE ID：' + text(f.line_id_given) : ''].filter(Boolean).join('　');
      return `<div class="fw-card cfr-drop" data-cfr-app="${escapeHtml(applicationId)}" data-cfr-co="${escapeHtml(companyId)}" data-cfr-name="${escapeHtml(f.company_name || '')}" data-cfr-has="${cfrDone ? '1' : ''}">
        <div class="fw-title"><b>${text(f.company_name)}</b><span>${text(f.job_title || f.job_slug)}</span></div>
        <small class="muted">${meta}</small>${warn}${steps}
        ${views.candidateBillingPendingBlock(f.billing_pending)}${cfrRow}${formsRows}
        <div class="fw-actions"><small>這家客戶這個職缺</small><div class="ag-btns">${more.join('')}<span class="fw-gap"></span>${actionBtn('取消推薦', 'pipeline-unforward-candidate', ids, 'danger')}</div></div>
        <small class="cfr-drop-hint">也可以直接把推薦履歷 PDF 拖進這張卡</small>
      </div>`;
    }).join('') : '<p class="muted">還沒推薦給任何客戶。</p>';
    const disc = [application.disc_d, application.disc_i, application.disc_s, application.disc_c].some((v) => v != null)
      ? `D${text(application.disc_d ?? '—')} I${text(application.disc_i ?? '—')} S${text(application.disc_s ?? '—')} C${text(application.disc_c ?? '—')}${application.disc_primary ? `（主型 ${text(application.disc_primary)}）` : ''}`
      : '尚未測驗';
    const resumeBtns = [];
    if (application.resume_file_id) resumeBtns.push(`<button type="button" class="btn ghost sm" data-download-resume="${escapeHtml(applicationId)}">看原始履歷</button>`);
    if (application.resume_file_id) resumeBtns.push(`<button type="button" class="btn ghost sm" data-resume-remove="${escapeHtml(application.resume_file_id)}" data-resume-app="${escapeHtml(applicationId)}">拿掉主要履歷</button>`);
    if (application.resume_url) resumeBtns.push(`<a class="btn ghost sm" href="${escapeHtml(application.resume_url)}" target="_blank" rel="noopener">履歷連結</a>`);
    let extraResumes = [];
    try { extraResumes = JSON.parse(application.resume_extra_files || '[]') || []; } catch { extraResumes = []; }
    extraResumes.forEach((x, i) => {
      resumeBtns.push(`<button type="button" class="btn ghost sm" data-download-file="${escapeHtml(x.file_id)}" title="${escapeHtml(x.filename || '')}">下載履歷 ${i + 2}${x.filename ? '：' + escapeHtml(String(x.filename).slice(0, 18)) : ''}</button>`);
      resumeBtns.push(`<button type="button" class="btn ghost sm" data-resume-remove="${escapeHtml(x.file_id)}" data-resume-app="${escapeHtml(applicationId)}" aria-label="拿掉履歷 ${i + 2}">拿掉履歷 ${i + 2}</button>`);
    });
    resumeBtns.push(actionBtn(application.resume_file_id ? '換一份履歷' : '上傳履歷 PDF', 'application-resume-upload', { idParams: { id: applicationId } }));
    if (application.resume_file_id && (1 + extraResumes.length) < 6) resumeBtns.push(actionBtn('再加一份履歷', 'application-resume-add', { idParams: { id: applicationId } }));
    if (application.resume_104_url) resumeBtns.push(`<a class="btn ghost sm" href="${escapeHtml(application.resume_104_url)}" target="_blank" rel="noopener">104 履歷</a>`);
    const contactBadge = hasContact(application) ? '' : '<span class="badge warning" style="margin-left:8px">⚠ 記得補聯絡方式</span>';
    // hard_gate 照抄後端 /admin/pipeline/tracker 的判準（a.status==='pending_screen' && !a.screen_decision）——
    // 這兩個欄位本來就在 applications 表裡、card 端點的 SELECT * 早就撈到了，純前端算。
    const hardGateBadge = application.status === 'pending_screen' && !application.screen_decision
      ? '<span class="badge warning" style="margin-left:8px">硬性條件審核</span>' : '';
    const dupNoticeHtml = dupNotice ? `<div class="notice" style="background:#fdf6e9;border-left:3px solid #d9a441">⚠ 疑似同一人：${text(dupNotice)}</div>` : '';
    // 2026-10-07：面談前阿財自動改談其他職缺（job_switch.py）。改談中且還沒開始面談 → 可以「取消改談」；
    // 面談後顯示系統判斷結果（談的是哪個、有沒有改回原職缺）。
    const js = card.job_switch || null;
    const jsNotStarted = (application.interview_state || 'not_started') === 'not_started';
    const jsStatus = js ? ({ active: jsNotStarted ? '改談中（還沒開始面談）' : '改談中（面談進行中，結束後系統會判斷要不要改回）', cancelled: `已取消改談${js.cancelled_by ? '（' + js.cancelled_by + '）' : ''}`, checking: '面談已結束，系統判斷中', kept: '人選同意改談，職缺維持新職缺', reverted: '人選談的是原職缺，已自動改回', unclear: '看不出談的是哪個職缺，請顧問確認' }[js.status] || js.status) : '';
    const jobSwitchHtml = js ? `<div class="notice" style="border-left:3px solid var(--accent,#2f6fdb)">🔁 <b>面談前改談</b>：原應徵〈${text(js.orig_job_title || js.orig_job_slug)}〉→ 改談〈${text(js.target_job_title || js.target_job_slug)}〉・${text(jsStatus)}${js.reason ? `<br><small class="muted">理由：${text(js.reason)}</small>` : ''}${js.status === 'active' && jsNotStarted ? `<div style="margin-top:8px"><button type="button" class="btn ghost sm" data-job-switch-cancel="${escapeHtml(js.id)}" data-job-switch-app="${escapeHtml(applicationId)}">取消改談</button></div>` : ''}</div>` : '';
    // 2026-09-16 加：LINE 綁定狀態＋頭像。沒有頭像（多半是舊版文字驗證綁定的，
    // 那條路徑不會存頭像）就退回姓名前兩字的色塊，跟舊版 consultant/social-post
    // 的 .tobs-avatar 同一個 fallback 慣例，不是這裡自己發明的樣式。
    const lineHtml = lineBinding
      ? `<span class="line-avatar">${lineBinding.picture_url
          ? `<img src="${escapeHtml(lineBinding.picture_url)}" alt="">`
          : text((lineBinding.display_name || '?').slice(0, 2))}</span> `
        + `<span class="badge success">已綁定</span>${lineBinding.display_name ? ' ' + text(lineBinding.display_name) : ''}`
      : card.line_rebind
        ? `<span class="badge warning">需重新綁定</span> <span class="muted">舊方式綁的，LINE 通知送不到；請人選在 LINE 點「追蹤面試進度」重填表單</span>`
        : `<span class="muted">未綁定 LINE</span>`;
    const basics = `<div class="two-col"><div><dl class="kv-grid">
      <dt>聯絡方式</dt><dd>${text(application.email || '—')}${application.phone ? ' · ' + text(application.phone) : ''}</dd>
      <dt>期望薪資</dt><dd>${text(application.expected_salary || '—')}</dd>
      <dt>可上班日</dt><dd>${text(application.available_date || '—')}</dd>
      <dt>來源</dt><dd>${text(application.source_channel || application.utm_source || '—')}${application.resume_source ? ' · 履歷來源 ' + text(application.resume_source) : ''}</dd>
      <dt>LINE</dt><dd>${lineHtml}</dd>
    </dl></div><div><dl class="kv-grid">
      <dt>DISC</dt><dd>${disc}</dd>
      <dt>手動階段</dt><dd>${text(application.manual_stage || '—')}${application.manual_stage_note ? '：' + text(application.manual_stage_note) : ''}</dd>
      <dt>面談狀態</dt><dd>${text(application.interview_state || '—')}</dd>
      <dt>負責顧問</dt><dd>${text(application.owner || '未指派')}</dd>
    </dl></div></div>${resumeBtns.length ? `<div class="actions-row">${resumeBtns.join('')}</div>` : '<p class="muted">沒有履歷檔案或連結</p>'}${reviewLinkRow(application, applicationId)}`;
    // <details> 預設收合——電洽紀錄常常是一整篇逐字稿整理，攤平顯示會把整個
    // 抽屜撐得很長，點開才看到內容比較合理。
    const notesHtml = notes.length
      ? notes.slice(0, 8).map((n) => `<details class="note-details"><summary><b>${text(n.type)}</b><small>${text(n.created_at)}${n.created_by ? ' · ' + text(n.created_by) : ''}</small></summary><p>${text(n.content)}</p></details>`).join('')
      : '<p class="muted">還沒有顧問備註或電洽紀錄</p>';
    // 後端 timeline 的 detail 對「電洽紀錄」這個類型是直接塞整篇逐字稿內容進去——
    // 這裡只是時間軸，看「什麼時候發生了什麼事」，全文已經在「顧問備註／電洽紀錄」
    // 那個收合區塊看得到，不用在這裡重複攤平一次撐爆版面。
    const timelineHtml = timeline.length
      ? timeline.slice(0, 8).map((a) => `<p><b>${text(a.type)}</b>&#12288;${a.type === '電洽紀錄' ? '已匯入電洽內容' : text(a.detail)}<br><small class="muted">${text(a.time)}</small></p>`).join('')
      : '<p class="muted">沒有歷程資料</p>';
    // ── 2026-10-27 Jacky 選 B 方案「分頁資料夾」──────────────────────────────
    // 原本：上面 4 格進度條（看「有沒有資料」自己打勾）跟下面 10 種「階段」下拉是兩套各走各的，
    // 抽屜一路往下疊 14 個區塊，阿財原始對話只能從電洽準備卡裡的小按鈕進去。
    // 現在：上面固定一條小檔頭（階段・負責顧問・聯絡・下一步・同一人的其他卡），
    // 下面 5 個分頁，每樣東西只住一個地方；進度條拿掉，階段只剩下拉那一套。
    const consList = await consListP;
    const STAGE_OPTS = [['screening', '阿財初審'], ['confirm', '顧問確認'], ['stage1', '第一階段'], ['stage2', '第二階段'], ['stage3', '第三階段'], ['stage4', '第四階段'], ['offer', '錄取'], ['onboard', '報到'], ['care', '到職關懷'], ['backup', '備選']];
    const quickSet = `<div class="quick-set" data-qs-app="${escapeHtml(applicationId)}">
      <label>負責顧問<select data-qs-owner><option value="">未指派</option>${(consList || []).filter((c) => c.is_active || c.id === application.owner).map((c) => `<option value="${escapeHtml(c.id)}"${c.id === application.owner ? ' selected' : ''}>${escapeHtml(c.display_name)}</option>`).join('')}</select></label>
      <label>階段<select data-qs-stage>${application.manual_stage ? '' : '<option value="" selected disabled>（系統自動判斷）</option>'}${STAGE_OPTS.map(([v, l]) => `<option value="${v}"${v === application.manual_stage ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <span class="qs-status" data-qs-status aria-live="polite"></span>
      <div class="quick-note"><select data-qn-type aria-label="備註類型"><option>評估</option><option>聯繫紀錄</option><option>客戶回饋</option><option>其他</option></select><textarea data-qn-text rows="2" placeholder="直接打一筆顧問備註…"></textarea><button type="button" class="btn sm primary" data-qn-save>存備註</button></div>
    </div>`;
    const channelTag = application.source_channel ? text(application.source_channel) : '阿財面談應徵';
    const ownerName = ((consList || []).find((c) => c.id === application.owner) || {}).display_name || '';
    const liveFw = forwards.filter((f) => !f.advisor_not_recommended_at && !f.candidate_withdrawn_at && !f.client_rejected_at);
    // 階段：顧問手動選的優先；沒選就用資料推（只顯示一個，不再兩套）
    const stageText = application.manual_stage
      ? ((STAGE_OPTS.find(([v]) => v === application.manual_stage) || [])[1] || application.manual_stage)
      : liveFw.length ? `已推薦 ${liveFw.length} 家客戶`
      : application.call_summary_md ? '電洽完成'
      : application.interview_state === 'done' ? '阿財面談完成'
      : (application.interview_state && application.interview_state !== 'not_started') ? '阿財面談中' : '新進';
    // 下一步：照真實資料一條一條往下比，比到第一個沒做完的就是下一步
    const nextStep = (() => {
      for (const f of liveFw) if ((f.billing_pending || []).length) return { t: `確認 ${f.company_name} 的匯款`, tab: 'fw' };
      for (const f of liveFw) if (!(f.client_formal_report && f.client_formal_report.consultant_confirmed_at)) return { t: `上傳推薦履歷給 ${f.company_name}`, tab: 'fw' };
      for (const f of liveFw) if ((f.forms || []).some((x) => x.status === 'not_sent')) return { t: `寄人事資料表給人選（${f.company_name}）`, tab: 'fw' };
      for (const f of liveFw) if ((f.forms || []).some((x) => x.status === 'sent')) return { t: `等人選填人事資料表（${f.company_name}），可以催填`, tab: 'fw' };
      if (liveFw.length) return { t: `等客戶回覆（${liveFw.map((f) => `${f.company_name}：${f.stage_label || '等回覆'}`).join('、')}）`, tab: 'fw' };
      if (application.call_summary_md) return { t: '電洽完了，決定要不要推薦給客戶', tab: 'fw' };
      if (application.interview_state === 'done') return { t: '阿財談完了，打電話給人選（電洽）', tab: 'call' };
      if (application.interview_state && application.interview_state !== 'not_started') return { t: '人選正在跟阿財面談，等談完', tab: 'ai' };
      return { t: '人選還沒跟阿財面談；可以直接打電話', tab: 'call' };
    })();
    // 同一人的其他卡：人選清單（/admin/pipeline/tracker）本來就把同 email／電話的應徵單併成一組
    // （extra_placements），這裡直接拿來用，不另外猜；清單沒載入過就退回後端那行黃字提示。
    const sibs = siblingCards(applicationId);
    const sibBar = sibs.length
      ? `<div class="cand-sibs"><span>同一人還有 ${sibs.length} 張卡：</span>${sibs.map((x) => `<button type="button" class="btn sm" data-application="${escapeHtml(x.applicationId)}">${x.seqNo ? '#' + text(x.seqNo) + ' ' : ''}${text(x.originLabel)}${x.job ? '・' + text(x.job) : ''}</button>`).join('')}</div>`
      : (dupNotice ? `<div class="notice" style="margin:8px 0 0">⚠ 疑似同一人：${text(dupNotice)}</div>` : '');
    const contact = [application.phone, application.email && !isPlaceholderEmail(application.email) ? application.email : ''].filter(Boolean).map((v) => text(v)).join('　');
    // 2026-10-30 Jacky：「人選卡片上面有一個地方可以去改」——LINE ID 跟人事資料表放最上面，
    // 不用進「推薦客戶」分頁找。LINE ID 推過的每家客戶一起改；人事資料表挑第一份還沒交回的。
    const lineIdGiven = card.line_id_manual || (forwards.find((f) => f.line_id_given) || {}).line_id_given || '';
    const pendForm = (() => { for (const f of forwards) { const x = (f.forms || []).find((m) => m.status !== 'submitted'); if (x) return { f, x }; } return null; })();
    const formsAllDone = forwards.some((f) => (f.forms || []).length) && !pendForm;
    const quickBar = (pendForm || formsAllDone) ? `<div class="cand-quickbar">
        ${pendForm ? actionBtn(`上傳人事資料表（${pendForm.f.company_name || '客戶'}）`, 'candidate-form-upload', { idParams: { application_id: applicationId, company_id: pendForm.f.company_id, job_form_id: pendForm.x.job_form_id } }, 'primary')
          : '<span class="badge success">人事資料表 ✓</span>'}
      </div>` : '';
    const head = `<div class="cand-head">
      <div class="cand-chips"><span class="badge info">階段：${text(stageText)}${application.manual_stage ? '' : '（自動）'}</span><span class="badge">負責：${text(ownerName || '未指派')}</span>${lineBinding ? '<span class="badge success">LINE 已綁定</span>' : ''}${hardGateBadge}${contactBadge}</div>
      ${contact ? `<div class="cand-contact">${contact}</div>` : ''}
      ${quickBar}
      <button type="button" class="cand-next" data-cand-goto="${nextStep.tab}"><b>下一步</b>${text(nextStep.t)}</button>
      ${sibBar}${jobSwitchHtml}${views.socialSourceBadge(card.social_source)}
    </div>`;
    const TABS = [['ov', '總覽'], ['ai', '阿財面談'], ['call', '電洽'], ['fw', `推薦客戶${forwards.length ? `（${forwards.length}）` : ''}`], ['cv', '履歷檔案']];
    const curTab = (state.candTab && state.candTab.app === applicationId) ? state.candTab.tab : 'ov';
    const tabBar = `<div class="tabs cand-tabs" role="tablist">${TABS.map(([k, l]) => `<button type="button" role="tab" data-cand-tab="${k}" aria-selected="${k === curTab}" class="${k === curTab ? 'active' : ''}">${l}</button>`).join('')}</div>`;
    // 總覽：職缺匹配、走到哪了、快速設定（顧問／階段／備註）、基本資料與聯絡動作、歷程、信件
    const milestones = [
      application.created_at ? ['建立應徵單', application.created_at] : null,
      application.interview_ended_at ? ['跟阿財面談完', application.interview_ended_at] : (application.interview_state && application.interview_state !== 'not_started' && application.interview_state !== 'done' ? ['阿財面談中', ''] : null),
      application.disc_primary ? [`風格測驗完成（主型 ${application.disc_primary}）`, ''] : null,
      application.call_summary_md ? ['電洽完成', (state.callHist[0] || {}).time || ''] : null,
      ...forwards.map((f) => [`推薦給 ${f.company_name}・${f.job_title || f.job_slug}（客戶：${f.stage_label || '等回覆'}）`, f.forwarded_at]),
    ].filter(Boolean);
    const milestonesHtml = `<ul class="cand-steps">${milestones.map(([t, at]) => `<li><span>${text(t)}</span><small>${text(String(at || '').slice(0, 16))}</small></li>`).join('')}</ul>`;
    // 2026-10-27 Jacky（看測試版後）：基本資料改成小格子一眼看完；按鈕依用途分組；風格測驗併成 DISC 一格，點了才展開
    const paneOv = `${views.jobMatchTop(report)}<h3>走到哪了</h3>${milestonesHtml}${quickSet}<div id="special-check-box"></div>
      <h3>基本資料</h3>${candBasicsBlock(application, applicationId, { channelTag, lineHtml, lineBound: !!lineBinding, lineId: lineIdGiven, disc, styleHtml: stageDetailHtml('style', application, forwards, report, applicationId) })}
      <details class="note-details" style="margin-top:14px"><summary><b>最近歷程</b></summary>${timelineHtml}</details>
      <div data-cand-mail></div>`;
    const paneAi = `<div data-cand-lazy="ai"></div>
      <h3>阿財跟人選的原始對話</h3><div data-cand-transcript>${loading('讀取對話中')}</div>
      <div class="actions-row" style="margin-top:14px">${actionBtn('AI 篩選決策', 'screen-decide', ctxId)}${actionBtn('清除決策', 'clear-decision', ctxId, 'danger')}</div>`;
    const paneCall = `<div data-cand-lazy="call"></div>
      <h3>顧問備註／電洽紀錄</h3><div class="actions-row">${actionBtn('手動記一筆電洽重點', 'application-call-note', ctxId)}${actionBtn('修改電洽摘要', 'application-call-summary', ctxId)}</div>${notesHtml}`;
    const paneFw = `${fwCards}<div style="margin-top:12px"><button type="button" class="btn primary" data-action="open-forward-candidate" data-application-id="${escapeHtml(applicationId)}">＋ 推薦給${forwards.length ? '另一家' : ''}客戶</button></div>`;
    const sibResumes = sibs.filter((x) => x.resumeFileId).map((x) => `<button type="button" class="btn ghost sm" data-download-resume="${escapeHtml(x.applicationId)}">看另一張卡（${text(x.originLabel)}）的履歷</button>`).join('');
    const paneCv = `<h3>這位人選的履歷</h3>${resumeBtns.length ? `<div class="actions-row">${resumeBtns.join('')}</div>` : '<p class="muted">這張卡沒有履歷檔案或連結</p>'}${sibResumes ? `<div class="actions-row">${sibResumes}</div>` : ''}
      <h3 style="margin-top:20px">要給別人看的版本</h3>${views.clientResumeBox(applicationId, card.client_formal_reports || [], forwards, card.anon_report)}`;
    const pane = (k, html) => `<section class="cand-pane" data-cand-pane="${k}"${k === curTab ? '' : ' hidden'}>${html}</section>`;
    // 2026-10-19 Jacky：滑到下面會突然跳回最上面。原因是捲動位置在「開始抓資料前」就記下來了，
    // 抓資料這 1～2 秒內往下滑，重畫時又被拉回舊位置（常常是 0）。改成重畫前一刻才讀目前位置。
    const liveDr = document.querySelector('#overlay-root .drawer');
    const liveCard = liveDr && liveDr.querySelector('[data-cand-card]');
    const liveScroll = (liveCard && liveCard.getAttribute('data-cand-card') === applicationId) ? liveDr.scrollTop : keepScroll;
    drawer({
      // seq_no 是舊版拿來防止顧問誤刪錯人時比對用的固定流水編號（見 applications.seq_no
      // ／trg_applications_seq_no 觸發器），一直沒搬進 V3 標題。
      title: (application.seq_no ? `#${application.seq_no} ` : '') + (application.name || '應徵單'),
      subtitle: `${application.job_title || application.job_slug || ''} · ${channelTag}`,
      body: `<div class="drawer-section cand-folder">${head}${tabBar}${pane('ov', paneOv)}${pane('ai', paneAi)}${pane('call', paneCall)}${pane('fw', paneFw)}${pane('cv', paneCv)}<i data-cand-card="${escapeHtml(applicationId)}" hidden></i></div>`,
    });
    if (liveScroll) { const dr = document.querySelector('#overlay-root .drawer'); if (dr) dr.scrollTop = liveScroll; }
    wireCandidateDrawer(applicationId, application, forwards, report, { sibs: sibs.filter((x) => x.aiDone), curTab });
    injectMailSection('candidate', applicationId, document.querySelector('#overlay-root [data-cand-mail]'));
    // 2026-10-23 特殊職缺檢查卡（只有 special_check_jobs 清單內職缺的人選才會出現）
    loadSpecialCheck(applicationId, application.job_slug, () => state.openCandidateId === applicationId);
  } catch (error) {
    console.error(error);
    drawer({ title: '應徵單載入失敗', body: errorState(error) });
  }
}

function apptRowHtml() {
  return `<div class="appt-row form-grid"><label class="field"><span>日期</span><input type="date" class="appt-date"></label><label class="field"><span>時間</span><input type="time" class="appt-time"></label><label class="field"><span>形式</span><select class="appt-fmt"><option value="現場面談">現場面談</option><option value="視訊面談">視訊面談</option><option value="電話面談">電話面談</option></select></label><label class="field span-2 appt-url-field" hidden><span>視訊連結（選視訊面談才需要）</span><input type="url" class="appt-url" placeholder="https://..."></label></div>`;
}

// 跟舊版一樣是手風琴：一次只展開一格，點哪一格內容就換成哪一格的——
// 「風格測驗」「電洽」底下才有 DISC 連結／安排面談表單，不是常駐攤平顯示。
// report/applicationId 是 2026-09-15 加的：使用者發現點「阿財初審」看不到舊版
// 那個報告內容區塊，查證後發現後端 /admin/application/:id/card 那時候只選了
// id/consultant_decision 兩欄，content_md 根本沒被查出來——不是這裡忘記接，
// 是資料源頭就沒給，已經補後端一起回傳（見 step1ne-backoffice-worker 那邊的改動）。
// 2026-09-17 依 PRECALL v1.4 Contract 升級：改成打 GET /precall-card 讀
// {status, card, legacy_call_prep_md, stale_reason}，不再自己解析
// application.call_prep_md——status mapping／stale 判斷全部收在 Backend
// Adapter（Contract 08 第 50 節「Frontend 不應自行重新判斷」），這裡只負責
// 依 status render 對應畫面。
function renderPrecallStatus(box, data, applicationId) {
  if (!box || !data) return;
  const status = data.status;
  // 2026-09-18 加（Phase 1.1 v1.1）：快取住卡片本體，讓「整理履歷」「查看佐證」
  // 這幾個按鈕可以直接同步讀 resume_summary／known_do_not_ask，不用另外
  // 為了這幾個唯讀的小面板再打一次 precall-card API。
  if (data.card) state.precallCardCache = { applicationId, card: data.card };
  if (status === 'ready') box.innerHTML = views.precallCard(data.card, { stale: false, applicationId });
  else if (status === 'stale') box.innerHTML = views.precallCard(data.card, { stale: true, applicationId });
  else if (status === 'generating') box.innerHTML = views.precallCardLoading() + (data.legacy_call_prep_md ? `<p class="help" style="margin:10px 0 6px">完整卡片產生中，先看這份精簡版：</p>${views.precallCardLegacy(data.legacy_call_prep_md)}` : '');
  else if (status === 'not_generated' && data.legacy_call_prep_md) box.innerHTML = views.precallCardLegacy(data.legacy_call_prep_md);
  else box.innerHTML = views.precallCardEmpty();
}

// 2026-09-18 加：「職缺介紹」tab 的資料載入——跟 loadPrecallCard 是平行邏輯，
// 但這支沒有 ready/stale/generating 狀態機，職缺資料本來就是即時的，讀到就顯示。
async function loadJobIntro(jobSlug, box) {
  if (!box) return;
  if (!jobSlug || jobSlug === 'unspecified') { box.innerHTML = views.jobIntroEmpty(); return; }
  box.innerHTML = views.jobIntroLoading();
  try {
    const res = await adapters.jobIntroGet(jobSlug);
    const job = res.job || res;
    box.innerHTML = views.jobIntro(job);
  } catch (error) {
    box.innerHTML = errorState(error);
  }
}

async function loadPrecallCard(applicationId) {
  const box = $('#precall-card-body');
  if (!box) return null;
  try {
    const res = await adapters.precallCardGet(applicationId);
    const data = res.data || res;
    renderPrecallStatus(box, data, applicationId);
    return data;
  } catch (error) {
    box.innerHTML = views.precallCardTimeout(error);
    return null;
  }
}

// 2026-09-18 加（規格 B）：電洽結果 tab 改成 lazy-load 結構化資料，跟
// loadPrecallCard 是平行邏輯——GET 讀狀態，not_generated 時如果有舊版
// call_summary_md 就先顯示 legacy（views.callResult），有結構化資料就顯示
// 新版六區塊。
async function loadPostcallResult(applicationId, box) {
  if (!box) return null;
  try {
    const res = await adapters.postcallResultGet(applicationId);
    const data = res.data || res;
    if (data.status === 'ready') box.innerHTML = views.postcallResult(data.result, applicationId);
    else if (data.status === 'generating') box.innerHTML = views.postcallResultLoading();
    else if (data.status === 'not_generated' && data.has_call_notes && box.dataset.autoGen !== applicationId) {
      // 2026-10-02：有逐字稿、還沒有結構化電洽結果 → 打開就自動開始整理（舊版文字摘要有的話先秀在下面）
      box.dataset.autoGen = applicationId;
      postcallGenerate(applicationId, false);
    }
    else if (data.status === 'not_generated' && data.legacy_call_summary_md) {
      box.innerHTML = views.callResult(data.legacy_call_summary_md)
        + `<div class="actions-row" style="margin-top:10px"><button type="button" class="btn ghost sm" data-action="postcall-generate">升級成結構化電洽結果（含 Gate Result／下一步建議）</button></div>`;
    }
    else box.innerHTML = views.postcallResultEmpty(applicationId);
    if ((state.callHist || []).length) box.insertAdjacentHTML('beforeend', views.callHistory(applicationId, state.callHist));
    return data;
  } catch (error) {
    box.innerHTML = views.postcallResultTimeout(error, applicationId);
    return null;
  }
}

// 2026-09-18 加（P3-A 職缺推薦）：跟 loadJobIntro 一樣是純讀資料的 lazy-load，
// 沒有 ready/stale/generating 狀態機——建議是阿財面談結束時就自動算好寫進
// DB 的，前端這裡讀到什麼就顯示什麼；還沒面談完或沒找到更適合的職缺，
// 後端回空陣列，顯示空狀態，不要留一個空白框讓顧問以為畫面壞了。
async function loadRecommendations(applicationId, box) {
  if (!box) return null;
  box.innerHTML = views.recommendationsLoading();
  try {
    const res = await adapters.recommendationsGet(applicationId);
    const data = res.data || res;
    const list = Array.isArray(data) ? data : (data.recommendations || []);
    box.innerHTML = views.recommendations(list);
    return list;
  } catch (error) {
    box.innerHTML = errorState(error);
    return null;
  }
}

// 顧問按「值得問人選／略過」。
// 「略過」用瀏覽器原生 prompt 問一句原因就好：原因是選填，為了一個選填
// 欄位再做一套 modal 沒必要；按取消（null）視同不填原因照樣送出。
//
// 2026-09-21 加第二步（P3-B）：按「值得問人選」之後再問一次「要現在請阿財
// 問他嗎？」，按確定才真的發 LINE。
// ⚠️ 兩步刻意分開：按第一下是**判斷**（這個人值得問），按第二下是**授權發送**
//    （現在就傳訊息給他）。顧問按第一下的時候想的不是後者——中間可能改變主意、
//    或發現人選已經接了別的工作。接排程自動發等於 AI 自己決定何時聯絡候選人，
//    那跟「AI 輔助、不取代顧問」的分工不一致。
async function submitRecommendationDecision(applicationId, recId, decision, box) {
  let reason = null;
  if (decision === 'rejected') {
    reason = window.prompt('略過的原因？（可以不填，直接按確定）') || null;
  }
  try {
    await adapters.recommendationDecision(recId, decision, '顧問', reason);
    if (decision !== 'approved') {
      toast('已記錄：略過', 'success');
      await loadRecommendations(applicationId, box);
      return;
    }
    toast('已記錄：值得問人選', 'success');
    const go = window.confirm(
      '要現在請阿財用 LINE 問這位人選，看他有沒有興趣了解這個職缺嗎？\n\n'
      + '・按「確定」＝立刻送出一則 LINE 訊息給人選\n'
      + '・按「取消」＝只留下你的判斷，不傳任何訊息（之後還是可以自己聯繫）');
    if (go) {
      try {
        const r = await adapters.p3bSendOne(recId);
        toast(`已請阿財發出訊息${r && r.name ? '給 ' + r.name : ''}`, 'success');
      } catch (err) {
        // 後端擋下來的理由要原文顯示（靜音時段／沒綁 LINE／今天額滿…），
        // 不要含糊成「發送失敗」——顧問看不懂就會重按，或以為系統壞了。
        toast(err.message || '沒有發出去', 'error');
      }
    }
    await loadRecommendations(applicationId, box);
  } catch (error) {
    toast(error.message || '記錄失敗', 'error');
  }
}

async function postcallGenerate(applicationId, force) {
  const box = $('#call-result-body');
  if (box) box.innerHTML = views.postcallResultLoading();
  try {
    await adapters.postcallResultGenerate(applicationId, force);
  } catch (error) {
    if (box) box.innerHTML = views.postcallResultTimeout(error, applicationId);
    toast(error.message || '產生失敗', 'error');
    return;
  }
  let attempts = 0;
  const MAX_ATTEMPTS = 60;
  const timer = setInterval(async () => {
    attempts += 1;
    if (state.openCandidateId !== applicationId) { clearInterval(timer); return; }
    const liveBox = $('#call-result-body');
    const data = await loadPostcallResult(applicationId, liveBox);
    if (data && data.status === 'ready') { clearInterval(timer); return; }
    if (attempts >= MAX_ATTEMPTS) {
      clearInterval(timer);
      if (state.openCandidateId === applicationId && liveBox) liveBox.innerHTML = views.postcallResultTimeout(null, applicationId);
    }
  }, CONFIG.detailPollMs);
}

async function precallGenerate(applicationId, force) {
  const box = $('#precall-card-body');
  if (box) box.innerHTML = views.precallCardLoading();
  try {
    await adapters.precallCardGenerate(applicationId, force);
  } catch (error) {
    if (box) box.innerHTML = views.precallCardTimeout(error);
    toast(error.message || '產生失敗', 'error');
    return;
  }
  // POST 只負責排隊，實際結果靠輪詢 GET（Contract 08 第 45 節：沿用既有 AI
  // job queue，不新造 WebSocket）。最多等 5 分鐘，逾時給重試按鈕，不讓顧問
  // 對著 loading 骨架乾等到天荒地老。
  let attempts = 0;
  const MAX_ATTEMPTS = 60;
  const timer = setInterval(async () => {
    attempts += 1;
    if (state.openCandidateId !== applicationId) { clearInterval(timer); return; }
    const data = await loadPrecallCard(applicationId);
    if (data && (data.status === 'ready' || data.status === 'stale')) {
      clearInterval(timer);
      return;
    }
    if (attempts >= MAX_ATTEMPTS) {
      clearInterval(timer);
      const liveBox = $('#precall-card-body');
      if (state.openCandidateId === applicationId && liveBox) liveBox.innerHTML = views.precallCardTimeout();
    }
  }, CONFIG.detailPollMs);
}

function stageDetailHtml(key, application, forwards, report, applicationId) {
  if (key === 'style') {
    const assessBtnLabel = application.disc_primary ? '查看連結' : '產生測驗連結';
    return `<div class="stage-detail-panel"><h4>風格測驗</h4>${application.disc_primary ? `<p class="help" style="margin-top:0">已完成測驗（主型 ${text(application.disc_primary)}）</p>` : ''}<button type="button" class="btn ghost sm" id="disc-link-btn">${assessBtnLabel}</button><div id="disc-link-result" style="margin-top:8px"></div></div>`;
  }
  if (key === 'interview') {
    if (!report) return `<div class="stage-detail-panel"><h4>阿財初審</h4><p class="help" style="margin:0">${application.interview_state === 'done' ? '已完成阿財面談，報告尚未產出' : '進行中，還沒完成'}</p></div>`;
    const decisionLabel = { forwarded: '會推（已轉給客戶）', need_more: '再看看', rejected: '不推' }[report.consultant_decision] || '待處置';
    // 2026-09-15 改：報告全文預設收合（跟電洽紀錄同一套 <details>），不要一展開
    // 這一格就把整張抽屜撐爆。決策按鈕旁補一句話說明跟「推薦給客戶」的關係——
    // 按推薦給客戶當下，後端會自動把這裡的決策補成「會推」（見 /admin/forward-candidate
    // 的邏輯），真的要推薦某個客戶職缺不用先來這裡按一次會推再去推薦，兩個步驟
    // 是分開但「推薦給客戶」已經內建這一步；這顆決策按鈕真正必要的情境是
    // 「還沒決定要推薦給誰，但想先記錄再看看／不推」。
    // 2026-09-21 改：這一格原本只有一段純文字報告全文，顧問要自己從一大段
    // 文字裡撈結論。Jacky 要的是「面談結果取代初篩報告」——結構化資料
    // （分流、七維評分、專業題 1–5 級、硬條件逐條、待追問）本來就都在
    // content_json 裡，只是沒有畫面。報告全文收進最底下的摺疊區備查。
    return `<div class="stage-detail-panel"><h4>阿財面談結果</h4>
      <p class="help" style="margin:0 0 10px">${text(report.created_at)} 產出・目前決策：${text(decisionLabel)}</p>
      ${views.isQuickApply(application) ? views.quickApplyResult(report, application) : views.interviewResult(report, application)}
      ${views.acaiJobRecs ? views.acaiJobRecs(application) : ''}
      <p class="help" style="margin:14px 0 6px">有興趣就直接按下面「推薦給客戶」，會自動記錄為會推；這顆是還沒決定推薦給誰、但想先記錄再看看／不推時用。</p>
      <div>${actionBtn('AI 初篩報告決策', 'decide-report', { idParams: { application_id: applicationId, id: report.id } }, 'primary')}</div></div>`;
  }
  if (key === 'call') {
    // 2026-09-17 加：PRECALL_PHASE1。Pre-call Card 放在這一格最上面——這是
    // 「電話前要看的東西」，跟下面「安排面談（要做的事）」「電洽紀錄（事後
    // 參考資料）」性質不同但都屬於「電洽」這個階段，沿用既有入口，不新開
    // 頂層導覽（PRECALL_PHASE1 spec 第 8 節）。
    // 2026-09-18 加「職缺介紹」tab：給不熟這個職缺的顧問看的背景資料——跟
    // 電洽前準備卡是同一格底下平行的兩個 tab，不是取代關係，切換用既有
    // .tabs／data-tab-scope 慣例（照抄人選卡片三分頁那個模式）。
    // 2026-09-18 加「電洽結果」第三個 tab：AI 整理過的電洽摘要（call_summary_md）
    // 原本擠在最下面一個摺疊的 <details> 裡，跟「安排面談」「電洽紀錄」標題
    // 混在同一長串裡不好找——Jacky 今天實測好幾次都在找這個。搬成跟「電洽前
    // 準備」「職缺介紹」平行的第三個 tab，格式先用同一套卡片樣式呈現，
    // 之後要調整 AI 整理邏輯（prompt_call_notes_summary）再依這裡看到的反饋改。
    // 2026-09-18 加「AI 職缺推薦」第四個 tab（P3-A）：阿財面談完自動比對出來的
    // 「其他更適合的職缺」建議＋顧問採用／不採用。放這一格是因為它跟電洽前準備
    // 一樣是「打電話之前先看一眼」的東西，不另開頂層導覽；一樣 lazy-load，
    // 沒切過去就不打 API。
    return `<div class="stage-detail-panel"><h4>電洽準備</h4>
    <div class="tabs"><button class="active" data-precall-tab="card">電洽前準備</button><button data-precall-tab="jobintro">職缺介紹</button><button data-precall-tab="result">電洽結果</button><button data-precall-tab="recs">AI 職缺推薦</button></div>
    <div id="precall-card-body">${views.precallCardLoading()}</div>
    <div id="job-intro-body" hidden>${views.jobIntroLoading()}</div>
    <div id="call-result-body" hidden>${views.postcallResultLoading()}</div>
    <div id="recommendations-body" hidden>${views.recommendationsLoading()}</div>
    <h4 style="margin-top:22px">安排面談</h4><p class="help" style="margin-top:0">填幾個候選時段，送出後如果這位人選有綁過 LINE 會自動推播給他選；沒綁過的話系統會提醒你自己把連結傳給他。</p><div id="appt-rows">${apptRowHtml()}${apptRowHtml()}</div><button type="button" class="btn ghost sm" id="appt-add-row">＋ 加一個時段</button><label class="field"><span>面談對象（選填，例如「王經理・用人主管」）</span><input id="appt-interviewer"></label><label class="field"><span>面談地點（現場面談才需要）</span><input id="appt-location"></label><label class="field"><span>備註（選填，給人選看的）</span><textarea id="appt-note" rows="2"></textarea></label><button type="button" class="btn primary" id="appt-submit" style="margin-top:10px">送出安排</button><div id="appt-result" style="margin-top:8px"></div></div>`;
  }
  if (key === 'forward') {
    // 使用者要求：點這一格要看得到「推薦哪一客戶哪一個職缺」，不是只講一句
    // 「還沒推薦給任何客戶」——列出每一筆真實推薦紀錄，並且能直接在這裡送出
    // 新的推薦（跟「操作」列表那顆按鈕共用同一支 action，客戶下拉選單也一起帶著走）。
    // 2026-09-29 Jacky：推薦履歷要在這裡就能上傳——顧問推薦完第一眼看的是這一格，
    // 原本只放在下面「推薦客戶進度」，他找不到。兩處共用同一支 action。
    const cfrStatus = (cfr) => !cfr ? '<span class="badge warning">推薦履歷還沒上傳</span>'
      : cfr.pdf_pending ? '<span class="badge">推薦履歷 AI 產生中</span>'
      : cfr.consultant_confirmed_at ? `<span class="badge success">推薦履歷：客戶看得到（${text(String(cfr.consultant_confirmed_at).slice(5, 16))}）</span>`
      : '<span class="badge warning">只有 AI 草稿，客戶還看不到</span>';
    const listHtml = forwards.length ? forwards.map((f) => {
      const cfr = f.client_formal_report;
      const ids = { idParams: { application_id: applicationId, company_id: f.company_id } };
      return `<div class="list-row cfr-drop" style="flex-wrap:wrap;row-gap:8px" data-cfr-app="${escapeHtml(applicationId)}" data-cfr-co="${escapeHtml(f.company_id)}" data-cfr-name="${escapeHtml(f.company_name || '')}" data-cfr-has="${cfr && cfr.consultant_confirmed_at ? '1' : ''}"><span style="flex:1 1 100%"><b>${text(f.company_name)}</b><small>${text(f.job_title || f.job_slug)} · 推薦人：${text(forwarderName(f.forwarded_by))}${f.stage_label ? ' · ' + text(f.stage_label) : ''}</small><span style="display:block;margin-top:6px">${cfrStatus(cfr)}</span><small class="cfr-drop-hint">也可以直接把推薦履歷 PDF 拖進這一格</small></span>${rowActions([
        cfr && cfr.pdf_pending ? '' : actionBtn(cfr ? '重新製作 AI 草稿' : '製作推薦履歷（AI 草稿）', 'client-formal-report', ids),
        cfr && !cfr.consultant_confirmed_at && !cfr.pdf_pending && cfr.file_id ? `<button type="button" class="btn ghost sm" data-download-file="${text(cfr.file_id)}">下載 AI 草稿</button>` : '',
        actionBtn(cfr && cfr.consultant_confirmed_at ? '換一份推薦履歷' : '上傳推薦履歷', 'client-formal-report-upload', ids, cfr && cfr.consultant_confirmed_at ? '' : 'primary'),
        cfr && cfr.consultant_confirmed_at && cfr.file_id ? `<button type="button" class="btn ghost sm" data-download-file="${text(cfr.file_id)}">下載推薦履歷</button>` : '',
      ].filter(Boolean))}</div>`;
    }).join('') : '<p class="help" style="margin:0">還沒推薦給任何客戶</p>';
    return `<div class="stage-detail-panel"><h4>推薦給客戶</h4>${listHtml}<div style="margin-top:12px"><button type="button" class="btn primary" data-action="open-forward-candidate" data-application-id="${escapeHtml(applicationId)}">推薦給客戶</button></div></div>`;
  }
  return '';
}

function wireCandidateDrawer(applicationId, application, forwards, report, opts = {}) {
  const bindApptRow = (row) => {
    const fmtSel = row.querySelector('.appt-fmt');
    const urlField = row.querySelector('.appt-url-field');
    if (fmtSel && urlField) fmtSel.onchange = () => { urlField.hidden = fmtSel.value !== '視訊面談'; };
  };
  const wireDetailPanel = () => {
    $$('#appt-rows .appt-row').forEach(bindApptRow);
    const addRowBtn = $('#appt-add-row');
    const rowsBox = $('#appt-rows');
    if (addRowBtn && rowsBox) addRowBtn.onclick = () => {
      rowsBox.insertAdjacentHTML('beforeend', apptRowHtml());
      bindApptRow(rowsBox.lastElementChild);
    };
    const discBtn = $('#disc-link-btn');
    if (discBtn) discBtn.onclick = () => showAssessmentLink(applicationId);
    const apptSubmit = $('#appt-submit');
    if (apptSubmit) apptSubmit.onclick = () => submitAppointment(applicationId);
    // 2026-09-17 改：precall-card-body 每次重新產生/regenerate 都會把整段
    // innerHTML 換掉（空狀態→loading→卡片/舊版/逾時，四種畫面各自帶自己的
    // 按鈕），綁在某一次渲染出來的按鈕上，下一次重繪按鈕就是新節點、監聽器
    // 沒了。改成綁在容器本身（容器節點不會被 innerHTML 取代掉）用事件代理，
    // 之後不管裡面換成哪個狀態的按鈕都接得到。
    const precallBox = $('#precall-card-body');
    if (precallBox) {
      precallBox.onclick = (e) => {
        const btn = e.target.closest('[data-action="precall-generate"]');
        if (btn) precallGenerate(applicationId, btn.getAttribute('data-force') === '1');
      };
      loadPrecallCard(applicationId);
    }
    // 2026-09-18 加：電洽準備／職缺介紹兩個 tab 切換。職缺介紹是純讀資料，
    // lazy-load——只有真的切過去才打 API，不用一開卡片就打兩支。
    const jobIntroBox = $('#job-intro-body');
    const callResultBox = $('#call-result-body');
    const recsBox = $('#recommendations-body');
    let jobIntroLoaded = false;
    let callResultLoaded = false;
    let recsLoaded = false;
    // 2026-09-18 加（P3-A）：採用／不採用按鈕跟 precall 那邊同樣的理由必須用事件
    // 代理——每次做完決定都會重新 render 整段 innerHTML，按鈕是新節點，綁在按鈕上
    // 的監聽器第二次就失效了。綁在容器上（容器不會被 innerHTML 換掉）才接得到。
    if (recsBox) {
      recsBox.onclick = (e) => {
        const approveBtn = e.target.closest('[data-action="rec-approve"]');
        if (approveBtn) {
          submitRecommendationDecision(applicationId, approveBtn.getAttribute('data-rec-id'), 'approved', recsBox);
          return;
        }
        const rejectBtn = e.target.closest('[data-action="rec-reject"]');
        if (rejectBtn) submitRecommendationDecision(applicationId, rejectBtn.getAttribute('data-rec-id'), 'rejected', recsBox);
      };
    }
    if (callResultBox) {
      callResultBox.onclick = (e) => {
        const btn = e.target.closest('[data-action="postcall-generate"]');
        if (btn) { postcallGenerate(applicationId, btn.getAttribute('data-force') === '1'); return; }
        const confirmBtn = e.target.closest('#postcall-decision-confirm');
        if (confirmBtn) {
          const sel = $('#postcall-route-select');
          const route = sel ? sel.value : null;
          if (!route) return;
          confirmBtn.disabled = true;
          adapters.postcallDecision(applicationId, route, null, '顧問')
            .then(() => { toast('已記錄顧問決定', 'success'); loadPostcallResult(applicationId, callResultBox); })
            .catch((err) => toast(err.message || '記錄失敗', 'error'))
            .finally(() => { confirmBtn.disabled = false; });
        }
      };
    }
    $$('[data-precall-tab]').forEach((tabBtn) => {
      tabBtn.onclick = () => {
        $$('[data-precall-tab]').forEach((b) => b.classList.remove('active'));
        tabBtn.classList.add('active');
        const which = tabBtn.getAttribute('data-precall-tab');
        if (precallBox) precallBox.hidden = which !== 'card';
        if (jobIntroBox) jobIntroBox.hidden = which !== 'jobintro';
        if (callResultBox) callResultBox.hidden = which !== 'result';
        if (recsBox) recsBox.hidden = which !== 'recs';
        if (which === 'recs' && !recsLoaded) {
          recsLoaded = true;
          loadRecommendations(applicationId, recsBox);
        }
        if (which === 'jobintro' && !jobIntroLoaded) {
          jobIntroLoaded = true;
          loadJobIntro(application.job_slug, jobIntroBox);
        }
        if (which === 'result' && !callResultLoaded) {
          callResultLoaded = true;
          loadPostcallResult(applicationId, callResultBox);
        }
      };
    });
    if (jobIntroBox) {
      jobIntroBox.onclick = async (e) => {
        const btn = e.target.closest('#job-notes-submit');
        if (!btn) return;
        const ta = $('#job-notes-input');
        const value2 = ta?.value.trim();
        if (!value2) return;
        btn.disabled = true;
        try {
          await adapters.jobNotesAdd(btn.getAttribute('data-job-slug'), value2, '顧問');
          toast('補充已新增', 'success');
          loadJobIntro(application.job_slug, jobIntroBox);
        } catch (error) {
          toast(error.message || '新增失敗', 'error');
          btn.disabled = false;
        }
      };
    }
  };
  // 2026-10-27 B 方案：5 個分頁。阿財面談／電洽兩頁的內容要打 API，點到才載入（只載一次）；
  // 每次動作完卡片會整張重畫，記住目前在哪一頁（state.candTab），重畫後停在同一頁。
  const loaded = new Set();
  const ensurePane = (k) => {
    if (loaded.has(k)) return;
    loaded.add(k);
    if (k === 'ai') {
      const box = $('#overlay-root [data-cand-lazy="ai"]');
      if (box) box.innerHTML = stageDetailHtml('interview', application, forwards, report, applicationId);
      loadCandTranscript(applicationId, opts.sibs || []);
    }
    if (k === 'call') {
      const box = $('#overlay-root [data-cand-lazy="call"]');
      if (box) box.innerHTML = stageDetailHtml('call', application, forwards, report, applicationId);
      wireDetailPanel();
    }
  };
  const showTab = (k) => {
    $$('#overlay-root [data-cand-tab]').forEach((b) => { const on = b.getAttribute('data-cand-tab') === k; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); });
    $$('#overlay-root [data-cand-pane]').forEach((p) => { p.hidden = p.getAttribute('data-cand-pane') !== k; });
    state.candTab = { app: applicationId, tab: k };
    ensurePane(k);
  };
  $$('#overlay-root [data-cand-tab]').forEach((b) => { b.onclick = () => showTab(b.getAttribute('data-cand-tab')); });
  const goto = $('#overlay-root [data-cand-goto]');
  if (goto) goto.onclick = () => {
    showTab(goto.getAttribute('data-cand-goto'));
    $('#overlay-root .cand-tabs')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  wireDetailPanel();   // 總覽頁的「風格測驗連結」按鈕
  ensurePane(opts.curTab || 'ov');
}

// 2026-10-27 B 方案：阿財面談分頁直接看原始對話（原本只能從電洽準備卡裡的小按鈕進去，卡沒產生就沒入口）。
// 這張卡沒跟阿財談過、但同一人的另一張卡有 → 直接顯示那張的對話，並標明是哪一張。
async function loadCandTranscript(applicationId, sibs) {
  const box = $('#overlay-root [data-cand-transcript]');
  if (!box) return;
  try {
    const body = await adapters.interviewDetail(applicationId);
    if (state.openCandidateId !== applicationId) return;
    if ((body.transcript || []).length || !sibs.length) { box.innerHTML = views.aiInterviewBody(body); return; }
    const sib = sibs[0];
    const other = await adapters.interviewDetail(sib.applicationId);
    if (state.openCandidateId !== applicationId) return;
    box.innerHTML = `<p class="help" style="margin:0 0 6px">這張卡沒有跟阿財面談；下面是同一人另一張卡（${text(sib.originLabel)}${sib.seqNo ? ' #' + text(sib.seqNo) : ''}）的對話。</p>${views.aiInterviewBody(other)}`;
  } catch (error) {
    box.innerHTML = errorState(error);
  }
}

// 同一人的其他應徵單：/admin/pipeline/tracker 已經把同 email／電話的併成一組（主卡＋extra_placements），
// 前端存在 state.candidateRows（siblings）。從清單打開才有；沒載入過清單就回空陣列。
function siblingCards(applicationId) {
  const lb = (x) => {
    const o = String(x.origin || '').trim();
    if (o === '104') return '104 匯入';
    if (o && o !== '不明') return o;
    return x.source_channel ? String(x.source_channel) : '自己應徵';
  };
  for (const r of state.candidateRows || []) {
    const group = [{ application_id: r.applicationId, seq_no: r.seqNo, job_title: r.job, origin: r.origin, source_channel: r.sourceChannel, resume_file_id: r.resumeFileId, ai_done: r.aiDone }, ...(r.siblings || [])];
    if (group.length < 2 || !group.some((x) => x.application_id === applicationId)) continue;
    return group.filter((x) => x.application_id && x.application_id !== applicationId).map((x) => ({
      applicationId: x.application_id, seqNo: x.seq_no, job: x.job_title, originLabel: lb(x), resumeFileId: x.resume_file_id, aiDone: !!x.ai_done,
    }));
  }
  return [];
}

async function showAssessmentLink(applicationId) {
  const box = $('#disc-link-result');
  if (box) box.textContent = '產生中…';
  try {
    const res = await api.post(`/admin/application/${encodeURIComponent(applicationId)}/assessment-link`, {});
    if (box) box.innerHTML = `<div class="notice">${text(res.assessment_url)}</div><button type="button" class="btn ghost sm" data-copy-text="${escapeHtml(res.assessment_url)}" style="margin-top:6px">複製連結</button>`;
  } catch (error) { console.error(error); if (box) box.textContent = '產生失敗：' + error.message; toast(error.message, 'error'); }
}

// 跟舊版 /admin/appointment 同一支——「顧問針對這一位人選、這一次客戶面談」手動
// 輸入候選時段，不是系統自動排的格子（那是 /book，阿財面談用的，不同一件事）。
// stage 固定傳 0（顧問電話洽談）：舊版原本設計 1-4 給企業面談各階段用，但現在
// 的畫面已經簡化成只剩這一個選項，照抄現況、不畫一個假的下拉。
async function submitAppointment(applicationId) {
  const rows = $$('#appt-rows .appt-row');
  const slots = rows.map((row) => {
    const d = row.querySelector('.appt-date')?.value;
    const t = row.querySelector('.appt-time')?.value;
    const f = row.querySelector('.appt-fmt')?.value;
    const u = row.querySelector('.appt-url')?.value.trim();
    if (!d || !t) return null;
    return u ? { slot_at: `${d} ${t}`, format: f, meeting_url: u } : { slot_at: `${d} ${t}`, format: f };
  }).filter(Boolean);
  if (!slots.length) return toast('至少要填一個完整的日期＋時間', 'error');
  const btn = $('#appt-submit');
  const result = $('#appt-result');
  if (btn) btn.disabled = true;
  try {
    const res = await api.post('/admin/appointment', {
      application_id: applicationId, slots, stage: 0,
      note: $('#appt-note')?.value.trim() || '',
      interviewer: $('#appt-interviewer')?.value.trim() || '',
      location: $('#appt-location')?.value.trim() || '',
    });
    if (!res.ok) { if (result) result.innerHTML = `<div class="notice" style="background:#ffe5e7;border-color:#eab8bc;color:#a72f3a">❌ ${text(res.error || '失敗')}</div>`; return; }
    if (result) result.innerHTML = res.notified
      ? `<div class="notice" style="background:#e2f8ed;border-color:#bfe3c8;color:#14794c">✅ 已安排，面談卡片已送到他的 LINE</div>`
      : `<div class="notice">⚠️ 時段已存好，但沒有送到人選手上（${res.notify_reason === 'no_line_binding' ? '這位人選還沒有綁定 LINE' : 'LINE 推播失敗'}）。請自己把連結傳給他：<br><code>${text(res.url)}</code></div><button type="button" class="btn ghost sm" data-copy-text="${escapeHtml(res.url)}" style="margin-top:6px">複製連結</button>`;
    toast('面談時段已建立', 'success');
  } catch (error) { console.error(error); if (result) result.textContent = '❌ ' + error.message; toast(error.message, 'error'); }
  finally { if (btn) btn.disabled = false; }
}

// /admin/resume/:id 需要 Bearer token 才能拿到檔案，不能直接當 <a href> 用——
// 用 fetch 帶認證抓成 blob 再開新分頁，跟其餘 GET 一樣走 CONFIG.apiBase。
async function downloadResume(applicationId) {
  try {
    const res = await fetch(`${CONFIG.apiBase}/admin/resume/${encodeURIComponent(applicationId)}`, {
      headers: { authorization: `Bearer ${localStorage.getItem(CONFIG.tokenKey) || ''}` },
    });
    if (!res.ok) { const body = await res.json().catch(() => null); throw new Error(body?.error || `下載失敗 HTTP ${res.status}`); }
    const blob = await res.blob();
    // 2026-10-06 修：#80 宋思潁的履歷是 Word 檔，原本一律開新分頁預覽，瀏覽器只會顯示「無法載入外掛程式」。
    // PDF／圖片照舊開新分頁看；其他格式（Word、Excel…）直接下載成檔案。
    const type = (blob.type || res.headers.get('content-type') || '').toLowerCase();
    if (/pdf|image\//.test(type)) { window.open(URL.createObjectURL(blob), '_blank'); return; }
    const cd = res.headers.get('content-disposition') || '';
    const m = cd.match(/filename\*=UTF-8''([^;]+)/) || cd.match(/filename="?([^";]+)"?/);
    let filename = '';
    if (m) { try { filename = decodeURIComponent(m[1]); } catch { filename = m[1]; } }
    if (!filename) {
      const ext = /wordprocessingml/.test(type) ? 'docx' : /msword/.test(type) ? 'doc' : /spreadsheetml/.test(type) ? 'xlsx' : 'bin';
      filename = `履歷.${ext}`;
    }
    const url = URL.createObjectURL(blob);
    const el = document.createElement('a');
    el.href = url; el.download = filename; document.body.appendChild(el); el.click(); el.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    toast(`已下載「${filename}」（Word 檔無法在瀏覽器預覽）`, 'success');
  } catch (error) { console.error(error); toast(error.message, 'error'); }
}

// 通用檔案下載（2026-09-29，總指揮交辦）：/admin/file/:id 走同一套「帶
// Bearer token fetch 成 blob」模式——跟上面的 downloadResume() 邏輯完全
// 一樣，差別只在網址跟錯誤訊息，抽成一支共用的，之後任何要接這支端點的
// 下載按鈕（客製表單、客戶版履歷、收費證明…）都呼叫這支，不要各自重寫一份。
async function downloadFileGeneric(fileId, path, label = '檔案') {
  try {
    const res = await fetch(`${CONFIG.apiBase}${path}`, {
      headers: { authorization: `Bearer ${localStorage.getItem(CONFIG.tokenKey) || ''}` },
    });
    if (!res.ok) { const body = await res.json().catch(() => null); throw new Error(body?.error || `下載失敗 HTTP ${res.status}`); }
    const blob = await res.blob();
    const cd = res.headers.get('content-disposition') || '';
    const m = cd.match(/filename\*=UTF-8''([^;]+)/);
    let filename = label;
    if (m) { try { filename = decodeURIComponent(m[1]); } catch { /* 用預設檔名 */ } }
    const url = URL.createObjectURL(blob);
    const el = document.createElement('a');
    el.href = url; el.download = filename; document.body.appendChild(el); el.click(); el.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (error) { console.error(error); toast(error.message, 'error'); }
}
const downloadFormSubmission = (id) => downloadFileGeneric(id, `/admin/candidate-form-submissions/${encodeURIComponent(id)}/download`, '表單');
const downloadBillingProof = (id) => downloadFileGeneric(id, `/admin/billing-installments/${encodeURIComponent(id)}/proof`, '匯款證明');

async function openJobManage(slug, initialTab = 'manage') {
  drawer({ title: '載入職缺…', body: loading() });
  try {
    const [jobsData, content, card, acai, sourced] = await Promise.all([
      adapters.jobs(), adapters.jobContent(slug).catch(() => ({})),
      // 職缺卡（對話 B）：失敗不擋整個抽屜開啟，退回空卡片一樣可以匯入第一筆。
      adapters.jobCard(slug).catch(() => null),
      adapters.jobAcaiView(slug).catch(() => null),
      // 「AI 找的人」分頁（2026-09-29）：失敗不擋抽屜，分頁裡顯示載入失敗。
      adapters.jobSourced(slug).catch(() => null)]);
    const job = jobsData.jobs.find((j) => (j.slug || j.id) === slug) || { slug };
    try { const fr = await api.get(`/admin/jobs/${encodeURIComponent(slug)}/full`); job.__facts = (fr && fr.job) || {}; } catch { job.__facts = {}; }
    // 2026-09-21：題庫加進職缺抽屜。adapters.jobs() 本來就會一併抓
    // /admin/expertise，這裡直接從同一包資料撈，不用為了抽屜再打一次 API。
    const raw = (jobsData.expertise || []).find((e) => e.job_slug === slug);
    let bank = null;
    if (raw) {
      let parsed = [];
      // ⚠️ questions_json 可能是 SQL NULL。JSON.parse(null) 回 null 而且不丟例外，
      // try/catch 接不到，後面 .length 就整頁炸掉（2026-09-21 在總覽頁踩過同一個坑）。
      try { parsed = JSON.parse(raw.questions_json); } catch { parsed = []; }
      bank = { ...raw, questions: Array.isArray(parsed) ? parsed : [] };
      bank._n = bank.questions.length;
    }
    const isBuilding = (jobsData.expertiseBuilding || []).includes(slug);
    drawer({ title: job.title || slug, subtitle: job.company_name || job.client_name || '',
             body: views.jobManageBody(job, content, bank, isBuilding, card, acai, sourced) });
    // 2026-10-23 這個職缺的「上傳履歷」連結（公開招募中的職缺才給）
    if (!['closed', 'social_only', 'draft'].includes(String(job.status || ''))) {
      document.querySelector('#overlay-root .drawer-body')?.insertAdjacentHTML('afterbegin',
        `<div class="actions-row" style="margin-bottom:10px">${resumeLinkButtons({ jobSlug: job.slug || slug, jobTitle: job.title || '', tab: 'apply' })}<span class="help" style="align-self:center">這個職缺的應徵連結／上傳履歷連結</span></div>`);
    }
    // 分頁切換。四個面板都已經 render 好，純顯示／隱藏，不 lazy-load
    // ——題庫／職缺卡／阿財理解資料上面已經拿到了，再延遲載入只是多一次往返。
    const PANELS = ['manage', 'preview', 'sourced', 'expertise', 'card', 'acai'];
    $$('[data-jobtab]').forEach((btn) => {
      btn.onclick = () => {
        $$('[data-jobtab]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const which = btn.getAttribute('data-jobtab');
        PANELS.forEach((k) => { const el = $(`#job-tab-${k}`); if (el) el.hidden = which !== k; });
        // JD 預覽：切到這個分頁才載入，開抽屜不會每次都多抓一整頁
        if (which === 'preview') { const f = $('.jd-preview-frame'); if (f && !f.src) f.src = `${f.dataset.src}?v=${Date.now()}`; }
      };
    });
    // 從職缺卡卡片牆點進來要直接落在「職缺卡」分頁，不是每次都回到「管理」。
    if (initialTab !== 'manage') {
      const btn = $$('[data-jobtab]').find((b) => b.getAttribute('data-jobtab') === initialTab);
      btn?.onclick?.();
    }
    // 「阿財的理解」卡片裡「這裡不對」的跳轉：同一個抽屜內的分頁（面談題庫／
    // 職缺卡／管理）直接切換；「必要條件」是抽屜外的頁面，關掉抽屜改用
    // navigate() 換整頁分頁。
    $$('[data-jump-tab]').forEach((btn) => {
      btn.onclick = () => {
        const target = $$('[data-jobtab]').find((b) => b.getAttribute('data-jobtab') === btn.getAttribute('data-jump-tab'));
        target?.onclick?.();
      };
    });
    $$('[data-jump-route]').forEach((btn) => {
      btn.onclick = () => { closeOverlay(); navigate('jobs', btn.getAttribute('data-jump-route')); };
    });
  } catch (error) {
    console.error(error);
    drawer({ title: '職缺載入失敗', body: errorState(error) });
  }
}

// 職缺卡卡片牆：篩選下拉＋點卡開抽屜直接落在職缺卡分頁。
function wireJobCardWall() {
  const sel = $('#jobcard-filter');
  if (sel) sel.onchange = () => { state.jobCardFilter = sel.value; loadRoute(); };
  const clientSel = $('#jobcard-client-filter');
  if (clientSel) clientSel.onchange = () => { state.jobCardClientFilter = clientSel.value; loadRoute(); };
  $$('.job-card-wall-item').forEach((btn) => {
    btn.onclick = () => openJobManage(btn.getAttribute('data-slug'), 'card');
  });
  // 待配對人選：指派回一個真正的職缺。2026-09-24 總指揮交辦。
  $$('[data-action="reassign-unmatched"]').forEach((btn) => {
    btn.onclick = async () => {
      const appId = btn.getAttribute('data-app-id');
      const select = document.querySelector(`.jc-unmatched-job-select[data-app-id="${CSS.escape(appId)}"]`);
      const jobSlug = select?.value;
      if (!jobSlug) { toast('先選一個職缺', 'error'); return; }
      btn.disabled = true;
      try {
        await adapters.reassignJobUnmatched(appId, jobSlug, state.candidateOwner || '顧問');
        toast('已指派', 'success');
        loadRoute();
      } catch (error) {
        console.error(error);
        toast(error?.message || '指派失敗', 'error');
        btn.disabled = false;
      }
    };
  });
}

async function openCompanyManage(id) {
  drawer({ title: '載入客戶…', body: loading() });
  try {
    const detail = await adapters.companyDetail(id);
    const c = detail.company || detail;
    drawer({ title: c.display_name || c.name || '客戶', subtitle: c.contact_email || '', body: views.companyDrawerBody(detail) });
    injectMailSection('client', c.id || id);
    // 客戶背景資料：在客戶抽屜上面再疊一層看，關掉就回到客戶抽屜。內容放進沙盒 iframe，文件裡的樣式／程式碼碰不到後台
    $$('[data-client-file]').forEach((btn) => {
      btn.onclick = () => downloadFileGeneric(btn.getAttribute('data-client-file'), `/admin/file/${encodeURIComponent(btn.getAttribute('data-client-file'))}`, btn.getAttribute('data-client-file-name') || '檔案');
    });
    $$('[data-client-doc]').forEach((btn) => {
      btn.onclick = async () => {
        openSubDrawer({ title: '載入中…', body: loading() });
        try {
          const r = await adapters.clientDoc(btn.getAttribute('data-client-doc'));
          const d = r.doc || {};
          openSubDrawer({ title: d.title || '客戶資料', subtitle: [c.display_name, d.doc_date].filter(Boolean).join('・'),
            body: `<iframe class="client-doc-frame" sandbox="" title="${escapeHtml(d.title || '客戶資料')}" style="width:100%;height:calc(100vh - 140px);border:1px solid var(--line,#dbe2ea);border-radius:10px;background:#fff"></iframe>` });
          const f = $('.client-doc-frame');
          if (f) f.srcdoc = d.html || '<p>這份資料是空的</p>';
        } catch (error) {
          console.error(error);
          openSubDrawer({ title: '資料載入失敗', body: errorState(error) });
        }
      };
    });
  } catch (error) {
    console.error(error);
    drawer({ title: '客戶載入失敗', body: errorState(error) });
  }
}

async function openSession(id) {
  const target = $('#detail-data');
  if (!target) return;
  await boundary(target, () => adapters.interviewDetail(id), (body) => {
    // 2026-09-15 查證更正：/admin/session/:id 真正的逐字稿欄位叫 transcript，
    // 不是 messages/session.messages（後端從沒回傳過這兩個名字）——右側面板
    // 一直顯示「目前沒有對話訊息」，不是資料庫沒有逐字稿，是欄位名對錯了。
    const messages = body.transcript || [];
    const app = body.application || body;
    const fb = body.feedback;
    return `<div class="card-head"><div><h2>${text(app.candidate_name || app.name)}</h2><p>${text(app.job_title || app.job)} · ${text(app.interview_state || app.state)}</p></div>${['done','interviewed'].includes(String(app.interview_state || app.state)) ? '<button class="btn" data-action="reopen-interview" data-id="'+escapeHtml(id)+'">重新開啟面談</button>' : ''}</div>${views.socialSourceBadge(body.social_source)}${fb ? `<div class="notice">人選給這場面談的評分：${'★'.repeat(Number(fb.rating) || 0)}${'☆'.repeat(Math.max(0, 5 - (Number(fb.rating) || 0)))}（${text(fb.rating)}/5）${fb.comment ? ' · ' + text(fb.comment) : ''}</div>` : ''}<div class="transcript">${messages.map((message) => `<div class="bubble ${String(message.role).includes('assistant') ? 'ai' : 'candidate'}"><b>${String(message.role).includes('assistant') ? '阿財' : '人選'}</b><p>${text(message.content || message.text)}</p><small>${text(message.created_at || message.at)}</small></div>`).join('') || '<div class="state">這位人選沒有跟阿財面談過，所以沒有逐字稿。顧問手動建檔、自己打電話談的人選，談話內容在「電洽」的電洽紀錄裡。</div>'}</div>`;
  });
}

function startPolling() {
  stopPolling();
  state.poll = setInterval(() => {
    if (!document.hidden && state.route === 'interviews') loadRoute();
  }, CONFIG.livePollMs);
}
function stopPolling() { if (state.poll) clearInterval(state.poll); state.poll = null; }

// 2026-09-17 補：type:'file' 欄位的值是 File 物件，不能直接塞進 JSON body——
// 這裡先濾掉，實際的 base64 轉換在 submitPendingAction 另外處理。
function formBody(form) { return Object.fromEntries([...new FormData(form)].filter(([, value]) => !(value instanceof File) && String(value).trim())); }

function readFileAsB64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('檔案讀取失敗'));
    reader.readAsDataURL(file);
  });
}

// 2026-09-15 補：對齊舊版 openNewCandModal()。job_slug 是後端硬性必填欄位
// （doManualForward 沒選職缺直接 400），沒選客戶時退回共用佔位職缺
// 'unspecified'——這是既有慣例（TG「電洽新增人選」流程本來就在用），不是這次新發明。
async function openAddCandidate() {
  modal({
    title: '＋新增人選', subtitle: '不是跟阿財面談進來的，顧問自己接觸的人選。',
    body: views.addCandidateModal([]),
    footer: '<button class="btn" data-close-overlay>取消</button><button class="btn primary" data-action="submit-add-candidate">建立這筆人選卡片</button>',
  });
  const [jobsBody, consultantsBody] = await Promise.all([
    api.get('/admin/jobs').catch(() => null), api.get('/admin/consultants').catch(() => null),
  ]);
  const consultants = consultantsBody?.consultants || consultantsBody?.items || [];
  if (consultants.length && $('#add-candidate-form')) {
    const ownerSelect = $('#add-candidate-form [name="owner"]');
    if (ownerSelect) ownerSelect.innerHTML = '<option value="">未指派</option>' +
      consultants.filter((c) => c.is_active).map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.display_name)}</option>`).join('');
  }
  const jobs = (jobsBody?.jobs || jobsBody?.items || []).filter((j) => j.slug !== 'unspecified');
  const jobsByCompany = {};
  const companyOrder = [];
  const companyNames = {};
  jobs.forEach((j) => {
    if (!j.company_id) return;
    if (!companyNames[j.company_id]) { companyNames[j.company_id] = j.company_display_name || j.company_name || '（未命名客戶）'; companyOrder.push(j.company_id); }
    (jobsByCompany[j.company_id] = jobsByCompany[j.company_id] || []).push({ slug: j.slug, title: j.title, locations: j.locations || j.location || '' });
  });
  const companySelect = $('#ac-company');
  const jobSelect = $('#ac-job');
  if (!companySelect || !jobSelect) return;
  companySelect.innerHTML = '<option value="">不指定客戶／職缺</option>' +
    companyOrder.map((cid) => `<option value="${escapeHtml(cid)}">${escapeHtml(companyNames[cid])}</option>`).join('');
  companySelect.onchange = () => {
    const cid = companySelect.value;
    if (!cid) { jobSelect.innerHTML = '<option value="">（不指定，將建立為未配對職缺的人選）</option>'; jobSelect.disabled = true; return; }
    jobSelect.disabled = false;
    jobSelect.innerHTML = '<option value="">選一個職缺…</option>' + (jobsByCompany[cid] || []).map((j) => `<option value="${escapeHtml(j.slug)}">${escapeHtml(jobOptLabel(j))}</option>`).join('');
  };
}

async function submitAddCandidate() {
  const form = $('#add-candidate-form');
  if (!form) return;
  const name = form.querySelector('[name="name"]').value.trim();
  const email = form.querySelector('[name="email"]').value.trim();
  const phone = form.querySelector('[name="phone"]').value.trim();
  if (!name) return toast('請填姓名', 'error');
  if (!email && !phone) return toast('至少要填 Email 或電話其中一個', 'error');
  const companySelect = $('#ac-company'); const jobSelect = $('#ac-job');
  if (companySelect?.value && !jobSelect?.value) return toast('已選客戶，請再選一個職缺（或改回「不指定客戶／職缺」）', 'error');
  if (!$('#ac-consent')?.checked) return toast('請先確認已取得本人同意', 'error');
  const button = $('[data-action="submit-add-candidate"]');
  if (button) button.disabled = true;
  const jobSlug = companySelect?.value ? jobSelect.value : 'unspecified';
  const body = {
    source_kind: 'new', name, email, phone, job_slug: jobSlug,
    owner: form.querySelector('[name="owner"]').value || null,
    source_channel: form.querySelector('[name="source_channel"]').value,
    resume_source: form.querySelector('[name="resume_source"]').value,
    call_notes: form.querySelector('[name="call_notes"]').value.trim(),
    consent_confirmed: true, by: '顧問',
  };
  const submit = async () => {
    try {
      const result = await api.post('/admin/pipeline/manual-forward', body);
      closeOverlay();
      toast(result.message || '人選卡片已建立', 'success');
      refreshCurrentView();
    } catch (error) {
      console.error(error); toast(error.message, 'error');
      if (button) button.disabled = false;
    }
  };
  const fileInput = $('#ac-resume');
  if (fileInput?.files?.[0]) {
    const file = fileInput.files[0];
    const reader = new FileReader();
    reader.onload = () => { body.resume_b64 = String(reader.result).split(',')[1]; body.resume_name = file.name; body.resume_mime = file.type; submit(); };
    reader.readAsDataURL(file);
  } else {
    submit();
  }
}

// 2026-09-15 加：「推薦給客戶」原本只有客戶下拉，選不到要推哪個職缺——
// /admin/forward-candidate 其實吃 job_slug（不傳才退回人選自己原本應徵的那個
// 職缺），改成客戶→職缺級聯選單，照抄「＋新增人選」那顆的模式。
async function openForwardCandidate(applicationId) {
  modal({
    title: '推薦給客戶', subtitle: '不選職缺就沿用這位人選原本應徵的職缺。',
    body: views.forwardCandidateModal(),
    footer: '<button class="btn" data-close-overlay>取消</button><button class="btn primary" data-action="submit-forward-candidate" data-application-id="' + escapeHtml(applicationId) + '">確認推薦</button>',
  });
  const [companies, jobs] = await Promise.all([ensureCompanies(), ensureJobs()]);
  const jobsByCompany = {};
  jobs.forEach((j) => { if (j.company_id) (jobsByCompany[j.company_id] = jobsByCompany[j.company_id] || []).push({ slug: j.slug, title: j.title, locations: j.locations || j.location || '' }); });
  const companySelect = $('#fc-company');
  const jobSelect = $('#fc-job');
  if (!companySelect || !jobSelect) return;
  // 2026-10-27：「只留面試紀錄，不推薦」——勾了要填原因、不寄表單、按鈕字跟著換
  const nrBox = $('#fc-not-rec');
  if (nrBox) nrBox.onchange = () => {
    const on = nrBox.checked;
    const wrap = $('#fc-nr-reason-wrap'); if (wrap) wrap.hidden = !on;
    const sf = $('#fc-send-forms'); if (sf) { if (on) sf.checked = false; sf.disabled = on; }
    const btn = $('[data-action="submit-forward-candidate"]'); if (btn) btn.textContent = on ? '確認（只留紀錄，不推薦）' : '確認推薦';
    if (on) $('#fc-nr-reason')?.focus();
  };
  companySelect.innerHTML = '<option value="">選一家客戶…</option>' + companies.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.display_name)}</option>`).join('');
  companySelect.onchange = () => {
    const cid = companySelect.value;
    // 2026-10-21 Jacky：只有這家客戶有「會自動寄的表單」才顯示勾選，預設勾起來
    const fRow = $('#fc-forms-row'), fBox = $('#fc-send-forms'), fTxt = $('#fc-forms-text');
    if (fRow) fRow.hidden = true;  // [hidden] 被 display:flex 蓋掉，下面用 style 一起控制
    if (fRow) fRow.style.display = 'none';
    if (cid && fRow) api.get('/admin/job-forms?company_id=' + encodeURIComponent(cid)).then((r) => {
      const forms = ((r && (r.data || r).forms) || []);
      if (companySelect.value !== cid || !forms.length) return;
      // 2026-10-24 Jacky：推薦≠客戶要面談。推薦時一律不寄，客戶在後台按「推進」才自動寄；這裡只做提示、不給勾。
      // 2026-10-27 Jacky：加回勾選框，預設不勾；勾了推薦時一起寄（信裡寫「填完先給用人單位看，有意願才約面談」）。
      fRow.hidden = false; fRow.style.display = 'flex'; fBox.checked = false; fBox.disabled = !!$('#fc-not-rec')?.checked; fBox.style.display = '';
      fTxt.textContent = `勾了才會寄：${forms.map((f) => f.name).join('、')}。信裡會寫「填好先給用人單位看，有意願才約面談」。不勾就不寄。`;
    }).catch(() => {});
    const list = jobsByCompany[cid] || [];
    if (!cid || !list.length) { jobSelect.innerHTML = '<option value="">（沿用原本應徵的職缺）</option>'; jobSelect.disabled = true; return; }
    jobSelect.disabled = false;
    jobSelect.innerHTML = '<option value="">（沿用原本應徵的職缺）</option>' + list.map((j) => `<option value="${escapeHtml(j.slug)}">${escapeHtml(jobOptLabel(j))}</option>`).join('');
  };
}

async function submitForwardCandidate(applicationId) {
  const form = $('#forward-candidate-form');
  if (!form) return;
  const companyId = $('#fc-company')?.value;
  if (!companyId) return toast('請選一家客戶', 'error');
  const button = $('[data-action="submit-forward-candidate"]');
  if (button) button.disabled = true;
  try {
    // 2026-10-19 Jacky：卡片每一筆推薦要看得出是誰推的——推薦當下記「我是」選的那個人。
    const me = amUi().me;
    if (!me) { toast('先在畫面最上方選「我是」，系統才記得是誰推薦的', 'error'); document.querySelector('[data-me-global]')?.focus(); if (button) button.disabled = false; return; }
    const notRec = !!$('#fc-not-rec')?.checked;
    const nrReason = ($('#fc-nr-reason')?.value || '').trim();
    if (notRec && !nrReason) { toast('勾了「只留面試紀錄」要填不推進原因（客戶看得到）', 'error'); $('#fc-nr-reason')?.focus(); if (button) button.disabled = false; return; }
    const result = await api.post('/admin/forward-candidate', {
      send_forms: notRec ? false : !!$('#fc-send-forms')?.checked,  // 2026-10-27：預設不勾，勾了才寄；只留紀錄一律不寄
      application_id: applicationId, company_id: companyId, by: me,
      job_slug: $('#fc-job')?.value || undefined,
      note: form.querySelector('[name="note"]').value.trim() || undefined,
      record_only: notRec || undefined,
    });
    // 2026-10-28：已經推薦給這家過了 → 這次什麼都沒建，不能接著把那筆正在進行的推薦標成「顧問不推進」
    if (result && result.already_forwarded) {
      toast(result.message || '已經推薦給這家客戶過了，這次沒有新增', 'error');
      if (button) button.disabled = false;
      return;
    }
    if (notRec) {
      // 第二步：標「顧問不推進」。第一步已建好紀錄，這步失敗要講清楚，讓顧問去卡片上補按
      try {
        await api.post('/admin/pipeline/forward-decision', { application_id: applicationId, company_id: companyId, not_recommended: true, reason: nrReason });
      } catch (err2) {
        toast(`紀錄已建立，但「顧問不推進」沒標上（${err2.message}）——到推薦客戶分頁那家客戶按「標不推進」補上`, 'error');
        if (state.openCandidateId) openCandidate(state.openCandidateId, { fresh: true });
        return;
      }
      toast(`已留紀錄給 ${result.company || '客戶'}（顧問不推進）`, 'success');
      if (state.openCandidateId) openCandidate(state.openCandidateId, { fresh: true });
      else { closeOverlay(); refreshCurrentView(); }
      return;
    }
    toast(`已推薦給 ${result.company || '客戶'}`, 'success');
    if (state.openCandidateId) openCandidate(state.openCandidateId, { fresh: true });
    else { closeOverlay(); refreshCurrentView(); }
  } catch (error) {
    console.error(error); toast(error.message, 'error');
    if (button) button.disabled = false;
  }
}

// 2026-09-15 加：人才池「轉入正式應徵（顧問建檔）」——顧問聯絡得到、但要自己幫
// 他建應徵單（跟「邀請應徵」寄連結讓本人自己填是兩條不同的路）。照抄
// openAddCandidate 的公司→職缺級聯選單，差在 source_kind:'sourced' + source_id。
async function openConvertSourced(sourcedId) {
  const list = await ensureSourcedList();
  const record = list.find((s) => String(s.id) === String(sourcedId)) || { id: sourcedId };
  modal({
    title: '轉入正式應徵（顧問建檔）', subtitle: '幫這位人才池的人選直接建立應徵單。',
    body: views.convertSourcedModal(record),
    footer: '<button class="btn" data-close-overlay>取消</button><button class="btn primary" data-action="submit-convert-sourced" data-sourced-id="' + escapeHtml(String(sourcedId)) + '">建立應徵單</button>',
  });
  const [companies, jobs] = await Promise.all([ensureCompanies(), ensureJobs()]);
  const jobsByCompany = {};
  jobs.forEach((j) => { if (j.company_id) (jobsByCompany[j.company_id] = jobsByCompany[j.company_id] || []).push({ slug: j.slug, title: j.title, locations: j.locations || j.location || '' }); });
  const companySelect = $('#cs-company');
  const jobSelect = $('#cs-job');
  if (!companySelect || !jobSelect) return;
  companySelect.innerHTML = '<option value="">選一家客戶…</option>' + companies.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.display_name)}</option>`).join('');
  companySelect.onchange = () => {
    const cid = companySelect.value;
    const list2 = jobsByCompany[cid] || [];
    if (!cid || !list2.length) { jobSelect.innerHTML = '<option value="">（先選客戶）</option>'; jobSelect.disabled = true; return; }
    jobSelect.disabled = false;
    jobSelect.innerHTML = '<option value="">選一個職缺…</option>' + list2.map((j) => `<option value="${escapeHtml(j.slug)}">${escapeHtml(jobOptLabel(j))}</option>`).join('');
  };
}

async function submitConvertSourced(sourcedId) {
  const jobSlug = $('#cs-job')?.value;
  if (!jobSlug) return toast('請選客戶跟職缺', 'error');
  if (!$('#cs-consent')?.checked) return toast('請先確認已取得本人同意', 'error');
  const button = $('[data-action="submit-convert-sourced"]');
  if (button) button.disabled = true;
  try {
    const result = await api.post('/admin/pipeline/manual-forward', {
      source_kind: 'sourced', source_id: sourcedId, job_slug: jobSlug, consent_confirmed: true, by: '顧問',
    });
    closeOverlay();
    toast(result.message || '應徵單已建立', 'success');
    refreshCurrentView();
  } catch (error) {
    console.error(error); toast(error.message, 'error');
    if (button) button.disabled = false;
  }
}

async function ensureSourcedList() {
  if (!state.sourcedCache) {
    try { const body = await api.get('/admin/sourced'); state.sourcedCache = body.rows || body.items || body.candidates || []; }
    catch (error) { console.error(error); state.sourcedCache = []; }
  }
  return state.sourcedCache;
}

// 2026-09-24：客戶改成下拉（同一支 /admin/portal/companies，跟客戶清單共用），
// 選了客戶就依它在客戶清單的關係自動帶入「客戶對象」，顧問仍可手動改。
const RELATION_TO_INTAKE = { signed: 'signed', private: 'private' };
async function openJobIntake() {
  let companies = [];
  try { companies = (await adapters.clients()).companies || []; } catch (e) { toast(`讀不到客戶清單：${e.message}`, 'error'); }
  // 2026-09-24：補送件人。沒有這格，TG 審核訊息一直顯示「送件人未填寫」，
  //   不知道是哪位顧問開的單。預設帶「人選中心目前選的顧問」。
  const consultants = await ensureConsultants();
  modal({ title: '建立用人需求', subtitle: '送出後進入 AI 擬稿，不會直接建立正式職缺。', body: views.jobIntakeModal(companies, consultants, state.candidateOwner), footer: '<button class="btn" data-close-overlay>取消</button><button class="btn primary" data-action="submit-job-intake">送出需求</button>' });
  const form = $('#job-intake-form');
  const pick = form?.querySelector('[name="client_pick"]');
  pick?.addEventListener('change', () => {
    const isNew = pick.value === '__new__';
    $('#ji-newname-wrap').hidden = !isNew;
    form.querySelector('[name="client_new"]').required = isNew;
    const rel = pick.selectedOptions[0]?.dataset.relation;
    if (!isNew && pick.value) form.querySelector('[name="client_relation"]').value = RELATION_TO_INTAKE[rel] || 'unsigned';
  });
}

async function submitJobIntake() {
  const form = $('#job-intake-form');
  if (!form?.reportValidity()) return;
  const button = $('[data-action="submit-job-intake"]');
  const body = formBody(form);
  body.client_name = body.client_pick === '__new__' ? (body.client_new || '').trim() : body.client_pick;
  delete body.client_pick; delete body.client_new;
  // 檔案轉 base64，格式跟舊版 job-intake 頁一樣（name/mime/kind/b64）
  const files = [];
  for (const f of form.querySelector('[name="files"]')?.files || []) {
    if (f.size > 8 * 1024 * 1024) { toast(`「${f.name}」超過 8MB，請改貼雲端連結`, 'error'); return; }
    const b64 = await new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = bad; r.readAsDataURL(f); });
    files.push({ name: f.name, mime: f.type || 'application/octet-stream', kind: /\.pdf$/i.test(f.name) ? 'pdf' : (/^image\//.test(f.type) ? 'image' : (/\.(docx?|xlsx?|csv|md|txt)$/i.test(f.name) ? 'document' : 'other')), b64 });
  }
  if (!body.raw_text && !body.source_url && !files.length) { toast('至少要給一種資料：文字、連結，或上傳檔案', 'error'); return; }
  body.files = files;
  button.disabled = true;
  try { const d = await api.post('/admin/job-intake', body); closeOverlay(); toast(`收到了（附件 ${d?.files ?? files.length} 個）。總指揮擬好會發到 Telegram 群組等你核准`, 'success'); loadRoute(); }
  catch (error) { console.error(error); toast(error.message, 'error'); button.disabled = false; }
}

async function submitSocialRequest() {
  const form = $('#social-request-form');
  if (!form?.reportValidity()) return;
  try { await api.post('/admin/social-post-request', formBody(form)); closeOverlay(); toast('發文需求已建立；仍會經 Telegram 人工核准', 'success'); loadRoute(); }
  catch (error) { console.error(error); toast(error.message, 'error'); }
}

async function saveJobContent(slug, body, confirmation = {}) {
  try { return await api.post(`/admin/jobs/${encodeURIComponent(slug)}/content`, { ...body, ...confirmation }); }
  catch (error) {
    if (error instanceof ApiError && error.status === 409 && ['template_mismatch','content_shrink'].includes(error.body?.code || error.body?.error)) {
      const code = error.body.code || error.body.error;
      const message = code === 'template_mismatch' ? '偵測到目前頁面含非標準模板內容，為避免覆蓋客製區塊，請再次確認。' : '新內容比現有內容大幅縮短，可能造成資料被意外清除。';
      state.jobContentRetry = { slug, body };
      modal({ title: '需要二次確認', subtitle: message, dangerous: true, body: `<p>${escapeHtml(error.body?.message || '')}</p>`, footer: '<button class="btn" data-close-overlay>取消</button><button class="btn danger" data-action="confirm-job-content">確認仍要儲存</button>' });
      return null;
    }
    throw error;
  }
}

async function submitJobContent(slug) {
  const form = $('#job-content-form');
  const button = $('[data-action="submit-job-content"]');
  if (!form || !button) return;
  button.disabled = true;
  try {
    // 只送有改的欄位（跟舊後台一樣），沒改的欄位不動，避免整頁被覆蓋
    const fields = {};
    for (const el of form.querySelectorAll('[data-kind]')) {
      const kind = el.dataset.kind;
      const now = jdFieldParse(kind, el.value), before = jdFieldParse(kind, el.dataset.orig);
      if (JSON.stringify(now) !== JSON.stringify(before)) fields[el.name] = now;
    }
    // 官網「顯示／隱藏」開關：沒勾的區塊存進 hidden，發布時不產生那一段
    const hiddenNow = [...form.querySelectorAll('[data-show]')].filter((x) => !x.checked).map((x) => x.getAttribute('data-show')).sort();
    let hiddenOrig = []; try { hiddenOrig = JSON.parse(form.querySelector('#jd-hidden-orig')?.value || '[]').slice().sort(); } catch { hiddenOrig = []; }
    if (JSON.stringify(hiddenNow) !== JSON.stringify(hiddenOrig)) fields.hidden = hiddenNow;
    if (!Object.keys(fields).length) { toast('沒有改到任何欄位', 'error'); return; }
    const result = await saveJobContent(slug, { fields });
    if (result !== null) { toast('職缺內容已儲存', 'success'); openJobManage(slug); }
  } catch (error) {
    console.error(error);
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

// 職缺卡（對話 B，2026-09-24）：文字＋截圖擇一或都給，截圖轉 base64 走跟
// job-intake 附件同一套（見 submitJobIntake），POST 後端只是排隊，實際整理
// 要本機 ai_worker.py 接手，所以這裡送出後直接重開抽屜——GET 卡片會帶
// importing 狀態，顧問看得到「正在整理」而不是以為沒反應。
async function submitJobCardFeedback(slug) {
  const form = $('#job-card-feedback-form');
  const button = $('[data-action="submit-job-card-feedback"]');
  if (!form || !button) return;
  const text = form.querySelector('[name="text"]')?.value.trim() || '';
  const file = form.querySelector('[name="image"]')?.files?.[0] || null;
  if (!text && !file) { toast('要貼文字或傳截圖，至少一個', 'error'); return; }
  button.disabled = true;
  try {
    // 這個後台目前沒有個別登入身分（共用 ADMIN_TOKEN），沒有可靠的「現在是誰在按」
    // 可以帶——跟其餘同類型欄位（job-content 等）一樣不猜，後端沒收到就顯示「顧問」。
    const applicationId = form.querySelector('[name="application_id"]')?.value || '';
    const body = { text: text || undefined, application_id: applicationId || undefined };
    if (file) {
      if (file.size > 6 * 1024 * 1024) { toast('截圖太大，請截小範圍再傳一次', 'error'); button.disabled = false; return; }
      body.image_b64 = await new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = bad; r.readAsDataURL(file); });
      body.image_ext = (file.name.split('.').pop() || 'png').toLowerCase();
    }
    const res = await api.post(`/admin/jobs/${encodeURIComponent(slug)}/card/import-feedback`, body);
    toast(res.message || '已送出，整理中', 'success');
    openJobManage(slug);
  } catch (error) {
    console.error(error);
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

// ---- generic mutation drawer for the ACTIONS registry ----
// 2026-10-16：列表上這位人選的「顧問」欄與 NEW 標示，指派後立刻改（列表資料與畫面都改，背景更新回來會再對齊一次）
function patchCandidateOwner(applicationId, ownerId) {
  const name = ownerId ? (((state.consultantsCache || []).find((c) => c.id === ownerId) || {}).display_name || ownerId) : '';
  (state.candidateRows || []).forEach((r) => { if (r.applicationId === applicationId) { r.ownerId = ownerId || null; r.owner = name || null; } });
  document.querySelectorAll(`#page-data [data-application="${CSS.escape(applicationId)}"]`).forEach((row) => {
    if (ownerId) row.querySelectorAll('.badge.new-cand').forEach((b) => b.remove());
    if (row.tagName === 'TR' && row.cells && row.cells[3]) row.cells[3].textContent = name || '—';
  });
}

document.addEventListener('click', (e) => {
  const inMenu = e.target.closest('.act-menu');
  if (e.target.closest('.act-menu-list button, .act-menu-list a')) { inMenu?.removeAttribute('open'); return; }
  document.querySelectorAll('.act-menu[open]').forEach((d) => { if (d !== inMenu) d.removeAttribute('open'); });
});

// 2026-10-16：卡片上的「快速設定」——改了就存，不跳彈窗
async function quickSave(appId, label, fn) {
  const box = document.querySelector(`[data-qs-app="${CSS.escape(appId)}"] [data-qs-status]`);
  if (box) box.textContent = '儲存中…';
  try {
    await fn();
    if (box) box.textContent = `✓ ${label}已儲存`;
    toast(`${label}已儲存`, 'success');
    openCandidate(appId, { fresh: true });
    if (state.route === 'candidates') refreshCurrentView();
  } catch (error) {
    console.error(error);
    if (box) box.textContent = '';
    toast(`${label}沒存成功：${error.message || error}`, 'error');
  }
}
document.addEventListener('change', (e) => {
  const wrap = e.target.closest('[data-qs-app]');
  if (!wrap) return;
  const appId = wrap.getAttribute('data-qs-app');
  if (e.target.matches('[data-qs-owner]')) {
    const owner = e.target.value;
    patchCandidateOwner(appId, owner);
    quickSave(appId, '負責顧問', () => api.post('/admin/set-owner', { kind: 'application', id: appId, owner }));
  } else if (e.target.matches('[data-qs-stage]') && e.target.value) {
    const stage = e.target.value;
    quickSave(appId, '階段', () => api.post('/admin/set-manual-stage', { application_id: appId, stage, note: '' }));
  }
});
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-qn-save]');
  if (!btn) return;
  const wrap = btn.closest('[data-qs-app]');
  const appId = wrap.getAttribute('data-qs-app');
  const content = (wrap.querySelector('[data-qn-text]').value || '').trim();
  if (!content) { toast('先打備註內容', 'error'); return; }
  const type = wrap.querySelector('[data-qn-type]').value;
  btn.disabled = true;
  quickSave(appId, '備註', () => api.post('/admin/application/notes', { application_id: appId, type, content })).finally(() => { btn.disabled = false; });
});

function refreshCurrentView() {
  if (state.route === 'candidates' && state.sub !== 'workbench' && state.sub !== 'pool') return loadRoute();
  loadRoute();
}

function openAction(actionId, rawCtx) {
  const action = ACTIONS[actionId];
  if (!action) { toast(`未知操作：${actionId}`, 'error'); return; }
  const ctx = { idParams: rawCtx.idParams || {}, record: rawCtx.record };
  if (rawCtx.bulk) {
    const ids = Array.from(state.sourcedSelected);
    if (!ids.length) { toast('請先勾選至少一筆', 'error'); return; }
    ctx.idParams = { ...ctx.idParams, ids };
  }
  const fields = typeof action.fields === 'function' ? action.fields(ctx) : (action.fields || []);
  state.pendingAction = { action, ctx };
  modal({
    title: action.label,
    subtitle: action.confirmText || '',
    dangerous: !!action.dangerous,
    body: fields.length ? `<form id="action-form">${formFields(fields, ctx.record || {})}</form>` : (action.confirmText ? '' : '<p>確定要執行此操作？</p>'),
    footer: `<button class="btn" data-close-overlay>取消</button><button class="btn ${action.dangerous ? 'danger' : 'primary'}" data-action="run-action">確認</button>`
  });
}

async function submitPendingAction() {
  if (!state.pendingAction) return;
  const { action, ctx } = state.pendingAction;
  const button = $('[data-action="run-action"]');
  const form = $('#action-form');
  if (form && !form.reportValidity()) return;
  const values = form ? formBody(form) : {};
  // FormData always yields strings; a field seeded from a numeric record value (e.g.
  // consultants.is_active) must be coerced back to a number, or a strict `=== 0`/`=== 1`
  // check on the backend silently treats every submission as the truthy branch.
  const coerced = /** @type {Record<string, unknown>} */ (values);
  if (ctx.record) {
    for (const key of Object.keys(coerced)) {
      if (typeof ctx.record[key] === 'number' && coerced[key] !== '' && !Number.isNaN(Number(coerced[key]))) coerced[key] = Number(coerced[key]);
    }
  }
  // 2026-09-17 加：type:'file' 欄位（目前只有「手動記一筆電洽重點」的逐字稿
  // 檔案用），讀成 base64 塞進 file_b64/file_name/file_mime——欄位名稱固定用
  // 這三個，是照抄 doCallNote() 既有就在吃的參數名稱（TG bot 那條路徑也是同一套），
  // 不要為了這次前端補的欄位另外發明新名字，後端不用跟著改。
  const fields = typeof action.fields === 'function' ? action.fields(ctx) : (action.fields || []);
  const fileField = fields.find((f) => f.type === 'file' && !f.textInto);
  if (fileField && form) {
    const input = form.querySelector(`[name="${fileField.name}"]`);
    const file = input?.files?.[0];
    if (file) {
      try {
        coerced.file_b64 = await readFileAsB64(file);
        coerced.file_name = file.name;
        coerced.file_mime = file.type;
      } catch { toast('檔案讀取失敗，請重新選擇檔案', 'error'); return; }
    }
  }
  if (button) button.disabled = true;
  try {
    const path = action.path(ctx);
    const body = action.body ? action.body(ctx, values) : { ...(ctx.idParams || {}), ...values };
    const options = action.recruit ? { recruit: true } : {};
    const res = await api[action.method](path, body, options);
    // 後端改了處理方式時（例：電洽摘要貼的其實是逐字稿→改交 AI 整理）用後端的說明
    toast((res && res.queued && res.message) || action.success || '已完成', 'success');
    state.pendingAction = null;
    // 2026-09-29：職缺抽屜「AI 找的人」分頁的記錄聯絡，送出後重開同一個職缺、停在同一個分頁。
    if (action.reopenJobTab && ctx.idParams.job_slug) { openJobManage(ctx.idParams.job_slug, action.reopenJobTab); return; }
    // 2026-09-29：客戶開發卡片的「新增通話心得」，送出後重開同一家公司的抽屜（看得到剛寫的那則）。
    if (action.reopenBdCompany && ctx.idParams.company) { openBdDetail(ctx.idParams.company); return; }
    // 2026-10-02 Jacky：「不是個案吧？」——任何地方存了電洽逐字稿，馬上排「產生電洽結果」，不用再按第二步
    if (action === ACTIONS['application-call-note'] && ctx.idParams && ctx.idParams.application_id) {
      adapters.postcallResultGenerate(ctx.idParams.application_id, true)
        .then(() => toast('逐字稿已存，AI 開始整理電洽結果（1～3 分鐘）', 'success')).catch(() => {});
    }
    // 2026-09-15 改：使用者反映「每次一個操作都會自己關閉卡片」——因為
    // modal()／drawer() 共用同一個 #overlay-root，開確認框那一刻卡片其實已經
    // 被蓋掉了，之前又緊接著 closeOverlay()+refreshCurrentView() 直接跳回列表。
    // 如果這個操作是在人選卡片裡點出來的（state.openCandidateId 有值），
    // 送出後重新打開同一位人選的卡片（拿到最新資料），不要被丟回列表；
    // 其他情境（職缺／客戶等其他抽屜或跟卡片無關的操作）維持原本行為。
    // 2026-10-16 Jacky：卡片裡指派完，後面的列表要馬上變（顧問名字出現、NEW 消失），不用等整份重抓。
    if (action === ACTIONS['set-owner'] && ctx.idParams && ctx.idParams.kind === 'application') patchCandidateOwner(ctx.idParams.id, values.owner || '');
    // 2026-10-30 Jacky「還是卡卡的」：LINE ID 存完直接改快取重畫，不重抓 4～5 秒的整張卡
    const lineCached = action === ACTIONS['cand-line-id'] && state.openCandidateId ? cardCache.get(state.openCandidateId) : null;
    if (lineCached) {
      const v = String(values.line_id || '').trim() || null;
      lineCached.line_id_manual = v;
      (lineCached.forwards || []).forEach((f) => { f.line_id_given = v; });
      openCandidate(state.openCandidateId, { patch: true });
    } else if (state.openCandidateId) {
      openCandidate(state.openCandidateId, { fresh: true });
      // 卡片開著時，後面的列表也在背景悄悄更新（不清空畫面，見 core/ui.js boundary）
      if (state.route === 'candidates' && action !== ACTIONS['cand-line-id']) refreshCurrentView();   // 2026-10-30 LINE ID 不在列表上，不用重抓整份列表（卡頓）
    }
    else { closeOverlay(); refreshCurrentView(); }
  } catch (error) {
    console.error(error);
    toast(error.message, 'error');
    if (button) button.disabled = false;
  }
}

function updateSourcedCount() {
  const el = $('#sourced-count');
  if (el) el.textContent = `已選 ${state.sourcedSelected.size} 筆`;
}

document.addEventListener('click', async (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  const route = target.closest('[data-route]');
  if (route) {
    event.preventDefault();
    // 手機上選了項目就把抽屜收起來——不然選完還要再手動關一次。
    document.querySelector('.sidebar')?.classList.remove('open');
    document.querySelector('.sidebar-backdrop')?.remove();
    navigate(route.getAttribute('data-route'));
    return;
  }
  const tab = target.closest('[data-tab-scope]');
  if (tab) { navigate(tab.getAttribute('data-tab-scope'), tab.getAttribute('data-tab')); return; }
  if (target.closest('[data-close-overlay]')) {
    // 取消一個從人選卡片點出來的子彈窗（不管是 openAction 的確認框，還是
    // openForwardCandidate 這種自訂彈窗），應該回到卡片本身，不是整個關掉——
    // modal()／drawer() 共用同一個 overlay，開子彈窗那一刻卡片視覺上已經被蓋掉。
    // 用「目前蓋在最上面的是不是 .modal」判斷，不只認 pendingAction 那一種子彈窗；
    // 卡片自己的 .drawer 被關（沒有 .modal 疊在上面），才是真的要整個關閉。
    const subModalOpen = !!document.querySelector('#overlay-root .modal');
    if (subModalOpen && state.openCandidateId) { state.pendingAction = null; openCandidate(state.openCandidateId, { fresh: true }); return; }
    state.openCandidateId = null;
    closeOverlay();
    return;
  }
  const openAct = target.closest('[data-open-action]');
  if (openAct) {
    const actionId = openAct.getAttribute('data-open-action');
    const ctx = JSON.parse(openAct.getAttribute('data-ctx') || '{}');
    // 指派顧問／推薦客戶這幾顆需要真實名單才能做成下拉選單，openAction 本身是
    // 同步的沒辦法自己發 async 請求——先在這裡抓好名單塞進 ctx.record 再開。
    if (actionId === 'set-owner' || actionId === 'sourced-assign-owner' || actionId === 'job-draft-assign') { ensureConsultants().then((list) => openAction(actionId, { ...ctx, record: { ...(ctx.record || {}), _consultants: list } })); return; }
    if (actionId === 'sourced-invite') { ensureJobs().then((list) => openAction(actionId, { ...ctx, record: { ...(ctx.record || {}), _jobs: list.filter((j) => j.slug !== 'unspecified') } })); return; }
    if (actionId === 'application-update') { ensureJobs().then((list) => openAction(actionId, { ...ctx, record: { ...(ctx.record || {}), _jobs: list.filter((j) => j.slug !== 'unspecified') } })); return; }
    openAction(actionId, ctx);
    return;
  }
  // 2026-10-15 Jacky：今日下一步那列按「✓ 完成／取消／我看過了」不要連帶打開人選卡片（按鈕在整列可點的區塊裡）
  if (target.closest('[data-dly]')) return;
  // 2026-10-23：人選卡片上的「📄 看履歷」在整張可點的卡片裡——先攔下來開履歷，不要連帶打開應徵單
  const cardResumeBtn = target.closest('[data-application] [data-download-resume]');
  if (cardResumeBtn) { downloadResume(cardResumeBtn.getAttribute('data-download-resume')); return; }
  if (target.closest('[data-application] a.cc-resume')) return;
  const application = target.closest('[data-application]');
  if (application) { openCandidate(application.getAttribute('data-application')); return; }
  const session = target.closest('[data-session]');
  if (session) { openSession(session.getAttribute('data-session')); return; }
  const jobRow = target.closest('[data-job]');
  if (jobRow) { openJobManage(jobRow.getAttribute('data-job')); return; }
  const clientRow = target.closest('[data-client]');
  if (clientRow) { openCompanyManage(clientRow.getAttribute('data-client')); return; }
  const chRow = target.closest('[data-channel-id]');
  if (chRow && !target.closest('[data-dly]')) { openChannel(Number(chRow.getAttribute('data-channel-id'))); return; }
  const bdCompany = target.closest('[data-bd-company]');
  if (bdCompany) { openBdDetail(bdCompany.getAttribute('data-bd-company')); return; }
  const bdJobs = target.closest('[data-bd-jobs]');
  if (bdJobs) { openBdDetail(bdJobs.getAttribute('data-bd-jobs'), 'jobs'); return; }
  const bdMail = target.closest('[data-bd-mail]');
  if (bdMail) { openBdDetail(bdMail.getAttribute('data-bd-mail'), 'mail'); return; }
  // 2026-10-02 Jacky：點開發進度卡片本身就打開開發引導／時間軸（點到按鈕、勾選、下拉、電話連結不算）
  const bdRow = target.closest('[data-bd-open]');
  if (bdRow && !target.closest('a,button,input,select,label,textarea,summary,[data-action]')) { openBdDetail(bdRow.getAttribute('data-bd-open')); return; }
  const copyBtn = target.closest('[data-copy-text]');
  if (copyBtn) { navigator.clipboard.writeText(copyBtn.getAttribute('data-copy-text') || '').then(() => toast('已複製連結', 'success')).catch(() => toast('複製失敗，請手動選取', 'error')); return; }
  const resumeDl = target.closest('[data-download-resume]');
  if (resumeDl) { downloadResume(resumeDl.getAttribute('data-download-resume')); return; }
  const fileDl = target.closest('[data-download-file]');
  if (fileDl) { const id = fileDl.getAttribute('data-download-file'); downloadFileGeneric(id, `/admin/file/${encodeURIComponent(id)}`, '推薦履歷.pdf'); return; }
  const formDl = target.closest('[data-download-form-submission]');
  if (formDl) { downloadFormSubmission(formDl.getAttribute('data-download-form-submission')); return; }
  // 2026-09-18 加（Phase 1.1 v1.1）：整理履歷／AI 面談／查看佐證，三個都開
  // 疊在候選人抽屜之上的第二層面板（openSubDrawer），不影響底下的候選人抽屜。
  const resumeSummaryBtn = target.closest('[data-action="open-resume-summary"]');
  if (resumeSummaryBtn) {
    const rs = state.precallCardCache?.card?.resume_summary;
    openSubDrawer({ title: '📄 整理履歷', body: views.resumeSummaryBody(rs) });
    return;
  }
  const aiInterviewBtn = target.closest('[data-action="open-ai-interview"]');
  if (aiInterviewBtn) {
    const appId = aiInterviewBtn.getAttribute('data-application-id');
    openSubDrawer({ title: '🧠 AI 面談', body: loading() });
    adapters.interviewDetail(appId).then((body) => {
      openSubDrawer({ title: '🧠 AI 面談', body: views.aiInterviewBody(body) });
    }).catch((error) => {
      openSubDrawer({ title: '🧠 AI 面談', body: errorState(error) });
    });
    return;
  }
  const evidenceBtn = target.closest('[data-action="open-evidence"]');
  if (evidenceBtn) {
    const knowId = evidenceBtn.getAttribute('data-know-id');
    const item = (state.precallCardCache?.card?.conversation_flow?.known_do_not_ask || [])
      .find((k, i) => (k.id || `k_${i}`) === knowId);
    openSubDrawer({ title: `佐證｜${item ? item.label : ''}`, body: views.evidenceBody(item) });
    return;
  }
  // 2026-09-18 加：備案職缺卡片上「查看職缺介紹」——不做成常駐分頁（備案不一定
  // 每通電話都會用到，開分頁只會讓畫面塞滿沒用的東西），改用臨時彈窗，直接沿用
  // 既有「職缺介紹」tab 的同一支 view／同一支 API，不重造第二套職缺介紹畫面。
  const altJobIntroBtn = target.closest('[data-action="open-alt-job-intro"]');
  if (altJobIntroBtn) {
    const jobSlug = altJobIntroBtn.getAttribute('data-job-slug');
    openSubDrawer({ title: '職缺介紹', body: loading() });
    adapters.jobIntroGet(jobSlug).then((res) => {
      const job = res.job || res;
      openSubDrawer({ title: job.title || '職缺介紹', body: views.jobIntro(job) });
    }).catch((error) => {
      openSubDrawer({ title: '職缺介紹', body: errorState(error) });
    });
    return;
  }
  if (target.closest('[data-close-sub]')) { closeSubDrawer(); return; }
  const calDay = target.closest('[data-cal-day]');
  if (calDay) { openScheduleDay(calDay.getAttribute('data-cal-day')); return; }
  const action = target.closest('[data-action]')?.getAttribute('data-action');
  if (!action) return;
  if (action === 'token') openTokenModal();
  if (action === 'save-token') {
    const input = $('#admin-token');
    if (!input?.value.trim()) return toast('請輸入 ADMIN_TOKEN', 'error');
    localStorage.setItem(CONFIG.tokenKey, input.value.trim()); closeOverlay(); toast('已儲存憑證', 'success'); render();
  }
  if (action === 'refresh') loadRoute();
  if (action === 'job-intake') openJobIntake();
  if (action === 'submit-job-intake') submitJobIntake();
  if (action === 'add-candidate') openAddCandidate();
  if (action === 'submit-add-candidate') submitAddCandidate();
  if (action === 'open-forward-candidate') openForwardCandidate(target.closest('[data-application-id]').getAttribute('data-application-id'));
  if (action === 'submit-forward-candidate') submitForwardCandidate(target.closest('[data-application-id]').getAttribute('data-application-id'));
  if (action === 'open-convert-sourced') openConvertSourced(target.closest('[data-sourced-id]').getAttribute('data-sourced-id'));
  if (action === 'submit-convert-sourced') submitConvertSourced(target.closest('[data-sourced-id]').getAttribute('data-sourced-id'));
  if (action === 'social-request') modal({ title: '建立社群發文需求', subtitle: 'Agent 產稿後仍須 Telegram 人工核准。', body: views.socialRequestModal(), footer: '<button class="btn" data-close-overlay>取消</button><button class="btn primary" data-action="submit-social-request">建立需求</button>' });
  if (action === 'submit-social-request') submitSocialRequest();
  // 2026-10-01 加：「用這篇的寫法再排一則」——排隊列表跟一鍵發文表單
  // 同一頁，不用跨分頁，直接把表現好的這則貼文的寫法（公式／篇幅／管道）
  // 帶進上面的表單。帳號跟職缺刻意不帶，要顧問自己選要對誰發。
  if (action === 'social-repost-prefill') prefillSocialRepost(target.closest('[data-action="social-repost-prefill"]'));
  if (action === 'add-client') openAction('company-create', {});
  if (action === 'run-action') submitPendingAction();
  // 2026-09-30 Jacky：打電話問到新電話（例如招募專線在廠區），顧問自己在卡片上更新
  // 2026-09-30 Jacky：電話紀錄／通話心得記錯了可以刪
  if (action === 'bd-delete-record') {
    const d = target.dataset;
    if (!window.confirm(d.kind === 'note' ? '確定刪除這則通話心得？' : '確定刪除這通電話紀錄？刪掉後通數和日報都不會再算它。')) return;
    try {
      await api.post('/admin/bd/delete-record', { kind: d.kind, id: d.id });
      toast('已刪除', 'success'); openBdDetail(d.company);
    } catch (e) { toast(`刪除失敗：${e.message || e}`, 'error'); }
  }
  // 2026-10-01 Jacky：電話紀錄存了之後要能改（結果／補充／人資電話／窗口／信箱），改的是同一筆，不新增
  if (action === 'bd-call-edit') {
    const d = target.dataset;
    const rf = (ACTIONS['bd-call-result'].fields || []).find((f) => f.name === 'result');
    const opts = (rf ? rf.options : []).map((o) => `<option value="${escapeHtml(o.value)}"${o.value === d.result ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('');
    modal({ title: '編輯這通電話紀錄', subtitle: d.company, body: `<form id="bd-call-edit-form" class="form-grid">
      <label class="field"><span>這通電話結果</span><select name="result" required>${opts}</select></label>
      <label class="field"><span>人資電話／分機</span><input name="hr_phone" value="${escapeHtml(d.hr || '')}"></label>
      <label class="field"><span>窗口姓名／職稱</span><input name="contact_name" value="${escapeHtml(d.cname || '')}"></label>
      <label class="field"><span>信箱</span><input name="email" type="email" value="${escapeHtml(d.email || '')}"></label>
      <label class="field"><span>補充（對方說了什麼、下次什麼時候打）</span><textarea name="note" rows="4">${escapeHtml(d.note || '')}</textarea></label></form>`,
      footer: `<button class="btn" data-close-overlay>取消</button><button class="btn primary" data-action="bd-call-edit-save" data-id="${escapeHtml(d.id)}" data-company="${escapeHtml(d.company)}">儲存修改</button>` });
  }
  if (action === 'bd-call-edit-save') {
    const f = $('#bd-call-edit-form'); if (!f) return;
    const b = Object.fromEntries(new FormData(f).entries());
    b.email = String(b.email || '').replace(/[\s\u00a0\u200b-\u200d\ufeff]/g, '');
    try {
      await api.post('/admin/bd/edit-call', { id: target.dataset.id, ...b });
      closeOverlay(); toast('已更新這通電話紀錄', 'success'); openBdDetail(target.dataset.company);
    } catch (e) { toast(`儲存失敗：${e.message || e}`, 'error'); }
  }
  if (action === 'bd-phone-edit') {
    const d = target.dataset;
    modal({ title: '更新電話／Email', subtitle: d.company, body: `<form id="bd-phone-form" class="form-grid">
      <label class="field"><span>窗口 Email</span><input name="contact_email" type="email" inputmode="email" value="${escapeHtml(d.email || '')}" placeholder="例：name@company.com（要跟對方確認過拼法）"></label>
      <label class="field"><span>人資／招募電話</span><input name="hr_phone" value="${escapeHtml(d.hr || '')}" placeholder="例：06-5837608"></label>
      <label class="field"><span>人資窗口／哪個廠</span><input name="hr_contact" value="${escapeHtml(d.hrname || '')}" placeholder="例：招募（善化廠）王小姐"></label>
      <label class="field"><span>公司總機</span><input name="company_phone" value="${escapeHtml(d.main || '')}"></label>
      <label class="field"><span>怎麼問到的</span><input name="source" placeholder="例：打總機轉介"></label></form>`,
      footer: '<button class="btn" data-close-overlay>取消</button><button class="btn primary" data-action="bd-phone-save" data-company="' + escapeHtml(d.company) + '">儲存</button>' });
  }
  if (action === 'bd-phone-save') {
    const f = $('#bd-phone-form'); if (!f) return;
    const b = Object.fromEntries(new FormData(f).entries());
    try {
      await api.post('/admin/bd/phone', { company: target.dataset.company, ...b, source: b.source ? `${b.source}（顧問補登）` : '顧問補登' });
      closeOverlay(); toast('聯絡方式已更新', 'success'); openBdDetail(target.dataset.company);
    } catch (e) { toast(`更新失敗：${e.message || e}`, 'error'); }
  }
  if (action === 'confirm-job-content') {
    if (!state.jobContentRetry) return;
    const { slug, body } = state.jobContentRetry;
    state.jobContentRetry = null;
    try { await saveJobContent(slug, body, { confirm_mismatch: true, confirm_shrink: true }); closeOverlay(); toast('職缺內容已儲存', 'success'); openJobManage(slug); }
    catch (error) { console.error(error); toast(error.message, 'error'); }
  }
  if (action === 'submit-job-content') submitJobContent(target.closest('[data-slug]').getAttribute('data-slug'));
  if (action === 'save-job-facts') {
    const box = target.closest('[data-facts-box]'); const slug = box.getAttribute('data-slug');
    const facts = {};
    box.querySelectorAll('[data-fact]').forEach((el) => { if (el.value !== el.getAttribute('data-orig')) facts[el.getAttribute('data-fact')] = el.getAttribute('data-json') === '1' ? JSON.stringify(el.value) : el.value; });
    if (!Object.keys(facts).length) { toast('沒有改到任何選項', 'error'); return; }
    target.disabled = true;
    api.post(`/admin/jobs/${encodeURIComponent(slug)}/content`, { facts }).then(() => { toast('已儲存（不經 AI，馬上生效）', 'success'); openJobManage(slug); }).catch((err) => { toast(err.message || '沒有儲存成功', 'error'); target.disabled = false; });
    return;
  }
  if (action === 'submit-job-card-feedback') submitJobCardFeedback(target.closest('[data-slug]').getAttribute('data-slug'));
  if (action === 'reopen-interview') {
    try { await api.post('/admin/reopen-interview', { application_id: target.closest('[data-id]').getAttribute('data-id') }); toast('面談已重新開啟', 'success'); loadRoute(); }
    catch (error) { console.error(error); toast(error.message, 'error'); }
  }
  // 手機抽屜：開的時候補一層遮罩，點遮罩或點任一選單項目就關。
  // ⚠️ 原本只 toggle('open')——打開之後點外面關不掉、選了項目也不會自己關，
  //    要再回去按一次左上角，Jacky 在 iPhone 上踩到。
  if (action === 'toggle-menu') {
    const sb = $('.sidebar');
    const opened = sb.classList.toggle('open');
    $('.sidebar-backdrop')?.remove();
    if (opened) {
      const bd = document.createElement('div');
      bd.className = 'sidebar-backdrop';
      bd.onclick = () => { sb.classList.remove('open'); bd.remove(); };
      document.body.appendChild(bd);
    }
  }
  if (action === 'toggle-sidebar') {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    localStorage.setItem(SIDEBAR_KEY, state.sidebarCollapsed ? '1' : '0');
    $('.app-shell').classList.toggle('collapsed', state.sidebarCollapsed);
    const btn = $('.sidebar-toggle');
    if (btn) { btn.textContent = state.sidebarCollapsed ? '»' : '«'; btn.title = state.sidebarCollapsed ? '展開側欄' : '收合側欄'; }
  }
  // 2026-09-15 補：這顆「清除」按鈕本來就有 data-action，但從沒接過任何 handler，
  // 點下去什麼事都不會發生。
  if (action === 'candidate-view-card' || action === 'candidate-view-table') {
    state.candidateView = action === 'candidate-view-table' ? 'table' : 'card';
    localStorage.setItem(VIEW_KEY, state.candidateView);
    syncCandidateViewButtons();
    $('#page-data').innerHTML = state.candidateView === 'table' ? views.candidateTableRows(state.candidateRows) : views.candidateRows(state.candidateRows);
  }
  if (action === 'reset-candidate-filter') {
    if ($('#candidate-search')) $('#candidate-search').value = '';
    if ($('#candidate-stage')) $('#candidate-stage').value = '';
    if ($('#candidate-route')) $('#candidate-route').value = '';
    state.candidateOwner = '';
    localStorage.removeItem(OWNER_KEY);
    if ($('#candidate-owner')) $('#candidate-owner').value = '';
    $('#page-data').innerHTML = state.candidateView === 'table' ? views.candidateTableRows(state.candidateRows) : views.candidateRows(state.candidateRows);
    loadRoute();
  }
  // 2026-09-21 加：首頁分流卡點下去 → 跳到人選中心並套好篩選。
  // 不能只跳頁不套篩選——顧問看到「A 有 5 個」點進去卻是 151 個人，
  // 等於這張卡沒有幫他省掉任何事。
  if (action === 'home-route') {
    const code = target.closest('[data-route-code]')?.getAttribute('data-route-code') || '';
    state.pendingRouteFilter = code;
    navigate('candidates');
  }
  // 2026-09-21 加：分流規則說明放在「系統 → 面談規格」，但顧問不會想到去那裡找。
  // 在看得到數字的兩個地方（首頁卡片、人選中心篩選列）各放一個連結直接帶過去。
  if (action === 'open-route-spec') {
    if (event.preventDefault) event.preventDefault();
    navigate('system', 'spec');
  }
  // 2026-09-22：通用「複製」按鈕。客戶的用人需求表連結最常見的用法就是
  // 複製起來貼給窗口——舊版有這顆，新版搬過來時漏了。
  // ⚠️ navigator.clipboard 在非 https 或沒授權時會丟例外，要有退路，
  //    不然顧問按了沒反應也不知道為什麼。
  if (action === 'copy-text') {
    const btn = target.closest('[data-copy]');
    const txt = btn ? btn.getAttribute('data-copy') : '';
    if (!txt) return;
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject())
      .then(() => toast('已複製', 'success'))
      .catch(() => window.prompt('複製不了，請自己選取這段複製：', txt));
  }
  if (action === 'cal-prev') shiftScheduleMonth(-1);
  if (action === 'cal-next') shiftScheduleMonth(1);
  if (action === 'cal-missing') openScheduleMissing();
  if (action === 'cal-add-submit') submitScheduleAdd(target.closest('[data-day]').getAttribute('data-day'));
});

document.addEventListener('change', (event) => {
  const target = event.target instanceof HTMLInputElement ? event.target : null;
  if (!target || !target.matches('.row-check')) return;
  const id = target.getAttribute('data-sourced-id');
  if (target.checked) state.sourcedSelected.add(id); else state.sourcedSelected.delete(id);
  updateSourcedCount();
});

document.addEventListener('input', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target || !['candidate-search', 'candidate-stage', 'candidate-route'].includes(target.id)) return;
  const query = ($('#candidate-search')?.value || '').toLowerCase();
  const stage = $('#candidate-stage')?.value || '';
  // 2026-09-21 加：阿財分流篩選。做出分流之後顧問還是得從 60 個人裡用眼睛找
  // 哪幾個是 A，等於只做一半。'none' 是「還沒面談過」——那是一個真實而且
  // 顧問會想單獨看的狀態（要去催面談），不是「其他」。
  const route = ($('#candidate-route')?.value || '').toUpperCase();
  const matchRoute = (item) => {
    if (!route) return true;
    if (route === 'NONE') return !item.routeCode;
    // ⚠️ 2026-09-21 Jacky 更正：這個標籤原本叫「進面談室沒開口」、用紅色
    // danger 徽章，等於在跟顧問說「這個人沒談成、要去追」。錯了——那幾位
    // 顧問早就自己打電話談完了，只是沒有記進 consultant_call 欄位。
    // 系統能證明的只有「阿財的面談室沒有對話紀錄」，證明不了「沒談過」。
    // 措辭改成中性、顏色拿掉，留著當查詢條件就好，不要製造假警報。
    if (route === 'SILENT') return !!item.silentInterview;
    return String(item.routeCode || '').toUpperCase() === route;
  };
  const terms = query.split(/\s+/).filter(Boolean);  // 2026-10-23：可打多個關鍵字（例：「104 BIM」），每個字都要對到
  const filtered = state.candidateRows.filter((item) => (!terms.length || terms.every((w) => [item.name,item.job,item.source,item.owner].some((value) => String(value || '').toLowerCase().includes(w)))) && (!stage || item.stage === stage) && matchRoute(item));
  $('#page-data').innerHTML = state.candidateView === 'table' ? views.candidateTableRows(filtered) : views.candidateRows(filtered);
});

window.addEventListener('popstate', render);
window.addEventListener('step1ne:navigate', render);
window.addEventListener('step1ne:unauthorized', () => { localStorage.removeItem(CONFIG.tokenKey); openTokenModal('憑證無效或已過期'); });
window.addEventListener('error', (event) => { console.error(event.error || event.message); toast(`前端執行錯誤：${event.message}`, 'error'); });
window.addEventListener('unhandledrejection', (event) => { console.error(event.reason); toast(`未處理錯誤：${event.reason?.message || event.reason}`, 'error'); });


// ── 有新版就提醒重新整理（2026-09-22）────────────────────────────
//
// 為什麼要有：這是單頁應用，顧問切分頁、開抽屜都不會重新載入 app.js。
// 分頁一開就是一整天，中間我們部署了幾次，他手上跑的還是早上的程式。
// 今天 Jacky 白測兩次——修好的「純CTA型」他測起來還是壞的，因為他那個
// 分頁是修好之前開的。他以為程式沒修好，我以為修好了，兩邊都對也都錯。
//
// ⚠️ 不要自動重新整理。顧問可能正在打一半的表單（電洽紀錄、貼文需求），
//    自動刷掉等於幫他刪資料。只提醒，按不按由他決定。
// ⚠️ 2026-09-22 Jacky 質疑「每開一次就打一次 API 不是很浪費嗎」。
//    這一支打的是 Cloudflare CDN 上的靜態檔（HEAD，約 200 bytes），
//    不碰資料庫也不碰任何外部 API，成本跟載入一張小圖差不多。
//    但他的原則是對的——所以還是改成：10 分鐘一次，而且**只在分頁真的被看著
//    的時候**才檢查。分頁丟在背景一整天不會產生任何請求。
const VERSION_CHECK_MS = 600000;
let APP_ETAG = null;
async function checkForUpdate() {
  if (document.hidden) return;        // 分頁在背景就不用查
  try {
    // 用自己被載入的網址，不寫死 /src/——正式站把檔案放在 /consultant-app/，測試站在 /src/。
    const r = await fetch(new URL('./app.js', import.meta.url), { method: 'HEAD', cache: 'no-store' });
    const tag = r.headers.get('etag');
    if (!tag) return;
    if (!APP_ETAG) { APP_ETAG = tag; return; }
    if (tag === APP_ETAG) return;
    if (document.querySelector('.update-banner')) return;
    const bar = document.createElement('div');
    bar.className = 'update-banner';
    bar.innerHTML = '後台已經更新了，重新整理才會套用新版'
      + '<button type="button" class="btn sm">立即重新整理</button>';
    bar.querySelector('button').onclick = () => location.reload();
    document.body.appendChild(bar);
  } catch { /* 查不到就算了，下次再查 */ }
}
checkForUpdate();
setInterval(checkForUpdate, VERSION_CHECK_MS);
// 從背景切回來的時候補查一次——那正是「離開一陣子回來」的時刻，
// 也是最可能已經有新版的時候。
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdate(); });

render();


// 2026-09-29 Jacky：推薦履歷可以直接把 PDF 拖進「推薦給客戶」那一列上傳。
// 用 document 層的事件委派，人選卡片怎麼重畫都不用重接；按鈕上傳那條路照舊。
// 已經有客戶看得到的版本時，拖進來會先問一次要不要換掉，避免誤拖蓋掉。
(() => {
  const zoneOf = (e) => e.target && e.target.closest && e.target.closest('.cfr-drop');
  const isFileDrag = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  document.addEventListener('dragover', (e) => {
    const z = zoneOf(e);
    if (!z || !isFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    z.classList.add('dragover');
  });
  document.addEventListener('dragleave', (e) => {
    const z = zoneOf(e);
    if (z && !z.contains(e.relatedTarget)) z.classList.remove('dragover');
  });
  document.addEventListener('drop', async (e) => {
    const z = zoneOf(e);
    if (!z || !isFileDrag(e)) return;
    e.preventDefault();
    z.classList.remove('dragover');
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { toast('推薦履歷只收 PDF 檔', 'error'); return; }
    if (z.dataset.cfrHas && !confirm(`${z.dataset.cfrName || '這家客戶'}已經有一份客戶看得到的推薦履歷，要換成「${file.name}」嗎？`)) return;
    z.classList.add('uploading');
    try {
      const pdf_b64 = await readFileAsB64(file);
      await api.post('/admin/client-formal-reports/confirm-upload',
        { application_id: z.dataset.cfrApp, company_id: z.dataset.cfrCo, pdf_b64, filename: file.name });
      toast('已上傳，客戶在企業後台看得到了', 'success');
      if (state.openCandidateId) openCandidate(state.openCandidateId, { fresh: true });
    } catch (err) {
      z.classList.remove('uploading');
      toast(`上傳失敗：${err.message || err}`, 'error');
    }
  });
})();


// Threads 成效頁 ②③：下拉選單換顧問／換數字時只重畫那兩塊，不重打 API。
function wireThreadsPerf() {
  let rows = [];
  try { rows = JSON.parse(document.getElementById('tp-data')?.textContent || '[]'); } catch { return; }
  const who = document.getElementById('tp-who');
  const metric = document.getElementById('tp-metric');
  if (!who || !metric) return;
  const draw = () => {
    const sub = who.value ? rows.filter((r) => r.w === who.value) : rows;
    const heat = document.getElementById('tp-heat');
    if (heat) heat.innerHTML = views.threadsHeat(sub, metric.value);
    const cf = document.getElementById('tp-conv-f');
    const cs = document.getElementById('tp-conv-s');
    if (cf) cf.innerHTML = views.threadsConvBars(sub, 'f');
    if (cs) cs.innerHTML = views.threadsConvBars(sub, 's');
    drawThreadsCharts(sub).catch(() => {});
  };
  who.addEventListener('change', draw);
  metric.addEventListener('change', draw);
  draw();
  // 卡片／表格切換（記在這台瀏覽器）
  document.querySelectorAll('[data-tp-mode]').forEach((b) => b.addEventListener('click', () => {
    const m = b.dataset.tpMode;
    try { localStorage.setItem('s1ne_tp_mode', m); } catch { /* 無痕 */ }
    document.querySelectorAll('[data-tp-mode]').forEach((x) => { x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', String(x === b)); });
    document.querySelectorAll('[data-tp-view]').forEach((v) => { v.hidden = v.dataset.tpView !== m; });
  }));
  // 表格點一列 → 就在那一列正下方展開他的逐篇，再點一次收起（跟卡片一樣）。
  const openRow = (tr) => {
    const next = tr.nextElementSibling;
    if (next && next.classList.contains('tp-trow-detail')) {
      next.remove(); tr.classList.remove('on'); tr.setAttribute('aria-expanded', 'false'); return;
    }
    const cardEl = [...document.querySelectorAll('.tp-card')].find((c) => c.querySelector('.tp-head b')?.textContent === tr.dataset.who);
    const tbl = cardEl && cardEl.querySelector('.tp-table');
    if (!tbl) return;
    const d = document.createElement('tr');
    d.className = 'tp-trow-detail';
    d.innerHTML = `<td colspan="${tr.children.length}"><div class="table-wrap">${tbl.outerHTML}</div></td>`;
    tr.after(d);
    tr.classList.add('on'); tr.setAttribute('aria-expanded', 'true');
  };
  // 表頭點一下排序：第一次由大到小，再點由小到大（顧問名稱那欄照筆畫）。
  const sumTbl = document.querySelector('.tp-sum');
  if (sumTbl) sumTbl.querySelectorAll('[data-sort-col]').forEach((btn) => btn.addEventListener('click', () => {
    const col = Number(btn.dataset.sortCol);
    const desc = !(btn.dataset.dir === 'desc');
    sumTbl.querySelectorAll('[data-sort-col]').forEach((b) => { b.dataset.dir = ''; b.closest('th').removeAttribute('aria-sort'); });
    btn.dataset.dir = desc ? 'desc' : 'asc';
    btn.closest('th').setAttribute('aria-sort', desc ? 'descending' : 'ascending');
    sumTbl.querySelectorAll('.tp-trow-detail').forEach((d) => d.remove());
    sumTbl.querySelectorAll('.tp-trow.on').forEach((r) => { r.classList.remove('on'); r.setAttribute('aria-expanded', 'false'); });
    const body = sumTbl.querySelector('tbody') || sumTbl;
    const trs = [...sumTbl.querySelectorAll('.tp-trow')];
    trs.sort((a, b) => {
      const va = a.children[col].dataset.v, vb = b.children[col].dataset.v;
      const r = col === 0 ? String(va).localeCompare(String(vb), 'zh-Hant') : Number(va) - Number(vb);
      return desc ? -r : r;
    });
    trs.forEach((tr) => body.appendChild(tr));
  }));
  document.querySelectorAll('.tp-trow').forEach((tr) => {
    tr.addEventListener('click', () => openRow(tr));
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openRow(tr); } });
  });
}


// ③ 統計圖（Chart.js，第一次用到才載入，其他頁不會多載）。
let _chartLib = null;
function loadChartJs() {
  if (window.Chart) return Promise.resolve(window.Chart);
  if (_chartLib) return _chartLib;
  _chartLib = new Promise((ok, bad) => {
    const sc = document.createElement('script');
    sc.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js';
    sc.onload = () => ok(window.Chart);
    sc.onerror = () => bad(new Error('圖表元件載入失敗'));
    document.head.appendChild(sc);
  });
  return _chartLib;
}
const _tpCharts = {};
async function drawThreadsCharts(rows) {
  const Chart = await loadChartJs();
  const reduce = !window.matchMedia || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const slots = views.threadsPerf.SLOTS.map(([s0]) => s0);
  const group = (key) => {
    const g = {};
    rows.forEach((r) => { const x = g[r[key]] = g[r[key]] || { n: 0, v: 0, r: 0, j: 0, who: {} }; x.n += 1; x.v += r.v; x.r += r.r; x.j += r.j; if (r.j) x.who[r.w] = (x.who[r.w] || 0) + r.j; });
    return g;
  };
  const gf = group('f'), gs = group('s');
  const forms = Object.keys(gf).filter((k) => gf[k].n >= 3).sort((a, b) => gf[b].v / gf[b].n - gf[a].v / gf[a].n);
  const short = (t) => (t.length > 14 ? t.slice(0, 13) + '…' : t);
  const put = (id, cfg) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (_tpCharts[id]) _tpCharts[id].destroy();
    cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false, animation: reduce ? false : { duration: 300 },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } } }, cfg.options || {});
    _tpCharts[id] = new Chart(el, cfg);
  };
  const viewsVsReplies = (labels, g) => ({
    data: { labels: labels.map(short), datasets: [
      { type: 'bar', label: '平均瀏覽', data: labels.map((k) => Math.round(g[k].v / g[k].n)), backgroundColor: 'rgba(40,103,237,.75)', yAxisID: 'y' },
      { type: 'line', label: '平均留言', data: labels.map((k) => +(g[k].r / g[k].n).toFixed(1)), borderColor: '#e0892a', backgroundColor: '#e0892a', pointRadius: 4, tension: 0.25, yAxisID: 'y1' },
    ] },
    options: { scales: { y: { beginAtZero: true, title: { display: true, text: '瀏覽' } },
      y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: '留言' } } },
      plugins: { tooltip: { callbacks: { afterLabel: (c) => `${g[labels[c.dataIndex]].n} 篇` } } } },
  });
  put('tp-ch-fv', viewsVsReplies(forms, gf));
  const sl = slots.filter((k) => gs[k]);
  put('tp-ch-sv', viewsVsReplies(sl, gs));
  const palette = ['#2867ed', '#06C755', '#e0892a', '#8b5cf6', '#e5484d', '#0ea5a4', '#a16207', '#64748b', '#db2777', '#4f46e5', '#65a30d', '#0891b2', '#b45309'];
  const people = [...new Set(rows.map((r) => r.w))];
  const stacked = (labels, g) => ({
    type: 'bar',
    data: { labels: labels.map(short), datasets: people.map((w, i) => ({ label: w, data: labels.map((k) => (g[k] && g[k].who[w]) || 0), backgroundColor: palette[i % palette.length] }))
      .filter((d) => d.data.some((x) => x > 0)) },
    options: { scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 }, title: { display: true, text: '加入 LINE 人數' } } } },
  });
  const jf = Object.keys(gf).filter((k) => gf[k].j > 0).sort((a, b) => gf[b].j - gf[a].j);
  put('tp-ch-fj', stacked(jf.length ? jf : ['還沒有資料'], jf.length ? gf : { '還沒有資料': { who: {} } }));
  put('tp-ch-sj', stacked(sl, gs));
}


// ── 進度看板（2026-10-05）────────────────────────────────────────────────
// 2026-10-15：每日工作台的企業 BD／人才追蹤切到「看板」時，借用同一套看板。
window.addEventListener('step1ne:daily-live', async (e) => { const el = e.detail && e.detail.target; if (!el) return; try { const r = await api.get('/admin/interviews/live'); const live = r.items || r.interviews || r.sessions || (Array.isArray(r) ? r : []); el.innerHTML = views.liveInterviews(live); } catch { el.innerHTML = ''; } });
window.addEventListener('step1ne:daily-board', (e) => { const { target, kind } = e.detail || {}; if (target) loadBoardTab(target, kind); });
// 篩選（負責人／顯示已結案）記在瀏覽器；資料每次進來重抓，不做自動刷新
// （tracker 很重，見 2026-09-01 D1 額度事故，不能再放 30 秒輪詢）。
const BOARD_KEY = 's1ne_board_ui';
function boardUi() {
  if (!state.board) {
    let saved; try { saved = JSON.parse(localStorage.getItem(BOARD_KEY) || '{}') || {}; } catch { saved = {}; }
    // 2026-10-06 Jacky：「我是」選誰，看板就直接篩誰的卡片（不用每次進來先看全部再切）。
    // 自己在看板上改過負責人（含「全部」）才記自己的選擇。
    const me = amUi().me || '';
    state.board = { owner: me, showClosed: false, clientOwner: me, ...(saved.ownerSet ? saved : { showClosed: !!saved.showClosed }), expand: {} };
  }
  return state.board;
}
async function loadBoardTab(target, kindOverride) {
  const ui = boardUi();
  if (kindOverride) target.dataset.boardKind = kindOverride;
  const kind = target.dataset.boardKind || (state.sub === 'client' ? 'client' : 'cand');
  await boundary(target, async () => {
    const tracker = await api.get('/admin/pipeline/tracker');
    const cards = (tracker && tracker.cards) || [];
    if (kind === 'cand') return { items: boardCandItems(cards, { showClosed: ui.showClosed }) };
    const [bdRes, coRes] = await Promise.all([adapters.bdDashboard(), api.get('/admin/portal/companies')]);
    return { items: boardClientItems({ bd: (bdRes && bdRes.rows) || [], companies: (coRes && coRes.companies) || [], candItems: boardCandItems(cards) }) };
  }, (data) => {
    const items = data.items || [];
    ui.lastItems = items;
    const owners = [...new Set(items.map((x) => x.owner).filter((o) => o && o !== '未指派'))].sort();
    const viewUi = kind === 'cand' ? ui : { ...ui, owner: ui.clientOwner };
    return boardView(items, kind === 'cand' ? CAND_COLS : CLIENT_COLS, { kind, owners, ui: viewUi });
  }, 'refresh');
  state.boardTarget = target;
  const save = (ownerSet) => { try { localStorage.setItem(BOARD_KEY, JSON.stringify({ owner: ui.owner, showClosed: ui.showClosed, clientOwner: ui.clientOwner, ownerSet: ownerSet || ui.ownerSet || false })); } catch { /* 存不了就算了 */ } };
  target.querySelectorAll('[data-board-filter]').forEach((el) => {
    el.onchange = () => {
      const k = el.getAttribute('data-board-filter');
      let ownerSet = false;
      if (k === 'closed') ui.showClosed = el.checked;
      else { ownerSet = true; ui.ownerSet = true; if (kind === 'client') ui.clientOwner = el.value; else ui.owner = el.value; }
      save(ownerSet); loadBoardTab(target);
    };
  });
  target.querySelectorAll('[data-board-expand]').forEach((el) => {
    el.onclick = () => { ui.expand[el.getAttribute('data-board-expand')] = true; loadBoardTab(target); };
  });
  wireBoardDrag(target, kind);
  target.querySelectorAll('[data-board-move]').forEach((el) => {
    const go = (e) => {
      e.preventDefault(); e.stopPropagation();
      const it = (boardUi().lastItems || [])[Number(el.getAttribute('data-board-move'))];
      if (it && (it.kind === 'bd' || it.kind === 'company')) boardMoveMenuClient(target, it); else boardMoveMenu(target, it);
    };
    el.addEventListener('click', go);
  });
  target.querySelectorAll('[data-board-app]').forEach((el) => { el.onclick = () => openCandidate(el.getAttribute('data-board-app')); });
  target.querySelectorAll('[data-board-bd]').forEach((el) => { el.onclick = () => openBdDetail(el.getAttribute('data-board-bd')); });
  target.querySelectorAll('[data-board-co]').forEach((el) => { el.onclick = () => openCompanyManage(el.getAttribute('data-board-co')); });
}


// 看板拖拉（2026-10-05 Jacky：「可以讓看板能拖嗎」）。
// 原則：拖＝開一個確認框，講清楚會發生什麼，按確認才改；預設「不通知人選」，要勾才發 LINE。
// 系統自動算的欄（等面談／等決定、客戶的已聯繫／已開信／有回應／人選在手上／已成交）不能拖進去，
// 跳一句話說明為什麼；需要填原因或選客戶的（結案、推薦給客戶）直接打開卡片。
const CAND_DROP = {
  sent: { stage: 'confirm', label: '已推薦・客戶看履歷' },
  interview: { stage: 'stage1', label: '客戶面試中', rounds: true },
  offer: { stage: 'offer', label: '錄取' },
  onboard: { stage: 'onboard', label: '已到職', date: true },
};
function wireBoardDrag(target, kind) {
  const ui = boardUi();
  let dragIdx = null;
  target.querySelectorAll('[data-board-idx]').forEach((card) => {
    card.addEventListener('dragstart', (e) => {
      dragIdx = Number(card.getAttribute('data-board-idx'));
      card.classList.add('bk-dragging');
      const it0 = (ui.lastItems || [])[dragIdx] || {};
      const locked = kind === 'cand' ? (it0.col === 'fill' ? ['fill'] : it0.col === 'decide' ? ['decide'] : ['fill', 'decide']) : (it0.kind === 'bd' ? ['contacted', 'opened', 'talking', 'active', 'won'] : ['contacted', 'opened', 'replied', 'active', 'won']);
      target.querySelectorAll('[data-board-col]').forEach((c) => c.classList.toggle('bk-locked', locked.includes(c.getAttribute('data-board-col'))));
      try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(dragIdx)); } catch { /* 舊瀏覽器 */ }
    });
    card.addEventListener('dragend', () => { card.classList.remove('bk-dragging'); target.querySelectorAll('.bk-over,.bk-locked').forEach((c) => c.classList.remove('bk-over', 'bk-locked')); });
  });
  target.querySelectorAll('[data-board-col]').forEach((col) => {
    col.addEventListener('dragover', (e) => { if (dragIdx == null) return; e.preventDefault(); col.classList.add('bk-over'); });
    col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('bk-over'); });
    col.addEventListener('drop', (e) => {
      e.preventDefault(); col.classList.remove('bk-over');
      const it = (ui.lastItems || [])[dragIdx]; dragIdx = null;
      const to = col.getAttribute('data-board-col');
      if (!it || it.col === to) return;
      if (kind === 'cand') boardDropCandidate(target, it, to); else boardDropClient(target, it, to);
    });
  });
}
// 2026-10-06 Jacky：「能不能在卡片內調整階段，拖到結案拖不過去、不然就有警示語」。
// 不用拖：按卡片上的「改階段」選要去哪一欄，走跟拖拉同一套確認框。結案改走現行的「不推」：
// 已推薦給客戶的＝這家客戶「標不推進」；還沒推薦的＝顧問決策「不推」（舊的「結案不續」9/15 已拔除）。
function boardMoveMenu(target, it) {
  if (!it || !it.appId) return;
  const cur = it.col;
  // 2026-10-07：等人選面談 ⇄ 等顧問決定 可以互相移（顧問自己電話談完就能先移去決定）
  const opts = CAND_COLS.filter((c) => c.key !== cur && (!['fill', 'decide'].includes(c.key) || ['fill', 'decide'].includes(cur)));
  const needCo = !it.companyId;
  const body = `<p style="margin:0 0 10px"><b>${escapeHtml(it.name)}</b>　目前：${escapeHtml((CAND_COLS.find((c) => c.key === cur) || {}).title || (cur === 'closed' ? '已結案' : cur))}</p>
    ${needCo ? `<label class="field"><span>他還沒推薦給客戶，要往後走請先選客戶（推薦後這家客戶的後台看得到他）</span><select id="bk-mv-co"><option value="">載入客戶中…</option></select></label>` : ''}
    <div class="bk-move-list">
      ${opts.map((c) => `<button type="button" class="btn" data-mv="${c.key}">→ ${escapeHtml(c.title)}</button>`).join('')}
      ${cur === 'closed' ? '' : '<button type="button" class="btn danger" data-mv="close">結案（不推）</button>'}
    </div>`;
  modal({ title: '改階段', subtitle: '選了會先跳確認，不會直接改', body, footer: '<button class="btn" data-close-overlay>取消</button>' });
  if (needCo) {
    // 預設選這個人選應徵職缺的客戶（卡片副標題「客戶｜職缺」的前半段）
    const guess = String(it.sub || '').split('｜')[0].trim();
    ensureCompanies().then((cos) => {
      const sel = $('#bk-mv-co'); if (!sel) return;
      const rank = (c) => (c.relation === 'signed' ? 0 : c.relation === 'negotiating' ? 1 : 2);
      const list = [...cos].sort((a, b) => rank(a) - rank(b) || String(a.display_name).localeCompare(String(b.display_name)));
      sel.innerHTML = `<option value="">選擇客戶…</option>${list.map((c) => `<option value="${escapeHtml(c.id)}" ${guess && c.display_name === guess ? 'selected' : ''}>${escapeHtml(c.display_name)}</option>`).join('')}`;
    });
  }
  document.querySelectorAll('[data-mv]').forEach((b) => {
    b.onclick = async () => {
      const to = b.getAttribute('data-mv');
      if (to === 'fill' || to === 'decide') { closeOverlay(); boardDropCandidate(target, it, to); return; }
      if (needCo && to !== 'close') {
        const coId = $('#bk-mv-co') && $('#bk-mv-co').value;
        if (!coId) { toast('先選要推薦給哪家客戶', 'error'); return; }
        const me = boardMe(); if (!me) return;
        const coName = $('#bk-mv-co').selectedOptions[0].textContent;
        if (!confirm(`把 ${it.name} 推薦給「${coName}」？\n推薦後這家客戶的後台會看得到他。`)) return;
        b.disabled = true;
        try {
          await api.post('/admin/forward-candidate', { application_id: it.appId, company_id: coId, by: me, note: '進度看板改階段' });
        } catch (e) { b.disabled = false; toast(e.message || '推薦沒成功', 'error'); return; }
        closeOverlay();
        if (to === 'sent') { toast(`已推薦給 ${coName}`, 'success'); loadBoardTab(target); return; }
        // 要直接到面試／錄取／到職：推薦完接著跳同一個改階段確認框（選第幾關、報到日）
        boardDropCandidate(target, { ...it, companyId: coId, col: 'sent', sub: coName }, to);
        return;
      }
      closeOverlay();
      if (to === 'close') {
        if (it.companyId) openAction('pipeline-not-recommended', { idParams: { application_id: it.appId, company_id: it.companyId } });
        else boardCloseNoCompany(target, it);
        return;
      }
      boardDropCandidate(target, it, to);
    };
  });
}
// 客戶卡片的「改階段」：只列能手動改的；系統自動算的欄（已聯繫／已開信／人選在客戶手上／已成交）講清楚為什麼不能選。
function boardMoveMenuClient(target, it) {
  if (!it) return;
  const isBd = it.kind === 'bd';
  const curTitle = (CLIENT_COLS.find((c) => c.key === it.col) || {}).title || it.col;
  const opts = isBd
    ? [['replied', '記一筆電話結果（對方有興趣 → 有回應）'], ['signed', '簽約了，轉成正式客戶 → 已簽約']]
    : [['talking', '→ 洽談中'], ['signed', '→ 已簽約・找人中']].filter(([k]) => k !== it.col);
  const body = `<p style="margin:0 0 10px"><b>${escapeHtml(it.name)}</b>　目前：${escapeHtml(curTitle)}</p>
    <div class="bk-move-list">${opts.map(([k, l]) => `<button type="button" class="btn" data-mv="${k}">${escapeHtml(l)}</button>`).join('')}
      <button type="button" class="btn ghost" data-mv="open">打開卡片看詳細</button></div>
    <p class="help" style="margin:10px 0 0">「已聯繫／已開信」看寄信與開信紀錄、「人選在客戶手上／已成交」看人選進度，系統自動放，不能手動改。</p>`;
  modal({ title: '改階段', subtitle: '選了會先跳確認，不會直接改', body, footer: '<button class="btn" data-close-overlay>取消</button>' });
  document.querySelectorAll('[data-mv]').forEach((b) => {
    b.onclick = () => {
      const to = b.getAttribute('data-mv');
      closeOverlay();
      if (to === 'open') { if (isBd) openBdDetail(it.id); else openCompanyManage(it.id); return; }
      boardDropClient(target, it, to);
    };
  });
}
function boardCloseNoCompany(target, it) {
  const me = boardMe(); if (!me) return;
  modal({ title: '結案（不推）', subtitle: `${it.name}・還沒推薦給任何客戶`,
    body: `<label class="field"><span>不推的原因（內部看，不會傳給人選）</span><textarea id="bk-close-reason" rows="3" placeholder="例：沒有醫療耗材／紡織背景"></textarea></label>
      <p class="help">只改系統狀態、移到「已結案」，不會發 LINE 或信給人選。之後要推別的職缺還是可以。</p>`,
    footer: '<button class="btn" data-close-overlay>取消</button><button class="btn danger" id="bk-close-go">結案</button>' });
  $('#bk-close-go').onclick = async () => {
    const reason = ($('#bk-close-reason').value || '').trim();
    if (!reason) { toast('請寫一句原因', 'error'); return; }
    $('#bk-close-go').disabled = true;
    try { await api.post('/admin/board/close', { application_id: it.appId, reason, by: me }); closeOverlay(); toast('已結案', 'success'); loadBoardTab(target); }
    catch (e) { $('#bk-close-go').disabled = false; toast(e.message || '改不成功', 'error'); }
  };
}
function boardMe() {
  const me = amUi().me || '';
  if (!me) { toast('先在畫面最上方選「我是」，系統才記得是誰改的', 'error'); document.querySelector('[data-me-global]')?.focus(); }
  return me;
}
function boardDropCandidate(target, it, to) {
  if (to === 'fill' || to === 'decide') {
    // 2026-10-07 Jacky：等人選面談 ⇄ 等顧問決定 讓顧問自己移（只改看板記號，不動報告與推薦）
    if (!['fill', 'decide'].includes(it.col)) { toast('已經推薦給客戶的人選不能移回這兩欄；要結案請用「改階段 → 結案」', 'error'); return; }
    const me = boardMe(); if (!me) return;
    const on = to === 'decide';
    if (!confirm(on ? `把 ${it.name} 移到「等顧問決定」？\n（例如已經電話談完，不用等阿財報告）` : `把 ${it.name} 移回「等人選面談」？\n如果他已經有阿財報告，還是會留在「等顧問決定」。`)) return;
    api.post('/admin/board/decide', { application_id: it.appId, on, by: me })
      .then(() => { toast(on ? '已移到「等顧問決定」' : '已移回「等人選面談」', 'success'); loadBoardTab(target); })
      .catch((e) => toast(e.message || '改不成功', 'error'));
    return;
  }
  if (to === 'closed') { boardMoveMenu(target, it); return; }
  if (!it.companyId) { toast('他還沒推薦給任何客戶，請在卡片裡先按「推薦給客戶」選客戶', 'error'); openCandidate(it.appId); return; }
  const me = boardMe(); if (!me) return;
  const d = CAND_DROP[to]; if (!d) return;
  const from = (CAND_COLS.find((c) => c.key === it.col) || {}).title || it.col;
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const body = `<p style="margin:0 0 12px"><b>${escapeHtml(it.name)}</b>（${escapeHtml(String(it.sub || '').split('｜')[0])}）<br>${escapeHtml(from)} → <b>${escapeHtml(d.label)}</b></p>
    ${d.rounds ? `<label class="field"><span>第幾關面試</span><select id="bk-round"><option value="stage1">第一階段</option><option value="stage2">第二階段</option><option value="stage3">第三階段</option><option value="stage4">第四階段</option></select></label>` : ''}
    ${d.date ? `<label class="field"><span>報到日</span><input type="date" id="bk-date" value="${today}" required></label><p class="help">改成已到職後，會開始算保證期與收款期別。給人選的 LINE 關懷卡目前暫停中，不會發。</p>` : ''}
    <label class="bk-filter" style="margin-top:8px"><input type="checkbox" id="bk-notify"><span>同時用 LINE 通知人選最新進度（不勾就只改系統，人選收不到）</span></label>`;
  modal({ title: '改階段', subtitle: '確認後才會改', body, footer: `<button class="btn" data-close-overlay>取消</button><button class="btn primary" id="bk-go">確認</button>` });
  $('#bk-go').onclick = async () => {
    const btn = $('#bk-go'); btn.disabled = true;
    const stage = d.rounds ? $('#bk-round').value : d.stage;
    const onboard = d.date ? $('#bk-date').value : null;
    if (d.date && !onboard) { toast('請選報到日', 'error'); btn.disabled = false; return; }
    try {
      await api.post('/admin/set-manual-stage', { application_id: it.appId, company_id: it.companyId, stage, by: me, note: '進度看板拖拉', onboard_date: onboard, silent: !$('#bk-notify').checked });
      closeOverlay(); toast(`已改成「${d.label}」`, 'success'); loadBoardTab(target);
    } catch (e) { btn.disabled = false; toast(e.message || '改不成功', 'error'); }
  };
}
function boardDropClient(target, it, to) {
  // 開發中的公司拖到「有回應」＝剛打完電話對方有興趣 → 直接開「記錄電話結果」（預選有興趣），存完就會自己跑到這欄。
  if (to === 'replied' && it.kind === 'bd') {
    if (!it.outreachId) { toast('這家還沒有開發紀錄，請點開卡片先記一筆', 'error'); openBdDetail(it.id); return; }
    openAction('bd-call-result', { idParams: { id: it.outreachId }, record: { result: 'interested' } });
    return;
  }
  const AUTO_WHY = {
    contacted: '「已聯繫」是寄出開發信或記過電話後自動放進來的',
    opened: '「已開信」只有客戶真的打開信件、系統收到開信紀錄才會放進來，手動標會失真',
    replied: '「有回應」要記一筆電話結果才會放進來（開發中的公司拖過來就會跳出表單）',
    active: '「人選在客戶手上」是看有沒有人選推薦給這家客戶自動算的',
    won: '「已成交」是看有沒有人選到職自動算的',
  };
  if (AUTO_WHY[to]) { toast(`${AUTO_WHY[to]}，不能直接拖`, 'error'); return; }
  const me = boardMe(); if (!me) return;
  if (it.kind === 'bd') {
    if (to !== 'signed') { toast('開發中的公司只能直接拖到「已簽約」；還在談的話，在卡片裡記一筆通話心得就好', 'error'); return; }
    openAction('bd-promote-client', { idParams: { company: it.id }, record: { assigned_to: me } });
    return;
  }
  const rel = to === 'signed' ? 'signed' : 'negotiating';
  modal({ title: '改客戶狀態', subtitle: '確認後才會改', body: `<p><b>${escapeHtml(it.name)}</b> → <b>${to === 'signed' ? '已簽約' : '洽談中'}</b></p><p class="help">只改這家公司的狀態，不會寄信給客戶。</p>`,
    footer: `<button class="btn" data-close-overlay>取消</button><button class="btn primary" id="bk-go">確認</button>` });
  $('#bk-go').onclick = async () => {
    $('#bk-go').disabled = true;
    try { await api.post('/admin/portal/companies/relation', { id: it.id, relation: rel, by: me }); closeOverlay(); toast('已更新', 'success'); loadBoardTab(target); }
    catch (e) { $('#bk-go').disabled = false; toast(e.message || '改不成功', 'error'); }
  };
}

// 2026-10-12：信箱紀錄頁點「對到的卡片」要能直接打開人選卡／客戶卡
initMail({ openCandidate: (id) => openCandidate(id), openCompany: (id) => openCompanyManage(id) });
// 顧問上工設定新增／停用顧問後，其他畫面的顧問下拉選單要重抓
initConsultantSetup({ onConsultantsChanged: () => { state.consultantsCache = null; } });
initChannels({ openCandidate: (id) => openCandidate(id) });
document.addEventListener('click', (e) => { if (e.target instanceof Element && e.target.closest('[data-action="channel-new"]')) openChannel(null); });
window.addEventListener('step1ne:open-channel', (e) => { const id = e.detail && e.detail.id; if (state.route !== 'channels') navigate('channels'); setTimeout(() => openChannel(id), 300); });
