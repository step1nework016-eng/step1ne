import { api } from './core/api.js';
import { CONFIG } from './config.js';

const rows = (body, ...keys) => {
  if (Array.isArray(body)) return body;
  for (const key of keys) if (Array.isArray(body?.[key])) return body[key];
  return [];
};
const value = (source, ...keys) => keys.map((key) => source?.[key]).find((item) => item !== undefined && item !== null);

export const adapters = {
  async home() {
    const [overview, live] = await Promise.all([api.get('/admin/overview'), api.get('/admin/interviews/live')]);
    return { overview, live: rows(live, 'items', 'interviews', 'sessions') };
  },
  // /admin/funnel 需要 job_slug 才有意義（單一職缺的漏斗），這裡改用 overview.funnel
  // （全站目前快照，不需要參數），不再打這支用不到的請求。
  async recruitment() {
    const [overview, tracker, jobs] = await Promise.all([
      api.get('/admin/overview'), api.get('/admin/pipeline/tracker'), api.get('/admin/jobs')
    ]);
    return { overview, applications: rows(tracker, 'cards', 'items', 'applications', 'rows'), jobs: rows(jobs, 'jobs', 'items') };
  },
  // 2026-09-15 用真實 ADMIN_TOKEN 對 production 驗證：/admin/pipeline/tracker 回傳的陣列鍵其實是
  // `cards`，不是 items/applications/rows 任何一個——先前這個清單一直是空的。真實卡片沒有
  // manual_stage/status/next_action/last_activity_at 這幾個欄位；tab 才是後端算好的真實階段
  // （fill/decide/client/pool 四分頁，見 core/status.js 的翻譯）。2026-09-15 補：卡片其實有
  // email/phone（後端 SELECT 裡有，只是原本沒接進來），拿來補「聯絡方式」；owner 支援
  // ?owner=<consultants.id> 篩選（也接受 'unassigned'），對應顧問後台想篩「誰負責的」。
  async candidates(owner) {
    const q = owner ? `?owner=${encodeURIComponent(owner)}` : '';
    const body = await api.get(`/admin/pipeline/tracker${q}`);
    // 2026-09-15 補：client_name 其實一直都有給（後端算的是「推薦給哪家客戶」，
    // 推薦之前是「（未綁客戶）」，推薦之後會自動換成真實客戶名）——原本沒接進來，
    // 工作台卡片一直只顯示人選自己原本應徵的職缺，推薦之後畫面完全看不出來。
    // seq_no／hard_gate 同理，後端早就算好，只是沒被讀出來。
    return rows(body, 'cards', 'items', 'applications', 'rows').map((item) => ({
      applicationId: value(item, 'application_id', 'id'), name: value(item, 'name', 'candidate_name'),
      job: value(item, 'job_title', 'title'), jobSlug: value(item, 'job_slug'), owner: value(item, 'owner_name', 'owner', 'consultant_name'),
      ownerId: value(item, 'owner'), email: value(item, 'email'), phone: value(item, 'phone'),
      source: value(item, 'source_label', 'source_channel', 'utm_source'), stage: value(item, 'tab', 'manual_stage', 'status', 'stage'),
      updatedAt: value(item, 'created_at', 'last_activity_at', 'updated_at'),
      duplicate: value(item, 'dup_notice', 'duplicate_notice'),
      clientName: value(item, 'client_name'), seqNo: value(item, 'seq_no'), hardGate: value(item, 'hard_gate'),
      aiDone: value(item, 'ai_done'), evaluated: value(item, 'evaluated'), pushed: value(item, 'pushed'),
      // 2026-09-21 加：阿財分流 A–E，卡片跟表格都要顯示，顧問一眼看出先打給誰。
      routeCode: value(item, 'route_code'), routeLabel: value(item, 'route_label'),
      // 2026-09-22：LINE 綁定狀態。後端 /admin/pipeline/tracker 本來就有回
      // line_bound／line_display_name，只是前端從來沒接——顧問要跑到
      // 「系統 → LINE」那一頁才查得到這個人能不能用 LINE 聯絡。
      lineBound: value(item, 'line_bound'), lineName: value(item, 'line_display_name'),
      // 進了面談室但一句話都沒說（逾時自動收尾），跟「談完了」是兩件事。
      silentInterview: value(item, 'silent_interview'),
    }));
  },
  async candidateCard(applicationId) { return api.get(`/admin/application/${encodeURIComponent(applicationId)}/card`); },
  async sourced() { return rows(await api.get('/admin/sourced'), 'items', 'candidates', 'rows'); },
  async reports() { return rows(await api.get('/admin/reports'), 'items', 'reports'); },
  // 2026-09-15 驗證：outreach／checkups 陣列鍵都是 rows，不是 items/outreach/checkups——
  // 這兩個分頁之前一直顯示空清單。outreach 額外回傳 stats（total/replied/closed/waiting/
  // reply_rate，樣本不到 100 封 reply_rate 是 null）——這是後端算好的，不用前端重算一次。
  async outreach() { const body = await api.get('/admin/outreach'); return { rows: rows(body, 'rows', 'items', 'outreach'), stats: body?.stats || {} }; },
  // 待審核清單（2026-09-29，總指揮交辦，補新舊後台對照表抓到的缺口）：
  // 職缺有硬性客戶條件（client_screen_conditions）、還沒被顧問處置過的應徵，
  // 見 index.js 的 /admin/screening。
  async screening() { return api.get('/admin/screening'); },
  async checkups() { return rows(await api.get('/admin/checkups'), 'rows', 'items', 'checkups'); },
  // 2026-09-15 驗證：job-intakes 陣列鍵是 rows（原本試 items/intakes 都不對，清單一直是空的）；
  // expertise 端點形狀是 {banks, missing} 兩個獨立陣列，不是單一 items/expertise 清單——banks 是
  // 已有題庫的職缺（每筆含 questions_json 原始字串），missing 是還沒建題庫的職缺，兩者要分開顯示。
  async jobs() {
    const [jobs, intakes, checks, expertise] = await Promise.all([
      api.get('/admin/jobs'), api.get('/admin/job-intakes'), api.get('/admin/must-check-pending'), api.get('/admin/expertise')
    ]);
    return {
      jobs: rows(jobs, 'jobs', 'items'), intakes: rows(intakes, 'rows', 'items', 'intakes'), checks: rows(checks, 'items', 'jobs'),
      expertise: rows(expertise, 'banks', 'items', 'expertise'), expertiseMissing: rows(expertise, 'missing'),
      // 正在排隊／產生中的職缺 slug，UI 用來把按鈕換成「⏳ 產生中」，
      // 避免顧問以為沒反應又多按幾次、重複燒額度。
      expertiseBuilding: (expertise && Array.isArray(expertise.building)) ? expertise.building : []
    };
  },
  async jobContent(slug) { return api.get(`/admin/jobs/${encodeURIComponent(slug)}/content`); },
  // 職缺卡（對話 B，2026-09-24）：等級／經驗值／命中率／回饋時間軸，見
  // step1ne-backoffice-worker/src/index.js 的 GET /admin/jobs/:slug/card。
  async jobCard(slug) { return api.get(`/admin/jobs/${encodeURIComponent(slug)}/card`); },
  // 職缺卡卡片牆（2026-09-24）：全部職缺一次撈，見 GET /admin/job-cards。
  async jobCards() { const r = await api.get('/admin/job-cards'); return r.jobs || []; },
  // 「阿財的理解」快照（2026-09-24），見 GET /admin/jobs/:slug/acai-view。
  async jobScreenTier(slug, tier, by) { return api.post(`/admin/jobs/${encodeURIComponent(slug)}/screen-tier`, { tier, by }); },
  async jobAcaiView(slug) { return api.get(`/admin/jobs/${encodeURIComponent(slug)}/acai-view`); },
  // 職缺抽屜「AI 找的人」分頁（2026-09-29），見 GET /admin/jobs/:slug/sourced。
  async jobSourced(slug) { return api.get(`/admin/jobs/${encodeURIComponent(slug)}/sourced`); },
  // 營運數據（2026-09-24），見 GET /admin/operations-trend。
  async operationsTrend() { return api.get('/admin/operations-trend'); },
  // 營運數據依職缺看（2026-09-24，總指揮交辦），見 GET /admin/jobs/:slug/operations-trend。
  async jobOperationsTrend(slug) { return api.get(`/admin/jobs/${encodeURIComponent(slug)}/operations-trend`); },
  // 待配對人選（2026-09-24，總指揮交辦）：job_slug='unspecified' 的人選，
  // 見 GET /admin/unmatched-candidates。
  async unmatchedCandidates() { const r = await api.get('/admin/unmatched-candidates'); return r.candidates || []; },
  async reassignJobUnmatched(applicationId, jobSlug, by) {
    return api.post('/admin/applications/reassign-job', { application_id: applicationId, job_slug: jobSlug, by });
  },
  async interviews() {
    const [live, sessions] = await Promise.all([api.get('/admin/interviews/live'), api.get('/admin/sessions')]);
    return { live: rows(live, 'items', 'interviews', 'sessions'), sessions: rows(sessions, 'items', 'sessions') };
  },
  async interviewDetail(id) { return api.get(`/admin/session/${encodeURIComponent(id)}`); },
  async social() {
    const [queue, accounts, clicks, line, coverage] = await Promise.all([
      api.get(`/admin/social-post-queue?limit=${CONFIG.analyticsQueueLimit}`), api.get('/admin/social-accounts'),
      api.get('/admin/link-clicks-by-account'), api.get('/admin/line-insight'), api.get('/admin/social/coverage?days=30')
    ]);
    return { queue: rows(queue, 'items', 'queue'), accounts: rows(accounts, 'items', 'accounts'), clicks, line, coverage };
  },
  // 舊版 consultant/social-post 月曆分頁在用的同一支——一次回傳這個月的帳號／
  // 在辦職缺／排好未發（planned）／已發或排隊（actual）／近14天有人選在跟阿財
  // 面談的職缺數（recentInterviews，排程建議引擎排序用這個，不是用發文次數）。
  async socialCalendar(month) { return api.get(`/admin/social/schedule?month=${encodeURIComponent(month)}`); },
  // /admin/bd 的陣列鍵是 rows（原本試 items/opportunities 都不對，BD 清單一直是空的）。
  async clients() {
    const [companies, bd, requests] = await Promise.all([api.get('/admin/portal/companies'), api.get('/admin/bd'), api.get('/admin/bd-requests')]);
    return { companies: rows(companies, 'items', 'companies'), bd: rows(bd, 'rows', 'items', 'opportunities'), requests: rows(requests, 'items', 'requests') };
  },
  async companyDetail(id) { return api.get(`/admin/portal/companies/${encodeURIComponent(id)}`); },
  async clientDoc(id) { return api.get(`/admin/client-docs/${encodeURIComponent(id)}`); },
  // 收費進程（2026-09-29，總指揮交辦，補新舊後台對照表抓到的缺口）：
  // 三支端點跟舊版 consultant/billing 一模一樣，見 index.js 對應段落。
  async billingPlan(companyId) { return api.get(`/admin/client-billing-plan?company_id=${encodeURIComponent(companyId)}`); },
  async saveBillingPlan(companyId, tiers) { return api.post('/admin/client-billing-plan', { company_id: companyId, tiers }); },
  async billingInstallments(companyId) {
    const q = companyId ? `?company_id=${encodeURIComponent(companyId)}` : '';
    return api.get(`/admin/billing-installments${q}`);
  },
  // 開發進度看板（2026-09-24）：漏斗＋逐家列表一次撈，點開一列才另外打 detail 拿時間軸跟信件全文。
  async bdDashboard() { return api.get('/admin/bd/dashboard'); },
  async bdWrapup() { return api.get('/admin/bd/wrapup'); },
  async bdDashboardDetail(company) { return api.get(`/admin/bd/dashboard/detail?company=${encodeURIComponent(company)}`); },
  async talentPool() { return api.get('/admin/talent-pool'); },
  async hiringSubmissions() { return rows(await api.get('/hiring-mode/submissions', { recruit: true }), 'items', 'submissions'); },
  // topic-prompts／style-prompts 陣列鍵分別是 topics／styles，不是共用的 items/prompts。
  // 2026-09-22：一鍵發文要的全部素材一次撈。舊版 consultant/social-post
  // 是分五支分別打，畫面分段亮起來；這裡一次 Promise.all，少四次往返。
  async socialComposer() {
    const [accounts, jobs, styles, topics] = await Promise.all([
      api.get('/admin/social-accounts'), api.get('/admin/jobs'),
      api.get('/admin/style-prompts'), api.get('/admin/topic-prompts'),
    ]);
    return {
      accounts: rows(accounts, 'items', 'accounts'),
      jobs: rows(jobs, 'jobs', 'items'),
      styles: rows(styles, 'styles', 'items', 'prompts'),
      topics: rows(topics, 'topics', 'items', 'prompts'),
    };
  },
  // 今日話題：每天早上自動生的 10 題菜單（企業端 5＋求職端 5）＋發文帳號清單。
  // date 不給＝今天；給 YYYY-MM-DD 就看那天的菜單（舊的菜單不會刪，一直留在 topic_prompts）
  async topicsToday(date) {
    const [menu, accounts, styles] = await Promise.all([
      api.get(`/admin/topics/today${date ? `?date=${encodeURIComponent(date)}` : ''}`), api.get('/admin/social-accounts'),
      api.get('/admin/style-prompts'),
    ]);
    const d = (menu && menu.data) || {};
    return {
      date: d.date, empty: d.empty,
      enterprise: d.enterprise || [], jobseeker: d.jobseeker || [],
      accounts: rows(accounts, 'items', 'accounts'),
      styles: rows(styles, 'styles', 'items', 'prompts'),
    };
  },
  async socialPostRequest(payload) { return api.post('/admin/social-post-request', payload); },
  async socialSchedule(payload) { return api.post('/admin/social/schedule', payload); },
  // 職缺社群回覆：每個職缺預先產好的「第一輪職缺摘要」（candidate_summary_tick.py 產的）。
  async candidateSummaries() {
    const [sum, accounts] = await Promise.all([
      api.get('/admin/candidate-summaries'), api.get('/admin/social-accounts'),
    ]);
    return { jobs: rows(sum, 'jobs', 'items'), accounts: rows(accounts, 'items', 'accounts') };
  },
  async socialPrompts() {
    const [topics, styles] = await Promise.all([api.get('/admin/topic-prompts'), api.get('/admin/style-prompts')]);
    return { topics: rows(topics, 'topics', 'items', 'prompts'), styles: rows(styles, 'styles', 'items', 'prompts'),
      consultants: rows(styles, 'consultants') };
  },
  async socialConsultants() { return rows(await api.get('/admin/social-consultants'), 'items', 'consultants'); },
  // ⚠️ 2026-09-24 修：陣列鍵是 rows（第 64 行那個註解早就寫了），這裡還在用 items/intakes，
  //    「待 AI 擬稿」分頁永遠是空的——Jacky 建完需求，TG 有通知、這頁卻看不到。
  //    只列還沒結束的（已發布／已拒絕的去「新增／收件」看全部）。
  async jobDrafts() {
    return rows(await api.get('/admin/job-intakes'), 'rows', 'items', 'intakes')
      .filter((r) => !['published', 'rejected'].includes(r.status));
  },
  // line-followup-overdue 的陣列鍵是 items（之前整包 {ok,items} 物件被當陣列傳給 view 的
  // list()，.map 會直接丟 render error）；kpi/pending 的陣列鍵是 rows，不是 items/pending。
  async system() {
    const [line, bindings, kpi, token, consultants, settings] = await Promise.all([
      api.get('/admin/line-followup-overdue'), api.get('/admin/line-bindings'), api.get('/admin/kpi/pending'),
      api.get('/admin/token-usage'), api.get('/admin/consultants'), api.get('/admin/settings')
    ]);
    // 2026-09-15 查證更正：settings 這裡一直是整包 {ok,settings:{...}} response body，
    // 不是 body.settings 本身——多包了一層，畫面上會看到 key="ok" value="true"、
    // key="settings" value="[object Object]" 這種假資料，之前藏在 JSON dump 裡不明顯。
    return { line: rows(line, 'items'), bindings: rows(bindings, 'items', 'bindings'), kpi: rows(kpi, 'rows', 'items', 'pending'), token, consultants: rows(consultants, 'items', 'consultants'), settings: settings?.settings || {} };
  },
  async featureUsage() { return api.get('/admin/feature-usage'); },
  async tokenUsage() { return api.get('/admin/token-usage'); },
  // 2026-09-17 加：顧問人選面談室。
  async consultants() { return rows(await api.get('/admin/consultants'), 'items', 'consultants'); },
  async linechatCandidates(owner) { return rows(await api.get(`/admin/line-chat/bound-candidates?owner=${encodeURIComponent(owner)}`), 'candidates'); },
  async linechatMessages(applicationId) { return rows(await api.get(`/admin/line-chat/${encodeURIComponent(applicationId)}/messages`), 'messages'); },
  async linechatSend(applicationId, text, consultantId) {
    return api.post(`/admin/line-chat/${encodeURIComponent(applicationId)}/send`, { text, consultant_id: consultantId });
  },
  async lineQuota() { return api.get('/admin/line-quota'); },
  // 2026-09-17 加，依 PRECALL v1.4 Contract 升級：GET 讀現有卡片狀態
  // （ready/stale/not_generated），POST 觸發產生／重新產生（force=true 強制）。
  async precallCardGet(applicationId) {
    return api.get(`/admin/application/${encodeURIComponent(applicationId)}/precall-card`);
  },
  async precallCardGenerate(applicationId, force = false) {
    return api.post(`/admin/application/${encodeURIComponent(applicationId)}/precall-card`, { force });
  },
  // 2026-09-18 加「職缺介紹」tab：純讀 jobs 既有欄位，跟電洽前準備卡是平行的
  // 兩支 API，不共用快取（這支沒有 stale/ready 狀態，職缺資料本來就是即時的）。
  async jobIntroGet(jobSlug) {
    return api.get(`/admin/jobs/${encodeURIComponent(jobSlug)}/intro`);
  },
  async jobNotesAdd(jobSlug, text2, by) {
    return api.post(`/admin/jobs/${encodeURIComponent(jobSlug)}/notes`, { text: text2, by });
  },
  // 2026-09-18 加（規格 B：電洽結果 Post-call）：跟 precall-card 同一套
  // GET 讀狀態／POST 觸發產生的模式，資料源是 applications.post_call_result_json。
  async postcallResultGet(applicationId) {
    return api.get(`/admin/application/${encodeURIComponent(applicationId)}/postcall-result`);
  },
  async postcallResultGenerate(applicationId, force = false) {
    return api.post(`/admin/application/${encodeURIComponent(applicationId)}/postcall-result`, { force });
  },
  async postcallDecision(applicationId, route, reason, by, action) {
    return api.post(`/admin/application/${encodeURIComponent(applicationId)}/postcall-decision`, { route, reason, by, action });
  },
  // 2026-09-18 加（P3-A 職缺推薦）：阿財面談結束後系統自動比對「其他開放職缺
  // 有沒有比人選原本應徵的更適合」，最多產 3 筆建議。跟 precall/postcall 不同的是
  // 這支沒有「產生」的按鈕——建議是面談結束自動跑的，前端只讀清單＋回寫顧問決定，
  // 所以只有 GET 清單跟 POST 決定兩支，沒有 generate。
  async recommendationsGet(applicationId) {
    return api.get(`/admin/application/${encodeURIComponent(applicationId)}/recommendations`);
  },
  // decision 只有 'approved'／'rejected' 兩種；rejection_reason 是選填（顧問可以
  // 不寫理由就按不採用），後端不會因為空字串擋下來，所以這裡不做必填檢查。
  // P3-B：顧問確認「要現在請阿財問他嗎」之後才打這支。後端會再跑一次全部
  // 閘門（顧問按過沒、有沒有綁 LINE、靜音時段、每日上限…），前端這裡不重複判斷
  // ——兩份規則遲早會不一致，不一致的那天就是有人收到不該收到的訊息。
  async p3bSendOne(recId) {
    return api.post('/admin/p3b/send-one', { rec_id: recId });
  },
  // 2026-10-01 AI 配對頁：所有人選 × 職缺的 AI 建議集中成一張清單
  async aiMatches(params = {}) {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    return api.get(`/admin/ai-matches${q ? '?' + q : ''}`);
  },
  // 2026-10-02 人選中心「快速判斷」：近期阿財報告一張小卡，按 推／要打電話／不推（只是內部記號）
  async triage(params = {}) {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    return api.get(`/admin/triage${q ? '?' + q : ''}`);
  },
  async candBd() { return api.get('/admin/cand-bd'); },
  async candBdRun(applicationId, by) { return api.post('/admin/cand-bd/run', { application_id: applicationId, by }); },
  async candBdDecide(targetId, act, by) { return api.post(`/admin/cand-bd/target/${encodeURIComponent(targetId)}/${act}`, { by }); },
  async callConfirm(applicationId, action, by, slot, salutation, phone) {
    return api.post(`/admin/applications/${encodeURIComponent(applicationId)}/call-confirm`, { action, by: by || null, slot, salutation: salutation || null, phone: phone || null });
  },
  async callMail(applicationId, action, by, picks = {}) {
    const p = picks || {};
    return api.post(`/admin/applications/${encodeURIComponent(applicationId)}/call-mail`, { action, by: by || null, note: p.note || null,
      ...(typeof p.askResume === 'boolean' ? { ask_resume: p.askResume } : {}),
      ...(Array.isArray(p.topics) ? { topics: p.topics } : {}), topic_extra: p.topicExtra || null });
  },
  async triageDecide(applicationId, decision, by, note) { return api.post('/admin/triage', { application_id: applicationId, decision, by, note: note || null }); },
  // 2026-10-01 外部人選資料卡＋Email 邀請
  async sourcedCard(id, job) { return api.get(`/admin/sourced/${encodeURIComponent(id)}/card${job ? '?job=' + encodeURIComponent(job) : ''}`); },
  async sourcedMailPreview(id, job, why) { return api.post(`/admin/sourced/${encodeURIComponent(id)}/email-preview`, { job_slug: job || null, why: why || null }); },
  async sourcedMailSend(id, job, by, why, test = false) { return api.post(`/admin/sourced/${encodeURIComponent(id)}/email-send`, { job_slug: job || null, by, why: why || null, test }); },
  async sourcedUnfit(id, by, reason) { return api.post(`/admin/sourced/${encodeURIComponent(id)}/unfit`, { by, reason }); },
  async aiMatchRun(jobSlug, by) { return api.post('/admin/ai-matches/run', { job_slug: jobSlug, by }); },
  async aiMatchEmailPreview(recId, why) { return api.post(`/admin/ai-matches/${encodeURIComponent(recId)}/email-preview`, { why: why || null }); },
  async aiMatchEmailSend(recId, by, why, test = false) { return api.post(`/admin/ai-matches/${encodeURIComponent(recId)}/email-send`, { by, why: why || null, test }); },
  async aiMatchLineSend(recId, by) { return api.post(`/admin/ai-matches/${encodeURIComponent(recId)}/line-send`, { by }); },
  async aiMatchReject(recId, by, reason) { return api.post(`/admin/ai-matches/${encodeURIComponent(recId)}/reject`, { by, reason: reason || null }); },
  async recommendationDecision(recId, decision, by, rejectionReason) {
    return api.post(`/admin/recommendation/${encodeURIComponent(recId)}/decision`, {
      decision, by, rejection_reason: rejectionReason || null
    });
  }
};

export const analyticsAdapter = Object.freeze({
  recruitment: async () => ({ available: false, reason: 'Production 尚無支援日期、顧問與職缺維度的唯讀 aggregate API。' }),
  socialTrend: async () => ({ available: false, reason: '長期 post_metric_snapshots 趨勢尚無唯讀 aggregate API。' })
});
