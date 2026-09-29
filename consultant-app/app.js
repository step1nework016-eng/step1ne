import { CONFIG } from './config.js';
import { api, ApiError } from './core/api.js';
import { resolveRoute, navigate } from './core/router.js';
import { $, $$, boundary, closeOverlay, closeSubDrawer, drawer, errorState, formFields, loading, modal, openSubDrawer, toast } from './core/ui.js';
import { escapeHtml, text } from './core/security.js';
import { adapters, analyticsAdapter } from './adapters.js';
import { views, actionBtn, rowActions, shell } from './views.js';
import { ACTIONS } from './actions.js';

// 2026-09-15 補：使用者反映「不知道要看哪個是自己的」——沒有登入系統，只能靠
// 這組「切換選擇」記住上次選的是誰，換分頁/重新整理都不用重選（存在瀏覽器
// localStorage，跟 ADMIN_TOKEN 一樣是這台裝置/這個瀏覽器記得，不是帳號登入）。
const OWNER_KEY = 's1ne_candidate_owner';
const VIEW_KEY = 's1ne_candidate_view';
const SIDEBAR_KEY = 's1ne_sidebar_collapsed';
const state = { route: 'home', sub: '', candidateRows: [], poll: null, sourcedItems: [], sourcedSelected: new Set(), pendingAction: null, pendingRouteFilter: null, jobContentRetry: null, social: { month: null, data: null }, candidateOwner: localStorage.getItem(OWNER_KEY) || '', candidateView: localStorage.getItem(VIEW_KEY) || 'card', sidebarCollapsed: localStorage.getItem(SIDEBAR_KEY) === '1', consultantsCache: null, companiesCache: null, jobsCache: null, openCandidateId: null, precallCardCache: null, linechat: { owner: localStorage.getItem('s1ne_linechat_owner') || '', candidates: [], activeAppId: null, poll: null } };

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
  if (state.route === 'home') return boundary(target, adapters.home, views.homeData, 'refresh');
  if (state.route === 'recruitment') return boundary(target, async () => ({ ...(await adapters.recruitment()), analytics: await analyticsAdapter.recruitment() }), views.recruitmentData, 'refresh');
  if (state.route === 'candidates') return loadCandidateTab(target);
  if (state.route === 'jobs') return loadJobTab(target);
  if (state.route === 'interviews') {
    await boundary(target, adapters.interviews, (data) => views.interviewRows(filterSessions(data)), 'refresh');
    startPolling();
    return;
  }
  if (state.route === 'linechat') return loadLinechatTab(target);
  if (state.route === 'social') return loadSocialTab(target);
  if (state.route === 'clients') return loadClientsTab(target);
  if (state.route === 'system') return loadSystemTab(target);
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

function renderLinechatLayout(target) {
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
  const loaders = { workbench: adapters.candidates, pool: adapters.sourced, reports: adapters.reports, outreach: adapters.outreach, checkups: adapters.checkups };
  const tab = loaders[state.sub] ? state.sub : 'workbench';
  if (tab === 'workbench') {
    await boundary(target, () => adapters.candidates(state.candidateOwner), (items) => { state.candidateRows = items; return state.candidateView === 'table' ? views.candidateTableRows(items) : views.candidateRows(items); }, 'refresh');
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

// 顧問／客戶名單快取（後端本來就有 45 秒快取，這裡再存一次省得每次開下拉選單都重打）。
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
  return boundary(target, adapters.jobs, (data) => {
    if (state.sub === 'intake') return views.jobDraftRows(data.intakes);
    if (state.sub === 'checks') return views.jobCheckRows(data.checks);
    if (state.sub === 'expertise') return views.expertiseRuler()
      + views.jobExpertiseMissingRows(data.expertiseMissing, data.expertiseBuilding)
      + views.jobExpertiseRows(data.expertise, data.expertiseBuilding);
    return views.jobRows(data.jobs);
  }, 'refresh');
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
  if (state.sub === 'threads') return boundary(target, async () => (await adapters.social()).queue, views.socialThreadsTab, 'refresh');
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
          const r = await adapters.socialPostRequest({
            topic_id: topicId, account_id: acSel.value,
            style_id: stSel.value || undefined,
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

function wireSocialComposer() {
  const $$id = (id) => document.getElementById(id);
  const typeSel = $$id('sc-type'), accSel = $$id('sc-account'), waySel = $$id('sc-way');
  const go = $$id('sc-go');
  if (!typeSel || !go) return;

  const syncType = () => {
    const isJob = typeSel.value === 'job';
    $$id('sc-job-only').hidden = !isJob;
    $$id('sc-topic-only').hidden = isJob;
  };
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
    if (isJob) {
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
    }
    const date = $$id('sc-date').value;
    const h = $$id('sc-hour').value, m = $$id('sc-min').value;
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
  if (saved && accSel) accSel.value = saved;
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
  if (state.sub === 'bd-progress') {
    const res = await boundary(target, adapters.bdDashboard, views.bdDashboard, 'refresh');
    wireBdDashboardFilter();
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
  const companyId = state.billingCompany || '';
  const res = await boundary(target, async () => {
    const [companiesResp, plan, installments] = await Promise.all([
      adapters.clients(),
      companyId ? adapters.billingPlan(companyId) : Promise.resolve(null),
      adapters.billingInstallments(companyId),
    ]);
    return { companies: companiesResp.companies, plan, installments: installments.installments || [] };
  }, ({ companies, plan, installments }) => views.billingTab(companies, companyId, plan, installments), 'refresh');
  wireBillingTab();
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
  const apply = () => {
    const v = sel.value;
    let shown = 0;
    for (const r of box.querySelectorAll('.bd-dash-row')) {
      const stage = r.getAttribute('data-bd-stage') || '';
      const hasTodo = r.getAttribute('data-bd-has-todo') === '1';
      let ok = true;
      if (v === 'todo') ok = hasTodo;
      else if (v === 'replied') ok = ['replied', 'jd_shared', 'closed'].includes(stage);
      else if (v.startsWith('stage:')) ok = stage === v.slice('stage:'.length);
      r.hidden = !ok;
      if (ok) shown += 1;
    }
    const total = box.querySelectorAll('.bd-dash-row').length;
    if (counter) counter.textContent = shown === total ? `顯示全部 ${total} 家` : `顯示 ${shown} 家（全部 ${total} 家）`;
  };
  sel.onchange = apply;
  for (const btn of $$('.bd-funnel-step')) {
    btn.onclick = () => { sel.value = `stage:${btn.getAttribute('data-bd-filter-stage')}`; apply(); };
  }
  apply();
}

async function openBdDetail(company) {
  drawer({ title: company, subtitle: '開發進度時間軸', body: loading() });
  try {
    const detail = await adapters.bdDashboardDetail(company);
    drawer({ title: company, subtitle: '開發進度時間軸', body: views.bdDashboardDetail(detail) });
    wireBdDetailTabs();
  } catch (error) {
    console.error(error);
    drawer({ title: company, body: errorState(error) });
  }
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
      const timelinePane = document.getElementById('bd-detail-pane-timeline');
      const playbookPane = document.getElementById('bd-detail-pane-playbook');
      if (timelinePane) timelinePane.hidden = key !== 'timeline';
      if (playbookPane) playbookPane.hidden = key !== 'playbook';
    };
  }
}

async function loadSystemTab(target) {
  if (state.sub === 'kpi') return boundary(target, async () => (await adapters.system()).kpi, views.systemKpiTab, 'refresh');
  if (state.sub === 'settings') return boundary(target, async () => { const s = await adapters.system(); return { consultants: s.consultants, settings: s.settings }; }, views.systemSettingsTab, 'refresh');
  if (state.sub === 'token') return boundary(target, adapters.tokenUsage, views.systemTokenTab, 'refresh');
  if (state.sub === 'spec') return boundary(target, async () => null, views.systemSpecTab, 'refresh');
  if (state.sub === 'health') return boundary(target, adapters.featureUsage, views.systemHealthTab, 'refresh');
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

async function openCandidate(applicationId) {
  state.openCandidateId = applicationId;
  drawer({ title: '載入應徵單…', body: loading() });
  try {
    const card = await adapters.candidateCard(applicationId);
    const application = card.application || card;
    const forwards = card.forwards || [];
    const notes = card.notes || [];
    const timeline = card.timeline || [];
    const report = card.report || null;
    const dupNotice = card.dup_notice || null;
    const lineBinding = card.line_binding || null;
    const ctxId = { idParams: { application_id: applicationId } };
    // 逐客戶推進／不推進：/admin/pipeline/forward-decision 的真實語意是「顧問自己
    // 標記不推薦」，不是客戶決策（見 actions.js 的查證更正）——依目前狀態顯示
    // 對應那一顆按鈕，不是兩顆都show。
    const forwardRows = forwards.length ? forwards.map((f) => {
      const companyId = f.company_id;
      const nr = f.advisor_not_recommended_at;
      const toggleBtn = nr
        ? actionBtn('改回推進', 'pipeline-recommended-again', { idParams: { application_id: applicationId, company_id: companyId } })
        : actionBtn('標不推進', 'pipeline-not-recommended', { idParams: { application_id: applicationId, company_id: companyId } }, 'danger');
      // 不報到只有真的走到「報到」這一關（有 onboard_date）才能標；已經標過的顯示原因，不重複顯示按鈕。
      const noShowBtn = f.onboard_date && !f.no_show_at
        ? actionBtn('標記不報到', 'placement-no-show', { idParams: { application_id: applicationId, company_id: companyId } }, 'danger') : '';
      // 2026-09-21 加：人選自己放棄。跟上面「標不推進」是不同的事——那是我們／
      // 客戶的決定，這是人選自己走了。所以任何階段都能標，不受「已確認推進」擋。
      const withdrawBtn = f.candidate_withdrawn_at
        ? actionBtn('收回「已放棄」', 'pipeline-candidate-withdraw-undo', { idParams: { application_id: applicationId, company_id: companyId } })
        : actionBtn('人選已放棄', 'pipeline-candidate-withdraw', { idParams: { application_id: applicationId, company_id: companyId } }, 'danger');
      // 2026-09-29 加：LINE ID／客戶備註可以改了，見 forward-detail-update；
      // 客製表單狀態（寄送/催填/上傳/下載）＋收費待確認，見 views.candidateFormsBlock／
      // candidateBillingPendingBlock——資料早就有，這裡才第一次真的畫出來。
      const editBtn = actionBtn('編輯 LINE ID／客戶備註', 'forward-detail-update',
        { idParams: { application_id: applicationId, company_id: companyId },
          record: { line_id_given: f.line_id_given || '', client_note: f.client_note || '' } });
      const lineIdLine = f.line_id_given ? ` · LINE ID：${text(f.line_id_given)}` : '';
      const cfr = f.client_formal_report;
      const cfrLine = !cfr ? ' · 推薦履歷：還沒上傳'
        : cfr.pdf_pending ? ' · 推薦履歷：AI 產生中'
        : cfr.consultant_confirmed_at ? ` · ✅ 推薦履歷：客戶看得到（${text(String(cfr.consultant_confirmed_at).slice(5, 16))} 上傳）`
        : ' · 推薦履歷：只有 AI 草稿，客戶還看不到';
      // ⚠️ 2026-09-29 真實撞到、瀏覽器實測才抓到的版面 bug：這一列現在最多會
      // 疊到 8 顆操作按鈕，.actions-row 有 flex-shrink:0（不准縮），按鈕多到
      // 加總寬度超過 .drawer 本身的寬度（650px）時，同一個 flex row 裡的
      // <span> 會被擠到 0 寬，文字被迫一字一行。抽屜寬度固定又窄，跟手機版
      // 會撞到同一種問題，但既有的 @media(max-width:860px) 换行修法是看
      // 「瀏覽器視窗」寬度，不是看抽屜這個容器的寬度，桌機開瀏覽器時完全不會
      // 觸發——所以只在這一列強制換行（span 佔滿一整行、按鈕另起一行），
      // 不依賴視窗寬度，也不去動全站 .list-row 這個共用類別去影響到別的地方。
      return `<div>
<div class="list-row" style="flex-wrap:wrap;row-gap:8px"><span style="flex:1 1 100%"><b>${text(f.company_name)}</b><small>${text(f.job_title || f.job_slug)}${f.stage_label ? ' · ' + text(f.stage_label) : ''}${f.client_note ? ' · ' + text(f.client_note) : ''}${lineIdLine}${cfrLine}${nr ? ' · ⚠ 不推進：' + text(f.advisor_not_recommended_reason || '') : ''}${f.no_show_at ? ' · ⚠ 不報到：' + text(f.no_show_reason || '') : ''}${f.candidate_withdrawn_at ? ' · 🚪 人選已放棄：' + text(f.candidate_withdraw_reason || '') : ''}</small></span>${rowActions([
        toggleBtn,
        withdrawBtn,
        editBtn,
        actionBtn('傳訊息給客戶', 'pipeline-message-client', { idParams: { application_id: applicationId, company_id: companyId } }),
        actionBtn('建立正式報告', 'client-formal-report', { idParams: { application_id: applicationId, company_id: companyId } }),
        actionBtn(cfr && cfr.consultant_confirmed_at ? '換一份推薦履歷' : '上傳推薦履歷', 'client-formal-report-upload', { idParams: { application_id: applicationId, company_id: companyId } }),
        cfr && cfr.consultant_confirmed_at && cfr.file_id ? `<button type="button" class="btn ghost sm" data-download-file="${text(cfr.file_id)}">下載推薦履歷</button>` : '',
        noShowBtn,
        actionBtn('取消推薦', 'pipeline-unforward-candidate', { idParams: { application_id: applicationId, company_id: companyId } }, 'danger')
      ].filter(Boolean))}</div>
${views.candidateBillingPendingBlock(f.billing_pending)}
${views.candidateFormsBlock(f.forms, applicationId, companyId)}
</div>`;
    }).join('') : '<p class="muted">尚未推薦客戶</p>';
    const disc = [application.disc_d, application.disc_i, application.disc_s, application.disc_c].some((v) => v != null)
      ? `D${text(application.disc_d ?? '—')} I${text(application.disc_i ?? '—')} S${text(application.disc_s ?? '—')} C${text(application.disc_c ?? '—')}${application.disc_primary ? `（主型 ${text(application.disc_primary)}）` : ''}`
      : '尚未測驗';
    const resumeBtns = [];
    if (application.resume_file_id) resumeBtns.push(`<button type="button" class="btn ghost sm" data-download-resume="${escapeHtml(applicationId)}">下載履歷</button>`);
    if (application.resume_url) resumeBtns.push(`<a class="btn ghost sm" href="${escapeHtml(application.resume_url)}" target="_blank" rel="noopener">履歷連結</a>`);
    if (application.resume_104_url) resumeBtns.push(`<a class="btn ghost sm" href="${escapeHtml(application.resume_104_url)}" target="_blank" rel="noopener">104 履歷</a>`);
    const contactBadge = hasContact(application) ? '' : '<span class="badge warning" style="margin-left:8px">⚠ 記得補聯絡方式</span>';
    // hard_gate 照抄後端 /admin/pipeline/tracker 的判準（a.status==='pending_screen' && !a.screen_decision）——
    // 這兩個欄位本來就在 applications 表裡、card 端點的 SELECT * 早就撈到了，純前端算。
    const hardGateBadge = application.status === 'pending_screen' && !application.screen_decision
      ? '<span class="badge warning" style="margin-left:8px">硬性條件審核</span>' : '';
    const dupNoticeHtml = dupNotice ? `<div class="notice" style="background:#fdf6e9;border-left:3px solid #d9a441">⚠ 疑似同一人：${text(dupNotice)}</div>` : '';
    // 2026-09-16 加：LINE 綁定狀態＋頭像。沒有頭像（多半是舊版文字驗證綁定的，
    // 那條路徑不會存頭像）就退回姓名前兩字的色塊，跟舊版 consultant/social-post
    // 的 .tobs-avatar 同一個 fallback 慣例，不是這裡自己發明的樣式。
    const lineHtml = lineBinding
      ? `<span class="line-avatar">${lineBinding.picture_url
          ? `<img src="${escapeHtml(lineBinding.picture_url)}" alt="">`
          : text((lineBinding.display_name || '?').slice(0, 2))}</span> `
        + `<span class="badge success">已綁定</span>${lineBinding.display_name ? ' ' + text(lineBinding.display_name) : ''}`
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
    </dl></div></div>${resumeBtns.length ? `<div class="actions-row">${resumeBtns.join('')}</div>` : '<p class="muted">沒有履歷檔案或連結</p>'}`;
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
    // 整體進度：照抄舊版四格（風格測驗／阿財初審／電洽／推薦給客戶），跳過舊版
    // 「初篩決定」那一格——那格讀的是 reports.consultant_decision，這支 card
    // 端點沒有回傳、要另外打一支 API 才拿得到，這輪先不加，避免多一次往返。
    const stages = [
      { key: 'style', lb: '風格測驗', done: !!application.disc_primary },
      { key: 'interview', lb: '阿財初審', done: application.interview_state === 'done' },
      { key: 'call', lb: '電洽', done: !!application.call_summary_md },
      { key: 'forward', lb: '推薦給客戶', done: forwards.length > 0 },
    ];
    let nowSet = false;
    stages.forEach((s) => { if (!s.done && !nowSet) { s.now = true; nowSet = true; } });
    // 跟舊版一樣：進度條只是導覽，點哪一格才展開哪一格的內容，不是全部攤平
    // 常駐顯示——「風格測驗」「電洽」底下才藏著 DISC 連結／安排面談表單。
    const stageBar = `<div class="stage-bar">${stages.map((s) => `<div class="stage-dot ${s.done ? 'done' : (s.now ? 'now' : '')}" data-stage-dot="${s.key}"><span></span><small>${text(s.lb)}</small></div>`).join('')}</div><div id="stage-detail"></div>`;
    // 2026-09-15 加：source_channel 只有「顧問手動新增」／「人才池轉正」這兩條路徑
    // 才會寫值（見 doManualForward），阿財面談那條公開應徵頁流程從來不寫這個欄位——
    // 所以「有值＝顧問新增或人才池來的」「沒值＝阿財面談自己應徵進來的」，不用另外
    // 存一個「管道」欄位，用既有資料就能標出三條管道的差異，秀在標題旁邊一眼看到，
    // 不用點進「基本資料」的「來源」那格才看得到。
    const channelTag = application.source_channel ? text(application.source_channel) : '阿財面談應徵';
    drawer({
      // seq_no 是舊版拿來防止顧問誤刪錯人時比對用的固定流水編號（見 applications.seq_no
      // ／trg_applications_seq_no 觸發器），一直沒搬進 V3 標題。
      title: (application.seq_no ? `#${application.seq_no} ` : '') + (application.name || '應徵單'),
      subtitle: `${application.job_title || application.job_slug || ''} · ${channelTag}`,
      body: `<div class="drawer-section">${dupNoticeHtml}${stageBar}<h3>基本資料${contactBadge}${hardGateBadge}</h3>${basics}<h3>操作</h3>${rowActions([
        actionBtn('新增顧問備註', 'application-notes', ctxId, 'primary'),
        // 2026-09-17 改名：這顆原本也叫「電洽前準備」，但實際上是手動打字存進
        // consultant_call_notes 的表單，跟「電洽」階段格裡新加的 AI Pre-call Card
        // （PRECALL_PHASE1）是完全不同兩個功能，同名會讓人以為是同一顆——
        // 查證後確認這顆對應的後端端點是 /admin/application/call-note（doCallNote），
        // 跟 call_prep_md／call-prep-generate 那條 AI 產生的路徑無關，改名消除混淆。
        actionBtn('手動記一筆電洽重點', 'application-call-note', ctxId),
        actionBtn('電洽摘要', 'application-call-summary', ctxId),
        actionBtn('指派負責顧問', 'set-owner', { idParams: { kind: 'application', id: applicationId } }),
        actionBtn('手動調整階段', 'set-manual-stage', ctxId),
        actionBtn('編輯應徵單', 'application-update', { idParams: { application_id: applicationId }, record: application }),
        // 2026-09-15 拔除這裡的「AI 初篩報告決策」跟「推薦給客戶」——使用者要求
        // 進度條格子裡已經有的操作不要在操作列表重複一份，這兩顆只留在
        // 「阿財初審」／「推薦給客戶」那兩格裡。
        actionBtn('AI 篩選決策', 'screen-decide', ctxId),
        actionBtn('清除決策', 'clear-decision', ctxId, 'danger')
        // 2026-09-15 拔除「標記已結案不續」：doMarkClosed() 查 placements 沒有
        // client_id/company_id 過濾，抓到的是任一筆（不分客戶），而且 notify=true
        // 時會把 reports.consultant_decision 設成 rejected，擋住這位人選之後被
        // 推薦給其他客戶——但「結案」講的其實只是這家客戶的職缺結束，人選本身
        // 沒問題，後續可能有新職缺。已查證用人單位 /portal/* 完全不讀
        // placements.stage=CLOSED_LOST/CLOSED_INTERNAL（resolveStage() 只認
        // OFFER/OFFER_ACCEPTED/HIRED，client 端的「不推進」狀態靠的是
        // candidate_forwards.client_rejected_at，跟這個按鈕無關），可以安全拔掉。
        // 「不推進」交給下面推薦客戶進度那格既有、正確 per-client scope 的
        // 「標不推進」（advisor_not_recommended_at，走 pipeline-not-recommended）。
        // 2026-09-15 拔除「手動推薦」：查證發現它送的欄位（company_id）跟真正呼叫的
        // /admin/pipeline/manual-forward（實為 doManualForward）要的欄位（source_kind/
        // source_id/job_slug/consent_confirmed）完全對不上，點下去必定失敗。它原本的
        // 用途（把同一位人選轉去另一個職缺重開一筆）跟「推薦給客戶」是不同語意，
        // 這輪先拔掉避免顧問點到一顆壞按鈕，之後真的要做再照 doManualForward 的
        // 真實欄位重建。
      ])}<h3>顧問備註／電洽紀錄</h3>${notesHtml}<h3>推薦客戶進度</h3>${forwardRows}<h3>最近歷程</h3>${timelineHtml}</div>`,
    });
    wireCandidateDrawer(applicationId, application, forwards, report);
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
  else if (status === 'generating') box.innerHTML = views.precallCardLoading();
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
    else if (data.status === 'not_generated' && data.legacy_call_summary_md) {
      box.innerHTML = views.callResult(data.legacy_call_summary_md)
        + `<div class="actions-row" style="margin-top:10px"><button type="button" class="btn ghost sm" data-action="postcall-generate">升級成結構化電洽結果（含 Gate Result／下一步建議）</button></div>`;
    }
    else box.innerHTML = views.postcallResultEmpty();
    return data;
  } catch (error) {
    box.innerHTML = views.postcallResultTimeout(error);
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
    if (box) box.innerHTML = views.postcallResultTimeout(error);
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
      if (state.openCandidateId === applicationId && liveBox) liveBox.innerHTML = views.postcallResultTimeout();
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
      ${views.interviewResult(report)}
      <p class="help" style="margin:14px 0 6px">有興趣就直接按下面「推薦給客戶」，會自動記錄為會推；這顆是還沒決定推薦給誰、但想先記錄再看看／不推時用。</p>
      <div>${actionBtn('AI 初篩報告決策', 'decide-report', { idParams: { application_id: applicationId } }, 'primary')}</div></div>`;
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
    const listHtml = forwards.length ? forwards.map((f) => `<div class="list-row"><span><b>${text(f.company_name)}</b><small>${text(f.job_title || f.job_slug)}${f.stage_label ? ' · ' + text(f.stage_label) : ''}</small></span></div>`).join('') : '<p class="help" style="margin:0">還沒推薦給任何客戶</p>';
    return `<div class="stage-detail-panel"><h4>推薦給客戶</h4>${listHtml}<div style="margin-top:12px"><button type="button" class="btn primary" data-action="open-forward-candidate" data-application-id="${escapeHtml(applicationId)}">推薦給客戶</button></div></div>`;
  }
  return '';
}

function wireCandidateDrawer(applicationId, application, forwards, report) {
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
  $$('.stage-dot[data-stage-dot]').forEach((dot) => {
    dot.onclick = () => {
      const key = dot.getAttribute('data-stage-dot');
      const box = $('#stage-detail');
      if (!box) return;
      // 再點同一格就收起來，跟舊版手風琴行為一致。
      if (dot.classList.contains('active')) {
        $$('.stage-dot').forEach((d) => d.classList.remove('active'));
        box.innerHTML = '';
        return;
      }
      $$('.stage-dot').forEach((d) => d.classList.remove('active'));
      dot.classList.add('active');
      box.innerHTML = stageDetailHtml(key, application, forwards, report, applicationId);
      wireDetailPanel();
    };
  });
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
    window.open(URL.createObjectURL(blob), '_blank');
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
    const [jobsData, content, card, acai] = await Promise.all([
      adapters.jobs(), adapters.jobContent(slug).catch(() => ({})),
      // 職缺卡（對話 B）：失敗不擋整個抽屜開啟，退回空卡片一樣可以匯入第一筆。
      adapters.jobCard(slug).catch(() => null),
      adapters.jobAcaiView(slug).catch(() => null)]);
    const job = jobsData.jobs.find((j) => (j.slug || j.id) === slug) || { slug };
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
             body: views.jobManageBody(job, content, bank, isBuilding, card, acai) });
    // 分頁切換。四個面板都已經 render 好，純顯示／隱藏，不 lazy-load
    // ——題庫／職缺卡／阿財理解資料上面已經拿到了，再延遲載入只是多一次往返。
    const PANELS = ['manage', 'expertise', 'card', 'acai'];
    $$('[data-jobtab]').forEach((btn) => {
      btn.onclick = () => {
        $$('[data-jobtab]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const which = btn.getAttribute('data-jobtab');
        PANELS.forEach((k) => { const el = $(`#job-tab-${k}`); if (el) el.hidden = which !== k; });
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
    return `<div class="card-head"><div><h2>${text(app.candidate_name || app.name)}</h2><p>${text(app.job_title || app.job)} · ${text(app.interview_state || app.state)}</p></div>${['done','interviewed'].includes(String(app.interview_state || app.state)) ? '<button class="btn" data-action="reopen-interview" data-id="'+escapeHtml(id)+'">重新開啟面談</button>' : ''}</div>${fb ? `<div class="notice">人選給這場面談的評分：${'★'.repeat(Number(fb.rating) || 0)}${'☆'.repeat(Math.max(0, 5 - (Number(fb.rating) || 0)))}（${text(fb.rating)}/5）${fb.comment ? ' · ' + text(fb.comment) : ''}</div>` : ''}<div class="transcript">${messages.map((message) => `<div class="bubble ${String(message.role).includes('assistant') ? 'ai' : 'candidate'}"><b>${String(message.role).includes('assistant') ? '阿財' : '人選'}</b><p>${text(message.content || message.text)}</p><small>${text(message.created_at || message.at)}</small></div>`).join('') || '<div class="state">目前沒有對話訊息</div>'}</div>`;
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
    (jobsByCompany[j.company_id] = jobsByCompany[j.company_id] || []).push({ slug: j.slug, title: j.title });
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
    jobSelect.innerHTML = '<option value="">選一個職缺…</option>' + (jobsByCompany[cid] || []).map((j) => `<option value="${escapeHtml(j.slug)}">${escapeHtml(j.title)}</option>`).join('');
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
  jobs.forEach((j) => { if (j.company_id) (jobsByCompany[j.company_id] = jobsByCompany[j.company_id] || []).push({ slug: j.slug, title: j.title }); });
  const companySelect = $('#fc-company');
  const jobSelect = $('#fc-job');
  if (!companySelect || !jobSelect) return;
  companySelect.innerHTML = '<option value="">選一家客戶…</option>' + companies.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.display_name)}</option>`).join('');
  companySelect.onchange = () => {
    const cid = companySelect.value;
    const list = jobsByCompany[cid] || [];
    if (!cid || !list.length) { jobSelect.innerHTML = '<option value="">（沿用原本應徵的職缺）</option>'; jobSelect.disabled = true; return; }
    jobSelect.disabled = false;
    jobSelect.innerHTML = '<option value="">（沿用原本應徵的職缺）</option>' + list.map((j) => `<option value="${escapeHtml(j.slug)}">${escapeHtml(j.title)}</option>`).join('');
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
    const result = await api.post('/admin/forward-candidate', {
      application_id: applicationId, company_id: companyId,
      job_slug: $('#fc-job')?.value || undefined,
      note: form.querySelector('[name="note"]').value.trim() || undefined,
    });
    toast(`已推薦給 ${result.company || '客戶'}`, 'success');
    if (state.openCandidateId) openCandidate(state.openCandidateId);
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
  jobs.forEach((j) => { if (j.company_id) (jobsByCompany[j.company_id] = jobsByCompany[j.company_id] || []).push({ slug: j.slug, title: j.title }); });
  const companySelect = $('#cs-company');
  const jobSelect = $('#cs-job');
  if (!companySelect || !jobSelect) return;
  companySelect.innerHTML = '<option value="">選一家客戶…</option>' + companies.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.display_name)}</option>`).join('');
  companySelect.onchange = () => {
    const cid = companySelect.value;
    const list2 = jobsByCompany[cid] || [];
    if (!cid || !list2.length) { jobSelect.innerHTML = '<option value="">（先選客戶）</option>'; jobSelect.disabled = true; return; }
    jobSelect.disabled = false;
    jobSelect.innerHTML = '<option value="">選一個職缺…</option>' + list2.map((j) => `<option value="${escapeHtml(j.slug)}">${escapeHtml(j.title)}</option>`).join('');
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
    const result = await saveJobContent(slug, formBody(form));
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
  const fileField = fields.find((f) => f.type === 'file');
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
    await api[action.method](path, body, options);
    toast(action.success || '已完成', 'success');
    state.pendingAction = null;
    // 2026-09-15 改：使用者反映「每次一個操作都會自己關閉卡片」——因為
    // modal()／drawer() 共用同一個 #overlay-root，開確認框那一刻卡片其實已經
    // 被蓋掉了，之前又緊接著 closeOverlay()+refreshCurrentView() 直接跳回列表。
    // 如果這個操作是在人選卡片裡點出來的（state.openCandidateId 有值），
    // 送出後重新打開同一位人選的卡片（拿到最新資料），不要被丟回列表；
    // 其他情境（職缺／客戶等其他抽屜或跟卡片無關的操作）維持原本行為。
    if (state.openCandidateId) openCandidate(state.openCandidateId);
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
    if (subModalOpen && state.openCandidateId) { state.pendingAction = null; openCandidate(state.openCandidateId); return; }
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
    if (actionId === 'set-owner' || actionId === 'sourced-assign-owner') { ensureConsultants().then((list) => openAction(actionId, { ...ctx, record: { ...(ctx.record || {}), _consultants: list } })); return; }
    if (actionId === 'sourced-invite') { ensureJobs().then((list) => openAction(actionId, { ...ctx, record: { ...(ctx.record || {}), _jobs: list.filter((j) => j.slug !== 'unspecified') } })); return; }
    if (actionId === 'application-update') { ensureJobs().then((list) => openAction(actionId, { ...ctx, record: { ...(ctx.record || {}), _jobs: list.filter((j) => j.slug !== 'unspecified') } })); return; }
    openAction(actionId, ctx);
    return;
  }
  const application = target.closest('[data-application]');
  if (application) { openCandidate(application.getAttribute('data-application')); return; }
  const session = target.closest('[data-session]');
  if (session) { openSession(session.getAttribute('data-session')); return; }
  const jobRow = target.closest('[data-job]');
  if (jobRow) { openJobManage(jobRow.getAttribute('data-job')); return; }
  const clientRow = target.closest('[data-client]');
  if (clientRow) { openCompanyManage(clientRow.getAttribute('data-client')); return; }
  const bdCompany = target.closest('[data-bd-company]');
  if (bdCompany) { openBdDetail(bdCompany.getAttribute('data-bd-company')); return; }
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
  if (action === 'add-client') openAction('company-create', {});
  if (action === 'run-action') submitPendingAction();
  if (action === 'confirm-job-content') {
    if (!state.jobContentRetry) return;
    const { slug, body } = state.jobContentRetry;
    state.jobContentRetry = null;
    try { await saveJobContent(slug, body, { confirm: true }); closeOverlay(); toast('職缺內容已儲存', 'success'); openJobManage(slug); }
    catch (error) { console.error(error); toast(error.message, 'error'); }
  }
  if (action === 'submit-job-content') submitJobContent(target.closest('[data-slug]').getAttribute('data-slug'));
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
  const filtered = state.candidateRows.filter((item) => (!query || [item.name,item.job,item.source,item.owner].some((value) => String(value || '').toLowerCase().includes(query))) && (!stage || item.stage === stage) && matchRoute(item));
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
