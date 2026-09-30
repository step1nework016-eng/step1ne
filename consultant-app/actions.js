// Mutation registry for existing production write endpoints (see api_inventory.json).
// Every path/method here is attested in api_inventory.json or the refactor plan (§3.2–§3.6).
// Field NAMES for endpoints that take free-form payloads (owner/stage/note/...) follow the
// naming convention already used by this codebase (application_id, owner, stage — see
// app.js reopen-interview and adapters.js) since the sandbox has no live backend/ADMIN_TOKEN
// to confirm exact schemas; this is called out in docs/API_INTEGRATION_REPORT.md.

// 面談題庫「改一題／加一題」共用的欄位表。標籤刻意寫成中文問句而不是欄位名
// （q / good_signs 這種），因為使用這個表單的是顧問不是工程師。
// ⚠️ good_signs／red_flags 在資料裡是陣列，在表單裡要變成「一行一條」的多行文字。
// 這裡一定要自己轉：app.js 開表單時是 formFields(fields, ctx.record)，ctx.record
// 的值會**蓋過**欄位自己的 value，而原始陣列丟進 template literal 會被 JS 用
// 預設的 String(array) 轉成「a,b,c」——2026-09-20 實測就是這樣把 3 條訊號黏成
// 1 條存回資料庫的。所以 views 那邊傳進來的 record 已經先 join 過，這裡再容錯
// 一次（陣列就 join，字串就原樣用），兩種都吃得下。
const lines2text = (v) => (Array.isArray(v) ? v.join('\n') : (v || ''));

const expertiseQuestionFields = (q = {}) => [
  { name: 'q', label: '題目：阿財要問什麼？', type: 'textarea', rows: 3, required: true, value: q.q || '' },
  { name: 'topic', label: '這題在測什麼技能？（例：Revit建模實務、月結）', value: q.topic || '' },
  {
    name: 'kind', label: '題型', type: 'select', value: q.kind || '經驗',
    options: [
      { value: '經驗', label: '經驗　問他做過什麼' },
      { value: '技術', label: '技術　問專業知識' },
      { value: '情境', label: '情境　當場請他做，不是問他會不會' },
      { value: '外語', label: '外語　當場切換語言實測' },
    ],
  },
  { name: 'why', label: '為什麼要問這題？（只給阿財看，不會唸給候選人聽）', type: 'textarea', rows: 2, value: q.why || '' },
  {
    name: 'good_signs', label: '真做過的人會提到什麼？（一行一條）', type: 'textarea', rows: 4,
    value: lines2text(q.good_signs),
  },
  {
    name: 'red_flags', label: '沒做過會怎麼含糊帶過？（一行一條）', type: 'textarea', rows: 4,
    value: lines2text(q.red_flags),
  },
  { name: 'followup', label: '答得含糊要追問什麼？', type: 'textarea', rows: 2, value: q.followup || '' },
  { name: 'editor', label: '你的名字（記錄誰改的）' },
];

const BLOCKED_KEYS = new Set([
  'application_id', 'id', 'job_id', 'candidate_id', 'company_id', 'created_at', 'updated_at',
  'last_activity_at', 'stage_events', 'activities', 'forwards', 'candidate_forwards', 'messages'
]);

// Build editable field defs straight from a live record's own scalar keys, so we never invent
// a field name the API never showed us.
export function objectFields(obj, extraBlocked = []) {
  if (!obj || typeof obj !== 'object') return [];
  const blocked = new Set([...BLOCKED_KEYS, ...extraBlocked]);
  return Object.entries(obj)
    .filter(([key, val]) => !blocked.has(key) && (typeof val === 'string' || typeof val === 'number' || val === null))
    .map(([key, val]) => ({ name: key, label: key, value: val ?? '', type: String(val || '').length > 60 ? 'textarea' : 'text' }));
}

const idBody = (ctx, values) => ({ ...(ctx.idParams || {}), ...values });

export const ACTIONS = {
  // ---- 候選人 / application ----
  // Field names below are verified 2026-09-15 against the real backend handler in
  // step1ne-backoffice-worker/src/index.js (not guessed) — see FINAL_REPORT verification log.
  'application-notes': { label: '新增顧問備註', method: 'post', path: () => '/admin/application/notes', fields: [{ name: 'type', label: '備註類型', type: 'select', options: [{ value: '評估', label: '評估' }, { value: '聯繫紀錄', label: '聯繫紀錄' }, { value: '客戶回饋', label: '客戶回饋' }, { value: '其他', label: '其他' }] }, { name: 'content', label: '備註內容', type: 'textarea', required: true }], body: idBody, success: '備註已儲存' },
  // 2026-09-17 改名（PRECALL_PHASE1）：跟新加的 AI Pre-call Card 撞名，這顆其實
  // 是手動打字存筆記的表單（doCallNote），不是 AI 產生的那個，改名避免混淆。
  // 2026-09-17 補檔案上傳：後端 doCallNote() 本來就吃 file_b64（沒填文字時退回讀檔案，
  // env.AI.toMarkdown 轉成文字），V3 重做時前端漏掉這個欄位，只剩文字框——這裡補回來，
  // 跟 TG「📞 電洽新增人選」那條路徑（文字或檔案擇一）行為一致，不是新設計一套規則。
  'application-call-note': { label: '手動記一筆電洽重點', method: 'post', path: () => '/admin/application/call-note', fields: [{ name: 'text', label: '電洽重點（可直接貼逐字稿文字）', type: 'textarea' }, { name: 'file', label: '或上傳逐字稿檔案（txt／pdf／doc，跟文字擇一填即可）', type: 'file', accept: '.txt,.pdf,.doc,.docx' }], body: idBody, success: '已儲存' },
  'application-call-summary': { label: '電洽摘要', method: 'post', path: () => '/admin/application/call-summary', fields: [{ name: 'content', label: '電洽摘要', type: 'textarea', required: true }], body: idBody, success: '電洽摘要已儲存' },
  // /admin/set-owner is shared by application/sourced/placement rows and keys off {kind,id}, not
  // a domain-specific id field — the caller must pass idParams:{kind:'application'|'sourced'|'placement', id}.
  // 2026-09-15 改：原本要顧問自己手打 consultants.id / 階段代碼這種內部識別碼，
  // 使用者反映「有些可以下拉選單的要做」——改成真正的下拉選單。顧問名單由
  // app.js 的 ensureConsultants() 在打開這個動作前先抓好、塞進 ctx.record._consultants
  // （openAction 本身是同步的，fields 不能自己發 async 請求，只能等呼叫端先準備好）。
  'set-owner': { label: '指派負責顧問', method: 'post', path: () => '/admin/set-owner', fields: (ctx) => [{ name: 'owner', label: '負責顧問', type: 'select', required: true, options: [{ value: '', label: '未指派' }, ...((ctx.record?._consultants || []).filter((c) => c.is_active).map((c) => ({ value: c.id, label: c.display_name })))] }], body: idBody, success: '負責顧問已更新' },
  // 階段代碼照抄後端 STAGE_ORDER（src/index.js）的真實九＋一個列舉，不是隨便編的。
  'set-manual-stage': { label: '手動調整階段', method: 'post', path: () => '/admin/set-manual-stage', fields: [{ name: 'stage', label: '階段', type: 'select', required: true, wide: true, options: [{ value: 'screening', label: '阿財初審' }, { value: 'confirm', label: '顧問確認' }, { value: 'stage1', label: '第一階段' }, { value: 'stage2', label: '第二階段' }, { value: 'stage3', label: '第三階段' }, { value: 'stage4', label: '第四階段' }, { value: 'offer', label: '錄取' }, { value: 'onboard', label: '報到' }, { value: 'care', label: '到職關懷' }, { value: 'backup', label: '備選' }] }, { name: 'note', label: '備註', type: 'textarea' }], body: idBody, success: '階段已更新' },
  // ⚠️ 未驗證：/admin/clear-decision 要的是 reports.id（報告本身的 id），不是 application_id。
  // 目前呼叫端（candidate drawer）context 裡只有 application_id，沒有報告 id——送出會被後端
  // 安全擋下（400 缺報告 id），不會誤刪錯資料，但這顆按鈕目前實際上動不了，需要之後把報告 id
  // 一起帶進 drawer context 才能修好。
  'clear-decision': { label: '清除決策', method: 'post', path: () => '/admin/clear-decision', fields: [], body: idBody, success: '決策已清除', confirmText: '確定要清除此應徵單目前的顧問決策？' },
  // 2026-09-15 拔除「mark-closed／結案不續」：doMarkClosed() 沒有 client_id 過濾，
  // 且 notify=true 時會連帶把 consultant_decision 設成 rejected，擋住人選之後被
  // 推薦給其他客戶——結案講的其實只是這家客戶的職缺結束，不代表人選本身有問題。
  // 已查證用人單位 /portal/* 不讀 placements.stage=CLOSED_*，可以安全拔。「不推進」
  // 交給下面正確 per-client scope 的 pipeline-not-recommended。
  // 「不報到」跟「結案不續」是分開的欄位（no_show_reason 純內部備忘，close_reason
  // 才會組進候選人訊息）——只有已經有報到日期的 placement 才能標，後端會擋沒有的。
  'placement-no-show': { label: '標記不報到', method: 'post', path: () => '/admin/placement/no-show', fields: [{ name: 'reason', label: '不報到原因（內部備忘，不會送給候選人）', type: 'textarea', required: true }], body: idBody, success: '已標記不報到', dangerous: true },
  // ---- 開發進度看板（2026-09-24）----
  // 漏斗最後兩格（談到職缺／成交）沒有事件可以自動判斷，讓顧問手動標一下。
  // stage 選「清除標記」時 values.stage 會是空字串，body 這裡轉成 null。
  'bd-stage': { label: '標記漏斗階段', method: 'post', path: (ctx) => `/admin/bd/${encodeURIComponent(ctx.idParams.id)}/stage`, fields: [{ name: 'stage', label: '階段', type: 'select', required: true, options: [{ value: 'jd_shared', label: '談到職缺' }, { value: 'closed', label: '成交' }, { value: '', label: '清除標記（還沒到這步）' }] }, { name: 'by', label: '你是誰（記錄誰標的）' }], body: (ctx, values) => ({ stage: values.stage || null, by: values.by }), success: '階段已更新' },
  // Phoebe 電訪完在 TG 回報，顧問或 Jacky 看到後點進來記一筆，看板才看得到電訪進度。
  'bd-call-result': { label: '記錄電話結果', method: 'post', path: (ctx) => `/admin/bd/${encodeURIComponent(ctx.idParams.id)}/call-result`, fields: [{ name: 'result', label: '這通電話結果', type: 'select', required: true, options: [{ value: 'no_answer', label: '沒接' }, { value: 'gatekeeper', label: '被總機擋' }, { value: 'got_contact', label: '問到窗口（姓名／分機）' }, { value: 'got_email', label: '拿到信箱' }, { value: 'interested', label: '有興趣（要寄合約／資料）' }, { value: 'not_hiring', label: '沒在徵人' }, { value: 'not_interested', label: '拒絕' }] }, { name: 'caller', label: '誰打的（沒填就記這家的負責人）' }, { name: 'contact_name', label: '窗口姓名／職稱（有問到才填）' }, { name: 'hr_phone', label: '人資電話／分機（有問到才填）' }, { name: 'email', label: '信箱（有拿到才填）' }, { name: 'note', label: '補充（對方說了什麼、下次什麼時候打）', type: 'textarea' }, { name: 'next_time', label: '下一通要怎麼講（選填，有填會同時存成一則通話心得）', type: 'textarea' }], body: (ctx, values) => values, success: '已記錄這一通（每一通都會累積在時間軸）；沒接／被擋會在 2 個工作天後提醒再打' },
  // 職缺抽屜「AI 找的人」分頁的「記錄聯絡」（2026-09-29）。寫法照抄上面 bd-call-result：
  // 每聯絡一次記一筆（sourced_call_logs 會累積），送出後重開同一個職缺抽屜停在這個分頁（見 app.js reopenJobTab）。
  'sourced-contact': { label: '記錄聯絡', method: 'post', reopenJobTab: 'sourced', path: (ctx) => `/admin/sourced/${encodeURIComponent(ctx.idParams.id)}/contact`, fields: [{ name: 'result', label: '這次聯絡的結果', type: 'select', required: true, options: [{ value: 'no_answer', label: '沒接／沒回' }, { value: 'interested', label: '有興趣' }, { value: 'not_interested', label: '沒興趣' }, { value: 'invited', label: '已約阿財面談' }, { value: 'wrong_person', label: '資料不對／不是本人' }] }, { name: 'fit', label: '這個人符不符合職缺？（算「AI 找人精準度」用）', type: 'select', options: [{ value: '', label: '先不評' }, { value: 'fit', label: '符合' }, { value: 'unfit', label: '不符合' }, { value: 'unsure', label: '不確定' }] }, { name: 'caller', label: '誰聯絡的（沒填就記這位人選的負責顧問）' }, { name: 'note', label: '備註（對方說了什麼、為什麼不符合、下次什麼時候再聯絡）', type: 'textarea' }, { name: 'transcript', label: '電洽逐字稿（選填；有填 AI 會評分、判斷意願與適配度）', type: 'textarea', rows: 5 }, { name: 'transcript_file', label: '或上傳逐字稿檔（.md／.txt，會讀進上面那格）', type: 'file', accept: '.md,.txt,text/plain,text/markdown', textInto: 'transcript' }], body: (ctx, values) => values, success: '已記錄這次聯絡（有附逐字稿的話 AI 約 1～3 分鐘後看完）' },
  // 客戶開發卡片「通話心得」（2026-09-29 Jacky）：每寫一次存一筆、累積。三個欄位至少填一個（後端也會擋）。
  // 「誰寫的」沿用開發進度的指派名單（/admin/bd/dashboard/detail 回的 people）；送出後重開同一家公司的抽屜。
  'bd-note-create': { label: '新增通話心得', method: 'post', reopenBdCompany: true, path: () => '/admin/bd/notes', fields: (ctx) => [{ name: 'author', label: '誰寫的', type: 'select', required: true, options: [{ value: '', label: '請選擇…' }, ...((ctx.record?._people || []).map((n) => ({ value: n, label: n })))] }, { name: 'learned', label: '這通學到什麼', type: 'textarea' }, { name: 'next_time', label: '下一通要怎麼講', type: 'textarea' }, { name: 'problem', label: '遇到的問題（要 Jacky 幫忙的也寫這裡）', type: 'textarea' }], body: (ctx, values) => ({ ...values, company: ctx.idParams.company }), success: '已存這則心得（每一則都會累積）' },
  'decide-report': { label: 'AI 初篩報告決策', method: 'post', path: () => '/admin/decide-report', fields: [{ name: 'decision', label: '決策', type: 'select', required: true, options: [{ value: 'forwarded', label: '會推（轉給客戶）' }, { value: 'need_more', label: '再看看' }, { value: 'rejected', label: '不推' }] }, { name: 'note', label: '備註', type: 'textarea' }], body: (ctx, values) => ({ ...idBody(ctx, values), app_id: ctx.idParams.application_id }), success: '報告決策已送出' },
  'screen-decide': { label: 'AI 篩選決策', method: 'post', path: () => '/admin/screen-decide', fields: [{ name: 'decision', label: '決策', type: 'select', required: true, options: [{ value: 'approved', label: '核准進面談' }, { value: 'redirect', label: '轉介到其他職缺' }, { value: 'declined', label: '婉拒' }] }, { name: 'note', label: '備註', type: 'textarea' }, { name: 'redirect_job_slug', label: '轉介職缺 slug（僅轉介時填）' }], body: idBody, success: '篩選決策已送出' },
  // 2026-09-15 改：原本用 objectFields(ctx.record) 把整包 applications 原始欄位
  // 攤平成表單——不只欄位名是英文技術代號（job_slug/utm_source/resume_file_id…），
  // 後端 /admin/application/update 其實只認 10 個白名單欄位，其餘送了也會被
  // 後端靜靜忽略（不會報錯，但也不會存，使用者以為改了其實沒改）。改成照抄
  // 後端白名單、給真正的中文標籤。
  // 2026-09-18 加 job_slug 下拉：阿財初審／電洽新增常常走「暫無適合職缺」
  // （job_slug='unspecified'），事後談出方向才知道要配哪個職缺，之前只能
  // 找 Claude 手動改 D1（周亦宣案例）。留空＝不變更，選了才會換。
  'application-update': { label: '編輯應徵單', method: 'post', path: () => '/admin/application/update', fields: (ctx) => { const r = ctx.record || {}; return [
    { name: 'job_slug', label: '職缺（目前：' + (r.job_title || r.job_slug || '未指定') + '，留空＝不變更）', type: 'select', wide: true, options: [{ value: '', label: '（不變更）' }, ...((r._jobs || []).map((j) => ({ value: j.slug, label: j.title })))] },
    { name: 'name', label: '姓名', value: r.name || '' },
    { name: 'email', label: 'Email', value: r.email || '' },
    { name: 'phone', label: '電話', value: r.phone || '' },
    { name: 'expected_salary', label: '期望薪資', value: r.expected_salary || '' },
    { name: 'available_date', label: '可上班日', value: r.available_date || '' },
    { name: 'location_ok', label: '地點意願', value: r.location_ok || '', wide: true },
    { name: 'resume_url', label: '履歷連結', value: r.resume_url || '', wide: true },
    { name: 'source_channel', label: '聯絡來源', value: r.source_channel || '' },
    { name: 'resume_source', label: '履歷來源', value: r.resume_source || '' },
    { name: 'note', label: '備註', type: 'textarea', wide: true, value: r.note || '' },
  ]; }, body: idBody, success: '應徵單已更新' },
  // ---- forward flow ----
  // 客戶下拉同樣靠 app.js 的 ensureCompanies() 先抓好塞進 ctx.record._companies。
  // 2026-09-15 拔除：'forward-candidate' 改用 app.js 的 openForwardCandidate()
  // 自訂彈窗（客戶→職缺級聯選單，通用 ACTIONS 表單框架做不出依賴選單）；
  // 'pipeline-manual-forward' 整個拔掉——它送的欄位（company_id）跟真正呼叫的
  // /admin/pipeline/manual-forward（實為 doManualForward）要的欄位（source_kind/
  // source_id/job_slug/consent_confirmed）對不上，點下去必定失敗，詳見 app.js
  // openCandidate() 裡「手動推薦」按鈕拔除處的註解。
  'pipeline-unforward-candidate': { label: '取消推薦', method: 'post', path: () => '/admin/pipeline/unforward-candidate', fields: [], body: idBody, success: '已取消此筆推薦', confirmText: '確定要取消這筆推薦嗎？' },
  // 2026-09-15 查證更正：`/admin/pipeline/forward-decision` 實際語意是「顧問自己
  // 標記不推薦／改回推進」（UPDATE candidate_forwards.advisor_not_recommended_*），
  // 不是「客戶端決策」——後端根本不認 decision/note 這兩個欄位，原本這顆按鈕點下去
  // 送出「有興趣」實際上什麼都不會發生（b.not_recommended 是 undefined→false，
  // 等於一次空的「改回推進」）。拆成語意正確的兩顆按鈕，跟舊版 notrecSet/
  // notrecClear 對齊。
  'pipeline-not-recommended': { label: '標不推進（這家客戶這個職缺）', method: 'post', path: () => '/admin/pipeline/forward-decision', fields: [{ name: 'reason', label: '不推薦原因（企業用人單位需求表會看到，是寫給對方看的措辭）', type: 'textarea', required: true }], body: (ctx, values) => ({ application_id: ctx.idParams.application_id, company_id: ctx.idParams.company_id, not_recommended: true, reason: values.reason }), success: '已標記不推進', dangerous: true },
  // 2026-09-21 加：人選自己放棄。跟「標不推進」是完全不同的事——
  // 不推進是「我們／客戶決定不推這個人」，這個是「人選自己走了」。
  // 顧問 09-21 撞到「這位人選已經確認推進，無法再標記為不推進」，
  // 就是因為系統只有前者沒有後者（人選拿到別家 offer 要退出）。
  // 這顆不受「已確認推進」擋，也不會蓋掉客戶原本的決定。
  'pipeline-candidate-withdraw': {
    label: '標記人選已放棄', method: 'post', path: () => '/admin/pipeline/candidate-withdraw',
    fields: [{ name: 'reason', label: '人選放棄的原因（例如：已接受其他 offer、薪資談不攏、流程太久）', type: 'textarea', required: true },
             { name: 'by', label: '你的名字（記錄誰回報的）' }],
    body: (ctx, values) => ({ application_id: ctx.idParams.application_id, company_id: ctx.idParams.company_id, ...values }),
    success: '已記錄人選放棄', dangerous: true,
    confirmText: '確定這位人選已經放棄這個機會嗎？（這不會蓋掉客戶原本的推進／不推進決定）',
  },
  'pipeline-candidate-withdraw-undo': {
    label: '收回「已放棄」', method: 'post', path: () => '/admin/pipeline/candidate-withdraw',
    fields: [], body: (ctx) => ({ application_id: ctx.idParams.application_id, company_id: ctx.idParams.company_id, undo: true }),
    success: '已收回', confirmText: '確定要把「人選已放棄」收回嗎？（人選反悔回來的情況）',
  },
  'pipeline-recommended-again': { label: '改回推進', method: 'post', path: () => '/admin/pipeline/forward-decision', fields: [], body: (ctx) => ({ application_id: ctx.idParams.application_id, company_id: ctx.idParams.company_id, not_recommended: false }), success: '已改回推進', confirmText: '確定要把這家客戶這個職缺改回推進中嗎？' },
  'pipeline-message-client': { label: '傳訊息給客戶', method: 'post', path: () => '/admin/pipeline/message-client', fields: [{ name: 'message', label: '訊息內容', type: 'textarea', required: true }], body: idBody, success: '訊息已送出' },
  // 2026-09-29 修：原本打 /admin/client-formal-reports/（不存在，按了一律失敗）。
  // 真正產客戶版推薦履歷的是 /admin/application/:id/client-formal-report（舊版人選追蹤頁用的那支）：
  // 有阿財結構化報告的，本機排程 1～2 分鐘產 PDF 草稿，產好 TG 會通知，卡片上就能下載。
  'client-formal-report': {
    label: '製作推薦履歷（AI 草稿）', method: 'post',
    path: (ctx) => `/admin/application/${encodeURIComponent(ctx.idParams.application_id)}/client-formal-report`,
    fields: [], body: (ctx) => (ctx.idParams.company_id ? { company_id: ctx.idParams.company_id } : {}),
    success: '已開始製作，1～2 分鐘後重新打開卡片，最上面「客戶履歷」那格就能下載（TG 也會通知）',
    confirmText: '用阿財報告＋履歷幫這家客戶做一份推薦履歷草稿？做好後你下載修改，再用「上傳推薦履歷」傳正式版給客戶。',
  },
  // 2026-09-29 修：原本這顆「確認報告已上傳」沒有帶檔案，後端一律回 400（缺 pdf_b64）——
  // 顧問做好的推薦履歷在新版根本傳不上去。改成真的選 PDF 上傳，跟舊版人選追蹤頁同一支端點。
  'client-formal-report-upload': {
    label: '上傳推薦履歷', method: 'post', path: () => '/admin/client-formal-reports/confirm-upload',
    fields: [{ name: 'file', label: '選擇顧問做好的推薦履歷（PDF）。上傳後客戶在企業後台就看得到。', type: 'file', accept: 'application/pdf,.pdf', required: true }],
    body: (ctx, values) => ({ ...(ctx.idParams || {}), pdf_b64: values.file_b64, filename: values.file_name }),
    success: '已上傳，客戶在企業後台看得到了',
  },
  // 2026-09-29 加（總指揮交辦，補新舊後台對照表抓到的缺口）：LINE ID／客戶
  // 備註原本只能看不能改——後端 /admin/pipeline/forward-detail 早就支援
  // 寫入這兩個欄位（見 index.js 對應段落的查證註解），只是前端一直沒接。
  'forward-detail-update': {
    label: '編輯 LINE ID／客戶備註', method: 'post', path: () => '/admin/pipeline/forward-detail',
    fields: [
      { name: 'line_id_given', label: 'LINE ID（顧問自己跟人選要來的）' },
      { name: 'client_note', label: '給客戶看的備註', type: 'textarea' },
    ],
    body: idBody, success: '已更新',
  },
  // 客製表單：寄送／代為上傳／催填／下載，四個動作對應 index.js 的
  // /admin/candidate-form-submissions/* 四支端點——資料早就在（forms[]，
  // 見 /admin/application/:id/card 的查證註解），這裡只補操作介面。
  'candidate-form-trigger': {
    label: '寄送表單', method: 'post', path: () => '/admin/candidate-form-submissions/trigger',
    fields: [], body: (ctx) => ({ ...ctx.idParams, by: '顧問' }), success: '已寄送',
  },
  'candidate-form-upload': {
    label: '代為上傳已填寫的表單', method: 'post', path: () => '/admin/candidate-form-submissions/upload',
    fields: [{ name: 'file', label: '上傳已經填好的表單檔案（人選用電話/LINE/當面把填好的表單給你）', type: 'file', required: true }],
    body: idBody, success: '已上傳，客戶那邊立刻看得到',
  },
  'candidate-form-resend': {
    label: '催填（重新寄送提醒）', method: 'post', path: (ctx) => `/admin/candidate-form-submissions/${encodeURIComponent(ctx.idParams.id)}/resend`,
    fields: [], body: () => ({}), success: '已重新寄送提醒信',
  },
  // 收費：客戶在 portal 回報已匯款、顧問這裡快速確認——跟收費進程頁的
  // /admin/billing-installments/confirm 是同一支，卡在人選詳情這裡先擋一步
  // 是為了不用為了確認一筆錢特地跳去另一個分頁。
  'billing-confirm-received': {
    label: '✅ 確認已收到這筆款項', method: 'post', path: () => '/admin/billing-installments/confirm',
    fields: [], body: (ctx) => ({ id: ctx.idParams.id, received: true, by: '顧問' }), success: '已確認收到',
  },
  'billing-confirm-not-received': {
    label: '❌ 客戶回報的匯款還沒收到', method: 'post', path: () => '/admin/billing-installments/confirm',
    fields: [], body: (ctx) => ({ id: ctx.idParams.id, received: false, by: '顧問' }), success: '已標記未收到', dangerous: true,
  },
  'billing-mark-paid': {
    label: '標記已收款', method: 'post', path: () => '/admin/billing-installments/mark-paid',
    fields: [], body: (ctx) => ({ id: ctx.idParams.id, paid: true, by: '顧問' }), success: '已標記已收款',
  },
  'billing-mark-unpaid': {
    label: '標記未收款', method: 'post', path: () => '/admin/billing-installments/mark-paid',
    fields: [], body: (ctx) => ({ id: ctx.idParams.id, paid: false }), success: '已標記未收款',
  },
  // ---- 人才池 / sourced ----
  // 2026-09-15 查證更正：上面那句「皆可單筆或多筆 ids」是錯的。真的支援 ids 陣列（可以
  // 勾多筆一次送）的只有 assign-owner；status／invite／resume 後端都只認單一 b.id，
  // bulk 模式送出的 payload 只有 {ids:[...]}，沒有 id 欄位，後端一律回「缺 id」400——
  // 之前這三顆按鈕擺在勾選列的「批次」按鈕區，點了必定失敗。已在 views.js 把這三顆
  // 移到每一筆人選自己的操作列（單筆、非 bulk），只留 assign-owner 在批次區。
  'sourced-assign-owner': { label: '指派負責顧問', method: 'post', path: () => '/admin/sourced/assign-owner', fields: (ctx) => [{ name: 'owner', label: '負責顧問', type: 'select', required: true, options: [{ value: '', label: '未指派' }, ...((ctx.record?._consultants || []).filter((c) => c.is_active).map((c) => ({ value: c.id, label: c.display_name })))] }], body: idBody, success: '已指派負責顧問' },
  // 狀態列舉與「rejected 一定要附 reason」是後端硬規則（見 REJECT_REASONS）；reason 沒放進
  // conditional-required 是因為這套 form 框架沒有欄位互相依賴的機制，先讓它一律可填。
  'sourced-status': { label: '更新狀態', method: 'post', path: () => '/admin/sourced/status', fields: [{ name: 'status', label: '狀態', type: 'select', required: true, options: [{ value: 'shortlisted', label: '挑出來' }, { value: 'contacted', label: '已接觸' }, { value: 'replied', label: '有回覆' }, { value: 'standby', label: '預備區（先養著）' }, { value: 'rejected', label: '不合適' }, { value: 'converted', label: '已轉正式應徵' }] }, { name: 'reason', label: '不合適原因（選「不合適」時必填）', type: 'select', options: [{ value: '地點不行', label: '地點不行' }, { value: '資歷差太多', label: '資歷差太多' }, { value: '職類根本不對', label: '職類根本不對' }, { value: '找不到聯絡方式', label: '找不到聯絡方式' }, { value: '已有工作或沒意願', label: '已有工作或沒意願' }, { value: '其他', label: '其他' }] }, { name: 'note', label: '備註', type: 'textarea' }], body: idBody, success: '狀態已更新' },
  // job_slug 改成從真實職缺清單下拉選（見 app.js 對這顆的攔截，塞 ctx.record._jobs），
  // 不再要顧問手key raw slug。這顆只是「寄一個自己填的連結」，不會建立 application——
  // 真的要幫他建檔要用下面新加的「轉入正式應徵（顧問建檔）」。
  'sourced-invite': { label: '邀請應徵', method: 'post', path: () => '/admin/sourced/invite', fields: (ctx) => [{ name: 'job_slug', label: '職缺', type: 'select', required: true, options: (ctx.record?._jobs || []).map((j) => ({ value: j.slug, label: j.title })) }], body: idBody, success: '邀請連結已產生，複製給人選' },
  // 2026-09-15 修：原本這顆叫「轉入正式應徵」但打的 /admin/sourced/resume 其實只是幫
  // sourced_candidates 這筆存履歷檔／連結，根本不會建立 application——標籤跟實際行為
  // 完全對不上，顧問點了以為人選已經轉正，其實什麼都沒發生。改成正確標籤跟正確欄位
  // （履歷連結／備註，不是 job_slug）。真的要建 application 要用「轉入正式應徵（顧問建檔）」。
  'sourced-resume': { label: '上傳履歷連結', method: 'post', path: () => '/admin/sourced/resume', fields: [{ name: 'resume_url', label: '履歷連結', required: true }, { name: 'resume_note', label: '備註', type: 'textarea' }], body: idBody, success: '履歷已存檔' },
  // 同樣照抄後端 /admin/sourced/update 的真實白名單，換成中文標籤。
  'sourced-update': { label: '編輯人才池資料', method: 'post', path: () => '/admin/sourced/update', fields: (ctx) => { const r = ctx.record || {}; return [
    { name: 'name', label: '姓名', value: r.name || '' },
    { name: 'headline', label: '現職／職稱', value: r.headline || '' },
    { name: 'company', label: '現職公司', value: r.company || '' },
    { name: 'location', label: '所在地', value: r.location || '' },
    { name: 'email', label: 'Email', value: r.email || '' },
    { name: 'phone', label: '電話', value: r.phone || '' },
    { name: 'linkedin_url', label: 'LinkedIn 連結', value: r.linkedin_url || '', wide: true },
    { name: 'source_url', label: '來源連結', value: r.source_url || '', wide: true },
    { name: 'skills', label: '技能', value: r.skills || '', wide: true },
    { name: 'note', label: '備註', type: 'textarea', wide: true, value: r.note || '' },
  ]; }, body: idBody, success: '資料已更新' },
  // ---- 職缺 ----
  'job-draft-patch': { label: '編輯 AI 草稿', method: 'post', path: (ctx) => `/admin/job-draft/${encodeURIComponent(ctx.idParams.id)}/patch`, fields: (ctx) => objectFields(ctx.record), body: (ctx, values) => values, success: '草稿已更新' },
  'job-draft-delete': { label: '刪除草稿', method: 'post', path: (ctx) => `/admin/job-draft/${encodeURIComponent(ctx.idParams.id)}/delete`, fields: [], body: () => ({}), success: '草稿已刪除', dangerous: true, confirmText: '確定要刪除此 AI 草稿？此動作無法復原。' },
  'must-check-confirm': { label: '確認必要條件', method: 'post', path: (ctx) => `/admin/jobs/${encodeURIComponent(ctx.idParams.slug)}/must-check-confirm`, fields: [], body: () => ({}), success: '必要條件已確認' },
  // 後端要的是 questions 陣列（每題 q/topic/why/kind/good_signs/red_flags/followup），不是扁平
  // 物件——這套 form 框架沒有巢狀陣列編輯器，用「整份 JSON 貼上」當務實解法，不是理想 UI。
  'expertise-save': { label: '儲存題庫修改（JSON）', method: 'post', path: () => '/admin/expertise/save', fields: (ctx) => [{ name: 'questions_json', label: '題目 JSON（陣列，每題含 q/topic/why/kind/good_signs/red_flags/followup）', type: 'textarea', required: true, wide: true, value: JSON.stringify(ctx.record?.questions || ctx.record?.questions_json || [], null, 2) }, { name: 'editor', label: '編輯者名字' }], body: (ctx, values) => { let questions; try { questions = JSON.parse(values.questions_json); } catch { throw new Error('題目 JSON 格式錯誤，請確認是合法陣列'); } return { job_slug: ctx.idParams.job_slug, questions, editor: values.editor }; }, success: '題庫已儲存' },
  'expertise-restore': { label: '還原題庫', method: 'post', path: () => '/admin/expertise/restore', fields: [], body: idBody, success: '題庫已還原', dangerous: true, confirmText: '確定要還原此職缺的面談題庫到上一版？' },

  // ── 2026-09-20 加：一題一題改。──────────────────────────────────────
  // 在這之前只有上面那顆 expertise-save，它開出來是一個裝著原始 JSON 的文字框
  // （標籤原文：「題目 JSON（陣列，每題含 q/topic/why/kind/good_signs/...）」）。
  // Jacky 明講過他不是工程師、看不懂程式碼——那個框對他等於不存在，所以題庫
  // 上線這麼久從來沒被人工調整過。這三顆是正常的表單，欄位都是中文問句。
  // 「好的訊號」「警訊」用多行輸入（一行一條），後端幫忙切，顧問不用學陣列語法。
  'expertise-question-edit': {
    label: '改這題', method: 'post', path: () => '/admin/expertise/question',
    fields: (ctx) => expertiseQuestionFields(ctx.record || {}),
    body: (ctx, values) => ({ job_slug: ctx.idParams.job_slug, idx: ctx.idParams.idx, ...values }),
    success: '題目已更新，阿財下一場面談就會用新的',
  },
  'expertise-question-add': {
    label: '＋ 自己加一題', method: 'post', path: () => '/admin/expertise/question',
    fields: () => expertiseQuestionFields({}),
    body: (ctx, values) => ({ job_slug: ctx.idParams.job_slug, ...values }),
    success: '題目已加入',
  },
  'expertise-question-delete': {
    label: '刪掉', method: 'post', path: () => '/admin/expertise/question',
    fields: [], dangerous: true,
    confirmText: '確定要刪掉這一題？（可以按「還原上一版」救回整份題庫）',
    body: (ctx) => ({ job_slug: ctx.idParams.job_slug, idx: ctx.idParams.idx, mode: 'delete' }),
    success: '題目已刪除',
  },
  // 產生題庫：後端只排一張單，實際出題在本機那台（要上網查專業內涵），
  // 所以這裡的成功訊息講「排進去了」而不是「好了」。
  'expertise-build': {
    label: '產生題庫', method: 'post', path: () => '/admin/expertise/build',
    fields: [], body: (ctx) => ({ job_slug: ctx.idParams.job_slug }),
    success: '已開始產生，約 2–3 分鐘，好了會在 Telegram 通知你',
    confirmText: '要讓 AI 上網查這個職務的專業內涵並出題嗎？大約 2–3 分鐘。',
  },
  'job-forms-create': { label: '新增客製表單', method: 'post', path: () => '/admin/job-forms', fields: [{ name: 'job_slug', label: '職缺 slug', required: true }, { name: 'label', label: '欄位名稱', required: true }, { name: 'field_type', label: '欄位類型', required: true }], body: idBody, success: '客製表單已新增' },
  'job-forms-delete': { label: '刪除客製表單', method: 'post', path: (ctx) => `/admin/job-forms/${encodeURIComponent(ctx.idParams.id)}/delete`, fields: [], body: () => ({}), success: '客製表單已刪除', dangerous: true, confirmText: '確定要刪除此客製表單欄位？' },
  'job-status': { label: '開啟／關閉職缺', method: 'patch', path: (ctx) => `/admin/jobs/${encodeURIComponent(ctx.idParams.slug)}`, fields: [{ name: 'status', label: '職缺狀態', type: 'select', required: true, options: [{ value: 'open', label: '招募中' }, { value: 'closed', label: '已關閉' }] }], body: (ctx, values) => values, success: '職缺狀態已更新' },
  'job-delete': { label: '刪除職缺', method: 'del', path: (ctx) => `/admin/jobs/${encodeURIComponent(ctx.idParams.slug)}`, fields: [], body: () => undefined, success: '職缺已刪除', dangerous: true, confirmText: '確定要刪除此職缺？此動作無法復原，所有應徵單關聯將受影響。' },
  // ---- 社群 ----
  'social-cancel': { label: '取消貼文', method: 'del', path: (ctx) => `/admin/social-post-queue/${encodeURIComponent(ctx.idParams.id)}`, fields: [], body: () => undefined, success: '已取消此則貼文', dangerous: true, confirmText: '確定要取消這則排入佇列的貼文？' },
  // ⚠️ /admin/social/schedule POST 是「新增一筆排程」，不是「改某一則貼文的排程時間」——
  // 後端沒有 by-id 的排程編輯端點。這裡先給正確欄位讓表單真的送得出去，但完整的月曆式
  // 排程 UI（規劃書 §3.4-B）還沒做，目前只能新增，不能對既有 queue 項目做「調整」。
  'social-schedule': { label: '新增排程（不是調整既有貼文）', method: 'post', path: () => '/admin/social/schedule', fields: [{ name: 'post_date', label: '日期（YYYY-MM-DD）', required: true }, { name: 'post_time', label: '時間（HH:MM，可留空＝當天排程跑到就送）' }, { name: 'account_id', label: '帳號 ID', required: true }, { name: 'job_slug', label: '職缺 slug（跟話題 ID 二選一）' }, { name: 'topic_id', label: '話題 ID（跟職缺 slug 二選一）' }, { name: 'style_id', label: '寫法公式 ID（選填，僅職缺文適用）' }], body: (ctx, values) => values, success: '排程已建立' },
  // 2026-09-15 查證：後端其實有 by-id 的取消端點（UPDATE status='cancelled'，
  // 不是真的刪列），只是先前 V3 沒接。標成取消而非刪除，之後還查得出「排了幾則、
  // 中途撤掉幾則」。
  'social-schedule-cancel': { label: '移除這則排程', method: 'post', path: () => '/admin/social/schedule/cancel', fields: [], body: idBody, success: '已從排程移除', confirmText: '確定要移除這一則排程嗎？（已發布的不受影響）' },
  'social-renotify': { label: '重新通知審核', method: 'post', path: () => '/admin/social/renotify', fields: [], body: idBody, success: '已重新送出 Telegram 通知', confirmText: '確定要重新發送這則貼文的 Telegram 審核通知？' },
  // 這支是「計數器累加」端點，不是狀態機——field 只能是後端白名單這 8 個指標名稱，
  // 且要嘛給 post_id，要嘛給 account_id+job_slug 兩者都給。
  'conversion-record': { label: '記錄招募轉換（計數＋1）', method: 'post', path: () => '/admin/conversions/record', fields: [{ name: 'field', label: '指標', type: 'select', required: true, options: [{ value: 'natural_replies', label: '自然留言' }, { value: 'assisted_replies', label: '協助留言' }, { value: 'valid_inquiries', label: '有效詢問' }, { value: 'dm_contacts', label: '私訊聯繫' }, { value: 'line_adds', label: 'LINE 加好友' }, { value: 'screened_manual', label: '人工初審' }, { value: 'qualified_candidates', label: '合格人選' }, { value: 'submitted_candidates', label: '送出人選' }] }, { name: 'account_id', label: '帳號 ID（沒有貼文 ID 時，需與職缺 slug 一起填）' }, { name: 'job_slug', label: '職缺 slug（沒有貼文 ID 時，需與帳號 ID 一起填）' }, { name: 'post_id', label: '貼文 ID（有的話優先用這個，可不填帳號/職缺）' }, { name: 'ctx', label: '情境', type: 'select', options: [{ value: 'post', label: '貼文本身' }, { value: 'reply', label: '留言串' }] }, { name: 'delta', label: '增減量（預設 +1，可填負數扣回）' }], body: (ctx, values) => ({ ...values, delta: values.delta ? Number(values.delta) : 1 }), success: '轉換已記錄' },
  'topic-prompt-create': { label: '新增話題 Prompt', method: 'post', path: () => '/admin/topic-prompts', fields: [{ name: 'prompt', label: 'Prompt 內容', type: 'textarea', required: true }], body: (ctx, values) => values, success: 'Prompt 已新增' },
  'style-prompt-create': { label: '新增寫法 Prompt', method: 'post', path: () => '/admin/style-prompts', fields: [{ name: 'prompt', label: 'Prompt 內容', type: 'textarea', required: true }], body: (ctx, values) => values, success: 'Prompt 已新增' },
  'consultant-content-settings': { label: '編輯內容設定', method: 'post', path: () => '/admin/consultant-content-settings', fields: (ctx) => objectFields(ctx.record, ['consultant_name']), body: (ctx, values) => ({ consultant_name: ctx.idParams.consultant_name, ...values }), success: '內容設定已更新' },
  'social-consultant-check-duplicate': { label: '檢查是否重複', method: 'post', path: () => '/admin/social-consultants/check-duplicate', fields: (ctx) => [{ name: 'name', label: '顧問／帳號名稱', required: true, value: ctx.idParams?.name || '' }], body: (ctx, values) => values, success: '已完成檢查（結果請看回傳訊息）' },
  // ⚠️ 2026-09-22 修：原本送的是 name／handle，但後端要的是
  //    consultant_name／platform／line_link——送出去一定失敗，等於新版
  //    從來沒辦法新增社群帳號。
  'social-consultant-create': { label: '新增顧問社群卡片', method: 'post', path: () => '/admin/social-consultants',
    fields: [
      { name: 'consultant_name', label: '顧問名稱（會顯示在貼文審核與卡片上）', required: true },
      { name: 'platform', label: '平台', type: 'select', required: true, options: [{ value: 'threads', label: 'Threads' }, { value: 'linkedin', label: 'LinkedIn' }] },
      { name: 'line_link', label: 'LINE 加好友連結（https://lin.ee/...）' },
    ], body: (ctx, values) => values, success: '卡片已建立' },
  // ── 顧問社群卡片的五個維護動作（2026-09-22 從舊版搬過來）──
  // 舊版這幾件事「以前都是老闆用終端機一步步做」，新版一個都沒有。
  'sc-line-link': { label: '設定 LINE 加好友連結', method: 'post',
    path: (ctx) => `/admin/social-consultants/${encodeURIComponent(ctx.idParams.id)}/line-link`,
    fields: (ctx) => [{ name: 'line_link', label: 'LINE 加好友連結', value: ctx.record?.line_link || '', required: true }],
    body: (ctx, values) => values, success: 'LINE 連結已更新' },
  'sc-threads-token': { label: '更新 Threads Token', method: 'post',
    path: (ctx) => `/admin/social-consultants/${encodeURIComponent(ctx.idParams.id)}/threads-token`,
    fields: [{ name: 'short_token', label: '短效 Token（貼上後系統會自動換成長效）', type: 'textarea', required: true }],
    body: (ctx, values) => values, success: 'Token 已更新，有效期會重新計算' },
  'sc-account': { label: '設定帳號密碼', method: 'post',
    path: (ctx) => `/admin/social-consultants/${encodeURIComponent(ctx.idParams.id)}/account`,
    fields: (ctx) => [
      { name: 'account_username', label: '登入帳號', value: ctx.record?.account_username || '' },
      { name: 'account_password', label: '密碼（留空＝不更改）' },
    ], body: (ctx, values) => values, success: '帳號密碼已更新' },
  // 2026-09-24：語氣卡——產稿時放在最後、公式蓋不掉的那份「這個人怎麼講話」。
  'sc-voice-card': { label: '語氣卡', method: 'post',
    path: (ctx) => `/admin/social-consultants/${encodeURIComponent(ctx.idParams.id)}/voice-card`,
    fields: (ctx) => [{ name: 'body', type: 'textarea', rows: 12, required: true, value: ctx.record?.voice_card || '',
      label: ctx.record?.voice_card
        ? (ctx.record.voice_card_manual ? '語氣卡（你手動改過；之後改風格提示詞也不會蓋掉這份）' : '語氣卡（系統從風格提示詞自動抽的，可以直接改）')
        : '還沒有語氣卡（有風格提示詞的話，下一次產稿會自動產生；也可以直接寫）' }],
    body: (ctx, values) => values, success: '語氣卡已更新，下一篇產稿就會照這份語氣' },
  'sc-voice-card-regen': { label: '從風格提示詞重新產生語氣卡', method: 'post',
    path: (ctx) => `/admin/social-consultants/${encodeURIComponent(ctx.idParams.id)}/voice-card`,
    fields: [], body: () => ({ regenerate: true }), success: '已清掉，系統幾分鐘內會從風格提示詞重新抽一份' },
  // 2026-09-24：話題語氣卡——只給話題文（時事話題、AI阿財話題）用，招募文不受影響。
  // 第一版只能手寫；空著＝話題文沿用上面的語氣卡。清空也走同一支 API（送空字串）。
  'sc-topic-voice-card': { label: '話題語氣卡', method: 'post',
    path: (ctx) => `/admin/social-consultants/${encodeURIComponent(ctx.idParams.id)}/topic-voice-card`,
    fields: (ctx) => [{ name: 'body', type: 'textarea', rows: 12, required: true,
      value: ctx.record?.topic_voice_card || (ctx.copyFromVoiceCard ? ctx.record?.voice_card || '' : ''),
      label: ctx.record?.topic_voice_card
        ? '話題語氣卡（只用在話題文；招募文照舊用語氣卡）'
        : '還沒有話題語氣卡，話題文會沿用語氣卡。想讓話題文講話的樣子不一樣，就寫在這裡（可照：口吻／自稱與稱呼／口頭禪／emoji 與符號／句子長短／不會這樣寫）' }],
    body: (ctx, values) => values, success: '話題語氣卡已儲存，下一篇話題文就會照這份語氣' },
  'sc-topic-voice-card-clear': { label: '清空話題語氣卡', method: 'post',
    path: (ctx) => `/admin/social-consultants/${encodeURIComponent(ctx.idParams.id)}/topic-voice-card`,
    fields: [], body: () => ({ body: '' }), success: '已清空，話題文改回沿用語氣卡',
    confirmText: '確定清空？清空後這位顧問的話題文會改回用語氣卡。' },
  'sc-style-prompt': { label: '重新匯入風格提示詞', method: 'post',
    path: (ctx) => `/admin/social-consultants/${encodeURIComponent(ctx.idParams.id)}/style-prompt`,
    fields: [{ name: 'body', label: '風格提示詞內容（整份貼上，會覆蓋舊的）', type: 'textarea', required: true }],
    body: (ctx, values) => values, success: '風格提示詞已更新' },
  'sc-linkedin-auth': { label: '產生 LinkedIn 授權連結', method: 'post',
    path: (ctx) => `/admin/social-consultants/${encodeURIComponent(ctx.idParams.id)}/linkedin-auth-link`,
    fields: [], body: () => ({}), success: '授權連結已產生' },
  // ---- 客戶 / BD ----
  'company-create': { label: '新增客戶', method: 'post', path: () => '/admin/portal/companies', fields: [{ name: 'display_name', label: '公司名稱', required: true, wide: true }, { name: 'contact_name', label: '聯絡人' }, { name: 'contact_email', label: '聯絡 Email' }, { name: 'contact_phone', label: '聯絡電話' }], body: (ctx, values) => values, success: '客戶已新增' },
  // 這支端點的 body 欄位是 camelCase（contactEmail/contactName/relationNote/viaClient），跟
  // client_companies 資料表本身的 snake_case 欄位名不同，特別容易被通用 objectFields 套錯。
  // 2026-09-22 從舊版 /consultant/client-info 搬過來——新版一直沒有「新增客戶」，
  // 顧問要開新客戶只能回舊版。建好後端會自動產生 portal_token（用人需求表連結）。
  // 2026-09-22：用 LINE 通知人選可以開始跟阿財面談。只對「已綁定 LINE、
  // 而且還沒開始面談」的人出現。後端會先確認對方還是不是好友才發——
  // 綁定紀錄不保證還能發（2026-09-21 真實案例），不先確認的話會以為發成功。
  'line-notify-interview': { label: '用 LINE 通知他來面談', method: 'post',
    path: () => '/admin/line-notify-interview',
    fields: [], body: (ctx) => ({ application_id: ctx.idParams.application_id }),
    success: '已用 LINE 送出面談通知',
    confirmText: '會立刻送一則 LINE 給這位人選，附上他的面談連結。確定要發嗎？' },
  'company-add': { label: '新增客戶', method: 'post', path: () => '/admin/portal/companies',
    fields: [
      { name: 'displayName', label: '公司名稱（正式全名）', required: true },
      { name: 'contactEmail', label: '聯絡 Email（要寄需求表給誰）' },
    ],
    body: (ctx, values) => values, success: '客戶已建立，需求表連結也產好了' },
  'company-update': { label: '編輯客戶資料', method: 'post', path: () => '/admin/portal/companies/update', fields: (ctx) => { const c = ctx.record || {}; return [{ name: 'contactEmail', label: '聯絡 Email', value: c.contact_email || '' }, { name: 'contactName', label: '聯絡人', value: c.contact_name || '' }, { name: 'relation', label: '關係狀態', type: 'select', value: c.relation || '', options: [{ value: 'signed', label: '已簽約' }, { value: 'negotiating', label: '洽談中' }, { value: 'end_client', label: '最終用人單位' }, { value: 'past', label: '過去客戶' }, { value: 'prospect', label: '潛在客戶' }, { value: 'blocked', label: '拒絕往來' }, { value: 'private', label: '朋友私人協助' }] }, { name: 'relationNote', label: '關係備註', type: 'textarea', value: c.relation_note || '' }, { name: 'viaClient', label: '透過誰介紹', value: c.via_client || '' }, { name: 'aliases', label: '別名（逗號分隔）', value: c.aliases || '' }]; }, body: (ctx, values) => ({ id: ctx.idParams.id, ...values }), success: '客戶資料已更新' },
  'company-regen-token': { label: '重新產生 Portal Token', method: 'post', path: () => '/admin/portal/companies/regen-token', fields: [], body: idBody, success: 'Token 已重新產生', dangerous: true, confirmText: '重新產生後，客戶舊的 Portal 連結會立即失效，確定要繼續？' },
  'company-send-email': { label: '寄送邀請信', method: 'post', path: () => '/admin/portal/companies/send-email', fields: [], body: idBody, success: '邀請信已寄出' },
  'pending-job-approve': { label: '核准待審職缺', method: 'post', path: () => '/admin/portal/pending-jobs/approve', fields: [], body: idBody, success: '職缺已核准' },
  'pending-job-reject': { label: '駁回待審職缺', method: 'post', path: () => '/admin/portal/pending-jobs/reject', fields: [{ name: 'reason', label: '駁回原因', type: 'textarea', required: true }], body: idBody, success: '職缺已駁回', dangerous: true },
  'bd-patch': { label: '更新 BD 案件', method: 'post', path: (ctx) => `/admin/bd/${encodeURIComponent(ctx.idParams.id)}/patch`, fields: (ctx) => objectFields(ctx.record), body: (ctx, values) => values, success: 'BD 案件已更新' },
  // 2026-09-15 查證更正：後端 /admin/bd-request 實際要求 role_family（不是 company_name），
  // 這頁本來就沒有要填公司名——系統自己去人才庫配對再挑公司，填職缺、產業、地區才對。
  'bd-request-create': { label: '新增 BD 需求', method: 'post', path: () => '/admin/bd-request', fields: [{ name: 'role_family', label: '要開發做什麼職缺的客戶', required: true, wide: true }, { name: 'industry', label: '想切哪個產業（選填）' }, { name: 'region', label: '地區（選填）' }, { name: 'target_count', label: '要幾家', type: 'select', value: '6', options: [{ value: '4', label: '4 家' }, { value: '6', label: '6 家（建議）' }, { value: '8', label: '8 家' }] }, { name: 'note', label: '要交代的事（選填）', type: 'textarea' }, { name: 'submitted_by', label: '你是誰', required: true }], body: (ctx, values) => ({ ...values, target_count: Number(values.target_count) || 6 }), success: '需求已送出，系統會去人才庫配對、挑公司、寫信，完成後發到群組讓你核准' },
  // 待補窗口：只補一個 email，不是整包編輯（bd-patch 那個 objectFields 會把 subject/body
  // 這些長文字欄位也塞進表單，顧問要補的其實只有收件人）。
  'bd-fill-email': { label: '補窗口 email', method: 'post', path: (ctx) => `/admin/bd/${encodeURIComponent(ctx.idParams.id)}/patch`, fields: [{ name: 'contact_email', label: '人資／招募窗口 email', required: true }], body: idBody, success: '已存好，去群組按核准就會寄出' },
  'hiring-submission-update': { label: '處理企業用人需求', method: 'patch', path: (ctx) => `/hiring-mode/submissions/${encodeURIComponent(ctx.idParams.id)}`, fields: (ctx) => objectFields(ctx.record), body: (ctx, values) => values, success: '已更新', recruit: true },
  // 每個按鈕帶固定的 idParams.outcome（replied/meeting/no_reply/declined），
  // fields 空陣列＝直接跳確認框，不用再開表單選一次結果。
  'outreach-outcome': { label: '更新接觸結果', method: 'post', path: () => '/admin/outreach/outcome', fields: [], body: idBody, success: '結果已更新', confirmText: '確定要更新這筆接觸的結果嗎？' },
  'outreach-add': { label: '新增接觸紀錄', method: 'post', path: () => '/admin/outreach', fields: [{ name: 'target_type', label: '對象類型', type: 'select', required: true, options: [{ value: 'school', label: '學校系所' }, { value: 'candidate', label: '人選' }, { value: 'client', label: '客戶' }, { value: 'intro', label: '介紹人' }] }, { name: 'target_name', label: '對象名稱', required: true, wide: true }, { name: 'company', label: '單位／公司' }, { name: 'job_slug', label: '相關職缺 slug' }, { name: 'contact_email', label: '聯絡信箱' }, { name: 'region', label: '地區' }, { name: 'subject', label: '寄送主旨' }, { name: 'note', label: '備註', type: 'textarea' }], body: (ctx, values) => values, success: '接觸紀錄已新增' },
  // ---- 系統 ----
  // 後端欄位是 click_id（link_clicks.id），呼叫端目前把 link_clicks 列的 id 存在 idParams.id，
  // 這裡在送出前改名，不用去動列表資料結構。
  'line-followup-handled': { label: '標記已處理', method: 'post', path: () => '/admin/line-followup-overdue/handled', fields: [], body: (ctx) => ({ click_id: ctx.idParams.id, by: ctx.idParams.by }), success: '已標記為處理完成' },
  // /admin/kpi/set 實際語意是「對一份 AI 初篩報告下會推／再看看／不推的裁決」，不是設定
  // 一個自訂數字指標——沿用跟 decide-report 一樣的 consultant_decision 欄位。
  'kpi-set': { label: '報告裁決（會推／再看看／不推）', method: 'post', path: () => '/admin/kpi/set', fields: (ctx) => [{ name: 'reportId', label: '報告 ID（reports.id）', required: true, value: ctx.idParams?.reportId || '' }, { name: 'verdict', label: '裁決', type: 'select', required: true, options: [{ value: '會推', label: '會推' }, { value: '再看看', label: '再看看' }, { value: '不推', label: '不推' }] }], body: (ctx, values) => ({ ...values, reportId: values.reportId || ctx.idParams?.reportId }), success: '裁決已送出' },
  // milestone 是固定列舉（interview/offer/no_interview），不是自由文字里程碑名稱。
  'kpi-milestone': { label: '標記里程碑', method: 'post', path: () => '/admin/kpi/milestone', fields: (ctx) => [{ name: 'applicationId', label: 'Application ID', required: true, value: ctx.idParams?.applicationId || '' }, { name: 'milestone', label: '里程碑', type: 'select', required: true, options: [{ value: 'interview', label: '進入面試' }, { value: 'offer', label: '拿到 Offer' }, { value: 'no_interview', label: '客戶最後沒有約面試' }] }], body: (ctx, values) => ({ ...values, applicationId: values.applicationId || ctx.idParams?.applicationId }), success: '里程碑已標記' },
  'consultant-update': { label: '編輯顧問資料', method: 'post', path: () => '/admin/consultants', fields: (ctx) => { const r = ctx.record || {}; return [
    { name: 'display_name', label: '姓名', required: true, value: r.display_name || '' },
    { name: 'is_active', label: '在職狀態', type: 'select', value: String(r.is_active ?? 1), options: [{ value: '1', label: '在職' }, { value: '0', label: '已停用' }] },
    { name: 'note', label: '備註', type: 'textarea', wide: true, value: r.note || '' },
  ]; }, body: idBody, success: '顧問資料已更新' },
  'settings-update': { label: '編輯系統設定', method: 'post', path: () => '/admin/settings', fields: (ctx) => objectFields(ctx.record), body: (ctx, values) => values, success: '設定已更新' }
};
