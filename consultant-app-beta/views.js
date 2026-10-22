import { DAILY_TABS } from './daily.js';
import { escapeHtml, text } from './core/security.js';
import { statusBadge } from './core/status.js';

// 阿財分流 A–E 徽章——卡片式與表格式共用。
const ROUTE_STYLE = {
  A: ['#1a7f4b', '#e6f4ec'], B: ['#1c5fa8', '#e7f0fa'], C: ['#c2600d', '#fdf0e3'],
  D: ['#6b3fa0', '#f1ebf9'], E: ['#a32b21', '#fbeceb'],
};
function routeBadge(code, label) {
  const st = ROUTE_STYLE[String(code || '').toUpperCase()];
  if (!st) return '';
  return `<span class="badge" style="background:${st[1]};color:${st[0]};font-weight:700;`
       + `border:1px solid ${st[0]}33">${code}｜${label || ''}</span>`;
}
import { empty } from './core/ui.js';
import { SCRIPTS, SCRIPT_CATS } from './scripts_data.js';
import { JD_FIELDS, jdFieldVal } from './jd_fields.js';
import { mailPageView } from './mail.js';
import { bdCardTop, bdLogPane, BD_TAGS } from './bdcard.js';
import { bdJobsPane } from './bdjobs.js';

const pageHead = (title, subtitle, actions = '') => `<div class="page-head"><div><h1>${title}</h1><p>${subtitle}</p></div><div class="actions">${actions}</div></div>`;
const tabbar = (scope, tabs, active) => `<div class="tabs">${tabs.map(([key, label]) => `<button class="${active === key ? 'active' : ''}" data-tab-scope="${scope}" data-tab="${key}">${label}</button>`).join('')}</div>`;

// 兩層 tab：上面一排大類，點了才顯示該類底下的小 tab。
// groups: [[大類名, [[葉key, 葉label], ...]], ...]
// active 是目前的葉 key（state.sub）。點大類 = 跳到它底下第一個葉。
// 沿用同一套 data-tab 分派（state.sub 存的還是葉 key），loadSocialTab 完全不用改。
const groupedTabbar = (scope, groups, active) => {
  const activeGroup = groups.find((g) => g[1].some(([k]) => k === active)) || groups[0];
  const top = groups.map((g) => {
    const firstLeaf = g[1][0][0];
    const isActive = g === activeGroup;
    return `<button class="${isActive ? 'active' : ''}" data-tab-scope="${scope}" data-tab="${firstLeaf}">${g[0]}</button>`;
  }).join('');
  const subs = activeGroup[1].length > 1
    ? `<div class="tabs tabs-sub">${activeGroup[1].map(([k, label]) =>
      `<button class="${active === k ? 'active' : ''}" data-tab-scope="${scope}" data-tab="${k}">${label}</button>`).join('')}</div>`
    : '';
  return `<div class="tabs tabs-group">${top}</div>${subs}`;
};
const field = (label, control) => `<label class="field"><span>${label}</span>${control}</label>`;
const endpointState = (name) => `<div class="state"><strong>${name}</strong><p>等待登入並從 Production API 載入。</p></div>`;
const list = (items, row) => items.length ? `<div class="list">${items.map(row).join('')}</div>` : empty('目前沒有資料', '可調整篩選條件或建立新項目。');
const safeParseJson = (raw) => { try { return JSON.parse(raw); } catch { return []; } };
// 2026-09-18 修：有些職缺（非顧問手動建檔，是別的來源匯進來的）locations
// 存的是 JSON 陣列字串、employment 存的是英文代碼，直接 text() 印出來會讓
// 顧問看到 ['桃竹苗地區', '台中', '雲林'] 或 "FULL_TIME" 這種給程式看的原始值
// （今天客戶回報的就是這個）。這裡統一轉成人看得懂的中文，轉不出來就至少
// 去掉底線／引號，不要照搬代碼格式。
// 2026-09-18 再改：原本這兩個 helper 寫在 jobIntro() 裡面，P3-A 職缺推薦卡的
// job_locations／job_employment 是同一批欄位、同樣會吃到原始值，所以搬到模組
// 層級共用——避免兩邊各寫一份、以後修了一邊漏另一邊。
const formatLocations = (loc) => {
  if (Array.isArray(loc)) return loc.join('、');
  if (typeof loc === 'string') {
    const trimmed = loc.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed.join('、');
      } catch {
        // ⚠️ 2026-09-18 第二次修：第一版只處理雙引號的標準 JSON，但實際 DB 裡
        // 存的是 Python 的 repr 格式（單引號）：['桃竹苗地區', '台中', '雲林']，
        // JSON.parse 會丟例外 → 掉進這個 catch → 原樣印出整串給顧問看。
        // 當天 QA 在陳旻婕的推薦卡上實際重現（同一位候選人的第二張卡卻是正常的，
        // 因為那個職缺的 locations 存的是正常字串——同一欄位兩種格式並存）。
        // 這裡手動拆單引號陣列；根因是職缺匯入時就存成 repr 字串，
        // 上游那邊該另外修，但顧問不該因為上游沒修就看到程式碼。
        const items = trimmed
          .replace(/^\[|\]$/g, '')
          .split(',')
          .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
          .filter(Boolean);
        if (items.length) return items.join('、');
      }
    }
    return loc;
  }
  return '';
};
const EMPLOYMENT_LABEL = { FULL_TIME: '正職・全職', PART_TIME: '兼職', CONTRACT: '約聘', DISPATCH: '派遣', INTERNSHIP: '實習' };
const formatEmployment = (e) => {
  if (!e) return '';
  const key = String(e).replace(/^"|"$/g, '').trim();
  return EMPLOYMENT_LABEL[key] || key.replace(/_/g, ' ');
};
// ⚠️ 2026-09-18 QA 抓到：薪資後面的單位是直接把 jobs.salary_unit 原文印出來，
// 顧問看到的是「50000–60000 MONTH」。這個欄位全站都會用到（推薦卡、職缺介紹），
// 統一在這裡轉成中文；認不得的單位就整個不顯示，不要把原始碼露給人看。
const SALARY_UNIT_LABEL = { MONTH: '月薪', YEAR: '年薪', HOUR: '時薪', DAY: '日薪', MONTHLY: '月薪', YEARLY: '年薪' };
const formatSalaryUnit = (u) => {
  if (!u) return '';
  const key = String(u).replace(/^"|"$/g, '').trim().toUpperCase();
  return SALARY_UNIT_LABEL[key] || '';
};
// 後端組好的 "50000–60000 MONTH" 這種字串，把結尾的單位換成中文並移到前面。
const formatSalarySummary = (s) => {
  if (!s) return '';
  const m = String(s).trim().match(/^(.*?)[\s]+([A-Za-z"]+)$/);
  if (!m) return String(s);
  const label = formatSalaryUnit(m[2]);
  return label ? `${label} ${m[1]}` : m[1];
};
// 跟舊版 consultant/tracker/index.html 的 SOURCE_CHANNEL_OPTS／RESUME_SOURCE_OPTS 一字不差，
// 這是既有 applications 資料裡實際在用的值，不是自己重新發明一套分類。
// 2026-10-02 Jacky：「少一個來源」→ 補 AI 夜間找人／顧問主動電話開發／人選自己打來／CakeResume／Yourator。
// 舊選項一個都不拿掉（已存的資料、人才來源成效表都用這些字）。
const SOURCE_CHANNEL_OPTS = ['不指定', '顧問主動電話開發', 'AI 夜間找人', '人選自己打來', '朋友介紹', 'LinkedIn', 'Threads', 'LINE OA', '104', '1111', 'CakeResume', 'Yourator', 'Facebook', 'Dcard', 'Step1ne官網', '人才池/獵頭資料庫', '其他'];
const RESUME_SOURCE_OPTS = ['不指定', '104', '1111', 'LinkedIn', 'CakeResume', 'Yourator', '自製履歷', '作品集'];
const STAGE_LABEL = { applied: '應徵', interviewed: '已面談', consultant_review: '顧問覆核通過', client_stage: '客戶端進行中', offered: '已發 Offer', onboard: '已到職' };
// funnel／byJob 都是 /admin/overview 當下快照（不是期間趨勢），標籤要老實寫「目前」不寫「近 N 天」。
// 2026-09-17 加逐階段流失率：funnel 陣列本來就是 applied→onboard 由後端逐關
// COUNT 出來的（每一關本來就是前一關的子集合，不是各自獨立的數字），加一行
// 「↓ N% 流失」純粹是相鄰兩關相減再除，不用另外查資料——參考同業儀表板的
// 呈現方式，但這裡用的是既有真實資料，不是假裝有的比較基準。
const funnelBars = (funnel) => { const max = Math.max(1, ...funnel.map((f) => f.n)); return `<div class="funnel-chart">${funnel.map((f, i) => { const prev = i > 0 ? funnel[i - 1].n : null; const drop = (prev && prev > 0) ? Math.round((1 - f.n / prev) * 100) : null; return `${drop !== null ? `<div class="fn-drop">↓ ${drop}% 流失</div>` : ''}<div class="fnrow"><div class="lb">${text(STAGE_LABEL[f.stage] || f.stage)}</div><div class="track"><div class="bar" style="width:${Math.round(f.n / max * 100)}%"></div></div><div class="vn">${text(f.n)}</div></div>`; }).join('')}</div>`; };
const byJobRows = (byJob) => byJob.length ? `<div class="funnel-chart">${byJob.map((j) => `<div class="fnrow"><div class="lb" title="${text(j.title || j.job_slug)}">${text(j.title || j.job_slug)}</div><div class="track"><div class="bar" style="width:${j.n ? Math.round(j.done / j.n * 100) : 0}%"></div></div><div class="vn">${text(j.done)}/${text(j.n)}</div>${j.need_call > 0 ? `<span class="badge warning">${text(j.need_call)} 待電洽</span>` : ''}</div>`).join('')}</div>` : empty('目前沒有應徵紀錄');
// 2026-09-17 加：screenings.score（履歷初篩分數，0-100）分佈直方圖，10 分一桶。
const scoreHistogram = (dist) => {
  if (!dist || !dist.length) return empty('目前沒有履歷初篩分數資料');
  const max = Math.max(1, ...dist.map((d) => d.n));
  return `<div class="hist-chart">${dist.map((d) => `<div class="hist-col"><div class="hist-n">${text(d.n)}</div><div class="hist-bar" style="height:${Math.round(d.n / max * 100)}%"></div><div class="hist-lb">${text(d.bucket)}</div></div>`).join('')}</div>`;
};
// 2026-09-17 加：申請數趨勢圖——/admin/overview.trend 是近30天每日新增應徵數
// （date(created_at,'+8 hours') 分桶），用簡單長條圖呈現，缺的日子後端就是沒有
// 那天的資料（GROUP BY 只會產出有資料的日期），不用前端補零裝滿30根。
// 30 天長條圖共用（申請數、阿財面談場次）：補滿 30 天、日期＋星期、週末底色。
// stack：有傳就畫兩段（深色 main＋淺色 rest），例如阿財「有開口」＋「進來沒講話」。
const dayBars = (rows, { note = '', stackKey = '' } = {}) => {
  const byDay = Object.fromEntries((rows || []).map((d) => [String(d.day || '').slice(0, 10), d]));
  const WK = ['日', '一', '二', '三', '四', '五', '六'];
  const today = new Date(Date.now() + 8 * 3600e3);
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400e3);
    const key = d.toISOString().slice(0, 10);
    const r = byDay[key] || {};
    const n = Number(r.n) || 0;
    const main = stackKey ? Math.min(n, Number(r[stackKey]) || 0) : n;
    days.push({ key, n, main, rest: n - main, wd: d.getUTCDay(), label: `${d.getUTCMonth() + 1}/${d.getUTCDate()}` });
  }
  const max = Math.max(1, ...days.map((d) => d.n));
  return `${note ? `<p class="help" style="margin:-6px 0 10px">${note}</p>` : ''}
    <div class="trend-chart">${days.map((d) => `<div class="trend-col${d.wd === 0 || d.wd === 6 ? ' wkend' : ''}${d.wd === 1 ? ' mon' : ''}" title="${d.key}（${WK[d.wd]}）${d.n} 筆${stackKey && d.rest ? `，其中 ${d.rest} 位進來沒講話` : ''}"><div class="trend-n">${d.n || ''}</div>${d.rest ? `<div class="trend-bar rest" style="height:${Math.round(d.rest / max * 100)}%"></div>` : ''}<div class="trend-bar" style="height:${Math.round(d.main / max * 100)}%;${d.rest ? 'border-radius:0' : ''}"></div><div class="trend-lb">${d.label}<br>${WK[d.wd]}</div></div>`).join('')}</div>`;
};
// 2026-10-05 改（Jacky：破版、要加星期幾、這是不是阿財面談次數）
const trendChart = (trend) => {
  if (!trend || !trend.length) return empty('近30天沒有新增應徵紀錄');
  const total = trend.reduce((a, d) => a + (Number(d.n) || 0), 0);
  return dayBars(trend, { note: `每天新增的應徵單（官網／LINE 應徵＋顧問手動新增），不是阿財面談次數。30 天共 ${total} 筆。` });
};
// 2026-10-05 加：阿財面談場次——以進面談室那天算；深色＝人選有開口，淺色＝進來沒講話。
const aiTrendChart = (rows) => {
  if (!rows || !rows.length) return empty('近30天阿財沒有面談紀錄');
  const total = rows.reduce((a, d) => a + (Number(d.n) || 0), 0);
  const talked = rows.reduce((a, d) => a + (Number(d.talked) || 0), 0);
  return dayBars(rows, { stackKey: 'talked', note: `每天有幾位人選進阿財面談室（以進來那天算）。<b style="color:var(--blue)">深色</b>＝有開口談，<b style="color:#9fb3d3">淺色</b>＝進來沒講話。30 天共 ${total} 場，有談 ${talked} 場。` });
};
// 2026-09-17 加：人才來源成效表——source_channel 是顧問手動加人選時填的自由
// 文字欄位，公開應徵表單那條路徑不會寫這欄（會是「未填寫」，是資料本來就沒有，
// 不是查詢漏了）。「進客戶端」比對跟目前漏斗卡片同一組 stage 判定，後端已經算好。
const sourceTable = (bySource) => {
  if (!bySource || !bySource.length) return empty('目前沒有應徵紀錄可統計來源');
  return `<div class="list">${bySource.map((s) => `<div class="list-row"><span>${text(s.source)}</span><b>${text(s.n)} 人</b><small>進客戶端 ${text(s.reached_client)} 人（${text(s.n ? Math.round(s.reached_client / s.n * 100) : 0)}%）</small></div>`).join('')}</div>`;
};
// 2026-09-17 加：卡關與 Aging——placements 停在同一個 stage 幾天，倒序（卡最久的在最上面）。
// 20天以上標紅提醒，14天以上標黃，其餘一般顯示，門檻是跟顧問經驗值對齊的粗略分級，不是精算。
const hostBadge = (h) => h ? `<small class="badge" title="現在是哪一台阿財在面談">阿財在 ${text(h === 'wsl2' ? 'WSL2' : h === 'mac' ? 'Mac' : h)}</small>` : '';
const CLIENT_STAGE_LABEL = { SUBMITTED: '已送出客戶', INTERVIEWING: '客戶面談中', INTERVIEW: '客戶面談中', INTERVIEW_COMPLETED: '客戶面談完成', AWAITING_CLIENT_FEEDBACK: '等客戶回饋', PENDING_CANDIDATE: '等候選人回覆', OFFER: '已發 Offer', OFFER_ACCEPTED: '候選人已接受' };
const agingRows = (aging) => {
  if (!aging || !aging.length) return empty('目前沒有卡在客戶端超過門檻的案子');
  return `<div class="list">${aging.map((r) => `<div class="list-row"><span>${text(r.name)}<small>${text(CLIENT_STAGE_LABEL[r.stage] || r.stage)}</small></span><b class="${r.days >= 20 ? 'aging-bad' : r.days >= 14 ? 'aging-warn' : ''}">${text(r.days)} 天</b></div>`).join('')}</div>`;
};
const agreeRows = (agree) => { if (!agree.length) return empty('還沒有同時做過阿財初談跟顧問電洽的人選，先累積樣本'); const total = agree.reduce((s, x) => s + x.n, 0); const same = agree.filter((x) => /值得|推薦|會推/.test(x.ai || '') === (x.call === '會推')).reduce((s, x) => s + x.n, 0); return `<p class="help">樣本數 ${text(total)}，方向一致 ${text(same)}（${text(Math.round(same / total * 100))}%）</p><div class="list">${agree.map((x) => `<div class="list-row"><span>阿財：${text(x.ai)} → 顧問：${text(x.call)}</span><b>${text(x.n)}</b></div>`).join('')}</div>`; };

// 2026-09-17 加：PRECALL_PHASE1。Gate 狀態 matched/unknown/unmatched 的顯示
// 對照表集中在這一個地方——規格明講「不要建立第二套 DB enum，mapping 要集中
// 管理，不要散落在 frontend 與 backend 各寫一份」，這裡就是那個唯一的地方，
// 之後任何要畫 Gate 狀態小圓標的地方都呼叫這個，不要在各自的 template 字串裡
// 重複寫一次 if/else。
// 2026-09-17 v2.0 稽核修正：文字要跟 docs/06 第 5.3 節、docs/09 第 42 節規定的
// 字樣一致——matched 是「履歷有明確證據符合」，不是「可能」，用「可能符合」這種
// 模稜兩可的講法違反規格說的「不可虛假精準／不可過度保守」；unmatched 也要講清楚
// 是「明確不符」，不是含糊的「不符合」。每個狀態都配一個 icon，不能只靠顏色分辨。
// 2026-10-16 Jacky：跟阿財面談完的人選標 NEW，直到有指派顧問為止
// 2026-10-16 Jacky：跟阿財面談完的人選標 NEW，直到有顧問手動指派為止（系統不會自動指派）
const isNewCand = (i) => !!(i && i.aiDone && !i.ownerId);
// 2026-10-21「先送出，晚點再聊」：選了這個選項的人（後端 later_state：waiting＝7 天內還沒聊、expired＝7 天到期沒聊）。
// 顧問看這個決定要不要先打電話。
const laterBadge = (i) => i && i.laterState === 'waiting'
  ? ' <span class="badge warning" title="應徵時選了「先送出，晚點再聊」，7 天內還沒跟阿財聊">已應徵、還沒面談</span>'
  : i && i.laterState === 'expired'
    ? ' <span class="badge danger" title="選了「先送出，晚點再聊」，7 天都沒跟阿財聊，面談連結已過期">沒完成面談</span>' : '';
// NEW 的人選一律排最上面，其餘照原本順序（穩定排序）
const newFirst = (items) => (items || []).slice().sort((a, b) => (isNewCand(b) ? 1 : 0) - (isNewCand(a) ? 1 : 0));

export const GATE_STATUS_META = {
  matched: { label: '✅ 已符合', cls: 'good' },
  unknown: { label: '❓ 待確認', cls: 'warn' },
  unmatched: { label: '⛔ 明確不符', cls: 'bad' },
};

const jobCode = (slug) => ((typeof window !== 'undefined' && window.__JOB_CODES) || {})[slug] || '';
export const actionBtn = (label, actionId, ctx = {}, extraClass = '') => `<button type="button" class="btn ghost sm ${extraClass}" data-open-action="${escapeHtml(actionId)}" data-ctx='${escapeHtml(JSON.stringify(ctx))}'>${text(label)}</button>`;
export const rowActions = (buttons) => `<div class="actions-row">${buttons.join('')}</div>`;
// 2026-10-16 Jacky：人選卡片的操作改成下拉選單（按「操作」才展開），卡片上不再一排按鈕
export const actionMenu = (buttons, label = '操作') => `<details class="act-menu"><summary class="btn primary">${label} ▾</summary><div class="act-menu-list" role="menu">${buttons.filter(Boolean).join('')}</div></details>`;

// 2026-09-15 加 collapsed 參數：使用者要求側欄要能收合展開（表格式看多欄資料時
// 想多擠一點寬度出來），跟手機版那顆漢堡選單（.mobile-menu／toggle-menu）是
// 兩件不同的事——那個是小螢幕的疊層選單，這個是桌機版「收起側欄多留內容區寬度」。
export function shell(active, content, collapsed = false) {
  // 2026-09-17 加「人選面談室」：插在 AI 面談後面、社群前面——跟面談/人選
  // 關聯最近，還沒到「營運成長」那個分組。這樣一插，後面兩個分組標題的
  // index 要跟著往後推一格（social 從 5 變 6、system 從 7 變 8），
  // icon 陣列也要對應補一顆，不能只加 nav 項目忘了改分組判斷跟圖示。
  // 2026-10-05 加「進度看板」：插在首頁後面，後面分組標題 index 往後推一格（social 7、system 9）。
  // 2026-10-15 Jacky：進度看板已整合進每日工作台（企業 BD／人才追蹤切「看板」），左側選單拿掉；/board 網址仍可用。
  // 2026-10-15 Jacky：加「招募管道」（訓練機構等推人管道的看板），插在客戶/BD 後面；管理分組 index 9→10、icon 補一顆
  // 2026-10-15 Jacky：首頁拿掉（內容跟每日工作台、招募總覽重複）；獨有的「正在 AI 面談」搬到每日工作台總覽、「阿財分流」搬到 AI 面談頁
  // 2026-10-20 Jacky：加「帶案狀況」外部連結（pipeline.step1ne.com，另開分頁），放在招募總覽下面
  const nav = [['daily','每日工作台'],['recruitment','招募總覽'],['candidates','人選'],['jobs','職缺'],['interviews','AI 面談'],['linechat','人選面談室'],['social','社群'],['clients','客戶 / BD'],['channels','招募管道'],['mail','信箱紀錄'],['system','系統']];
  // ⚠️ 收合按鈕不能放進 <a class="brand"> 裡面——瀏覽器不允許互動元素巢狀
  // interactive content，而且全域點擊委派會先比對 [data-route]，按鈕點下去會
  // 連帶觸發外層 <a> 的 data-route="home" 跳轉。改成跟 .brand 平行的兄弟元素。
  return `<div class="app-shell${collapsed ? ' collapsed' : ''}"><aside class="sidebar"><div class="brand-row"><a class="brand" data-route="daily"><span>S</span><div>Step1ne<small>CONSULTANT OS</small></div></a><button type="button" class="sidebar-toggle" data-action="toggle-sidebar" title="${collapsed ? '展開側欄' : '收合側欄'}">${collapsed ? '»' : '«'}</button></div><nav>${nav.map(([key,label], index) => `${index === 0 ? '<p>工作台</p>' : index === 6 ? '<p>營運成長</p>' : index === 10 ? '<p>管理</p>' : ''}<a class="${active === key ? 'active' : ''}" data-route="${key}"><i>${['☑','▥','◉','▣','◎','✉','◁','♙','⇄','✉','⚙'][index]}</i>${label}</a>${key === 'recruitment' ? '<a href="https://pipeline.step1ne.com/" target="_blank" rel="noopener" title="給 Jim 看的帶案儀表板（另開分頁，需通行碼）"><i>▤</i>帶案狀況 ↗</a>' : ''}`).join('')}</nav><footer>Production contract v2</footer></aside><main><header class="topbar"><button class="mobile-menu" data-action="toggle-menu">☰</button><input data-action="global-search" placeholder="搜尋人選、職缺、客戶…"><label class="me-global" title="寄信、核准、改設定時，系統記住是誰做的"><span>我是</span><select data-me-global aria-label="我是"><option value="">選擇…</option></select></label><button class="btn ghost" data-action="token">ADMIN TOKEN</button></header><section class="content">${content}</section></main></div>`;
}

export const views = {
  // 2026-10-12 加：信箱紀錄（畫面與邏輯在 mail.js）
  mail: () => mailPageView(),
  // 2026-10-15 加：招募管道（畫面與邏輯在 channels.js）
  channels: () => pageHead('招募管道', '請訓練機構、學校等幫忙推人的管道，一家一張卡。拖到別欄＝改狀態；點卡片看聯絡紀錄、推來的人選與成效。左邊紅線＝到了該追的日子。', '<button class="btn primary" data-action="channel-new">＋ 新增管道</button>') + `<div id="page-data"></div>`,
  board: (tab = 'cand') => pageHead('進度看板', '每一欄是一個階段，每張卡是一個人選或一家客戶。左邊有紅線的＝在這關停太久，該追了。')
    + tabbar('board', [['cand', '人選'], ['client', '客戶']], tab === 'client' ? 'client' : 'cand') + `<div id="page-data">${endpointState('進度看板')}</div>`,
  // 2026-10-14 Jacky：把他的「獵頭顧問每日作戰儀表板」放進顧問後台測試版當一個分頁。
  // 他的「獵頭顧問每日作戰儀表板」原檔，功能整合進後台（見 daily.js），7 個分頁就是原檔的 7 個分頁。
  daily: (tab) => pageHead('每日工作台','每天的流程、做了什麼、反思與回味。資料存在這個瀏覽器，不會上傳。') + tabbar('daily',DAILY_TABS,tab || 'overview') + `<div id="page-data"></div>`,
  home: () => pageHead('今天先做什麼？','首頁只呈現待處理工作與風險，不用先讀整份儀表板。','<button class="btn primary" data-route="candidates">進入人選工作台</button>') + `<div id="page-data">${endpointState('今日工作')}</div>`,
  // 2026-09-15 驗證：/admin/overview 實際形狀是 {funnel,verdicts,agree,byJob,todo}，沒有
  // pending_review/client_pending/alerts 這幾個欄位（之前這三張 KPI 卡一直顯示假的 0）。
  // todo 是唯一有意義的「待處理」清單（面談已結束、還沒被顧問看過的）；client_pending／alerts
  // 這個 API 目前真的沒有，誠實顯示「—」而不是造一個假的 0。
  // 2026-09-15 用真實 token 核對 /admin/overview.now，7 個 KPI 全部是真實欄位
  // （jobs_open/cands/new7/done/need_call/waiting/lang_missing），跟正式舊版首頁同一批資料。
  // 阿財分流 A–E（原首頁，2026-10-15 搬到 AI 面談頁最上面）
  routeBlock: (overview) => {
    const ROUTE_ORDER = [['A', '優先聯繫'], ['B', '需顧問判斷'], ['C', '可轉其他職缺'],
                         ['D', '人才池'], ['E', 'Hard Gate 沒過']];
    const routeMap = new Map((overview?.routes || []).map((r) => [String(r.code || '').toUpperCase(), r]));
    const routeTotal = (overview?.routes || []).reduce((sum, r) => sum + Number(r.n || 0), 0);
    // ⚠️ 一份報告都還沒有的時候整塊不顯示，不要畫五個 0——那看起來像壞掉。
    const routeBlock = routeTotal ? `<article class="card"><div class="card-head"><h2>阿財分流（共 ${routeTotal} 位談過的人選）</h2></div>
      <div class="kpi-grid">${ROUTE_ORDER.map(([code, label]) => {
        const n = Number((routeMap.get(code) || {}).n || 0);
        const tone = code === 'A' && n > 0 ? 'accent' : '';
        return `<button class="kpi ${tone}" data-action="home-route" data-route-code="${code}" style="text-align:left;cursor:pointer"><span>${code}｜${label}</span><strong>${n}</strong></button>`;
      }).join('')}</div>
      <p class="help" style="margin:8px 0 0">點任一格會跳到人選中心並自動篩選。A 是阿財判斷「硬條件沒問題、分數夠高」的人，建議今天先打。
      <a href="#" data-action="open-route-spec" style="margin-left:4px">分流規則怎麼算？</a></p></article>` : '';
    return routeBlock;
  },
  // 正在 AI 面談（原首頁，2026-10-15 搬到每日工作台總覽最上面）
  liveInterviews: (live) => (live && live.length) ? `<article class="card"><h2>正在 AI 面談（${live.length}）</h2>${list(live, (i) => `<button class="list-row" data-route="interviews"><span><b>${text(i.candidate_name || i.name)}</b><small>${text(i.job_title || i.job)}</small></span>${hostBadge(i.interview_host)}${statusBadge(i.interview_state || i.state || 'active')}</button>`)}</article>` : '',
  homeData: ({ overview, live }) => { const now = overview?.now || {};
    // 2026-09-21 加：阿財分流 A–E。顧問每天打開後台第一個問題是「今天先打給誰」，
    // 在這之前首頁八張卡沒有一張回答得了。A 那格點下去直接跳到人選中心並套好篩選。
    const ROUTE_ORDER = [['A', '優先聯繫'], ['B', '需顧問判斷'], ['C', '可轉其他職缺'],
                         ['D', '人才池'], ['E', 'Hard Gate 沒過']];
    const routeMap = new Map((overview?.routes || []).map((r) => [String(r.code || '').toUpperCase(), r]));
    const routeTotal = (overview?.routes || []).reduce((sum, r) => sum + Number(r.n || 0), 0);
    // ⚠️ 一份報告都還沒有的時候整塊不顯示，不要畫五個 0——那看起來像壞掉。
    const routeBlock = routeTotal ? `<article class="card"><div class="card-head"><h2>阿財分流（共 ${routeTotal} 位談過的人選）</h2></div>
      <div class="kpi-grid">${ROUTE_ORDER.map(([code, label]) => {
        const n = Number((routeMap.get(code) || {}).n || 0);
        const tone = code === 'A' && n > 0 ? 'accent' : '';
        return `<button class="kpi ${tone}" data-action="home-route" data-route-code="${code}" style="text-align:left;cursor:pointer"><span>${code}｜${label}</span><strong>${n}</strong></button>`;
      }).join('')}</div>
      <p class="help" style="margin:8px 0 0">點任一格會跳到人選中心並自動篩選。A 是阿財判斷「硬條件沒問題、分數夠高」的人，建議今天先打。
      <a href="#" data-action="open-route-spec" style="margin-left:4px">分流規則怎麼算？</a></p></article>` : '';
    return routeBlock + `<div class="kpi-grid"><article class="kpi"><span>在辦職缺</span><strong>${text(now.jobs_open ?? 0)}</strong></article><article class="kpi"><span>累積人選</span><strong>${text(now.cands ?? 0)}</strong></article><article class="kpi"><span>近 7 天新進</span><strong>${text(now.new7 ?? 0)}</strong></article><article class="kpi"><span>阿財累計面談</span><strong>${text(now.talked_total ?? 0)}</strong></article><article class="kpi"><span>已完成初談</span><strong>${text(now.done ?? 0)}</strong></article><article class="kpi ${now.need_call > 0 ? 'accent' : ''}"><span>等你電洽</span><strong>${text(now.need_call ?? 0)}</strong></article><article class="kpi ${now.waiting > 0 ? 'warn' : ''}"><span>等候分流</span><strong>${text(now.waiting ?? 0)}</strong></article><article class="kpi ${now.lang_missing > 0 ? 'warn' : ''}"><span>外語未驗證</span><strong>${text(now.lang_missing ?? 0)}</strong></article></div><div class="two-col"><article class="card"><h2>正在 AI 面談</h2>${list(live, (i) => `<button class="list-row" data-route="interviews"><span><b>${text(i.candidate_name || i.name)}</b><small>${text(i.job_title || i.job)}</small></span>${hostBadge(i.interview_host)}${statusBadge(i.interview_state || i.state || 'active')}</button>`)}</article><article class="card"><h2>等你電洽（面談已結束，待顧問決策）</h2>${list(overview?.todo || [], (t) => `<div class="list-row" data-application="${text(t.id)}" style="cursor:pointer"><span><b>${text(t.name)}</b><small>${text(t.title || t.job_slug)}</small></span><small>${text((t.interview_ended_at || '').slice(5, 16))}</small></div>`)}</article></div>`; },
  recruitment: () => pageHead('招募總覽','看真實招募成效與卡點。') + `<div id="page-data">${endpointState('招募分析')}</div>`,
  // funnel／byJob／verdicts／agree 都來自同一支 /admin/overview，是「目前」快照，不是期間趨勢——
  // 標題老實寫「目前」。2026-09-17 加 trend／bySource／aging 三個端點後，招募總覽頁全部
  // 六張卡片都是真實資料，沒有佔位卡了。
  recruitmentData: ({ applications, jobs, overview }) => `<div class="kpi-grid"><article class="kpi"><span>目前應徵單</span><strong>${applications.length}</strong><small>tracker 當下清單，不冒充 30 天新增量</small></article><article class="kpi"><span>正式職缺</span><strong>${jobs.length}</strong><small>jobs 當下清單</small></article><article class="kpi"><span>近 7 天新進</span><strong>${text(overview?.now?.new7 ?? 0)}</strong></article><article class="kpi ${overview?.now?.need_call > 0 ? 'accent' : ''}"><span>等你電洽</span><strong>${text(overview?.now?.need_call ?? 0)}</strong></article></div><div class="dashboard-grid"><article class="card"><h2>目前招募漏斗（快照，非期間趨勢）</h2>${funnelBars(overview?.funnel || [])}</article><article class="card"><h2>阿財初篩 vs 顧問電洽，方向一致率</h2>${agreeRows(overview?.agree || [])}</article><article class="card"><h2>履歷初篩 AI 評分分佈</h2>${scoreHistogram(overview?.scoreDist || [])}</article><article class="card span-2"><h2>各職缺進度（目前快照）</h2>${byJobRows(overview?.byJob || [])}</article><article class="card span-2"><h2>申請數趨勢（近30天，每日）</h2>${trendChart(overview?.trend || [])}</article><article class="card span-2"><h2>阿財面談場次（近30天，每日）</h2>${aiTrendChart(overview?.aiTrend || [])}</article><article class="card"><h2>人才來源成效</h2>${sourceTable(overview?.bySource || [])}</article><article class="card span-2"><h2>卡關與 Aging（客戶端停留天數，由久到近）</h2>${agingRows(overview?.aging || [])}</article></div>`,
  // 2026-09-15 查證更正：「所有階段」下拉原本的選項（篩選中/待確認/客戶初審/Offer/
  // 已到職）根本不是 tab 的真實值——tab 只有 fill/decide/client/pool 四種，選那些
  // 選項永遠篩不出東西。改成真實的四分頁；另外補一個「負責顧問」篩選（對應後端
  // /admin/pipeline/tracker 本來就支援的 ?owner= 參數，含「未指派」），選項在
  // loadCandidateTab 裡用真實顧問名單動態填入。
  candidates: (tab='workbench') => pageHead('人選中心','操作單位是 application；疑似同一人只提示，不自動合併。','<button class="btn primary" data-action="add-candidate">＋ 新增人選</button>') + tabbar('candidates',[['workbench','工作台'],['triage','快速判斷'],['pool','人才池'],['aimatch','AI 配對'],['reports','阿財報告'],['outreach','接觸紀錄'],['checkups','阿福健檢'],['screening','待審核']],tab) + `<div class="filters"><input id="candidate-search" placeholder="搜尋姓名、職缺、來源"><select id="candidate-stage"><option value="">所有階段</option><option value="fill">等人選填完</option><option value="decide">等我決定</option><option value="client">客戶面談階段</option><option value="pool">候補池</option></select><select id="candidate-owner"><option value="">所有顧問</option><option value="unassigned">未指派</option></select><select id="candidate-route"><option value="">所有分流</option><option value="A">A｜優先聯繫</option><option value="B">B｜需顧問判斷</option><option value="C">C｜可轉其他職缺</option><option value="D">D｜人才池</option><option value="E">E｜Hard Gate 沒過</option><option value="none">還沒面談過</option><option value="silent">阿財面談室無對話紀錄</option></select><div class="view-toggle"><button type="button" class="btn sm" data-action="candidate-view-card">卡片式</button><button type="button" class="btn sm" data-action="candidate-view-table">表格式</button></div><button class="btn" data-action="reset-candidate-filter">清除</button><a href="#" data-action="open-route-spec" class="help" style="align-self:center;margin-left:4px">分流規則？</a></div><div id="page-data">${endpointState('人選資料')}</div>`,
  // 2026-09-15 查證更正：卡片其實有 email/phone（原本沒接進來，一直顯示不存在的
  // 「下一步」欄位）；stage 這裡的 statusBadge(i.stage) 現在會顯示真正的四分頁
  // 翻譯（等人選填完/等我決定/客戶面談階段/候補池），不是原始代碼字串。clientName
  // 一樣後端早就有：推薦給客戶之前是「（未綁客戶）」，推薦之後自動換成真實客戶名，
  // 讓卡片一眼看出「推薦了沒、推去哪」，不用點進去才知道。
  // 2026-09-21 加：阿財分流 A–E 的徽章。來源是 Jacky 的「阿財 × 真人顧問分工圖」
  // 第 5 步。色碼照那張圖：A 綠（優先聯繫）、B 藍（需顧問判斷）、C 橘（可轉其他
  // 職缺）、D 紫（人才池）、E 紅（Hard Gate 沒過）。
  // ⚠️ 只有阿財談完、報告產出來才會有值；還在面談中或沒面談的一律不顯示，
  //    不要用「—」佔位——那會讓顧問以為系統判過了只是沒分出來。
  candidateRows: (items) => list(newFirst(items), (i) => {
    const placeholder = i.email && /@no-email\.step1ne\.local$/i.test(String(i.email).trim());
    const contact = [i.phone, (i.email && !placeholder) ? i.email : null].filter(Boolean).join(' · ') || '未留聯絡方式';
    const boundClient = i.clientName && i.clientName !== '（未綁客戶）';
    return `<article class="candidate-card" data-application="${text(i.applicationId)}"><div><h3>${isNewCand(i) ? '<span class="badge new-cand" title="跟阿財面談完、還沒指派顧問">NEW</span> ' : ''}${i.seqNo ? `<small class="muted">#${text(i.seqNo)}</small> ` : ''}${text(i.name)} ${routeBadge(i.routeCode, i.routeLabel)}${i.lineBound ? ' <span class="badge success" title="已綁定 LINE，可以直接用 LINE 聯絡">LINE</span>' : ''}${i.hardGate ? ' <span class="badge warning">硬性條件審核</span>' : ''}</h3><p>${text(i.job)}${boundClient ? ` → ${text(i.clientName)}` : ''} · ${text(i.owner)}</p></div>${statusBadge(i.stage)}${laterBadge(i)}<dl><div><dt>聯絡方式</dt><dd>${text(contact)}</dd></div><div><dt>來源</dt><dd>${text(i.source || '—')}</dd></div><div><dt>最後活動</dt><dd>${text(i.updatedAt)}</dd></div></dl>${i.duplicate ? `<div class="notice">${text(i.duplicate)}</div>` : ''}<button class="btn primary">查看應徵單</button></article>`;
  }),
  // 表格式——照抄舊版 consultant/tracker 的欄位精神（人選／職缺／客戶／顧問／
  // 階段／聯絡方式／最後活動），縮成一行方便一次掃過大量人選；點列一樣開抽屜。
  // 2026-09-15 修：原本沒限制欄寬，table-layout 預設 auto 會把最長文字那欄
  // （職缺名稱）硬撐到 1200px 寬，整張表被拉到 2500px 需要橫向捲動——改成
  // table-layout:fixed + colgroup 固定每欄比例，內容過長用 ellipsis 截斷
  // （標題屬性可以之後補 hover 顯示全文，這輪先求版面不再暴衝）。
  candidateTableRows: (rawItems) => { const items = newFirst(rawItems); return items.length ? `<div class="table-wrap"><table class="spec"><colgroup><col class="col-name"><col class="col-job"><col class="col-client"><col class="col-owner"><col class="col-stage"><col class="col-stage"><col class="col-contact"><col class="col-updated"></colgroup><tr><th>人選</th><th>目前應徵職缺</th><th>客戶</th><th>顧問</th><th>阿財分流</th><th>階段</th><th>聯絡方式</th><th>最後活動</th></tr>${items.map((i) => {
    const placeholder = i.email && /@no-email\.step1ne\.local$/i.test(String(i.email).trim());
    const contact = [i.phone, (i.email && !placeholder) ? i.email : null].filter(Boolean).join(' · ') || '—';
    const boundClient = i.clientName && i.clientName !== '（未綁客戶）';
    return `<tr data-application="${text(i.applicationId)}" style="cursor:pointer">
      <td>${isNewCand(i) ? '<span class="badge new-cand" title="跟阿財面談完、還沒指派顧問">NEW</span> ' : ''}${i.seqNo ? `<small class="muted">#${text(i.seqNo)}</small> ` : ''}${text(i.name)}${i.duplicate ? ' ⚠' : ''}${i.hardGate ? ' <span class="badge warning">硬性條件</span>' : ''}</td>
      <td title="${escapeHtml(i.job || '')}">${text(i.job)}</td><td title="${escapeHtml(boundClient ? i.clientName : '')}">${boundClient ? text(i.clientName) : '—'}</td><td>${text(i.owner)}</td>
      <td>${i.lineBound ? '<span class="badge success" title="已綁定 LINE">LINE</span> ' : ''}${routeBadge(i.routeCode, i.routeLabel) || '<span class="muted">—</span>'}${i.silentInterview ? ' <small class="muted" title="阿財面談室沒有對話紀錄，不代表沒談過——顧問可能是自己打電話談的">無阿財紀錄</small>' : ''}</td>
      <td>${statusBadge(i.stage)}${laterBadge(i)}</td><td>${text(contact)}</td><td>${text(i.updatedAt)}</td>
    </tr>`;
  }).join('')}</table></div>` : empty('目前沒有資料', '可調整篩選條件或建立新項目。'); },
  // 阿財初篩報告清單。r.app_id 是這份報告所屬的 application_id——整列點擊會開既有的
  // candidateRows 那個豐富抽屜（data-application 是全域點擊委派已經在聽的屬性，
  // 不用另外接線）。決策徽章照 reports.consultant_decision 的三個真實值＋null＝待處置。
  reportRows: (items) => list(items, (r) => `<article class="candidate-card" data-application="${text(r.app_id)}"><div><h3>${text(r.name)}</h3><p>${text(r.job_title || r.job_slug)} · ${text(r.turns ?? 0)} 輪對話</p></div>${statusBadge(r.consultant_decision || 'undecided')}<dl><div><dt>建議</dt><dd>${text(r.recommend)}</dd></div><div><dt>報告摘要</dt><dd>${text((r.preview || '').slice(0, 80))}${(r.preview || '').length > 80 ? '…' : ''}</dd></div><div><dt>面談結束</dt><dd>${text(r.interview_ended_at)}</dd></div></dl><button class="btn primary">查看應徵單</button></article>`),
  // 接觸紀錄（跟開發客戶方向相反：是「為了某職缺去接觸了誰」，學校系所／人選／
  // 介紹人都算）。樣本不到 100 封不顯示回覆率——這是 Jacky 定的門檻，見後端註解。
  outreachTab: ({ rows, stats }) => `<div class="kpi-grid"><article class="kpi"><span>已寄出</span><strong>${text(stats.total ?? 0)}</strong></article><article class="kpi"><span>有回覆</span><strong>${text(stats.replied ?? 0)}</strong></article><article class="kpi"><span>還在等</span><strong>${text(stats.waiting ?? 0)}</strong></article><article class="kpi"><span>回覆率</span><strong>${stats.reply_rate == null ? '—' : text(stats.reply_rate) + '%'}</strong><small>${stats.reply_rate == null ? `樣本要滿 100 封才顯示（目前 ${text(stats.total ?? 0)}）` : ''}</small></article></div><div class="card"><h2>新增接觸紀錄</h2>${actionBtn('新增一筆', 'outreach-add', {}, 'primary')}</div>${list(rows, (o) => `<article class="list-row"><span><b>${text(o.target_name)}</b><small>${text(o.company || o.region)} · ${text(o.job_title || o.job_slug)} · ${text(o.channel)} · ${text(o.sent_at)}</small></span>${statusBadge(o.outcome)}${rowActions([actionBtn('有回覆', 'outreach-outcome', { idParams: { id: o.id, outcome: 'replied' } }),actionBtn('約到面談', 'outreach-outcome', { idParams: { id: o.id, outcome: 'meeting' } }),actionBtn('已讀不回', 'outreach-outcome', { idParams: { id: o.id, outcome: 'no_reply' } }),actionBtn('婉拒', 'outreach-outcome', { idParams: { id: o.id, outcome: 'declined' } })])}</article>`)}`,
  // 阿福履歷健檢（跟阿財完全分開的獨立人格與資料表，本人主動來問自己的市場價值，
  // 沒有應徵任何職缺）。對話已結束（chat_state=done）但沒有 report_at 代表報告排版
  // 失敗、卡住了，跟「還在對談中」要分開標示——照抄舊版 consultant/checkups 的判斷。
  checkupRows: (items) => list(items, (c) => {
    const stuck = c.status === 'talking' && c.chat_state === 'done' && !c.report_at;
    const nums = [['led_headcount', '帶人'], ['budget_scale', '預算'], ['crowdfunding_raised', '募資']]
      .map(([k, label]) => `${label}：${c[k] ? text(c[k]) : '—'}`).join('　');
    const rpt = (c.report_at && c.chat_token)
      ? `<a class="btn ghost sm" target="_blank" rel="noopener" href="https://step1ne-backoffice-worker.aiagentg888.workers.dev/checkup-chat/${encodeURIComponent(c.chat_token)}/report">查看報告 →</a>` : '';
    const badge = stuck ? '<span class="badge danger">對話已結束但報告沒產出，需人工查看</span>' : statusBadge(c.status);
    return `<article class="list-row"><span><b>${text(c.name)}</b><small>${text(c.current_title || '—')} · ${text(c.current_industry || '—')} · ${nums}</small></span>${badge}<small>${text(c.created_at)}</small>${rpt}</article>`;
  }),
  jobs: (tab='list') => pageHead('職缺中心','新增職缺會進入 intake → AI 擬稿 → 人工核准流程。','<button class="btn primary" data-action="job-intake">＋ 建立用人需求</button>') + tabbar('jobs',[['list','職缺總覽'],['card','職缺卡'],['ops','營運數據'],['intake','新增／收件'],['drafts','待 AI 擬稿'],['checks','必要條件'],['expertise','面談題庫']],tab) + `<div id="page-data">${endpointState('職缺資料')}</div>`,
  // /admin/jobs 真實欄位：company_display_name（不是 company_name/client_name）、applicants
  // （不是 applications_count）；沒有 location 或 forward_count 這兩個欄位，不假裝有。
  // 2026-09-15 查證：後端 /admin/jobs 其實一次帶出全部 6 關（applicants/screening/
  // client_stage/offered/onboard/closed），不是只有前 3 關——漏斗少「錄取/到職/結案」
  // 不是後端沒有這些數字，是前端一直沒把它們畫出來。到職／結案有數字時特別標色，
  // 顧問一眼看得出這職缺是不是真的有在成交，不是只看應徵量。
  // 2026-10-01 Jacky：「職缺總覽要找特定職缺很難找，怎麼沒有下拉選單可以篩選」。
  // 跟職缺卡分頁同一套：原生 select（手機也好按）＋關鍵字，前端篩，不多打 API。
  jobListFilter: (jobs, f) => {
    const SL = { dispatch: '人力派遣', direct: '正職代招', executive: '中高階獵才' };
    const client = (j) => j.company_display_name || j.company_name || j.client_name || '';
    const isOpen = (j) => ['open', 'active'].includes(j.status);
    const kw = String(f.q || '').trim().toLowerCase();
    const isSo = (j) => j.status === 'social_only';
    const isDraft = (j) => ['draft', 'client_draft', 'pending_review'].includes(j.status);
    return (jobs || []).filter((j) => j.slug !== 'unspecified' // 系統佔位用，不是真的職缺
      && (f.status === 'all' || (f.status === 'social_only' ? isSo(j) : f.status === 'draft' ? isDraft(j) : f.status === 'closed' ? (!isOpen(j) && !isSo(j) && !isDraft(j)) : isOpen(j)))
      && (f.client === 'all' || client(j) === f.client)
      && (f.line === 'all' || (j.service_line || '') === f.line)
      && (!kw || [j.title, client(j), j.slug, jobCode(j.slug), SL[j.service_line] || j.service_line].join(' ').toLowerCase().includes(kw)));
  },
  jobListTab: (jobs, f) => {
    jobs = jobs || [];
    const SL = { dispatch: '人力派遣', direct: '正職代招', executive: '中高階獵才' };
    const client = (j) => j.company_display_name || j.company_name || j.client_name || '';
    const count = (key, pick) => {
      const m = new Map();
      views.jobListFilter(jobs, { ...f, [key]: 'all' }).forEach((j) => { const k = pick(j); m.set(k, (m.get(k) || 0) + 1); });
      return [...m.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'zh-Hant'));
    };
    const opt = (v, label, cur) => `<option value="${text(v)}"${v === cur ? ' selected' : ''}>${text(label)}</option>`;
    const isOpen = (j) => ['open', 'active'].includes(j.status);
    const sScope = views.jobListFilter(jobs, { ...f, status: 'all' });
    const openN = sScope.filter(isOpen).length;
    const soN = sScope.filter((j) => j.status === 'social_only').length;
    const drN = (jobs || []).filter((j) => ['draft', 'client_draft', 'pending_review'].includes(j.status)).length;
    return `<div class="filters" style="margin-bottom:14px;flex-wrap:wrap;gap:8px">
<input id="joblist-q" type="search" placeholder="搜尋職稱或客戶" value="${text(f.q || '')}" style="min-height:44px;flex:1 1 180px">
<select id="joblist-status" aria-label="狀態">${opt('open', `招募中（${openN}）`, f.status)}${opt('draft', `📝 草稿・待上架（${drN}）`, f.status)}${opt('social_only', `🔒 未簽約客戶職缺（${soN}）`, f.status)}${opt('closed', `已關閉（${sScope.length - openN - soN - drN}）`, f.status)}${opt('all', `全部（${sScope.length}）`, f.status)}</select>
<select id="joblist-client" aria-label="客戶">${opt('all', '全部客戶', f.client)}${count('client', client).map(([k, n]) => opt(k, `${k || '（沒填客戶）'}（${n}）`, f.client)).join('')}</select>
<select id="joblist-line" aria-label="服務類型">${opt('all', '全部類型', f.line)}${count('line', (j) => j.service_line || '').map(([k, n]) => opt(k, `${SL[k] || k || '（沒填）'}（${n}）`, f.line)).join('')}</select>
</div>${drN && f.status !== 'draft' ? `<div class="notice" style="margin:0 0 12px"><b>有 ${drN} 個職缺還是草稿，沒有上架。</b>　<button type="button" class="btn sm primary" data-joblist-showdraft>看草稿、一鍵上架</button></div>` : ''}<div id="joblist-results">${views.jobListResults(jobs, f)}</div>`;
  },
  jobListResults: (jobs, f) => {
    const rows = views.jobListFilter(jobs, f);
    return `<p class="muted" style="margin:0 0 8px">共 ${rows.length} 個職缺</p>` + (rows.length ? views.jobRows(rows) : '<p class="muted">沒有符合的職缺，換個條件試試。</p>');
  },
  jobRows: (items) => list(items, (j) => `<article class="job-row" data-job="${text(j.slug || j.id)}"><div><h3>${jobCode(j.slug) ? `<small class="jobcode">${text(jobCode(j.slug))}</small> ` : ''}${text(j.title)}</h3><p>${text(j.company_display_name || j.company_name || j.client_name || j.social_only_company)} · ${j.status === 'social_only' ? '開發中・只發社群' : text(({ dispatch: '人力派遣', direct: '正職代招', executive: '中高階獵才' })[j.service_line] || j.service_line)}</p></div><span style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">${statusBadge(j.status)}${['draft', 'client_draft', 'pending_review'].includes(j.status) ? actionBtn('上架', 'job-publish', { idParams: { slug: j.slug } }, 'primary') : ''}${j.sourcing_mode === 'priority' ? '<span class="badge info" title="外部找人選：每晚優先找">優先找人</span>' : j.sourcing_mode === 'off' ? '<span class="badge" title="外部找人選：不找">不找人</span>' : ''}</span><div class="metrics"><span>應徵 ${text(j.applicants ?? 0)}</span><span>篩選中 ${text(j.screening ?? 0)}</span><span>客戶階段 ${text(j.client_stage ?? 0)}</span><span>錄取 ${text(j.offered ?? 0)}</span><span class="${(j.onboard ?? 0) > 0 ? 'accent' : ''}">到職 ${text(j.onboard ?? 0)}</span><span class="${(j.closed ?? 0) > 0 ? 'warn' : ''}">結案 ${text(j.closed ?? 0)}</span></div><button class="btn">管理</button></article>`),
  // 2026-09-24 重寫：收件單沒有 title 欄位（職稱要等總指揮擬完才有），原本顯示一排空白。
  //   改成客戶／服務線／進度中文／附件數，核准一樣在 TG 群組按。
  jobDraftRows: (items) => list(items, (d) => {
    const ST = { new: '排隊中（約 10 分鐘內開始擬）', drafting: '總指揮擬 JD 中', drafted: '擬好了，等你在 TG 群組按核准',
      rewrite: '退回重寫中', approved: '已核准，等發布', published: '已發布', rejected: '已拒絕' };
    const SL = { dispatch: '人力派遣', direct: '正職代招', executive: '中高階獵才' };
    const done = d.status === 'published' || d.status === 'rejected';
    const what = d.draft_title || d.title_hint
      || (d.file_names ? String(d.file_names).replace(/\.(docx?|xlsx?|pdf|md|txt|csv|png|jpe?g)(?=、|$)/gi, '') : '')
      || String(d.raw_preview || '').split('\n').map((x) => x.trim()).find(Boolean)
      || d.source_url || '（沒有職缺資料）';
    return `<article class="list-row"><span><b>${text(String(what).slice(0, 60))}</b>
      <small>客戶：${text(d.client_name || '（沒填）')}${d.draft_title ? '' : '　（職稱等 AI 擬完會換成正式的）'}</small>
      <small>${text(SL[d.service_line] || d.service_line || '')} · ${text(ST[d.status] || d.status)} · 附件 ${text(d.file_count ?? 0)} 個 · ${text(d.created_at)}${d.published_slug ? ` · 職缺：${text(d.published_slug)}` : ''}</small></span>
      ${done ? '' : rowActions([actionBtn('刪除收件單','job-draft-delete',{ idParams: { id: d.id } },'danger')])}</article>`;
  }),
  jobCheckRows: (items) => list(items, (j) => `<article class="list-row"><span><b>${text(j.title || j.job_title)}</b><small>${text(j.slug || j.job_slug)} · ${text(j.missing || j.note)}</small></span>${rowActions([actionBtn('確認必要條件','must-check-confirm',{ idParams: { slug: j.slug || j.job_slug } })])}</article>`),
  // /admin/expertise 回傳 {banks, missing} 兩個陣列；banks 每筆是 title/job_slug/questions_json
  // （字串，需要 JSON.parse 才是題目陣列，見 expertise-save action）/edited_at/can_restore。
  // ── 2026-09-20 改寫：從「一行一個職缺＋一顆開 JSON 文字框的按鈕」，改成
  // 逐題看得到、逐題改得動的畫面。
  //
  // 改的理由：舊版唯一的編輯入口 expertise-save 開出來是一個裝原始 JSON 的
  // textarea，Jacky 看不懂也不敢動，所以題庫從上線到現在沒被人工調整過一次。
  // 題庫是阿財專業題的來源，也是新的「專業技能深度」那一維（佔 20%）的分數
  // 來源——顧問改不動它，等於這 20% 完全交給機器出的題目決定。
  // 舊的 expertise-save 沒有拿掉，留著當「整包貼上」的後路。

  // 五級尺：顧問要看得懂阿財怎麼把一題的回答換成分數，才會信這個分數。
  expertiseRuler: () => `<div class="card"><h2>阿財怎麼判斷「粗略懂」還是「很上手」</h2>
<p class="help">量的是<b>他講得有多深</b>，不是答案對不對——專業對錯留給你跟用人主管判斷。每題評 1–5 級，平均後換成「專業技能深度」這一維的分數，佔總分 20%。</p>
<table class="spec"><tr><th>級</th><th>他答到哪一層</th></tr>
<tr><td class="num">1</td><td>只講得出「我會」，講不出用它做過什麼</td></tr>
<tr><td class="num">2</td><td>講得出做過什麼，但講不出細節、規模、頻率</td></tr>
<tr><td class="num">3</td><td>講得出實際專案、常用哪些功能，但沒碰過難題</td></tr>
<tr><td class="num">4</td><td>講得出遇過什麼問題、怎麼解的</td></tr>
<tr><td class="num">5</td><td>講得出取捨與代價——為什麼選這個做法、放棄了什麼。做過的人才答得出來</td></tr></table>
<div class="notice">沒問到的題目不會被當成 1 級——「沒問」跟「問了答不出來」是兩件事，當成 1 級等於誣賴候選人不會。</div></div>`,

  expertiseQuestionCard: (jobSlug, q, i) => {
    const kind = q.kind || '經驗';
    const live = kind === '情境' || kind === '外語';
    const bullets = (arr, cls, title) => (arr && arr.length)
      ? `<div class="sig ${cls}"><b>${title}</b><ul>${arr.map((x) => `<li>${text(x)}</li>`).join('')}</ul></div>`
      : '';
    return `<article class="list-row expertise-q"><span>
<small>${i + 1}. <b>${text(kind)}</b>${live ? '（當場請他做）' : ''} · ${text(q.topic || '')}</small>
<b>${text(q.q || '')}</b>
${q.why ? `<small>為什麼問：${text(q.why)}</small>` : ''}
${bullets(q.good_signs, 'good', '真做過會提到')}
${bullets(q.red_flags, 'bad', '含糊的訊號')}
${q.followup ? `<small>含糊就追問：${text(q.followup)}</small>` : ''}
</span>${rowActions([
      // record 裡的 good_signs／red_flags 先轉成「一行一條」的字串再傳。
      // 直接把陣列丟進去的話，app.js 的 formFields(fields, ctx.record) 會用
      // ctx.record 的值蓋掉欄位 value，陣列被 String() 成「a,b,c」，存回去就
      // 從 3 條變成 1 條（2026-09-20 實測踩到）。
      actionBtn('改這題', 'expertise-question-edit', {
        idParams: { job_slug: jobSlug, idx: i },
        record: { ...q,
          good_signs: (q.good_signs || []).join('\n'),
          red_flags: (q.red_flags || []).join('\n') },
      }),
      actionBtn('刪掉', 'expertise-question-delete', { idParams: { job_slug: jobSlug, idx: i } }, 'danger'),
    ])}</article>`;
  },

  jobExpertiseRows: (items, building = []) => list(items || [], (e) => {
    // ⚠️ safeParseJson 只擋得住「字串不是合法 JSON」，擋不住 questions_json 是
    // SQL NULL——JSON.parse(null) 回傳 null 而且**不丟例外**，try/catch 完全接不到，
    // 後面 qs.length 就整頁炸掉（2026-09-20 實測：產題失敗留下的空殼職缺一進
    // banks 就觸發）。一律收斂成陣列。
    const parsed = safeParseJson(e.questions_json);
    const qs = Array.isArray(parsed) ? parsed : [];
    const isBuilding = building.includes(e.job_slug);
    return `<section class="card"><div class="list-row">
<span><b>${text(e.title || e.job_slug)}</b><small>${text(e.domain)} · ${qs.length} 題 · ${e.edited_at ? `${text(e.edited_by || '顧問')}改過 ${text(e.edited_at)}` : `機器產於 ${text(e.built_at)}`}</small></span>
${rowActions([
      actionBtn('＋ 自己加一題', 'expertise-question-add', { idParams: { job_slug: e.job_slug } }),
      ...(isBuilding ? [] : [actionBtn('重新產生整份', 'expertise-build', { idParams: { job_slug: e.job_slug } })]),
      ...(e.can_restore ? [actionBtn('還原上一版', 'expertise-restore', { idParams: { job_slug: e.job_slug } }, 'danger')] : []),
    ])}</div>
${isBuilding ? '<div class="notice">⏳ 正在重新產生，約 2–3 分鐘，好了會在 Telegram 通知你。</div>' : ''}
${qs.length ? qs.map((q, i) => views.expertiseQuestionCard(e.job_slug, q, i)).join('')
    : '<div class="notice">這個職缺的題庫是空的（之前產題失敗），阿財面談時問不到任何專業題。按上面的「重新產生整份」。</div>'}
</section>`;
  }),

  // 沒題庫的職缺：以前只顯示「尚未建立題庫」卻沒有任何按鈕可以叫它產——
  // 28 個在辦職缺有 20 個空著沒人發現就是因為這個。現在每一列都有按鈕。
  jobExpertiseMissingRows: (items, building = []) => (items && items.length)
    ? `<div class="card"><h2>還沒有題庫的職缺（${items.length}）</h2>
<p class="help">這些職缺阿財面談時<b>問不到任何專業題</b>，「專業技能深度」那一維會是空的。按「產生題庫」讓 AI 上網查這個職務的專業內涵再出題。</p>
${list(items, (j) => `<article class="list-row"><span><b>${text(j.title || j.slug)}</b><small>${text(j.client_name || '')}${j.empty_shell ? ' · 之前產題失敗，題庫是空的' : ' · 尚未建立題庫'}</small></span>${rowActions(building.includes(j.slug) ? [] : [actionBtn('產生題庫', 'expertise-build', { idParams: { job_slug: j.slug } }, 'primary')])}${building.includes(j.slug) ? '<span class="badge">⏳ 產生中</span>' : ''}</article>`)}</div>`
    : '',
  // 2026-09-21 改：抽屜加分頁。原本題庫只做在「職缺中心 → 面談題庫」那個
  // 全站攤平的總覽頁，Jacky 反映（附截圖）他的預期是「點進職缺卡片就能切分頁看」——
  // 他說得對：正在看這個職缺時本來就想順手看它的題庫，現在卻要跳出去、
  // 到另一個分頁、在 30 幾個職缺裡再找回同一個。總覽頁保留（適合一次看全部
  // 缺哪些），這裡是同一份資料的第二個入口。
  jobManageBody: (job, content, bank, isBuilding = false, card = null, acai = null, sourced = null) => {
    const slug = job.slug || job.id;
    const lv = card && card.profile ? `（Lv.${card.profile.level || 0}）` : '';
    return `<div class="tabs">
<button class="active" data-jobtab="manage">管理</button>
<button data-jobtab="preview">JD 完整預覽</button>
<button data-jobtab="sourced">AI 找的人${sourced && Array.isArray(sourced.rows) ? `（${sourced.rows.length}）` : ''}</button>
<button data-jobtab="expertise">面談題庫${bank && bank._n ? `（${bank._n}）` : ''}</button>
<button data-jobtab="card">職缺卡${lv}</button>
<button data-jobtab="acai">阿財的理解</button>
</div>
<div class="drawer-section" id="job-tab-manage">${job.status === 'social_only' ? `<div class="notice" style="margin:0 0 12px"><b>🔒 未簽約客戶職缺（只發社群）</b><br>開發中的公司：${text(job.social_only_company || '')}。只在「一鍵發文」用，不上官網、不收線上應徵、阿財不面談、不跑外部 AI 找人；人才庫配對結果只給顧問內部看，不要寄信／LINE 邀請人選。<div style="margin-top:10px">${actionBtn('已簽約，轉成正式職缺', 'social-job-convert', { idParams: { slug } }, 'primary')}</div></div>` : (job.social_only_converted_at ? `<p class="help">這個職缺原本是「🔒 未簽約客戶職缺」，${text(String(job.social_only_converted_at).slice(0, 10))} 簽約後轉成正式職缺。</p>` : '')}<h3>職缺狀態</h3>${rowActions([actionBtn('開啟／關閉職缺','job-status',{ idParams: { slug } }),actionBtn('刪除職缺','job-delete',{ idParams: { slug } },'danger')])}${views.jobFactsPanel(job)}<h3>職缺內容</h3>${views.jobContentForm(content)}<button class="btn primary" data-action="submit-job-content" data-slug="${text(slug)}">儲存並更新官網</button><p class="help">只存你改過的地方，官網約 10 分鐘內更新。如果內容突然少很多，系統會先問你一次，不會直接蓋掉。</p><h3>客製表單欄位</h3>${actionBtn('新增客製表單欄位','job-forms-create',{ idParams: {}, record: { job_slug: slug } })}</div>
<div class="drawer-section" id="job-tab-preview" hidden><div class="card-head" style="margin-bottom:8px"><p class="help" style="margin:0">這就是求職者在官網看到的完整職缺頁。改完「管理」裡的職缺內容，最多 15 分鐘後這裡會更新。</p><a class="btn sm" href="https://step1ne.com/jobs/${encodeURIComponent(slug)}/" target="_blank" rel="noopener">在新分頁打開</a></div><iframe class="jd-preview-frame" title="職缺頁預覽" data-src="https://step1ne.com/jobs/${encodeURIComponent(slug)}/" style="width:100%;height:75vh;border:1px solid var(--line,#d6dde6);border-radius:10px;background:#fff" loading="lazy"></iframe><p class="help">如果上面是空白，代表這個職缺還沒上官網，或你是在測試站看（測試站不能嵌正式站的頁面），按「在新分頁打開」。</p></div>
<div class="drawer-section" id="job-tab-sourced" hidden>${views.jobSourcedPanel(slug, sourced)}</div>
<div class="drawer-section" id="job-tab-expertise" hidden>${views.jobExpertisePanel(slug, bank, isBuilding)}</div>
<div class="drawer-section" id="job-tab-card" hidden>${views.jobCardPanel(slug, card)}${(() => {
  // 2026-09-30 Jacky：「職缺卡下方」也要看得到 AI 找的人，點了跳到完整分頁
  const rs = (sourced && Array.isArray(sourced.rows)) ? sourced.rows : [];
  if (!rs.length) return '<div class="card" style="margin-top:14px"><h3 style="font-size:15px;margin:0">AI 找的人</h3><p class="help">這個職缺還沒有 AI 找到的人選。</p></div>';
  return `<div class="card" style="margin-top:14px"><div class="card-head"><h3 style="font-size:15px;margin:0">AI 找的人（${rs.length}）</h3><button type="button" class="btn primary sm" data-jump-tab="sourced">看全部＋記錄聯絡</button></div>${rs.slice(0, 5).map((x) => `<div class="list-row"><span><b>${text(x.name)}</b> <span class="badge">${text(x.grade || '')}</span><small>${text(x.headline || '')}${x.company ? '・' + text(x.company) : ''}</small></span></div>`).join('')}</div>`;
})()}</div>
<div class="drawer-section" id="job-tab-acai" hidden>${views.jobAcaiPanel(slug, acai)}</div>`;
  },

  // 職缺抽屜「AI 找的人」分頁（2026-09-29，Jacky 簡化主線流程：AI 持續找人 →
  // 顧問打電話 → 阿財面談…）。AI 找到的人原本只能去「人選 → 人才池」翻，
  // 現在直接掛在職缺底下，顧問打完電話順手記錄＋評符不符合，累積「AI 找人精準度」。
  // 資料來自 GET /admin/jobs/:slug/sourced；記錄聯絡走 ACTIONS['sourced-contact']。
  // 2026-10-07：「AI 挖角」——顧問填挖角公司＋目標職級，AI 只找這些公司的人，並寫好 LinkedIn 訊息
  jobPoachBox: (slug, po) => {
    const last = po.last || null;
    const ST = { pending_poach: '排隊中', running: '正在找', done: '上次跑完', failed: '上次失敗' };
    const lastTxt = last ? `${ST[last.status] || last.status}（${text(String(last.created_at || '').slice(5, 16))} 排入${last.status === 'done' ? `，新增 ${text(last.candidates_saved ?? 0)} 位` : ''}）` : '';
    return `<div class="card poach-box">
      <b>AI 挖角</b>
      <p class="help">填你想挖的公司，AI 只找現在或最近在這些公司、這個職級的人，並幫每個人寫好兩段 LinkedIn 訊息（邀請附註＋對方接受後的私訊）。訊息你自己複製貼上送出，系統不會自動送。</p>
      <label class="field"><span>挖角公司（一行一家）</span>
        <textarea data-poach-companies="${escapeHtml(slug)}" rows="5" placeholder="例：&#10;聚陽 Makalot&#10;儒鴻 Eclat">${escapeHtml(po.companies || '')}</textarea></label>
      <label class="field"><span>目標職稱／職級（例：業務或供應鏈處長以上）</span>
        <input type="text" data-poach-titles="${escapeHtml(slug)}" value="${escapeHtml(po.titles || '')}" maxlength="300"></label>
      <div class="poach-btns">
        <button type="button" class="btn" data-poach-save="${escapeHtml(slug)}">儲存</button>
        <button type="button" class="btn primary" data-poach-run="${escapeHtml(slug)}">立刻挖角</button>
        ${po.by ? `<span class="help">（${text(po.by)} ${text(String(po.at || '').slice(5, 16))} 設定）</span>` : ''}
        ${lastTxt ? `<span class="help">${lastTxt}</span>` : ''}
      </div></div>`;
  },

  jobSourcedPanel: (slug, data) => {
    if (!data) return '<div class="notice">AI 找的人載入失敗，關掉抽屜再開一次試試。</div>';
    const rows = Array.isArray(data.rows) ? data.rows : [];
    const k = data.kpi || {};
    const kpi = `<div class="src-kpi"><b>AI 找人精準度：符合 ${k.fit || 0}／已評分 ${k.rated || 0}${k.rated ? `（${k.precision}%）` : '（還沒有人被評分）'}</b>
<small>已評分＝評過「符合」或「不符合」；「不確定」${k.unsure || 0} 位不算進去。已聯絡 ${k.contacted || 0} 位${k.rejected ? `・另有 ${k.rejected} 位之前被標不合適，不列出` : ''}</small></div>`;
    // 2026-10-03：外部找人選設定（夜間 AI 找人照這個挑職缺）
    const sm = (data.sourcing && data.sourcing.mode) || 'auto';
    const SM = { priority: '優先找（每晚先做）', auto: '一般（近 45 天有人應徵才找）', off: '不找' };
    const modeBox = `<div class="card" style="padding:10px 12px;margin:0 0 10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <b>外部找人選：</b><select data-sourcing-mode="${escapeHtml(slug)}" aria-label="外部找人選設定" style="min-height:40px">${Object.entries(SM).map(([k, v]) => `<option value="${k}" ${sm === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <button type="button" class="btn sm" data-sourcing-mode-save="${escapeHtml(slug)}">儲存</button>
      ${data.sourcing && data.sourcing.by ? `<span class="help">（${text(data.sourcing.by)} ${text(String(data.sourcing.at || '').slice(5, 16))} 設定）</span>` : ''}</div>`
      + views.jobPoachBox(slug, data.poach || {});
    if (!rows.length) return `${modeBox}${kpi}<div class="notice">這個職缺目前沒有 AI 找到的人選。</div>`;
    const RES = { no_answer: '沒接／沒回', interested: '有興趣', not_interested: '沒興趣', invited: '已約阿財面談', wrong_person: '資料不對／不是本人', email_invited: '已寄邀請信', opt_out: '本人說不要再寄' };
    const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : '');
    const link = (u, label) => (safeUrl(u) ? `<a class="btn ghost sm" href="${escapeHtml(safeUrl(u))}" target="_blank" rel="noopener">${text(label)}</a>` : '');
    const card = (r) => {
      const others = String(r.other_links || '').split(/[\s,，、]+/).map(safeUrl).filter(Boolean);
      const otherLinks = others.slice(0, 3).map((u) => link(u, /cake\.me|cakeresume/i.test(u) ? 'CakeResume' : '作品／其他')).join('');
      const srcLink = r.source_url && r.source_url !== r.linkedin_url && r.source_url !== r.github_url ? link(r.source_url, '原始頁') : '';
      const phone = String(r.phone || '').trim();
      const email = String(r.email || '').trim();
      const hasSocial = !!(r.linkedin_url || r.github_url || others.length || r.source_url);
      const how = [];
      if (r.grade === 'C' || r.grade === 'D') how.push('<span class="badge">先不聯絡</span>');
      if (email) how.push('<span class="badge info">可寄信</span>');
      if (phone) how.push('<span class="badge success">可打電話</span>');
      if (!email && !phone && hasSocial && r.grade !== 'C' && r.grade !== 'D') how.push('<span class="badge warning">只能私訊</span>');
      if (r.has_outreach) how.push('<span class="badge info" title="點「看資料卡」就能複製">已寫好 LinkedIn 訊息</span>');
      const fitMark = r.fit === 'fit' ? '<span class="badge success" title="顧問評：符合">✓ 符合</span>'
        : r.fit === 'unfit' ? '<span class="badge danger" title="顧問評：不符合">✕ 不符合</span>'
        : r.fit === 'unsure' ? '<span class="badge">？ 不確定</span>' : '';
      const cc = Number(r.call_count) || 0;
      const last = cc ? `<small class="src-last">已聯絡 ${cc} 次・上次：${text(RES[r.last_contact_result] || r.last_contact_result || '')}・${text(String(r.last_contact_at || '').slice(0, 10))}</small>` : '';
      const why = String(r.why || '').trim();
      // 2026-10-06：有沒有人看過完整履歷——沒看過的分數只是 AI 從公開摘要推的
      const vs = r.verify_status === 'verified' ? '<span class="badge success" title="AI 已照完整履歷重新判斷">✅ 已核對</span>'
        : r.verify_status === 'pending' ? '<span class="badge warning">⏳ 核對中</span>'
        : '<span class="badge" title="分數是 AI 從公開摘要推的，還沒人看過完整履歷">未核對</span>';
      const vnote = r.verify_status === 'verified' && r.verify_note
        ? `<details class="src-why" open><summary>履歷核對結果（${text(String(r.verified_at || '').slice(5, 16))}）</summary><p style="white-space:pre-wrap">${text(r.verify_note)}</p></details>` : '';
      return `<article class="src-card${cc ? ' contacted' : ''}">
<div class="src-head"><span class="src-name"><b>${text(r.name || '（沒有名字）')}</b>${r.grade ? `<span class="badge info">${text(r.grade)} 級${r.score !== null && r.score !== undefined ? ` · ${text(r.score)}` : ''}</span>` : ''}${vs}${fitMark}</span></div>
<small>${[r.headline, r.company, r.location].filter(Boolean).map((x) => text(x)).join(' · ')}</small>
${vnote}${why ? `<details class="src-why"><summary>${r.verify_status === 'verified' ? 'AI 原本的判斷（只看公開摘要）' : '為什麼符合'}</summary><p>${text(why)}</p></details>` : ''}
<div class="src-how">${how.join('')}</div>
${(email || phone) ? `<div class="src-contact">${phone ? `<a href="tel:${escapeHtml(phone.replace(/[^0-9+#,]/g, ''))}">${text(phone)}</a>` : ''}${email ? `<a href="mailto:${escapeHtml(email)}">${text(email)}</a>` : ''}</div>` : ''}
<div class="src-links">${srcLink}${link(r.linkedin_url, 'LinkedIn')}${otherLinks}${link(r.github_url, 'GitHub')}</div>
${last}
${r.transcript_review ? views.transcriptReview(r.transcript_review) : ''}
${rowActions([`<button type="button" class="btn primary sm" data-sc-action="open" data-sourced-id="${escapeHtml(r.id)}" data-sc-job="${escapeHtml(slug)}">看資料卡${email ? '・寄信' : ''}</button>`, views.sourcedListMailBtn(r), actionBtn(r.verify_status === 'verified' ? '重新上傳履歷核對' : '上傳履歷核對', 'sourced-verify-pdf', { idParams: { id: r.id } }), actionBtn('記錄聯絡', 'sourced-contact', { idParams: { id: r.id, job_slug: slug } })])}
</article>`;
    };
    return `${modeBox}${kpi}<p class="help">沒聯絡過的排前面，再依「已核對且符合 → 未核對 → 核對後不符合」、評級、分數排。未核對＝分數是 AI 從公開摘要推的；在 LinkedIn 打開本人頁按外掛「送進 Step1ne」，或按「上傳履歷核對」傳 PDF，AI 會照完整履歷重判。有 Email 的人按「看資料卡・寄信」，看完再決定寄不寄；打完電話按「記錄聯絡」，順手評符不符合——這就是 AI 找人精準度的分母。</p>
<div class="src-list">${rows.map(card).join('')}</div>`;
  },

  // 單一職缺的題庫面板。跟總覽頁用同一顆 expertiseQuestionCard，不另做一套
  // ——兩邊長不一樣的話，顧問會不知道哪個才是真的。
  jobExpertisePanel: (slug, bank, isBuilding = false) => {
    const qs = bank && Array.isArray(bank.questions) ? bank.questions : [];
    if (!bank) {
      return `<div class="notice">這個職缺還沒有面談題庫，阿財面談時<b>問不到任何專業題</b>，評分表上的「專業技能深度」（佔 20%）會是空的。</div>
${isBuilding ? '<div class="notice">⏳ 正在產生，約 2–3 分鐘，好了會在 Telegram 通知你。</div>'
    : rowActions([actionBtn('產生題庫', 'expertise-build', { idParams: { job_slug: slug } }, 'primary')])}`;
    }
    return `<p class="help">${text(bank.domain || '')} · ${qs.length} 題 · ${bank.edited_at ? `${text(bank.edited_by || '顧問')}改過 ${text(bank.edited_at)}` : `機器產於 ${text(bank.built_at || '')}`}</p>
${rowActions([
      actionBtn('＋ 自己加一題', 'expertise-question-add', { idParams: { job_slug: slug } }),
      ...(isBuilding ? [] : [actionBtn('重新產生整份', 'expertise-build', { idParams: { job_slug: slug } })]),
      ...(bank.can_restore ? [actionBtn('還原上一版', 'expertise-restore', { idParams: { job_slug: slug } }, 'danger')] : []),
    ])}
${isBuilding ? '<div class="notice">⏳ 正在重新產生，約 2–3 分鐘，好了會在 Telegram 通知你。</div>' : ''}
${views.expertiseRuler()}
${qs.length ? qs.map((q, i) => views.expertiseQuestionCard(slug, q, i)).join('')
    : '<div class="notice">題庫是空的（之前產題失敗），按上面的「重新產生整份」。</div>'}`;
  },

  // 職缺卡（對話 B，2026-09-24，Jacky 交辦）——顧問把客戶回饋餵進來，累積
  // 「這個職缺客戶真正要什麼」，阿財面談前先讀濃縮版。等級／經驗值／命中率
  // 是本機 job_card.py 從 placements 對帳算出來的，這裡只負責顯示跟收件。
  // 「A 級人選命中率」——2026-09-24 總指揮交辦，Jacky 的目標是「看到 A 級
  // 人選，就知道這職缺 A 級命中率 85% 以上」。advance_rate／hire_rate／
  // a_grade_settled_n 都是 job_card.py 的 recompute_profile() 已經在算的
  // （跟 Lv.10 品質門檻同一組數字），這裡只負責顯示，不重算。
  // ⚠️ 2026-09-29 總指揮抓到：「錄取 Y%（目標70%）」這條線的 70% 是我自己
  // 套用 job_card.py 的 LV10_GATE_HIRE_RATE 常數畫上去的，Jacky 從來沒有
  // 針對「A 級人選錄取率」訂過 70% 這個數字——那個常數是 Lv.10 封頂門檻的
  // 內部設定，跟「顧問在卡片上看到的目標」是兩回事，不能拿來當成這裡的
  // 目標值展示。改成只顯示錄取率本身（純事實），不配色、不寫「目標」，
  // 只留 Jacky 真的訂過的 85%（客戶約面試）這條。
  jobCardAGradeLine: (p) => {
    const n = p?.a_grade_settled_n || 0;
    const pct1 = (v) => (v === null || v === undefined) ? '—' : `${Math.round(v * 100)}%`;
    const tone = (v, target) => (v !== null && v !== undefined && v >= target)
      ? 'style="color:#14794c;font-weight:700"' : 'style="color:var(--muted)"';
    if (!n) return '<p class="help">A 級人選命中率：還沒有 A 級樣本可以算。</p>';
    return `<p class="help">A 級送客戶 ${n} 位${n < 5 ? '（樣本不足）' : ''}・
客戶約面試 <span ${tone(p.advance_rate, 0.85)}>${pct1(p.advance_rate)}</span>（目標 85%）・
錄取 ${pct1(p.hire_rate)}</p>`;
  },

  // 匯入回饋前 vs 後的 A 級命中率對照——唯一能證明「匯入回饋有沒有用」的
  // 證據。兩邊樣本都要 >=1 才顯示對照，不然「之前 0/0、之後 1/1」這種
  // 比較沒有意義。
  jobCardBeforeAfter: (p) => {
    const beforeN = p?.a_before_n || 0, afterN = p?.a_after_n || 0;
    if (!beforeN && !afterN) return '';
    const pct1 = (v) => (v === null || v === undefined) ? '—' : `${Math.round(v * 100)}%`;
    return `<p class="help">匯入回饋前 A 級錄取率：${pct1(p.a_before_hire_rate)}（樣本 ${beforeN}） vs 匯入回饋後：${pct1(p.a_after_hire_rate)}（樣本 ${afterN}）</p>`;
  },

  jobCardLevelBar: (p) => {
    if (!p) return '';
    const LV_NEXT = [100, 250, 450, 700, 1000, 1350, 1750, 2200, 2700, 3250];
    const xp = p.xp_total || 0;
    const lv = p.level || 0;
    const nextNeed = lv < 10 ? LV_NEXT[lv] : null;
    const prevNeed = lv > 0 ? LV_NEXT[lv - 1] : 0;
    const pct = nextNeed ? Math.max(4, Math.round((xp - prevNeed) / (nextNeed - prevNeed) * 100)) : 100;
    const cap = p.level_capped_by_gate
      ? '<span class="badge warning" title="經驗值已經到 Lv.10 門檻，但阿財評A的人選還沒穩定達到「多數進面試、多數被錄取」，先卡在 Lv.9">卡在 Lv.9（品質門檻未達）</span>' : '';
    const pct1 = (v) => (v === null || v === undefined) ? '—' : `${Math.round(v * 100)}%`;
    const settledN = p.settled_n || 0;
    // ⚠️ 2026-09-24 總指揮交辦：分母是 0 時不要顯示「命中率 0%」——那會讓人
    // 誤以為「阿財全猜錯」，實際上是「還沒有任何一筆有結果可以比對」，
    // 兩件事天差地遠。改成直接講白話。
    const rateLine = settledN
      ? `<span style="white-space:nowrap">命中率 ${pct1(p.accuracy_rate)}</span>
  <span style="white-space:nowrap">婉拒率 ${pct1(p.decline_rate)}</span>`
      : '<span style="white-space:nowrap;color:var(--muted)">還沒有可比對的結果</span>';
    const excludedN = p.excluded_n || 0;
    return `<div class="list-row" style="align-items:center;gap:16px;flex-wrap:wrap">
<span class="badge info" style="font-weight:700">Lv.${lv}${cap}</span>
<span style="flex:1;min-width:180px">
  <div class="fnrow"><span class="lb">經驗值 ${xp}${nextNeed ? `／${nextNeed}` : '（已達曲線頂端）'}</span>
    <span class="track"><span class="bar" style="width:${pct}%;display:block"></span></span></div>
</span>
<span class="metrics" style="flex-wrap:wrap;min-width:200px">
  ${rateLine}
  <span style="white-space:nowrap">回饋 ${p.feedback_count || 0} 筆</span>
</span>
</div>
<p class="help" style="margin:6px 0 0">阿財面談 ${p.interviewed_n || 0} 人・送客戶 ${p.submitted_n || 0} 人・客戶面試 ${p.client_interviewed_n || 0} 人・錄取 ${p.hired_n || 0} 人・報到 ${p.onboarded_n || 0} 人・有結果 ${settledN} 筆${excludedN ? ` （另有 ${excludedN} 筆我方結案／失聯，不計入命中率）` : ''}</p>`;
  },

  jobCardProfileGrid: (full) => {
    const sec = (key, label) => {
      const items = (full && full[key]) || [];
      if (!items.length) return '';
      return `<div class="card" style="padding:13px 15px"><h3 style="margin:0 0 8px;font-size:13px">${label}</h3>
<ul style="margin:0;padding-left:18px;font-size:13px">${items.map((x) => `<li>${text(x)}</li>`).join('')}</ul></div>`;
    };
    const body = [sec('skills', '技能深淺'), sec('traits', '特質'),
                  sec('plus', '加分'), sec('fail_reasons', '常見落選原因')].join('');
    return body ? `<div class="two-col">${body}</div>`
      : '<div class="notice">還沒有任何回饋，職缺卡是空的——阿財目前只能照通用標準評分。</div>';
  },

  // 2026-09-24 加（總指揮交辦）：補過回饋的候選人，紅色提醒要消失。判斷
  // 「補過了」的依據是同一個 application_id 有沒有出現在 feedback_import
  // 事件裡——顧問匯入回饋時可以指定「這筆是補哪位」（見 jobCardPanel 的
  // 表單），兩邊用 events 裡的 application_id 對起來，不用另外打一支 API。
  jobCardOutstandingAlerts: (events) => {
    const list = events || [];
    const resolvedIds = new Set(list.filter((e) => e.event_type === 'feedback_import' && e.application_id)
      .map((e) => e.application_id));
    return list.filter((e) => e.event_type === 'placed' && !['A', 'B'].includes(e.grade)
      && e.application_id && !resolvedIds.has(e.application_id));
  },

  jobCardLowScoreAlerts: (events) => {
    const bad = views.jobCardOutstandingAlerts(events);
    if (!bad.length) return '';
    return bad.map((e) => `<div class="notice" style="background:#ffe5e7;border-color:#eab8bc;color:#a72f3a">
⚠️ <b>${text(e.candidate_name || '這位人選')}</b> 是阿財評 <b>${text(e.grade)}</b> 卻被客戶錄取的——這種落差最值得學，
幫我們補一筆：阿財那次看漏了什麼？（在下面「匯入客戶回饋」選這位、貼一段說明就可以）</div>`).join('');
  },

  jobCardEventRow: (e) => {
    const XP_LABEL = { feedback_import: '匯入回饋', recommend: '推薦給客戶', placed: '錄取', client_declined: '客戶婉拒' };
    const grade = e.grade ? routeBadge(e.grade, '') : '';
    return `<div class="list-row" style="padding:10px 13px">
<span><small>${text(e.created_at)}${e.candidate_name ? ` · ${text(e.candidate_name)}` : ''}</small>
<b>${text(XP_LABEL[e.event_type] || e.event_type)}</b>${grade ? ` ${grade}` : ''}
${e.note ? `<small>${text(e.note)}</small>` : ''}</span>
${e.xp_delta ? `<span class="badge success">+${e.xp_delta} XP</span>` : ''}
</div>`;
  },

  // 職缺卡卡片牆（2026-09-24，Jacky 交辦）：職缺中心一次看完全部職缺的卡，
  // 不用一張一張點開抽屜。沿用既有公式卡片牆的 .prompt-grid／.prompt-card
  // （見 socialFormulasTab），不另外發明畫風。
  // 客戶名稱太長（例如日文全稱＋集團說明）會把卡片撐爆，這裡跟卡片／
  // 客戶篩選選單共用同一個截斷規則，兩處看起來要一致。
  jobCardClientLabel: (name, max = 16) => {
    const s = name || '未指定客戶';
    return s.length > max ? `${s.slice(0, max)}…` : s;
  },

  // 每個職缺的漏斗＋命中率的迷你版（卡片牆單張卡片內用）：橫條依序是
  // 阿財面談／送客戶／客戶面試／錄取／報到，寬度依人數比例（面談當基準
  // 100%）。完整、可排序、手機友善的版本是 jobCardFunnelTable，這裡只是
  // 卡片內的縮圖。顏色用同一個藍色（品牌色）由淺到深——五個階段是同一種
  // 東西（人數）的漸進篩選，不是五個不同類別，序列色階比分類色更誠實。
  jobCardFunnelBars: (j) => {
    const stages = [
      ['面談', j.interviewed_n || 0, '#dce6fc'],
      ['送客戶', j.submitted_n || 0, '#a9c3f6'],
      ['客戶面試', j.client_interviewed_n || 0, '#6c98ef'],
      ['錄取', j.hired_n || 0, '#2867ed'],
      ['報到', j.onboarded_n || 0, '#173d94'],
    ];
    const max = Math.max(1, stages[0][1]);
    const rows = stages.map(([label, n]) => `<span style="display:flex;align-items:center;gap:6px">
<span style="width:46px;flex:none;font-size:11px;color:var(--muted)">${label}</span>
<span style="flex:1;height:8px;background:#eef2f8;border-radius:3px;overflow:hidden;display:block">
<span style="display:block;height:100%;width:${n ? Math.max(4, Math.round(n / max * 100)) : 0}%;background:${stages.find((s) => s[0] === label)[2]};border-radius:3px"></span></span>
<span style="width:18px;flex:none;text-align:right;font-size:11px;font-variant-numeric:tabular-nums">${n}</span>
</span>`).join('');
    const settledN = j.settled_n || 0;
    const pct1 = (v) => (v === null || v === undefined) ? '—' : `${Math.round(v * 100)}%`;
    const acc = settledN ? `${pct1(j.accuracy_rate)}（樣本${settledN}）` : `—（樣本0）`;
    return `<span style="display:flex;flex-direction:column;gap:3px;margin:4px 0">${rows}
<span style="font-size:11px;color:var(--muted);text-align:right">命中率 ${acc}</span></span>`;
  },

  jobCardWallItem: (j) => {
    const LV_NEXT = [100, 250, 450, 700, 1000, 1350, 1750, 2200, 2700, 3250];
    const hasProfile = j.level !== null && j.level !== undefined;
    const closed = j.status !== 'open';
    const closedTag = closed ? '<span class="badge">已關閉</span>' : '';
    const clientLabel = text(views.jobCardClientLabel(j.client_name));
    const flagN = j.low_score_hires || 0;
    // ⚠️ 這裡只能用 <span>——外層是 <button>（跟 promptCard 同一個模式），
    // <div> 塞進 <button> 在部分瀏覽器排版會跑掉。.fnrow／.notice 這些
    // class 本來就是用 class 選字，不管掛在 span 還是 div 上效果一樣。
    const flag = flagN
      ? `<span class="notice" style="display:block;background:#ffe5e7;border-color:#eab8bc;color:#a72f3a;margin:2px 0;padding:5px 8px;font-size:12px">⚠️ ${flagN} 位待補回饋</span>`
      : '';
    // 已關閉、或還沒餵過回饋，整張卡都淡色——同一種「先看招募中、有內容的」邏輯。
    const dim = (closed || !hasProfile) ? ' style="opacity:.55"' : '';
    const funnel = views.jobCardFunnelBars(j);
    if (!hasProfile) {
      return `<button type="button" class="prompt-card job-card-wall-item" data-slug="${text(j.slug)}"${dim}>
<span class="pc-top"><b>${text(j.title)}</b>${closedTag}</span>
<span class="help">${clientLabel}</span>
${funnel}
<span class="pc-body">還沒餵回饋</span>
</button>`;
    }
    const nextNeed = j.level < 10 ? LV_NEXT[j.level] : null;
    const prevNeed = j.level > 0 ? LV_NEXT[j.level - 1] : 0;
    const pct = nextNeed ? Math.max(4, Math.round((j.xp_total - prevNeed) / (nextNeed - prevNeed) * 100)) : 100;
    return `<button type="button" class="prompt-card job-card-wall-item" data-slug="${text(j.slug)}"${dim}>
<span class="pc-top"><b>${text(j.title)}</b><span class="badge info">Lv.${j.level}</span></span>
<span class="help">${clientLabel}${closedTag ? ' · 已關閉' : ''}</span>
${flag}
<span class="fnrow" style="display:flex"><span class="lb">${j.xp_total}${nextNeed ? `／${nextNeed}` : ''}</span><span class="track"><span class="bar" style="width:${pct}%;display:block"></span></span></span>
${funnel}
<span class="pc-body" style="-webkit-line-clamp:1">回饋 ${j.feedback_count || 0} 筆</span>
</button>`;
  },

  // 排序：招募中的優先，已關閉的一律排最後、淡色顯示；招募中裡面再依
  // 待補回饋（紅標）→ 還很淺（沒卡片或 Lv≤2）→ 其他 排。
  // 狀態篩選：open（預設，只看招募中）／needs（需要補回饋，只算招募中的）／
  // all（含已關閉）。客戶篩選：company_id 對不到就退回 client_name 當 key
  // （這裡跟卡片顯示、後端 client_name 解析用同一套「先 company_id」邏輯，
  // 同一家客戶不會因為兩種來源被拆成兩個選項）。
  // 兩個篩選互相影響對方選單裡的數字：客戶選單的數字看目前的狀態篩選，
  // 狀態選單的數字看目前選的客戶——這樣選完一個之後，另一個選單的數字
  // 才會跟畫面上實際看到的一致，不是兩份互不相干的統計。
  // 「每個職缺的漏斗與命中率」改成真正的表格（2026-09-24，總指揮交辦，
  // 取代原本的橫條圖版 jobCardFunnelChart）：表頭寫一次，數字靠右等寬，
  // 送客戶／客戶面試／錄取／報到底下加轉換率（對上一欄），命中率有樣本才
  // 顯示百分比＋樣本數，沒樣本只寫「—」。同時準備兩套 markup（<table> 跟
  // 卡片），用 CSS media query 切換——手機版不是「硬擠進同一張表」，是
  // 直式一小卡一個職缺（見 styles.css 的 .jc-ft-wrap／.jc-ft-cards）。
  // 依 job_slug='unspecified' 排除：卡片牆本來就不含它（/admin/job-cards
  // 已排除），這裡多加一層防呆，不依賴呼叫端一定記得先濾掉。
  jobCardFunnelTable: (jobs) => {
    const rows = (jobs || []).filter((j) => (j.interviewed_n || 0) > 0 && j.slug !== 'unspecified');
    if (!rows.length) return '';
    const sorted = [...rows].sort((a, b) => (b.interviewed_n || 0) - (a.interviewed_n || 0));
    const convPct = (v, prev) => (prev ? `<small>${Math.round((v || 0) / prev * 100)}%</small>` : '');
    const rateCell = (j) => {
      const n = j.settled_n || 0;
      if (!n) return '—';
      const pct = (j.accuracy_rate === null || j.accuracy_rate === undefined)
        ? '—' : `${Math.round(j.accuracy_rate * 100)}%`;
      return `${pct}<small>樣本 ${n}</small>`;
    };
    const stageTd = (v, prev) => `<td class="num">${v || 0}${convPct(v, prev)}</td>`;
    const bodyOf = (j) => {
      const interviewed = j.interviewed_n || 0, submitted = j.submitted_n || 0,
            clientInt = j.client_interviewed_n || 0, hired = j.hired_n || 0, onboarded = j.onboarded_n || 0;
      return { interviewed, submitted, clientInt, hired, onboarded };
    };
    const theadHtml = `<thead><tr><th>職缺</th><th class="num">阿財面談</th><th class="num">送客戶</th>
<th class="num">客戶面試</th><th class="num">錄取</th><th class="num">報到</th><th class="num">命中率</th></tr></thead>`;
    const tbodyHtml = sorted.map((j) => {
      const b = bodyOf(j);
      return `<tr>
<td class="jc-ft-job">${text(j.title)}</td>
<td class="num">${b.interviewed}</td>
${stageTd(b.submitted, b.interviewed)}
${stageTd(b.clientInt, b.submitted)}
${stageTd(b.hired, b.clientInt)}
${stageTd(b.onboarded, b.hired)}
<td class="num jc-ft-rate">${rateCell(j)}</td>
</tr>`;
    }).join('');
    const cardsHtml = sorted.map((j) => {
      const b = bodyOf(j);
      const line = (label, v, prev) => `<span class="jc-ft-card-row"><span>${label}</span><span class="num">${v}${convPct(v, prev)}</span></span>`;
      return `<div class="jc-ft-card">
<b>${text(j.title)}</b>
${line('阿財面談', b.interviewed, 0)}
${line('送客戶', b.submitted, b.interviewed)}
${line('客戶面試', b.clientInt, b.submitted)}
${line('錄取', b.hired, b.clientInt)}
${line('報到', b.onboarded, b.hired)}
<span class="jc-ft-card-row"><span>命中率</span><span class="num jc-ft-rate">${rateCell(j)}</span></span>
</div>`;
    }).join('');
    return `<details class="card jc-funnel" style="margin-bottom:14px" open>
<summary style="cursor:pointer;font-weight:700">每個職缺的漏斗與命中率（${sorted.length}）</summary>
<div class="jc-ft-wrap" style="margin-top:10px"><table class="jc-ft-table">${theadHtml}<tbody>${tbodyHtml}</tbody></table></div>
<div class="jc-ft-cards" style="margin-top:10px">${cardsHtml}</div>
</details>`;
  },

  // 營運數據：阿財面談趨勢（2026-09-24，總指揮交辦）。兩條線——應徵人數／
  // 阿財面談人數，同一張圖（同一個量級：都是「人數」，不需要雙軸）。
  // 配色用 dataviz 技能包的預設驗證色盤 slot1（藍，跟這個後台既有的
  // --blue 很接近）／slot2（橘），這組順序在 CVD 檢測下是安全的，
  // 不是隨便挑的兩個顏色。
  opsTrendLine: (series, w = 760, h = 220) => {
    // series: [{label, color, points:[{bucket,n}]}], 同一組 bucket（已對齊）
    const allBuckets = series[0]?.points.map((p) => p.bucket) || [];
    if (!allBuckets.length) return '<div class="notice">還沒有資料可以畫。</div>';
    const padL = 34, padR = 12, padT = 16, padB = 28;
    const plotW = w - padL - padR, plotH = h - padT - padB;
    const maxN = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.n)));
    const yMax = Math.ceil(maxN / 5) * 5 || 5;
    const x = (i) => padL + (allBuckets.length > 1 ? i / (allBuckets.length - 1) * plotW : plotW / 2);
    const y = (v) => padT + plotH - (v / yMax) * plotH;
    const gridY = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(yMax * f));
    const lines = series.map((s) => {
      const pts = s.points.map((p, i) => `${x(i)},${y(p.n)}`).join(' ');
      const last = s.points[s.points.length - 1];
      const lastX = x(s.points.length - 1), lastY = y(last?.n || 0);
      return `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2"
        stroke-linejoin="round" stroke-linecap="round" />
${s.points.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.n)}" r="4" fill="${s.color}" stroke="var(--viz-surface,#fff)" stroke-width="2">
  <title>${text(s.label)} ${text(p.bucket)}：${p.n}</title>
</circle>`).join('')}
<text x="${lastX + 6}" y="${lastY + 4}" font-size="11" fill="${s.color}" font-weight="700">${last?.n ?? ''}</text>`;
    }).join('');
    const gridLines = gridY.map((v) => `<line x1="${padL}" y1="${y(v)}" x2="${w - padR}" y2="${y(v)}"
        stroke="var(--viz-grid,#e2e8f0)" stroke-width="1" />
<text x="${padL - 6}" y="${y(v) + 3}" font-size="10" fill="var(--viz-muted,#69758a)" text-anchor="end">${v}</text>`).join('');
    const step = Math.max(1, Math.ceil(allBuckets.length / 8));
    const isLast = (i) => i === allBuckets.length - 1;
    const xLabels = allBuckets.map((b, i) => (i % step === 0 || isLast(i))
      ? `<text x="${x(i)}" y="${h - 6}" font-size="10" fill="var(--viz-muted,#69758a)" text-anchor="${isLast(i) ? 'end' : 'middle'}">${text(b.slice(5))}</text>` : '').join('');
    const legend = `<div style="display:flex;gap:14px;margin-bottom:6px;font-size:12px">
${series.map((s) => `<span style="display:flex;align-items:center;gap:5px"><span style="width:10px;height:10px;border-radius:50%;background:${s.color};display:inline-block"></span>${text(s.label)}</span>`).join('')}
</div>`;
    return `${legend}<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:auto" role="img" aria-label="${series.map((s) => s.label).join('、')}趨勢">
${gridLines}${lines}${xLabels}
</svg>`;
  },

  opsKpiTile: (label, cur, prev) => {
    const delta = (prev === null || prev === undefined) ? ''
      : cur === prev ? '（持平）'
      : `${cur > prev ? '▲' : '▼'} ${Math.abs(cur - prev)}`;
    return `<div class="kpi"><span>${text(label)}</span><strong>${cur}</strong>${prev !== null && prev !== undefined ? `<small>${delta}</small>` : ''}</div>`;
  },

  opsData: (d) => {
    const scopeSlug = d._scopeSlug || 'all';
    const selector = views.opsJobScopeSelector(d._jobs, scopeSlug);
    // 選了某個職缺：只看那個職缺的每週漏斗＋命中率趨勢，不是全站 KPI 的
    // 縮小版——這是總指揮交辦的「依職缺看」，跟上面全站總覽是兩種不同
    // 的問題（「這個職缺最近怎麼樣」vs「整體業務量」），不硬塞在同一組數字裡。
    if (scopeSlug !== 'all') {
      return `${selector}
${views.opsJobFunnelTrend(d._jobTrend?.funnel)}
${views.opsJobHitRateTrend(d._jobTrend?.hitRateTrend)}`;
    }
    const kpi = d?.kpi || {};
    const gran = d?._gran || 'week';
    const trend = gran === 'month' ? d.monthly : d.weekly;
    const applicants = trend?.applicants || [];
    const interviews = trend?.interviews || [];
    // 兩條線要對齊同一組 bucket（月或週），應徵/面談哪個月份沒資料就補 0，
    // 不然畫出來兩條線的點數對不起來，會斜著連錯。
    const buckets = [...new Set([...applicants.map((p) => p.bucket), ...interviews.map((p) => p.bucket)])].sort();
    const fill = (rows) => buckets.map((b) => ({ bucket: b, n: (rows.find((r) => r.bucket === b) || {}).n || 0 }));
    const series = [
      { label: '應徵人數', color: '#2a78d6', points: fill(applicants) },
      { label: '阿財面談人數', color: '#eb6834', points: fill(interviews) },
    ];
    return `<div class="kpi-grid">
${views.opsKpiTile('累計應徵', kpi.allTime?.applicants ?? '—', null)}
${views.opsKpiTile('累計面談', kpi.allTime?.interviews ?? '—', null)}
${views.opsKpiTile('本月應徵／面談', `${kpi.thisMonth?.applicants ?? 0} / ${kpi.thisMonth?.interviews ?? 0}`, null)}
${views.opsKpiTile('本週（至今）應徵／面談', `${kpi.thisWeek?.applicants ?? 0} / ${kpi.thisWeek?.interviews ?? 0}`, null)}
</div>
<p class="help">上週整週（${text(kpi.lastWeekLabel || '')}）：應徵 ${kpi.lastWeek?.applicants ?? 0} 人・面談 ${kpi.lastWeek?.interviews ?? 0} 人——跟「本週至今」不是同一種比法（一個是整週、一個是到今天為止），僅供對照。</p>
<div class="card">
<div class="card-head"><h2>阿財面談趨勢</h2>
<div class="filters" style="margin:0"><select id="ops-granularity">
<option value="week"${gran === 'week' ? ' selected' : ''}>依週（週一起算）</option>
<option value="month"${gran === 'month' ? ' selected' : ''}>依月</option>
</select></div></div>
${views.opsTrendLine(series)}
</div>
${selector}
${views.opsAllJobsFunnelBar(d._jobs)}`;
  },

  // 營運數據依職缺看（2026-09-24，總指揮交辦）：「全部」或某個職缺的下拉，
  // 跟卡片牆／漏斗表共用同一份 jobs 陣列（已經排除 unspecified），不用
  // 另外打一支 API 列職缺。
  opsJobScopeSelector: (jobs, scopeSlug) => {
    const opts = (jobs || []).filter((j) => j.status === 'open')
      .sort((a, b) => String(a.title).localeCompare(String(b.title)))
      .map((j) => `<option value="${text(j.slug)}"${scopeSlug === j.slug ? ' selected' : ''}>${text(j.title)}</option>`).join('');
    return `<div class="filters" style="margin-top:14px">
<select id="ops-job-scope"><option value="all"${scopeSlug === 'all' ? ' selected' : ''}>全部職缺</option>${opts}</select>
</div>`;
  },

  // 「全部」時的橫向長條圖：每個職缺的阿財面談人數，右邊標命中率（總指揮
  // 交辦）。沿用漏斗表格同一套 .funnel-chart／.fnrow／.track／.bar／.lb／.vn
  // （跟舊版漏斗橫條圖同一套視覺語言），單一藍色＝單一種量（人數），不是
  // 分類色，不用另外驗色盤。已排除 unspecified，依阿財面談人數由多到少排序。
  opsAllJobsFunnelBar: (jobs) => {
    const rows = (jobs || []).filter((j) => j.slug !== 'unspecified' && (j.interviewed_n || 0) > 0);
    if (!rows.length) return '<div class="notice" style="margin-top:14px">還沒有職缺累積到阿財面談的資料。</div>';
    const sorted = [...rows].sort((a, b) => (b.interviewed_n || 0) - (a.interviewed_n || 0));
    const max = Math.max(1, ...sorted.map((j) => j.interviewed_n || 0));
    const pct1 = (v) => (v === null || v === undefined) ? '—' : `${Math.round(v * 100)}%`;
    return `<div class="card" style="margin-top:14px">
<h2>每個職缺的阿財面談人數</h2>
<div class="funnel-chart" style="margin-top:10px">
${sorted.map((j) => {
    const n = j.interviewed_n || 0;
    const w = Math.max(2, Math.round(n / max * 100));
    const rate = (j.settled_n || 0) ? `${pct1(j.accuracy_rate)}（樣本${j.settled_n}）` : '—';
    return `<div class="fnrow"><div class="lb" title="${text(j.title)}">${text(j.title)}</div>
<div class="track"><span class="bar" style="width:${w}%"></span></div>
<div class="vn" style="width:auto;white-space:nowrap">${n}人｜${rate}</div></div>`;
  }).join('')}
</div>
</div>`;
  },

  // 選了某個職缺：四條線的每週漏斗（阿財面談／送客戶／客戶面試／錄取，
  // 同一個 Y 軸），跟下面另一張命中率趨勢分開畫（總指揮交辦：不要雙 y 軸——
  // 命中率是百分比、人數是計數，兩種量級混在一張圖只會互相看不清楚）。
  // 顏色用 dataviz 技能包驗證過的分類色盤前四格（藍/橘/青/黃，固定順序，
  // `node scripts/validate_palette.js "#2a78d6,#eb6834,#1baf7a,#eda100" --mode light`
  // 全部 PASS），青／黃兩色對白底對比不足，靠端點直接標數字＋圖例文字
  // 補救（relief rule），不是只靠顏色分辨。
  opsJobFunnelTrend: (funnel) => {
    const f = funnel || {};
    const buckets = [...new Set([
      ...(f.interviewed || []).map((p) => p.bucket), ...(f.submitted || []).map((p) => p.bucket),
      ...(f.clientInterviewed || []).map((p) => p.bucket), ...(f.hired || []).map((p) => p.bucket),
    ])].sort();
    if (!buckets.length) return '<div class="notice">這個職缺還沒有面談紀錄可以畫趨勢。</div>';
    const fill = (rows) => buckets.map((b) => ({ bucket: b, n: (rows || []).find((r) => r.bucket === b)?.n || 0 }));
    const series = [
      { label: '阿財面談', color: '#2a78d6', points: fill(f.interviewed) },
      { label: '送客戶', color: '#eb6834', points: fill(f.submitted) },
      { label: '客戶面試', color: '#1baf7a', points: fill(f.clientInterviewed) },
      { label: '錄取', color: '#eda100', points: fill(f.hired) },
    ];
    return `<div class="card" style="margin-top:14px"><h2>每週漏斗</h2>${views.opsTrendLine(series)}</div>`;
  },

  // 命中率趨勢：資料來自 job_card_snapshots（總指揮交辦，2026-09-24）。
  // 命中率是「阿財那次評的等第」跟「後來有沒有錄取」對出來的結果，沒辦法
  // 回頭幫某一週重算「當時」的命中率（系統沒存那週的報告等第歷史）——
  // 只能靠往後每週寫一次快照慢慢累積，樣本不足 3 筆就老實講「還在累積」，
  // 不要硬畫一條只有一兩個點、看起來像趨勢其實只是雜訊的線。
  opsJobHitRateTrend: (hitRateTrend) => {
    const rows = hitRateTrend || [];
    if (rows.length < 3) {
      return `<div class="card" style="margin-top:14px"><h2>命中率趨勢</h2>
<div class="notice">累積中，已記錄 ${rows.length} 週——至少累積 3 週快照才會畫趨勢線，太少筆數畫出來像趨勢，其實只是雜訊。</div></div>`;
    }
    const series = [{
      label: '命中率', color: '#2a78d6',
      points: rows.map((r) => ({ bucket: r.snapshot_date, n: Math.round((r.accuracy_rate || 0) * 100) })),
    }];
    return `<div class="card" style="margin-top:14px"><h2>命中率趨勢</h2>${views.opsTrendLine(series)}</div>`;
  },

  // 「待配對人選」（2026-09-24，總指揮交辦）：job_slug='unspecified' 不是
  // 真職缺，是還沒配對到職缺的人選暫存桶——後端已經排除 duplicate／測試
  // 資料，這裡只負責顯示跟指派表單。jobOptions 直接用卡片牆本來就撈好的
  // 職缺清單（已排除 unspecified 本身），不用另外打一支 API 列職缺。
  jobCardUnmatchedSection: (candidates, jobOptions) => {
    const list = candidates || [];
    if (!list.length) return '';
    const opts = (jobOptions || []).filter((j) => j.status === 'open')
      .sort((a, b) => String(a.title).localeCompare(String(b.title)))
      .map((j) => `<option value="${text(j.slug)}">${text(j.title)}</option>`).join('');
    return `<details class="card jc-unmatched" style="margin-bottom:14px" open>
<summary style="cursor:pointer;font-weight:700">待配對人選（${list.length}）</summary>
<div class="list" style="margin-top:10px;display:grid;gap:9px">
${list.map((c) => `<div class="list-row jc-unmatched-row">
<span><b>${text(c.name)}</b><small>${text(c.one_liner || '（還沒有阿財摘要）')} · ${text((c.created_at || '').slice(0, 10))}</small></span>
<span class="actions-row" style="flex-wrap:wrap">
<select class="jc-unmatched-job-select" data-app-id="${text(c.id)}"><option value="">選職缺…</option>${opts}</select>
<button type="button" class="btn sm primary" data-action="reassign-unmatched" data-app-id="${text(c.id)}">指派</button>
</span>
</div>`).join('')}
</div>
</details>`;
  },

  jobCardWallTab: (jobs, statusFilter = 'open', clientKey = 'all', unmatched = []) => {
    jobs = jobs || [];
    const tier = (j) => {
      if (j.status !== 'open') return 3;
      if ((j.low_score_hires || 0) > 0) return 0;
      if (j.level === null || j.level === undefined || j.level <= 2) return 1;
      return 2;
    };
    const ckey = (j) => j.company_id || `name:${j.client_name || ''}`;
    const byClient = (j) => clientKey === 'all' || ckey(j) === clientKey;
    const byStatus = (j) => {
      if (statusFilter === 'all') return true;
      if (statusFilter === 'needs') return j.status === 'open' && tier(j) <= 1;
      // 2026-09-24 加（總指揮交辦）：只看「已經送出去給客戶」的職缺——
      // submitted_n 由後端 recompute_profile() 算好，這裡只是篩選。
      if (statusFilter === 'has_submitted') return j.status === 'open' && (j.submitted_n || 0) > 0;
      return j.status === 'open'; // 'open'
    };

    const clientScope = jobs.filter(byStatus);
    const clientCounts = new Map();
    clientScope.forEach((j) => {
      const k = ckey(j);
      const cur = clientCounts.get(k) || { label: views.jobCardClientLabel(j.client_name, 24), n: 0 };
      cur.n += 1;
      clientCounts.set(k, cur);
    });
    const clientOptions = [...clientCounts.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label));

    const statusScope = jobs.filter(byClient);
    const openN = statusScope.filter((j) => j.status === 'open').length;
    const needsN = statusScope.filter((j) => j.status === 'open' && tier(j) <= 1).length;
    const submittedN = statusScope.filter((j) => j.status === 'open' && (j.submitted_n || 0) > 0).length;
    const allN = statusScope.length;

    const finalList = jobs.filter((j) => byStatus(j) && byClient(j));
    const sorted = [...finalList].sort((a, b) => tier(a) - tier(b)
      || (a.xp_total || 0) - (b.xp_total || 0) || String(a.title).localeCompare(String(b.title)));

    return `${views.jobCardUnmatchedSection(unmatched, jobs)}
${views.jobCardFunnelTable(jobs.filter((j) => j.status === 'open'))}
<div class="filters" style="margin-bottom:14px;flex-wrap:wrap">
<select id="jobcard-filter">
<option value="open"${statusFilter === 'open' ? ' selected' : ''}>招募中（${openN}）</option>
<option value="needs"${statusFilter === 'needs' ? ' selected' : ''}>需要補回饋（${needsN}）</option>
<option value="has_submitted"${statusFilter === 'has_submitted' ? ' selected' : ''}>有推薦人選（${submittedN}）</option>
<option value="all"${statusFilter === 'all' ? ' selected' : ''}>含已關閉（${allN}）</option>
</select>
<select id="jobcard-client-filter">
<option value="all"${clientKey === 'all' ? ' selected' : ''}>全部客戶（${clientScope.length}）</option>
${clientOptions.map(([k, v]) => `<option value="${escapeHtml(k)}"${clientKey === k ? ' selected' : ''}>${text(v.label)}（${v.n}）</option>`).join('')}
</select>
</div>
${sorted.length ? `<div class="prompt-grid">${sorted.map((j) => views.jobCardWallItem(j)).join('')}</div>`
    : empty('沒有符合條件的職缺', '換個篩選條件看看。')}`;
  },

  jobCardPanel: (slug, card) => {
    const p = card && card.profile;
    const full = p && p.full_profile_json ? safeParseJson(p.full_profile_json) : null;
    const events = (card && card.events) || [];
    const importing = card && card.importing;
    return `${p ? views.jobCardLevelBar(p) : '<div class="notice">這個職缺還沒有職缺卡資料。匯入第一筆客戶回饋就會開始累積等級與判斷標準。</div>'}
${p ? views.jobCardAGradeLine(p) : ''}
${p ? views.jobCardBeforeAfter(p) : ''}
${views.jobCardLowScoreAlerts(events)}
<h3 style="margin-top:16px">這個職缺客戶重視什麼</h3>
${views.jobCardProfileGrid(full)}
<h3>匯入客戶回饋</h3>
${importing ? `<div class="notice">⏳ 有一筆回饋正在整理中（${text(importing)}），大約 1-2 分鐘，好了會自動更新，重新打開這個職缺卡就看得到。</div>` : (() => {
      const outstanding = views.jobCardOutstandingAlerts(events);
      return `
<form id="job-card-feedback-form" class="form-grid">
${outstanding.length ? `<label class="field span-2"><span>這筆是補哪位（選了的話，補完那張紅色提醒就會消失）</span>
<select name="application_id"><option value="">— 不指定，泛用的職缺判斷標準 —</option>
${outstanding.map((e) => `<option value="${text(e.application_id)}">${text(e.candidate_name || e.application_id)}（阿財評${text(e.grade)}卻錄取）</option>`).join('')}
</select></label>` : ''}
<label class="field span-2"><span>客戶回饋原文（貼上就好，不用先自己整理）</span><textarea name="text" rows="5" placeholder="例：這個王小姐我們主管聊完覺得不錯……"></textarea></label>
<label class="field span-2"><span>或傳一張截圖（跟文字擇一，也可以都給）</span><input type="file" name="image" accept="image/*"></label>
</form>
<button class="btn primary" data-action="submit-job-card-feedback" data-slug="${text(slug)}">確認匯入</button>
<p class="help">客戶名、薪資、內部評語只有你在這裡看得到；阿財面談時讀到的是已經濾過的乾淨版，不會有這些內容。</p>`;
    })()}
<h3 style="margin-top:20px">回饋與經驗值紀錄</h3>
${events.length ? events.map((e) => views.jobCardEventRow(e)).join('') : '<div class="notice">還沒有任何紀錄。</div>'}`;
  },

  // 「阿財的理解」（2026-09-24，Jacky 交辦）：顧問確認阿財理解得對不對、
  // 面談會問什麼。⚠️ 這裡顯示的每一個字都來自後端快照（本機
  // interview_daemon.py／job_card.py 算好存的），前端不做任何加工、
  // 不猜、不補——顯示的就是阿財實際讀到的東西，跟面談是同一份資料。
  // 每一區旁邊的「這裡不對」用 data-jump-tab／data-jump-route 告訴 app.js
  // 要跳去哪裡修正，實際切換邏輯統一在 wireJobAcai() 處理。
  jobAcaiJumpBtn: (label, jumpTab, jumpRoute) => `<button type="button" class="btn ghost sm"
    ${jumpTab ? `data-jump-tab="${text(jumpTab)}"` : ''}${jumpRoute ? ` data-jump-route="${text(jumpRoute)}"` : ''}
    style="margin-top:6px">${text(label)}</button>`,

  jobAcaiPanel: (slug, payload) => {
    const view = payload && payload.view;
    if (!view) {
      return `<div class="notice">${text((payload && payload.message) || '這個職缺還沒有「阿財的理解」快照，等下一輪自動重算，或先去「面談題庫」「必要條件」補資料再回來看。')}</div>`;
    }
    const f = view.fields || {};
    // 2026-10-03：面談層級（決定阿財問多深）＋做事風格題
    const sc = (payload && payload.screen) || null;
    const TIER = { basic: '基層服務', pro: '一般專業', manager: '中階主管', exec: '高階主管' };
    const screenHtml = sc ? `<div class="card" style="padding:12px 14px;margin:0 0 12px">
      <b>面談層級：${text(TIER[sc.tier] || '未判斷')}</b>${sc.v2 ? ' <span class="badge success">新版阿財試跑中</span>' : ''}
      <p class="help" style="margin:4px 0 8px">${text(sc.reason || '')}${sc.by && sc.by !== 'AI' ? `（${text(sc.by)} 改過）` : '（AI 判斷）'}——層級越高，阿財問得越深（慰留、薪資含股票、驗證成就數字、職涯方向）；基層服務只問核心。</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <select data-screen-tier="${escapeHtml(slug)}" aria-label="面談層級" style="min-height:40px">${Object.entries(TIER).map(([k, v]) => `<option value="${k}" ${sc.tier === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <button type="button" class="btn sm" data-screen-tier-save="${escapeHtml(slug)}">改層級</button>
      </div>
      ${(sc.workstyle || []).length ? `<p style="margin:10px 0 4px"><b>做事風格題（阿財會請他講實際遇過的一次）</b></p><ul style="margin:0;padding-left:18px">${sc.workstyle.map((w) => `<li><b>${text(w.name)}</b>：${text(w.q)}${w.fit_hint ? `<br><span class="help">${text(w.fit_hint)}</span>` : ''}</li>`).join('')}</ul>` : ''}
    </div>` : '';
    const introLines = [
      f.client_intro ? `<p>${text(f.client_intro)}</p>` : '',
      `<p class="help">地點：${text(f.locations || '未填')} ・ 型態：${text(f.employment || '未填')} ・ 團隊：${text(f.team_size || '未填')}</p>`,
      `<p class="help">面談：${text(f.interview_rounds || '—')} 輪 ・ ${text(f.interview_who || '未指定對象')} ${f.has_test && f.has_test !== '否' ? `・ 有測驗（${text(f.has_test)}）` : ''}</p>`,
      f.onboard_by ? `<p class="help">客戶希望到職日：${text(f.onboard_by)}</p>` : '',
    ].filter(Boolean).join('');

    const blockerRow = (b) => `<li>${b.critical ? '🚨 ' : ''}${text(b.item)}${b.ask ? `<br><span class="help">問法：${text(b.ask)}</span>` : ''}</li>`;
    const hardHtml = `${f.must_skills ? `<p><b>必備技能／條件：</b>${text(f.must_skills)}</p>` : ''}
${(view.blockers_critical || []).length ? `<p><b>到職障礙（不過就不推薦）：</b></p><ul>${view.blockers_critical.map(blockerRow).join('')}</ul>` : ''}
${!f.must_skills && !(view.blockers_critical || []).length ? '<p class="help">這個職缺目前沒有設定硬條件／到職障礙。</p>' : ''}`;
    const softHtml = `${(view.blockers_soft || []).length ? `<ul>${view.blockers_soft.map(blockerRow).join('')}</ul>` : ''}
${view.talking_points ? `<p><b>這個職缺怎麼推銷：</b>${text(view.talking_points)}</p>` : ''}
${!(view.blockers_soft || []).length && !view.talking_points ? '<p class="help">沒有額外的軟性條件或推銷重點。</p>' : ''}`;

    const qs = view.questions || [];
    const qGroups = [...new Set(qs.map((x) => x.group))];
    const qRow = (x) => `<li>${x.critical ? '🚨 ' : ''}${x.kind ? `[${text(x.kind)}] ` : ''}${text(x.q)}
${x.why ? `<br><span class="help">在確認：${text(x.why)}</span>` : ''}</li>`;
    const qShown = qs.slice(0, 8);
    const qRest = qs.slice(8);
    const qHtml = qGroups.map((g) => {
      const items = qShown.filter((x) => x.group === g);
      return items.length ? `<p><b>${text(g)}</b></p><ul>${items.map(qRow).join('')}</ul>` : '';
    }).join('') + (qRest.length
      ? `<details><summary class="help" style="cursor:pointer">還有 ${qRest.length} 題（點開看全部）</summary><ul>${qRest.map(qRow).join('')}</ul></details>`
      : '') + (qs.length ? `<p class="help">${text(view.questions_note || '')}</p>` : '<p class="help">還沒有面談題庫，阿財目前只問到職障礙與通用題。</p>');

    return `${screenHtml}<p class="help">最後更新：${text(payload.updated_at || '—')}——這是阿財面談前實際會讀到的內容，不是另外生的摘要。</p>

<h3>這個職缺在做什麼</h3>
${introLines}
${views.jobAcaiJumpBtn('這裡不對 → 改職缺內容', 'manage')}

<h3 style="margin-top:18px">必要條件・硬條件（不符合就不推薦）</h3>
${hardHtml}
${views.jobAcaiJumpBtn('這裡不對 → 去必要條件分頁', null, 'checks')}

<h3 style="margin-top:18px">必要條件・軟條件／加分</h3>
${softHtml}

<h3 style="margin-top:18px">阿財面談會問這些（共 ${qs.length} 題）</h3>
${qHtml}
${views.jobAcaiJumpBtn('這題不對／想加一題 → 去面談題庫', 'expertise')}

<h3 style="margin-top:18px">客戶真正重視的（來自職缺卡）</h3>
${view.job_card_summary ? `<pre style="white-space:pre-wrap;font-family:inherit;font-size:13px;margin:0">${text(view.job_card_summary)}</pre>` : '<p class="help">這個職缺卡還沒有累積任何客戶回饋。</p>'}
${views.jobAcaiJumpBtn('補一筆回饋 → 去職缺卡', 'card')}

<h3 style="margin-top:18px">阿財不會講、不能講的</h3>
<ul>${(view.redactions || []).map((r) => `<li>${text(r)}</li>`).join('')}</ul>
${view.confidential_client ? '<p class="help">⚠️ 這個職缺標了「客戶保密」，上面客戶名稱那一欄阿財看得到（面談內部判斷要用），但規則會擋住不讓他講給候選人聽——確認擋住的規則有沒有列在這裡。</p>' : ''}`;
  },

  // 2026-09-15 改：批次區只留 assign-owner（唯一後端真的支援多筆 ids 的動作，見
  // actions.js 的說明）；狀態／邀請應徵／履歷連結改成每一筆自己的操作，因為後端只認
  // 單一 id，放在批次區之前點了會 400。另外加一顆真的會建立 application 的「轉入正式
  // 應徵（顧問建檔）」——呼叫的是跟「＋新增人選」同一支後端（doManualForward，
  // source_kind:'sourced'），跟上面「邀請應徵」（寄連結讓本人自己填）是兩條不同的路：
  // 這位聯絡得到但懶得自己填表單，顧問直接幫他建檔用這顆；聯絡到但想讓他自己填，
  // 用「邀請應徵」寄連結。
  // 2026-09-15 加連結：`/admin/sourced` 其實一直都有回傳 linkedin_url／github_url／
  // source_url（舊版顧問後台今天才發現同一批欄位漏接，見顧問人選追蹤那邊的修法），
  // 這裡從一開始就沒接進畫面——人才池列表完全看不到 LinkedIn／Cake 連結，顧問要
  // 接觸一個人得自己去猜網址。照同一套判斷：LinkedIn 給結構化按鈕，其他平台
  // （Cake／GitHub）用 source_url 當通用「來源」連結，兩者不重複顯示同一個網址。
  sourcedLink: (i) => {
    const li = i.linkedin_url ? `<a class="btn ghost sm" href="${escapeHtml(i.linkedin_url)}" target="_blank" rel="noopener">LinkedIn</a>` : '';
    const other = i.source_url && i.source_url !== i.linkedin_url ? `<a class="btn ghost sm" href="${escapeHtml(i.source_url)}" target="_blank" rel="noopener">${text(i.source || '來源')}連結</a>` : (i.github_url ? `<a class="btn ghost sm" href="${escapeHtml(i.github_url)}" target="_blank" rel="noopener">GitHub</a>` : '');
    return li + other;
  },
  sourcedTab: (items) => `<div class="bulk-bar"><span id="sourced-count">已選 0 筆</span>${actionBtn('指派負責顧問','sourced-assign-owner',{ bulk: true })}</div>${list(items, (i) => `<article class="list-row"><input type="checkbox" class="row-check" data-sourced-id="${text(i.id)}"><span><b>${text(i.name)}</b><small>${text(i.title || i.headline)} · ${text(i.source)}</small></span>${statusBadge(i.status)}${views.sourcedLink(i)}${rowActions([
    `<button type="button" class="btn primary sm" data-sc-action="open" data-sourced-id="${escapeHtml(i.id)}" data-sc-job="${escapeHtml(i.job_slug || '')}">看資料卡${i.email ? '・寄信' : ''}</button>`,
    views.sourcedListMailBtn(i),
    `<button type="button" class="btn ghost sm" data-action="open-convert-sourced" data-sourced-id="${text(i.id)}">轉入正式應徵（顧問建檔）</button>`,
    actionBtn('邀請應徵（寄連結給本人填）','sourced-invite',{ idParams: { id: i.id } }),
    actionBtn('更新狀態','sourced-status',{ idParams: { id: i.id } }),
    actionBtn('上傳履歷連結','sourced-resume',{ idParams: { id: i.id } }),
    actionBtn('編輯','sourced-update',{ idParams: { id: i.id }, record: i }),
  ])}</article>`)}`,
  interviews: (tab='live') => pageHead('AI 阿財面談中心','監看真實對話、狀態與活動時間；不顯示不存在的題號、Phase 或輸入訊號。','<button class="btn" data-action="refresh">重新整理</button>') + tabbar('interviews',[['live','進行中'],['paused','暫停／待回來'],['done','已完成'],['errors','報告異常']],tab) + `<div class="master-detail"><aside id="page-data">${endpointState('面談清單')}</aside><article class="card" id="detail-data">${empty('請選擇一場面談','桌機會在右側顯示；手機會開啟全螢幕內容。')}</article></div>`,
  interviewRows: (items) => list(items, (i) => `<button class="session-row" data-session="${text(i.application_id || i.id)}"><span><b>${text(i.candidate_name || i.name)}</b><small>${text(i.job_title || i.job)}</small></span>${hostBadge(i.interview_host)}${statusBadge(i.interview_state || i.state)}<small>${text(i.last_at || i.updated_at)}</small></button>`),
  // 2026-09-22 改兩層 tab：9 個平排太多，收成 4 大類（發文／成效／回覆／設定），
  // 各自底下才展開小 tab。葉 key 不變（today/workbench/schedule/analytics/threads/
  // conversion/replies/content/accounts），loadSocialTab 完全沿用。
  social: (tab='today') => pageHead('社群營運','預設進「今日話題」；統計 queue 一律以大 limit 讀取。','<button class="btn primary" data-action="social-request">建立發文需求</button>') + groupedTabbar('social', [
    ['發文', [['today', '今日話題'], ['workbench', '一鍵發文'], ['schedule', '排程']]],
    ['成效', [['analytics', '成效總覽'], ['threads', 'Threads 成效'], ['import', '手動匯入貼文']]],
    ['回覆', [['replies', '職缺社群回覆']]],
    // 2026-09-23 改：原本「內容庫／Prompt」一頁擠兩欄（話題＋公式），兩邊都只剩
    // 一半寬度，公式名稱長一點就折三行。拆成兩個小 tab，各自用整個版面排卡片。
    // 舊的 content 這個 key 仍然收得到（見 app.js），舊書籤不會壞。
    ['設定', [['topics', '話題 Prompt'], ['formulas', '公式'], ['accounts', '帳號']]],
  ], tab) + `<div id="page-data">${endpointState('社群資料')}</div>`,

  // ── 今日話題（2026-09-22 新增）──
  // 每天早上 topic_research_tick.py 生 10 題菜單（企業端 5＋求職端 5）。
  // 顧問在這裡挑一題、指定一位顧問的口吻，按下去就走既有的一鍵發文流程
  // （/admin/social-post-request 帶 topic_id + account_id）→ 產稿 → TG 審核。
  // 舊的「系統每天自動挑 1 題直接發」已經關掉，發不發由顧問在這裡決定。
  topicsTodayView: ({ date, empty, enterprise, jobseeker, accounts, styles }) => {
    // 平台 / 顧問 / 公式的選項，存成一份 JSON 給彈窗用（每張卡共用同一份）。
    const platforms = [...new Set((accounts || []).map((a) => a.platform).filter(Boolean))];
    const pickerData = JSON.stringify({
      accounts: (accounts || []).map((a) => ({ id: a.id, label: a.label || a.consultant_name || a.id, platform: a.platform || '' })),
      styles: (styles || []).filter((s) => s.subtype === 'dialog' || s.subtype === 'pure')
        .sort((a, b) => (b.favs || []).length - (a.favs || []).length)
        .map((s) => ({ id: s.id, name: `${(s.favs || []).length ? `⭐${s.favs.length} ` : ''}${s.name}`, subtype: s.subtype })),
      platforms,
    });
    const card = (t) => `<article class="card topic-pick ${t.picked ? 'is-picked' : ''}" data-topic-id="${escapeHtml(t.id)}" style="margin-bottom:12px">
        <div style="font-weight:600;font-size:14px;line-height:1.5;margin-bottom:6px">${escapeHtml(t.name)}</div>
        <div class="help" style="white-space:pre-wrap;margin-bottom:10px">${escapeHtml(t.body || '')}</div>
        ${t.picked
          ? `<button type="button" class="badge success topic-picked-btn" style="border:none;cursor:pointer" data-topic-id="${escapeHtml(t.id)}">已排入產稿 ×${(t.picks || []).length}｜看誰發過</button><script type="application/json" class="topic-picks-data" data-for="${escapeHtml(t.id)}">${JSON.stringify(t.picks || [])}</script>`
          : ''}
        <div style="margin-top:8px">
          <button type="button" class="btn primary topic-open" data-topic-id="${escapeHtml(t.id)}" data-topic-name="${escapeHtml(t.name)}">選這則來發</button>
        </div>
      </article>`;
    const col = (title, hint, arr) => `<article class="card span-1" style="background:transparent;border:none;padding:0">
        <h2 style="font-size:15px;margin:0 0 4px">${title}</h2>
        <p class="help" style="margin:0 0 10px">${hint}</p>
        ${(arr || []).length ? (arr).map(card).join('') : empty ? '' : '<p class="help">今天這一側還沒有題目。</p>'}
      </article>`;
    const tpe = (off) => new Date(Date.now() + 8 * 3600e3 - off * 86400e3).toISOString().slice(0, 10);
    const dayOpts = Array.from({ length: 14 }, (_, i) => tpe(i)).map((d, i) =>
      `<option value="${i === 0 ? '' : d}" ${(date || tpe(0)) === d ? 'selected' : ''}>${i === 0 ? `今天（${d}）` : i === 1 ? `昨天（${d}）` : d}</option>`).join('');
    return `<script type="application/json" id="topic-picker-data">${pickerData}</script>
      <label class="field" style="max-width:260px;margin:0 0 10px"><span>看哪一天的菜單（舊的都會留著）</span><select id="tp-date">${dayOpts}</select></label>
      <p class="help" style="margin:0 0 14px">${date ? date + '　' : ''}每天早上自動生 10 題（企業端 5／求職端 5）。挑一題按「選這則來發」，接著選平台、顧問、公式，最後按產生草稿——1～2 分鐘後到 Telegram 審核，<b>在那邊按確認才會真的發</b>。</p>
      ${empty ? `<article class="card"><p class="help" style="margin:0">今天的話題菜單還沒生出來。<br>菜單每天早上 8:30 由話題研究排程自動產生；如果你剛部署或想馬上要，可以手動跑一次 <code>topic_research_tick.py</code>。</p></article>`
        : `<div class="dashboard-grid">${col('🏢 企業端', '說給在找人的老闆／HR 聽', enterprise)}${col('🙋 求職端', '說給在看機會的求職者聽', jobseeker)}</div>`}`;
  },

  // 今日話題挑題彈窗：選平台 → 顧問（依平台過濾）→ 公式 → 產生草稿。
  topicPickerBody: () => `<div class="drawer-section">
      <label class="field"><span>發文平台</span>
        <select id="tp-channel"><option value="">全部平台</option></select></label>
      <label class="field"><span>指定哪位顧問的口吻</span>
        <select id="tp-account"><option value="">請選擇…</option></select></label>
      <label class="field"><span>用哪個公式（不選＝顧問預設語氣）</span>
        <select id="tp-style"><option value="">原始格式（顧問預設語氣）</option></select></label>
      <div id="tp-msg" class="help" style="margin-top:6px"></div>
    </div>`,
  // /admin/social-post-queue 真實主鍵是 queue_id（不是 id），狀態欄位是 social_post_status
  // （不是 status），顧問/帳號顯示欄位是 account_label（不是 consultant_name/account_name）。
  // 這三個欄位錯了會讓取消／重新通知／排程全部對不到正確的貼文，先前一直是壞的。
  // 2026-09-15 補：/admin/link-clicks-by-account、/admin/line-insight、/admin/social/coverage
  // 三支其實早就被 adapters.social() 讀進來了，但畫面上完全沒用到，一直顯示假的「待接」。
  // link-clicks-by-account 是累計總點擊（不是趨勢線，誠實標「累計」）；line-insight 是 LINE OA
  // 快照；coverage.gaps 是「哪個帳號還有幾個職缺沒發過」的真實覆蓋率缺口，比原本畫的假漏斗更有用。
  // 唯一真的沒有的是「跨貼文/LINE/應徵單逐日趨勢線」，這塊仍是誠實佔位。
  socialData: ({ queue, accounts, clicks, line, coverage, trend }) => `<div class="kpi-grid"><article class="kpi"><span>讀取貼文筆數</span><strong>${queue.length}</strong><small>limit=500；非完整歷史時不冒充全量</small></article><article class="kpi"><span>社群帳號</span><strong>${accounts.length}</strong></article><article class="kpi"><span>LINE OA 好友數</span><strong>${text(line?.followers ?? '—')}</strong><small>可觸及 ${text(line?.reachable ?? '—')}</small></article><article class="kpi"><span>LINE OA 封鎖數</span><strong>${text(line?.blocks ?? '—')}</strong></article></div><div class="dashboard-grid"><article class="card"><h2>各帳號累計點擊數</h2><p class="help">累計總數，不是趨勢線；逐日/週趨勢仍需唯讀 aggregate API。</p>${list((clicks?.accounts || []).slice(0, 12), (a) => `<div class="list-row"><span><b>${text(a.label)}</b><small>${text(a.platform)}</small></span><b>${text(a.clicks)}</b><small>留言 ${text(a.reply_clicks)}</small></div>`)}</article><article class="card"><h2>覆蓋率缺口（近 ${text(coverage?.days ?? 30)} 天，依帳號）</h2><p class="help">還沒發過的職缺數；不是完整跨表歸因漏斗。</p>${list((coverage?.gaps || []).slice(0, 12), (g) => `<div class="list-row"><span><b>${text(g.label)}</b><small>${text(g.platform)}</small></span><span class="badge ${g.missing > 0 ? 'warning' : 'success'}">未發 ${text(g.missing)}</span><small>已發 ${text(g.posted)}</small></div>`)}</article><article class="card span-2"><h2>發文佇列</h2>${list(queue.slice(0,30), (q) => `<div class="list-row"><span><b>${text(q.title || q.content_formula || q.slug)}</b><small>${text(q.account_label)} · ${text(q.scheduled_at || q.posted_at)}</small></span>${statusBadge(q.social_post_status)}${rowActions([actionBtn('重新通知審核','social-renotify',{ idParams: { id: q.queue_id } })])}</div>`)}</article></div>${trend?.reason ? `<p class="help">${text(trend.reason)}</p>` : ''}`,
  // ── 一鍵發文（2026-09-22 從舊版 /consultant-beta/social-post 搬過來）──
  //
  // 新版原本這一頁只是一個清單加一顆「取消」，**根本不能發文**——而這是
  // 顧問每天用最多次的頁面。舊版的流程是：選類型 → 選帳號 → （職缺文再選
  // 寫法與職缺／話題文選話題）→ 可選排程時間 → 排入產稿。
  //
  // ⚠️ 兩個從舊版帶過來、不能省的設計：
  //   ① 時間用「時」「分」兩個下拉，24 小時制，**不要用 <input type="time">**。
  //      那個在某些瀏覽器／系統語系會顯示 12 小時制（上午／下午）。真實事故：
  //      Jacky 排「12 點」被記成「上午 12:00」（半夜），排程因為時間已過
  //      直接立刻觸發，不是等到中午。
  //   ② 按下去之後按鈕**不自動解鎖**。產稿要 1–2 分鐘才會出現在 Telegram，
  //      顧問以為沒反應就一直按——2026-09-03 真的排出 7 份一樣的草稿。
  //      要換職缺或換帳號才會重新亮起來。
  // 2026-10-01 Jacky：「選擇職缺可以改成先選客戶下拉選單，再選職缺嗎？不要用分組的」。
  // 客戶選單換了，職缺選單才換成那家的職缺（app.js 的 .job-client-pick 監聽）。
  // 職缺下拉保留原本的 id／name，送出的程式不用改。
  // ⚠️ status 'open' 跟 'active' 意思一樣（歷史遺留），兩個都要列——只認 open 的時候，
  //    私人招待所兩個 VIP 職缺、主管特助從 9/18 起就在一鍵發文選單裡消失了。
  clientJobPicker: (jobs, { selectAttr, label = '選擇職缺', socialOnly = false } = {}) => {
    // socialOnly：一鍵發文才列「🔒 未簽約客戶職缺」（2026-10-07，只發社群，不上官網）
    const okStatus = socialOnly ? ['open', 'active', 'social_only'] : ['open', 'active'];
    const live = (jobs || []).filter((j) => okStatus.includes(String(j.status || 'open')) && j.slug !== 'unspecified');
    const byClient = {};
    live.forEach((j) => {
      const so = j.status === 'social_only';
      const k = so ? `🔒 未簽約客戶職缺｜${j.social_only_company || ''}` : (j.company_display_name || j.client_name || '（未綁客戶）');
      (byClient[k] = byClient[k] || []).push({ slug: j.slug, title: (jobCode(j.slug) ? `[${jobCode(j.slug)}] ` : '') + (so ? `🔒 ${j.title || j.slug}（未簽約客戶職缺・只發社群）` : (j.title || j.slug)) });
    });
    const keys = Object.keys(byClient).sort((a, b) => a.localeCompare(b, 'zh-Hant'));
    return `<label class="field"><span>先選客戶</span>
          <select class="job-client-pick" data-jobs="${escapeHtml(JSON.stringify(byClient))}"><option value="">請選擇客戶…</option>${keys.map((k) =>
            `<option value="${escapeHtml(k)}">${escapeHtml(k)}（${byClient[k].length}）</option>`).join('')}</select></label>
        <label class="field"><span>${escapeHtml(label)}</span>
          <select ${selectAttr} disabled><option value="">先選上面的客戶</option></select></label>`;
  },
  socialComposer: ({ accounts, jobs, styles, topics }) => {
    const favN = (x) => (x.favs || []).length;
    const favLabel = (x) => `${favN(x) ? `⭐${favN(x)} ` : ''}${x.name}`;
    const dialog = (styles || []).filter((x) => x.subtype === 'dialog').sort((a, b) => favN(b) - favN(a));
    // ⚠️ 「純CTA型」也要送 style_id，不能只送一個 way='pure'——後端不認那個參數，
    //    會被當成「沒選公式」＝原始格式。2026-09-22 Jacky 實測抓到：他選純CTA型，
    //    TG 通知跟產出來的文案卻都是原始格式。
    // 2026-09-24 起純CTA型底下也可以有多個公式（原始那個＋誘因型），跟對話討論型一樣給下拉選。
    const pures = (styles || []).filter((x) => x.subtype === 'pure').sort((a, b) => favN(b) - favN(a) || a.id - b.id);
    const hours = Array.from({ length: 24 }, (_, h) => `<option value="${String(h).padStart(2, '0')}">${String(h).padStart(2, '0')} 時</option>`).join('');
    const mins = Array.from({ length: 12 }, (_, i) => `<option value="${String(i * 5).padStart(2, '0')}">${String(i * 5).padStart(2, '0')} 分</option>`).join('');
    return `<article class="card">
      <div class="card-head"><h2 style="margin:0;font-size:15px">一鍵發文</h2></div>
      <p class="help" style="margin:6px 0 14px">選職缺、選帳號，按下去會<b>排入產稿</b>——本機腳本每 2 分鐘掃一次，抓到就用 AI 產一則草稿推到 Telegram「社群發文審核」。<b>你在那邊按確認發布才會真的貼出去</b>，這裡按下去不會直接發文。</p>

      <label class="field"><span>這篇是哪一種？</span>
        <select id="sc-type">
          <option value="job">📋 職缺文</option>
          <option value="general">💼 時事話題文</option>
          <option value="ai">🤖 AI 阿財話題</option>
          <option value="anon">🙈 匿名人選文</option>
        </select></label>

      <!-- 2026-09-22 加管道下拉：帳號有 22 個（Threads 12／LinkedIn 9／LINE 社群 1），
           一長串很難找自己那個。先選管道就只剩該管道的帳號。
           ⚠️ 只是過濾顯示，送出去的還是 account_id，後端完全不用改。 -->
      <label class="field"><span>發文管道</span>
        <select id="sc-channel">
          <option value="">全部管道</option>
          <option value="threads">Threads（${(accounts || []).filter((a) => a.platform === 'threads').length}）</option>
          <option value="linkedin">LinkedIn（${(accounts || []).filter((a) => a.platform === 'linkedin').length}）</option>
          <option value="line_community">LINE 社群（${(accounts || []).filter((a) => a.platform === 'line_community').length}）</option>
        </select></label>

      <label class="field"><span>發文帳號</span>
        <select id="sc-account"><option value="">請選擇…</option>${(accounts || []).map((a) =>
          `<option value="${escapeHtml(a.id)}" data-platform="${escapeHtml(a.platform || '')}">${escapeHtml(a.label || a.consultant_name || a.id)}</option>`).join('')}</select></label>

      <div id="sc-job-only">
        <label class="field"><span>職缺文要用哪一種寫法？</span>
          <select id="sc-way">
            <option value="pure">純CTA型</option>
            <option value="dialog">對話討論型</option>
            <option value="default">原始格式（照顧問自己的格式，附 LINE 連結）</option>
          </select></label>
        <label class="field" id="sc-pstyle-wrap" hidden><span>純CTA型要用哪個公式？</span>
          <select id="sc-pstyle">${pures.map((x) =>
            `<option value="${escapeHtml(x.id)}">${escapeHtml(favLabel(x))}</option>`).join('')}</select></label>
        <label class="field" id="sc-style-wrap" hidden><span>選擇要用哪個公式（全站共用）</span>
          <select id="sc-style"><option value="">請選擇…</option>${dialog.map((x) =>
            `<option value="${escapeHtml(x.id)}">${escapeHtml(favLabel(x))}</option>`).join('')}</select></label>
        ${views.clientJobPicker(jobs, { selectAttr: 'id="sc-job"', label: '再選職缺（招募中＋🔒 未簽約客戶職缺）', socialOnly: true })}
        <p class="help" style="margin:4px 0 0">🔒 未簽約客戶職缺＝開發中、還沒簽約的公司：貼文不寫公司名、沒有應徵連結，結尾放你的 LINE 或私訊。</p>
      </div>

      <div id="sc-topic-only" hidden>
        <label class="field"><span>選擇話題</span>
          <select id="sc-topic"><option value="">請選擇…</option></select></label>
        <!-- 2026-10-01 Jacky：時事話題文也要能選公式。跟「今日話題」挑題視窗同一套：不選＝顧問預設語氣 -->
        <label class="field"><span>用哪個公式？（不選＝顧問平常的語氣）</span>
          <select id="sc-tstyle"><option value="">原始格式（顧問預設語氣）</option>${[...dialog, ...pures].map((x) =>
            `<option value="${escapeHtml(x.id)}">${escapeHtml(favLabel(x))}（${x.subtype === 'pure' ? '純CTA型' : '對話討論型'}）</option>`).join('')}</select></label>
        <p class="help" style="margin:4px 0 0">列的是這個分類底下全部的話題。⚠️ 2026-09-11 Jacky 拿掉了「顧問指派」那道關卡——新增任何話題，全站顧問都能直接選，不用先去設定頁勾。</p>
        <script type="application/json" id="sc-topics-data">${JSON.stringify((topics || []).map((t) => ({ id: t.id, name: t.name || t.title, category: t.category })))}</script>
      </div>

      <div id="sc-anon-only" hidden>
        <label class="field"><span>找人選（打姓名、職稱或負責顧問）</span>
          <input type="search" id="sc-anon-q" placeholder="例：周亦宣、財務、Phoebe" autocomplete="off"></label>
        <label class="field"><span>選擇人選</span>
          <select id="sc-anon-app"><option value="">先在上面搜尋…</option></select></label>
        <label class="field"><span>用哪個版本？</span>
          <select id="sc-astyle">${(styles || []).filter((x) => x.subtype === 'anon').sort((a, b) => (/B 版/.test(b.name) ? 1 : 0) - (/B 版/.test(a.name) ? 1 : 0)).map((x) =>
            `<option value="${escapeHtml(x.id)}">${escapeHtml(x.name)}</option>`).join('')}</select></label>
        <p class="help" style="margin:4px 0 0">人選<b>還沒同意</b>匿名推薦 → 一律用 B 版（只談「市場上這類人才」）。人選<b>已經同意</b>才能選 A 版（可以寫「手上接觸到一位」）。</p>
        <p class="help" style="margin:4px 0 0">會拿這位人選的阿財報告（沒有就用履歷）照公式寫給企業主看，名字、待過的公司、學校都不會出現；出現的話系統會自動擋下重產。一樣送 Telegram 審核，你按確認才會發。</p>
      </div>

      <label class="field"><span>排程時間（留空＝立刻排入產稿）</span>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <input type="date" id="sc-date" style="max-width:170px">
          <select id="sc-hour" style="max-width:110px"><option value="">時</option>${hours}</select>
          <select id="sc-min" style="max-width:110px"><option value="">分</option>${mins}</select>
        </div></label>
      <p class="help" id="sc-preview" style="margin:4px 0 0"></p>

      <button type="button" class="btn primary" id="sc-go" style="margin-top:14px">排入產稿</button>
      <div id="sc-msg" style="margin-top:8px"></div>
    </article>`;
  },

  // ── 職缺社群回覆（2026-09-22 從舊版搬過來，新版完全沒有）──
  //
  // 用途：候選人在職缺的社群貼文下留言問，顧問要私訊回。這裡是每個職缺
  // 預先產好的「第一輪職缺摘要」，選好自己是哪位顧問，複製貼上就能用。
  // 內容跟顧問無關，**只有結尾的 LINE 連結因人而異**。
  //
  // ⚠️ 複製出來的連結不是顧問真正的 LINE 連結，是轉址頁（ctx=reply）——
  //    候選人點了會記一筆點擊（誰、哪個職缺、從私訊回覆來的），成效儀表板
  //    才看得到「這則回覆真的換到人加 LINE 了嗎」。跟貼文 CTA 連結
  //    （ctx=post）分開算，不會互相混淆歸因。這個不要改成直接貼 line_link。
  socialRepliesTab: ({ jobs, accounts }) => {
    // 2026-10-07 Jacky：「回覆欄找不到 Threads」「沒有南南的」。原本一個帳號一行（Threads、LinkedIn 各一行、連停用的都列），
    // 看起來像平台選單。回覆文字跟平台無關、只有結尾 LINE 連結因人而異 → 改成一位顧問一行，只看在用的帳號，
    // 用他有設 LINE 連結的那個帳號（Threads 優先）；都沒設的列出來但不能選，提示要補。
    const active = (accounts || []).filter((a) => Number(a.is_active) !== 0 && a.platform !== 'line_community');
    const byName = new Map();
    active.forEach((a) => {
      const name = a.consultant_name || a.label || String(a.id);
      const cur = byName.get(name);
      const score = (x) => (x.line_link ? 2 : 0) + (x.platform === 'threads' ? 1 : 0);
      if (!cur || score(a) > score(cur)) byName.set(name, a);
    });
    const people = [...byName.entries()].sort((x, y) => x[0].localeCompare(y[0]));
    const noLine = people.filter(([, a]) => !a.line_link).map(([n]) => n);
    const withLine = people.filter(([, a]) => a.line_link).map(([, a]) => a);
    const clients = [...new Set((jobs || []).map((j) => j.client_name).filter(Boolean))].sort();
    return `<article class="card">
      <div class="card-head"><h2 style="margin:0;font-size:15px">職缺社群回覆</h2></div>
      <p class="help" style="margin:6px 0 12px">候選人在貼文下留言問，你要私訊回——這裡是每個職缺預先產好的「第一輪職缺摘要」，選好你是哪位顧問，複製貼上就能用。結尾的連結會自動換成你自己的加好友連結。</p>
      <div class="filters">
        <select id="cs-account"><option value="">我是哪位顧問？</option>${people.map(([n, a]) => a.line_link
          ? `<option value="${escapeHtml(a.id)}" data-person="${escapeHtml(n)}">${escapeHtml(n)}</option>`
          : `<option value="" disabled>${escapeHtml(n)}（還沒設 LINE 連結）</option>`).join('')}</select>
        <select id="cs-client"><option value="">所有客戶</option>${clients.map((c) =>
          `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}</select>
        <input type="search" id="cs-search" placeholder="搜尋職稱或客戶">
      </div>
      <p class="help" style="margin:4px 0 0">Threads、LinkedIn 回覆用同一份文字，選你的名字就好。</p>
      ${noLine.length ? `<p class="help">⚠️ ${escapeHtml(noLine.join('、'))} 還沒設定 LINE 加好友連結，暫時不能選——到「設定 → 帳號」補上就能用。</p>` : ''}
      <div id="cs-list">${(jobs || []).length ? '' : '<div class="state"><strong>還沒有任何職缺的摘要</strong><p>摘要是排程（candidate_summary_tick.py）產的，還沒跑到就會是空的。</p></div>'}</div>
    </article>`;
  },

  socialReplyCards: (jobs) => (jobs.length ? jobs.map((j, i) => `<article class="card" style="margin-top:10px">
      <div class="card-head"><h3 style="margin:0;font-size:14px">${text(j.title || j.slug)}<span class="muted" style="font-weight:400"> ${text(j.client_name || '')}</span></h3></div>
      <div style="white-space:pre-wrap;font-size:13.5px;background:#f6f8fb;border-radius:10px;padding:12px 14px;margin:8px 0;max-height:220px;overflow-y:auto">${text(j.summary_text)}</div>
      <button type="button" class="btn primary" style="width:100%" data-action="cs-copy" data-i="${i}">📋 複製回覆文字（含 LINE 連結）</button>
    </article>`).join('') : '<div class="state"><strong>沒有符合篩選條件的職缺</strong></div>'),

  // ── Threads 個別成效（2026-09-22 從舊版搬過來，新版完全沒有）──
  //
  // 這一頁回答的是「**哪種寫法有用**」——每位顧問各自的已發布貼文，
  // 看得到每一則用了哪種寫法、拿到多少瀏覽。
  // ⚠️ 只列 Threads。LinkedIn 沒有公開成效 API，抓不到數據，列了只會是
  //    一排空白，讓人以為成效是零。
  // ⚠️ 平均瀏覽的分母只算**有抓到數據**的那幾篇，不是全部篇數——剛發還沒
  //    回填 views 的算進分母會把平均拉低，看起來像成效變差。
  // 2026-09-29 Jacky 改版：Threads 成效頁分三塊
  //  ① 每位顧問一張卡（追蹤人數、總篇數、平均瀏覽／讚／留言／點擊），點開看逐篇＋公式＋發文時間
  //  ② 選一位顧問，比較「哪個時段 × 哪個公式」的瀏覽／讚／留言
  //  ③ 轉化：哪個公式、哪個時段帶來加入 LINE（目前轉化＝點貼文連結後加入 LINE；
  //     「加入後有詢問」要等 line_inbound_log 累積，9/29 才開始記）
  // 平均數會被單篇爆文拉高，卡片上另外標中間值；格子裡篇數太少的反灰，不要拿來下結論。
  threadsPerf: {
    SLOTS: [['早上 6–11 點', 6, 11], ['中午 11–14 點', 11, 14], ['下午 14–18 點', 14, 18], ['晚上 18–22 點', 18, 22], ['深夜 22–6 點', 22, 30]],
    slotOf(posted) {
      const h = Number(String(posted || '').slice(11, 13));
      if (Number.isNaN(h)) return '—';
      const hh = h < 6 ? h + 24 : h;
      const f = views.threadsPerf.SLOTS.find(([, a, b]) => hh >= a && hh < b);
      return f ? f[0] : '—';
    },
    formulaOf(r) {
      if (r.style_name) return r.style_name;
      return { pure: '純CTA型（未標公式）', dialog: '對話討論型（未標公式）', default: '原始格式' }[r.content_formula] || '未標公式';
    },
    who(r) { return r.consultant_name || r.account_label || '未知'; },
    n(v) { return Number(v || 0); },
    avg(rows, k) { const v = rows.map((r) => Number(r[k] || 0)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; },
    med(rows, k) { const v = rows.map((r) => Number(r[k] || 0)).sort((a, b) => a - b); if (!v.length) return 0; const m = Math.floor(v.length / 2); return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; },
    fmt(x, d = 0) { return Number(x || 0).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }); },
  },

  socialThreadsTab: ({ queue, followers, joins }) => {
    const T = views.threadsPerf;
    const posts = (queue || []).filter((r) => r.social_post_status === 'posted'
      && (r.account_platform === 'threads' || String(r.social_post_url || '').includes('threads')));
    if (!posts.length) return empty('還沒有已發布的 Threads 貼文');
    const fol = {};
    (followers || []).forEach((f) => { fol[f.account_id] = f; });
    const jn = {};
    (joins || []).forEach((j) => { jn[j.account_id] = j; });
    const byWho = {};
    posts.forEach((r) => { (byWho[T.who(r)] = byWho[T.who(r)] || []).push(r); });
    const people = Object.entries(byWho).sort((a, b) => b[1].length - a[1].length);

    const card = ([name, rows]) => {
      const accIds = [...new Set(rows.map((r) => r.account_id).filter(Boolean))];
      const f = accIds.map((id) => fol[id]).find(Boolean);
      const grow = f && f.followers_7d_ago != null ? f.followers - f.followers_7d_ago : null;
      const sorted = rows.slice().sort((a, b) => String(b.posted_at || '').localeCompare(String(a.posted_at || '')));
      // 加入 LINE 用帳號層級的數字（含留言區連結帶來、對不到哪一篇的）
      const jRows = accIds.map((id) => jn[id]).filter(Boolean);
      const lineAdds = jRows.length ? jRows.reduce((a, j) => a + T.n(j.joins), 0) : rows.reduce((a, r) => a + T.n(r.line_adds), 0);
      const noPost = jRows.reduce((a, j) => a + T.n(j.joins_no_post), 0);
      return `<details class="tp-card">
        <summary>
          <div class="tp-head"><b>${text(name)}</b>
            <span class="tp-fol">${f ? `追蹤 ${T.fmt(f.followers)}${grow != null ? `<small class="${grow >= 0 ? 'up' : 'down'}">（7 天 ${grow >= 0 ? '+' : ''}${grow}）</small>` : ''}` : '<small>追蹤人數：還沒抓到</small>'}</span></div>
          <div class="tp-stats">
            <span><small>總篇數</small><b>${rows.length}</b></span>
            <span><small>平均瀏覽</small><b>${T.fmt(T.avg(rows, 'views'))}</b><small>中間值 ${T.fmt(T.med(rows, 'views'))}</small></span>
            <span><small>平均讚</small><b>${T.fmt(T.avg(rows, 'likes'), 1)}</b></span>
            <span><small>平均留言</small><b>${T.fmt(T.avg(rows, 'replies'), 1)}</b></span>
            <span><small>平均點擊</small><b>${T.fmt(T.avg(rows, 'clicks'), 1)}</b></span>
            <span><small>加入 LINE</small><b>${lineAdds}</b>${noPost ? `<small>${noPost} 位來自留言區連結</small>` : ''}</span>
          </div>
          <span class="tp-more">點開看每一篇 ▾</span>
        </summary>
        <div class="table-wrap"><table class="spec tp-table">
          <tr><th>發文時間</th><th>公式</th><th class="num">瀏覽</th><th class="num">讚</th><th class="num">留言</th><th class="num">點擊</th><th class="num">加入LINE</th><th></th></tr>
          ${sorted.map((r) => `<tr><td>${text(String(r.posted_at || '').slice(5, 16))}<small class="tp-slot">${text(T.slotOf(r.posted_at))}</small></td>
            <td>${text(T.formulaOf(r))}</td><td class="num">${T.fmt(r.views)}</td><td class="num">${T.n(r.likes)}</td>
            <td class="num">${T.n(r.replies)}</td><td class="num">${T.n(r.clicks)}</td><td class="num">${T.n(r.line_adds)}</td>
            <td>${r.social_post_url ? `<a href="${escapeHtml(r.social_post_url)}" target="_blank" rel="noopener">看貼文</a>` : ''}</td></tr>`).join('')}
        </table></div>
      </details>`;
    };

    const names = people.map(([n]) => n);
    const dataJson = JSON.stringify(posts.map((r) => ({ w: T.who(r), f: T.formulaOf(r), s: T.slotOf(r.posted_at),
      v: T.n(r.views), l: T.n(r.likes), r: T.n(r.replies), c: T.n(r.clicks), j: T.n(r.line_adds) })));
    // 表格版：一位顧問一列，點列一樣展開逐篇（共用 card() 裡的逐篇表）
    const trow = ([name, rows]) => {
      const accIds = [...new Set(rows.map((r) => r.account_id).filter(Boolean))];
      const f = accIds.map((id) => fol[id]).find(Boolean);
      const jRows = accIds.map((id) => jn[id]).filter(Boolean);
      const adds = jRows.length ? jRows.reduce((a, j) => a + T.n(j.joins), 0) : rows.reduce((a, r) => a + T.n(r.line_adds), 0);
      // data-v：排序用的原始數字（畫面上的字有千分位、小字中間值，不能直接比）
      return `<tr class="tp-trow" data-who="${escapeHtml(name)}" tabindex="0" aria-expanded="false"><td data-v="${escapeHtml(name)}"><span class="tp-caret" aria-hidden="true">▸</span><b>${text(name)}</b></td>
        <td class="num" data-v="${f ? f.followers : -1}">${f ? T.fmt(f.followers) : '—'}</td><td class="num" data-v="${rows.length}">${rows.length}</td>
        <td class="num" data-v="${T.avg(rows, 'views')}">${T.fmt(T.avg(rows, 'views'))}<small>中 ${T.fmt(T.med(rows, 'views'))}</small></td>
        <td class="num" data-v="${T.avg(rows, 'likes')}">${T.fmt(T.avg(rows, 'likes'), 1)}</td><td class="num" data-v="${T.avg(rows, 'replies')}">${T.fmt(T.avg(rows, 'replies'), 1)}</td>
        <td class="num" data-v="${T.avg(rows, 'clicks')}">${T.fmt(T.avg(rows, 'clicks'), 1)}</td><td class="num" data-v="${adds}">${adds}</td></tr>`;
    };
    let mode = 'card';
    try { mode = localStorage.getItem('s1ne_tp_mode') || 'card'; } catch { /* 無痕 */ }
    return `<article class="card"><div class="card-head"><h2 style="margin:0;font-size:16px">① 每位顧問</h2>
          <div class="tp-toggle" role="group" aria-label="顯示方式">
            <button type="button" class="chip${mode === 'card' ? ' active' : ''}" data-tp-mode="card" aria-pressed="${mode === 'card'}">卡片</button>
            <button type="button" class="chip${mode === 'table' ? ' active' : ''}" data-tp-mode="table" aria-pressed="${mode === 'table'}">表格</button>
          </div></div>
        <p class="help" style="margin:6px 0 12px">點卡片（或表格的一列）展開每一篇。平均會被單篇爆文拉高，旁邊的「中間值」比較代表平常一篇的水準。追蹤人數每天早上記一次。</p>
        <div class="tp-grid" data-tp-view="card"${mode === 'card' ? '' : ' hidden'}>${people.map(card).join('')}</div>
        <div data-tp-view="table"${mode === 'table' ? '' : ' hidden'}><span class="tp-swipe-hint">← 左右滑動看其他欄位 →</span><div class="table-wrap"><table class="spec tp-sum">
          <tr>${['顧問', '追蹤', '總篇數', '平均瀏覽', '平均讚', '平均留言', '平均點擊', '加入 LINE'].map((h, i) =>
            `<th class="${i ? 'num ' : ''}tp-sort"><button type="button" data-sort-col="${i}">${h}<span class="tp-arrow" aria-hidden="true"></span></button></th>`).join('')}</tr>
          ${people.map(trow).join('')}</table></div>
          </div></article>

      <article class="card" style="margin-top:12px"><div class="card-head"><h2 style="margin:0;font-size:16px">② 哪個時段 × 哪個公式比較好</h2></div>
        <div class="tp-controls">
          <label class="field"><span>顧問</span><select id="tp-who"><option value="">全部顧問</option>${names.map((n) => `<option>${text(n)}</option>`).join('')}</select></label>
          <label class="field"><span>看哪個數字</span><select id="tp-metric"><option value="v">平均瀏覽</option><option value="l">平均讚</option><option value="r">平均留言</option></select></label>
        </div>
        <span class="tp-swipe-hint">← 左右滑動看其他時段 →</span><div id="tp-heat"></div>
        <p class="help">格子越深代表越好；小字是篇數。<b>少於 3 篇的格子反灰</b>，樣本太少，先不要拿來下結論。</p></article>

      <article class="card" style="margin-top:12px"><div class="card-head"><h2 style="margin:0;font-size:16px">③ 統計圖：哪個公式、哪個時段比較好</h2></div>
        <p class="help" style="margin:6px 0 12px">跟著上面②選的顧問一起變。公式只列 3 篇以上的，篇數太少的先不放。</p>
        <div class="tp-charts">
          <figure class="tp-fig"><figcaption>依公式：平均瀏覽 vs 平均留言</figcaption><div class="tp-cv"><canvas id="tp-ch-fv"></canvas></div></figure>
          <figure class="tp-fig"><figcaption>依時段：平均瀏覽 vs 平均留言</figcaption><div class="tp-cv"><canvas id="tp-ch-sv"></canvas></div></figure>
          <figure class="tp-fig"><figcaption>依公式：帶來幾人加入 LINE（顏色＝哪位顧問）</figcaption><div class="tp-cv"><canvas id="tp-ch-fj"></canvas></div></figure>
          <figure class="tp-fig"><figcaption>依時段：帶來幾人加入 LINE（顏色＝哪位顧問）</figcaption><div class="tp-cv"><canvas id="tp-ch-sj"></canvas></div></figure>
        </div>
      </article>

      <article class="card" style="margin-top:12px"><div class="card-head"><h2 style="margin:0;font-size:16px">轉化明細：哪個公式、哪個時段帶來加入 LINE</h2></div>
        <p class="help" style="margin:6px 0 12px">目前「轉化」＝有人點了貼文裡的連結、接著加入 LINE 官方帳號。從「職缺社群回覆」（回覆貼文底下留言的人）連結加入的，歸到同一位顧問、同一個職缺當時最近發的那一篇。「加入後有沒有詢問」9/29 才開始記，累積 3～4 週後會換成那個定義。數字還很少，先看方向就好。</p>
        <div class="tp-two"><div><h3 class="tp-h3">依公式</h3><div id="tp-conv-f"></div></div><div><h3 class="tp-h3">依時段</h3><div id="tp-conv-s"></div></div></div>
      </article>
      <script type="application/json" id="tp-data">${dataJson.replace(/</g, '\\u003c')}</script>`;
  },

  // ② 熱力圖與 ③ 轉化長條，由 app.js 的 wireThreadsPerf() 依下拉選單重畫。
  threadsHeat: (rows, metric) => {
    const T = views.threadsPerf;
    const slots = T.SLOTS.map(([s]) => s);
    const forms = [...new Set(rows.map((r) => r.f))].sort();
    if (!forms.length) return '<p class="help">這位顧問還沒有貼文。</p>';
    const cell = (f, s) => rows.filter((r) => r.f === f && r.s === s);
    const vals = forms.flatMap((f) => slots.map((s) => { const c = cell(f, s); return c.length >= 3 ? c.reduce((a, r) => a + r[metric], 0) / c.length : null; })).filter((x) => x != null);
    const max = Math.max(1, ...vals);
    return `<div class="table-wrap"><table class="tp-heat"><tr><th>公式＼時段</th>${slots.map((s) => `<th>${s}</th>`).join('')}</tr>
      ${forms.map((f) => `<tr><th class="tp-fname">${text(f)}</th>${slots.map((s) => {
        const c = cell(f, s);
        if (!c.length) return '<td class="tp-empty">—</td>';
        const a = c.reduce((x, r) => x + r[metric], 0) / c.length;
        if (c.length < 3) return `<td class="tp-few"><b>${T.fmt(a, metric === 'v' ? 0 : 1)}</b><small>${c.length} 篇</small></td>`;
        const alpha = 0.12 + 0.78 * (a / max);
        return `<td style="background:rgba(40,103,237,${alpha.toFixed(2)});color:${alpha > 0.55 ? '#fff' : 'inherit'}"><b>${T.fmt(a, metric === 'v' ? 0 : 1)}</b><small>${c.length} 篇</small></td>`;
      }).join('')}</tr>`).join('')}</table></div>`;
  },

  threadsConvBars: (rows, key) => {
    const groups = {};
    rows.forEach((r) => { const g = groups[r[key]] = groups[r[key]] || { j: 0, c: 0, n: 0, who: {} }; g.j += r.j; g.c += r.c; g.n += 1; if (r.j) g.who[r.w] = (g.who[r.w] || 0) + r.j; });
    const list = Object.entries(groups).sort((a, b) => b[1].j - a[1].j || b[1].c - a[1].c);
    const max = Math.max(1, ...list.map(([, g]) => g.j));
    return list.map(([k, g]) => `<div class="tp-bar"><div class="tp-bar-top"><span>${text(k)}</span><b>${g.j} 人加入</b></div>
      <div class="tp-track"><div class="tp-fill" style="width:${(g.j / max) * 100}%"></div></div>
      <small>${g.n} 篇・${g.c} 次點擊${Object.keys(g.who).length ? '・來自 ' + Object.entries(g.who).sort((a, b) => b[1] - a[1]).map(([w, n]) => `${text(w)} ${n}`).join('、') : ''}</small></div>`).join('') || '<p class="help">還沒有資料。</p>';
  },

  // 2026-10-01 加：顧問反映「看不出哪篇貼文帶來今天的應徵者、也看不到發文
  // 時間」，排隊列表原本只有標題＋狀態。現在每一則貼文（用 queue_id 區分，
  // 同一位顧問同一天發同一個職缺好幾次時才分得出是哪一篇）都帶出：
  //   發文時間（MM/DD HH:mm）、點擊數、加LINE好友數、歸因到的應徵人數、
  //   貼文連結。表現好的（有加LINE好友或有應徵，不是憑感覺排名）額外給一顆
  // 「用這篇的寫法再排一則」——只帶寫法（way／公式／篇幅這些貼文本身的
  // 屬性），帳號跟職缺仍然要顧問自己選，不要替他決定要對誰發。
  socialWorkbenchTab: (queue) => list(queue, (q) => {
    const posted = q.posted_at || q.social_post_at;
    const m = posted && String(posted).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
    const postedLabel = m ? `${m[2]}/${m[3]} ${m[4]}:${m[5]}` : (posted ? text(posted) : '尚未發出');
    const clicks = Number(q.clicks || 0), lineAdds = Number(q.line_adds || 0), applicants = Number(q.applicants_attributed || 0);
    const performsWell = lineAdds > 0 || applicants > 0;
    const stats = `<span class="badge">🖱 點擊 ${text(clicks)}</span><span class="badge">💬 加LINE ${text(lineAdds)}</span><span class="badge">📨 應徵 ${text(applicants)}</span>`;
    const viewLink = q.social_post_url ? `<a href="${escapeHtml(q.social_post_url)}" target="_blank" rel="noopener" class="btn ghost sm">看貼文</a>` : '';
    const btns = ['posted','skipped','expired'].includes(String(q.social_post_status)) ? [] : [actionBtn('取消','social-cancel',{ idParams: { id: q.queue_id } },'danger')];
    if (performsWell) {
      btns.unshift(`<button type="button" class="btn sm" data-action="social-repost-prefill"
        data-style-id="${escapeHtml(q.style_id || '')}" data-subtype="${escapeHtml(q.style_subtype || '')}"
        data-formula="${escapeHtml(q.content_formula || '')}"
        data-length="${escapeHtml(q.content_length || '')}" data-platform="${escapeHtml(q.account_platform || '')}"
        >用這篇的寫法再排一則</button>`);
    }
    return `<article class="list-row"><span><b>#${text(q.queue_id)}　${text(q.title || q.content_formula || q.slug)}</b>`
      + `<small>${text(q.account_label)} · 發文時間 ${postedLabel}</small><small>${stats}</small></span>`
      + `${statusBadge(q.social_post_status)}${viewLink}${rowActions(btns)}</article>`;
  }),
  // 排程行事曆——照抄舊版 consultant/social-post 的月曆邏輯（renderCal/renderKpi），
  // 只是搬進 SPA。「重複」定義：同一天、同一個職缺、**同一個顧問**發兩次以上；
  // 不同顧問同一天發同一個職缺是正常的（四個帳號一起推），不算重複——第一版把它
  // 算進去，整個月幾乎每天都紅，那種警告等於沒有警告。
  socialCalendarTab: ({ month, jobs, ev }) => {
    const [y, m] = month.split('-').map(Number);
    const evOn = (k) => ev.filter((e) => e.d === k);
    const dupKeysOn = (k) => { const c = {}; evOn(k).forEach((e) => { const kk = e.slug + '|' + e.label; c[kk] = (c[kk] || 0) + 1; }); return Object.keys(c).filter((x) => c[x] > 1); };
    const jobTitle = (slug) => (jobs.find((j) => j.slug === slug) || {}).title || slug;
    const short = (l) => String(l || '').split(/[-–—]/)[0].trim();
    const catColor = { job: '#2f5fd8', general: '#8a5a2b', ai: '#6b5a8f' };
    const first = new Date(y, m - 1, 1).getDay(), days = new Date(y, m, 0).getDate();
    const today = new Date().toISOString().slice(0, 10);
    let grid = ['日', '一', '二', '三', '四', '五', '六'].map((d) => `<div class="cal-dow">${d}</div>`).join('');
    for (let i = 0; i < first; i++) grid += '<div class="cal-day cal-pad"></div>';
    for (let d = 1; d <= days; d++) {
      const k = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const list = evOn(k), dups = dupKeysOn(k);
      const chips = list.slice(0, 2).map((e) => {
        const bad = dups.includes(e.slug + '|' + e.label);
        return `<div class="cal-chip ${bad ? 'dup' : ''}" title="${escapeHtml(short(e.label))}｜${escapeHtml(jobTitle(e.slug))}"><i style="background:${catColor[e.category] || catColor.job}"></i>${text(short(e.label)).slice(0, 6)}·${text(jobTitle(e.slug)).slice(0, 5)}</div>`;
      }).join('');
      grid += `<button type="button" class="cal-day${dups.length ? ' dup' : ''}${k === today ? ' today' : ''}" data-cal-day="${k}"><span class="cal-dn">${d}${dups.length ? ' ⚠️' : ''}${list.length ? `<b>${list.length}</b>` : ''}</span>${chips}${list.length > 2 ? `<small>+${list.length - 2}</small>` : ''}</button>`;
    }
    const inMonth = ev.filter((e) => e.d.startsWith(month));
    const dupDays = [...new Set(inMonth.map((e) => e.d))].filter((k) => dupKeysOn(k).length);
    const jobsPosted = new Set(inMonth.map((e) => e.slug));
    return `${pageHead(`${y} 年 ${m} 月`, '排程行事曆——點任一天可排入新的或看當天安排。', `<button class="btn" data-action="cal-prev">← 上個月</button><button class="btn" data-action="cal-next">下個月 →</button><button class="btn primary" data-action="cal-missing">還有哪些沒發</button>`)}<div class="kpi-grid"><article class="kpi"><span>這個月排／發的則數</span><strong>${text(inMonth.length)}</strong></article><article class="kpi ${dupDays.length ? 'warn' : ''}"><span>有人重複發同職缺的天數</span><strong>${text(dupDays.length)}</strong></article><article class="kpi"><span>這個月有露出的職缺</span><strong>${text(jobsPosted.size)} / ${text(jobs.length)}</strong></article><article class="kpi"><span>整個月一次都沒發的職缺</span><strong>${text(jobs.length - jobsPosted.size)}</strong></article></div><div class="cal-grid">${grid}</div>`;
  },
  // 「這一天」抽屜：當天安排＋建議引擎（選顧問看他這天發了什麼、還缺什麼）＋排一則新的。
  scheduleDayBody: ({ k, ev, accounts, jobs }) => {
    const evOn = (kk) => ev.filter((e) => e.d === kk);
    const jobTitle = (slug) => (jobs.find((j) => j.slug === slug) || {}).title || slug;
    const short = (l) => String(l || '').split(/[-–—]/)[0].trim();
    const dupKeysOn = (kk) => { const c = {}; evOn(kk).forEach((e) => { const key = e.slug + '|' + e.label; c[key] = (c[key] || 0) + 1; }); return Object.keys(c).filter((x) => c[x] > 1); };
    const isDup = (kk, e) => dupKeysOn(kk).includes(e.slug + '|' + e.label);
    const CAT_LABEL = { job: '📋 職缺文', general: '💼 時事話題文', ai: '🤖 AI阿財話題' };
    const list = evOn(k);
    const entryBadge = (e) => e.planned ? `<span class="badge info">已排程${e.t ? '・' + text(e.t) : ''}</span>` : (e.status === 'posted' ? '<span class="badge success">已發布</span>' : '<span class="badge neutral">草稿</span>');
    const rows = list.length ? list.map((e) => `<div class="list-row"><span><b>${text(short(e.label))}</b><small>${e.platform === 'linkedin' ? 'LinkedIn' : 'Threads'} · ${text(CAT_LABEL[e.category] || CAT_LABEL.job)}</small></span><span>${text(jobTitle(e.slug))}${isDup(k, e) ? ' <b style="color:var(--danger,#c0392b)">⚠️ 同一個人重複發</b>' : ''}</span>${entryBadge(e)}${e.planned ? actionBtn('移除', 'social-schedule-cancel', { idParams: { id: e.id } }, 'danger') : ''}</div>`).join('') : '<p class="muted">這一天還沒有安排。</p>';
    return `<div class="drawer-section"><h3>這一天的安排（${list.length}）</h3>${rows}<h3>選顧問，看他這天發了什麼</h3><select id="cal-suggest-acc"><option value="">選顧問（帳號）…</option>${accounts.map((a) => `<option value="${text(a.id)}">${text(a.label)} · ${a.platform === 'linkedin' ? 'LinkedIn' : 'Threads'}</option>`).join('')}</select><div id="cal-suggest-body" style="margin-top:11px"><p class="muted" style="margin:0;font-size:13.5px">先選上面的顧問，才知道他今天發了什麼、還缺什麼。</p></div><h3>排一則新的</h3><form id="cal-add-form" class="form-grid"><label class="field"><span>誰要發</span><select name="account_id" required><option value="">選帳號…</option>${accounts.map((a) => `<option value="${text(a.id)}">${text(a.label)}</option>`).join('')}</select></label><label class="field"><span>發哪個職缺</span><select name="job_slug" required><option value="">選職缺…</option>${jobs.map((j) => `<option value="${text(j.slug)}">${text(j.title)}</option>`).join('')}</select></label><label class="field"><span>幾點發（不填＝當天排程一跑到就送）</span><input type="time" name="post_time"></label></form><div id="cal-add-check"></div><button class="btn primary" data-action="cal-add-submit" data-day="${text(k)}">排入這一天</button></div>`;
  },
  // 建議引擎：選一個顧問，看他這天發了什麼、還缺什麼——近 14 天有人選在跟阿財
  // 面談的職缺排最前面（現在發文接得住人），比「這個月發過幾次」準。
  scheduleSuggestBody: ({ k, acc, ev, jobs, recentIv }) => {
    if (!acc) return '<p class="muted" style="margin:0;font-size:13.5px">先選上面的顧問，才知道他今天發了什麼、還缺什麼。</p>';
    const jobTitleOf = (slug) => (jobs.find((j) => j.slug === slug) || {}).title || slug;
    const evOn = (kk) => ev.filter((e) => e.d === kk);
    const mk = k.slice(0, 7);
    const mine = evOn(k).filter((e) => e.label === acc.label && e.platform === acc.platform);
    const doneSlugs = new Set(mine.map((e) => e.slug));
    const monthCnt = {}; jobs.forEach((j) => { monthCnt[j.slug] = 0; });
    ev.filter((e) => e.d.startsWith(mk)).forEach((e) => { if (monthCnt[e.slug] !== undefined) monthCnt[e.slug]++; });
    const todo = jobs.filter((j) => !doneSlugs.has(j.slug)).sort((a, b) => { const ia = recentIv[a.slug] || 0, ib = recentIv[b.slug] || 0; if (ia !== ib) return ib - ia; return monthCnt[a.slug] - monthCnt[b.slug]; });
    const hot = todo.filter((j) => recentIv[j.slug]).length;
    const never = todo.filter((j) => !monthCnt[j.slug]).length;
    let h = `<div class="help">今天已發（${mine.length}）</div>`;
    const mineBadge = (e) => e.planned ? '<span class="badge info">已排程</span>' : (e.status === 'posted' ? '<span class="badge success">已發布</span>' : '<span class="badge neutral">草稿</span>');
    h += mine.length ? mine.map((e) => `<div class="list-row"><span>${text(jobTitleOf(e.slug))}</span>${mineBadge(e)}</div>`).join('') : '<p class="muted" style="margin:0 0 4px;font-size:13px">今天還沒發任何一個。</p>';
    h += `<div class="help" style="margin-top:14px">還沒發（${todo.length}）</div>`;
    if (!todo.length) { h += '<p class="muted" style="margin:0;font-size:13px">全部職缺今天都幫他排過了。</p>'; }
    else {
      h += (hot ? `<p style="margin:-2px 0 8px;font-size:12.5px;color:var(--success,#1f6b34)">🔥 <b>${text(hot)}</b> 個這 14 天內有人選在跟阿財面談，排最前面——現在發文接得住他。</p>` : '')
        + (never ? `<p style="margin:-2px 0 8px;font-size:12.5px;color:var(--warning,#8a5a1a)">其中 <b>${text(never)}</b> 個這個月他一次都還沒發過。</p>` : '')
        + todo.slice(0, 12).map((j) => { const iv = recentIv[j.slug] || 0; const zero = !monthCnt[j.slug];
          return `<div class="list-row"><span>${iv ? '🔥 ' : (zero ? '◆ ' : '')}${text(j.title)}<br><small>${iv ? `這 14 天有 ${text(iv)} 位人選在跟阿財面談・` : ''}他這個月發過 ${text(monthCnt[j.slug])} 次</small></span><button type="button" class="btn sm primary" data-suggest-add="${escapeHtml(j.slug)}">補發</button></div>`;
        }).join('')
        + (todo.length > 12 ? `<p style="margin:8px 0 0;font-size:12.5px;color:var(--ink3,#8a8d95)">還有 ${text(todo.length - 12)} 個，用上面「排一則新的」自己選。</p>` : '');
    }
    return h;
  },
  // 「還有哪些沒發」彈窗：這個月一次都沒發的職缺，逐一或一次全部丟給自動排空檔
  // （findSlot 邏輯在 app.js，這裡只負責渲染跟接住點擊）。gaps 是 /admin/social/coverage
  // 算好的「每個帳號還差幾個職缺沒發」，跟月曆是同一件事的不同角度，放同一個彈窗省得
  // 使用者再開一頁。
  // gaps[].label 後端已經包含平台後綴（如「Anna Wu – LinkedIn」），不用再自己補一次
  // 「· LinkedIn」，不然會變成「Anna Wu – LinkedIn · LinkedIn」重複兩次。
  scheduleMissingBody: ({ missing, gaps }) => `<div class="drawer-section"><h3>每個帳號還差幾個職缺沒發</h3>${gaps && gaps.length ? `<div class="kpi-grid">${gaps.map((g) => `<article class="kpi ${g.missing > 0 ? 'warn' : ''}"><span>${text(g.label)}</span><strong>${text(g.missing)}</strong></article>`).join('')}</div>` : '<p class="muted">讀取中…</p>'}<h3>這個月一次都沒發過的職缺（${missing.length}）</h3>${missing.length ? `<button class="btn primary" data-action="cal-missing-all" style="margin-bottom:10px">一次把 ${text(missing.length)} 個全部排進空檔</button>${missing.map((j) => `<div class="list-row" data-missing-row="${escapeHtml(j.slug)}"><span>${text(j.title)}</span><button type="button" class="btn sm" data-missing-add="${escapeHtml(j.slug)}">自動排一則</button></div>`).join('')}` : '<p class="muted">全部都有發到 👍</p>'}<p class="help">自動排的規則：從明天起找空檔 → 挑這個月發最少的帳號（讓幾個人量平均）→ 挑那天排最少的日子（一天最多 4 則）→ 避開同一個人 7 天內剛發過的。排完還是可以點行事曆上那一天自己調。</p></div>`,
  // 2026-09-24：取代「招募轉換」。顧問自己在 App 上發的文，貼網址進來：
  //   ① 系統之後自動抓瀏覽／讚／留言（匯入 1 小時後第一次，之後每 12 小時抓到第 7 天）
  //   ② 可以順便（或之後）把這篇拆解成寫法公式
  // 問法順序跟「一鍵發文」一樣：哪一種 → 職缺文（寫法→公式→職缺）／話題文（選話題）。
  socialImportTab: ({ composer, imports }) => {
    const { accounts = [], jobs = [], styles = [], topics = [] } = composer || {};
    const threadsAcc = accounts.filter((a) => a.platform === 'threads' && a.is_active !== 0);
    const data = { styles: styles.map((s) => ({ id: s.id, name: s.name, subtype: s.subtype })),
      topics: topics.map((t) => ({ id: t.id, name: t.name || t.title, category: t.category })) };
    const num = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString());
    const EXT = {
      pending: ['拆解中…（1–3 分鐘）', ''],
      ready: ['看拆解結果', 'imp-ext-view'],
      saved: ['✅ 已存進公式庫', ''],
      failed: ['拆解失敗，再試一次', 'imp-ext-go'],
      dropped: ['🧩 再拆一次', 'imp-ext-go'],
    };
    const rowsHtml = (imports || []).map((r) => {
      const isTopic = String(r.job_slug || '').startsWith('💬');
      const way = isTopic ? ({ trust_building: 'AI阿財話題', engagement: '時事話題文', topic: '話題文' }[r.content_mission] || '話題文')
        : ({ pure: '純CTA型', dialog: '對話討論型', default: '原始格式' }[r.content_formula] || '未標記');
      const stats = r.insights_at
        ? `👁 ${num(r.views)}　♥ ${num(r.likes)}　💬 ${num(r.replies)}`
        : ((r.metrics_fail_count || 0) >= 3 ? '⚠️ 抓不到數據（貼文刪了或帳號授權失效）' : '等待抓數據（匯入 1 小時後開始抓）');
      const [extLabel, extAct] = EXT[r.ext_status] || ['🧩 拆解成公式', 'imp-ext-go'];
      const extBtn = extAct
        ? `<button type="button" class="btn ghost sm" data-imp-act="${extAct}" data-qid="${escapeHtml(r.id)}" data-ext="${escapeHtml(r.ext_id || '')}">${text(extLabel)}</button>`
        : `<span class="help">${text(extLabel)}</span>`;
      return `<article class="list-row"><span><b>${text(r.job_title || r.job_slug)}</b>
        <small>${text(r.account_label || '')} · ${text(way)}${r.style_name ? `・${text(r.style_name)}` : ''} · ${text(String(r.posted_at || '').slice(0, 16))}</small>
        <small>${stats}　<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">開貼文</a></small></span>
        <div class="row-actions">${extBtn}</div></article>`;
    }).join('');
    return `<div class="card"><h2>匯入顧問自己發的貼文</h2>
      <p class="help">顧問在 App 上直接發的文，貼網址進來，系統會自動抓瀏覽、讚、留言數，也可以把它拆解成寫法公式。跟在 TG 貼網址是同一件事。</p>
      <form id="imp-form" class="form-grid">
        <label class="field span-2"><span>貼文網址 ＊</span><input name="url" required placeholder="https://www.threads.com/@帳號/post/…（分享短網址也可以）"></label>
        <label class="field"><span>哪個帳號發的 ＊</span><select name="account_id" required><option value="">請選擇…</option>${threadsAcc.map((a) =>
          `<option value="${escapeHtml(a.id)}">${escapeHtml(a.label || a.consultant_name || a.id)}</option>`).join('')}</select></label>
        <div class="field span-2"><span>這篇是哪一種？ ＊</span>
          <!-- 2026-09-24 Jacky：話題文不要藏在下拉裡、看起來只有職缺文。第一層改成兩顆大按鈕，
               選話題文就只問種類跟話題，不用選寫法、不用選公式。 -->
          <div class="view-toggle" style="display:flex;gap:8px">
            <button type="button" class="btn" data-imp-kind="job" style="flex:1;min-height:44px">📋 職缺文</button>
            <button type="button" class="btn" data-imp-kind="topic" style="flex:1;min-height:44px">💬 話題文（不用選公式）</button>
          </div><input type="hidden" name="kind" value=""></div>
        <div id="imp-job" class="span-2 form-grid" hidden>
          <label class="field"><span>用哪一種寫法？</span><select name="formula"><option value="default">✍️ 顧問自己寫的（沒套公式）</option><option value="pure">純CTA型</option><option value="dialog">對話討論型</option></select></label>
          <label class="field" id="imp-style-wrap"><span>用哪個公式？</span><select name="style_id"></select></label>
          ${views.clientJobPicker(jobs, { selectAttr: 'name="job_slug"', label: '再選職缺' })}
        </div>
        <div id="imp-topic" class="span-2 form-grid" hidden>
          <label class="field span-2"><span>這篇在談什麼？ ＊</span><input name="topic_label" placeholder="一句話就好，例：面試後一直沒收到通知"></label>
        </div>
        <label class="span-2" style="display:flex;align-items:center;gap:10px;cursor:pointer;min-height:44px"><input type="checkbox" name="extract" style="width:20px;height:20px;min-height:0;margin:0;flex:none"><span>匯入後順便拆解成寫法公式（拆好也會推到該帳號的 TG 主題）</span></label>
        <div class="span-2"><button type="button" class="btn primary" id="imp-go">匯入</button></div>
      </form>
      <script type="application/json" id="imp-data">${JSON.stringify(data).replace(/</g, '\\u003c')}</script></div>
      <div class="card"><h2>已匯入的貼文（最近 60 篇）</h2>${rowsHtml ? `<div class="list">${rowsHtml}</div>` : empty('還沒有匯入的貼文', '上面貼網址就可以開始。')}</div>`;
  },
  // 拆解結果彈窗內容（跟 TG 版同樣的區塊）
  socialExtractionBody: (x) => {
    const r = x.result || {}; const a = r.analysis || {};
    const sec = (h, body) => body ? `<h3 style="margin:14px 0 4px">${text(h)}</h3><div>${body}</div>` : '';
    return `<div class="drawer-section">
      <p class="help">來源 @${text(x.source_author || '未知')}（${x.is_own ? '自家顧問' : '對標帳號'}）</p>
      ${sec('開場怎麼抓人', text(a.hook || ''))}
      ${sec('段落骨架', (a.structure || []).map((s, i) => `${i + 1}. ${text(s)}`).join('<br>'))}
      ${sec('語氣', text(a.tone || ''))}
      ${sec('用了哪些手法', (a.devices || []).map((d) => `・${text(d)}`).join('<br>'))}
      ${sec('結尾怎麼收', text(a.cta || ''))}
      ${sec('為什麼這樣寫會有人看', text(a.why_it_works || ''))}
      <form id="imp-save-form" class="form-grid" style="margin-top:16px">
        <label class="field"><span>公式名稱</span><input name="name" value="${escapeHtml(r.name || '')}"></label>
        <label class="field"><span>存到哪一類（AI 建議：${text({ dialog: '對話討論型', pure: '純CTA型', original: '原始格式' }[r.subtype_suggestion] || '對話討論型')}）</span>
          <select name="subtype">${[['dialog', '對話討論型'], ['pure', '純CTA型'], ['original', '原始格式（只留在內容庫）']].map(([k, l]) =>
            `<option value="${k}" ${k === (r.subtype_suggestion || 'dialog') ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </form>
      <details style="margin-top:10px"><summary>看完整寫作指令（${(r.prompt_body || '').length} 字）</summary><pre style="white-space:pre-wrap">${text(r.prompt_body || '')}</pre></details></div>`;
  },
  socialConversionTab: () => `<div class="card"><h2>記錄招募轉換</h2><p class="help">若後端尚無 undo endpoint，前端不做假的復原功能。</p>${actionBtn('記錄一筆轉換','conversion-record',{},'primary')}</div>`,
  // topic/style prompts 內容欄位是 body（不是 prompt/text）。
  // 2026-09-22 改：公式（寫法 Prompt）本來只能看不能改。Jacky 要能改名稱、
  // 改裡面的字。每一列改成可點，點了跳編輯彈窗（名稱／分類／內容／刪除）。
  // subtype：dialog=對話討論型、pure=純CTA型、original=原始格式、空=一般語氣。
  SUBTYPE_ZH: { dialog: '對話討論型', pure: '純CTA型', original: '原始格式', '': '一般語氣' },
  // 一張 Prompt 卡片。話題與公式共用同一個外型，差別只在右上角的標籤。
  promptCard: (t, cls, badge) => `<button type="button" class="prompt-card ${cls}" data-id="${text(t.id)}">
      <span class="pc-top"><b>${text(t.name)}</b>${badge}</span>
      <span class="pc-body">${text((t.body || '').replace(/[#*`>]/g, ' ').replace(/\s+/g, ' ').slice(0, 130))}</span>
    </button>`,

  socialTopicsTab: ({ topics }) => `<article class="card">
      <div class="card-head"><h2>話題 Prompt</h2>
        <button type="button" class="btn primary" data-topic-prompt-new>＋ 新增話題 Prompt</button></div>
      <p class="help" style="margin:6px 0 14px">點任一張卡片可編輯內容。共 ${(topics || []).length} 則。</p>
      ${(topics || []).length
        ? `<div class="prompt-grid">${topics.map((t) => views.promptCard(t, 'topic-prompt-edit', '<span class="badge">編輯</span>')).join('')}</div>`
        : empty('還沒有話題 Prompt', '按右上角新增一則。')}
      <script type="application/json" id="topic-prompts-data">${JSON.stringify((topics || []).map((t) => ({ id: t.id, name: t.name, body: t.body })))}</script>
    </article>`,

  // 2026-09-29 Jacky：顧問可以替公式按「我的最愛」＝顧問認證這個公式好用。
  // 認證多的排前面；一鍵發文／今日話題的公式下拉也會標 ⭐N 並排前面。
  // 「我是」存在瀏覽器（s1_fav_me，跟舊版同一個 key，切換過來不用重選）。
  socialFormulasTab: ({ styles, consultants }) => {
    let me = '';
    try { me = localStorage.getItem('s1_fav_me') || ''; } catch { /* 無痕模式 */ }
    const list = [...(styles || [])].sort((a, b) => (b.favs || []).length - (a.favs || []).length);
    return `<article class="card">
      <div class="card-head"><h2>公式（寫法 Prompt）</h2>
        <button type="button" class="btn primary" data-style-prompt-new>＋ 新增公式</button></div>
      <p class="help" style="margin:6px 0 10px">點任一張卡片可改名稱、改分類、改裡面的字。共 ${(styles || []).length} 則。
        只有標「對話討論型」的才會出現在今日話題／一鍵發文的公式清單裡。</p>
      <label class="field fav-me"><span>我是（按 ☆ 認證好用的公式）</span>
        <select id="fav-me"><option value="">請選擇…</option>${(consultants || []).map((n) =>
          `<option value="${text(n)}"${n === me ? ' selected' : ''}>${text(n)}</option>`).join('')}</select></label>
      ${list.length
        ? `<div class="prompt-grid">${list.map((t) => {
            const favs = t.favs || [];
            const mine = me && favs.includes(me);
            return `<div class="pc-fav-wrap">${views.promptCard(t, 'style-prompt-edit',
              `<span class="badge${t.subtype === 'dialog' ? ' info' : t.subtype ? '' : ' warning'}">${text(views.SUBTYPE_ZH[t.subtype || ''] || '一般語氣')}</span>`)}
              <button type="button" class="pc-fav${mine ? ' on' : ''}" data-fav-id="${text(t.id)}" aria-pressed="${mine ? 'true' : 'false'}"
                title="${favs.length ? text(favs.join('、')) + ' 認證' : '還沒有顧問認證'}">${mine ? '★' : '☆'} ${favs.length ? `${favs.length} 位顧問認證` : '認證這個公式'}</button></div>`;
          }).join('')}</div>`
        : empty('還沒有公式', '按右上角新增一則。')}
      <script type="application/json" id="style-prompts-data">${JSON.stringify((styles || []).map((t) => ({ id: t.id, name: t.name, body: t.body, subtype: t.subtype || '' })))}</script>
    </article>`;
  },

  // 公式編輯表單（放進彈窗）。新增時 s 傳空物件。
  stylePromptEditor: (s) => `<div class="drawer-section">
      <label class="field"><span>公式名稱</span>
        <input type="text" id="sp-name" value="${escapeHtml(s.name || '')}" maxlength="100" placeholder="例如：個人觀察型（版本C）"></label>
      <label class="field"><span>分類（決定它出現在哪個選單）</span>
        <select id="sp-subtype">
          <option value="dialog"${s.subtype === 'dialog' ? ' selected' : ''}>對話討論型（今日話題／一鍵發文選得到）</option>
          <option value="pure"${s.subtype === 'pure' ? ' selected' : ''}>純CTA型</option>
          <option value="original"${s.subtype === 'original' ? ' selected' : ''}>原始格式</option>
          <option value=""${!s.subtype ? ' selected' : ''}>一般語氣（顧問個人風格用，不進公式選單）</option>
        </select></label>
      <label class="field"><span>公式內容（AI 就照這段寫）</span>
        <textarea id="sp-body" rows="18" style="font-family:ui-monospace,monospace;font-size:12.5px">${escapeHtml(s.body || '')}</textarea></label>
      <!-- 2026-09-23 加：公式常常是先在別的地方寫成 .md 檔，手動複製貼上又長又容易漏。
           選了檔案直接灌進上面的框，灌完還是可以手改再存——不是直接送出去。 -->
      <div class="actions-row" style="margin-top:-4px">
        <label class="btn ghost sm" style="cursor:pointer;margin:0">
          📄 從 .md 檔帶入
          <input type="file" id="sp-file" accept=".md,.markdown,.txt,text/plain,text/markdown" hidden>
        </label>
        <span class="help" style="margin-left:8px">會覆蓋上面的內容，帶入後還可以改</span>
      </div>
      <div id="sp-msg" class="help" style="margin-top:6px"></div>
    </div>`,

  topicPromptEditor: (t) => `<div class="drawer-section">
      <label class="field"><span>話題名稱</span>
        <input type="text" id="tpp-name" value="${escapeHtml(t.name || '')}" maxlength="100"></label>
      <label class="field"><span>話題內容（切入方向）</span>
        <textarea id="tpp-body" rows="12">${escapeHtml(t.body || '')}</textarea></label>
      <div id="tpp-msg" class="help" style="margin-top:6px"></div>
    </div>`,
  // /admin/social-consultants 每筆是 name/threads/linkedin/line_link（沒有 platform/handle 這種
  // 單一欄位——一個顧問可以同時有 Threads 跟 LinkedIn 兩個帳號）。
  // ── 顧問社群卡片（2026-09-22 從舊版搬過來補齊）──
  //
  // 舊版說明：「這裡是幫顧問接 Threads／LinkedIn 帳號的地方——換 token、
  // 寫 LINE 連結、開 TG 審核主題，**以前都是老闆用終端機一步步做，
  // 現在你自己就能操作**。」新版原本只列帳號名稱，一個維護動作都沒有，
  // 等於這件事又退回去要找老闆。
  //
  // 一位顧問一列，Threads／LinkedIn 是那一列底下的兩塊，不是兩列。
  socialAccountsTab: ({ accounts, consultants }) => {
    const plat = (c, key, label) => {
      const p = c[key];
      if (!p) return `<div class="list-row"><span><b>${label}</b><small class="muted">還沒接</small></span></div>`;
      const exp = p.expires_at ? String(p.expires_at).slice(0, 10) : '';
      const soon = p.expires_at && (new Date(p.expires_at) - Date.now()) < 14 * 864e5;
      return `<div class="list-row"><span><b>${label}</b><small>${
        p.connected ? `已接上${exp ? ` 到期 ${exp}` : ''}` : '⚠️ 未連線'
      }${soon ? '　⚠️ 快到期了' : ''}${p.has_style_prompt ? '　·　有風格提示詞' : '　·　⚠️ 沒有風格提示詞'}${p.voice_card ? (p.voice_card_manual ? '　·　語氣卡（手改過）' : '　·　有語氣卡') : ''}${p.topic_voice_card ? '　·　有話題語氣卡' : '　·　話題文沿用語氣卡'}</small>${p.voice_card ? `<small class="help" style="white-space:pre-wrap;display:block;margin-top:4px">${text(String(p.voice_card).slice(0, 140))}${String(p.voice_card).length > 140 ? '…' : ''}</small>` : ''}</span>${
        rowActions([
          key === 'threads'
            ? actionBtn('更新 Token', 'sc-threads-token', { idParams: { id: p.id } })
            : actionBtn('產生授權連結', 'sc-linkedin-auth', { idParams: { id: p.id } }),
          actionBtn('帳號密碼', 'sc-account', { idParams: { id: p.id }, record: p }),
          actionBtn('風格提示詞', 'sc-style-prompt', { idParams: { id: p.id } }),
          actionBtn(p.voice_card ? '看／改語氣卡' : '寫語氣卡', 'sc-voice-card', { idParams: { id: p.id }, record: p }),
          ...(p.voice_card && p.voice_card_manual ? [actionBtn('改回自動產生', 'sc-voice-card-regen', { idParams: { id: p.id } })] : []),
          // 2026-09-24：話題語氣卡（只給話題文用；空著＝沿用語氣卡）
          actionBtn(p.topic_voice_card ? '看／改話題語氣卡' : '寫話題語氣卡', 'sc-topic-voice-card', { idParams: { id: p.id }, record: p }),
          ...(!p.topic_voice_card && p.voice_card ? [actionBtn('複製語氣卡來寫話題卡', 'sc-topic-voice-card', { idParams: { id: p.id }, record: p, copyFromVoiceCard: true })] : []),
          ...(p.topic_voice_card ? [actionBtn('清空話題語氣卡', 'sc-topic-voice-card-clear', { idParams: { id: p.id } })] : []),
        ])}</div>`;
    };
    return `<article class="card">
      <div class="card-head"><h2 style="margin:0;font-size:15px">顧問社群卡片</h2></div>
      <p class="help" style="margin:6px 0 12px">幫顧問接 Threads／LinkedIn 帳號的地方——換 token、寫 LINE 連結、看風格提示詞在不在。以前這些都要用終端機做。</p>
      ${actionBtn('＋ 新增顧問社群卡片', 'social-consultant-create', {}, 'primary')}
    </article>
    ${(consultants || []).map((c) => {
      const anyId = (c.threads && c.threads.id) || (c.linkedin && c.linkedin.id);
      return `<article class="card" style="margin-top:10px">
        <div class="card-head"><h3 style="margin:0;font-size:14px">${text(c.name)}</h3>
          ${c.tg_thread_id ? `<span class="badge">TG 主題 ${text(c.tg_thread_id)}</span>` : '<span class="badge warning">沒有 TG 審核主題</span>'}</div>
        <div class="list-row"><span><b>LINE 加好友連結</b><small>${c.line_link ? text(c.line_link) : '⚠️ 還沒設定——這位顧問的貼文與私訊回覆都放不了連結'}</small></span>
          ${anyId ? rowActions([actionBtn(c.line_link ? '修改' : '設定', 'sc-line-link', { idParams: { id: anyId }, record: c })]) : ''}</div>
        ${plat(c, 'threads', 'Threads')}
        ${plat(c, 'linkedin', 'LinkedIn')}
      </article>`;
    }).join('') || empty('目前沒有顧問社群卡片')}
    <article class="card" style="margin-top:14px"><div class="card-head"><h3 style="margin:0;font-size:14px">所有發文帳號（${(accounts || []).length}）</h3></div>
      ${list(accounts || [], (a) => `<div class="list-row"><span><b>${text(a.label || a.consultant_name || a.id)}</b><small>${text(a.platform)}</small></span></div>`)}</article>`;
  },
  clients: (tab='clients') => pageHead('客戶 / BD','集中管理客戶關係、推薦人選與企業用人需求。','') + tabbar('clients',[['clients','客戶'],['bd-progress','開發進度'],['bd-ai','AI 名單（未聯繫）'],['hiringleads','依職缺開發'],['candbd','人選敲門名單'],['bd-wrapup','客戶跟進'],['scripts','話術手冊'],['hiring','企業用人需求'],['billing','收費進程']],tab) + `<div id="page-data">${endpointState('客戶與 BD')}</div>`,
  clientsData: ({ companies, bd, requests }) => `<div class="kpi-grid"><article class="kpi"><span>客戶</span><strong>${companies.length}</strong></article><article class="kpi"><span>BD 案件</span><strong>${bd.length}</strong></article><article class="kpi"><span>BD Requests</span><strong>${requests.length}</strong></article></div>
    <div class="card"><div class="card-head"><h2 style="margin:0;font-size:15px">新增客戶</h2></div>
      <p class="help" style="margin:6px 0 10px">建好之後會自動產生一組「用人需求表連結」，把連結給客戶窗口他就能自己填職缺。</p>
      ${actionBtn('＋ 新增客戶', 'company-add', {}, 'primary')}</div>
    <div class="card-grid">${companies.map((c) => `<article class="card"><div class="card-head"><h3>${text(c.display_name || c.name)}</h3><span class="badge">${text(views.companyRelationLabel(c.relation))}</span></div><p>${text(c.contact_email, '（沒有聯絡信箱）')}</p><p class="muted" style="font-size:12px;margin:2px 0 8px">${c.last_emailed_at ? `需求表上次寄送 ${text(String(c.last_emailed_at).slice(0, 10))}` : '需求表還沒寄過'}</p><button class="btn" data-client="${text(c.id)}">管理客戶</button></article>`).join('') || empty('目前沒有客戶資料')}</div>`,
  // ── 客戶資訊（2026-09-22 從舊版 /consultant-beta/client-info 搬過來補齊）──
  //
  // 搬之前新版少了三樣**舊版天天在用**的東西，而且有一個一直沒被發現的 bug：
  //   🐛 待審職缺永遠是空的——前端讀 detail.pending_jobs，但後端回的是
  //      detail.jobs（全部職缺，要自己用 status='pending_review' 篩）。
  //      顧問在新版根本看不到有職缺在等他審。
  //   ❌ 用人需求表連結完全沒顯示。只有「重新產生 Token」跟「寄送邀請信」
  //      兩顆按鈕——但顧問最常做的事是**把連結複製起來貼給客戶窗口**，
  //      舊版那個「複製」按鈕沒了等於這件事做不了。
  //   ❌ 沒有已掛職缺清單、上次寄送時間、合作關係／別名／誰介紹的。
  //
  // ⚠️ 連結網址寫死 https://step1ne.com/portal/?t=<token>，跟舊版一致。
  //    這個不是 API 回的，是前端組的——改網域的時候這裡要一起改。
  companyRelationLabel: (r) => ({ signed: '已簽約', negotiating: '洽談中', end_client: '最終用人單位',
    past: '過去客戶', prospect: '潛在客戶', blocked: '⛔ 拒絕往來', private: '朋友私人協助' }[r] || r || '未設定'),

  companyDrawerBody: (detail) => {
    const c = detail.company || detail;
    const jobs = detail.jobs || [];
    const pending = jobs.filter((j) => j.status === 'pending_review');
    const linked = jobs.filter((j) => j.status !== 'pending_review');
    const portalUrl = c.portal_token ? `https://step1ne.com/portal/?t=${c.portal_token}` : '';
    const JOB_ST = { open: '招募中', closed: '已關閉', paused: '暫停', filled: '已找到人',
                     draft: '尚未公開', client_draft: '客戶草稿', pending_review: '待審核' };
    return `<div class="drawer-section">
      <h3>基本資料</h3>
      <p>${text(c.contact_name, '（沒有聯絡人）')} · ${text(c.contact_email, '（沒有信箱）')}</p>
      <p class="muted" style="margin:4px 0 0">合作關係：${text(views.companyRelationLabel(c.relation))}${c.via_client ? ` · 透過 ${text(c.via_client)} 介紹` : ''}</p>
      ${c.relation_note ? `<p class="muted" style="margin:4px 0 0">${text(c.relation_note)}</p>` : ''}
      ${c.aliases ? `<p class="muted" style="margin:4px 0 0">別名：${text(String(c.aliases).replace(/[\n]+/g, '、'))}</p>` : ''}
      ${rowActions([
        actionBtn('編輯客戶資料', 'company-update', { idParams: { id: c.id }, record: c }),
        actionBtn('寄送邀請信', 'company-send-email', { idParams: { id: c.id } }),
        actionBtn('重新產生連結', 'company-regen-token', { idParams: { id: c.id } }, 'danger'),
      ])}

      ${(detail.files || []).length ? `<h3 style="margin-top:20px">客戶指定表單／附件</h3>
      <p class="help" style="margin:0 0 6px">客戶要人選填寫或附上的固定文件，下載後轉給人選。</p>
      ${list(detail.files, (f) => `<div class="list-row"><span><b>${text(f.title)}</b>${f.usage_note ? `<small>${text(f.usage_note)}</small>` : ''}</span><button type="button" class="btn sm" data-client-file="${escapeHtml(f.file_id)}" data-client-file-name="${escapeHtml(f.title)}">下載</button></div>`)}` : ''}

      ${(detail.docs || []).length ? `<h3 style="margin-top:20px">客戶背景資料（顧問參考）</h3>
      <p class="help" style="margin:0 0 6px">之前整理過的公司介紹、人才地圖、開會紀錄，接案或跟客戶通話前先看。內部資料，不要轉給人選或客戶。</p>
      ${list(detail.docs, (d) => `<div class="list-row"><span><b>${text(d.title)}</b><small>${text(d.doc_date || '')}</small></span><button type="button" class="btn sm" data-client-doc="${text(d.id)}">打開</button></div>`)}` : ''}

      <h3 style="margin-top:20px">客戶電洽紀錄（職缺對焦）</h3>
      <p class="help" style="margin:0 0 6px">在 TG 客戶群組「📞 客戶電洽回饋」貼逐字稿，整通紀錄自動存在這裡；「建議調整」按過 ✅ 的才會改職缺卡。</p>
      ${(detail.calls || []).length ? (detail.calls || []).map((x) => {
        const KIND = { job: '🎯', unsure: '❓', new_job: '🆕 新職缺', general: '🗂' };
        const ST = { applied: ['已套用職缺卡', 'success'], recorded: ['只留紀錄', ''], dropped: ['只留紀錄', ''], pending: ['調整待確認', 'warning'] };
        const chg = (i) => { let c = []; try { c = JSON.parse(i.changes_json || '[]'); } catch { c = []; } return c.length ? `<small style="white-space:pre-wrap;display:block;margin-top:4px"><b>🔧 建議調整：</b>\n${text(c.map((x, k) => `${k + 1}. ${x}`).join('\n'))}</small>` : ''; };
        return `<details class="card" style="margin:0 0 8px"><summary style="cursor:pointer;padding:10px 12px"><b>${text(String(x.created_at || '').slice(5, 16))}</b>・${text(x.caller || '')}　<span class="muted">${text(x.summary || (x.status === 'queued' ? 'AI 整理中…' : ''))}</span></summary>
          <div class="list" style="padding:0 12px 10px">${(x.items || []).map((i) => { const st = ST[i.status] || [i.status, '']; return `<div class="list-row" style="align-items:flex-start"><span style="flex:1"><b>${text(KIND[i.kind] || '')} ${text(i.job_title || '')}</b><small style="white-space:pre-wrap">${text(i.text || '')}</small>${chg(i)}</span><span class="badge ${st[1]}">${text(st[0])}${i.decided_by ? '・' + text(i.decided_by) : ''}</span></div>`; }).join('') || '<p class="muted">沒有拆出內容</p>'}</div></details>`;
      }).join('') : '<p class="muted">還沒有客戶電洽紀錄。</p>'}

      <h3 style="margin-top:20px">用人需求表連結</h3>
      <p class="help" style="margin:0 0 6px">把這個連結給客戶窗口，他就能自己填職缺需求。連結不會過期；要收回舊連結的存取權，按上面的「重新產生連結」。</p>
      ${portalUrl
        ? `<div class="list-row" style="align-items:center">
             <code style="font-size:12.5px;word-break:break-all">${text(portalUrl)}</code>
             <button type="button" class="btn sm" data-action="copy-text" data-copy="${escapeHtml(portalUrl)}">複製</button>
           </div>
           <p class="muted" style="margin:6px 0 0">${c.last_emailed_at ? `上次寄送：${text(c.last_emailed_at)}` : '還沒寄過邀請信'}</p>`
        : '<div class="notice">這家客戶還沒有連結。按「重新產生連結」就會建一組。</div>'}

      <h3 style="margin-top:20px">待審職缺（${pending.length}）</h3>
      <p class="help" style="margin:0 0 6px">客戶自己填完送出的，核准後才會上架。</p>
      ${pending.length ? list(pending, (j) => `<div class="list-row"><span><b>${text(j.title)}</b><small>${text(j.updated_at)}${
          Array.isArray(j.compliance_hits) && j.compliance_hits.length
            ? ` · ⚠️ 有 ${j.compliance_hits.length} 處要改才能刊：${text(j.compliance_hits.slice(0, 2).join('、'))}`
            : ''}</small></span>${rowActions([
          actionBtn('核准', 'pending-job-approve', { idParams: { slug: j.slug } }),
          actionBtn('駁回', 'pending-job-reject', { idParams: { slug: j.slug } }, 'danger'),
        ])}</div>`) : '<p class="muted">沒有待審的職缺。</p>'}

      <h3 style="margin-top:20px">已掛職缺（${linked.length}）</h3>
      ${linked.length ? list(linked, (j) => `<div class="list-row"><span><b>${text(j.title)}</b><small>${text(j.slug)}</small></span><span class="badge">${text(JOB_ST[j.status] || j.status || '—')}</span></div>`) : '<p class="muted">這家客戶底下還沒有職缺。</p>'}
    </div>`;
  },
  // /admin/bd（bd_outreach 表）真實欄位是 company/why_company/contact_email/status/created_at——
  // 沒有 job_title（舊版 consultant/bd 那頁寫 r.job_title 是錯的，一直顯示假的「無職缺錨點」，
  // 這裡改用真的存在的 why_company 當脈絡）。status 真實值：pending/draft/rejected/blocked/sent，
  // 顧問核准／駁回是走 Telegram 群組的 /admin/bd/:id/decide，這頁不重做那個流程。
  // 待補窗口＝status=pending 又沒填 contact_email 的——這幾封在群組按核准也寄不出去，
  // 顧問要有地方補，不然只能卡住。
  // 2026-10-15 Jacky：BD Pipeline 分頁拿掉（跟開發進度重複），還沒寄出的開發信草稿收到開發進度最上面，預設收起
  bdDraftsBlock: (bd) => {
    const pend = (bd || []).filter((b) => b.status === 'pending' || b.status === 'draft');
    if (!pend.length) return '';
    const need = pend.filter((b) => !b.contact_email);
    const ready = pend.filter((b) => b.contact_email);
    const row = (b) => `<div class="list-row"><span><b>${text(b.company)}</b><small>${text(b.why_company || '')} · ${text(String(b.created_at || '').slice(0, 16))}</small></span>${b.contact_email ? '<span class="badge warning">等核准</span>' : actionBtn('補窗口 email', 'bd-fill-email', { idParams: { id: b.id } }, 'primary')}</div>`;
    return `<details class="card bd-drafts"><summary><b>還沒寄出的開發信草稿（${pend.length} 封）</b>　<span class="muted">缺窗口信箱 ${need.length}、等核准 ${ready.length}</span></summary>
      ${need.length ? `<h3 style="font-size:15px;margin:12px 0 4px">缺窗口信箱（補上才寄得出去）</h3>${list(need, row)}` : ''}
      ${ready.length ? `<h3 style="font-size:15px;margin:12px 0 4px">等核准（到 TG 群組按核准）</h3>${list(ready, row)}` : ''}</details>`;
  },
  clientsBdTab: ({ bd, talentPool }) => {
    const BD_ST = { pending: ['待處理', 'warning'], draft: ['草稿', 'neutral'], sent: ['已寄出', 'success'], rejected: ['已婉拒', 'neutral'], blocked: ['⛔ 客戶名單擋下', 'danger'] };
    const badge = (s) => { const [lb, tone] = BD_ST[s] || [s || '未知', 'neutral']; return `<span class="badge ${tone}">${text(lb)}</span>`; };
    const rows = talentPool?.rows || [];
    const byJob = {};
    rows.forEach((r) => { const k = r.job_title || '未指定'; byJob[k] = (byJob[k] || 0) + 1; });
    const used = rows.filter((r) => r.used).length;
    const poolCard = `<div class="card"><h2>目前人才庫</h2>${rows.length ? `<div class="list">${Object.entries(byJob).map(([k, n]) => `<div class="list-row"><span>${text(k)}</span><b>${text(n)} 人</b></div>`).join('')}</div><p class="help">共 ${text(rows.length)} 人可用（面談過、還沒到職）${used ? `，其中 ${text(used)} 人已用於開發` : ''}。到職的人會自動退出人才庫。</p>` : '<p class="muted">人才庫是空的。</p>'}</div>`;
    const need = bd.filter((b) => b.status === 'pending' && !b.contact_email);
    const needCard = `<div class="card"><h2>待補窗口（${need.length}）</h2><p class="help">這幾封查不到收件信箱，在群組按核准也寄不出去。補上就能寄。</p>${need.length ? list(need, (b) => `<div class="list-row"><span><b>${text(b.company)}</b><small>${text(b.why_company || '')}</small></span>${actionBtn('補窗口 email', 'bd-fill-email', { idParams: { id: b.id } }, 'primary')}</div>`) : '<p class="muted">沒有待補的窗口。</p>'}</div>`;
    const restRows = bd.filter((b) => !need.includes(b));
    return `${poolCard}${needCard}<h2 style="font-size:16px">開發信清單</h2>${list(restRows, (b) => `<article class="list-row"><span><b>${text(b.company)}</b><small>${text(b.why_company || '')} · ${text(b.created_at)}</small></span>${badge(b.status)}</article>`)}`;
  },
  // ── 開發進度看板（2026-09-24 Jacky 指派）──────────────────────────
  //
  // 漏斗：寄出→送達→開信→回信→談到職缺→成交。電訪（channel='phone'）跟寄信
  // 併在同一份列表——這是 Jacky 明講的要求，不要分兩個地方看。
  //
  // 篩選用原生 <select>（手機版直接可用，不用另外判斷裝置），列表本身用
  // data-bd-stage／data-bd-has-todo 屬性標記，篩選邏輯在 app.js 的
  // wireBdDashboardFilter()（同一套 wireBindFilter() 的作法：show/hide，不重打 API）。
  bdDashboardStageLabel: { sent: '已接觸', delivered: '送達', opened: '開信', replied: '有回應', jd_shared: '談到職缺', closed: '成交' },
  bdDashboard: ({ funnel, open_tracking_note, no_delivery_record_count, contact_breakdown, rows, consultants, cached_at }, mode) => {
    const aiMode = mode === 'ai';
    const LABEL = views.bdDashboardStageLabel;
    const STAGES = ['sent', 'delivered', 'opened', 'replied', 'jd_shared', 'closed'];
    const cb = contact_breakdown || { mail: 0, call: 0 };
    const funnelCard = `<div class="card">
      <h2>開發漏斗</h2>
      ${open_tracking_note ? `<p class="notice">ℹ️ ${text(open_tracking_note)}</p>` : ''}
      <div class="bd-funnel">${STAGES.map((k) => `<button type="button" class="bd-funnel-step" data-bd-filter-stage="${k}"><b>${text(funnel[k] || 0)}</b><span>${LABEL[k]}</span></button>`).join('')}</div>
      <p class="help">「已接觸」＝寄信 ${text(cb.mail)} 家＋電訪 ${text(cb.call)} 家；電訪是推卡給 Phoebe，不是真的寄出信，「送達」只會算在寄信的 ${text(cb.mail)} 家裡。</p>
      ${no_delivery_record_count ? `<p class="help">送達數字裡，另外有 ${text(no_delivery_record_count)} 家是 9/23 前寄的信——那時候還沒有送達回報，不是真的沒送到，看列表上會標「無送達紀錄」。</p>` : ''}
      <p class="help">點一格可以篩出停在那一步的公司；一家公司只會算在它目前走到的最後一步。</p>
    </div>`;
    // 2026-09-29 Jacky：依產業分類、可以指派給誰打、電話分「人資電話／公司總機」標清楚
    const groups = {};
    const todayStr = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    rows.forEach((r) => { const g = r.industry_group || '未分類'; groups[g] = (groups[g] || 0) + 1; });
    const people = [...new Set(['Jacky', 'Phoebe', ...(consultants || []), ...rows.map((r) => r.assigned_to).filter(Boolean)])];
    const filterBar = `<div class="filter-row">
      <input id="bd-dash-q" type="search" placeholder="搜尋公司名稱" style="min-height:44px;flex:1 1 200px" aria-label="搜尋公司名稱">
      <select id="bd-dash-source" aria-label="來源"><option value="">來源：全部</option><option value="web">🌐 官網詢問（${rows.filter((r) => r.source_kind === 'web' && !r.parked_at).length}）</option><option value="manual">✍️ 顧問新增（${rows.filter((r) => r.source_kind === 'manual' && !r.parked_at).length}）</option><option value="hiring">📋 職缺開發（${rows.filter((r) => r.source_kind === 'hiring' && !r.parked_at).length}）</option><option value="candbd">🧲 人選敲門（${rows.filter((r) => r.source_kind === 'candbd' && !r.parked_at).length}）</option><option value="ai">🤖 AI 名單（${rows.filter((r) => r.source_kind === 'ai' && !r.parked_at).length}）</option></select>
      <select id="bd-dash-industry"><option value="">全部產業（${rows.length}）</option>${Object.entries(groups).sort((a, b) => b[1] - a[1]).map(([g, n]) => `<option value="${escapeHtml(g)}">${text(g)}（${n}）</option>`).join('')}</select>
      <select id="bd-dash-assignee"><option value="">全部負責人</option><option value="__none">未指派</option>${people.map((x) => `<option value="${escapeHtml(x)}">${text(x)}</option>`).join('')}</select>
      <select id="bd-dash-contacted"><option value="">聯繫：全部</option><option value="no">還沒聯繫</option><option value="yes">已聯繫</option><option value="parked">備選池（${rows.filter((r) => r.parked_at).length}）</option></select>
      <select id="bd-dash-qc"><option value="">資料：全部</option><option value="ok">合格（可以打）</option><option value="bad">不合格（補資料中）</option></select>
      <select id="bd-dash-phone"><option value="">電話：全部</option><option value="hr">有人資電話</option><option value="any">有任何電話</option><option value="none">還沒有電話</option></select>
      <select id="bd-dash-filter">
        <option value="">全部</option>
        <option value="todo">待我處理</option>
        <option value="replied">有回應（回信或電訪講到話，含談到職缺／成交）</option>
        ${STAGES.map((k) => `<option value="stage:${k}">停在「${LABEL[k]}」</option>`).join('')}
      </select>
      <span id="bd-dash-count" class="help"></span>
    </div>`;
    const RES = { interested: '有興趣', not_interested: '拒絕', got_email: '拿到信箱', no_answer: '沒接', gatekeeper: '被總機擋', got_contact: '問到窗口', not_hiring: '沒在徵人' };
    // 2026-10-02 Jacky：「剛新增的卡片，一打開開發進度沒辦法很直覺看到」→ 官網詢問、顧問手動新增的，7 天內還沒人聯繫就釘在最上面一組
    // （夜間 AI 名單一天幾十家，不釘，不然最上面會被淹掉）
    const NEW_G = '🆕 新進來：官網詢問／顧問新增／人選敲門（7 天內，還沒聯繫）';
    const weekAgo = new Date(Date.now() + 8 * 3600000 - 7 * 86400000).toISOString().slice(0, 10);
    rows.forEach((r) => { if ((r.inbound || r.by_hand) && !r.contacted_at && !r.parked_at && String(r.first_created_at || '') >= weekAgo) r.industry_group = NEW_G; });
    const sorted = rows.slice().sort((a, b) => {
      const an = a.industry_group === NEW_G, bn = b.industry_group === NEW_G;
      if (an !== bn) return an ? -1 : 1;
      if (an) return String(b.first_created_at || '').localeCompare(String(a.first_created_at || ''));
      return String(a.industry_group || '未分類').localeCompare(String(b.industry_group || '未分類'), 'zh-Hant') || 0;
    });
    let lastGroup = null;
    const rowsHtml = rows.length ? `<div class="list" id="bd-dash-list">${sorted.map((r) => {
      const chLabel = r.channel === 'phone' ? '📞 電訪' : (r.channel === 'both' ? '✉️＋📞 信＋電訪' : '✉️ 寄信');
      const g = r.industry_group || '未分類';
      const head = g !== lastGroup ? `<h3 class="bd-group" data-bd-group-head="${escapeHtml(g)}">${text(g)}</h3>` : '';
      lastGroup = g;
      const tel = (n) => `<a href="tel:${escapeHtml(String(n).replace(/[^0-9+#,]/g, ''))}">${text(n)}</a>`;
      const phoneHtml = r.hr_phone
        ? `<div class="bd-phone hr"><b>人資電話</b> ${tel(r.hr_phone)}${r.hr_contact ? `（${text(r.hr_contact)}）` : ''}<small>→ 直接找人資，照開發引導「開場」講</small></div>`
        : '';
      const mainHtml = r.company_phone
        ? `<div class="bd-phone main"><b>公司總機</b> ${tel(r.company_phone)}<small>→ 先過總機：問「＿＿職缺是哪位人資負責」</small></div>` : '';
      const noPhone = !r.hr_phone && !r.company_phone ? '<div class="bd-phone none">⚠️ 還沒有電話</div>' : '';
      const phoneKind = r.hr_phone ? 'hr' : (r.company_phone ? 'main' : 'none');
      const lastCall = r.last_call_result ? `<small>${r.call_count ? `已打 ${r.call_count} 通・` : ''}上次電訪：${text(RES[r.last_call_result] || r.last_call_result)}（${text(String(r.last_call_at || '').slice(5, 10))}）${r.call_retry_at ? `・建議 ${text(String(r.call_retry_at).slice(5, 10))} 再打` : ''}${r.last_call_note ? `・${text(String(r.last_call_note).replace(/\s+/g, ' ').slice(0, 40))}${String(r.last_call_note).length > 40 ? '…' : ''}` : ''}</small>` : '';  // 2026-10-22：備註常是整段逐字稿（上千字），列表只露前 40 字，全文在抽屜的進度紀錄看
      const oid = (r.outreach_ids || [])[0] || '';
      return `${head}<article class="list-row bd-dash-row" data-bd-open="${escapeHtml(r.company)}" tabindex="0" aria-label="${escapeHtml(r.company)}：打開開發引導／時間軸" title="點卡片打開開發引導／時間軸" data-bd-source="${escapeHtml(r.source_kind || '')}" data-bd-name="${escapeHtml(String(r.company || '').toLowerCase())}" data-bd-stage="${text(r.stage)}" data-bd-has-todo="${r.todo.length ? 1 : 0}" data-bd-industry="${escapeHtml(g)}" data-bd-assignee="${escapeHtml(r.assigned_to || '')}" data-bd-phone="${phoneKind}" data-bd-contacted="${r.contacted_at ? 1 : 0}" data-bd-parked="${r.parked_at ? 1 : 0}" data-bd-qc="${(r.qc_missing || []).length ? 0 : 1}" data-bd-tag="${escapeHtml(r.tag || 'none')}" data-bd-late="${(!r.parked_at && r.tag !== 'NO' && r.next_due && r.next_due < todayStr) ? 1 : 0}" data-bd-today="${(!r.parked_at && r.tag !== 'NO' && r.next_due === todayStr) ? 1 : 0}">
        <span>
          <b>${text(r.company)}</b> ${r.tag ? `<span class="bdc-chip tagchip" style="background:${(BD_TAGS.find((t) => t.k === r.tag) || {}).color || '#9aa5b8'};color:#fff">${text(r.tag)}</span>` : ''}${r.bd_stage ? `<span class="bdc-chip stage">${text(r.bd_stage)}</span>` : ''} ${({ web: '<span class="badge warning" title="企業自己在官網留需求">🌐 官網詢問</span>', manual: '<span class="badge info" title="顧問按「新增開發對象」加進來的">✍️ 顧問新增</span>', hiring: '<span class="badge success" title="從「依職缺開發」挑進來的，104 最近有在徵">📋 職缺開發</span>', candbd: '<span class="badge success" title="從手上人選反推、系統建議去敲門的公司">🧲 人選敲門</span>', ai: '<span class="badge" title="夜間 AI 找來的名單">🤖 AI 名單</span>' })[r.source_kind] || ''} ${r.industry ? `<span class="badge">${text(String(r.industry).split(/[（(]/)[0].slice(0, 18))}</span>` : ''}${r.inbound ? ' <span class="badge warning">1 個工作天內要回</span>' : ''}${r.industry_group === NEW_G ? ` <span class="badge info">新・${text(String(r.first_created_at || '').slice(5, 10))}</span>` : ''}${r.has_profile ? ' <span class="badge success">有介紹</span>' : ''}${r.note_count ? ` <span class="badge info">有 ${text(r.note_count)} 則心得</span>` : ''}${r.social_jobs ? ` <span class="badge warning" title="只發社群的職缺，到職缺列表看">🔒 未簽約職缺 ${text(r.social_jobs)} 個</span>` : ''}
          ${(r.qc_missing || []).length && !(r.inbound || r.by_hand) ? `<small class="bd-qc-bad">不合格，補資料中：缺 ${text(r.qc_missing.join('、'))}</small>` : ''}
          ${views.bdEntry(r.trigger, r.has_candidate, false, r.job_title, r.topic)}
          ${phoneHtml}${mainHtml}${noPhone}
          <small>${text(r.contact_name || '窗口未知')}${r.contact_email ? ' · ' + text(r.contact_email) : ''}</small>
          ${lastCall}
          <small class="fu-row-line">${r.next_action || r.next_due || r.next_step ? `下一步：${text(views.FOLLOW_ACTS[r.next_action] || '還沒決定')}${r.next_due ? `・${text(r.next_due.slice(5).replace('-', '/'))}` : ''} ${views.followDueTag(r.next_due)}${r.next_step ? `｜${text(String(r.next_step).split('\n')[0].slice(0, 40))}` : ''}` : (r.ai_suggest ? `<span class="fu-tag ai">AI 建議</span>${text(views.FOLLOW_ACTS[r.ai_suggest.action] || '')}${r.ai_suggest.due ? `・${text(r.ai_suggest.due.slice(5).replace('-', '/'))}` : ''}${r.ai_suggest.memo ? `｜${text(String(r.ai_suggest.memo).slice(0, 40))}` : ''}（到客戶跟進確認）` : (r.contacted_at || r.last_call_result ? '<span class="fu-tag none">還沒排下一步</span>' : ''))}</small>
          <small>${chLabel} · 第 ${text(r.attempts)} 次接觸 · 目前：${r.awaiting_call ? '待電訪' : text(LABEL[r.stage] || r.stage)}${r.delivery_note === 'no_tracking' ? '（送達：無紀錄，9/23 前寄的信還沒有追蹤）' : ''}</small>
          ${r.next_followup_due ? `<small class="${r.next_followup_overdue ? 'bd-overdue' : ''}">${r.next_followup_overdue ? '⚠️ 追信逾期：' : '下次追信：'}${text(String(r.next_followup_due).slice(0, 16))}</small>` : ''}
          ${r.todo.length ? `<small>${r.todo.map((t) => `<span class="badge warning">${text(t)}</span>`).join(' ')}</small>` : ''}
        </span>
        <div class="bd-actions">
          <label class="bd-contacted"><input type="checkbox" data-bd-contacted-box="${escapeHtml(r.company)}"${r.contacted_at ? ' checked' : ''}> 已聯繫${r.contacted_at ? `<small>${text(String(r.contacted_at).slice(5, 10))}${r.contacted_by ? ' ' + text(r.contacted_by) : ''}</small>` : ''}</label>
          <label class="bd-assign"><span>負責</span><select data-bd-assign="${escapeHtml(r.company)}"${(r.qc_missing || []).length && !r.assigned_to && !(r.inbound || r.by_hand) ? ' disabled title="電話＋104＋官網都補齊才能指派"' : ''}><option value="">未指派</option>${people.map((x) => `<option value="${escapeHtml(x)}"${r.assigned_to === x ? ' selected' : ''}>${text(x)}</option>`).join('')}</select>${phoneKind === 'none' ? ((r.inbound || r.by_hand) && r.contact_email ? '<em class="bd-need-phone">只留 Email，先寄信</em>' : '<em class="bd-need-phone">待補電話</em>') : ''}</label>
          ${oid ? actionBtn('記錄電話結果', 'bd-call-result', { idParams: { id: oid } }, 'primary') : ''}
          ${aiMode ? `<button type="button" class="btn sm" data-bd-promote="${escapeHtml(r.company)}" title="決定要開發這家：移到開發進度，負責人是你">加入開發進度</button>` : ''}
          <button type="button" class="btn ghost sm" data-bd-mail="${escapeHtml(r.company)}" title="直接打開寄公司介紹信那一段">寄公司介紹信</button>
          ${r.stage === 'closed' || aiMode ? '' : `<button type="button" class="btn ghost sm" data-bd-jobs="${escapeHtml(r.company)}" title="打開客戶卡片的「客戶提供的職缺」分頁">新增未簽約職缺</button>`}
          ${r.stage === 'closed' ? '<span class="badge success">已是正式客戶</span>' : actionBtn('簽約了，轉成正式客戶', 'bd-promote-client', { idParams: { company: r.company }, record: { assigned_to: r.assigned_to } })}
          ${views.parkBtn(r.company, !!r.parked_at, r.assigned_to)}
        </div>
      </article>`;
    }).join('')}</div>` : empty('目前沒有已經接觸過的公司');
    // 2026-10-13 Jacky：總攬最上面——今天要處理＋客戶標籤篩選
    const openRow = (r) => !r.parked_at && r.tag !== 'NO';
    const lateN = rows.filter((r) => openRow(r) && r.next_due && r.next_due < todayStr).length;
    const todayN = rows.filter((r) => openRow(r) && r.next_due === todayStr).length;
    const hotN = rows.filter((r) => r.tag === 'HOT' && !r.parked_at).length;
    const matN = rows.filter((r) => r.tag === 'MATERIAL' && !r.parked_at).length;
    const todayStrip = aiMode ? '' : `<div class="bdo-today" id="bd-today">${[['late', '逾期沒做', lateN, 'late'], ['today', '今天要做', todayN, ''], ['hot', 'HOT 要追蹤', hotN, ''], ['mat', '要寄介紹／合約', matN, '']].map(([k, l, n, c]) => `<button type="button" class="bdo-t ${c}" data-bdo-quick="${k}"><b>${n}</b><span>${l}</span></button>`).join('')}</div>
      <div class="bdo-tagbar" id="bd-tagbar" role="radiogroup" aria-label="客戶標籤">${[...BD_TAGS, { k: 'none', zh: '還沒分類', color: '#9aa5b8' }].map((t) => `<button type="button" class="bdo-tg" role="radio" aria-checked="false" data-bdo-tag="${t.k}"><b><i style="background:${t.color}"></i>${t.k === 'none' ? '未分類' : t.k} ${rows.filter((r) => (r.tag || 'none') === t.k && !r.parked_at).length}</b><span>${text(t.zh)}</span></button>`).join('')}</div>`;
    return `<div class="page-head" style="align-items:flex-start"><div><h2>${aiMode ? 'AI 名單（還沒聯繫）' : '開發進度看板'}</h2><p>${aiMode ? '夜間 AI 自動找來、<b>還沒有任何人打過或寄過</b>的公司。打完一通電話（就算沒接）、寄過信，或按「加入開發進度」，就會移到開發進度。' : '寄出、電訪、追信、回信、談到職缺、成交——同一家公司合併成一列，不用分頭看。只放顧問碰過的公司；夜間 AI 找來還沒聯繫的在「AI 名單」分頁。'}</p>${cached_at ? `<p class="help">資料時間 ${text(String(cached_at).slice(11, 16))}（為了省資料庫額度，每 5 分鐘更新一次；你們按按鈕改的資料會立刻更新）</p>` : ''}</div>${actionBtn('＋ 新增開發對象', 'bd-add-company', {}, 'primary')}</div>${funnelCard}${todayStrip}${filterBar}${rowsHtml}`;
  },
  // 職缺內容逐欄位編輯（2026-09-29 修：原本一個大文字框讀不到結構化 JD，每個職缺都顯示空白）
  // 基本條件：答案固定的欄位改成下拉選單（2026-10-14 Jacky）。目前的值若不在選項內，保留在選單最前面（「目前：…」），沒改就不會被覆蓋。
  jobFactsPanel: (job) => {
    const f = job.__facts || {};
    const FIELDS = [
      ['employment', '僱用型態', [['FULL_TIME', '正職'], ['PART_TIME', '兼職'], ['CONTRACTOR', '約聘'], ['TEMPORARY', '派遣'], ['INTERN', '實習']], true],
      ['education_level', '學歷要求', [['不限', '不限'], ['高中職', '高中職'], ['專科', '專科'], ['大學', '大學'], ['碩士以上', '碩士以上']]],
      ['work_mode', '工作型態', [['全實體到班', '全實體到班'], ['彈性上班', '彈性上班'], ['混合（部分在家）', '混合（部分在家）'], ['遠端', '遠端']]],
      ['urgency', '急迫度', [['一般', '一般'], ['急徵（一個月內到位）', '急徵（一個月內到位）'], ['長期徵才', '長期徵才']]],
      ['hiring_reason', '徵才原因', [['離職補缺', '離職補缺'], ['新增編制', '新增編制'], ['專案需求', '專案需求']]],
      ['leads_team', '需不需要帶人', [['不需帶人', '不需帶人'], ['需要帶人', '需要帶人']]],
      ['salary_unit', '薪資單位', [['MONTH', '月薪'], ['YEAR', '年薪'], ['HOUR', '時薪']]],
    ];
    const rows = FIELDS.map(([k, lb, opts, json]) => {
      let cur = f[k] == null ? '' : String(f[k]);
      if (json && cur.startsWith('"')) { try { cur = JSON.parse(cur); } catch { /* 原樣 */ } }
      const has = opts.some(([val]) => val === cur);
      const extra = cur && !has ? `<option value="${escapeHtml(cur)}" selected>目前：${text(cur)}</option>` : (!cur ? '<option value="" selected>（沒填）</option>' : '');
      return `<label class="field"><span>${text(lb)}</span><select data-fact="${k}" data-orig="${escapeHtml(cur)}" ${json ? 'data-json="1"' : ''}>${extra}${opts.map(([val, name]) => `<option value="${escapeHtml(val)}"${val === cur ? ' selected' : ''}>${text(name)}</option>`).join('')}</select></label>`;
    }).join('');
    return `<div data-facts-box data-slug="${text(job.slug)}"><h3>基本條件（用選的）</h3><div class="form-grid">${rows}</div>
      <button type="button" class="btn" data-action="save-job-facts">儲存基本條件</button><p class="help">用選的，不用打字；存了馬上生效，不經 AI。目前不是選項裡的寫法，會顯示「目前：…」，沒改就不會被覆蓋。</p></div>`;
  },
  jobContentForm: (content) => {
    const spec = (content && content.spec) || {};
    const src = { saved: '已存檔的版本', backfilled_from_intake: '收件單底稿', scraped_live_page: '目前網站上的職缺頁' }[content && content.source] || '';
    return `<form id="job-content-form" class="form-grid">
      ${src ? `<p class="help span-2" style="margin:0">內容來源：${text(src)}</p>` : ''}
      ${content && content.mismatched ? `<div class="notice span-2">這個職缺頁不是標準樣板，多了：${text((content.extraSections || []).join('、'))}。存檔會用標準樣板重新產生，這些內容會不見。</div>` : ''}
      ${JD_FIELDS.map(([k, lb, kind]) => {
        const v = jdFieldVal(kind, spec[k]);
        const el = kind === 'line'
          ? `<input name="${k}" value="${escapeHtml(v)}" data-orig="${escapeHtml(v)}" data-kind="${kind}">`
          : `<textarea name="${k}" rows="${kind === 'text' ? 3 : Math.min(14, Math.max(4, v.split('\n').length + 1))}" data-orig="${escapeHtml(v)}" data-kind="${kind}">${escapeHtml(v)}</textarea>`;
        const hideable = ['subtitle', 'intro', 'duties', 'must', 'plus', 'why', 'benefits', 'faq'].includes(k);
        const shown = !(Array.isArray(spec.hidden) && spec.hidden.includes(k));
        const tog = hideable ? `<label class="show-tog"><input type="checkbox" data-show="${k}" ${shown ? 'checked' : ''}> 官網顯示</label>` : '';
        return `<label class="field span-2"><span class="fld-head">${text(lb)}${tog}</span>${el}</label>`;
      }).join('')}
      <input type="hidden" id="jd-hidden-orig" value="${escapeHtml(JSON.stringify(Array.isArray(spec.hidden) ? spec.hidden : []))}">
    </form>`;
  },
  // 「認識客戶」分頁（2026-09-29 Jacky）：顧問不用自己上網研究客戶背景。資料是 bd_company_profiles
  // （AI 整理好寫進 D1），這裡照固定順序顯示；hiring／topics／recent_news／sources 一行一項，用條列。
  bdProfilePane: (pf) => {
    const has = (v) => String(v || '').trim() !== '';
    if (!pf || !['business', 'scale', 'org', 'hiring', 'topics', 'recent_news', 'website', 'industry'].some((k) => has(pf[k]))) {
      return '<div class="state"><strong>AI 還在整理這家的介紹</strong><p>整理好會自動出現在這裡，先看「開發引導」準備打電話。</p></div>';
    }
    const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : '');
    const lines = (v) => String(v || '').split(/\r?\n/).map((x) => x.replace(/^[\s・•\-*]+/, '').trim()).filter(Boolean);
    const ul = (v, asLink) => `<ul class="bdp-ul">${lines(v).map((x) => {
      const u = asLink ? safeUrl(x) : '';
      return `<li>${u ? `<a href="${escapeHtml(u)}" target="_blank" rel="noopener">${text(x)}</a>` : text(x)}</li>`;
    }).join('')}</ul>`;
    const row = (label, body) => `<div class="bdp-row"><h4>${label}</h4>${body}</div>`;
    const site = safeUrl(pf.website);
    return `<div class="bdp">
      ${has(pf.website) ? row('官網', site ? `<a class="bdp-site" href="${escapeHtml(site)}" target="_blank" rel="noopener">${text(pf.website)} ↗</a>` : `<p>${text(pf.website)}</p>`) : ''}
      ${has(pf.industry) ? row('產業', `<p>${text(pf.industry)}</p>`) : ''}
      ${has(pf.business) ? row('做什麼的', `<p>${text(pf.business)}</p>`) : ''}
      ${has(pf.scale) ? row('規模', `<p>${text(pf.scale)}</p>`) : ''}
      ${has(pf.org) ? row('組織架構', `<p>${text(pf.org)}</p>`) : ''}
      ${has(pf.hiring) ? row('需要的職缺', ul(pf.hiring)) : ''}
      ${has(pf.topics) ? row('可以聊的議題', ul(pf.topics)) : ''}
      ${has(pf.recent_news) ? row('近期新聞', ul(pf.recent_news)) : ''}
      ${has(pf.sources) ? row('來源', ul(pf.sources, true)) : ''}
      ${has(pf.updated_at) ? `<p class="help">整理時間 ${text(String(pf.updated_at).slice(0, 16))}${has(pf.updated_by) ? `・${text(pf.updated_by)}` : ''}</p>` : ''}
    </div>`;
  },

  // 2026-10-14 認識公司「研究卡」（Jacky：要讓顧問認真理解，不是偷懶；ADHD 版——先講結論、分頁、圖表、可以聊的話題）
  // 資料是 bd_company_profiles.research_json（AI 依「企業開發前深度研究指令」整理）。沒有就不顯示。
  bdResearchCard: (pf, company) => {
    let r = null;
    try { r = pf && pf.research_json ? JSON.parse(pf.research_json) : null; } catch { r = null; }
    if (!r) return '';
    const T = (x) => text(x == null ? '' : x);
    const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : '');
    const vd = r.verdict || {};
    const kpis = (r.kpis || []).map((k) => `<div class="rs-kpi ${T(k.state)}"><small>${T(k.label)}</small><b>${T(k.value)}<em>${T(k.unit)}</em></b><span>${T(k.sub)}</span></div>`).join('');
    const finds = (r.findings || []).map((f, i) => `<li><span class="rs-n">${i + 1}</span><div><b>${T(f.t)}</b><p>${T(f.d)}</p></div></li>`).join('');
    const chart = (c) => {
      const it = c.items || []; const max = Math.max(1, ...it.map((x) => Number(x.value) || 0));
      const W = 640, H = 250, padL = 8, base = 196, top = 34, bw = Math.min(64, (W - 16) / it.length - 16), gap = (W - 16 - bw * it.length) / Math.max(1, it.length);
      const bars = it.map((x, i) => {
        const h = Math.max(3, ((Number(x.value) || 0) / max) * (base - top)); const xx = padL + gap / 2 + i * (bw + gap);
        const tg = x.kind === 'target';
        return `<rect x="${xx}" y="${base - h}" width="${bw}" height="${h}" rx="5" class="${tg ? 'rs-bar-t' : 'rs-bar'}"/>
          <text x="${xx + bw / 2}" y="${base - h - 8}" text-anchor="middle" class="rs-val">${T(x.value)}</text>
          <text x="${xx + bw / 2}" y="${base + 20}" text-anchor="middle" class="rs-lab">${T(x.label)}</text>
          <text x="${xx + bw / 2}" y="${base + 38}" text-anchor="middle" class="rs-note">${T(x.kind === 'target' ? '目標' : '報導')}</text>`;
      }).join('');
      return `<div class="rs-chart"><h4>${T(c.title)}</h4><p class="rs-sub">${T(c.sub)}（單位：${T(c.unit)}）</p>
        <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${T(c.title)}">${bars}</svg>
        <ul class="rs-legend"><li><i class="rs-bar"></i>公開報導的數字</li><li><i class="rs-bar-t"></i>公司說的目標（還沒發生）</li></ul>
        <ul class="rs-notes">${it.map((x) => `<li><b>${T(x.label)}</b>　${T(x.note)}</li>`).join('')}</ul>
        ${c.read ? `<div class="rs-read">${T(c.read)}</div>` : ''}</div>`;
    };
    const ST = { done: '已發生', watch: '進行中', plan: '預計' };
    const tl = `<div class="rs-chart"><h4>這家公司正在忙的事（時間線）</h4><ol class="rs-tl">${(r.timeline || []).map((x) => `<li class="${T(x.state)}"><time>${T(x.when)}</time><span>${T(x.what)}</span><em>${T(ST[x.state] || '')}</em></li>`).join('')}</ol></div>`;
    const cov = `<div class="rs-chart"><h4>這份研究查到多少？</h4><p class="rs-sub">灰色＝查不到，不要在電話裡假裝知道</p><div class="rs-cov">${(r.coverage || []).map((c) => `<span class="${c.state === '有' ? 'y' : c.state === '部分' ? 'p' : 'n'}">${T(c.label)}<em>${T(c.state)}</em></span>`).join('')}</div></div>`;
    const topics = (r.topics || []).map((x) => `<div class="rs-topic"><b>${T(x.t)}</b><small>為什麼可以聊：${T(x.why)}</small><p>${T(x.how)}</p></div>`).join('');
    const facts = `<table class="rs-tbl"><thead><tr><th>已確認的事實</th><th>我的推論</th><th>要問人資的</th></tr></thead><tbody>${(r.facts || []).map((x) => `<tr><td>${T(x.fact)}</td><td>${T(x.infer)}</td><td><b>${T(x.ask)}</b></td></tr>`).join('')}</tbody></table>`;
    const rep = `<table class="rs-tbl"><thead><tr><th>日期／來源</th><th>看到什麼</th><th>要小心</th></tr></thead><tbody>${(r.reputation || []).map((x) => `<tr><td>${T(x.date)}<br><small>${T(x.src)}</small></td><td>${T(x.obs)}</td><td>${T(x.limit)}</td></tr>`).join('')}</tbody></table>`;
    const li = (a) => `<ul class="rs-ul">${(a || []).map((x) => `<li>${T(x)}</li>`).join('')}</ul>`;
    const plan = r.plan || {};
    const src = (r.sources || []).map((u) => { const s = safeUrl(u); return `<li>${s ? `<a href="${escapeHtml(s)}" target="_blank" rel="noopener">${T(s)}</a>` : T(u)}</li>`; }).join('');
    const tabs = [['key', '先看這裡'], ['chart', '圖表'], ['jobs', '有價值的職缺'], ['talk', '可以聊什麼'], ['view', '外界怎麼看'], ['gap', '查不到的'], ['act', '行動＋讀懂了嗎']];
    return `<div class="rs" data-rs="${escapeHtml(company || '')}">
      <div class="rs-meta">AI 研究，${T(r.generated_at)}　${T(r.by)}｜目標職缺：${T(r.target_job)}</div>
      <div class="rs-tabs" role="tablist">${tabs.map(([k, l], i) => `<button type="button" role="tab" class="${i ? '' : 'active'}" data-rs-tab="${k}" aria-selected="${i ? 'false' : 'true'}">${l}</button>`).join('')}</div>
      <div data-rs-pane="key">
        <div class="rs-verdict ${T(vd.level)}"><b>${T(vd.label)}</b><p>${T(vd.text)}</p></div>
        <div class="rs-kpis">${kpis}</div>
        <h4 class="rs-h">五個重點</h4><ol class="rs-find">${finds}</ol>
        <div class="rs-keyq"><small>這通電話最重要的一個問題</small><b>${T(r.key_question)}</b></div>
      </div>
      <div data-rs-pane="chart" hidden>${(r.charts || []).map(chart).join('')}${tl}${cov}</div>
      <div data-rs-pane="jobs" hidden>
        <h4 class="rs-h">這家公司現在在徵的，哪些值得看</h4>
        ${r.jobs_summary ? `<div class="rs-read">${T(r.jobs_summary)}</div>` : ''}
        <div class="rs-jobs">${(r.jobs || []).map((j) => { const u = safeUrl(j.url); return `<div class="rs-job ${T(j.level)}"><div class="rs-job-h"><b>${T(j.title)}</b><span class="rs-lv">${j.level === 'high' ? '優先看' : '參考'}</span></div><small>${T(String(j.date || '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1/$2/$3'))}${j.area ? '・' + T(j.area) : ''}・${T(j.salary || '薪資面議')}</small><p>${T(j.why)}</p>${u ? `<a href="${escapeHtml(u)}" target="_blank" rel="noopener">看 104 職缺 ↗</a>` : ''}</div>`; }).join('') || '<p class="rs-sub">這次沒有挑出值得看的職缺。</p>'}</div>
        <p class="rs-sub">只當開口理由：公司自己在 104 刊的缺，對方多半是自己在找人，價值放在難補、開很久的缺。</p>
      </div>
      <div data-rs-pane="talk" hidden>
        <h4 class="rs-h">可以跟人資聊的話題</h4><div class="rs-topics">${topics}</div>
        <h4 class="rs-h">事實 → 推論 → 要問的</h4>${facts}
        <h4 class="rs-h">60 秒開場</h4><div class="rs-say">${T(r.opening)}</div>
        <h4 class="rs-h">三個一定要問的</h4><ul class="rs-ul">${(r.questions || []).map((x) => `<li><b>${T(x.q)}</b><br><small>要驗證：${T(x.verify)}</small></li>`).join('')}</ul>
      </div>
      <div data-rs-pane="view" hidden>
        <h4 class="rs-h">員工與面試者怎麼看（每個平台都有查）</h4>
        <div class="rs-plat">${(r.platforms || []).map((p) => `<span class="${p.status === '有資料' ? 'y' : p.status === '部分' ? 'p' : 'n'}" title="${T(p.note)}"><b>${T(p.name)}</b>${T(p.status)}<small>${T(p.note)}</small></span>`).join('') || '<p class="rs-sub">這次沒有平台紀錄。</p>'}</div>
        ${(r.employee || []).length ? `<table class="rs-tbl"><thead><tr><th>日期／來源</th><th>職務／地點</th><th>看到什麼</th><th>要小心</th></tr></thead><tbody>${(r.employee || []).map((x) => `<tr><td>${T(x.date)}<br><small>${T(x.src)}</small></td><td>${T(x.role)}<br><small>${T(x.place)}</small></td><td><span class="rs-tone ${x.tone === '正面' ? 'y' : x.tone === '負面' ? 'n' : ''}">${T(x.tone)}</span> ${T(x.obs)}</td><td>${T(x.limit)}</td></tr>`).join('')}</tbody></table>` : ''}
        ${r.employee_note ? `<div class="rs-read">${T(r.employee_note)}</div>` : ''}
        <h4 class="rs-h">外界評價與可驗證的事件</h4>${rep}<p class="rs-sub">匿名評論和單一事件不能代表整家公司，這裡只列出來讓你知道，不是拿來質疑對方。</p></div>
      <div data-rs-pane="gap" hidden>
        <h4 class="rs-h">這些 AI 沒查到，請自己補</h4>${li(r.unknowns)}
        <h4 class="rs-h">對我們開發的風險</h4><div class="rs-risk">${li(r.risks)}</div>
      </div>
      <div data-rs-pane="act" hidden>
        <div class="rs-plan"><div><h4>今天</h4>${li(plan.today)}</div><div><h4>七天內</h4>${li(plan.week)}</div><div><h4>三十天內</h4>${li(plan.month)}</div></div>
        <h4 class="rs-h">我讀懂了嗎？（打電話前，用自己的話寫，寫完才算準備好）</h4>
        ${(r.selfcheck || []).map((q, i) => `<label class="rs-q">${T(q)}<textarea rows="2" data-rs-sc="${i}" placeholder="寫在這裡（只存在這台瀏覽器，不會送出）"></textarea></label>`).join('')}
        <details class="rs-src"><summary>資料來源（${(r.sources || []).length}）</summary><ul class="rs-ul">${src}</ul></details>
      </div>
    </div>`;
  },

  // 認識公司頂端：「請 AI 研究這家公司」按鈕＋狀態（每家公司都一樣，不限特定職缺）
  bdResearchBar: (pf, company) => {
    const st = pf && pf.research_status;
    const busy = st === 'queued' || st === 'working';
    const has = !!(pf && pf.research_json);
    const msg = busy ? `AI 正在查（${st === 'queued' ? '排隊中' : '研究中'}），約 10～20 分鐘，好了 TG 客戶群組會通知；重開這張卡片就看得到。`
      : st === 'error' ? `上次沒成功：${text(pf.research_error || '')}。可以再按一次。`
      : has ? `上次研究：${text(String(pf.research_at || pf.updated_at || '').slice(0, 16))}` : '還沒有研究卡。按下去，AI 會去查這家公司的公開資料和 104 職缺。';
    return `<div class="rs-bar"><button type="button" class="btn ${has ? '' : 'primary'}" data-rs-go="${escapeHtml(company || '')}" ${busy ? 'disabled' : ''}>${busy ? '研究中…' : (has ? '🔄 重新研究這家公司' : '🔍 請 AI 研究這家公司')}</button><span class="rs-sub">${msg}</span></div>`;
  },
  // 2026-10-13 Jacky：認識公司可以切「預覽模式」（打電話前快速看）和「設定模式」（直接改每一格）
  bdProfileModes: (pf, company) => {
    const f = pf || {};
    const F = [['website', '官網', 'input'], ['industry', '產業', 'input'], ['scale', '規模', 'input'], ['business', '他們做什麼', 'ta'], ['org', '主管與組織', 'ta'], ['hiring', '目前徵才狀況', 'ta'], ['topics', '可以聊的話題', 'ta']];
    const ai = String(f.updated_by || '').includes('AI');
    return `<div class="bdk" data-bdk="${escapeHtml(company)}">
      <div class="bdc-seg bdk-mode" role="radiogroup" aria-label="模式"><label><input type="radio" name="bdk-m" value="view" checked><span>預覽模式</span></label><label><input type="radio" name="bdk-m" value="edit"><span>設定模式</span></label></div>
      <div data-bdk-view>${views.bdResearchBar(pf, company)}${views.bdResearchCard(pf, company)}${views.bdResearchCard(pf, company) ? `<details class="rs-old"><summary>舊版文字介紹（每行一項）</summary>${views.bdProfilePane(pf)}</details>` : views.bdProfilePane(pf)}</div>
      <div data-bdk-edit hidden>
        ${ai ? '<div class="bdj-lock" style="background:#eaf1ff;border-color:#b7cdfa;color:#1d4fb8">這頁內容是 <b>AI 夜間研究</b>先查好的，可能有錯，請核對。你改過的格子存下去之後，夜間研究不會蓋掉。</div>' : ''}
        <div class="bdj-grid">${F.map(([k, lb, t]) => `<label class="bdj-f${t === 'ta' || k === 'website' ? ' full' : ''}">${lb}${t === 'ta' ? `<textarea data-bdk-k="${k}" rows="3">${text(f[k] || '')}</textarea>` : `<input data-bdk-k="${k}" value="${escapeHtml(f[k] || '')}">`}</label>`).join('')}</div>
        <p class="help">改完離開欄位就自動存。近期新聞與資料來源由 AI 夜間研究更新，這裡不能改。${f.updated_at ? `最後更新 ${text(String(f.updated_at).slice(0, 16))}${f.updated_by ? `・${text(f.updated_by)}` : ''}` : ''}</p>
      </div></div>`;
  },
  // 通話心得（2026-09-29 Jacky）：放在客戶卡片最上面的切入點下面。顧問談完一家記下
  // 學到什麼／下一通怎麼講／遇到的問題，每一則累積、新的在上面，下一個打電話的人先看這裡。
  // 2026-09-30：電洽逐字稿 AI 評分卡（客戶卡片通話心得區、AI 找的人小卡共用）
  transcriptReview: (t) => {
    if (!t) return '';
    const when = `${text(String(t.created_at || '').slice(5, 16))}${t.caller ? '・' + text(t.caller) : ''}`;
    if (t.ai_status === 'pending') return `<div class="trv trv-wait"><b>AI 分析中</b><small>逐字稿已收到（${when}），約 1～3 分鐘後重開卡片就看得到分數與建議。</small></div>`;
    if (t.ai_status === 'error') return `<div class="trv trv-err"><b>AI 分析失敗</b><small>${when}，請再上傳一次；還是不行跟 Jacky 說。</small></div>`;
    let d = null;
    try { d = JSON.parse(t.ai_json || 'null'); } catch { d = null; }
    if (!d) return '';
    const axes = (d.axes || []).map((a) => `<span class="trv-axis"><b>${text(a.name)}</b>${a.score === null || a.score === undefined ? '—' : text(a.score)}</span>`).join('');
    const imps = (d.improvements || []).map((x) => `<li>${x.original ? `<span class="trv-old">原本：「${text(x.original)}」</span>` : ''}<span class="trv-new">建議：「${text(x.better)}」</span>${x.why ? `<small>${text(x.why)}</small>` : ''}</li>`).join('');
    const pr = d.prospect, cd = d.candidate;
    const judge = pr ? `<p class="trv-judge"><b>對方興趣：${text(pr.interest || '—')}</b>${pr.interest_reason ? `（${text(pr.interest_reason)}）` : ''}<br><b>建議下一步：${text(pr.next_step || '—')}</b>${pr.next_step_detail ? `・${text(pr.next_step_detail)}` : ''}</p>`
      : cd ? `<p class="trv-judge"><b>意願：${text(cd.willingness || '—')}</b>${cd.willingness_reason ? `（${text(cd.willingness_reason)}）` : ''}<br><b>適配度：${text(cd.fit || '—')}</b>${cd.fit_reason ? `（${text(cd.fit_reason)}）` : ''}<br><b>建議下一步：${text(cd.next_step || '—')}</b>${cd.next_step_detail ? `・${text(cd.next_step_detail)}` : ''}<small>（AI 判斷僅供顧問參考）</small></p>` : '';
    return `<details class="trv" open><summary><span class="trv-score">${text(d.score)}<small>分</small></span><span>AI 看電洽逐字稿<small>${when}</small></span></summary>
${d.summary ? `<p>${text(d.summary)}</p>` : ''}<div class="trv-axes">${axes}</div>${judge}
${imps ? `<h4>下一通更好的講法</h4><ol class="trv-imps">${imps}</ol>` : ''}</details>`;
  },
  bdNotesBlock: (company, notes, people, assignedTo, transcripts) => {
    const ns = Array.isArray(notes) ? notes : [];
    const tr = (Array.isArray(transcripts) ? transcripts : [])[0];
    const item = (n) => `<article class="bdn-item"><small>${text(String(n.created_at || '').slice(0, 16))}・${text(n.author || '顧問')}</small><button type="button" class="btn ghost sm bd-del" data-action="bd-delete-record" data-kind="note" data-id="${escapeHtml(n.id)}" data-company="${escapeHtml(company || '')}">刪除</button>
${n.learned ? `<p><b>學到什麼</b>${text(n.learned)}</p>` : ''}${n.next_time ? `<p><b>下一通怎麼講</b>${text(n.next_time)}</p>` : ''}${n.problem ? `<p class="bdn-problem"><b>遇到的問題</b>${text(n.problem)}</p>` : ''}</article>`;
    return `<section class="bdn"><div class="bdn-head"><h3>通話心得${ns.length ? `（${ns.length}）` : ''}</h3>${actionBtn('＋ 新增心得', 'bd-note-create', { idParams: { company }, record: { author: assignedTo || '', _people: people || [] } }, 'primary')}</div>
${tr ? views.transcriptReview(tr) : ''}
${ns.length ? `<div class="bdn-list">${ns.map(item).join('')}</div>` : '<p class="help" style="margin:4px 0 0">還沒有人寫過心得。談完這家，記一下學到什麼、下一通怎麼講。</p>'}</section>`;
  },
  // 2026-10-02 Jacky：「通話心得除了改進建議，也要能持續新增通話紀錄，讓顧問知道目前跟客戶的進度」
  // →「通話紀錄與進度」兩個分頁：進度（每一通的結果、談到哪、下一步，新的在上）／AI 建議（逐字稿評分＋心得）。
  // 最上面一行「目前進度」：最新一通談到哪＋這家的下一步（跟「跟進」卡片同一份資料）。

  // 2026-10-14 依職缺開發：104 最近有刊某類職缺的公司，顧問挑過才進開發進度（Jacky：ph 要針對有發布財務職缺的企業開發）
  hiringLeadsTab: (data, ui) => {
    const leads = (data && data.leads) || [];
    const cats = (data && data.categories) || [];
    const cur = (data && data.category) || '財務會計';
    const cons = ui.consultants || [];
    const opt = (v, label, c) => `<option value="${escapeHtml(v)}" ${String(c || '') === String(v) ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    const fmt = (d) => String(d || '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$2/$3');
    const names = cons.filter((c) => c.is_active).map((c) => c.display_name);
    const show = ui.hlShow || 'new';
    const age = ui.hlAge || '';
    const cutoff = age ? new Date(Date.now() - Number(age) * 864e5).toISOString().slice(0, 10).replace(/-/g, '') : '';
    const rows = leads.filter((l) => {
      if (cutoff && String(l.latest_date || '') < cutoff) return false;
      if (show === 'new') return l.status === 'new' && !l.existing;
      if (show === 'done') return l.status !== 'new' || l.existing;
      return true;
    });
    const nNew = leads.filter((l) => l.status === 'new' && !l.existing).length;
    const head = `<div class="notice" style="margin:0 0 12px"><b>這裡的公司都還沒聯繫過。</b>是 104 最近 30 天有刊「${text(cur)}」主管級職缺的公司；已排除人力公司、已在開發進度和客戶名單的。<b>對方多半是自己在找人</b>，職缺只當開口理由，話術先承認他們自己在找，再講我們另一個人選池。</div>
      <div class="filters"><label class="am-me">我是 <select data-cb-me>${opt('', '選擇…', ui.me)}${names.map((n) => opt(n, n, ui.me)).join('')}</select></label>
      <label>職缺類別 <select data-hl-cat>${(cats.length ? cats : [{ category: cur }]).map((c) => opt(c.category, `${c.category}${c.n ? `（${c.n}）` : ''}`, cur)).join('')}</select></label>
      <label>負責人 <select data-hl-assignee>${opt('', '＝我自己', ui.hlAssignee)}${names.map((n) => opt(n, n, ui.hlAssignee)).join('')}</select></label>
      <label>顯示 <select data-hl-show>${opt('new', `還沒處理（${nNew}）`, show)}${opt('done', '已處理／已在開發中', show)}${opt('all', '全部', show)}</select></label>
      <label>刊登時間 <select data-hl-age>${opt('', '30 天內', age)}${opt('7', '7 天內', age)}${opt('3', '3 天內', age)}</select></label>
      <span class="help">名單每天自動更新一次${cats.length && cats[0].updated ? `（最後更新 ${text(String(cats[0].updated).slice(5, 16))}）` : ''}</span></div>`;
    if (!rows.length) return head + empty('這個條件下沒有公司', show === 'new' ? '全部都處理過了，或把「刊登時間」放寬。' : '換個條件看看。');
    const row = (l) => {
      const jobs = l.jobs || [];
      const tag = l.existing === 'client' ? '<span class="badge danger">已經是客戶</span>' : l.existing === 'bd' ? '<span class="badge">已在開發進度</span>' : '';
      const done = l.status === 'picked' ? `<span class="badge success">已加入開發進度・${text(l.decided_by || '')}</span>` : l.status === 'dropped' ? `<span class="badge">不要・${text(l.decided_by || '')}</span>` : '';
      return `<div class="list-row cb-row" data-hl-id="${escapeHtml(l.id)}"><span style="flex:1 1 360px"><b>${text(l.company)}</b> ${tag}
        <small>${jobs.slice(0, 3).map((j) => `${j.url ? `<a href="${escapeHtml(j.url)}" target="_blank" rel="noopener">${text(j.job)} ↗</a>` : text(j.job)}（${text(fmt(j.date))}${j.area ? `・${text(j.area)}` : ''}${j.salary ? `・${text(j.salary)}` : ''}）`).join('<br>')}${l.job_count > 3 ? `<br><span class="muted">另外還有 ${text(l.job_count - 3)} 個</span>` : ''}</small></span>
        <span class="actions-row">${l.existing ? '' : (l.status === 'dropped' ? done : `${done || '<button type="button" class="btn primary sm" data-hl-act="pick">加入開發進度</button>'}${l.status === 'new' ? '<button type="button" class="btn sm" data-hl-act="drop">不要</button>' : ''}`)}</span></div>`;
    };
    return head + `<div class="card"><div class="list">${rows.map(row).join('')}</div></div>`;
  },
  // 2026-10-02 人選敲門名單：AI 依人選找的公司，顧問篩過才進開發進度（Jacky：不要讓人以為電洽過）
  candBdTab: (data, ui) => {
    const runs = (data && data.runs) || [];
    const cons = ui.consultants || [];
    const opt = (v, label, cur) => `<option value="${escapeHtml(v)}" ${String(cur || '') === String(v) ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    const ANG = { '同業': 'info', '在徵類似職缺': 'success', '擴編展店': 'warning', '經歷對得上': 'success', '人選想轉的方向': 'warning' };
    const head = `<div class="notice" style="margin:0 0 12px"><b>這裡的公司都還沒聯繫過。</b>是 104 最近 30 天真的在徵、AI 看過職缺內容和人選電洽需求挑出來的；「經歷對得上」是主要名單，「人選想轉的方向」參考用。按「加入開發進度」才會進開發進度、開始電訪。</div>
      <div class="filters"><label class="am-me">我是 <select data-cb-me>${opt('', '選擇…', ui.me)}${cons.filter((c) => c.is_active).map((c) => opt(c.display_name, c.display_name, ui.me)).join('')}</select></label>
      <span class="help">名單從人選卡片按「拿這位人選去開發客戶」產生</span></div>`;
    if (!runs.length) return head + empty('還沒有人選敲門名單', '打開一位人選卡片，按「拿這位人選去開發客戶」。');
    const ST = { queued: ['AI 找名單中（約 3～5 分鐘）', 'info'], done: ['', ''], failed: ['失敗', 'danger'] };
    const run = (r, idx) => {
      const ts = r.targets || [];
      const left = ts.filter((t) => t.status === 'new');
      const row = (t) => {
        const ex = t.existing === 'client' ? '<span class="badge danger">已經是客戶</span>' : (t.existing === 'bd' ? '<span class="badge">已在開發進度</span>' : '');
        const done = t.status === 'picked' ? `<span class="badge success">已加入開發進度・${text(t.decided_by || '')}</span>`
          : t.status === 'dropped' ? `<span class="badge">不要・${text(t.decided_by || '')}</span>` : '';
        return `<div class="list-row cb-row" data-cb-id="${escapeHtml(t.id)}"><span style="flex:1 1 320px"><b>${text(t.company)}</b> ${t.angle ? `<span class="badge ${ANG[t.angle] || ''}">${text(t.angle)}</span>` : ''} ${ex}
          <small>${text(t.why || '')}${t.job_hint ? `｜${t.job_url ? '104 在徵' : '可能職缺'}：${text(t.job_hint)}` : ''}${t.job_url ? ` <a href="${escapeHtml(t.job_url)}" target="_blank" rel="noopener">看 104 職缺 ↗</a>` : ''}</small></span>
          <span class="actions-row">${t.existing === 'client' ? '' : (t.status === 'dropped' ? done : `${done || `<button type="button" class="btn primary sm" data-cb-act="pick">加入開發進度</button>`}<button type="button" class="btn sm" data-cb-act="mail" data-cb-company="${escapeHtml(t.company)}" title="自動加入開發進度，打開寄信頁（已選好「手上有人選」、帶入匿名重點）">寄信</button>${done ? '' : '<button type="button" class="btn ghost sm" data-cb-act="drop">不要</button>'}`)}</span></div>`;
      };
      const st = ST[r.status] || ['', ''];
      // 2026-10-02 Jacky：名單要能展開收合——最新一筆預設展開，其他收起來
      return `<details class="card cb-run" data-cb-brief="${escapeHtml(r.brief || '')}"${idx === 0 ? ' open' : ''}><summary class="card-head cb-sum" style="flex-wrap:wrap;gap:6px"><span class="cb-caret" aria-hidden="true">▸</span><h3 style="margin:0;font-size:15px">拿 <button type="button" class="am-name" data-cb-open="${escapeHtml(r.application_id)}">${text(r.candidate_name || '人選')}</button> 去開發</h3>
          <small class="muted">${text(r.job_title || '')}・${text(String(r.created_at || '').slice(5, 16))}・${text(r.requested_by || '')}${r.status === 'done' ? `・剩 ${left.length} 家沒處理` : ''}</small>
          ${st[0] ? `<span class="badge ${st[1]}">${text(st[0])}</span>` : ''}</summary>
        ${r.error ? `<p class="notice">${text(r.error)}</p>` : ''}
        ${r.brief ? `<div class="cb-brief"><b>匿名人選重點（開口用）</b><ul>${String(r.brief).split('\n').filter(Boolean).map((x) => `<li>${text(x)}</li>`).join('')}</ul></div>` : ''}
        ${(() => {
          // 2026-10-06 Jacky：經歷對得上的是主要名單；人選自己想轉的方向另列一區，顧問自己判斷要不要打
          const exp = ts.filter((t) => t.angle !== '人選想轉的方向'), dir = ts.filter((t) => t.angle === '人選想轉的方向');
          if (!dir.length) return ts.length ? `<div class="list">${ts.map(row).join('')}</div>` : (r.status === 'done' ? '<p class="help">104 最近 30 天沒有經歷對得上的職缺，這次 0 家。</p>' : '');
          return `<h4 class="cb-sec">經歷對得上（${exp.length}）</h4>${exp.length ? `<div class="list">${exp.map(row).join('')}</div>` : '<p class="help">104 最近 30 天沒有經歷直接對得上的職缺。</p>'}
            <h4 class="cb-sec">人選想轉的方向（${dir.length}）<small class="muted">他過去沒做過這個產業，企業買單機率較低，參考用</small></h4><div class="list">${dir.map(row).join('')}</div>`;
        })()}
      </details>`;
    };
    return head + `<div class="cb-runs">${runs.map(run).join('')}</div>`;
  },
  bdProgressBlock: (company, { calls, notes, transcripts, status, people, assignedTo, oid }) => {
    const RES = { interested: ['有興趣', 'success'], got_email: ['拿到信箱', 'info'], got_contact: ['問到窗口', 'info'], no_answer: ['沒接', ''], gatekeeper: ['被總機擋', 'warning'], not_hiring: ['沒在徵人', ''], not_interested: ['拒絕', 'danger'] };
    const cs = (Array.isArray(calls) ? calls : []).slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const ns = Array.isArray(notes) ? notes : [];
    const ts = (Array.isArray(transcripts) ? transcripts : []).filter((t) => t.ai_status !== 'error' || true);
    const st = status || {};
    const md = (d) => String(d || '').slice(5, 10).replace('-', '/');
    const lastTalk = cs.find((c) => String(c.note || '').trim());
    const nextTxt = [st.next_action ? (views.FOLLOW_ACTS[st.next_action] || '') : '', st.next_due ? md(st.next_due) : '', st.next_step ? String(st.next_step).split('\n')[0].slice(0, 60) : ''].filter(Boolean).join('・');
    const summary = cs.length || nextTxt ? `<div class="bdp-now">
        <p><b>目前進度</b>${lastTalk ? `${text(md(lastTalk.created_at))} ${text((RES[lastTalk.result] || [lastTalk.result])[0])}：${text(String(lastTalk.note).slice(0, 80))}` : (cs[0] ? `${text(md(cs[0].created_at))} ${text((RES[cs[0].result] || [cs[0].result])[0])}（沒記談到哪）` : '還沒有通話紀錄')}</p>
        <p><b>下一步</b>${nextTxt ? text(nextTxt) : (cs[0] && cs[0].retry_at ? `${text(md(cs[0].retry_at))} 再打（系統排的）` : '還沒決定——記下一通時順手填')} ${st.next_due ? views.followDueTag(st.next_due) : ''}</p>
      </div>` : '';
    const aiShort = (t) => {
      let d = null; try { d = JSON.parse(t.ai_json || 'null'); } catch { d = null; }
      const pr = d && d.prospect;
      return pr ? `AI：對方興趣 ${text(pr.interest || '—')}｜建議下一步 ${text(pr.next_step || '—')}` : (t.ai_status === 'pending' ? 'AI 分析中' : '');
    };
    const entries = [
      ...cs.map((c) => ({ at: c.created_at, html: `<article class="bdp-item">
        <div class="bdp-top"><small>${text(String(c.created_at || '').slice(5, 16))}・${text(c.caller || '顧問')}</small><span class="badge ${(RES[c.result] || [])[1] || ''}">${text((RES[c.result] || [c.result])[0])}</span>
          <button type="button" class="btn ghost sm bd-del" data-action="bd-delete-record" data-kind="call" data-id="${escapeHtml(c.id)}" data-company="${escapeHtml(company || '')}">刪除</button></div>
        ${c.note ? `<p><b>談到哪</b>${text(c.note)}</p>` : ''}
        ${[c.contact_name ? `窗口 ${text(c.contact_name)}` : '', c.hr_phone ? `電話 ${text(c.hr_phone)}` : '', c.email ? `信箱 ${text(c.email)}` : ''].filter(Boolean).length ? `<small>問到：${[c.contact_name ? `窗口 ${text(c.contact_name)}` : '', c.hr_phone ? `電話 ${text(c.hr_phone)}` : '', c.email ? `信箱 ${text(c.email)}` : ''].filter(Boolean).join('・')}</small>` : ''}
        ${c.retry_at ? `<small>系統排 ${text(md(c.retry_at))} 再打</small>` : ''}</article>` })),
      // 2026-10-05 Jacky：每一通要看得到「AI 整理好的紀錄」跟「原始逐字稿」，不是只有一行
      ...ts.filter((t) => aiShort(t) || t.transcript).map((t) => {
        let d = null; try { d = JSON.parse(t.ai_json || 'null'); } catch { d = null; }
        const pr = d && d.prospect;
        return { at: t.created_at, html: `<article class="bdp-item bdp-ai"><div class="bdp-top"><small>${text(String(t.created_at || '').slice(5, 16))}・${text(t.caller || '顧問')}</small><span class="badge">電話逐字稿</span></div>
        ${d && Array.isArray(d.call_record) && d.call_record.length
          ? `<div class="bdp-record"><b>AI 整理的通話紀錄</b><ul>${d.call_record.map((x) => `<li>${text(x)}</li>`).join('')}</ul></div>`
          : (t.ai_status === 'pending' ? '<small>AI 整理中，約 1～3 分鐘後重開卡片</small>' : (d ? '<small class="muted">這通是舊版分析，沒有通話紀錄；需要的話重新上傳逐字稿</small>' : ''))}
        ${pr ? `<p><b>對方興趣</b>${text(pr.interest || '—')}${pr.interest_reason ? `（${text(pr.interest_reason)}）` : ''}</p><p><b>建議下一步</b>${text(pr.next_step || '—')}${pr.next_step_detail ? `・${text(pr.next_step_detail)}` : ''}</p>` : ''}
        ${t.transcript ? `<details class="bdp-raw"><summary>原始逐字稿（${String(t.transcript).length} 字）</summary><div class="bdp-raw-text">${text(t.transcript)}</div></details>` : ''}
        <small class="muted">講法建議與評分看「AI 建議」分頁</small></article>` };
      }),
    ].sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const noteItem = (n) => `<article class="bdn-item"><small>${text(String(n.created_at || '').slice(0, 16))}・${text(n.author || '顧問')}</small><button type="button" class="btn ghost sm bd-del" data-action="bd-delete-record" data-kind="note" data-id="${escapeHtml(n.id)}" data-company="${escapeHtml(company || '')}">刪除</button>
${n.learned ? `<p><b>學到什麼</b>${text(n.learned)}</p>` : ''}${n.next_time ? `<p><b>下一通怎麼講</b>${text(n.next_time)}</p>` : ''}${n.problem ? `<p class="bdn-problem"><b>遇到的問題</b>${text(n.problem)}</p>` : ''}</article>`;
    const aiCount = ts.length + ns.length;
    const addBtn = oid ? actionBtn('＋ 新增通話紀錄', 'bd-call-log', { idParams: { id: oid, company }, record: { caller: '' } }, 'primary') : '<span class="help">這家還沒有開發紀錄，先在開發進度按「記錄電話結果」</span>';
    return `<section class="bdn bdp" data-bdp>
      <div class="bdn-head"><h3>通話紀錄與進度</h3>${addBtn}</div>
      ${summary}
      <div class="tabs tabs-sub bdp-tabs" role="tablist"><button type="button" class="active" data-bdp-tab="log" role="tab" aria-selected="true">進度（${cs.length}）</button><button type="button" data-bdp-tab="ai" role="tab" aria-selected="false">AI 建議（${aiCount}）</button></div>
      <div data-bdp-pane="log">${entries.length ? `<div class="bdp-list">${entries.map((e) => e.html).join('')}</div>` : '<p class="help">還沒有通話紀錄。打完電話按「＋ 新增通話紀錄」，寫談到哪、下一步。</p>'}</div>
      <div data-bdp-pane="ai" hidden>
        <div class="actions-row" style="margin:0 0 8px">${actionBtn('＋ 新增心得', 'bd-note-create', { idParams: { company }, record: { author: assignedTo || '', _people: people || [] } })}</div>
        ${ts.map((t) => views.transcriptReview(t)).join('')}
        ${ns.length ? `<div class="bdn-list">${ns.map(noteItem).join('')}</div>` : ''}
        ${!aiCount ? '<p class="help">記電話時附上逐字稿，AI 會評分、給下一通更好的講法；也可以自己寫心得。</p>' : ''}
      </div>
    </section>`;
  },
  // 2026-10-13 Jacky：AI 只用在「匯入電洽內容」——把原本進度卡片裡的「AI 建議」分頁獨立成一塊放在進度紀錄下面
  bdTranscriptBlock: (company, transcripts, notes, people, assignedTo) => {
    const ts = Array.isArray(transcripts) ? transcripts : [];
    const ns = Array.isArray(notes) ? notes : [];
    if (!ts.length && !ns.length) return '';
    return `<details class="bdc-ai" data-bdc-ai><summary>AI 整理與建議（${ts.length + ns.length}）<small class="muted">　來自上面「匯入電洽內容」</small></summary>
      <div class="actions-row">${actionBtn('＋ 新增心得', 'bd-note-create', { idParams: { company }, record: { author: assignedTo || '', _people: people || [] } })}</div>
      ${ts.map((t) => views.transcriptReview(t)).join('')}
      ${ns.length ? `<div class="bdn-list">${ns.map((n) => `<article class="bdn-item"><small>${text(String(n.created_at || '').slice(0, 16))}・${text(n.author || '顧問')}</small>${n.learned ? `<p><b>學到什麼</b>${text(n.learned)}</p>` : ''}${n.next_time ? `<p><b>下一通怎麼講</b>${text(n.next_time)}</p>` : ''}${n.problem ? `<p class="bdn-problem"><b>遇到的問題</b>${text(n.problem)}</p>` : ''}</article>`).join('')}</div>` : ''}
    </details>`;
  },
  // 切入點（2026-09-29 Jacky：本週計畫表寫的切入點，卡片上也要看得到）：新消息＞人選敲門＞104 職缺
  bdTriggerOf: (rows) => {
    const o = (rows || []).find((x) => String(x.why_company || '').includes('【觸發】'));
    return o ? String(o.why_company).split('【觸發】').pop().split(/來源[:：]|https?:\/\//)[0].replace(/[\s。；;（(]+$/, '').slice(0, 90) : '';
  },
  bdEntry: (trigger, hasCandidate, big, job, topic) => {
    const jobTxt = job ? String(job).split(/[，,、]/).slice(0, 2).join('、').slice(0, 40) : '';
    const [tag, how, cls] = trigger
      ? ['新消息', `${trigger}　→ 高手打法：先恭喜，再問這波人力怎麼規劃`, 'tr']
      : hasCandidate
        ? ['人選敲門', '手上有對得上的人選　→ 開口先講「我這有一位＿＿，要不要先看看背景？」', 'cand']
        : jobTxt
          ? ['現有職缺', `看到他們在徵「${jobTxt}」　→ 先承認「你們自己找得順就不打擾」，問這個缺開多久、難在哪，當難補缺的備案${topic ? `；也可以聊：${topic}` : ''}`, 'job']
          : topic
            ? ['可以聊的議題', `${topic}　→ 用這個問題開場，問人力怎麼規劃`, 'job']
            : ['先問需求', '沒有新消息也沒有已知職缺　→ 先問「最近哪個位置最難補？」', 'job'];
    return `<div class="bd-entry ${cls}${big ? ' big' : ''}"><b>切入點・${tag}</b><span>${text(how)}</span></div>`;
  },
  // 話術手冊（2026-09-29）：卡片裡的「話術快查」與獨立分頁共用。vars 有值就把 {公司}{職缺}{產業}{常補} 換成那一家的資料。
  scriptFill: (t, vars) => String(t).replace(/\{(公司|職缺|產業|常補)\}/g, (_, k) => (vars && vars[k]) || '＿＿'),
  scriptsBlock: (vars, compact) => `<div class="sc-wrap" data-sc-vars='${escapeHtml(JSON.stringify(vars || {}))}'>
      <input type="search" class="sc-search" placeholder="打關鍵字：已有獵頭、先寄資料、費用、忙、分機…" aria-label="搜尋話術">
      <div class="sc-cats"><button type="button" class="chip sc-fav-chip" data-sc-cat="fav">★ 我的最愛 <b data-sc-fav-n>0</b></button>${SCRIPT_CATS.map(([k, lb]) => `<button type="button" class="chip" data-sc-cat="${k}">${lb}</button>`).join('')}</div>
      <select class="sc-cat-select" aria-label="話術分類"><option value="">全部情境</option><option value="fav">★ 我的最愛</option>${SCRIPT_CATS.map(([k, lb]) => `<option value="${k}">${lb}</option>`).join('')}</select>
      <p class="help sc-fav-tip">點每段話術右邊的星星加入最愛，最愛會固定排在最上面、直接展開，打電話時照著唸就好（存在這台裝置）。</p>
      <div class="sc-list">${SCRIPTS.map((x, i) => {
        const line = views.scriptFill(x.a, vars);
        return `<details class="sc-item" data-sc-id="${escapeHtml(x.q)}" data-sc-cat-of="${x.cat}" data-sc-text="${escapeHtml((x.q + ' ' + x.a + ' ' + (x.tags || '')).toLowerCase())}"${compact ? ' hidden' : ''}>
          <summary><span class="sc-q">${x.cat === 'jacky' ? '<span class="badge info">Jacky 親授</span> ' : ''}${text(views.scriptFill(x.q, vars))}</span><button type="button" class="sc-star" data-sc-star aria-pressed="false" aria-label="加入我的最愛" title="加入我的最愛"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9z"/></svg></button></summary>
          <p class="cg-say">${text(line)}</p>
          <button type="button" class="btn ghost sm" data-copy-text="${escapeHtml(line)}">複製這段</button>
        </details>`;
      }).join('')}</div>
      ${compact ? '<p class="help sc-hint">點上面的情境或打關鍵字，話術就會出現（已經換成這家的資料）。加了星星的最愛會直接顯示在這裡。</p>' : ''}
    </div>`,
  scriptsTab: () => `<article class="card"><div class="card-head"><h2 style="margin:0;font-size:16px">話術手冊</h2></div>
      <p class="help" style="margin:6px 0 12px">打電話開發客戶時隨手查。來源：Jacky 親授（最優先）、開發信框架、國外研究；費用一律照正職代招委託合約。每家客戶卡片的「開發引導」最上面也有同一份「話術對照」，會自動換成那一家的公司、職缺、產業。</p>
      ${views.scriptsBlock(null, false)}</article>`,
  // 2026-09-29 加：企業卡片補聯絡方式（一鍵複製／撥號）、資料來源連結、
  // 104 企業頁連結，另外加「開發引導」分頁（時間軸／信件 之外的第二個分頁）。
  // 找不到的欄位一律不顯示那一行，不留空殼。
  // 2026-09-30 Jacky：對方有興趣之後，寄公司介紹＋合約。擬好先送 TG，Jacky 或 Phoebe 按核准才寄。
  // 2026-10-02 Jacky：「寄信就寄信，上面資訊太多，不要放在收尾裡面」→ 寄信獨立一頁，只放寄信要用的東西
  bdMailOnly: (d) => {
    const company = d.company || ((d.outreach || [])[0] || {}).company || '';
    return `<div class="bd-mail-only">
      <div class="actions-row" style="margin:0 0 4px"><button type="button" class="btn ghost sm" data-bd-company="${escapeHtml(company)}">← 看完整客戶卡片（進度、開發引導）</button></div>
      ${views.bdContractPackBlock(company, d.outreach || [], d.contract_files, d.assigned_to, d.pack_options)}
    </div>`;
  },
  bdContractPackBlock: (company, outreach, contractFiles, assignedTo, packOptions) => {
    const email = ([...(outreach || [])].reverse().find((o) => String(o.contact_email || '').trim()) || {}).contact_email || '';
    const packs = (outreach || []).filter((o) => o.scenario === 'contract_pack');
    const lastPack = packs[packs.length - 1];
    const ST = { pending: '等 Jacky／Phoebe 在 TG 核准', sending: '寄送中', sent: '已寄出', draft: '被退回', rejected: '不寄' };
    // 2026-10-02：合約跟匿名履歷放同一張表，用 contract_type 分（'匿名履歷'）
    const allFiles = Array.isArray(contractFiles) ? contractFiles : [];
    const files = allFiles.filter((f) => f.contract_type !== '匿名履歷');
    const cvFiles = allFiles.filter((f) => f.contract_type === '匿名履歷');
    const po = packOptions || views.PACK_OPTIONS_FALLBACK;
    return `<section class="cg-pack" data-pack-company="${escapeHtml(company)}" data-pack-by="${escapeHtml(assignedTo || '')}">
      <h4 style="margin:18px 0 6px">寄公司介紹／開發信</h4>
      <p class="help" style="margin-top:0">選「為什麼寄」和「強調什麼」，信會自動換一版；按「先看信的內容」可以直接改字。信裡不寫任何費用數字。擬好送 TG，Jacky 或 Phoebe 按核准才寄。</p>
      <div class="cg-row"><b>收件人</b><span>${email ? text(email) : '<input class="cg-in" data-pack-to type="email" placeholder="還沒有信箱，直接填在這裡（例：hr@company.com）" style="width:100%;min-width:240px">'}</span></div>
      <div class="cg-row"><b>署名</b><span>${assignedTo ? `${text(assignedTo)}｜Step1ne 德仁管理顧問有限公司` : '<span class="pc-status bad">還沒指派負責顧問</span>'}</span></div>
      <label class="field"><span>信件版本</span>${views.packStyleSelect('short', 'data-pack-style')}</label>
      <label class="field"><span>為什麼寄</span>${views.packScenarioSelect(po, (outreach || []).some((o) => String(o.why_company || '').includes('【官網主動詢問】')) && !(outreach || []).some((o) => o.call_result) ? 'inbound' : 'followup', 'data-pack-scenario')}</label>
      <label class="field"><span>強調什麼（可以不選）</span>${views.packAngleSelect(po, '', 'data-pack-angle')}</label>
      <label class="field" data-pack-brief-wrap hidden><span>人選背景重點（一行一個；不寫姓名、不寫目前任職公司）</span><textarea class="cg-in" data-pack-brief rows="3" placeholder="例：半導體設備 8 年，熟 PVD／CVD&#10;帶過 5 人團隊"></textarea></label>
      <div class="cg-row"><b>附件</b><span class="pack-attach"><label><input type="checkbox" data-pack-intro checked> 公司介紹（STEP1NE_企業人才招募解決方案.pdf）</label>
        ${cvFiles.length ? `<span class="pack-cvs"><b>匿名履歷（可複選）</b>${cvFiles.map((f, i) => `<label><input type="checkbox" data-pack-cv value="${escapeHtml(f.id)}"${i ? '' : ' checked'}> ${text(f.filename)}<small>（${text(String(f.created_at || '').slice(5, 16))}${f.uploaded_by ? ' ' + text(f.uploaded_by) : ''}）</small></label>`).join('')}</span>` : ''}
        ${files.length ? `<select class="cg-in" data-pack-contract><option value="">不附合約</option>${files.map((f, i) => `<option value="${escapeHtml(f.id)}"${i ? '' : ' selected'}>${f.contract_type ? `【${text(f.contract_type)}】` : ''}${text(f.filename)}（${text(String(f.created_at || '').slice(5, 16))}${f.uploaded_by ? ' ' + text(f.uploaded_by) : ''}）</option>`).join('')}</select>` : '<span class="muted">合約：還沒上傳（選填）</span>'}</span></div>
      <details class="pack-anon" data-pack-anon-box><summary><b>從人選挑匿名履歷附上</b>（系統做好的，可用姓名、負責顧問、配對過的職缺找；一封信最多 5 位）</summary>
        <div class="pack-anon-filter">
          <input class="cg-in" data-anon-q placeholder="姓名或代號（例：宋 或 A-01）" aria-label="姓名或代號">
          <select class="cg-in" data-anon-owner aria-label="負責顧問"><option value="">所有顧問</option></select>
          <select class="cg-in" data-anon-job aria-label="配對過的職缺"><option value="">所有職缺</option></select>
          <button type="button" class="btn sm" data-anon-search>找</button>
        </div>
        <div data-anon-results class="pack-cvs"><small class="muted">按「找」列出已做好的匿名履歷。還沒做的人選要先在人選卡片按「製作匿名履歷」。</small></div>
      </details>
      <div class="pack-upload"><label class="field"><span>上傳附件：合約或匿名履歷（選填；先選種類再選檔案，PDF／DOCX，8MB 內）</span>
        <span class="pack-upload-row"><select class="cg-in" data-pack-ctype>${[...(po.contract_types || []), '匿名履歷'].map((t) => `<option value="${escapeHtml(t)}">${t === '匿名履歷' ? '匿名履歷' : `合約：${text(t)}`}</option>`).join('')}</select>
        <input type="file" data-pack-file accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"></span></label></div>
      ${lastPack ? `<div class="notice" style="margin:8px 0">上一封：${text(ST[lastPack.status] || lastPack.status)}${lastPack.sent_at ? `（${text(String(lastPack.sent_at).slice(5, 16))} 寄出）` : ''}</div>` : ''}
      <div class="actions-row"><button type="button" class="btn" data-pack-preview>先看信的內容</button><button type="button" class="btn primary" data-pack-send>擬信並送 TG 核准</button></div>
      <div class="pack-edit" data-pack-out hidden>
        <p class="help">可以直接改字。改過的信，TG 上會標「顧問改過文字」讓 Jacky 看全文。</p>
        <div class="pack-meta" data-pack-meta></div>
        <label class="field"><span>主旨</span><input class="cg-in" data-pack-subj></label>
        <label class="field"><span>內文</span><textarea class="cg-in" data-pack-body rows="16"></textarea></label>
        <div class="actions-row" style="margin:6px 0 0"><button type="button" class="btn sm" data-pack-copy="subj">複製主旨</button><button type="button" class="btn sm" data-pack-copy="body">複製內文</button><small class="help" style="align-self:center">改好可以直接複製，貼到自己的信箱寄</small></div>
      </div>
    </section>`;
  },
  PACK_OPTIONS_FALLBACK: {
    scenarios: { inbound: '官網詢問回覆（對方主動留需求）', followup: '電話後補資料', has_job: '有缺在找', has_agency: '已有配合獵頭', no_job: '目前沒缺', candidate: '手上有人選', strengths: '介紹我們的優勢', sign: '準備簽約' },
    angles: { no_risk: '到職才收費，沒風險', hard_fill: '難補的缺、開很久的缺', confidential: '保密職缺', mass: '新廠／擴點大量招人', industry: '我們熟這個產業' },
    contract_types: ['正職代招', '高階獵頭', '人力派遣'],
  },
  packScenarioSelect: (po, sel, attr) => `<select class="cg-in" ${attr}>${Object.entries(po.scenarios || {}).map(([k, v]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${text(v)}</option>`).join('')}</select>`,
  packStyleSelect: (sel, attr) => `<select class="cg-in" ${attr}><option value="short"${sel !== 'full' ? ' selected' : ''}>簡短版（依情境，幾段話）</option><option value="full"${sel === 'full' ? ' selected' : ''}>完整介紹版（我們專注什麼、優勢、服務、全民獵才）</option></select>`,
  packAngleSelect: (po, sel, attr) => `<select class="cg-in" ${attr}><option value="">不特別強調</option>${Object.entries(po.angles || {}).map(([k, v]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${text(v)}</option>`).join('')}</select>`,
  // 2026-09-30 Jacky：每家客戶一張「跟進便利貼」——上次聯絡到哪、下一步做什麼、哪一天、備註。
  // 卡片最上面、「客戶跟進」分頁、開發進度列表是同一份資料（bd_company_status）。
  FOLLOW_ACTS: { call: '打電話', mail: '寄信', wait: '等對方回覆', meet: '約見面', pause: '先暫停' },
  FOLLOW_RES: { interested: '有興趣', not_interested: '拒絕', got_email: '拿到信箱', no_answer: '沒接', gatekeeper: '被總機擋', got_contact: '問到窗口', not_hiring: '沒在徵人', mail_sent: '信已寄出' },
  followDueTag: (due) => {
    if (!due) return '';
    const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    if (due < today) return '<span class="fu-tag late">過期</span>';
    if (due === today) return '<span class="fu-tag today">今天</span>';
    return '';
  },
  followLastLine: (lc) => {
    if (!lc) return '還沒有聯絡紀錄';
    const res = lc.result ? `：${views.FOLLOW_RES[lc.result] || lc.result}` : '';
    return `${String(lc.at || '').slice(5, 10).replace('-', '/')} ${lc.who || ''} ${lc.how || ''}${res}${lc.note ? `（${String(lc.note).slice(0, 60)}）` : ''}`;
  },
  followAi: (st) => {
    const a = st || {};
    const ai = a.ai || (a.ai_at ? { summary: a.ai_summary, action: a.ai_action, due: a.ai_due, memo: a.ai_memo, state: a.ai_state, at: a.ai_at } : null);
    if (!ai || ai.state !== 'new') return '';
    return `<div class="fu-ai" data-ai-box data-ai-action="${escapeHtml(ai.action || '')}" data-ai-due="${escapeHtml(ai.due || '')}" data-ai-memo="${escapeHtml(ai.memo || '')}">
      <b>AI 整理（待確認）</b>
      ${ai.summary ? `<p><span>聊到哪</span>${text(ai.summary)}</p>` : ''}
      <p><span>建議下一步</span>${text(views.FOLLOW_ACTS[ai.action] || '沒有建議')}${ai.due ? `・${text(ai.due.slice(5).replace('-', '/'))}` : ''}</p>
      ${ai.memo ? `<p><span>備註</span>${text(ai.memo)}</p>` : ''}
      <div class="actions-row"><button type="button" class="btn sm primary" data-ai-accept>採用</button><button type="button" class="btn sm ghost" data-ai-dismiss>不用</button><small class="help">${text(String(ai.at || '').slice(5, 16))} 整理</small></div>
    </div>`;
  },
  parkBtn: (company, parked, by) => parked
    ? `<button type="button" class="btn ghost sm" data-park="${escapeHtml(company)}" data-park-on="0" data-park-by="${escapeHtml(by || '')}">拉回來繼續跟進</button>`
    : `<button type="button" class="btn ghost sm fu-park" data-park="${escapeHtml(company)}" data-park-on="1" data-park-by="${escapeHtml(by || '')}">✕ 不用跟進，移到備選池</button>`,
  followFields: (st, attrPrefix) => {
    const a = st || {};
    return `${views.followAi(a)}<div class="fu-fields">
      <label class="field"><span>下一步</span><select class="cg-in" data-${attrPrefix}-action><option value="">還沒決定</option>${Object.entries(views.FOLLOW_ACTS).map(([k, v]) => `<option value="${k}"${a.next_action === k ? ' selected' : ''}>${text(v)}</option>`).join('')}</select></label>
      <label class="field"><span>哪一天 ${views.followDueTag(a.next_due)}</span><span class="fu-date"><input type="date" class="cg-in" data-${attrPrefix}-due value="${escapeHtml(a.next_due || '')}">
        <button type="button" class="btn ghost sm" data-due-quick="1">明天</button><button type="button" class="btn ghost sm" data-due-quick="3">3 天後</button><button type="button" class="btn ghost sm" data-due-quick="mon">下週一</button></span></label>
      <label class="field fu-memo"><span>備註（要做什麼、要注意什麼）</span><textarea class="cg-in" data-${attrPrefix}-memo rows="2" placeholder="例：寄完公司介紹，週五打去問看完沒；人資只收 Email">${escapeHtml([a.next_step, a.adjust_note].filter(Boolean).join('\n'))}</textarea></label>
    </div>`;
  },
  // 2026-10-12 Jacky：對方在官網表單留了什麼，打電話前一眼看到（資料在 company_leads，後台用公司名對上）。
  // 沒留過就整塊不出現；留過好幾次，新的在上面。
  bdWebInquiryBlock: (rows) => {
    if (!rows || !rows.length) return '';
    const PAGE_ZH = { '/commission-recruiting/': '企業委託招募頁' };
    const pageName = (pg) => PAGE_ZH[pg] || (String(pg || '').startsWith('/articles/') ? `文章 ${pg}` : (pg || '官網'));
    const item = (r) => `<div class="bd-web-item">
        <p class="bd-web-when">${text(String(r.at || '').slice(0, 16))}・從${text(pageName(r.page))}送出</p>
        <div class="bd-contact-row"><span>留言內容</span><b class="bd-web-msg">${r.message ? text(r.message) : '<span class="muted">（沒填）</span>'}</b></div>
        ${r.detail ? `<div class="bd-contact-row"><span>補充說明</span><b class="bd-web-msg" style="white-space:pre-wrap;font-weight:400">${text(r.detail)}</b></div>` : ''}
        <div class="bd-contact-row"><span>想用的方案</span>${r.plan ? text(r.plan) : '<span class="muted">沒選（不確定）</span>'}</div>
        ${r.contact_name ? `<div class="bd-contact-row"><span>聯絡人</span>${text(r.contact_name)}</div>` : ''}
        ${r.contact ? `<div class="bd-contact-row"><span>聯絡方式</span>${r.contact.includes('@') ? `<a href="mailto:${escapeHtml(r.contact)}">${text(r.contact)}</a>` : `<a href="tel:${escapeHtml(String(r.contact).replace(/[^0-9+#,]/g, ''))}">${text(r.contact)}</a>`}<button type="button" class="btn ghost sm" data-copy-text="${escapeHtml(r.contact)}">複製</button></div>` : ''}
        ${r.company && r.matched_by === 'email' ? `<div class="bd-contact-row"><span>表單上的公司名</span>${text(r.company)}</div>` : ''}
        ${r.extra_note ? `<div class="bd-contact-row"><span>內部補註</span><small>${text(r.extra_note)}</small></div>` : ''}
      </div>`;
    return `<div class="card bd-web-card"><h3 style="font-size:14px;margin:0 0 6px">官網留言${rows.length > 1 ? `（${rows.length} 次）` : ''}</h3>${rows.map(item).join('')}</div>`;
  },
  bdStatusBlock: (company, st, calls) => {
    const last = (calls || [])[calls ? calls.length - 1 : 0];
    const lc = last ? { at: last.created_at, who: last.caller, how: '電話', result: last.result, note: last.note } : null;
    return `<div class="card bd-status-card" data-status-company="${escapeHtml(company)}">
      <h3 style="font-size:14px;margin:0 0 6px">跟進</h3>
      <p class="fu-last"><b>上次聯絡</b>${text(views.followLastLine(lc))}</p>
      ${views.followFields(st, 'status')}
      ${st && st.parked_at ? `<div class="notice">這家在備選池（${text(String(st.parked_at).slice(5, 10))}${st.parked_by ? ' ' + text(st.parked_by) : ''}${st.parked_reason ? `：${text(st.parked_reason)}` : ''}）</div>` : ''}
      <div class="actions-row"><button type="button" class="btn sm primary" data-status-save>儲存</button>${views.parkBtn(company, !!(st && st.parked_at))}<small class="help" data-status-at>${st && st.updated_at ? `上次更新 ${text(String(st.updated_at).slice(5, 16))}${st.updated_by ? ' ' + text(st.updated_by) : ''}` : ''}</small></div>
    </div>`;
  },
  // 「客戶跟進」分頁：聯繫過的公司一頁看完，照「哪一天要做」排；下一步選「寄信」才出現寄信設定
  bdWrapup: ({ rows, scenarios, angles, contract_types }) => {
    const po = { scenarios, angles, contract_types };
    const ST = { pending: '等 Jacky／Phoebe 核准', sending: '寄送中', sent: '已寄出', draft: '被退回', rejected: '不寄' };
    const people = [...new Set(rows.map((r) => r.assigned_to).filter(Boolean))];
    const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    const needs = (r) => !r.parked_at && r.next_action !== 'pause' && (!r.next_due || r.next_due <= today);
    const card = (r) => {
      const why = !r.email ? '缺信箱' : (!r.assigned_to ? '還沒指派負責顧問' : '');
      const pendingPack = r.last_pack && ['pending', 'sending'].includes(r.last_pack.status);
      const block = why || (pendingPack ? '已經有一封在等核准' : '');
      return `<article class="wu-row" data-wu-company="${escapeHtml(r.company)}" data-wu-assignee="${escapeHtml(r.assigned_to || '')}" data-wu-needs="${needs(r) ? 1 : 0}" data-wu-parked="${r.parked_at ? 1 : 0}">
        <div class="wu-title"><button type="button" class="linklike" data-bd-company="${escapeHtml(r.company)}">${text(r.company)}</button>
          <small>負責：${text(r.assigned_to || '未指派')}${r.job_title ? `・職缺：${text(r.job_title)}` : ''}${r.email ? `・${text(r.email)}` : ''}</small>
          <p class="fu-last"><b>上次聯絡</b>${text(views.followLastLine(r.last_contact))}</p>
        </div>
        ${views.followFields(r, 'wu')}
        ${r.parked_at ? `<div class="notice">在備選池：${text(String(r.parked_at).slice(5, 10))}${r.parked_by ? ' ' + text(r.parked_by) : ''}${r.parked_reason ? `｜${text(r.parked_reason)}` : ''}</div>` : ''}
        <div class="wu-foot"><button type="button" class="btn sm primary" data-wu-save>儲存</button>${views.parkBtn(r.company, !!r.parked_at, r.assigned_to)}<small class="help" data-wu-saved>${r.status_updated_at ? `上次更新 ${text(String(r.status_updated_at).slice(5, 16))}${r.status_updated_by ? ' ' + text(r.status_updated_by) : ''}` : ''}</small></div>
        <div class="wu-mail" ${r.next_action === 'mail' ? '' : 'hidden'}>
          <div class="wu-mail-head"><label class="wu-inline"><input type="checkbox" data-wu-pick${block ? ' disabled' : ''}> 放進這次要寄的信</label>${block ? `<small class="wu-block">不能勾：${text(block)}</small>` : ''}${r.last_pack ? `<small class="help">上一封：${text(ST[r.last_pack.status] || r.last_pack.status)}${r.last_pack.sent_at ? ` ${text(String(r.last_pack.sent_at).slice(5, 10))}` : ''}</small>` : ''}</div>
          <div class="wu-grid">
            <label class="field"><span>信件版本</span>${views.packStyleSelect('short', 'data-wu-style')}</label>
            <label class="field"><span>寄什麼信</span>${views.packScenarioSelect(po, r.suggested_scenario, 'data-wu-scenario')}</label>
            <label class="field"><span>強調什麼</span>${views.packAngleSelect(po, '', 'data-wu-angle')}</label>
            <label class="field wu-brief" hidden><span>人選背景重點（不寫姓名、不寫目前公司）</span><textarea class="cg-in" data-wu-brief rows="2"></textarea></label>
            <div class="field"><span>附件</span><label class="wu-inline"><input type="checkbox" data-wu-intro checked> 公司介紹</label>
              ${(r.contract_files || []).length ? `<select class="cg-in" data-wu-contract><option value="">不附合約</option>${r.contract_files.map((f) => `<option value="${escapeHtml(f.id)}">${f.contract_type ? `【${text(f.contract_type)}】` : ''}${text(f.filename)}</option>`).join('')}</select>` : '<small class="muted">沒有合約</small>'}</div>
          </div>
          <button type="button" class="btn ghost sm" data-wu-preview>看這封信</button>
          <pre class="bd-letter-body" data-wu-out hidden></pre>
        </div>
      </article>`;
    };
    const nNeed = rows.filter(needs).length;
    return `<div class="page-head"><div><h2>客戶跟進</h2><p>聯繫過的客戶都在這裡：上次聯絡到哪、下一步做什麼、哪一天做。照日期排，過期和今天的在最上面。打完電話或寄完信，記得回來改下一步。</p></div></div>
      <div class="filter-row"><select id="wu-assignee"><option value="">全部負責人</option>${people.map((x) => `<option value="${escapeHtml(x)}">${text(x)}</option>`).join('')}</select>
        <select id="wu-show"><option value="">全部（${rows.filter((r) => !r.parked_at).length}）</option><option value="need">只看要處理的：今天以前到期＋還沒排（${nNeed}）</option><option value="parked">備選池（${rows.filter((r) => r.parked_at).length}）</option></select><span class="help" id="wu-count"></span></div>
      ${rows.length ? `<div class="wu-list">${rows.map(card).join('')}</div>` : empty('還沒有聯繫過的客戶。打完電話記錄結果，或在開發進度勾「已聯繫」，就會出現在這裡。')}
      <div class="wu-bar"><span data-wu-picked>下一步選「寄信」的公司，勾選後可以一次擬好信：已勾 0 家</span><button type="button" class="btn" data-wu-batch-preview disabled>先預覽勾選的信</button><button type="button" class="btn primary" data-wu-batch-send disabled>擬好勾選的信，送 TG 核准</button></div>
      <div id="wu-batch-out"></div>`;
  },
  bdDashboardDetail: ({ mails, outreach, timeline, playbook, notes, people, assigned_to, company, profile, hr_contacts, transcripts, contract_files, company_status, pack_options, calls, web_inquiries, client_jobs }) => {
    const pick = (key) => outreach.map((o) => o[key]).find(Boolean) || null;
    const contactName = pick('contact_name');
    const contactEmail = pick('contact_email');
    const callPhone = pick('call_phone');
    const sourceUrl = pick('source_url');
    const url104 = pick('company_104_url');

    // 2026-09-30 Jacky：列表有電話、卡片裡卻沒有——卡片改成讀跟列表同一套（人資電話＞總機），並加官網與 104 企業頁。
    const hrPhone = pick('hr_phone') || '', hrContact = pick('hr_contact') || '', mainPhone = pick('company_phone') || callPhone || '', phoneSrc = pick('phone_source') || '';
    const website = profile && /^https?:\/\//.test(String(profile.website || '')) ? profile.website : '';
    const telRow = (label, num, extra) => `<div class="bd-contact-row"><span>${label}</span><a href="tel:${escapeHtml(String(num).replace(/[^0-9+#,]/g, ''))}">${text(num)}</a>${extra ? `<small>${text(extra)}</small>` : ''}<button type="button" class="btn ghost sm" data-copy-text="${escapeHtml(num)}">複製</button></div>`;
    const okMark = (ok, label) => `<span class="bd-qc ${ok ? 'ok' : 'miss'}">${ok ? '✓' : '✗'} ${label}${ok ? '' : '（缺）'}</span>`;
    const qc = `<div class="bd-qc-row"><b>資料合格檢查</b>${okMark(!!(hrPhone || mainPhone), '電話')}${okMark(!!url104, '104 企業頁')}${okMark(!!website, '官網')}</div>`;
    const contactCard = `<div class="card bd-contact-card">
      <div class="card-head"><h3 style="font-size:14px;margin:0 0 8px">聯絡方式</h3><button type="button" class="btn ghost sm" data-action="bd-phone-edit" data-company="${escapeHtml(company || (outreach[0] || {}).company || '')}" data-hr="${escapeHtml(hrPhone)}" data-hrname="${escapeHtml(hrContact)}" data-main="${escapeHtml(mainPhone)}" data-email="${escapeHtml(contactEmail || '')}">更新電話／Email</button></div>
      ${qc}
      ${contactName ? `<div class="bd-contact-row"><span>窗口</span><b>${text(contactName)}</b></div>` : ''}
      ${hrPhone ? telRow('人資電話', hrPhone, hrContact) : ''}
      ${mainPhone ? telRow('公司總機', mainPhone, hrPhone ? '' : '先過總機，問人資姓名＋分機') : ''}
      ${phoneSrc ? `<div class="bd-contact-row"><span>電話來源</span><small>${text(String(phoneSrc).slice(0, 120))}</small></div>` : ''}
      ${(hr_contacts || []).length ? `<div class="bd-hr-list"><b>人資窗口（LinkedIn）</b>${hr_contacts.map((h) => `<div class="bd-contact-row"><span>${text(h.name)}</span><small>${text(h.title || '')}</small><a href="${escapeHtml(h.li_search_url)}" target="_blank" rel="noopener">LinkedIn ↗</a></div>`).join('')}<small class="help">打總機時可以直接說要找這位；也可以用 LinkedIn 私訊。</small></div>` : ''}
      ${website ? `<div class="bd-contact-row"><span>官網</span><a href="${escapeHtml(website)}" target="_blank" rel="noopener">${text(website.replace(/^https?:\/\//, '').replace(/\/$/, ''))} ↗</a></div>` : ''}
      ${contactEmail ? `<div class="bd-contact-row"><span>Email</span><a href="mailto:${escapeHtml(contactEmail)}">${text(contactEmail)}</a><button type="button" class="btn ghost sm" data-copy-text="${escapeHtml(contactEmail)}">複製</button></div>` : ''}
      ${(!contactName && !hrPhone && !mainPhone && !contactEmail) ? '<p class="muted">目前沒有記錄到窗口資訊。</p>' : ''}
      ${sourceUrl ? `<div class="bd-contact-row"><span>資料來源</span><a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener">原始頁面 ↗</a></div>` : ''}
      ${url104 ? `<div class="bd-contact-row"><span>104</span><a href="${escapeHtml(url104)}" target="_blank" rel="noopener">企業頁 ↗</a></div>` : ''}
    </div>`;

    const tl = timeline.length ? `<div class="list">${timeline.map((t) => `<div class="list-row"><span><small>${text(String(t.at || '').slice(0, 16))}</small><b>${text(t.kind)}</b></span>${t.call_log_id ? `<span class="bd-call-btns" style="display:inline-flex;gap:6px;flex-shrink:0">${(() => {
      // 2026-10-01 Jacky：電話紀錄存了要能改——資料直接從 calls 帶進「編輯」彈窗
      const c = (calls || []).find((x) => String(x.id) === String(t.call_log_id)) || {};
      return `<button type="button" class="btn ghost sm" data-action="bd-call-edit" data-id="${escapeHtml(t.call_log_id)}" data-company="${escapeHtml(company || (outreach[0] || {}).company || '')}" data-result="${escapeHtml(c.result || '')}" data-note="${escapeHtml(c.note || '')}" data-hr="${escapeHtml(c.hr_phone || '')}" data-cname="${escapeHtml(c.contact_name || '')}" data-email="${escapeHtml(c.email || '')}">編輯</button>`;
    })()}<button type="button" class="btn ghost sm bd-del" data-action="bd-delete-record" data-kind="call" data-id="${escapeHtml(t.call_log_id)}" data-company="${escapeHtml(company || (outreach[0] || {}).company || '')}">刪除</button></span>` : ''}${t.call_log_id && ((calls || []).find((x) => String(x.id) === String(t.call_log_id)) || {}).updated_at ? `<small class="muted" style="display:block">（${text(String(((calls || []).find((x) => String(x.id) === String(t.call_log_id)) || {}).updated_at).slice(5, 16))} 修改過）</small>` : ''}</div>`).join('')}</div>` : empty('還沒有任何時間軸事件');
    const letters = outreach.map((o) => {
      const parts = [];
      if (o.body) parts.push([o.channel === 'phone' ? '電訪備註' : (o.subject && o.subject.startsWith('Re:') ? '追信' : '首封信'), o.subject, o.body]);
      if (o.followup1) parts.push(['追信 1', null, o.followup1]);
      if (o.followup2) parts.push(['追信 2', null, o.followup2]);
      return parts.map(([label, subject, body]) => `<details class="bd-letter"><summary>${text(label)}${subject ? '：' + text(subject) : ''}</summary><pre class="bd-letter-body">${text(body)}</pre></details>`).join('');
    }).join('') || '<p class="muted">這家目前沒有信件內容（純電訪，或還沒寫信）。</p>';
    const lastPhone = [...outreach].reverse().find((o) => o.channel === 'phone');
    const lastRow = outreach[outreach.length - 1];
    const actions = outreach.length ? rowActions([
      lastRow ? actionBtn('標記談到職缺／成交', 'bd-stage', { idParams: { id: lastRow.id } }, 'primary') : '',
      lastPhone ? actionBtn('回報電訪結果', 'bd-call-result', { idParams: { id: lastPhone.id } }) : '',
    ].filter(Boolean)) : '';
    const timelinePane = `<h3 style="font-size:14px;margin:4px 0">接觸時間軸</h3>${tl}${actions}<h3 style="font-size:14px;margin:16px 0 4px">信件全文</h3>${letters}`;

    const g = playbook && playbook.call_guide;
    const callRow = [...outreach].reverse().find((o) => o.channel === 'phone') || outreach[outreach.length - 1];
    const RES_ZH = { interested: '有興趣', not_interested: '沒興趣', got_email: '給了信箱', no_answer: '沒接', gatekeeper: '被總機擋', got_contact: '問到窗口', not_hiring: '沒在徵人' };
    const lastCall = [...outreach].reverse().find((o) => o.call_result);
    // 2026-09-29 電話引導 v2：跟著通話一步一步走，每一步只放當下要講的話；最後一步直接點結果。
    const checked = g && g.job_checked_at && (Date.now() - Date.parse(String(g.job_checked_at).replace(' ', 'T') + '+08:00')) < 14 * 86400000;
    const step = (i, title, body) => `<section class="cg-step" data-cg-step="${i}"${i ? ' hidden' : ''}><h3 class="cg-title"><span>${i}</span>${title}</h3>${body}</section>`;
    const say = (t, when) => `<p class="cg-say"${when ? ` data-when="${when}"` : ''}${when === 'small' ? ' hidden' : ''}>${text(t)}</p>`;
    // 2026-09-30 Jacky：顧問不用自己做功課——抓時機／帶人選／產業常補直接從卡片資料帶入
    const _preTrig = String(views.bdTriggerOf(outreach) || '').replace(/[，,。].*$/, '').slice(0, 50);
    const _candRow = outreach.find((o) => o.candidate_card);
    const _preCand = _candRow ? String(_candRow.candidate_card).split('\n').map((x) => x.replace(/^[・•\-\s]+/, '').trim()).filter(Boolean).slice(0, 2).join('，').slice(0, 60) : '';
    const _preRoles = profile ? String(profile.hiring || '').split('\n').map((x) => x.replace(/^[-・•\s]+/, '').replace(/（.*?）/g, '').trim()).filter((x) => x && !/未查到/.test(x)).slice(0, 3).join('、').slice(0, 80) : '';
    const guidePane = g ? `<div class="cg" data-bd-id="${escapeHtml(callRow ? callRow.id : '')}" data-default-mode="${_preTrig || _preCand ? 'pro' : 'rookie'}">
      ${lastCall ? `<div class="notice" style="margin:0 0 10px">上次電訪：${text(RES_ZH[lastCall.call_result] || lastCall.call_result)}${lastCall.call_retry_at ? `，建議 ${text(String(lastCall.call_retry_at).slice(5, 10))} 再打` : ''}${lastCall.call_note ? `（${text(lastCall.call_note)}）` : ''}</div>` : ''}
      <section class="sc-quick sc-top"><h3 class="cg-title" style="margin-top:0"><span>★</span>話術對照（我的最愛固定在最上面，照著打）</h3>
        ${views.scriptsBlock({ 公司: (outreach[0] || {}).company || '', 職缺: g.job_title ? `「${g.job_title}」` : '', 產業: g.industry_short || '', 常補: g.industry_roles || '' }, true)}</section>
      <div class="cg-mode" role="group" aria-label="打法">
        <button type="button" class="cg-mode-btn on" data-cg-mode="rookie" aria-pressed="true">新手打法<small>用 104 職缺開口</small></button>
        <button type="button" class="cg-mode-btn" data-cg-mode="pro" aria-pressed="false">高手打法<small>抓時機／帶人選／帶市場情報</small></button>
      </div>
      <p class="help cg-mode-tip">兩種可以隨時切換：新手打法被說「沒在徵人」→ 切高手打法換個理由；高手打法對方問「你們在找哪個缺」→ 切新手打法講 104 的缺。</p>
      <div class="cg-dots">${['功課', '過總機', '開場', '問需求', '拒絕時', '收尾'].map((t, i) => `<button type="button" class="cg-dot${i ? '' : ' on'}" data-cg-go="${i}">${i}. ${t}</button>`).join('')}</div>
      ${step(0, '打之前 30 秒功課', `<div data-mode="rookie">
        <div class="cg-row"><b>要推的職缺</b><span>${g.job_title ? text(g.job_title) : g.unverified_job ? `<span class="pc-status bad">未查證</span> 原始紀錄寫「${text(g.unverified_job)}」，<b>不一定還在徵</b>` : '（沒有記錄職缺）'}${g.job_url ? ` <a href="${escapeHtml(g.job_url)}" target="_blank" rel="noopener">職缺頁 ↗</a>` : ''}</span></div>
        <div class="cg-row"><b>104</b><span>${checked ? `✅ ${text(String(g.job_checked_at).slice(5, 10))} 查過：${text(g.job_check_note || '')}` : (url104 ? `<a href="${escapeHtml(url104)}" target="_blank" rel="noopener">104 企業頁 ↗</a>（想知道他們現在在徵什麼再點，不用先查也能打）` : '—')}</span></div>
        <div class="cg-row"><b>內部備註</b><span>${String(g.why || '').split(/(https?:\/\/\S+)/).map((x) => /^https?:\/\//.test(x) ? `<a href="${escapeHtml(x.replace(/[）)，。]+$/, ''))}" target="_blank" rel="noopener">來源 ↗</a>` : text(x)).join('')}<small class="cg-internal">只給你看，不要照唸（客戶面前只說「看到貴公司在徵＿＿」，不提在哪裡看到）</small></span></div>
        <div class="cg-row"><b>這家有人資嗎？</b><span class="cg-type"><label><input type="radio" name="cg-type" value="hr" checked> 有（找人資）</label><label><input type="radio" name="cg-type" value="small"> 沒有／小公司（找老闆或負責面試的人）</label></span></div>
        <p class="help">手上如果有對得上的人選（見「人選敲門卡」），開場可以帶一句，成功率會高很多。</p></div>
        <div data-mode="pro" hidden>
          <p class="help" style="margin-top:0">高手打法要「有理由才打」。三個理由挑一個，填一句話，下一步的開場白會自動帶進去：</p>
          <label class="cg-angle"><input type="radio" name="cg-angle" value="trigger"${_preTrig || !_preCand ? ' checked' : ''}> <b>抓時機</b>：這家最近發生什麼事？（擴廠、得標、新廠動工、募資、換主管、併購）
            <input class="cg-in" data-cg-fill="trigger" value="${escapeHtml(_preTrig)}" placeholder="例：南科新廠動工、剛得標台積電 A14 機電包"></label>
          <label class="cg-angle"><input type="radio" name="cg-angle" value="candidate"${!_preTrig && _preCand ? ' checked' : ''}> <b>帶人選</b>：手上哪一位人選對得上？（一句話背景，不寫名字）
            <input class="cg-in" data-cg-fill="candidate" value="${escapeHtml(_preCand)}" placeholder="例：做過 10 年營造現場、有甲種職安證照"></label>
          <label class="cg-angle"><input type="radio" name="cg-angle" value="intel"> <b>帶市場情報</b>：最近面談這類人看到的現況？
            <input class="cg-in" data-cg-fill="intel" placeholder="例：南部職安工程師多數期望月薪 6 萬以上、很在意住宿"></label>
          <div class="cg-row"><b>這家產業常補</b><span>${text(g.industry_roles || _preRoles || '（認識客戶分頁看需要的職缺）')}</span></div>
          <div class="cg-row"><b>這家有人資嗎？</b><span>用上面新手打法那格的選擇（兩種打法共用）</span></div>
          <p class="help">三個都填不出來 → 先用新手打法。目標不是今天成交，是留下窗口＋下次聯絡的理由。</p>
        </div>`)}
      ${step(1, '過總機（只講兩句，不要推銷）', `${(hr_contacts || []).length ? `<p class="help" style="margin:0 0 6px">這家有 LinkedIn 查到的人資，<b>直接指名</b>，語氣平常、不解釋來意：</p><p class="cg-say">您好，麻煩找${text((hr_contacts[0] || {}).name || '')}，我是 Step1ne 的○○。</p><p class="help">被問什麼事 →「跟招募有關，想請教兩個問題。」指名不在 → 問他的分機或信箱，記在「更新電話」。</p><details class="cg-obj"><summary>沒指名成功時的講法</summary>${say(g.gate_hr, 'hr')}${say(g.gate_small, 'small')}${say(g.gate_fallback)}</details>` : `<p class="help" style="margin:0 0 6px">這家還沒有人資名字，<b>用寄資料問收件人</b>（我們真的會寄公司介紹，不是藉口）：</p><p class="cg-say">您好，我是 Step1ne 德仁管理顧問，要寄一份企業招募的資料給貴公司人資，想確認收件人要寫哪一位、分機多少，免得寄錯人。</p><details class="cg-obj"><summary>其他講法</summary>${say(g.gate_hr, 'hr')}${say(g.gate_small, 'small')}${say(g.gate_fallback)}</details>`}
        <p class="help">報全名、講短、請對方「指點該找誰」。總機說「我幫你轉達」→ 直接問姓名＋分機或信箱。</p>`)}
      ${step(2, '開場 20 秒', `<div data-mode="pro" hidden>
          <p class="cg-say" data-cg-pro="trigger">您好，我是 Step1ne 德仁管理顧問的○○。我打來的原因是看到貴公司<b class="cg-fill" data-fill="trigger">（最近的消息）</b>，先恭喜！這種時候通常${text(g.industry_roles ? g.industry_roles + '這類人' : '好幾個位置')}會一次缺好幾個，想請教一下，這波人力大概怎麼規劃？</p>
          <p class="cg-say" data-cg-pro="candidate" hidden>您好，我是 Step1ne 德仁管理顧問的○○。我打來的原因是，我手上剛好有一位<b class="cg-fill" data-fill="candidate">（人選背景）</b>的人選，覺得跟貴公司的方向滿對得上，想說先跟您提一下，您看要不要先了解一下他的背景？</p>
          <p class="cg-say" data-cg-pro="intel" hidden>您好，我是 Step1ne 德仁管理顧問的○○。我們最近面談了好幾位${text(g.industry_roles ? g.industry_roles.split('、')[0] : '這個領域')}背景的人，發現<b class="cg-fill" data-fill="intel">（市場現況）</b>。想說貴公司這類人應該也常在找，先跟您分享一下，也想聽聽您這邊的狀況。</p>
          <p class="help">重點：先給對方一個「為什麼現在打給你」的理由，再自我介紹（Gong：先講背景的開場成功率最高）。不要問「現在方便嗎」。</p>
        </div><div data-mode="rookie">${g.opener_industry_hr && !g.job_title
          ? `<p class="help" style="margin:0 0 8px">104 上沒看到確定的職缺 → 用<b>產業切入</b>（${text(g.industry_short || '')}）</p>${say(g.opener_industry_hr, 'hr')}${say(g.opener_industry_small, 'small')}`
          : `${say(g.opener_hr, 'hr')}${say(g.opener_small, 'small')}<p class="cg-say cg-opt">${text(g.candidate_hook)}</p>
             ${g.opener_industry_hr ? `<details class="cg-obj"><summary>對方說「那個缺已經沒在找了」→ 改用產業切入</summary>${say(g.opener_industry_hr, 'hr')}${say(g.opener_industry_small, 'small')}</details>` : ''}`}
        <p class="help">一定要講到「我打來的原因是…」。對方說「現在不方便」→「那我什麼時間再打給您比較好？」</p></div>`)}
      ${step(3, '問需求（3 題）', `<div data-mode="rookie">${g.questions.map((x, i) => `<div class="cg-q"><b>${i + 1}. ${text(x.q)}</b><small>${text(x.tip)}</small></div>`).join('')}</div>
        <div data-mode="pro" hidden>${[
          ['接下來半年到一年，人力上最擔心哪幾個位置？', '問的是「規劃」，不是「現在有沒有缺」——高手在需求出現之前就先卡位'],
          ['這類位置以往都怎麼補？補一個大概要多久？', '聽到「很久」「一直換人」→ 這就是我們的切入點'],
          ['如果之後遇到很適合的人，我先跟您說，還是有其他負責的主管？', '拿到「下次聯絡的理由」跟「對的人」，比今天談成更重要'],
        ].map(([q, tip], i) => `<div class="cg-q"><b>${i + 1}. ${q}</b><small>${tip}</small></div>`).join('')}</div>`)}
      ${step(4, '對方拒絕時', g.objections.map((o) => `<details class="cg-obj"><summary>「${text(o.q)}」</summary><p class="cg-say">${text(o.a)}</p></details>`).join('') + '<p class="help">不要反駁，先問一句、再退一步；最後都要留下姓名＋信箱。</p><p class="help">新手打法被說「沒在徵人」→ 按上面「高手打法」，換成聊人力規劃或分享市場情報。</p>')}
      ${step(5, '收尾＋點結果', `${g.close.map((c) => `<p class="cg-say">${text(c)}</p>`).join('')}
        <h4 style="margin:14px 0 6px">這通電話結果</h4>
        <div class="cg-results">${[['no_answer', '沒接'], ['gatekeeper', '被總機擋'], ['got_contact', '問到窗口'], ['got_email', '拿到信箱'], ['interested', '有興趣'], ['not_hiring', '沒在徵人'], ['not_interested', '拒絕']].map(([k, lb]) => `<button type="button" class="btn" data-cg-result="${k}">${lb}</button>`).join('')}</div>
        <form class="cg-form">
          <label class="field"><span>誰打的</span><select name="caller">${[...new Set([assigned_to, 'Jacky', 'Phoebe', ...(people || [])].filter(Boolean))].map((x) => `<option value="${escapeHtml(x)}"${x === assigned_to ? ' selected' : ''}>${text(x)}</option>`).join('')}</select></label>
          <label class="field"><span>窗口姓名／職稱</span><input name="contact_name" placeholder="例：王小姐（人資）"></label>
          <label class="field"><span>信箱</span><input name="email" type="email" placeholder="有拿到才填"></label>
          <label class="field span-2"><span>備註（顧問自己的筆記：問到什麼電話、拒絕原因、下次什麼時候打、對方說了什麼）</span><textarea name="note" rows="3" placeholder="例：招募專線在善化廠 06-5837608，晚點再打"></textarea></label>
          <div class="actions-row"><button type="submit" class="btn primary">記錄這通電話</button><small class="help">先點上面的結果，再按記錄</small></div>
        </form>
        <section class="cg-tr">
          <h4 style="margin:14px 0 6px">電洽逐字稿（選填，AI 會評分＋給下一通的講法）</h4>
          <label class="field"><span>直接貼文字，或上傳 .md／.txt 檔（會讀進這格）</span><textarea name="transcript" data-cg-transcript rows="5" placeholder="有錄音轉文字就貼這裡；沒有可以不填"></textarea></label>
          <label class="field"><span>上傳逐字稿檔</span><input type="file" accept=".md,.txt,text/plain,text/markdown" data-transcript-file></label>
          <div class="actions-row"><button type="button" class="btn" data-cg-tr-only>只上傳逐字稿讓 AI 看</button></div>
          <p class="help">點「記錄這通電話」時，這格有字會一起送出；不想記錄結果也可以按「只上傳逐字稿讓 AI 看」。AI 看完會出現在上面「通話心得」。</p>
        </section>
        <p class="help">沒接／被擋／只問到窗口 → 系統 2 個工作天後提醒再打；拿到信箱或有興趣 → TG 通知去寫開發信。</p>
        <div class="actions-row" style="margin-top:14px"><button type="button" class="btn primary" data-bd-mail="${escapeHtml(company || (outreach[0] || {}).company || '')}">寄公司介紹信 →</button><small class="help" style="align-self:center">寄信獨立一頁，不用在這裡往下找</small></div>`)}
      <div class="cg-nav"><button type="button" class="btn" data-cg-prev>← 上一步</button><button type="button" class="btn primary" data-cg-next>下一步 →</button></div>
    </div>` : '';
    const playbookPane = !playbook ? empty('這家還沒有足夠資料組出開發引導') : guidePane || `
      <h3 style="font-size:14px;margin:4px 0">為什麼開發這家</h3>
      <p>${text(playbook.why)}</p>
      <h3 style="font-size:14px;margin:16px 0 4px">切入角度${playbook.difficulty_type ? `（${playbook.difficulty_type === 'source' ? '難在來源' : playbook.difficulty_type === 'screening' ? '難在篩選' : '待判斷'}）` : ''}</h3>
      <p>${text(playbook.angle)}</p>
      <h3 style="font-size:14px;margin:16px 0 4px">電話開場白（30 秒）</h3>
      <pre class="bd-letter-body">${text(playbook.phone_script)}</pre>
      <h3 style="font-size:14px;margin:16px 0 4px">可以問的三個問題</h3>
      <div class="list">${playbook.questions.map((q) => `<div class="list-row"><span>${text(q)}</span></div>`).join('')}</div>
      <h3 style="font-size:14px;margin:16px 0 4px">常見拒絕與怎麼回應</h3>
      <div class="list">${playbook.objections.map((o) => `<div class="list-row"><span><b>「${text(o.q)}」</b><small>${text(o.a)}</small></span></div>`).join('')}</div>
      <h3 style="font-size:14px;margin:16px 0 4px">下一步（三選一）</h3>
      <div class="list">${playbook.next_steps.map((s) => `<div class="list-row"><span>${text(s)}</span></div>`).join('')}</div>
    `;

    const _topic = profile && String(profile.topics || '').split('\n').map((x) => x.replace(/^[-・•\s]+/, '').trim()).find(Boolean);
    // 2026-10-22 Jacky：最上面原本的「切入點・先問需求」換成「成交條件」（給過哪一版合約／簡介／人選），內容由 dealterms.js 補上
    return `<section class="dt" data-dt-box aria-live="polite"><h4 class="dt-h">成交條件</h4><p class="dt-note">讀取中…</p></section>${views.bdWebInquiryBlock(web_inquiries)}${bdCardTop({ company: company || (outreach[0] || {}).company || '', company_status, calls, people, assigned_to })}${contactCard}
      <div class="tabs tabs-sub" id="bd-detail-tabs">
        <button type="button" class="active" data-bd-detail-tab="log">進度紀錄</button>
        <button type="button" data-bd-detail-tab="jobs">客戶提供的職缺（${(client_jobs || []).filter((j) => j.status === 'social_only').length}）</button>
        <button type="button" data-bd-detail-tab="mail">寄公司介紹信</button>
        <button type="button" data-bd-detail-tab="profile">認識公司</button>
        <button type="button" data-bd-detail-tab="playbook">開發引導</button>
      </div>
      <div id="bd-detail-pane-log">${bdLogPane({ company: company || (outreach[0] || {}).company || '', company_status, calls, people, assigned_to, timeline, mails: mails || [], markBtn: lastRow ? actionBtn('標記談到職缺／成交', 'bd-stage', { idParams: { id: lastRow.id } }, 'primary') : '' })}${views.bdTranscriptBlock(company || (outreach[0] || {}).company || '', transcripts, notes, people, assigned_to)}</div>
      <div id="bd-detail-pane-jobs" hidden>${bdJobsPane({ company: company || (outreach[0] || {}).company || '', client_jobs, assigned_to })}</div>
      <div id="bd-detail-pane-mail" hidden>${views.bdContractPackBlock(company || (outreach[0] || {}).company || '', outreach || [], contract_files, assigned_to, pack_options)}<h4 style="margin:18px 0 6px">已寄出／擬好的信件全文</h4>${letters}</div>
      <div id="bd-detail-pane-profile" hidden>${views.bdProfileModes(profile, company || (outreach[0] || {}).company || '')}</div>
      <div id="bd-detail-pane-playbook" hidden>${playbookPane}</div>`;
  },
  // bd_requests 真實欄位是 role_family（不是 company_name/target，這裡從沒要求填公司名——
  // 系統自己去人才庫配對職缺再挑公司）；status 真實值 new/working/done/failed，跟 bd_outreach
  // 的 status 是不同一組列舉，不能共用 statusBadge() 的全域標籤，容易對到別的語意。
  clientsRequestsTab: (requests) => {
    const REQ_ST = { new: ['排隊中', 'info'], working: ['配對中', 'warning'], done: ['已送審', 'success'], failed: ['沒出信', 'danger'] };
    const badge = (s) => { const [lb, tone] = REQ_ST[s] || [s || '未知', 'neutral']; return `<span class="badge ${tone}">${text(lb)}</span>`; };
    return `<div class="card"><h2>新增 BD 需求</h2><p class="help">講一句「想開發做什麼職缺的客戶」就好，系統會去人才庫撈得上用場的人、挑目標公司、自動跳過既有客戶與洽談中的公司、寫開發信進群組等核准。</p>${actionBtn('新增 BD 需求', 'bd-request-create', {}, 'primary')}</div>${list(requests, (r) => `<article class="list-row"><span><b>${text(r.role_family)}</b><small>${text(r.created_at)} · ${text(r.submitted_by || '未填')}${r.letters ? ` · ${text(r.letters)} 封信` : ''}</small></span>${badge(r.status)}</article>`)}`;
  },
  // 2026-09-22：原本一列只顯示「公司名 · status · 時間」，而 API 其實回了
  // 職稱、薪資、產業、僱用型態——顧問要點「處理」才看得到自己在處理什麼。
  // status 也直接印英文（new），顧問不知道那是什麼。
  // 收費進程（2026-09-29，總指揮交辦，補新舊後台對照表抓到的缺口：後端
  // /admin/billing-installments、/admin/client-billing-plan 早就存在——舊版
  // consultant/billing 一直在用，新版只是完全沒做畫面）。沿用舊版兩段式
  // 設計：① 選客戶、設定這家的分期範本（人選報到時系統照這個範本自動展開）
  // ② 所有已報到人選的收款進度總覽，一人一行，點進去看單期明細。
  // 改範本不會回頭改已經報到的舊人選——那是報到當下就決定的，不是永遠
  // 跟著最新設定走（同一則提醒文字照抄舊版，這是 Jacky 已經確認過的行為）。
  billingPlanRow: (t, i) => `<tr data-i="${i}">
<td><input type="text" class="bp-label" value="${text(t.label || '')}" placeholder="第${i + 1}期"></td>
<td><input type="number" class="bp-percent" value="${text(t.percent)}" min="0" max="100" step="0.1" style="width:80px"> %</td>
<td>報到滿 <input type="number" class="bp-value" value="${text(t.trigger_value)}" min="0" style="width:70px">
<select class="bp-unit"><option value="days"${t.trigger_unit === 'days' ? ' selected' : ''}>天</option>
<option value="months"${t.trigger_unit === 'months' ? ' selected' : ''}>個月</option></select></td>
<td><button type="button" class="btn danger sm bp-remove">刪除</button></td></tr>`,

  billingTab: (companies, companyId, plan, installments) => {
    const companyOpts = (companies || []).map((c) => `<option value="${text(c.id)}"${companyId === c.id ? ' selected' : ''}>${text(c.display_name || c.name)}</option>`).join('');
    const tiers = (plan && plan.tiers) || [];
    const planBox = !companyId ? '' : `<div id="billing-plan-box" style="margin-top:14px">
<table><thead><tr><th>名稱</th><th>比例</th><th>觸發時機</th><th></th></tr></thead>
<tbody id="billing-plan-rows">${tiers.map((t, i) => views.billingPlanRow(t, i)).join('')}</tbody></table>
<div class="actions-row"><button type="button" class="btn" id="billing-add-row">＋ 加一期</button>
<button type="button" class="btn primary" id="billing-save-plan">儲存範本</button></div>
</div>`;
    const byPlacement = new Map();
    (installments || []).forEach((r) => {
      if (!byPlacement.has(r.placement_id)) byPlacement.set(r.placement_id, []);
      byPlacement.get(r.placement_id).push(r);
    });
    const groups = [...byPlacement.values()];
    const listHtml = !groups.length ? empty('目前沒有已報到、且客戶有設定收費範本的人選')
      : groups.map((rows) => {
        const r0 = rows[0];
        const paidN = rows.filter((x) => !!x.paid_at).length;
        const paidPct = Math.round(rows.filter((x) => !!x.paid_at).reduce((s, x) => s + Number(x.percent), 0));
        return `<div class="list-row billing-group-row" style="cursor:pointer" data-rows='${escapeHtml(JSON.stringify(rows))}'>
<span><b>${text(r0.candidate_name)}</b><small>${text(r0.client_name)}・${text(r0.job_title)}・報到 ${text(r0.onboard_date)}</small></span>
<span>${paidN}/${rows.length} 期已收（${paidPct}%）</span></div>`;
      }).join('');
    return `<div class="notice">每家客戶合約的分期收款條件不一樣，先在下面幫這家客戶設定一次範本；之後人選在人選詳情被標記「報到」時，系統會自動依這個範本算出每一期的到期日。改範本<b>不會</b>回頭改已經報到的舊人選——那是報到當下那份，不是永遠跟著最新設定走。「已收款」只是顧問自己標記用，<b>不是</b>接了金流或發票系統。</div>
<div class="card"><h2>選客戶設定收費範本</h2>
<select id="billing-company-select"><option value="">－－選一家客戶－－</option>${companyOpts}</select>
${planBox}</div>
<div class="card" style="margin-top:14px"><h2>收費進度（所有已報到人選）</h2>
<p class="help">點一列看這個人選每一期的明細與到期日。</p>
<div class="list">${listHtml}</div></div>`;
  },

  billingDetailBody: (rows, tenureText) => {
    const r0 = rows[0];
    return `<p class="muted" style="margin:0 0 4px">報到日期 ${text(r0.onboard_date)} · ${text(tenureText)}</p>
<div class="list">${rows.map((r) => {
      const paid = !!r.paid_at;
      const clientCol = r.client_submitted_at
        ? `客戶回報匯款日 ${text(r.client_transfer_date || '')}${r.proof_file_id ? ` <a href="#" data-proof-download="${text(r.id)}">查看證明</a>` : ''}`
        : '<span class="muted">客戶尚未回報</span>';
      let actionCol;
      if (r.confirmed_received) {
        actionCol = `<span class="muted">已於 ${text(String(r.confirmed_at || '').slice(0, 16))} 由 ${text(r.confirmed_by || '')} 確認</span>`;
      } else if (r.client_submitted_at) {
        actionCol = rowActions([
          actionBtn('✅ 確認已收到', 'billing-confirm-received', { idParams: { id: r.id } }),
          actionBtn('❌ 還沒收到', 'billing-confirm-not-received', { idParams: { id: r.id } }, 'danger'),
        ]);
      } else {
        actionCol = paid
          ? actionBtn('標記未收款', 'billing-mark-unpaid', { idParams: { id: r.id } })
          : actionBtn('標記已收款', 'billing-mark-paid', { idParams: { id: r.id } }, 'primary');
      }
      return `<div class="list-row"><span><b>${text(r.label)}</b> ${text(r.percent)}% 到期 ${text(r.due_date)}
<br><small>${clientCol}</small></span>
<span class="badge ${paid ? 'success' : 'warning'}">${paid ? '已收款' : '未收款'}</span>
${actionCol}</div>`;
    }).join('')}</div>`;
  },

  // 待審核清單（2026-09-29，總指揮交辦，補新舊後台對照表抓到的缺口）：
  // 職缺有 client_screen_conditions（客戶硬性條件）時，應徵會先卡在這裡、
  // 還沒送進阿財面談——決策動作沿用既有的 screen-decide（單一人選詳情
  // 本來就在用同一支），這裡只是補一個一次看完全部待審清單的畫面。
  screeningTab: (pending) => {
    const list = pending || [];
    if (!list.length) return empty('目前沒有人選卡在硬條件審核', '所有應徵都已經處理過，不用等你決定。');
    return `<div class="notice">這裡列的是「職缺有客戶硬性條件、還沒送進阿財面談前」卡住等你決定的應徵。一般職缺（沒有硬條件）不會出現在這裡，會直接進阿財面談。</div>
<div class="list">${list.map((a) => {
      const resumeBtn = a.resume_file_id ? `<button type="button" class="btn ghost sm" data-download-resume="${text(a.id)}">看原始履歷</button>`
        : (a.resume_url ? `<a class="btn ghost sm" href="${escapeHtml(a.resume_url)}" target="_blank" rel="noopener">履歷連結</a>` : '');
      return `<div class="list-row"><span>
<b>${text(a.name)}</b><small>${text(a.job_title || a.job_slug)}${a.client_name ? ' · ' + text(a.client_name) : ''} · 應徵於 ${text(String(a.created_at || '').slice(0, 10))}</small>
<p class="help" style="margin:6px 0 0">硬性條件：${text(a.client_screen_conditions || '（無）')}</p>
${a.must_skills ? `<p class="help" style="margin:4px 0 0">必要技能：${text(a.must_skills)}</p>` : ''}
${a.note ? `<details class="note-details"><summary>顧問備註／電洽紀錄</summary><p>${text(a.note)}</p></details>` : ''}
</span>${rowActions([
        resumeBtn,
        actionBtn('AI 篩選決策', 'screen-decide', { idParams: { application_id: a.id } }, 'primary'),
      ].filter(Boolean))}</div>`;
    }).join('')}</div>`;
  },

  clientsHiringTab: (items) => {
    const ST = { new: ['待處理', 'warning'], working: ['處理中', 'info'], done: ['已完成', 'success'], rejected: ['不承接', 'neutral'] };
    const badge = (v) => { const [lb, tone] = ST[v] || [v || '未知', 'neutral']; return `<span class="badge ${tone}">${text(lb)}</span>`; };
    if (!items.length) return empty('目前沒有企業送進來的用人需求');
    return list(items, (s) => `<article class="list-row">
      <span><b>${text(s.job_title || '（沒填職稱）')}</b>
        <small>${text(s.company_name || '（沒填公司）')}${s.industry ? ' · ' + text(s.industry) : ''}${s.salary_text ? ' · ' + text(s.salary_text) : ''}</small>
        <small>${text(s.mode_label || s.mode || '')}${s.talent_type === 'scarce' ? ' · 稀缺人才' : ''} · ${text(s.created_at)}</small></span>
      ${badge(s.status)}
      ${rowActions([actionBtn('處理', 'hiring-submission-update', { idParams: { id: s.id }, record: s })])}
    </article>`);
  },
  // 2026-09-17 加「顧問人選面談室」——Jacky 的規格：先選顧問，只列出這位
  // 顧問名下、已經綁定 LIFF 的人選（照 LINE 官方帳號後台左清單右對話的樣子），
  // 點開人選旁邊能切「人選卡片／面談進度／推薦職缺」，不用跳出這個畫面。
  // ⚠️ 「人選卡片」跟「面談進度」目前共用同一個既有的候選人詳情抽屜
  // （openCandidate 裡本來就同時有基本資料進度條跟阿財報告）——沒有另外
  // 拆成兩個獨立畫面，是刻意重用既有元件不重造，兩顆按鈕效果一樣，
  // 這是實作上的簡化，不是漏做，跟 Jacky 講清楚。「推薦職缺」按鈕另外開
  // 既有的 openForwardCandidate() 那個客戶→職缺級聯彈窗，一樣可以直接動作。
  linechat: (consultants, activeOwner) => pageHead('人選面談室','選顧問，只列出他名下已經綁定 LIFF 的人選，直接在這裡跟人選聊天。',
    `<span id="linechat-quota" class="linechat-quota">查詢中…</span><select data-action="linechat-owner"><option value="">選顧問…</option>${(consultants || []).map((c) => `<option value="${escapeHtml(c.id)}" ${c.id === activeOwner ? 'selected' : ''}>${text(c.display_name)}</option>`).join('')}</select>`)
    + `<div id="page-data">${activeOwner ? endpointState('人選清單') : empty('先選一位顧問', '選完會列出他名下已經綁定 LIFF 的人選。')}</div>`,
  // 這個月免費推播剩多少則——低於 30 標紅提醒（下面 app.js 判斷門檻）。
  linechatQuota: (q) => {
    if (q.unlimited) return '不限則數';
    if (q.limit == null || q.used == null) return '額度查不到';
    const remain = q.limit - q.used;
    return `這個月還剩 ${remain} / ${q.limit} 則`;
  },
  linechatEmptyOwner: () => empty('先選一位顧問', '選完會列出他名下已經綁定 LIFF 的人選。'),
  // 2026-10-15 Jacky：人選有新回訊、你還沒點開看，就標「未讀」（記在這台瀏覽器）
  linechatCandList: (candidates, activeAppId) => candidates.length
    ? candidates.map((c) => `<button type="button" class="linechat-row ${c.application_id === activeAppId ? 'active' : ''}${c._unread ? ' unread' : ''}" data-linechat-select="${escapeHtml(c.application_id)}">${c._unread ? '<span class="linechat-unread" aria-label="未讀">未讀</span>' : ''}
        <span class="linechat-avatar">${c.picture_url ? `<img src="${escapeHtml(c.picture_url)}" alt="">` : text((c.display_name || c.name || '?').slice(0, 2))}</span>
        <span class="linechat-meta"><b>${text(c.name)}</b><small>${text(c.job_title || c.job_slug)}</small>${c.last_message ? `<small class="linechat-preview">${c.last_message.direction === 'out' ? '你：' : ''}${text((c.last_message.content || '').slice(0, 24))}</small>` : ''}</span>
      </button>`).join('')
    : empty('這位顧問名下目前沒有已綁定 LIFF 的人選'),
  linechatPanel: (cand) => !cand ? `<div class="state">點左邊清單裡的人選開始聊天</div>` : `
    <div class="linechat-head">
      <span class="linechat-avatar">${cand.picture_url ? `<img src="${escapeHtml(cand.picture_url)}" alt="">` : text((cand.display_name || cand.name || '?').slice(0, 2))}</span>
      <div><b>${text(cand.name)}</b><small>${text(cand.job_title || cand.job_slug)}</small></div>
      <div class="actions-row">
        <button type="button" class="btn ghost sm" data-linechat-view="card">人選卡片</button>
        <button type="button" class="btn ghost sm" data-linechat-view="progress">面談進度</button>
        <button type="button" class="btn ghost sm" data-linechat-view="forward">推薦職缺</button>
      </div>
    </div>
    <div class="transcript" id="linechat-transcript"></div>
    <p class="linechat-hint">這裡發訊息會算錢，單純聊天不看資料可以改用 LINE 官方帳號自己的聊天視窗（免費）。</p>
    <form id="linechat-form" class="linechat-form">
      <textarea id="linechat-input" placeholder="輸入訊息，直接 LINE 推播給候選人…" rows="2" required></textarea>
      <button type="submit" class="btn primary">送出</button>
    </form>`,
  linechatMessages: (messages) => messages.length
    ? messages.map((m) => `<div class="bubble ${m.direction === 'out' ? 'candidate' : ''}"><p>${text(m.content)}</p><small>${text((m.created_at || '').slice(5, 16))}${m.direction === 'out' ? ' · 你' : ''}</small></div>`).join('')
    : `<p class="muted" style="text-align:center;margin-top:20px">還沒有對話紀錄</p>`,
  // 編號查詢：客戶編號（A 已簽約／B 未簽約）＋職缺編號。2026-10-14 Jacky：編號要有一張列表可以查。
  systemCodesTab: ({ codes, clients, jobs }) => {
    const jb = Object.fromEntries((jobs || []).map((j) => [j.slug, j]));
    const ST = { open: '招募中', closed: '已關閉', draft: '草稿', client_draft: '客戶草稿', pending_review: '待審', social_only: '只發社群' };
    const byClient = {};
    Object.entries(codes || {}).forEach(([slug, code]) => { const cc = code.split('-')[0]; (byClient[cc] = byClient[cc] || []).push([code, slug]); });
    const nameOf = Object.fromEntries(Object.entries(clients || {}).map(([k, c]) => [c, k]));
    const order = Object.keys(byClient).sort((a, b) => (a[0] === b[0] ? Number(a.slice(1)) - Number(b.slice(1)) : a[0].localeCompare(b[0])));
    const block = (cc) => `<section class="codes-block" data-codes-block>
      <h3><span class="jobcode">${text(cc)}</span> ${text(nameOf[cc] || '')}<small class="muted">　${cc[0] === 'A' ? '已簽約' : '未簽約'}・${byClient[cc].length} 個職缺</small></h3>
      <table class="codes-table"><tbody>${byClient[cc].sort().map(([code, slug]) => { const j = jb[slug] || {}; return `<tr data-codes-row data-q="${escapeHtml((code + ' ' + (j.title || '') + ' ' + (nameOf[cc] || '')).toLowerCase())}"><td class="c"><b>${text(code)}</b></td><td>${text(j.title || slug)}</td><td class="s">${text(ST[j.status] || j.status || '')}</td></tr>`; }).join('')}</tbody></table></section>`;
    return `<div class="filters" style="margin-bottom:12px"><input id="codes-q" type="search" placeholder="搜尋編號、職缺名稱或客戶（例如 A11、BIM）" style="min-height:44px;flex:1 1 260px"></div>
      <p class="help" style="margin:0 0 10px">A＝已簽約（含私人合作）、B＝還沒簽約。客戶簽約後，B 的編號會換成 A 的下一號，底下職缺編號（001…）不變。</p>
      ${order.map(block).join('')}<style>.codes-table{width:100%;border-collapse:collapse;table-layout:fixed;margin:0 0 14px}.codes-table td{padding:7px 8px;border-top:1px solid var(--line,#d9e2e8);overflow-wrap:anywhere}.codes-table td.c{width:96px;white-space:nowrap}.codes-table td.s{width:92px;white-space:nowrap;text-align:right;color:var(--muted,#586a77);font-size:14px}.codes-block h3{margin:16px 0 4px;font-size:17px}</style>`;
  },
  system: (tab='line') => pageHead('系統','LINE、阿財 KPI、Token、顧問設定與系統健康集中管理。') + tabbar('system',[['line','LINE'],['kpi','阿財 KPI'],['token','Token Usage'],['settings','顧問設定'],['spec','面談規格'],['health','系統健康'],['codes','編號查詢']],tab) + `<div id="page-data">${endpointState('系統資料')}</div>`,
  systemData: ({ bindings, consultants, token }) => `<div class="kpi-grid"><article class="kpi"><span>LINE 綁定</span><strong>${bindings.length}</strong></article><article class="kpi"><span>顧問</span><strong>${consultants.length}</strong></article></div><div class="two-col"><article class="card"><h2>Token Usage</h2><p class="notice">此數字是若改走 API 計費的估算，不是實際帳單；後端價格公式可能需要更新。</p><pre class="compact-json">${escapeHtml(JSON.stringify(token, null, 2))}</pre></article><article class="card"><h2>權限邊界</h2><p>目前全站沿用單一 ADMIN_TOKEN。顧問篩選只是畫面篩選，不是 RBAC。</p></article></div>`,
  // line-followup-overdue 真實主鍵是 click_id（不是 id）。
  // ── LINE 綁定（2026-09-22 第二版）──────────────────────────────
  //
  // 第一版我分成三個摺疊區塊，結果 Jacky 還是看不懂——因為「已綁定」被收
  // 在摺疊區裡，畫面上先看到的全是沒綁定的人，而他要找的正是**有綁定的**。
  //
  // 這一版只做兩件事，不要再多：
  //   ① 一個清單，每一列左邊就是綁沒綁（綠色＝綁好了）
  //   ② 綁好的那幾列，旁邊直接有「通知他來面談」可以按
  // 已綁定排最前面。逾期未回覆搬到下面去，那不是這一頁的重點。
  systemLineTab: ({ overdue, bindings }) => {
    const rows = bindings || [];
    const ST = {
      bound: ['✅ 已綁定', 'success', '查得到是誰，可以直接通知'],
      needs_rebind: ['⚠️ 需重新綁定', 'warning', '舊方式綁的，通知送不到；請人選在 LINE 點「追蹤面試進度」重填表單'],
      ask_name: ['⚠️ 綁到一半', 'warning', '系統問了名字，他還沒回'],
      pending_phone: ['⬜ 只加好友', 'neutral', '還沒開始綁，對不到是哪位應徵者'],
    };
    const order = { bound: 0, needs_rebind: 1, ask_name: 2, pending_phone: 3 };
    const sorted = rows.slice().sort((a, b) => (order[a.state] ?? 9) - (order[b.state] ?? 9)
      || String(b.bound_at || b.updated_at || '').localeCompare(String(a.bound_at || a.updated_at || '')));
    const from = (b) => (b.source_kind === 'post_link' ? '從社群貼文連結'
      : String(b.source || '').startsWith('liff') ? '從查詢進度（LIFF）'
      : b.source_kind === 'campaign' ? `活動：${b.source}` : '舊資料，沒記來源');
    const n = (st) => rows.filter((b) => b.state === st).length;

    const row = (b) => {
      const [label, tone, hint] = ST[b.state] || [b.state || '未知', 'neutral', ''];
      const app = (b.applications || [])[0];
      const canNotify = b.state === 'bound' && app
        && (!b.interview_state || b.interview_state === 'not_started');
      const jobs = (b.applications || []).map((a) => a.job_title || a.job_slug).join('、');
      // 2026-09-22：整列可點 → 開那位人選的卡片抽屜。data-application 是
      // 全域點擊委派已經在聽的屬性，不用另外接線。對不到應徵記錄的（還沒綁完）
      // 就不給 data-application——點了開一個空抽屜比不能點更糟。
      return `<article class="list-row" data-bind-state="${escapeHtml(b.state || '')}" data-can-notify="${canNotify ? '1' : ''}"${app ? ` data-application="${escapeHtml(app.id)}" style="cursor:pointer"` : ''}>
        <span style="min-width:0">
          <b>${text(b.candidate_name || b.display_name || '（還不知道是誰）')}</b>
          <small>${jobs ? text(jobs) : '（還對不到應徵職缺）'}${b.phone ? ' · ' + text(b.phone) : ''}</small>
          <small>${text(from(b))} · ${text(String(b.bound_at || b.updated_at || '').slice(0, 16))}</small>
        </span>
        <span class="badge ${tone}" title="${escapeHtml(hint)}">${text(label)}</span>
        ${canNotify
          ? rowActions([actionBtn('通知他來面談', 'line-notify-interview', { idParams: { application_id: app.id } }, 'primary')])
          : (b.state === 'bound'
              ? '<small class="muted">已經在面談了</small>'
              : '<small class="muted">沒綁定，通知不了</small>')}
      </article>`;
    };

    return `<div class="kpi-grid">
        <article class="kpi accent"><span>✅ 已綁定</span><strong>${n('bound')}</strong><small>可以直接用系統通知</small></article>
        <article class="kpi ${n('ask_name') ? 'warn' : ''}"><span>⚠️ 綁到一半</span><strong>${n('ask_name')}</strong><small>要有人去問一下</small></article>
        <article class="kpi"><span>⬜ 只加好友</span><strong>${n('pending_phone')}</strong><small>還沒開始綁</small></article>
      </div>
      <article class="card">
        <div class="card-head"><h2 style="margin:0;font-size:15px">LINE 綁定（${rows.length}）</h2></div>
        <p class="help" style="margin:6px 0 10px">點任一列可以打開那位人選的卡片。綠色＝綁好了，右邊可以直接按「通知他來面談」。其他顏色代表還沒綁完，系統對不到是哪一位應徵者，所以通知不了。</p>
        <div class="filters">
          <select id="bind-filter">
            <option value="">全部（${rows.length}）</option>
            <option value="bound">✅ 已綁定（${n('bound')}）</option>
            <option value="can_notify">✅ 已綁定・還沒面談，可以通知（${rows.filter((b) => b.state === 'bound' && (b.applications || [])[0] && (!b.interview_state || b.interview_state === 'not_started')).length}）</option>
            <option value="ask_name">⚠️ 綁到一半（${n('ask_name')}）</option>
            <option value="pending_phone">⬜ 只加好友（${n('pending_phone')}）</option>
          </select>
          <input type="search" id="bind-search" placeholder="搜尋姓名或職缺">
        </div>
        <p class="help" id="bind-count" style="margin:0 0 8px;font-weight:700;color:#2867ed">顯示全部 ${rows.length} 位</p>
        <div class="list" id="bind-list">${sorted.map(row).join('')}</div>
        <p class="help" id="bind-empty" hidden>沒有符合的人。</p>
        <p class="help" style="margin-top:12px">「舊資料，沒記來源」是 2026-09-22 以前綁的——LIFF、手動、應徵表單當初都沒記，分不出來。之後綁的都會標明。</p>
      </article>
      <article class="card" style="margin-top:14px">
        <div class="card-head"><h2 style="margin:0;font-size:15px">逾期未回覆（${(overdue || []).length}）</h2></div>
        <p class="help" style="margin:6px 0 10px">昨天以前點過職缺連結、到現在還沒去應徵的人。</p>
        ${list(overdue, (o) => `<div class="list-row"><span><b>${text(o.candidate_name || o.display_name || `（LINE 使用者 …${String(o.line_user_id || '').slice(-6)}）`)}</b><small>${text(o.job_title || (o.orphan ? '（話題文，對不到職缺）' : o.job_slug))} · ${text(o.attributed_at)}</small></span>${rowActions([actionBtn('標記已處理', 'line-followup-handled', { idParams: { id: o.click_id } })])}</div>`)}
      </article>`;
  },

  // 照抄舊版 consultant/interview-spec（2026-08-11 版）的內容——這是給顧問看的
  // 參考文件，不是可即時控制阿財 prompt 的設定頁；真的要調面談邏輯要改後端
  // SKILL.md 的「結構式面談」那一段，這裡純粹是把規則講清楚。
  // ── 阿財面談結果（2026-09-21 加）────────────────────────────
  //
  // Jacky 的原始需求：「最後 AI 阿財面談要給顧問這個人選面談結果，
  // 在初篩區塊顯示，**取代初篩報告**」。
  //
  // 在這之前這一格只有一段純文字報告全文，顧問要自己從一大段文字裡撈結論——
  // 而結構化資料（分流、七維評分、專業題 1–5 級、硬條件逐條、待追問）
  // 早就都在 reports.content_json 裡，只是從來沒回給前端、也沒有畫面。
  //
  // 排序照「顧問打開後最想知道什麼」：
  //   分流（要不要現在打）→ 一句話定位 → 最大風險 → 分數 → 專業題深度
  //   → 硬條件 → 待追問 → 報告全文（收合，備查用）
  // 2026-09-29 Jacky：「我要有一個製作客戶履歷的地方讓 AI 幫我生出來，我要提供給客戶」。
  // 卡片最上面固定一格：一顆按鈕做 AI 客戶版履歷（沒推薦給客戶之前也能做，會用他應徵的職缺），
  // 做好的每一份都列在這裡可下載；改好的正式版一樣用下面「推薦給客戶」那格上傳給客戶。
  clientResumeBox: (applicationId, reports, forwards, anon) => {
    const nameOf = (cid) => ((forwards || []).find((f) => f.company_id === cid) || {}).company_name || '';
    const rows = (reports || []).slice().sort((a, b) => String(b.generated_at || '').localeCompare(String(a.generated_at || '')));
    const item = (r) => {
      const who = nameOf(r.company_id);
      const st = r.pdf_pending ? '<span class="badge">AI 製作中（1～2 分鐘）</span>'
        : r.consultant_confirmed_at ? '<span class="badge success">正式版・客戶看得到</span>'
        : '<span class="badge warning">AI 草稿・客戶還看不到</span>';
      return `<div class="list-row" style="padding:8px 10px"><span><b>${text(who || '依應徵職缺')}</b> ${st}<small>${text(String(r.generated_at || '').slice(5, 16))}</small></span>
        ${r.file_id && !r.pdf_pending ? `<button type="button" class="btn ghost sm" data-download-file="${text(r.file_id)}">下載</button>` : ''}</div>`;
    };
    return `<section class="cr-box">
      <div class="cr-head"><h3 style="margin:0">客戶履歷</h3>
        ${actionBtn(rows.length ? '重新製作客戶履歷（AI）' : '製作客戶履歷（AI）', 'client-formal-report', { idParams: { application_id: applicationId } }, 'primary')}</div>
      <p class="help" style="margin:6px 0 8px">按下去 → AI 用阿財報告＋履歷整理內容（約 2～3 分鐘）→ 草稿貼到 TG「客戶履歷人工確認」，你在那邊按確認 → 產出 PDF，這裡就能下載。要給客戶看，到下面「推薦給客戶」那格上傳正式版。</p>
      ${rows.length ? rows.map(item).join('') : '<p class="muted" style="margin:0">還沒做過。</p>'}
      <div class="cr-head" style="margin-top:12px;border-top:1px solid var(--line);padding-top:10px"><h3 style="margin:0;font-size:15px">匿名履歷${anon && anon.code ? `（${text(anon.code)}）` : ''}</h3>
        ${actionBtn(anon && anon.file_id ? '重新製作匿名履歷' : '製作匿名履歷', 'anon-report', { idParams: { application_id: applicationId } })}</div>
      <p class="help" style="margin:6px 0 8px">拿去開發還沒合作的公司用：名字改代號、公司改產業描述、不放聯絡方式與薪資。草稿一樣先到 TG 讓你確認。</p>
      ${anon && anon.file_id ? `<div class="list-row" style="padding:8px 10px"><span><b>${text(anon.filename || anon.code)}</b><small>${text(String(anon.updated_at || '').slice(5, 16))}</small></span><button type="button" class="btn ghost sm" data-download-file="${text(anon.file_id)}">下載</button></div>`
        : (anon && anon.code ? '<p class="muted" style="margin:0">製作中或還沒確認。</p>' : '<p class="muted" style="margin:0">還沒做過。</p>')}
    </section>`;
  },
  // 2026-09-29 Jacky：打開人選卡片第一眼就要看到「背景經歷 × 職缺」匹配總結，不用再點進阿財初審。
  // 2026-10-01 加：這位人選是哪個顧問哪則貼文帶來的。後端查不到就回 null，
  // 這裡也是——沒把握就不顯示，不要用「可能是…」這種猜測字眼唬弄顧問。
  socialSourceBadge: (s) => {
    if (!s) return '';
    const platformLabel = { threads: 'Threads', linkedin: 'LinkedIn', line_community: 'LINE 社群' }[s.platform] || (s.platform || '');
    const m = s.posted_at && String(s.posted_at).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
    const posted = m ? `${m[2]}/${m[3]} ${m[4]}:${m[5]}` : (s.posted_at ? text(s.posted_at) : '時間不明');
    const link = s.url ? `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">看貼文</a>` : '';
    return `<p class="help" style="margin:0 0 10px">來源：${text(s.consultant)}・${text(platformLabel)}・${posted}${link ? '・' + link : ''}</p>`;
  },
  jobMatchTop: (report) => {
    let d = null;
    try { d = report && report.content_json ? JSON.parse(report.content_json) : null; } catch { d = null; }
    const jm = (d && d.job_match) || {};
    if (!(jm.items || []).length && !jm.conclusion) return '';
    const icon = { 符合: '✅', 部分符合: '⚠️', 缺: '❌', 未確認: '❓' };
    const n = (v) => (jm.items || []).filter((x) => x.verdict === v).length;
    return `<details class="rp-match rp-top" open><summary><b>職缺匹配總結</b>
        <span class="rp-count">✅ ${n('符合')}　⚠️ ${n('部分符合')}　❌ ${n('缺')}${n('未確認') ? `　❓ ${n('未確認')}` : ''}</span></summary>
      ${jm.conclusion ? `<p class="rp-match-conc">${text(jm.conclusion)}</p>` : ''}
      <ul class="rp-items">${(jm.items || []).map((x) => `<li><span>${icon[x.verdict] || '❓'}</span><div><b>${text(x.requirement)}</b><small>${text(x.evidence)}${x.basis ? `（${text(x.basis)}）` : ''}</small></div></li>`).join('')}</ul>
    </details>`;
  },
  interviewResult: (report, application = {}) => {
    const parse = (raw) => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } };
    const d = parse(report.content_json);
    const full = `<details class="note-details" style="margin-top:12px"><summary><b>報告全文</b>（結構化資料就是從這份整理出來的）</summary><p style="white-space:pre-wrap">${text(report.content_md || '（沒有內容）')}</p></details>`;
    if (!d) {
      // content_json 是 NULL 的舊報告（2026-07-30～08-12 那批撞到額度上限的）。
      // 不要假裝有結構化資料，照實說並把原文給出來。
      return `<div class="notice">這份報告沒有結構化資料（產生當下撞到用量上限），只能看原文。</div>${full}`;
    }
    const fs = d.fit_scores || {};
    const rt = report.route_code
      ? routeBadge(report.route_code, report.route_label)
      : '';
    const row = (k, v) => v ? `<div style="margin:6px 0"><b>${k}</b> ${text(v)}</div>` : '';
    const lv = (n) => (n ? '●'.repeat(n) + '○'.repeat(Math.max(0, 5 - n)) : '—');
    const dims = (fs.dimensions || []).map((x) => `<tr><td>${text(x.name)}</td>
        <td class="num">${x.score === null || x.score === undefined ? '<span class="muted">未評估</span>' : `<b>${text(x.score)}</b><span class="muted">/10</span>`}</td>
        <td style="font-size:12.5px;color:#5d6672">${text(x.note || x.evidence || '')}</td></tr>`).join('');
    const exp = (d.expertise_findings || []).map((x) => `<tr>
        <td>${text(x.skill || x.topic || '')}</td>
        <td style="white-space:nowrap">${text(lv(x.skill_level))} ${x.skill_level ? text(x.skill_level) + '/5' : ''}</td>
        <td style="font-size:12.5px;color:#5d6672">${text(x.level_reason || x.note || x.answered || '')}</td></tr>`).join('');
    const hard = (d.hard_conditions || []).map((x) => {
      const tone = x.verdict === '符合' ? 'good' : (x.verdict === '不符' ? 'bad' : 'warn');
      return `<tr><td>${text(x.item)}</td><td><span class="pc-status ${tone}">${text(x.verdict || '待確認')}</span></td>
        <td style="font-size:12.5px;color:#5d6672">${text(x.detail || '')}</td></tr>`;
    }).join('');
    const todo = (d.consultant_followups || []).filter(Boolean);
    // 2026-09-29 Jacky：①最上面先看「背景經歷 × 職缺」匹配總結 ②風格測驗結果 ③專業分級
    const jm = d.job_match || {};
    const jmIcon = { 符合: '✅', 部分符合: '⚠️', 缺: '❌', 未確認: '❓' };
    const jmTone = { 符合: 'good', 部分符合: 'warn', 缺: 'bad', 未確認: '' };
    const jmHtml = (jm.items || []).length || jm.conclusion ? `<section class="rp-match">
        <h4 style="margin:0 0 8px">職缺匹配總結<span class="muted" style="font-weight:400;font-size:12px">（背景經歷＋面談${report.content_md && /顧問電訪/.test(report.content_md) ? '＋電洽' : ''} 對這個職缺的核心條件）</span></h4>
        ${jm.conclusion ? `<p class="rp-match-conc">${text(jm.conclusion)}</p>` : ''}
        ${(jm.items || []).length ? `<table class="spec"><tr><th>職缺條件</th><th>結果</th><th>根據</th></tr>${jm.items.map((x) => `<tr><td>${text(x.requirement)}</td>
          <td style="white-space:nowrap"><span class="pc-status ${jmTone[x.verdict] || ''}">${jmIcon[x.verdict] || ''} ${text(x.verdict)}</span></td>
          <td style="font-size:12.5px;color:#5d6672">${text(x.evidence)}${x.basis ? `<span class="muted">（${text(x.basis)}）</span>` : ''}</td></tr>`).join('')}</table>` : ''}
      </section>` : `<div class="notice" style="margin:0 0 10px">這份報告產生時還沒有「職缺匹配總結」（9/29 之後的報告才有；匯入電洽紀錄重新產生後會補上）。</div>`;
    // 2026-10-01：阿財報告新增「適合的職務方向」（content_json.career_directions）。
    // 可能是系統裡還沒有的職務類型；「不確定，請顧問幫我評估」的人這段最重要，放在匹配總結下面。
    const cds = (d.career_directions || []).filter((x) => x && x.direction);
    const cdHtml = cds.length ? `<section class="rp-match" style="margin-top:12px">
        <h4 style="margin:0 0 8px">適合的職務方向<span class="muted" style="font-weight:400;font-size:12px">（阿財依面談內容整理，可能是系統裡還沒有的職缺類型）</span></h4>
        <table class="spec"><tr><th>方向</th><th>為什麼</th><th>系統裡的職缺</th></tr>${cds.map((x) => `<tr><td><b>${text(x.direction)}</b></td>
          <td style="font-size:12.5px">${text(x.why)}${x.evidence ? `<br><span class="muted">「${text(x.evidence)}」</span>` : ''}${x.watch_out ? `<br><span style="color:#9b5b00">注意：${text(x.watch_out)}</span>` : ''}</td>
          <td style="font-size:12.5px">${x.open_job_title ? text(x.open_job_title) : '<span class="muted">目前沒有在辦職缺</span>'}</td></tr>`).join('')}</table>
      </section>` : '';
    const discVals = ['d', 'i', 's', 'c'].map((k) => application[`disc_${k}`]);
    const hasDisc = discVals.some((v) => v !== null && v !== undefined);
    const obsA = ((d.observations || {}).assessment || []).filter((x) => x && x.trait);
    const vTone = (v) => (/印證/.test(v || '') ? 'good' : /不一致/.test(v || '') ? 'bad' : '');
    const testHtml = `<h4 style="margin:18px 0 6px">風格測驗結果</h4>
      ${hasDisc ? `<div class="rp-disc">${['D 支配', 'I 影響', 'S 穩定', 'C 謹慎'].map((lb, i) => `<span class="${application.disc_primary && lb.startsWith(String(application.disc_primary).toUpperCase()) ? 'on' : ''}"><small>${lb}</small><b>${text(discVals[i] ?? '—')}</b></span>`).join('')}
        ${application.disc_primary ? `<span class="rp-disc-main">主型 ${text(application.disc_primary)}</span>` : ''}</div>`
        : '<p class="muted" style="margin:0">人選還沒做風格測驗。</p>'}
      ${obsA.length ? `<table class="spec" style="margin-top:8px"><tr><th>測驗特質</th><th>面談對照</th><th>根據</th></tr>${obsA.map((x) => `<tr><td>${text(x.trait)}${x.score !== undefined && x.score !== null ? ` <span class="muted">${text(x.score)}</span>` : ''}</td>
        <td style="white-space:nowrap"><span class="pc-status ${vTone(x.verified)}">${text(x.verified || '—')}</span></td><td style="font-size:12.5px;color:#5d6672">${text(x.evidence || '')}</td></tr>`).join('')}</table>` : ''}`;
    const sl = d.skill_ladder;
    const ladderHtml = sl ? `<h4 style="margin:18px 0 6px">專業分級（整體約第 ${text(sl.overall)} 級，這個職缺期待第 ${text(sl.expected)} 級）</h4>
      ${sl.suggest ? `<div class="notice" style="margin:0 0 6px">💡 ${text(sl.suggest)}</div>` : ''}
      <table class="spec"><tr><th>主題</th><th>到第幾級</th></tr>${(sl.topics || []).map((t) => `<tr><td>${text(t.topic)}</td><td>${t.level === null || t.level === undefined ? '<span class="muted">沒問到</span>' : `${'●'.repeat(t.level)}${'○'.repeat(Math.max(0, 5 - t.level))} ${text(t.level_name || '')}`}</td></tr>`).join('')}</table>` : '';
    return `
      ${jmHtml}
      ${cdHtml}
      ${rt ? `<div style="margin:0 0 10px">${rt}</div>` : ''}
      ${d.one_liner ? `<p style="font-size:15px;font-weight:600;margin:0 0 8px">${text(d.one_liner)}</p>` : ''}
      ${row('判定', d.verdict)}
      ${d.top_selling_point ? `<div class="notice" style="margin:8px 0">✅ <b>最大賣點</b> ${text(d.top_selling_point)}</div>` : ''}
      ${d.top_risk ? `<div class="notice" style="margin:8px 0">⚠️ <b>最大風險</b> ${text(d.top_risk)}</div>` : ''}
      ${fs.total !== null && fs.total !== undefined
        ? `<div style="display:flex;align-items:baseline;gap:12px;margin:14px 0 6px">
             <span style="font-size:26px;font-weight:800">${text(fs.total)}</span>
             <span style="font-weight:700">${text(fs.grade || '')}</span>
             <span class="muted" style="font-size:12px">${text(fs.basis || '')}</span></div>`
        : `<div class="notice" style="margin:14px 0 6px">${text(fs.grade || '這場問到的資料不足以評分')}<br><span class="muted">${text(fs.basis || '')}</span></div>`}
      ${fs.score_verdict_conflict ? `<div class="notice" style="margin:6px 0">⚠️ 結論與分數不一致：${text(fs.score_verdict_conflict)}</div>` : ''}
      ${dims ? `<table class="spec" style="margin-top:6px"><tr><th>面向</th><th style="text-align:right">分數</th><th>依據</th></tr>${dims}</table>` : ''}
      ${exp ? `<h4 style="margin:18px 0 6px">專業題（●＝講得多深，不是答得對不對）</h4>
               <table class="spec"><tr><th>技能</th><th>程度</th><th>為什麼是這一級</th></tr>${exp}</table>` : ''}
      ${ladderHtml}
      ${(d.work_style_findings || []).length ? `<h4 style="margin:18px 0 6px">做事風格<span class="muted" style="font-weight:400;font-size:12px">（阿財請他講實際遇過的一次，依他的做法整理，不是人格標籤）</span></h4>
        <table class="spec"><tr><th>面向</th><th>他講的那一次與做法</th><th>偏向</th></tr>${d.work_style_findings.map((w) => `<tr><td><b>${text(w.dimension)}</b></td>
          <td style="font-size:12.5px">${text(w.story || '')}${w.approach ? `<br>${text(w.approach)}` : ''}${w.evidence ? `<br><span class="muted">「${text(w.evidence)}」</span>` : ''}${w.fit_note ? `<br><span style="color:#5d6672">${text(w.fit_note)}</span>` : ''}</td>
          <td style="white-space:nowrap;font-size:12.5px">${text(w.leaning || '—')}</td></tr>`).join('')}</table>` : ''}
      ${(d.motive || d.move_risk) ? `<h4 style="margin:18px 0 6px">動機與動向</h4><table class="spec">
        ${d.motive && d.motive.push ? `<tr><th>想離開的原因</th><td>${text(d.motive.push)}</td></tr>` : ''}
        ${d.motive && d.motive.pull ? `<tr><th>被這個機會吸引的點</th><td>${text(d.motive.pull)}</td></tr>` : ''}
        ${d.motive && d.motive.direction ? `<tr><th>三到五年方向</th><td>${text(d.motive.direction)}</td></tr>` : ''}
        ${d.move_risk && d.move_risk.other_processes ? `<tr><th>其他面試進度</th><td>${text(d.move_risk.other_processes)}</td></tr>` : ''}
        ${d.move_risk && d.move_risk.counteroffer_view ? `<tr><th>被慰留會怎麼想</th><td>${text(d.move_risk.counteroffer_view)}</td></tr>` : ''}
        ${d.move_risk && d.move_risk.decision_timeline ? `<tr><th>什麼時候決定</th><td>${text(d.move_risk.decision_timeline)}</td></tr>` : ''}
        ${d.move_risk && d.move_risk.hesitation ? `<tr><th>會猶豫的點</th><td>${text(d.move_risk.hesitation)}</td></tr>` : ''}
        ${d.move_risk && d.move_risk.level ? `<tr><th>跑掉的風險</th><td><b>${text(d.move_risk.level)}</b></td></tr>` : ''}
      </table>` : ''}
      ${(d.number_checks || []).length ? `<h4 style="margin:18px 0 6px">成果數字追問</h4><table class="spec"><tr><th>他講的數字</th><th>他怎麼說明</th><th>說得清楚嗎</th></tr>${d.number_checks.map((n) => `<tr><td>${text(n.claim)}</td><td style="font-size:12.5px">${text(n.explained || '')}</td><td style="white-space:nowrap">${text(n.clarity || '—')}</td></tr>`).join('')}</table>` : ''}
      ${(d.consistency_flags || []).length ? `<div class="notice" style="margin:12px 0">⚠️ <b>前後說法對不上，打電話時可以追問</b><ul style="margin:6px 0 0;padding-left:18px">${d.consistency_flags.map((c) => `<li>${text(c.what)}${c.detail ? `<br><span class="muted">${text(c.detail)}</span>` : ''}</li>`).join('')}</ul></div>` : ''}
      ${d.referral ? `<p class="help" style="margin:8px 0">推薦人選：${text(d.referral)}</p>` : ''}
      ${hard ? `<h4 style="margin:18px 0 6px">硬條件</h4>
                <table class="spec"><tr><th>項目</th><th>結果</th><th>說明</th></tr>${hard}</table>` : ''}
      ${testHtml}
      ${todo.length ? `<h4 style="margin:18px 0 6px">阿財沒問到、要你補問的</h4><ul style="margin:0;padding-left:20px">${todo.map((x) => `<li style="margin:4px 0">${text(x)}</li>`).join('')}</ul>` : ''}
      ${full}`;
  },
  // ── 2026-10-21 快速應徵版初篩報告 ─────────────────────────────
  // Jacky：原本報告太流水帳，要表格、要區塊。照 step1ne-recruit/render_quick_report.py
  // （Jacky 看過拍板的版型）移植。只給快速應徵進來的人選用，其他人選照舊走 interviewResult。
  isQuickApply: (application = {}) => application.origin === 'quick_apply' || /^【快速應徵/.test(String(application.note || '')),
  quickApplyResult: (report, application = {}) => {
    let d = null;
    try { d = report && report.content_json ? JSON.parse(report.content_json) : null; } catch { d = null; }
    const full = `<details class="note-details" style="margin-top:12px"><summary><b>報告全文</b>（備查）</summary><p style="white-space:pre-wrap">${text(report.content_md || '（沒有內容）')}</p></details>`;
    if (!d) return `<div class="notice">這份報告沒有結構化資料，只能看原文。</div>${full}`;
    const E = (v) => escapeHtml(v ?? '');
    const BADGE = { 符合: ['ok', '符合'], 部分符合: ['wa', '部分符合'], 缺: ['bad', '不符'], 未確認: ['mu', '未確認'], 待確認: ['mu', '待確認'] };
    const pill = (v) => { const [c, t] = BADGE[v] || ['mu', v || '—']; return `<span class="qa-pill ${c}">${E(t)}</span>`; };
    // 快速應徵表單：note 每行「鍵：值」，【…】開頭的是標題行
    const q = {};
    String(application.note || '').split(/\r?\n/).forEach((line) => {
      const i = line.indexOf('：');
      if (i > 0 && !line.startsWith('【')) q[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    });
    const hasResume = !!(application.resume_file_id || String(application.resume_url || '').trim());
    const hasTest = application.has_assessment === null || application.has_assessment === undefined ? !!application.disc_primary : !!application.has_assessment;
    let mins = '';
    const t0 = Date.parse(String(application.interview_started_at || '').replace(' ', 'T'));
    const t1 = Date.parse(String(application.interview_ended_at || '').replace(' ', 'T'));
    if (Number.isFinite(t0) && Number.isFinite(t1) && t1 >= t0) mins = Math.floor((t1 - t0) / 60000);
    const route = d.route || {};
    const mot = d.motivation || {};
    const jm = (d.job_match || {}).items || [];
    const sk = d.skill_ladder || {};
    const basics = [['最高學歷', q['最高學歷'] || '（表單未填）'], ['學校與科系', q['學校與科系'] || q['科系'] || '—'],
      ['相關經驗', q['相關經驗']], ['會用的軟體', q['會用的軟體']], ['相關證照', q['相關證照']],
      ['機車駕照', q['機車駕照']], ['期望工作城市', q['期望工作城市'] || q['居住縣市']],
      ['期望待遇', String(mot.salary_gap || '').split('，')[0] || '—'], ['可到職', mot.notice_period || '—']];
    const rowsBasic = basics.map(([k, v]) => `<tr><th scope="row">${E(k)}</th><td>${E(v || '—')}</td></tr>`).join('');
    const rowsMatch = jm.map((i) => `<tr><td>${E(i.requirement)}</td><td class="vd">${pill(i.verdict)}</td><td>${E(i.evidence)}</td></tr>`).join('');
    const expLv = Number(sk.expected) || 0;
    const rowsLadder = (sk.topics || []).map((t) => {
      const lv = Number(t.level) || 0;
      const bars = [1, 2, 3, 4, 5].map((n) => `<i class="${lv >= n ? 'on' : ''}${n === expLv ? ' exp' : ''}"></i>`).join('');
      return `<tr><td>${E(t.topic)}</td><td><div class="qa-lv" role="img" aria-label="第 ${lv || 0} 級，職缺期待第 ${expLv} 級">${bars}</div></td><td>${E(t.level_name || (lv ? '' : '沒問到'))}</td></tr>`;
    }).join('');
    // 顧問要補問：consultant_followups ＋ not_covered，重複的（雙字詞重疊 ≥ 0.5）不再列一次
    const follow = (d.consultant_followups || []).filter(Boolean).map(String);
    const bi = (s) => { const out = new Set(); for (let i = 0; i < s.length - 1; i += 1) out.add(s.slice(i, i + 2)); return out; };
    const sim = (a, b) => { const A = bi(a); const B = bi(b); let n = 0; A.forEach((x) => { if (B.has(x)) n += 1; }); return n / Math.max(1, Math.min(A.size, B.size)); };
    (d.not_covered || []).forEach((x) => {
      const it = String((x && x.item) || '').trim();
      if (it && !follow.some((f) => { const h = f.split('（')[0]; return f.includes(it) || it.includes(h) || sim(it, h) >= 0.5; })) follow.push(`${it}（${x.kind ?? ''}）`);
    });
    const fc = d.for_client || {};
    const dirs = d.career_directions || [];
    const verdict = String(d.verdict || '');
    const vcls = verdict.includes('推') && !verdict.includes('不') ? 'ok' : (verdict.includes('不符') ? 'bad' : 'wa');
    const obs = d.observations || {};
    const li = (arr) => (arr || []).map((x) => `<li>${E(x)}</li>`).join('') || '<li>無</li>';
    return `<div class="qa-rep">
      <div class="qa-head"><div><span class="qa-tag">快速應徵</span>
        <p class="qa-sub">${E(application.job_title || application.job_slug)}｜面談 ${E(String(application.interview_started_at || '').slice(0, 16))}${mins !== '' ? `｜約 ${mins} 分鐘` : ''}</p></div>
        <div class="qa-status"><span class="qa-pill ${hasResume ? 'ok' : 'bad'}">履歷 ${hasResume ? '已交' : '未交'}</span><span class="qa-pill ${hasTest ? 'ok' : 'mu'}">測驗 ${hasTest ? '已做' : '未做'}</span></div></div>
      <section class="qa-hero ${vcls}"><div class="v">${E(d.verdict)}</div><p class="one">${E(d.one_liner)}</p>
        <div class="qa-two"><div><b>最大亮點</b><p>${E(d.top_selling_point)}</p></div><div><b>最大風險</b><p>${E(d.top_risk)}</p></div></div>
        <p class="route">系統分流：${E(route.label)}（${E(route.reason)}）</p></section>
      <div class="qa-grid">
        <section class="qa-card"><h4>快速應徵資料</h4><table class="qa-kv">${rowsBasic}</table></section>
        <section class="qa-card"><h4>顧問要補問</h4><ol class="qa-list">${follow.map((x) => `<li>${E(x)}</li>`).join('') || '<li>無</li>'}</ol></section>
      </div>
      <section class="qa-card"><h4>職缺條件逐條比對</h4><div class="qa-tw"><table class="qa-tb"><tr><th>職缺條件</th><th>判定</th><th>根據</th></tr>${rowsMatch || '<tr><td colspan="3">無</td></tr>'}</table></div></section>
      <div class="qa-grid">
        <section class="qa-card"><h4>專業程度（1～5 級，框線＝職缺期待）</h4><table class="qa-tb">${rowsLadder || '<tr><td>無</td></tr>'}</table></section>
        <section class="qa-card"><h4>動機與意願</h4><table class="qa-kv"><tr><th scope="row">想做這份工作的原因</th><td>${E(mot.why_this_role)}</td></tr>
          <tr><th scope="row">職涯方向</th><td>${E((d.motive || {}).direction)}</td></tr><tr><th scope="row">猶豫點</th><td>${E(mot.blockers || (d.move_risk || {}).hesitation || '—')}</td></tr>
          <tr><th scope="row">薪資</th><td>${E(mot.salary_gap)}</td></tr></table></section>
      </div>
      <div class="qa-grid">
        <section class="qa-card"><h4>推給客戶的理由</h4><ul class="qa-list">${li(fc.reasons)}</ul></section>
        <section class="qa-card"><h4>推之前要先講的風險</h4><ul class="qa-list">${li(fc.risks_to_disclose)}</ul></section>
      </div>
      <section class="qa-card"><h4>適合的職務方向</h4><div class="qa-dirs">${dirs.map((x) => `<div class="qa-dir"><h5>${E(x.direction)}</h5><p><b>為什麼</b>${E(x.why)}</p><p><b>要注意</b>${E(x.watch_out)}</p></div>`).join('') || '<p>無</p>'}</div></section>
      <section class="qa-card"><h4>面談觀察</h4><p>${E(obs.communication_style)}</p><p>${E(obs.engagement)}</p></section>
      <p class="qa-foot">資料來源：快速應徵表單＋AI 阿財面談（${E(String(report.created_at || '').slice(0, 16))} 產出）。判定標準：每項條件拆小項，全部有證據＝符合、部分有＝部分符合、明確沒有＝不符、沒問到＝未確認。</p>
      ${full}</div>`;
  },
  // 2026-10-01 AI 配對頁。資料就是 P3 的 candidate_job_recommendations，兩種來源：
  // 面談後找替代職缺（post_interview）、職缺開出來回頭找人才庫（reverse_job_open）。
  // 最上面固定講清楚：這裡的名單沒有聯絡任何人，要顧問按、而且寄信會先給預覽。
  // ── 2026-10-02 快速判斷：Jacky「不用一直完整點看，直接看 tab 就知道推不推、打不打電話」──
  // 一人一張小卡，只放阿財報告裡現成的：一句話、亮點、風險、分流、期望薪資、到職時間。
  // 三個按鈕都只是內部記號（不寄任何東西給人選、不改推薦流程）；「要打電話」會在 TG 通知負責顧問。
  // 2026-10-02 寄信約電話預覽（疊在上層的小抽屜）
  callMailPreview: (d, ui) => {
    const cons = ui.consultants || [];
    const opt = (v, label, cur) => `<option value="${escapeHtml(v)}" ${String(cur || '') === String(v) ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    if (d.error) return `<div class="notice">${text(d.error)}</div>`;
    return `<div class="cm-wrap">
      ${d.line_bound ? '<p class="notice">這位人選有綁 LINE，用 LINE 聯繫通常比較快。還是要寄信也可以。</p>' : ''}
      ${d.blocked ? `<p class="notice">${text(d.blocked)}</p>` : ''}
      <label class="am-me" style="margin:0 0 10px">我是 <select data-cm-me>${opt('', '選擇…（信的開頭會寫你的名字）', ui.me)}${cons.filter((c) => c.is_active).map((c) => opt(c.display_name, c.display_name, ui.me)).join('')}</select></label>
      ${(d.followups || []).length ? `<div class="notice" style="margin:0 0 12px"><b>電話裡要問的（阿財報告整理，只有你看得到，不會放進信裡）</b><ul class="am-list" style="margin:6px 0 0">${d.followups.map((x) => `<li>${text(x)}</li>`).join('')}</ul></div>` : ''}
      <dl class="am-mailmeta"><dt>寄給</dt><dd>${text(d.to)}</dd><dt>主旨</dt><dd>${text(d.subject)}</dd><dt>人選回信</dt><dd>會出現在 TG「📬 開發信 開信・回信」</dd></dl>
      <label class="field" style="margin-top:12px"><span>想多加一句話給人選（可以不填；不能出現「客戶」）</span>
        <textarea id="cm-note" rows="2" placeholder="例如：想先跟您確認可以出差的頻率">${text(d.note || ui.note || '', '')}</textarea></label>
      <fieldset class="cm-topics"><legend>電話中想確認哪幾項（勾了才會寫進信裡，可以全部不勾）</legend>
        ${(d.topic_options || []).map((t) => `<label class="cm-check"><input type="checkbox" data-cm-topic="${escapeHtml(t.key)}" ${t.on ? 'checked' : ''}> ${text(t.label)}</label>`).join('')}
        <label class="field" style="margin-top:6px"><span>自己加一項（可以不填；不能出現「客戶」）</span><input id="cm-topic-extra" maxlength="80" value="${escapeHtml(d.topic_extra || '')}" placeholder="例如：之前在新加坡的工作經驗"></label>
      </fieldset>
      <label class="cm-check"><input type="checkbox" data-cm-ask-resume ${d.ask_resume ? 'checked' : ''}> 請人選在回信附上履歷 PDF<span class="help">${d.has_resume_file ? '（系統裡已經有履歷檔，需要最新版才勾）' : '（系統裡沒有可讀的履歷檔，建議勾）'}</span></label>
      <div class="actions-row" style="margin:8px 0 12px"><button type="button" class="btn sm" data-cm-action="refresh">更新預覽</button></div>
      <iframe class="am-mailframe" sandbox="" title="信件預覽" srcdoc="${escapeHtml(d.html || '')}"></iframe>
      <div class="actions-row cm-actions" style="margin-top:12px;align-items:center">
        <button type="button" class="btn" data-cm-action="test" title="寄一封一模一樣的信到 Jacky 的信箱，不會寄給人選">寄測試信給 Jacky 看</button>
        <button type="button" class="btn primary" data-cm-action="send" ${d.blocked ? 'disabled' : ''}>確認寄給人選</button>
      </div></div>`;
  },
  triageTab: (data, ui) => {
    const items = (data && data.items) || [];
    const jobs = (data && data.jobs) || [];
    const cons = ui.consultants || [];
    const opt = (v, label, cur) => `<option value="${escapeHtml(v)}" ${String(cur || '') === String(v) ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    const jobOpts = new Map(jobs.map((j) => [j.job_slug, `${j.title || j.job_slug}（${j.n}）`]));
    if (ui.job && !jobOpts.has(ui.job)) jobOpts.set(ui.job, (items[0] && items[0].job_title) || ui.job);
    const ROUTE = { A: 'success', B: 'info', C: 'warning', D: '', E: 'danger' };
    const TRI = { push: ['推', 'success'], call: ['要打電話', 'info'], no: ['不推', ''] };
    const OWN = Object.fromEntries(cons.map((c) => [String(c.id), c.display_name]));
    const head = `<div class="filters tri-filters">
        <label class="am-me">我是 <select data-tri-filter="me">${opt('', '選擇…', ui.me)}${cons.filter((c) => c.is_active).map((c) => opt(c.display_name, c.display_name, ui.me)).join('')}</select></label>
        <select data-tri-filter="job" aria-label="職缺">${opt('', '所有職缺', ui.job)}${[...jobOpts].map(([v, l]) => opt(v, l, ui.job)).join('')}</select>
        <select data-tri-filter="days" aria-label="期間">${[['3', '近 3 天'], ['7', '近 7 天'], ['14', '近 14 天'], ['30', '近 30 天']].map(([v, l]) => opt(v, l, ui.days)).join('')}</select>
        <select data-tri-filter="view" aria-label="狀態">${opt('todo', '還沒決定', ui.view)}${opt('done', '已判斷', ui.view)}</select>
      </div>
      <p class="help" style="margin:0 0 10px">按下去只是內部記號，不會通知人選。「推」之後要送用人單位，照舊在人選卡片裡按；「要打電話」會在 TG 通知負責顧問。共 ${items.length} 位</p>`;
    if (!items.length) return head + empty(ui.view === 'todo' ? '這段期間的面談都判斷完了' : '這段期間還沒有判斷過的人選', '換個期間或職缺看看。');
    const card = (r) => {
      const rc = r.route_code || '';
      const line = (icon, label, v) => v ? `<div class="tri-line"><span class="tri-k">${icon} ${label}</span><span>${text(v)}</span></div>` : '';
      const tri = TRI[r.triage];
      return `<article class="card tri-card" data-tri-app="${escapeHtml(r.application_id)}" data-tri-name="${escapeHtml(r.name || '')}">
        <div class="tri-top">
          <div><button type="button" class="am-name" data-tri-action="open">${text(r.name)}</button>
            <span class="muted">${text(r.job_title || r.job_slug, '')}・${text(String(r.interview_ended_at || r.report_at || '').slice(5, 16))}${r.owner ? `・${text(OWN[r.owner] || r.owner)}` : '・未指派'}</span></div>
          <div class="am-tags">${rc ? `<span class="badge ${ROUTE[rc] || ''}" title="${escapeHtml(r.route_reason || '')}">阿財：${text(rc)} ${text(r.route_label || '')}</span>` : ''}${r.score != null ? `<span class="badge">${text(r.score)} 分</span>` : ''}</div>
        </div>
        ${r.one_liner ? `<p class="tri-one">${text(r.one_liner)}</p>` : ''}
        ${line('＋', '亮點', r.top_selling_point)}
        ${line('！', '風險', r.top_risk)}
        ${(r.expected_salary || r.available_date) ? line('・', '條件', [r.expected_salary ? `期望 ${r.expected_salary}` : '', r.available_date ? `到職 ${r.available_date}` : ''].filter(Boolean).join('｜')) : ''}
        ${r.call_mail_at ? `<div class="am-status"><span class="badge ${r.call_mail_reply_at ? 'success' : 'info'}">${r.call_mail_reply_at ? '人選已回信約時間（看 TG）' : '已寄信約電話'}</span> ${text(String(r.call_mail_reply_at || r.call_mail_at).slice(5, 16))}</div>` : ''}
        ${!r.has_email && !r.line_bound ? '<p class="help" style="margin:0">沒綁 LINE、也沒有 Email，只能直接打電話</p>' : ''}
        ${tri ? `<div class="am-status"><span class="badge ${tri[1]}">${tri[0]}</span> ${text(r.triage_by || '')}・${text(String(r.triage_at || '').slice(5, 16))}${r.triage_note ? `｜${text(r.triage_note)}` : ''}</div>` : ''}
        <div class="actions-row tri-actions">
          ${r.triage ? `<button type="button" class="btn sm" data-tri-action="undo">復原（放回還沒決定）</button>` : `
          <button type="button" class="btn primary sm" data-tri-action="push">推</button>
          <button type="button" class="btn sm" data-tri-action="call">要打電話</button>
          <button type="button" class="btn ghost sm" data-tri-action="no">不推</button>`}
          <button type="button" class="btn ghost sm" data-tri-action="open">看完整報告</button>
          ${r.has_email && !r.line_bound ? `<button type="button" class="btn ghost sm" data-call-mail="${escapeHtml(r.application_id)}" data-call-mail-name="${escapeHtml(r.name || '')}">寄信約電話</button>` : ''}
          ${r.call_mail_reply_at ? `<button type="button" class="btn sm" data-call-confirm="${escapeHtml(r.application_id)}" data-call-mail-name="${escapeHtml(r.name || '')}">回信確認電話時間</button>` : ''}
        </div>
      </article>`;
    };
    return head + `<div class="tri-grid">${items.map(card).join('')}</div>`;
  },
  aiMatchTab: (data, ui) => {
    const items = (data && data.items) || [];
    const jobs = (data && data.open_jobs) || [];
    const cons = ui.consultants || [];
    const MATCH = { MATCH_CANDIDATE: ['很可能適合', 'success'], POSSIBLE_MATCH: ['可能適合', 'info'], INSUFFICIENT_DATA: ['資料不足', 'warning'], NOT_MATCH: ['不適合', 'danger'] };
    const CONF = { high: '高', medium: '中', low: '低' };
    const OUT = { outreach_queued: 'LINE 排隊中', outreach_sent: 'LINE 已發出，等人選回覆', outreach_blocked: 'LINE 沒發出去',
      candidate_interested: '🟢 人選按了「想了解看看」——換你接手聯繫', candidate_declined: '人選說這次不用', candidate_question: '❓ 人選按了「我有問題」，請直接聯繫說明' };
    const opt = (v, label, cur) => `<option value="${escapeHtml(v)}" ${String(cur || '') === String(v) ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    const jobOpts = new Map(jobs.map((j) => [j.slug, j.status === 'social_only' ? `🔒 ${j.title}（未簽約・只能內部看）` : j.title]));
    items.forEach((r) => { if (!jobOpts.has(r.recommended_job_slug)) jobOpts.set(r.recommended_job_slug, r.job_title || r.recommended_job_slug); });
    const runInfo = (j) => j.last_run_at ? `上次 ${String(j.last_run_at).slice(5, 16)}${j.last_run_status === 'queued' ? '（排隊中）' : `・找到 ${j.last_run_saved ?? 0} 位`}` : '還沒找過';
    const head = `<div class="notice" style="margin:0 0 12px"><b>AI 只做建議。</b>這裡的名單都還沒聯絡任何人——發 LINE、寄信都要你按，寄信前會先給你看信的內容。</div>
      <div class="filters am-filters">
        <label class="am-me">我是 <select data-am-filter="me">${opt('', '選擇…', ui.me)}${cons.filter((c) => c.is_active).map((c) => opt(c.display_name, c.display_name, ui.me)).join('')}</select></label>
        <select data-am-filter="view" aria-label="狀態">${[['todo', '待處理'], ['invited', '已邀請'], ['rejected', '不適合'], ['all', '全部']].map(([v, l]) => opt(v, l, ui.view)).join('')}</select>
        <select data-am-filter="job" aria-label="職缺">${opt('', '所有職缺', ui.job)}${[...jobOpts].map(([v, l]) => opt(v, l, ui.job)).join('')}</select>
        <select data-am-filter="owner" aria-label="顧問">${opt('', '所有顧問', ui.owner)}${opt('unassigned', '未指派', ui.owner)}${cons.map((c) => opt(c.id, c.display_name, ui.owner)).join('')}</select>
        <select data-am-filter="confidence" aria-label="信心">${opt('', '所有信心', ui.confidence)}${opt('high', '信心：高', ui.confidence)}${opt('medium', '信心：中', ui.confidence)}${opt('low', '信心：低', ui.confidence)}</select>
        <select data-am-filter="source" aria-label="來源">${opt('', '所有來源', ui.source)}${opt('reverse_job_open', '新職缺回頭找人才庫', ui.source)}${opt('post_interview', '面談後推薦其他職缺', ui.source)}</select>
      </div>
      <details class="card am-run"><summary><b>用人才庫幫一個職缺找人</b><span class="muted">&emsp;新開的職缺系統會自動找；舊職缺想重新找一次用這裡</span></summary>
        <div class="filters" style="margin:12px 0 0"><select data-am-run-job aria-label="選職缺">${jobs.map((j) => `<option value="${escapeHtml(j.slug)}">${j.status === 'social_only' ? '🔒 ' : ''}${escapeHtml(j.title)}${j.status === 'social_only' ? '（未簽約・只能內部看）' : ''}｜${escapeHtml(runInfo(j))}</option>`).join('')}</select>
        <button type="button" class="btn primary" data-am-action="run">開始找人</button></div>
        <p class="help" style="margin:8px 0 0">比對最近 180 天內跟阿財面談過的人（不含已應徵這個職缺、已淘汰、已在錄取階段的人），每個職缺最多留 5 位。大約 1～3 分鐘後重新整理就看得到，也會在 TG 發一則摘要。</p>
      </details>
      <p class="help" style="margin:12px 0 8px">共 ${items.length} 筆</p>`;
    if (!items.length) {
      const msg = ui.view === 'todo' ? '目前沒有待處理的 AI 配對' : '這個篩選條件下沒有資料';
      return head + empty(msg, '新職缺開出來時，系統會自動從人才庫找；面談完的人也會自動比對其他職缺。');
    }
    const row = (r) => {
      const [ml, mt] = MATCH[r.match_status] || ['無法判斷', 'warning'];
      const done = r.status === 'rejected' || r.outreach_status || r.email_status === 'sent';
      const jobOpen = ['open', 'active', ''].includes(String(r.job_status || ''));
      // 2026-10-07 未簽約客戶職缺：只能內部看，不准寄信／LINE 邀請（先打電話問意願，別講公司名）
      const socialOnly = r.job_status === 'social_only';
      const soWhy = '未簽約客戶職缺只能內部看：先打電話問意願，別讓人選知道公司';
      const lineWhy = socialOnly ? soWhy : (!jobOpen ? '這個職缺已經不是招募中' : (!r.line_bound ? '這位人選沒有綁定 LINE' : ''));
      const mailWhy = socialOnly ? soWhy : (!jobOpen ? '這個職缺已經不是招募中' : (!r.has_email ? '這位人選沒有可用的 Email' : (r.email_status === 'sending' ? '寄送中' : '')));
      const list = (arr, cls) => (arr || []).length ? `<ul class="am-list ${cls}">${arr.map((x) => `<li>${text(x)}</li>`).join('')}</ul>` : '';
      const status = [];
      if (r.status === 'rejected') status.push(`<span class="badge">不適合</span> ${text(r.consultant_decision_by, '')}・${text(r.consultant_decision_at, '')}${r.rejection_reason ? `｜${text(r.rejection_reason)}` : ''}`);
      if (r.outreach_status) status.push(`<span class="badge ${r.outreach_status === 'outreach_blocked' ? 'danger' : 'info'}">LINE</span> ${text(OUT[r.outreach_status] || r.outreach_status)}${r.outreach_status === 'outreach_blocked' && r.outreach_blocked_reason ? `：${text(r.outreach_blocked_reason)}` : ''}${r.outreach_sent_at ? `&emsp;<span class="muted">${text(r.outreach_sent_by || '')} ${text(r.outreach_sent_at)}</span>` : ''}`);
      if (r.email_status === 'sent') status.push(`<span class="badge info">Email</span> 已寄出邀請&emsp;<span class="muted">${text(r.email_sent_by || '')} ${text(r.email_sent_at)}</span>`);
      if (r.email_status === 'failed') status.push(`<span class="badge danger">Email</span> 上次寄送失敗：${text(r.email_error || '')}（可以再寄一次）`);
      return `<article class="card am-row" data-rec-id="${escapeHtml(r.id)}">
        <div class="am-top">
          <div class="am-who">
            <button type="button" class="am-name" data-am-action="open" data-app-id="${escapeHtml(r.application_id)}">${text(r.candidate_name)}</button>
            <span class="muted">原應徵：${text(r.applied_job_title || r.applied_job_slug, '—')}</span>
          </div>
          <span class="am-arrow" aria-hidden="true">→</span>
          <div class="am-job"><b>${text(r.job_title || r.recommended_job_slug)}</b>
            <span class="muted">${text(r.job_salary_text || '')}${socialOnly ? '・<b style="color:#8a5a00">🔒 未簽約客戶職缺（只能內部看，先別讓人選知道公司）</b>' : (!jobOpen ? '・<b style="color:#a72f3a">已不是招募中</b>' : '')}</span></div>
          <div class="am-tags"><span class="badge ${mt}">${ml}</span>${CONF[r.confidence] ? `<span class="badge">信心 ${CONF[r.confidence]}</span>` : ''}
            <span class="badge ${r.match_source === 'reverse_job_open' ? 'warning' : ''}">${r.match_source === 'reverse_job_open' ? '新職缺回頭找' : '面談後推薦'}</span></div>
        </div>
        <div class="am-body">
          ${list(r.reasons, 'good')}
          ${list(r.blockers, 'warn')}
          ${(r.missing_information || []).length ? `<p class="help" style="margin:6px 0 0">還要確認：${(r.missing_information || []).map((x) => text(x)).join('；')}</p>` : ''}
          ${r.candidate_why ? `<p class="am-why"><span class="muted">給人選看的那一句：</span>${text(r.candidate_why)}</p>` : ''}
        </div>
        ${status.length ? `<div class="am-status">${status.map((x) => `<div>${x}</div>`).join('')}</div>` : ''}
        ${done ? '' : `<div class="actions-row am-actions">
          <button type="button" class="btn primary sm" data-am-action="line" ${lineWhy ? 'disabled' : ''} title="${escapeHtml(lineWhy || '用 LINE 問人選有沒有興趣')}">發 LINE 邀請</button>
          <button type="button" class="btn sm" data-am-action="email" ${mailWhy ? 'disabled' : ''} title="${escapeHtml(mailWhy || '先看信的內容再決定要不要寄')}">寄信邀請</button>
          <button type="button" class="btn ghost sm" data-am-action="reject">不適合</button>
          ${socialOnly ? `<span class="help">${text(soWhy)}</span>` : (lineWhy && mailWhy ? '' : (lineWhy ? `<span class="help">LINE：${text(lineWhy)}</span>` : (mailWhy ? `<span class="help">Email：${text(mailWhy)}</span>` : '')))}
        </div>`}
      </article>`;
    };
    return head + `<div class="am-grid">${items.map(row).join('')}</div>`;
  },
  // ── 2026-10-01 外部人選資料卡（AI 找的人）──────────────────────────────────
  // 外部人選沒有正式履歷，所以先把能看的全部攤開（AI 抓到的公開資料＋原始頁面連結＋顧問上傳的履歷），
  // 看完才給三個選擇：寄信邀請／不適合／先跳過。寄信只能從這張卡裡按，清單上不給一鍵寄。
  sourcedListMailBtn: (r) => {
    const email = String(r.email || '').trim();
    if (!email) return '<button type="button" class="btn sm" disabled title="這位人選沒有 Email，只能打電話或私訊">寄信邀請（沒有 Email）</button>';
    if (r.last_contact_result === 'email_invited') return '<span class="badge success">已寄邀請信</span>';
    return '';
  },
  sourcedCard: (d, ui) => {
    const p = d.person || {};
    const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : '');
    const lk = (u, label) => (safeUrl(u) ? `<a class="btn ghost sm" href="${escapeHtml(safeUrl(u))}" target="_blank" rel="noopener">開新分頁看${text(label)}</a>` : '');
    const others = String((d.links || {}).other || '').split(/[\s,，、]+/).map(safeUrl).filter(Boolean).slice(0, 4);
    const links = [lk(d.links?.linkedin, ' LinkedIn'), lk(d.links?.github, ' GitHub'),
      d.links?.source && d.links.source !== d.links.linkedin && d.links.source !== d.links.github ? lk(d.links.source, '原始頁面') : '',
      ...others.map((u) => lk(u, '作品／其他頁面'))].filter(Boolean).join('');
    const fmt = (v) => {
      if (v == null || v === '') return '';
      if (Array.isArray(v)) return `<ul class="sc-list">${v.slice(0, 8).map((x) => `<li>${text(typeof x === 'object' ? Object.values(x).filter((y) => y && typeof y !== 'object').join('・') : x)}</li>`).join('')}</ul>`;
      if (typeof v === 'object') return `<p>${text(Object.entries(v).map(([k, x]) => `${k}：${x}`).join('・'))}</p>`;
      return `<p>${text(v)}</p>`;
    };
    const sec = (title, inner) => (inner ? `<section class="sc-sec"><h3>${title}</h3>${inner}</section>` : '');
    const RES = { no_answer: '沒接／沒回', interested: '有興趣', not_interested: '沒興趣', invited: '已約阿財面談', wrong_person: '資料不對／不是本人', email_invited: '已寄邀請信', opt_out: '本人說不要再寄' };
    const fitMark = p.fit === 'fit' ? '<span class="badge success">✓ 顧問評：符合</span>' : p.fit === 'unfit' ? '<span class="badge danger">✕ 顧問評：不符合</span>' : p.fit === 'unsure' ? '<span class="badge">？ 不確定</span>' : '';
    const m = d.mail || {};
    const mailWhy = !m.email ? '這位人選沒有 Email，只能打電話或私訊' : (m.blocked || '');
    const sentList = (m.sent || []).map((s) => `<li>${text(s.job_title || s.job_slug)}：${s.status === 'sent' ? `已寄出（${text(s.sent_by || '')}・${text(String(s.sent_at || '').slice(0, 16))}・${s.via === 'telegram' ? 'TG' : '後台'}）` : s.status === 'failed' ? `寄送失敗：${text(s.error || '')}` : '寄送中'}</li>`).join('');
    const logs = (d.logs || []).map((l) => `<li>${text(String(l.created_at || '').slice(0, 16))}・${text(l.caller || '')}・${text(RES[l.result] || l.result || '')}${l.note ? `・${text(l.note)}` : ''}</li>`).join('');
    const tg = d.tg ? `<p class="help">Telegram 待判斷卡：${text(String(d.tg.pushed_at || '').slice(0, 16))} 推過${d.tg.action ? `，${text(d.tg.action_by || '')} ${d.tg.action === 'sent' ? '已寄出' : d.tg.action === 'unfit' ? '判定不適合' : '先跳過'}` : '，還沒人按'}</p>` : '';
    const resume = d.resume || {};
    const resumeHtml = [resume.file_id ? `<button type="button" class="btn sm" data-download-file="${escapeHtml(resume.file_id)}">下載履歷檔</button>` : '',
      safeUrl(resume.url) ? `<a class="btn ghost sm" href="${escapeHtml(safeUrl(resume.url))}" target="_blank" rel="noopener">開新分頁看履歷連結</a>` : '',
      resume.note ? `<p class="help">${text(resume.note)}</p>` : ''].join('');
    const cons = (ui.consultants || []).filter((c) => c.is_active);
    const me = `<label class="sc-me">我是 <select data-sc-me>${['<option value="">選擇…</option>', ...cons.map((c) => `<option value="${escapeHtml(c.display_name)}" ${c.display_name === ui.me ? 'selected' : ''}>${text(c.display_name)}</option>`)].join('')}</select></label>`;
    const done = p.status === 'rejected';
    return `<div class="sc-card">
<div class="sc-head"><b class="sc-name">${text(p.name || '（沒有名字）')}</b>${p.grade ? `<span class="badge info">${text(p.grade)} 級${p.score != null ? ` · ${text(p.score)} 分` : ''}</span>` : ''}${fitMark}${done ? `<span class="badge danger">已標不適合${p.reject_reason ? `：${text(p.reject_reason)}` : ''}</span>` : ''}</div>
<p class="sc-job">應徵職缺：<b>${text(d.job?.title || '（沒有對應職缺）')}</b>${d.job && !['open', 'active'].includes(d.job.status) ? ' <span class="badge">已不是招募中</span>' : ''}</p>
${sec('他現在', `<p>${[p.headline, p.company, p.location].filter(Boolean).map((x) => text(x)).join('<br>') || '—'}</p>${p.years ? `<p class="help">年資：${text(p.years)}</p>` : ''}`)}
${sec('技能', p.skills ? `<p>${text(p.skills)}</p>` : '')}
${sec('自我介紹', p.bio ? `<p>${text(p.bio)}</p>` : '')}
${sec('經歷', fmt(p.experience))}
${sec('學歷', fmt(p.education))}
${sec('為什麼 AI 配到這個職缺 <small>（內部評估，不會寄給人選）</small>', (p.note || p.evidence) ? `<p>${text(p.note || p.evidence)}</p>` : '')}
${d.outreach ? sec('LinkedIn 訊息 <small>（AI 挖角寫的，自己複製貼上送出）</small>', `${d.outreach.blocked ? `<p class="notice">${text(d.outreach.blocked)}</p>` : ''}
${d.outreach.connect_note ? `<label class="field sc-msg"><span>① 送連結邀請時的附註（${text(String(d.outreach.connect_note).length)}／180 字）</span>
<textarea readonly rows="4" id="sc-msg-connect">${escapeHtml(d.outreach.connect_note)}</textarea></label>
<button type="button" class="btn sm sc-copy" data-sc-copy="sc-msg-connect">複製</button>` : ''}
${d.outreach.followup_msg ? `<label class="field sc-msg"><span>② 對方接受邀請後的第一則私訊</span>
<textarea readonly rows="8" id="sc-msg-followup">${escapeHtml(d.outreach.followup_msg)}</textarea></label>
<button type="button" class="btn sm sc-copy" data-sc-copy="sc-msg-followup">複製</button>` : ''}
<p class="help">送之前再看一次：不要加上公司名稱。</p>`) : ''}
${sec('原始頁面', links ? `<div class="sc-links">${links}</div>` : '<p class="help">沒有可以點開的頁面</p>')}
${sec('履歷', resumeHtml || '<p class="help">還沒有履歷檔（外部人選通常沒有，看上面的原始頁面判斷）</p>')}
${sec('聯絡方式', `<p>${m.email ? `Email：${text(m.email)}${p.company_email ? ' <span class="badge warning">看起來是公司信箱</span>' : ''}` : '沒有 Email'}${p.phone ? `<br>電話：${text(p.phone)}` : ''}</p>`)}
${sec('聯絡紀錄', (logs || sentList) ? `${sentList ? `<ul class="sc-list">${sentList}</ul>` : ''}${logs ? `<ul class="sc-list">${logs}</ul>` : ''}` : '<p class="help">還沒聯絡過</p>')}
${tg}
<div class="sc-decide">
  <p class="help">看完了嗎？今天已寄 ${text(m.today_sent ?? 0)}／${text(m.daily_max ?? 20)} 封（全系統每天上限）。同一個人 30 天內只會收到一封。</p>
  ${me}
  ${mailWhy ? `<p class="notice sc-why-not">不能寄信：${text(mailWhy)}</p>` : ''}
  <div class="sc-btns">
    <button type="button" class="btn primary" data-sc-action="mail" ${mailWhy ? 'disabled' : ''}>寄信邀請（先看預覽）</button>
    <button type="button" class="btn" data-sc-action="unfit-show" ${done ? 'disabled' : ''}>不適合</button>
    <button type="button" class="btn ghost" data-sc-action="skip">先跳過</button>
  </div>
  <div class="sc-unfit" hidden>
    <label class="field"><span>不適合的原因</span><select data-sc-reason><option value="">選一個…</option>${(d.reject_reasons || []).map((r) => `<option>${text(r)}</option>`).join('')}</select></label>
    <button type="button" class="btn danger" data-sc-action="unfit-confirm">確認不適合（會從待辦清單拿掉）</button>
  </div>
</div></div>`;
  },
  sourcedMailPreview: (d) => `
    <button type="button" class="btn ghost sm" data-sc-action="back">← 回資料卡</button>
    ${d.blocked ? `<div class="notice"><b>現在不能寄：</b>${text(d.blocked)}</div>` : ''}
    ${d.error ? `<div class="notice"><b>還不能寄：</b>${text(d.error)}</div>` : ''}
    ${d.company_email ? '<div class="notice">⚠️ 這個信箱看起來是他<b>現在公司</b>的信箱，信可能被公司看到。確定要寄再寄。</div>' : ''}
    <dl class="am-mailmeta"><dt>寄給</dt><dd>${text(d.to || '—')}</dd><dt>寄件人</dt><dd>Step1ne 德仁管理顧問 &lt;noreply@step1ne.com&gt;（人選回信會到 official@step1ne.com）</dd><dt>主旨</dt><dd>${text(d.subject || '—')}</dd><dt>今天已寄</dt><dd>${text(d.today_sent ?? 0)}／${text(d.daily_max ?? 20)} 封</dd></dl>
    <label class="field" style="margin:12px 0"><span>「為什麼想到您」這一句（可以自己改，改完按「更新預覽」）</span>
      <textarea id="sc-why" rows="2" maxlength="120">${escapeHtml(d.why || d.suggested_why || '')}</textarea></label>
    <p class="help" style="margin:-4px 0 10px">不能寫公司名稱、「客戶」、年齡性別、待業空窗，也不能提資料是從哪裡找到的（LinkedIn、GitHub、104…）。專屬應徵連結寄出時才產生。</p>
    ${d.html ? `<iframe class="am-mailframe" title="信件預覽" sandbox="" srcdoc="${escapeHtml(d.html)}"></iframe>` : ''}
    <div class="sc-btns">
      <button type="button" class="btn" data-sc-action="refresh">更新預覽</button>
      <button type="button" class="btn" data-sc-action="test" ${d.error ? 'disabled' : ''} title="寄一封一模一樣的信到 Jacky 的信箱，不會寄給人選、不改任何狀態">寄測試信給 Jacky 看</button>
      <button type="button" class="btn primary" data-sc-action="send" ${!d.error && !d.blocked ? '' : 'disabled'}>確認寄給人選</button>
    </div>`,
  aiMatchEmailPreview: (d) => `
    ${d.blocked ? `<div class="notice"><b>現在不能寄：</b>${text(d.blocked)}</div>` : ''}
    ${d.error ? `<div class="notice"><b>還不能寄：</b>${text(d.error)}</div>` : ''}
    <dl class="am-mailmeta"><dt>寄給</dt><dd>${text(d.to || '—')}</dd><dt>寄件人</dt><dd>Step1ne 德仁管理顧問 &lt;noreply@step1ne.com&gt;（人選回信會到 official@step1ne.com）</dd><dt>主旨</dt><dd>${text(d.subject || '—')}</dd></dl>
    <label class="field" style="margin:12px 0"><span>「為什麼想到您」這一句（可以自己改，改完按「更新預覽」）</span>
      <textarea id="am-why" rows="2" maxlength="120">${escapeHtml(d.why || d.suggested_why || '')}</textarea></label>
    <p class="help" style="margin:-4px 0 10px">不能寫公司名稱、「客戶」、年齡性別、待業空窗這類評估。</p>
    ${d.html ? `<iframe class="am-mailframe" title="信件預覽" sandbox="" srcdoc="${escapeHtml(d.html)}"></iframe>` : ''}`,
  systemSpecTab: () => `<div class="card"><h2>0 · 阿財分流 A–E：什麼條件會被分到哪一類</h2>
<p class="help">2026-09-21 上線。阿財面談完，系統會自動把人選分成五類，顯示在首頁、人選中心與報告最上方。
<b>分流由程式用固定規則算，不是模型自由判斷</b>——同一份報告重跑兩次一定落在同一類，顧問才能拿它排今天要打的電話順序。</p>
<table class="spec">
  <tr><th>分流</th><th>意思</th><th>什麼情況會被分到這一類</th></tr>
  <tr><td><span class="badge" style="background:#e6f4ec;color:#1a7f4b;font-weight:700">A</span></td>
      <td><b>優先聯繫</b></td>
      <td>總分 <b>65 分以上</b>，硬條件沒有任何一項不符，而且阿財沒說還有關鍵沒問到</td></tr>
  <tr><td><span class="badge" style="background:#e7f0fa;color:#1c5fa8;font-weight:700">B</span></td>
      <td><b>需顧問判斷</b></td>
      <td>三種情況：① 總分 50–64 的中間帶；② 這場問到的資料太少、<b>算不出總分</b>；③ 分數雖高，但阿財判定「資訊不足建議補問」</td></tr>
  <tr><td><span class="badge" style="background:#fdf0e3;color:#c2600d;font-weight:700">C</span></td>
      <td><b>可轉其他職缺</b></td>
      <td>這個職缺的硬條件沒過，<b>但整體分數 50 分以上</b>——意思是「這個缺不適合」，不是「這個人不適合」</td></tr>
  <tr><td><span class="badge" style="background:#f1ebf9;color:#6b3fa0;font-weight:700">D</span></td>
      <td><b>人才池</b></td>
      <td>總分 <b>低於 50 分</b>，但硬條件沒有不符。先留著，之後有別的缺再看</td></tr>
  <tr><td><span class="badge" style="background:#fbeceb;color:#a32b21;font-weight:700">E</span></td>
      <td><b>Hard Gate 沒過</b></td>
      <td>硬條件不符，而且分數也撐不起來（低於 50 或算不出來）</td></tr>
</table>
<div class="notice"><b>「資料不足」永遠是 B，不會掉進 D。</b>沒問到不等於不適合——把沒問到的人歸成人才池，等於讓一場問得少的面談決定一個人的去留。這條規則有寫測試鎖住。</div>
<div class="notice"><b>總分怎麼算：</b>七個面向各 0–10 分，加權後換算成百分。權重是硬條件符合度 25、專業技能深度 20、相關經驗深度 20、案例具體度 12、動機明確度 12、溝通清晰度 7、工作穩定度 4。
<b>面談沒談到的面向不算 0 分</b>，是把它的權重從分母拿掉——不然話少的場次會被系統性懲罰。有依據的權重不到 50 就不給總分（該筆歸 B）。</div>
<div class="notice"><b>專業技能深度</b>這一維，是把這場問到的每一道職缺專業題各打 1–5 級後取平均 ×2。那把尺量的是「<b>他講得有多深</b>」，不是「答案對不對」——1 級＝只講得出「我會」，5 級＝講得出踩過的坑與取捨。專業對錯留給顧問跟用人主管判斷。</div>
<div class="notice">⚠️ <b>分數等第（優／良／中／待加強）跟分流 A–E 是兩回事。</b>等第原本也用 A/B/C/D，跟分流撞字，2026-09-21 改成中文。看到「良」是分數，看到「A」是分流。</div>
<div class="notice">分流<b>不會</b>影響人選在進度條上的階段，也不會發任何訊息給人選。它只是排序與提醒，最終要不要推、怎麼推，還是顧問決定。</div>
</div>
<div class="notice">以下是面談規格：此頁是靜態規格文件，不是可即時控制阿財 prompt 的設定頁。要調面談邏輯得改後端 SKILL.md，非本畫面可操作範圍。2026-08-11 版；佔比之後要調也是改那邊。</div>
<div class="card"><h2>1 · 先看預算：一場只有 9 題</h2><p class="help">抓 10 場已完成面談的真實紀錄算出來的，不是估計。</p><div class="kpi-grid"><article class="kpi"><span>阿財提問（中位數）</span><strong>9.5</strong></article><article class="kpi"><span>人選回覆次數</span><strong>7.7</strong></article><article class="kpi"><span>分鐘（中位數）</span><strong>31</strong></article><article class="kpi"><span>人選單次回覆字數</span><strong>13–113</strong></article></div><div class="notice">九題就是全部。四個面向要驗，一個面向平均只分得到兩題多，還要扣掉硬條件確認與收尾。所以問一題履歷上寫過的東西＝丟掉 11% 的預算。呂書帆那場前兩題都是履歷上有的——他等於是到第三題才開始被面談，然後在中途說「問的都有履歷上面寫過的問題很沒效率」。</div></div>
<div class="card"><h2>2 · 佔比：一般職缺（10 題）</h2><div class="spec-bar"><div class="spec-b0" style="flex:1">硬條件 10%</div><div class="spec-b1" style="flex:2">① 技能 20%</div><div class="spec-b2" style="flex:2">② 經驗 20%</div><div class="spec-b3" style="flex:2">③ 實際探查 20%</div><div class="spec-b4" style="flex:2">④ 人格特質 20%</div><div class="spec-b5" style="flex:1">換他問 10%</div></div><table class="spec"><tr><th>題數</th><th>面向</th><th>這一段要拿到什麼</th></tr><tr><td class="num">1</td><td>硬條件確認</td><td>只問履歷與表單「沒填」或「兩邊衝突」的。都齊全就 0 題，省下來給後面用</td></tr><tr><td class="num">2</td><td>① 技能確認</td><td>他列的技能實際做到哪一層。不是會不會，是做到什麼程度</td></tr><tr><td class="num">2</td><td>② 經驗：具體在做什麼</td><td>那個職稱每天實際在做的事。同一個職稱在不同公司差很多</td></tr><tr><td class="num">2</td><td>③ 這段時間的實際探查</td><td>進去時什麼樣、離開時什麼樣、他改變了哪一段。含空窗與離職原因</td></tr><tr><td class="num">2</td><td>④ 人格特質驗收</td><td>全部附掛在 ①②③ 的回答上追問，不獨立出題</td></tr><tr><td class="num">1</td><td>換他問</td><td>他問什麼，透露他在意什麼</td></tr></table></div>
<div class="card"><h2>3 · 佔比：中高階（5 題）</h2><div class="spec-bar"><div class="spec-b3" style="flex:2">③ 實際探查 40%</div><div class="spec-b4" style="flex:1">④ 特質 20%</div><div class="spec-b1" style="flex:1">最大落差 20%</div><div class="spec-b2" style="flex:1">薪資・時程 20%</div></div><table class="spec"><tr><th>題數</th><th>面向</th><th>為什麼這樣分</th></tr><tr><td class="num">0</td><td>①② 技能與經驗</td><td>履歷已經寫了。中高階的履歷比基層完整得多，問了就是那句「很沒效率」</td></tr><tr><td class="num">2</td><td>③ 實際探查</td><td>履歷寫「負責再生專案」，但沒寫「接手時最爛的是哪一塊、他改變了什麼」</td></tr><tr><td class="num">1</td><td>④ 人格特質</td><td>附掛在 ③ 的回答上：「這個決定是你拍板還是上面交代的？」</td></tr><tr><td class="num">1</td><td>最大落差</td><td>履歷跟這個缺對不上的那一點（例：管理職 → 不帶人的特助）</td></tr><tr><td class="num">1</td><td>薪資結構與決策時程</td><td>中高階不談這兩件等於沒談。基層看表單就好，中高階的結構複雜得多</td></tr></table><div class="notice">中高階的硬條件（地點、工作型態、待命）用確認語氣一次帶過，不佔題數：「這個缺要〈照該職缺實際的工作型態講〉、彈性工時，也有一定程度待命——這樣的型態您可以嗎？」</div><div class="notice">判準是「職級」，不是「服務線」。派遣也會有中高階（派遣的廠長、專案總監）。用服務線判斷的話，那種缺會被當成基層跑 30 分鐘標準流程。職級在職缺頁自己調：基層／一般／中高階。</div></div>
<div class="card"><h2>4 · 四個面向要問到什麼層次</h2><div class="two-col"><div><h3>① 技能確認</h3><div class="spec-q no">❌「您會不會寫 SOP？」</div><div class="spec-q yes">✅「那份 SOP 你寫了幾條？誰在用？有人不照做的時候怎麼處理？」</div><p class="help">「會不會」的答案永遠是會。要問的是做到哪一層。</p></div><div><h3>② 經驗：具體在做什麼</h3><div class="spec-q no">❌「您主要負責哪些事？」</div><div class="spec-q yes">✅「這個職稱，你每天進辦公室第一件事是什麼？」</div><p class="help">同一個職稱，在不同公司可以是排班發薪，也可以是重整整個部門。</p></div><div><h3>③ 這段時間的實際探查</h3><div class="spec-q no">❌「這段做了多久？」（履歷上有）</div><div class="spec-q yes">✅「你接手的時候現場最爛的是哪一塊？離開時變成什麼樣？」</div><p class="help">年資長不等於做得深。要問的是這段時間裡發生了什麼變化。</p></div><div><h3>④ 人格特質驗收</h3><div class="spec-q no">❌「您覺得自己是什麼樣的人？」</div><div class="spec-q yes">✅「那個做不來的員工，你最後怎麼處理？」</div><p class="help">從他講的事反推，不要另外問性格題——那種題目每個人都背過答案。</p></div></div><table class="spec" style="margin-top:14px"><tr><th>想驗的特質</th><th>從哪種回答切進去</th></tr><tr><td>主導 vs 配合</td><td>「這個決定是你自己拍板，還是上面交代的？」</td></tr><tr><td>對人 vs 對事</td><td>「那個做不來的員工，你最後怎麼處理？」</td></tr><tr><td>穩定 vs 求變</td><td>「當時有更輕鬆的做法嗎？為什麼沒選？」</td></tr><tr><td>細節 vs 大局</td><td>「這件事你自己盯到什麼程度？」</td></tr></table><div class="notice">驗的是「跟這個職缺吻不吻合」，不是「這個人好不好」。主管特助要配合與細節，旅館再生要主導與抗壓——同一個人在 A 缺是優勢，在 B 缺是風險。報告要寫的是這句，不是貼一個 DISC 標籤。</div></div>
<div class="card"><h2>5 · 三條省題規則</h2><table class="spec"><tr><th>#</th><th>規則</th><th>為什麼</th></tr><tr><td class="num">1</td><td>一則訊息只問一個問題</td><td>兩個問題塞同一則，人選只會答其中一個，另一個等於白問</td></tr><tr><td class="num">2</td><td>問之前先確認履歷上有沒有</td><td>有就換題。要確認的話用確認語氣，不佔提問額度：「您表單填 9/15 可到職，這個還準嗎？」</td></tr><tr><td class="num">3</td><td>追問「為什麼這樣做」不另計一題</td><td>接在他剛講的事上面，成本最低、收穫最大——④ 幾乎全靠它</td></tr></table><div class="notice">預算用完就收尾。問到第 8 題還沒拿到 ③ 或 ④，放掉剩下的直接收。報告寫「未問到」比硬拖到第 15 題好——失去耐性的人選，後面回答的品質也不能用了。</div></div>
<div class="card"><h2>6 · 外語驗證：哪些職缺會做、怎麼做</h2><p class="help">掃過全部職缺，語言要求觸發條件寫在後端 SKILL.md：must_skills／client_screen_conditions／JD 出現任何語言要求就做。不限日文——英文、韓文、越南語、粵語都一樣，新職缺只要 JD 寫了語言，自動就會跑，不用另外設定。</p><h3>怎麼驗（佔 1 題，不額外加預算）</h3><table class="spec"><tr><th>#</th><th>步驟</th><th>做法與理由</th></tr><tr><td class="num">1</td><td>先講清楚要切換</td><td>「這個職缺會直接用該語言開會，我們接下來用該語言聊兩句可以嗎？不用緊張，就一般對話。」突襲會讓人緊張，測到的是反應不是能力</td></tr><tr><td class="num">2</td><td>問他剛剛用中文講過的同一件事</td><td>⚠️ 一定要問講過的事——這樣才比對得出「同一件事用外語講，細節有沒有掉」。換新題目的話，答得差你分不清是語言不行還是那件事他本來就不熟</td></tr><tr><td class="num">3</td><td>用該語言再追問一句</td><td>一來一往才叫對談。單問單答只證明他看得懂，不代表能開會</td></tr><tr><td class="num">4</td><td>切回中文並說明</td><td>「謝謝，這部分沒問題，我這邊記錄下來。接下來我們回中文。」</td></tr></table><div class="notice">證照不能代替這一段。JLPT N1、多益 900 測的是讀跟聽，這個缺要的是當場對話。呂書帆那場就是最好的例子：他的自我 PR 寫「JLPT N1 相当」，但證照欄實際登記的是 2018 年 N2——履歷自己內部就對不上，而這個缺的硬條件寫「N1 或 N2」。</div><h3>報告要怎麼寫</h3><pre class="spec-pre">外語驗證（日文）
  測法：用日文問「旅館再生專案最困難的部分與解法」，一問一追問
  回應：能即時回覆、句子完整、用了業界用語，中文講過的細節在日文版本裡都在，沒有掉
  判斷：可即時對談（符合 JD 的「會議即時溝通」要求）
  ⚠️ 這是文字對談的結果，口說與聽力仍建議客戶端面談確認</pre><div class="notice">不准寫「日文流利」「英文良好」這種形容詞，要寫測法／回應／判斷三件事。最後那句每次都要寫——測的是文字不是口說，把文字表現當口說能力交給客戶，出錯的是顧問的信用。他拒絕用外語對談或答得吃力，一樣照實寫、不准修飾；但也不准直接判定不通過，寫「需顧問／客戶端確認」——錄取判斷不是這裡做的。</div></div>`,
  // 這是若改走 API 計費的估算（cost_usd 是後端用目前 Sonnet 5 費率算出來的），
  // 不是實際帳單。group 分三類：interview=阿財面談／checkup=阿福健檢／
  // ops=其他一次性工作（職缺文案、題庫、履歷解析…），這三條成本性質不同不能混算平均。
  systemTokenTab: (t) => {
    const GROUP_LB = { interview: '阿財面談', checkup: '阿福健檢', ops: '其他工作' };
    const usd = (n) => `$${Number(n || 0).toFixed(4)}`;
    return `<div class="notice">此數字是若改走 API 計費的估算（用目前 Sonnet 5 費率換算），不是實際帳單。</div><div class="kpi-grid"><article class="kpi"><span>累積面談／工作筆數</span><strong>${text(t.total_interviews ?? 0)}</strong></article><article class="kpi"><span>累積估算花費</span><strong>${usd(t.total_cost_usd)}</strong></article><article class="kpi"><span>平均每筆花費</span><strong>${usd(t.avg_cost_usd)}</strong></article><article class="kpi"><span>平均 input／output token</span><strong style="font-size:19px">${text(t.avg_input_tokens ?? 0)} / ${text(t.avg_output_tokens ?? 0)}</strong></article></div><div class="card"><h2>依呼叫類型</h2><table class="spec"><tr><th>call_type</th><th style="text-align:right">次數</th><th style="text-align:right">input tokens</th><th style="text-align:right">output tokens</th><th style="text-align:right">估算花費</th></tr>${(t.by_call_type || []).map((c) => `<tr><td><code>${text(c.call_type)}</code></td><td class="num">${text(c.calls)}</td><td class="num">${text(c.input_tokens)}</td><td class="num">${text(c.output_tokens)}</td><td class="num">${usd(c.cost_usd)}</td></tr>`).join('')}</table></div><div class="card"><h2>最近 60 筆</h2>${list(t.recent || [], (r) => `<article class="list-row"><span><b>${text(r.name)}</b><small>${text(r.job_title || '')} · ${text((r.call_types || []).join('、'))}</small></span><span class="badge info">${text(GROUP_LB[r.group] || r.group)}</span><small>${usd(r.cost_usd)} · ${text(r.last_at)}</small></article>`)}</div>`;
  },
  systemHealthTab: (usage) => `<div class="card"><h2>功能使用狀態（近 ${text(usage.since_days ?? 14)} 天）</h2><p class="help">依 /admin/feature-usage 實際回傳資料呈現，是使用次數不是服務健康度百分比——次數低不代表壞掉，可能只是本來就少用。</p><table class="spec"><tr><th>功能</th><th>依賴的排程／服務</th><th style="text-align:right">近期使用次數</th></tr>${(usage.items || []).map((i) => `<tr><td>${text(i.name)}</td><td>${text(i.dep)}</td><td class="num">${text(i.count)}</td></tr>`).join('')}</table></div>`,
  tokenModal: () => `<form id="token-form">${field('ADMIN_TOKEN','<input id="admin-token" type="password" autocomplete="off" required>')}<p class="help">憑證只儲存在此瀏覽器 localStorage，沿用既有 auth contract。</p></form>`,
  // 2026-09-24 重寫：舊版只有「職缺名稱／公司描述／原始需求」三格，
  //   後端必填的 service_line、client_relation 都沒送 → 按送出一定 400
  //   （「請選擇客戶對象」）。Jacky 要在新版新增客戶職缺才發現。
  //   欄位照舊版 /consultant-beta/job-intake/ 對齊（同一支 /admin/job-intake）。
  jobIntakeModal: (companies = [], consultants = [], me = '') => `<form id="job-intake-form" class="form-grid">
    <label class="field span-2"><span>職缺名稱 ＊</span><input name="title" required maxlength="80" placeholder="例：建築專案助理（常駐白馬）——清單上顯示這個，AI 也會照這個訂標題"></label>
    ${field('送件人 ＊', `<select name="submitted_by" required><option value="">請選擇</option>${consultants.filter((c) => c.is_active !== 0).map((c) => {
      const n = c.name || c.display_name || c; return `<option value="${escapeHtml(n)}" ${n === me ? 'selected' : ''}>${escapeHtml(n)}</option>`; }).join('')}</select>`)}
    ${field('客戶 ＊',`<select name="client_pick" required><option value="">請選擇客戶</option>${companies.map((c) =>
      `<option value="${escapeHtml(c.display_name)}" data-relation="${escapeHtml(c.relation || '')}">${escapeHtml(c.display_name)}</option>`).join('')}<option value="__new__">＋ 不在清單裡的新客戶</option></select>`)}
    <label class="field" id="ji-newname-wrap" hidden><span>新客戶公司全名 ＊</span><input name="client_new" placeholder="真實公司全名（只進內部，不會上職缺頁）"></label>
    ${field('服務線 ＊','<select name="service_line" required><option value="">請選擇</option><option value="dispatch">人力派遣</option><option value="direct">正職代招</option><option value="executive">中高階獵才</option></select>')}
    ${field('客戶對象 ＊（選客戶會自動帶入）','<select name="client_relation" required><option value="">請選擇</option><option value="signed">已簽約客戶</option><option value="unsigned">未簽約客戶</option><option value="private">朋友認識・私人協助</option></select>')}
    <label class="field span-2"><span>JD 檔案（Word、Excel、PDF、md、圖片都可以，單檔 8MB 內）</span><input name="files" type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.md,.txt,image/*"></label>
    <label class="field span-2"><span>或直接貼文字（檔案、文字、連結至少給一種）</span><textarea name="raw_text" rows="6" placeholder="把用人需求表、JD、客戶講的話直接貼進來"></textarea></label>
    ${field('職缺連結','<input name="source_url" type="url" placeholder="104／官網／雲端連結">')}
    ${field('補充（交代總指揮的事）','<input name="note" placeholder="例：客戶很在意保密；急件">')}
    <p class="help span-2">送出不等於發布：總指揮擬好 JD 會發到 Telegram 群組，按「核准發布」網站才會改。</p></form>`,
  socialRequestModal: () => `<form id="social-request-form" class="form-grid">${field('職缺 slug','<input name="job_slug" required>')}${field('顧問／帳號','<input name="consultant_name" required>')}${field('內容方向','<textarea name="request_text" rows="6" required></textarea>')}</form>`,
  // 2026-09-15 補：對齊舊版 openNewCandModal() 的欄位與流程（同一支後端
  // /admin/pipeline/manual-forward，source_kind:'new'）。客戶／職缺是前端 JS
  // 動態級聯（company 選了才顯示對應 job 清單），這裡先給空殼，app.js 開窗後填值。
  addCandidateModal: (consultants) => `<form id="add-candidate-form" class="form-grid">
    ${field('姓名 *', '<input name="name" required>')}
    ${field('Email（Email／電話至少填一個）', '<input name="email" type="email">')}
    ${field('電話', '<input name="phone">')}
    ${field('指派顧問', `<select name="owner"><option value="">未指派</option>${consultants.filter((c) => c.is_active).map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.display_name)}</option>`).join('')}</select>`)}
    ${field('客戶', '<select id="ac-company"><option value="">載入中…</option></select>')}
    ${field('配對職缺（先配對用，不會自動推薦給客戶）', '<select id="ac-job" name="job_slug" disabled><option value="">請先選客戶</option></select>')}
    ${field('聯絡來源', `<select name="source_channel">${SOURCE_CHANNEL_OPTS.map((o) => `<option${o === '不指定' ? ' selected' : ''}>${escapeHtml(o)}</option>`).join('')}</select>`)}
    ${field('履歷來源', `<select name="resume_source">${RESUME_SOURCE_OPTS.map((o) => `<option${o === '不指定' ? ' selected' : ''}>${escapeHtml(o)}</option>`).join('')}</select>`)}
    <label class="field span-2"><span>履歷檔案（選填）</span><input type="file" id="ac-resume"></label>
    <label class="field span-2"><span>電洽內容</span><textarea name="call_notes" rows="3" placeholder="這次接觸／電訪的重點"></textarea></label>
    <label class="field span-2" style="flex-direction:row;align-items:flex-start;gap:8px"><input type="checkbox" id="ac-consent" style="width:auto;margin-top:3px"><span>我確認已經取得本人同意，這筆資料可以提供給客戶</span></label>
  </form>`,
  // 2026-09-15 加：「推薦給客戶」原本只能選客戶，選不到要推哪個職缺——
  // /admin/forward-candidate 其實接受 job_slug（沒傳才退回人選自己原本應徵的
  // 那個職缺），改成客戶→職缺級聯選單，照抄新增人選那顆的模式。
  forwardCandidateModal: () => `<form id="forward-candidate-form" class="form-grid">
    ${field('客戶 *', '<select id="fc-company" name="company_id" required><option value="">載入中…</option></select>')}
    ${field('職缺（不選＝沿用人選原本應徵的職缺）', '<select id="fc-job" name="job_slug" disabled><option value="">請先選客戶</option></select>')}
    <label class="field span-2"><span>推薦說明</span><textarea name="note" rows="3"></textarea></label>
    <label id="fc-forms-row" hidden class="span-2" style="display:none;align-items:flex-start;gap:12px;padding:12px 14px;border:1px solid #d6dde6;border-radius:12px;background:#f7f9fb;cursor:pointer">
      <input type="checkbox" id="fc-send-forms" name="send_forms" style="width:18px;height:18px;margin:2px 0 0;flex:0 0 18px;accent-color:#2563eb;cursor:pointer">
      <span style="display:flex;flex-direction:column;gap:3px;flex:1;min-width:0;text-align:left">
        <b style="font-size:14px">推薦後自動寄人事資料表給人選</b>
        <small id="fc-forms-text" style="font-size:12.5px;color:#64748b;line-height:1.5">不勾＝先不寄，之後可在人選卡片按「寄送表單」手動寄。</small>
      </span>
    </label>
  </form>`,
  // 2026-09-15 加：人才池「轉正」的顧問建檔路徑，照抄新增人選那顆（同一支後端
  // /admin/pipeline/manual-forward，差別只在 source_kind:'sourced' + source_id 帶
  // 這位人才池的 id，聯絡方式從 sourced_candidates 自動帶，不用顧問重打一次）。
  convertSourcedModal: (s) => `<form id="convert-sourced-form" class="form-grid">
    <p class="help span-2">人選：${text(s.name || '')}${s.email ? ' · ' + text(s.email) : ''}${s.phone ? ' · ' + text(s.phone) : ''}</p>
    ${field('客戶 *', '<select id="cs-company" name="company_id" required><option value="">載入中…</option></select>')}
    ${field('職缺 *', '<select id="cs-job" name="job_slug" disabled required><option value="">請先選客戶</option></select>')}
    <label class="field span-2" style="flex-direction:row;align-items:flex-start;gap:8px"><input type="checkbox" id="cs-consent" style="width:auto;margin-top:3px"><span>我確認已經取得本人同意，這筆資料可以提供給客戶</span></label>
  </form>`,

  // 2026-09-17 加：PRECALL_PHASE1 — Pre-call Card（唯讀電話前準備）。
  // 視覺盡量貼近 references/UI_REFERENCE_PRECALL_CARD.html：候選人摘要＋深色
  // 「這通電話只要確認」卡在最上面，Hard Gate 最多 3 個（unknown/unmatched優先，
  // matched 收合），Must Ask 最多 3 題，AI Flag 最多 1 個且沒有就整段不顯示。
  precallCardEmpty: () => `<div class="pc-empty state">
    <strong>還沒有這位人選的電洽前準備</strong>
    <p>AI 會讀履歷跟職缺資料，整理成一張電話前 60-90 秒看完的卡片。</p>
    <button type="button" class="btn primary" data-action="precall-generate">產生電洽前準備卡</button>
  </div>`,
  precallCardLoading: () => `<div class="pc-loading">
    <div class="pc-skel pc-skel-hero"></div>
    <div class="pc-skel pc-skel-row"></div>
    <div class="pc-skel pc-skel-row"></div>
    <p class="help" style="text-align:center">AI 正在整理，通常 1-2 分鐘…</p>
  </div>`,
  // 2026-09-17 v2.0 稽核修正：doc09 第 26 節要求錯誤畫面要講清楚「發生什麼事」
  // 「哪些資料仍保留」，而且不可再生的錯誤（retryable:false，例如這位人選
  // 根本沒有履歷檔）不該一直給「重試」按鈕——按了也不會成功，只會讓顧問
  // 一直點一個沒用的按鈕。改成吃真實錯誤訊息，依 retryable 決定要不要顯示重試。
  precallCardTimeout: (err) => {
    const message = (err && err.message) || '可能是履歷資料太複雜，或這次 AI 呼叫沒有成功。';
    const retryable = !err || err.retryable !== false;
    return `<div class="pc-empty state error">
    <strong>產生失敗</strong>
    <p>${text(message)}</p>
    <p class="help">舊版「電洽前準備」內容（如果有）不會被這次失敗清掉，重新整理可以看到。</p>
    ${retryable ? '<button type="button" class="btn primary" data-action="precall-generate" data-force="1">重試</button>' : ''}
  </div>`;
  },
  // 舊格式（call_prep_md 是純文字 MD，不是 JSON）——維持原本純文字呈現，
  // 不強迫使用者重新產生，但給一個明顯的「升級成新版卡片」按鈕。
  // 2026-10-02 Jacky：「但我要排版啊」——AI 寫卡片失敗時退回的純文字版，本身就分好段
  // （標題一行、・開頭的重點、1. 開頭的問題），照段落排成卡片，不用等重產。
  precallCardLegacy: (mdText) => {
    const blocks = [];
    let cur = null;
    String(mdText || '').split('\n').forEach((raw) => {
      const line = raw.trim();
      if (!line) return;
      const bullet = line.match(/^[・•\-*]\s*(.+)$/);
      const num = line.match(/^(\d+)[.、)]\s*(.+)$/);
      if (bullet || num) {
        if (!cur) { cur = { title: '', items: [], ordered: !!num }; blocks.push(cur); }
        cur.items.push(bullet ? bullet[1] : num[2]);
        if (num) cur.ordered = true;
      } else {
        cur = { title: line, items: [], ordered: false };
        blocks.push(cur);
      }
    });
    const sec = (b) => {
      const warn = /缺口|風險|落差|未提及|注意/.test(b.title);
      const items = b.items.map((x) => {
        const hot = /最大缺口|缺口|未提及|沒有|未實測|落差/.test(x);
        return `<li${hot ? ' class="pcl-hot"' : ''}>${text(x)}</li>`;
      }).join('');
      return `<section class="pcl-sec${warn ? ' warn' : ''}">${b.title ? `<h4>${text(b.title)}</h4>` : ''}${items ? (b.ordered ? `<ol class="pcl-q">${items}</ol>` : `<ul>${items}</ul>`) : ''}</section>`;
    };
    return `<div class="pc-legacy">
    <div class="pcl">${blocks.map(sec).join('')}</div>
    <p class="help" style="margin-top:10px">這份是精簡版。想看有硬條件、必問題、提醒的完整卡片，可以按重新產生（約 5～10 分鐘）。</p>
    <button type="button" class="btn ghost sm" data-action="precall-generate" data-force="1">重新產生（完整卡片）</button>
  </div>`;
  },
  // 2026-09-17 依 PRECALL v1.4 Contract 升級：hard_gates 多了 category/
  // classification/priority/source，ai_flags 多了 show_on_main_card 挑主卡，
  // call_goal.validation_points 從純字串陣列變成 {gate_id,label} 物件。
  // 過期（stale）時在最上面加一條提醒 banner，卡片本體照樣顯示舊資料，不擋看。
  //
  // 2026-09-18 Phase 1.1 改版：主流程從「AI 判斷摘要」換成「顧問口頭電洽
  // 順序卡」（conversation_flow，1→7 步）。舊資料（改版前產生、call_prep_md
  // 裡沒有 conversation_flow 這個 key）不能因為多了這個新規則就顯示不出來——
  // 沒有 conversation_flow 就退回 `precallCardV1()`（原本那一版排版），
  // 顧問看到的還是「重新產生」按鈕，不會是空白或錯誤畫面（改版清單 06 節：
  // backward compatibility）。
  precallCard: (data, opts = {}) => {
    if (!data.conversation_flow) return views.precallCardV1(data, opts);
    const cs = data.candidate_summary || {};
    const goal = data.call_goal || {};
    const jc = data.job_context || {};
    const cf = data.conversation_flow || {};
    const vpText = (goal.validation_points || [])
      .map((v) => (typeof v === 'string' ? v : v.label)).filter(Boolean).join('＋');

    const qCard = (q, i) => `<div class="pc-q">
      <div class="pc-q-num">${i + 1}</div>
      <div>
        <div class="pc-q-title">${text(q.title || '')}</div>
        ${q.lead_in ? `<p class="muted" style="margin:4px 0">${text(q.lead_in)}</p>` : ''}
        <strong>${text(q.question)}</strong>
        ${q.backup_probe ? `<details><summary>追問</summary><p>${text(q.backup_probe)}</p></details>` : ''}
        ${q.record_hint ? `<small style="display:block;margin-top:4px" class="muted">📝 記：${text(q.record_hint)}</small>` : ''}
      </div>
    </div>`;

    const altJobs = data.alternative_jobs || [];
    const appIdAttr = escapeHtml(opts.applicationId || '');
    // 2026-10-05 Jacky：顧問常在還不知道人選適合什麼時就先電洽，卡片要先給結論、
    // 逐條對照、不適合哪些、要注意什麼；沒指定職缺時改成「他適合哪幾個職缺」。
    const noJob = !!data.no_job_mode || data.job_slug === 'unspecified';
    const vd = data.verdict || null;
    const FIT = { strong: ['大致符合', 'good'], partial: ['對得上一部分', 'warn'], weak: ['不太符合', 'bad'] };
    const COND = { matched: ['✅ 符合', 'good'], partial: ['⚠️ 部分', 'warn'], unmatched: ['❌ 不符', 'bad'], unknown: ['❓ 看不出來', 'warn'] };
    const altJobHtml = (a) => `<div class="pc-alt-job">
          <div class="pc-alt-job-title">${text(a.title)}<span class="badge">${a.recommendation_level === 'primary_alternative' ? (noJob ? '最適合' : '優先備案') : (noJob ? '也可以考慮' : '次要備案')}</span></div>
          ${(a.fit_reasons || []).slice(0, 3).map((r) => `<div class="pc-alt-reason">✓ ${text(r)}</div>`).join('')}
          ${(a.watchouts || [])[0] ? `<div class="pc-alt-watch">△ ${text(a.watchouts[0])}</div>` : ''}
          <div class="pc-jobline" style="margin:8px 0 0;padding:0">${a.salary_summary ? `<span>💰 ${text(a.salary_summary)}</span>` : ''}${a.location_summary ? `<span>📍 ${text(a.location_summary)}</span>` : ''}</div>
          ${a.consultant_talk_track ? `<p class="pc-quote" style="margin-top:8px">${text(a.consultant_talk_track)}</p>` : ''}
          <button type="button" class="pc-tool-btn" style="margin-top:8px" data-action="open-alt-job-intro" data-job-slug="${escapeHtml(a.job_slug || '')}">查看職缺介紹</button>
        </div>`;
    const notFit = data.not_fit_jobs || [];
    const notFitHtml = notFit.length ? `<div class="pc-notfit"><div class="pc-notfit-title">🚫 不適合的職缺</div>${notFit.map((n) => `<div class="pc-mini"><b>${text(n.title || n.job_slug)}</b><small>${text(n.reason || '')}</small></div>`).join('')}</div>` : '';
    const cond = data.condition_table || [];
    const watch = data.watchouts || [];
    const insightHtml = `
    ${vd ? `<section class="pc-verdict"><div class="pc-verdict-head">【結論】${vd.fit_level && FIT[vd.fit_level] ? `<span class="pc-status ${FIT[vd.fit_level][1]}">${FIT[vd.fit_level][0]}</span>` : ''}</div>
      <p>${text(vd.one_line)}</p></section>` : ''}
    ${(data.key_judgments || []).length ? `<section class="pc-judge"><div class="pc-judge-head">🎯 這通電話真正要判斷的</div><ol>${data.key_judgments.map((k) => `<li>${text(k)}</li>`).join('')}</ol></section>` : ''}
    ${cond.length ? `<section class="pc-step"><div class="pc-step-head">📋 對照${text(vd && vd.compared_job ? '「' + vd.compared_job + '」' : '職缺')}條件</div>
      <div class="pc-step-body pc-cond-list">${cond.map((c) => { const m = COND[c.status] || COND.unknown; return `<div class="pc-cond">
        <div class="pc-gate-row"><strong>${text(c.condition)}</strong><span class="pc-status ${m[1]}">${m[0]}</span></div>
        <p><span class="pc-src">📄 履歷</span>${text(c.resume_evidence || '')}</p>
        ${c.interview_evidence ? `<p class="pc-iv"><span class="pc-src">🎙 阿財面談</span>${text(c.interview_evidence)}</p>` : ''}
        ${c.note ? `<p class="muted">→ ${text(c.note)}</p>` : ''}</div>`; }).join('')}</div></section>` : ''}
    ${watch.length ? `<section class="pc-step pc-watch"><div class="pc-step-head">⚠️ 要注意的地方</div>
      <div class="pc-step-body">${watch.map((w) => `<div class="pc-mini"><b>${text(w.title)}</b><small>${text(w.detail || '')}${w.ask ? `<br>☎️ 可以問：${text(w.ask)}` : ''}</small></div>`).join('')}</div></section>` : ''}
`;
    // 2026-10-05 Jacky：電洽前準備分兩頁——「對照目前職缺」「他適合哪些職缺」。
    // 用 radio＋CSS 切換，不用另外掛 JS；沒指定職缺時預設打開第二頁。
    const vid = 'pcv' + Math.random().toString(36).slice(2, 8);
    const fitTabHtml = `
      ${noJob ? `<p class="help" style="margin:0 0 10px">這位人選還沒指定職缺，AI 先從全部開放職缺幫你挑。</p>` : (vd ? `<section class="pc-step pc-fitjobs"><div class="pc-step-head">目前掛的職缺：${text(jc.title || '')}${vd.fit_level && FIT[vd.fit_level] ? `<span class="pc-status ${FIT[vd.fit_level][1]}">${FIT[vd.fit_level][0]}</span>` : ''}</div>
        <div class="pc-step-body"><p style="margin:0;line-height:1.7">${text(vd.one_line)}</p></div></section>` : '')}
      <section class="pc-step pc-fitjobs"><div class="pc-step-head">✅ ${noJob ? '他適合的職缺' : '其他也適合的職缺'}（${altJobs.length}）</div>
        <div class="pc-step-body">${altJobs.length ? altJobs.map(altJobHtml).join('') : `<p class="muted" style="margin:0">${noJob ? '目前開放的職缺裡沒有對得上的' : '目前開放的職缺裡，沒有比這個職缺更合適的'}</p>`}</div></section>
      ${notFit.length ? `<section class="pc-step pc-fitjobs"><div class="pc-step-body">${notFitHtml}</div></section>` : ''}
      ${opts.applicationId ? `<section class="pc-step"><div class="pc-step-body"><p class="help" style="margin:0 0 8px">我們職缺裡沒有的公司，也可以拿他去開發：</p>
        <button type="button" class="pc-tool-btn" data-cand-bd="${appIdAttr}">🧲 他適合哪些公司（去開發）</button></div></section>` : ''}`;

    // 2026-10-05 Jacky：沒跟阿財談過、或進了面談室卻沒回答的人選，卡片上要標出來——這通就是第一輪面試。
    const COV = {
      none: '這位人選<b>還沒有跟阿財面談</b>。',
      consultant_direct: '這位人選是<b>顧問直接建檔、直接電洽</b>，沒有經過阿財面談。',
      entered_only: '這位人選<b>有進阿財面談室，但一題都沒回答就離開</b>。',
      partial: `這位人選<b>只跟阿財談了一小部分就離開</b>${data.candidate_msg_count ? `（只回了 ${Number(data.candidate_msg_count)} 句）` : ''}。`,
    };
    const covHtml = COV[data.interview_coverage]
      ? `<div class="pc-coverage">⚠️ ${COV[data.interview_coverage]}這通電話就是第一輪面試，下面的補問題比較多，換工作原因、薪資、到職時間都要問。</div>` : '';
    return `
    ${opts.stale ? `<div class="notice">職缺或履歷內容已更新，這張卡可能是舊版——建議重新產生。</div>` : ''}
    ${covHtml}
    ${opts.applicationId ? `<div class="pc-tool-row">
      <button type="button" class="pc-tool-btn primary" data-action="open-resume-summary" data-application-id="${appIdAttr}">📄 整理履歷</button>
      <button type="button" class="pc-tool-btn" data-action="open-ai-interview" data-application-id="${appIdAttr}">🧠 AI 面談</button>
      <button type="button" class="pc-tool-btn" data-download-resume="${appIdAttr}">原始履歷</button>
      <button type="button" class="pc-tool-btn" data-cand-bd="${appIdAttr}" title="AI 找可能需要這種人的公司（不在我們職缺裡的），放進「人選敲門名單」">🧲 他適合哪些公司（去開發）</button>
    </div>` : ''}
    <section class="pc-hero">
      <div class="pc-candidate">
        <div class="pc-candidate-name">${text(cs.name)}</div>
        <div class="pc-meta">
          <span class="pc-chip">${text(cs.current_role || '履歷未提及')}</span>
          <span class="pc-chip">${text(cs.relevant_experience || '履歷未提及')}</span>
          <span class="pc-chip">${text(cs.location_summary || '履歷未提及')}</span>
          ${cs.source_channel && cs.source_channel !== '未填寫' ? `<span class="pc-chip">來源：${text(cs.source_channel)}</span>` : ''}
        </div>
      </div>
      <div class="pc-goal">
        <small>🎯 這通電話只要確認</small>
        <strong>${text(goal.decision)}${goal.target_role ? `「${text(goal.target_role)}」` : ''}${vpText ? '：' + vpText : ''}</strong>
        ${goal.reason ? `<small style="display:block;margin-top:8px">${text(goal.reason)}</small>` : ''}
      </div>
    </section>

    <div class="pc-views">
    <input type="radio" name="${vid}" id="${vid}-a" class="pc-view-radio pv-a" ${noJob ? '' : 'checked'}>
    <input type="radio" name="${vid}" id="${vid}-b" class="pc-view-radio pv-b" ${noJob ? 'checked' : ''}>
    <div class="pc-view-tabs" role="tablist">
      <label for="${vid}-a" class="lab-a">📋 ${noJob ? '對照最適合的職缺' : '對照目前職缺'}</label>
      <label for="${vid}-b" class="lab-b">🎯 他適合哪些職缺${altJobs.length ? `（${altJobs.length}）` : ''}</label>
    </div>
    <div class="pc-view pc-view-b">${fitTabHtml}</div>
    <div class="pc-view pc-view-a">
    ${!noJob && (jc.title || jc.salary_summary || jc.work_mode) ? `<section class="pc-jobline">
      <span>${text(jc.title || '')}</span>
      ${jc.salary_summary ? `<span>💰 ${text(jc.salary_summary)}</span>` : ''}
      ${jc.work_mode ? `<span>${text(jc.work_mode)}</span>` : ''}
      ${jc.work_hours ? `<span>${text(jc.work_hours)}</span>` : ''}
      ${(jc.locations || []).length ? `<span>📍 ${text(jc.locations.join('、'))}</span>` : ''}
    </section>` : ''}

    ${insightHtml}

    <div class="pc-flow-title"><h3>☎️ 建議電洽順序</h3><span class="pc-flow-hint">左 → 右｜上 → 下</span></div>
    <div class="pc-flow">
      <section class="pc-step"><div class="pc-step-head"><span class="pc-num">1</span>開場＋設定這通目的</div>
        <div class="pc-step-body"><div class="pc-quote">${text((cf.opening || {}).script || '')}</div></div></section>
      <section class="pc-step"><div class="pc-step-head"><span class="pc-num">2</span>已經知道，不要重問</div>
        <div class="pc-step-body">${views.knownFactList(cf.known_do_not_ask || [])}</div></section>

      <section class="pc-step" style="grid-column:1/-1"><div class="pc-step-head"><span class="pc-num">3</span>Top 3｜先問最重要的<span class="badge">必問</span></div>
        <div class="pc-step-body">${(cf.top_questions || []).map(qCard).join('') || '<p class="muted">目前沒有必問題目</p>'}</div></section>

      ${(cf.extra_questions || []).length ? `<section class="pc-step" style="grid-column:1/-1"><div class="pc-step-head"><span class="pc-num">4</span>補問｜有時間再確認</div>
        <div class="pc-step-body">${(cf.extra_questions || []).map((q) => `<div class="pc-mini"><b>${text(q.title || '')}</b><small>${text(q.question)}</small></div>`).join('')}</div></section>` : ''}

      <section class="pc-step"><div class="pc-step-head"><span class="pc-num">${(cf.extra_questions || []).length ? 5 : 4}</span>60 秒介紹職缺</div>
        <div class="pc-step-body"><p style="margin:0;line-height:1.7">${text((cf.job_pitch_60s || {}).script || '')}</p></div></section>
      <section class="pc-step"><div class="pc-step-head"><span class="pc-num">${(cf.extra_questions || []).length ? 6 : 5}</span>薪資／地點／條件</div>
        <div class="pc-step-body">${(cf.conditions || []).length
          ? (cf.conditions || []).map((c) => `<div class="pc-mini"><b>${text(c.label)}</b><small>${text(c.value)}</small></div>`).join('')
          : '<p class="muted" style="margin:0">職缺條件資料不足</p>'}</div></section>


      <section class="pc-step" style="grid-column:1/-1"><div class="pc-step-head"><span class="pc-num">${altJobs.length ? 7 : ((cf.extra_questions || []).length ? 7 : 6)}</span>收尾｜確認意願與下一步</div>
        <div class="pc-step-body"><div class="pc-closebox">${text((cf.closing || {}).script || '')}</div></div></section>
    </div>

    <div class="pc-tools">
      <div class="pc-tools-title">🧰 輔助工具｜不是流程步驟</div>
      <div class="pc-toolgrid">
        <section class="pc-tool pc-tool-dark">
          <div class="pc-tool-head">☎️ 電話旁超短版</div>
          <div class="pc-tool-body">${(cf.phone_sidecar || []).map((s, i) => `<div class="pc-phone-item">${i + 1}. ${text(s)}</div>`).join('') || '<p class="muted" style="margin:0">沒有提供</p>'}</div>
        </section>
        <section class="pc-tool pc-tool-warn">
          <div class="pc-tool-head">⚠️ 顧問注意＋AI 判斷</div>
          <div class="pc-tool-body">
            ${(() => {
              const flag = (data.ai_flags || []).find((f) => f.show_on_main_card);
              return flag ? `<p style="margin:0 0 8px"><strong>${text(flag.title)}</strong><br>${text(flag.short_message)}</p>` : '<p class="muted" style="margin:0 0 8px">目前沒有特別提示</p>';
            })()}
            <details><summary>展開 Hard Gate / Evidence</summary>
              <div class="pc-gate-list">${(data.hard_gates || []).filter((g) => g.classification !== 'nice_to_have').map((g) => {
                const meta = GATE_STATUS_META[g.status] || GATE_STATUS_META.unknown;
                return `<div class="pc-gate"><div class="pc-gate-row"><strong>${text(g.label)}</strong><span class="pc-status ${meta.cls}">${meta.label}</span></div><p>${text(g.evidence || '')}</p></div>`;
              }).join('') || '<p class="muted">沒有 Hard Gate 資料</p>'}</div>
            </details>
          </div>
        </section>
      </div>
    </div>

    </div></div>

    <div class="actions-row" style="margin-top:10px">
      <button type="button" class="btn ghost sm" data-action="precall-generate" data-force="1">重新產生</button>
    </div>`;
  },
  // 舊版排版（改版前產生的卡片沒有 conversation_flow 時的 fallback，內容
  // 跟改版前完全一樣，只是改名成 V1 讓新版 precallCard() 可以在缺欄位時呼叫它）。
  precallCardV1: (data, opts = {}) => {
    const cs = data.candidate_summary || {};
    const goal = data.call_goal || {};
    const jc = data.job_context || {};
    const statusOrder = { unknown: 0, unmatched: 1, matched: 2 };
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    const gates = [...(data.hard_gates || [])]
      .filter((g) => g.classification !== 'nice_to_have')
      .sort((a, b) => (statusOrder[a.status] ?? 1) - (statusOrder[b.status] ?? 1)
        || (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1))
      .slice(0, 3);
    const questions = (data.must_ask_questions || []).slice(0, 3);
    const flag = (data.ai_flags || []).find((f) => f.show_on_main_card);
    const vpText = (goal.validation_points || [])
      .map((v) => (typeof v === 'string' ? v : v.label)).filter(Boolean).join('＋');
    return `
    ${opts.stale ? `<div class="notice">職缺或履歷內容已更新，這張卡可能是舊版——建議重新產生。</div>` : ''}
    <section class="pc-hero">
      <div class="pc-candidate">
        <div class="pc-candidate-name">${text(cs.name)}</div>
        <div class="pc-meta">
          <span class="pc-chip">${text(cs.current_role || '履歷未提及')}</span>
          <span class="pc-chip">${text(cs.relevant_experience || '履歷未提及')}</span>
          <span class="pc-chip">${text(cs.location_summary || '履歷未提及')}</span>
          ${cs.source_channel && cs.source_channel !== '未填寫' ? `<span class="pc-chip">來源：${text(cs.source_channel)}</span>` : ''}
        </div>
      </div>
      <div class="pc-goal">
        <small>🎯 這通電話只要確認</small>
        <strong>${text(goal.decision)}${goal.target_role ? `「${text(goal.target_role)}」` : ''}${vpText ? '：' + vpText : ''}</strong>
        ${goal.reason ? `<small style="display:block;margin-top:8px">${text(goal.reason)}</small>` : ''}
      </div>
    </section>

    ${(jc.title || jc.salary_summary || jc.work_mode) ? `<section class="pc-jobline">
      <span>${text(jc.title || '')}</span>
      ${jc.salary_summary ? `<span>💰 ${text(jc.salary_summary)}</span>` : ''}
      ${jc.work_mode ? `<span>${text(jc.work_mode)}</span>` : ''}
      ${jc.work_hours ? `<span>${text(jc.work_hours)}</span>` : ''}
      ${(jc.locations || []).length ? `<span>📍 ${text(jc.locations.join('、'))}</span>` : ''}
    </section>` : ''}

    <section class="card pc-card">
      <div class="card-head"><h2 style="margin:0;font-size:15px">🚪 Hard Gate</h2><span class="badge">最多 3 個</span></div>
      <div class="pc-gate-list">
        ${gates.length ? gates.map((g) => {
          const meta = GATE_STATUS_META[g.status] || GATE_STATUS_META.unknown;
          const collapsedMatched = g.status === 'matched';
          return `<details class="pc-gate" ${collapsedMatched ? '' : 'open'}>
            <summary class="pc-gate-row"><strong>${text(g.label)}</strong><span class="pc-status ${meta.cls}">${meta.label}</span></summary>
            <p>${text(g.evidence || '')}</p>
          </details>`;
        }).join('') : '<p class="muted">這個職缺沒有設定 Hard Gate 資料</p>'}
      </div>
    </section>

    <section class="card pc-card">
      <div class="card-head"><h2 style="margin:0;font-size:15px">🔥 今天只問這 ${questions.length} 題</h2><span class="badge">不要超過 3 題</span></div>
      <div class="pc-questions">
        ${questions.length ? questions.map((q, i) => `<div class="pc-q">
          <div class="pc-q-num">${i + 1}</div>
          <div><strong>${text(q.question)}</strong>${q.why_it_matters ? `<small>驗證：${text(q.why_it_matters)}</small>` : ''}${q.backup_probe ? `<details><summary>備用追問</summary><p>${text(q.backup_probe)}</p></details>` : ''}</div>
        </div>`).join('') : '<p class="muted">目前沒有必問題目</p>'}
      </div>
    </section>

    ${flag ? `<section class="card pc-card">
      <div class="card-head"><h2 style="margin:0;font-size:15px">⚠️ 風險提示</h2><span class="badge">${text(flag.risk_level)}</span></div>
      <div class="pc-flag"><strong>${text(flag.title)}</strong><p>${text(flag.short_message)}</p>${flag.recommended_action ? `<p class="muted">建議：${text(flag.recommended_action.label || flag.recommended_action)}</p>` : ''}</div>
    </section>` : ''}

    <div class="actions-row" style="margin-top:10px">
      <button type="button" class="btn ghost sm" data-action="precall-generate" data-force="1">重新產生</button>
    </div>`;
  },
  // 2026-09-18 加（Phase 1.1 v1.1：履歷佐證版）——Step 2「已經知道，不要重問」
  // 每一條都要秀出處，不能只有一個 chip。舊卡片（改版前產生，known_do_not_ask
  // 還是純字串陣列）不能因為多了這個規則就壞掉，退回「來源未結構化」的樣式
  // （規格第 17 節：backward compatibility），不顯示來源徽章或查看佐證按鈕。
  knownFactList: (items) => {
    if (!items.length) return '<p class="muted" style="margin:0">目前沒有可以確定跳過的項目</p>';
    const sourceLabel = { resume: '履歷', ai_interview: 'AI 面談', consultant_note: '顧問紀錄', report: '報告' };
    return `<div style="display:grid;gap:9px">${items.map((k, i) => {
      if (typeof k === 'string') {
        // 舊格式：純字串，沒有 value/sources。
        return `<div class="pc-known-item legacy"><b>✓ ${text(k)}</b><span class="pc-source-badge legacy">來源未結構化</span></div>`;
      }
      const knowId = k.id || `k_${i}`;
      const sources = k.sources || [];
      return `<div class="pc-known-item">
        <b>✓ ${text(k.label)}</b>
        <div class="pc-known-value">${text(k.value || '')}</div>
        <div class="pc-source-row">
          ${[...new Set(sources.map((s) => s.type))].map((t) => `<span class="pc-source-badge ${escapeHtml(t)}">${sourceLabel[t] || t}</span>`).join('')}
          ${sources.length ? `<button type="button" class="pc-source-badge verify" data-action="open-evidence" data-know-id="${escapeHtml(knowId)}">查看佐證</button>` : ''}
        </div>
      </div>`;
    }).join('')}</div>`;
  },
  // 「📄 整理履歷」side panel 內容——resume_summary 是 runtime 衍生資料，不是
  // 新的候選人真相來源（規格第 19 節），履歷更新後這裡的內容會跟著卡片一起重生。
  resumeSummaryBody: (rs) => {
    if (!rs) return '<p class="muted">這張卡片是改版前產生的舊版，沒有整理履歷資料——重新產生卡片後就會有。</p>';
    const cs = rs.current_status || {};
    return `
    <div class="section"><h3 style="margin:0 0 8px;font-size:15px">候選人快速定位</h3>
      <div class="pc-resume-card"><p style="margin:0">${text(rs.headline || '')}</p></div>
    </div>
    ${(rs.core_skills || []).length ? `<div class="section"><h3 style="margin:0 0 8px;font-size:15px">核心能力</h3>
      <div class="pc-meta">${(rs.core_skills || []).map((s) => `<span class="pc-chip">${text(s)}</span>`).join('')}</div>
    </div>` : ''}
    <div class="section"><h3 style="margin:16px 0 8px;font-size:15px">職涯時間軸</h3>
      <div class="pc-timeline">${(rs.career_timeline || []).length ? (rs.career_timeline || []).map((t) => `<div class="pc-timeline-item">
        <b>${text(t.company || '')}${t.title ? '｜' + text(t.title) : ''}</b>
        <span class="pc-timeline-period">${text(t.period || '履歷未載明')}</span>
        <small>${text(t.core_duties || '')}${t.note ? '　·　' + text(t.note) : ''}</small>
      </div>`).join('') : '<p class="muted" style="margin:0">沒有可整理的職涯資料</p>'}</div>
    </div>
    <div class="section"><h3 style="margin:16px 0 8px;font-size:15px">目前狀態</h3>
      <div class="pc-resume-card">
        ${cs.employment_status ? `<p style="margin:0 0 4px"><b>狀態：</b>${text(cs.employment_status)}</p>` : ''}
        ${cs.start_date ? `<p style="margin:0 0 4px"><b>可到職：</b>${text(cs.start_date)}</p>` : ''}
        ${cs.location ? `<p style="margin:0 0 4px"><b>地點：</b>${text(cs.location)}</p>` : ''}
        ${cs.salary ? `<p style="margin:0"><b>薪資：</b>${text(cs.salary)}</p>` : ''}
        ${!cs.employment_status && !cs.start_date && !cs.location && !cs.salary ? '<p class="muted" style="margin:0">沒有可判斷的狀態資料</p>' : ''}
      </div>
    </div>`;
  },
  // 「🧠 AI 面談」side panel——直接沿用既有 /admin/session/:id 的 transcript
  // 欄位，不重新生成逐字稿（規格第 5 節）。
  aiInterviewBody: (body) => {
    const messages = body.transcript || [];
    if (!messages.length) return '<p class="muted">這位人選沒有跟阿財面談過，所以沒有逐字稿。顧問手動建檔、自己打電話談的人選，談話內容在「電洽」的電洽紀錄裡。</p>';
    return `<div class="transcript">${messages.map((m) => `<div class="bubble ${String(m.role).includes('assistant') ? 'ai' : 'candidate'}"><b>${String(m.role).includes('assistant') ? '阿財' : '人選'}</b><p>${text(m.content || m.text)}</p><small>${text(m.created_at || m.at)}</small></div>`).join('')}</div>`;
  },
  // 「查看佐證」——只顯示來源片段，不顯示 AI 內部推理過程（規格第 10 節）。
  evidenceBody: (item) => {
    if (!item || !(item.sources || []).length) return '<p class="muted">找不到這條的佐證資料，可能是卡片已經被重新產生過。</p>';
    const sourceLabel = { resume: '📄 履歷', ai_interview: '🧠 AI 面談', consultant_note: '📝 顧問紀錄', report: '📋 報告' };
    return `<div class="pc-resume-card" style="margin-bottom:14px"><b>${text(item.label)}</b><p style="margin:4px 0 0">${text(item.value || '')}</p></div>
    ${item.sources.map((s, i) => `<div class="pc-evidence-box"><div class="pc-evidence-src">來源 ${i + 1}｜${sourceLabel[s.type] || s.type}</div><div class="pc-evidence-snippet">${text(s.snippet || '')}</div></div>`).join('')}`;
  },
  // 2026-09-18 加「職缺介紹」tab：給沒接觸過這個職缺的顧問看的背景資料，
  // 純顯示 jobs 既有欄位（不是 AI 生的，職缺內容改了這裡就跟著變）。
  jobIntroLoading: () => `<div class="pc-loading"><div class="pc-skel pc-skel-row"></div><div class="pc-skel pc-skel-row"></div></div>`,
  jobIntroEmpty: () => `<div class="pc-empty state"><strong>這位人選還沒有指定職缺</strong><p>先在「編輯應徵單」選一個職缺，才有內容可以顯示。</p></div>`,
  jobIntro: (job) => {
    // 2026-09-18 補：salary_min/max 是 null 時（業主沒公告固定區間，例如某醫療器材客戶
    // 這個職缺）原本只印「面議」，把 salary_note（顧問打的補充說明，通常會講
    // 「電洽時要向業主確認範圍」這類重要提醒）漏掉了，顧問看不到就不知道這通
    // 電話要記得問。有 salary_note 就附在「面議」後面，不要讓這欄資訊憑空消失。
    const salary = (job.salary_min || job.salary_max)
      ? `${job.salary_min || ''}${job.salary_min && job.salary_max ? '–' : ''}${job.salary_max || ''}`.trim() + (formatSalaryUnit(job.salary_unit) ? ' ' + formatSalaryUnit(job.salary_unit) : '')
      : (job.salary_note ? `面議（${job.salary_note}）` : '面議');
    // 2026-09-18 加：職缺欄位裡常見「1. xxx；2. yyy；3. zzz」這種顧問自己打字
    // 編號、但整段擠在一行沒有換行的內容——直接用 white-space:pre-wrap 印出來
    // 還是一整團，因為原文根本沒有 \n。這裡偵測到「數字. 」編號就拆成清單項目，
    // 偵測不到（一般散文）就照舊印一整段，不要為了拆而拆。
    const asList = (str) => {
      const parts = str.split(/(?:^|[；;])\s*(?=\d+[.．、]\s*)/).map((s) => s.trim()).filter(Boolean);
      if (parts.length < 2 || !parts.every((p) => /^\d+[.．、]/.test(p))) return null;
      return parts.map((p) => p.replace(/^\d+[.．、]\s*/, ''));
    };
    const section = (title, body) => {
      if (!body) return '';
      const list = asList(body);
      const inner = list
        ? `<ol style="margin:0;padding-left:20px;display:grid;gap:8px">${list.map((li) => `<li>${text(li)}</li>`).join('')}</ol>`
        : `<div style="white-space:pre-wrap">${text(body)}</div>`;
      return `<section class="card pc-card"><div class="card-head"><h2 style="margin:0;font-size:15px">${title}</h2></div><div style="padding:14px 15px;font-size:13.5px;line-height:1.7">${inner}</div></section>`;
    };
    const relationLabel = { signed: '已簽約', negotiating: '洽談中', end_client: '最終用人單位', past: '過去客戶', prospect: '潛在客戶', private: '朋友私人協助' }[job.relation] || job.relation;
    // 地點／僱傭型態的中文轉換已搬到模組層級（formatLocations／formatEmployment），
    // 跟 P3-A 職缺推薦卡共用同一份，見檔案最上方的說明。
    return `
    <section class="card pc-card">
      <div class="card-head"><h2 style="margin:0;font-size:15px">🏢 公司基本資料</h2></div>
      <div style="padding:14px 15px">
        <div class="pc-candidate-name" style="font-size:16px;margin-bottom:4px">${text(job.client_name || '客戶名稱未填')}</div>
        ${relationLabel ? `<span class="pc-chip" style="margin-bottom:8px;display:inline-block">合作關係：${text(relationLabel)}</span>` : ''}
        ${job.client_intro ? `<p style="font-size:13.5px;line-height:1.7;margin:8px 0 0;white-space:pre-wrap">${text(job.client_intro)}</p>` : '<p class="muted" style="margin:8px 0 0">目前沒有公司簡介資料</p>'}
      </div>
    </section>
    ${(job.news_brief || job.news_pinned) ? (() => {
      let src = [];
      try { src = JSON.parse(job.news_sources || '[]'); } catch { src = []; }
      return `<section class="card pc-card"><div class="card-head"><h2 style="margin:0;font-size:15px">📰 公司近期動態（參考用，不列入評分）</h2></div>
      <div style="padding:14px 15px;font-size:13.5px;line-height:1.7">
        ${job.news_pinned ? `<div style="white-space:pre-wrap;margin-bottom:10px">${text(job.news_pinned)}</div>` : ''}
        ${job.news_brief ? `<div style="white-space:pre-wrap">${job.news_pinned ? '【每週自動更新】\n' : ''}${text(job.news_brief)}</div>` : ''}
        ${src.length ? `<p class="help" style="margin:10px 0 0">來源：${src.slice(0, 6).map((x) => `<a href="${escapeHtml(x.url || '')}" target="_blank" rel="noopener">${text(x.title || x.url || '')}</a>`).join('・')}</p>` : ''}
        <p class="help" style="margin:6px 0 0">${job.news_updated_at ? `${text(String(job.news_updated_at).slice(0, 10))} 更新・` : ''}跟人選聊的時候可以拿來補充公司方向；阿財也看得到，但不會拿來打分數，也不會講出公司名稱。</p>
      </div></section>`;
    })() : ''}
    <section class="pc-jobline" style="margin-top:0">
      ${job.locations ? `<span>📍 ${text(formatLocations(job.locations))}</span>` : ''}
      <span>💰 ${text(salary)}</span>
      ${job.work_mode ? `<span>${text(job.work_mode)}</span>` : ''}
      ${job.work_hours ? `<span>${text(job.work_hours)}</span>` : ''}
      ${job.employment ? `<span>${text(formatEmployment(job.employment))}</span>` : ''}
    </section>
    ${section('📋 主要工作內容', job.main_duties)}
    ${section('✨ 加分條件（非硬性）', job.nice_to_have_skills)}
    ${section('⚠️ 硬性條件／客戶篩選重點', job.client_screen_conditions)}
    ${section('📞 面試流程', job.interview_process)}
    ${(job.onboard_by || job.urgency) ? section('⏱️ 到職時程', [job.onboard_by ? `到職時程：${job.onboard_by}` : '', job.urgency ? `急迫度：${job.urgency}` : ''].filter(Boolean).join('\n')) : ''}
    ${section('💬 給候選人的常見問答', job.faq_notes)}
    <section class="card pc-card">
      <div class="card-head"><h2 style="margin:0;font-size:15px">📝 顧問補充（非 JD 上的資訊，跟客戶對接後補充）</h2></div>
      <div style="padding:14px 15px">
        ${job.notes ? `<div style="font-size:13px;line-height:1.7;white-space:pre-wrap;margin-bottom:12px">${text(job.notes)}</div>` : '<p class="muted" style="margin:0 0 12px">還沒有補充內容</p>'}
        <textarea id="job-notes-input" rows="3" placeholder="例如：客戶其實比較在意穩定度，學歷沒那麼硬性…" style="width:100%"></textarea>
        <button type="button" class="btn primary sm" id="job-notes-submit" data-job-slug="${escapeHtml(job.slug)}" style="margin-top:8px">新增補充</button>
      </div>
    </section>`;
  },
  // 2026-09-18 加「電洽結果」tab：call_summary_md 是 prompt_call_notes_summary
  // 產出的固定格式（**標題**\n內容，六段），原本用純文字塞在一個摺疊框裡，
  // 這裡拆成跟職缺介紹同款的卡片，每段一張，比較好找、比較好讀。
  callResult: (md) => {
    if (!md) return `<div class="pc-empty state"><strong>還沒有電洽紀錄</strong><p>打完電話後用「手動記一筆電洽重點」或 TG「電洽新增人選」貼逐字稿，AI 會自動整理成這裡的摘要。</p></div>`;
    const parts = md.split(/\n(?=\*\*.+?\*\*)/).map((s) => s.trim()).filter(Boolean);
    const sections = parts
      .map((p) => {
        const m = p.match(/^\*\*(.+?)\*\*\s*\n?([\s\S]*)$/);
        return m ? { title: m[1].trim(), body: m[2].trim() } : null;
      })
      .filter(Boolean);
    if (!sections.length) {
      // 格式不是預期的 **標題** 分段（例如舊資料或格式跑掉），照原文顯示，
      // 不要因為解析不出來就整段不見。
      return `<div class="pc-empty state"><strong>電洽摘要</strong><p style="white-space:pre-wrap;text-align:left">${text(md)}</p></div>`;
    }
    return sections.map((s) => `<section class="card pc-card"><div class="card-head"><h2 style="margin:0;font-size:15px">${text(s.title)}</h2></div><div style="padding:14px 15px;font-size:13.5px;line-height:1.7;white-space:pre-wrap">${text(s.body || '未提及')}</div></section>`).join('');
  },
  // 2026-10-21 Jacky：電洽要能記多筆、不覆蓋。每一通都列出來，最上面永遠有「新增一通」。
  callHistory: (applicationId, calls) => {
    const list = (calls || []).map((c, i) => `<details class="card" style="padding:10px 14px;margin:6px 0"><summary style="cursor:pointer"><b>第 ${(calls.length - i)} 通</b>　<small class="muted">${text(String(c.time || '').slice(0, 16))}</small></summary><div style="white-space:pre-wrap;font-size:13px;line-height:1.7;margin-top:8px">${text(c.detail || '')}</div></details>`).join('');
    return `<section class="card pc-card" style="margin-top:12px"><div class="card-head"><h2 style="margin:0;font-size:15px">電洽紀錄（${(calls || []).length} 通）</h2>
      <div class="actions-row">${applicationId ? actionBtn('＋新增一通電洽紀錄', 'application-call-note', { idParams: { application_id: applicationId } }, 'primary') : ''}<button type="button" class="btn ghost sm" data-action="postcall-generate" data-force="1">用全部紀錄重新整理電洽結果</button></div></div>
      <p class="help" style="margin:4px 15px 8px">每一通都會留著，不會被新的蓋掉；AI 電洽結果會用全部紀錄一起整理。</p>
      <div style="padding:0 12px 10px">${list || '<p class="help">還沒有電洽紀錄</p>'}</div></section>`;
  },
  postcallResultLoading: () => `<div class="pc-loading"><div class="pc-skel pc-skel-hero"></div><div class="pc-skel pc-skel-row"></div><p class="help" style="text-align:center">AI 正在整理電洽結果，通常 1-2 分鐘…</p></div>`,
  // 2026-09-29 Jacky：電洽結果這格只有「產生／重試」，沒有電洽紀錄時顧問卡在這裡不知道去哪匯入。
  // 匯入按鈕直接放在這格（跟「操作」裡的「手動記一筆電洽重點」同一支），存完再按產生。
  postcallImportBtn: (applicationId) => (applicationId
    ? actionBtn('貼上／上傳電洽逐字稿', 'application-call-note', { idParams: { application_id: applicationId } }, 'primary') : ''),
  postcallResultEmpty: (applicationId) => `<div class="pc-empty state">
    <strong>還沒有電洽結果</strong>
    <p><b>第 1 步</b>：把這通電話的逐字稿貼上或上傳（txt／pdf／doc 都可以）。<br><b>第 2 步</b>：存好後按「產生電洽結果」，AI 1～2 分鐘整理出重點、求職需求、條件符不符合、下一步。</p>
    <div class="actions-row" style="justify-content:center">${views.postcallImportBtn(applicationId)}
    <button type="button" class="btn" data-action="postcall-generate">產生電洽結果</button></div>
  </div>`,
  postcallResultTimeout: (err, applicationId) => {
    const message = (err && err.message) || 'AI 這次呼叫沒有成功，或這位人選還沒有電洽紀錄。';
    const noRecord = /沒有電洽紀錄/.test(message);
    return `<div class="pc-empty state${noRecord ? '' : ' error'}"><strong>${noRecord ? '還沒有電洽紀錄' : '產生失敗'}</strong><p>${text(noRecord ? '先把這通電話的逐字稿貼上或上傳，存好後再按「產生電洽結果」。' : message)}</p>
    <div class="actions-row" style="justify-content:center">${views.postcallImportBtn(applicationId)}
    <button type="button" class="btn${noRecord ? '' : ' primary'}" data-action="postcall-generate" data-force="1">${noRecord ? '產生電洽結果' : '重試'}</button></div></div>`;
  },
  // 2026-09-18 新增（規格 B）：電洽結果從長篇 call_summary_md 升級成 6 區
  // 結構化決策頁——①摘要②求職需求③Gate Result④AI建議⑤其他適合職缺
  // ⑥下一步Action。「AI建議」跟「顧問決定」刻意分兩塊顯示，不能互相覆蓋
  // （規格 B 第 14 節）。
  postcallResult: (data, applicationId) => {
    const cs = data.call_summary || {};
    const prefs = data.candidate_preferences || {};
    const gates = data.gate_results || [];
    const rec = data.ai_recommendation || {};
    const decision = data.consultant_decision || {};
    const altJobs = data.alternative_jobs || [];
    const actions = data.actions || [];
    const routeLabel = { recommend: '🟢 可推薦', need_more_info: '🟡 補資料', alternative_role: '🔵 轉其他職缺', talent_pool: '⚪ 人才池', pause_recommendation: '🔴 暫停推薦' };
    const gateIcon = { matched: '✅', unknown: '❓', unmatched: '⛔' };

    const prefRow = (label, val) => (val && (Array.isArray(val) ? val.length : true))
      ? `<div class="pc-mini"><b>${text(label)}</b><small>${Array.isArray(val) ? text(val.join('、')) : text(val)}</small></div>` : '';

    return `
    <section class="card pc-card">
      <div class="card-head"><h2 style="margin:0;font-size:15px">① 電洽重點摘要</h2></div>
      <div style="padding:14px 15px">
        <strong style="display:block;margin-bottom:8px">${text(cs.headline || '')}</strong>
        <ul style="margin:0;padding-left:20px;display:grid;gap:6px">${(cs.key_points || []).map((k) => `<li>${text(k)}</li>`).join('') || '<li class="muted">沒有重點</li>'}</ul>
      </div>
    </section>

    <section class="card pc-card">
      <div class="card-head"><h2 style="margin:0;font-size:15px">② 求職需求</h2></div>
      <div class="pc-questions" style="padding:14px 15px;display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px">
        ${prefRow('職務方向', prefs.role_direction)}
        ${prefRow('期望薪資', prefs.expected_salary)}
        ${prefRow('最低接受', prefs.minimum_salary)}
        ${prefRow('地點', prefs.locations)}
        ${prefRow('外派／調派', prefs.relocation)}
        ${prefRow('出差', prefs.travel)}
        ${prefRow('工時／輪班', prefs.shift)}
        ${prefRow('到職時間', prefs.start_date)}
        ${prefRow('其他偏好', prefs.work_preferences)}
        ${(prefs.explicit_rejections || []).length ? `<div class="pc-mini" style="border-color:var(--danger,#c0392b)"><b>明確排斥</b><small>${text((prefs.explicit_rejections || []).map((r) => (typeof r === 'string' ? r : r.label)).join('、'))}</small></div>` : ''}
      </div>
    </section>

    <section class="card pc-card">
      <div class="card-head"><h2 style="margin:0;font-size:15px">③ Gate Result</h2></div>
      <div class="pc-gate-list">
        ${gates.length ? gates.map((g) => `<div class="pc-gate"><div class="pc-gate-row"><strong>${gateIcon[g.result] || '❓'} ${text(g.label)}</strong></div><p>${text(g.evidence || '')}${g.impact ? `<br><small class="muted">影響：${text(g.impact)}</small>` : ''}</p></div>`).join('') : '<p class="muted" style="padding:0 15px 14px">沒有 Gate 資料</p>'}
      </div>
    </section>

    <section class="card pc-card">
      <div class="card-head"><h2 style="margin:0;font-size:15px">④ 主職缺 AI 建議</h2><span class="badge">AI 建議，非最終決定</span></div>
      <div style="padding:14px 15px">
        <strong>${routeLabel[rec.route] || rec.route || ''}</strong>
        <p style="margin:8px 0">${text(rec.reason || '')}</p>
        ${(rec.missing_info || []).length ? `<p class="muted" style="margin:4px 0">缺：${text(rec.missing_info.join('、'))}</p>` : ''}
        ${(rec.next_actions || []).length ? `<p class="muted" style="margin:4px 0">下一步：${text(rec.next_actions.join('、'))}</p>` : ''}
        <div class="pc-decision-box">
          <div class="pc-decision-label">顧問最終決定</div>
          ${decision.route ? `<div><strong>${routeLabel[decision.route] || text(decision.route)}</strong>${decision.reason ? `<p class="muted" style="margin:4px 0 0">${text(decision.reason)}</p>` : ''}</div>`
            : '<p class="muted" style="margin:0">尚未確認</p>'}
          <div class="actions-row" style="margin-top:8px">
            <select id="postcall-route-select" data-application-id="${escapeHtml(applicationId)}">
              ${Object.entries(routeLabel).map(([k, v]) => `<option value="${k}" ${rec.route === k ? 'selected' : ''}>${v}</option>`).join('')}
            </select>
            <button type="button" class="btn primary sm" id="postcall-decision-confirm" data-application-id="${escapeHtml(applicationId)}">確認決定</button>
          </div>
        </div>
      </div>
    </section>

    <section class="card pc-card">
      <div class="card-head"><h2 style="margin:0;font-size:15px">⑤ 其他適合職缺</h2></div>
      <div style="padding:14px 15px">
        ${altJobs.length ? altJobs.map((a) => `<div class="pc-alt-job">
          <div class="pc-alt-job-title">${text(a.title)}<span class="badge">${a.recommendation_level === 'primary_alternative' ? '優先備案' : '次要備案'}</span></div>
          ${(a.fit_reasons || []).map((r) => `<div class="pc-alt-reason">✓ ${text(r)}</div>`).join('')}
          ${(a.watchouts || []).map((w) => `<div class="pc-alt-watch">△ ${text(w)}</div>`).join('')}
          <div class="pc-jobline" style="margin:8px 0 0;padding:0">${a.salary_summary ? `<span>💰 ${text(a.salary_summary)}</span>` : ''}${a.location_summary ? `<span>📍 ${text(a.location_summary)}</span>` : ''}</div>
          <button type="button" class="pc-tool-btn" style="margin-top:8px" data-action="open-alt-job-intro" data-job-slug="${escapeHtml(a.job_slug || '')}">查看職缺介紹</button>
        </div>`).join('') : '<p class="muted" style="margin:0">目前系統內沒有明確更適合的開放職缺</p>'}
      </div>
    </section>

    <section class="card pc-card">
      <div class="card-head"><h2 style="margin:0;font-size:15px">⑥ 下一步 Action</h2></div>
      <div style="padding:14px 15px;display:grid;gap:8px">
        ${actions.length ? actions.map((a) => `<label style="display:flex;gap:8px;align-items:flex-start"><input type="checkbox" disabled ${a.done ? 'checked' : ''}><span>${text(a.label)}</span></label>`).join('') : '<p class="muted" style="margin:0">沒有建議的下一步</p>'}
      </div>
    </section>

    <div class="actions-row" style="margin-top:10px">
      <button type="button" class="btn ghost sm" data-action="postcall-generate" data-force="1">重新產生</button>
    </div>`;
  },
  // 2026-09-18 加（P3-A 職缺推薦）：人選跟阿財面談完，系統會自動比對其他開放
  // 職缺有沒有比他原本應徵的那個更適合，最多給 3 個建議。這一區只做兩件事——
  // 把建議翻成顧問看得懂的話、把顧問的「採用／不採用」記下來。
  // 產品規則（一定要在畫面上講清楚）：阿財只是「建議」，系統沒有發任何訊息給
  // 人選，按「採用」也不會自動把人選搬到別的職缺——顧問看到「採用」兩個字很容易
  // 以為系統已經動作了，所以最上面固定放一段提醒，不能只寫在說明文件裡。
  recommendationsLoading: () => `<div class="pc-loading"><div class="pc-skel pc-skel-row"></div><div class="pc-skel pc-skel-row"></div></div>`,
  recommendationsEmpty: () => `<div class="pc-empty state">
    <strong>阿財這次沒有找到更適合的其他職缺</strong>
    <p>表示目前開放中的職缺裡，沒有比這位人選原本應徵的那個更適合的。之後有新職缺上架，阿財會再比對一次。</p>
  </div>`,
  recommendations: (list) => {
    const items = Array.isArray(list) ? list : [];
    if (!items.length) return views.recommendationsEmpty();
    // 這四個是後端的 match_status，絕對不能直接印給顧問看（顧問看到
    // POSSIBLE_MATCH 不會知道那是什麼意思），一律先轉中文；真的出現沒見過的
    // 值就顯示「無法判斷」，不要把原始代碼漏出去。
    const MATCH_LABEL = { MATCH_CANDIDATE: '很可能適合', POSSIBLE_MATCH: '可能適合', INSUFFICIENT_DATA: '資料不足', NOT_MATCH: '不適合' };
    const MATCH_TONE = { MATCH_CANDIDATE: 'good', POSSIBLE_MATCH: 'warn', INSUFFICIENT_DATA: 'warn', NOT_MATCH: 'bad' };
    const JOB_STATUS_LABEL = { open: '招募中', closed: '已關閉', paused: '暫停招募', filled: '已找到人', draft: '尚未公開' };
    // confidence 後端可能給 0～1 的數字，也可能給 high/medium/low 或中文——
    // 三種都接，轉成顧問一眼看得懂的高／中／低；認不出來就整個不顯示，
    // 不要印出 0.82 或 "medium" 這種半成品。
    const confidenceLabel = (value) => {
      if (value === null || value === undefined || value === '') return '';
      if (typeof value === 'number' || /^[0-9.]+$/.test(String(value))) {
        const n = Number(value) > 1 ? Number(value) / 100 : Number(value);
        if (Number.isNaN(n)) return '';
        return n >= 0.7 ? '高' : (n >= 0.4 ? '中' : '低');
      }
      const key = String(value).trim().toLowerCase();
      return { high: '高', medium: '中', middle: '中', low: '低', 高: '高', 中: '中', 低: '低' }[key] || '';
    };
    // 2026-09-21 改字：原本是「採用／不採用」，Jacky 定的是「請阿財詢問／略過」。
    // 但「請阿財詢問」會讓顧問以為按下去阿財就去問人選了——實際上 P3-B 的
    // B2（只發給測試帳號）跟 B3（對真人開放）都還沒做，按下去只有記錄。
    // 顧問按完會等一則永遠不會來的回覆，那比名字不精準嚴重得多。
    // 折衷用「值得問人選」：表達了判斷，但沒承諾系統會自動去問。
    // 等 B3 真的上線那天再改成「請阿財詢問」，那時候才名副其實。
    const DECISION_LABEL = { approved: '值得問人選', rejected: '已略過', superseded: '已被新的建議取代' };
    // 2026-09-21 加（P3-B）：外聯狀態。之前發出去之後顧問完全看不到後續——
    // 不知道發了沒、人選回了沒、被擋下來的原因是什麼。
    // ⚠️ 一律用中文講「發生了什麼事」，不要把 outreach_sent 這種代碼漏出去。
    const OUTREACH = {
      outreach_queued: ['排隊中', '準備要發給人選', 'warn'],
      outreach_sent: ['已發出', '阿財已經用 LINE 問了，等人選回覆', 'info'],
      outreach_blocked: ['沒有發出去', '', 'bad'],
      candidate_interested: ['人選說想了解', '🟢 他按了「想了解看看」——換你接手聯繫', 'good'],
      candidate_declined: ['人選說這次不用', '他婉拒了，同一個職缺不會再問他', 'muted'],
      candidate_question: ['人選有問題', '❓ 他按了「我有問題」，需要你直接跟他說明', 'warn'],
    };
    const outreachBlock = (rec) => {
      const o = OUTREACH[rec.outreach_status];
      if (!o) return '';
      const [label, note, tone] = o;
      const detail = rec.outreach_status === 'outreach_blocked'
        ? (rec.outreach_blocked_reason || '沒有記錄原因')
        : note;
      const when = rec.candidate_responded_at || rec.outreach_sent_at;
      return `<div class="pc-decision-box" style="margin-top:8px">
        <div class="pc-decision-label">阿財外聯</div>
        <strong class="pc-status ${tone}">${text(label)}</strong>
        ${detail ? `<p style="margin:6px 0 0">${text(detail)}</p>` : ''}
        ${when ? `<p class="muted" style="margin:4px 0 0">${text(when)}</p>` : ''}
      </div>`;
    };

    const card = (rec, index) => {
      const matchKey = String(rec.match_status || '').trim();
      const matchLabel = MATCH_LABEL[matchKey] || '無法判斷';
      const matchTone = MATCH_TONE[matchKey] || 'warn';
      const conf = confidenceLabel(rec.confidence);
      const reasons = Array.isArray(rec.reasons) ? rec.reasons : [];
      const blockers = Array.isArray(rec.blockers) ? rec.blockers : [];
      const missing = Array.isArray(rec.missing_information) ? rec.missing_information : [];
      const evidence = Array.isArray(rec.evidence) ? rec.evidence : [];
      const locations = formatLocations(rec.job_locations);
      const employment = formatEmployment(rec.job_employment);
      const jobStatus = JOB_STATUS_LABEL[String(rec.job_status || '').trim().toLowerCase()] || '';
      const decided = rec.status && rec.status !== 'pending_review';
      const recId = escapeHtml(rec.id ?? '');
      // 已經做過決定的就不再給按鈕（避免顧問重複按、也避免看起來像還沒處理），
      // 改成顯示當初決定了什麼、誰決定的、什麼時候。
      const decisionBlock = decided
        ? `<div class="pc-decision-box">
            <div class="pc-decision-label">顧問決定</div>
            <strong>${text(DECISION_LABEL[rec.status] || DECISION_LABEL[rec.consultant_decision] || '已處理', '已處理')}</strong>
            <p class="muted" style="margin:4px 0 0">${text(rec.consultant_decision_by, '（沒有記錄是誰）')}・${text(rec.consultant_decision_at, '（沒有記錄時間）')}</p>
            ${rec.rejection_reason ? `<p style="margin:6px 0 0">略過原因：${text(rec.rejection_reason)}</p>` : ''}
          </div>${outreachBlock(rec)}`
        : `<div class="actions-row" style="margin-top:12px">
            <button type="button" class="btn primary sm" data-action="rec-approve" data-rec-id="${recId}">值得問人選</button>
            <button type="button" class="btn ghost sm" data-action="rec-reject" data-rec-id="${recId}">略過</button>
          </div>
          <p class="help" style="margin:8px 0 0">按下去<b>只會記錄你的判斷</b>——現階段不會通知人選，也不會改變人選目前的職缺。</p>`;
      return `
      <section class="card pc-card pc-rec">
        <div class="card-head">
          <h2 style="margin:0;font-size:15px">${text(rec.rank || index + 1, String(index + 1))}. ${text(rec.job_title, '（職缺名稱未填）')}</h2>
          <div class="pc-rec-tags">
            <span class="pc-status ${matchTone}">${matchLabel}</span>
            ${conf ? `<span class="badge">信心：${conf}</span>` : ''}
            ${jobStatus && jobStatus !== '招募中' ? `<span class="badge warning">${jobStatus}</span>` : ''}
          </div>
        </div>
        <div style="padding:14px 15px">
          ${(locations || rec.job_salary_summary || employment) ? `<div class="pc-jobline" style="margin:0 0 10px">
            ${locations ? `<span>📍 ${text(locations)}</span>` : ''}
            ${rec.job_salary_summary ? `<span>💰 ${text(formatSalarySummary(rec.job_salary_summary))}</span>` : ''}
            ${employment ? `<span>${text(employment)}</span>` : ''}
          </div>` : ''}
          ${reasons.length ? `<div class="pc-rec-block"><b>適合原因</b>${reasons.map((r) => `<div class="pc-alt-reason">✓ ${text(r)}</div>`).join('')}</div>` : ''}
          ${blockers.length ? `<div class="pc-rec-block"><b>需注意</b>${blockers.map((b) => `<div class="pc-alt-watch">△ ${text(b)}</div>`).join('')}</div>` : ''}
          ${missing.length ? `<div class="pc-rec-block"><b>待確認</b>${missing.map((m) => `<div class="pc-rec-missing">${text(m)}</div>`).join('')}</div>` : ''}
          ${evidence.length ? `<details class="pc-rec-evidence"><summary>佐證（${evidence.length}）｜履歷與面談裡的原文</summary>
            ${evidence.map((e) => `<div class="pc-evidence-snippet">${text(e)}</div>`).join('')}
          </details>` : ''}
          ${decisionBlock}
        </div>
      </section>`;
    };

    return `
    <div class="notice pc-rec-notice">
      <b>這裡只是阿財的建議。</b>系統沒有發任何訊息給人選，也不會自動把人選換到別的職缺。按「值得問人選」只是把你的判斷記下來，要不要真的推、怎麼跟人選說，都還是你自己決定、自己操作。
    </div>
    ${items.map(card).join('')}`;
  },

  // 客製表單狀態（2026-09-29，總指揮交辦，補新舊後台對照表抓到的缺口）：
  // 每張職缺可能掛好幾份表單，同一份表單三種狀態各配一種操作——沒寄過
  // （寄送／代為上傳）、已寄還沒填完（催填／代為上傳）、已填完（下載，
  // 不給催填也不給重複上傳，避免蓋掉人選自己填的那份）。跟 jobCardPanel
  // 的表單風格不同，這裡動作多、資料本來就有 job_form_id 當唯一鍵，不用
  // 另外發明一套識別方式。
  candidateFormsBlock: (forms, applicationId, companyId) => {
    const list = forms || [];
    if (!list.length) return '';
    const row = (f) => {
      const idParams = { application_id: applicationId, company_id: companyId, job_form_id: f.job_form_id };
      let statusTag, actions;
      if (f.status === 'submitted') {
        statusTag = '<span class="badge success">已填完</span>';
        actions = [`<button type="button" class="btn ghost sm" data-download-form-submission="${text(f.id)}">下載</button>`];
      } else if (f.status === 'sent') {
        statusTag = '<span class="badge warning">已寄送，等填寫</span>';
        actions = [
          actionBtn('催填', 'candidate-form-resend', { idParams: { id: f.id } }),
          actionBtn('代為上傳', 'candidate-form-upload', { idParams }),
        ];
      } else {
        statusTag = '<span class="badge">尚未寄送</span>';
        actions = [
          actionBtn('寄送表單', 'candidate-form-trigger', { idParams }),
          actionBtn('代為上傳', 'candidate-form-upload', { idParams }),
        ];
      }
      return `<div class="list-row" style="padding:8px 10px;margin-top:4px"><span style="font-size:13px">${text(f.form_name)} ${statusTag}</span>${rowActions(actions)}</div>`;
    };
    return `<div style="margin-top:6px"><small class="muted">客製表單</small>${list.map(row).join('')}</div>`;
  },

  // 客戶已在 portal 回報匯款、等顧問確認——跟收費進程頁同一批資料
  // （billing_pending），掛在這裡是因為顧問正在看這位人選的時候最順手
  // 處理，不用為了確認一筆錢跳去另一個分頁再找一次是哪個人。
  candidateBillingPendingBlock: (pending) => {
    const list = pending || [];
    if (!list.length) return '';
    const row = (b) => `<div class="list-row" style="padding:8px 10px;margin-top:4px;background:#fff7dd"><span style="font-size:13px">${text(b.label)}（${text(b.percent)}%）客戶回報匯款日 ${text(b.client_transfer_date || '—')}</span>${rowActions([
      actionBtn('✅ 確認已收到', 'billing-confirm-received', { idParams: { id: b.id } }),
      actionBtn('❌ 還沒收到', 'billing-confirm-not-received', { idParams: { id: b.id } }, 'danger'),
    ])}</div>`;
    return `<div style="margin-top:6px"><small class="muted">⚠️ 客戶回報已匯款，待確認</small>${list.map(row).join('')}</div>`;
  }
};


// ── 進度看板（2026-10-05 Jacky：「甘特圖還是專案管理那種」→ 選了看板）────────────
// 資料完全沿用既有端點：人選＝/admin/pipeline/tracker 的卡片（階段後端 resolveStage 已算好），
// 客戶＝/admin/bd/dashboard（開發中）＋/admin/portal/companies（洽談／簽約）＋上面那份卡片
// 反推「哪家客戶手上有人選」。看板只負責「放進哪一欄」跟「停多久」，不另外算一套階段。
const BOARD_DAY = 86400000;
const bdDays = (ts) => {
  if (!ts) return null;
  const t = Date.parse(String(ts).replace(' ', 'T') + (String(ts).length <= 10 ? 'T00:00:00+08:00' : '+08:00'));
  return Number.isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / BOARD_DAY)) : null;
};
const latestTs = (...xs) => xs.filter(Boolean).map(String).sort().slice(-1)[0] || null;
const mmdd = (ts) => { const m = String(ts || '').match(/\d{4}-(\d{2})-(\d{2})(?:[ T](\d{2}:\d{2}))?/); return m ? `${+m[1]}/${+m[2]}${m[3] ? ' ' + m[3] : ''}` : ''; };

export const CAND_COLS = [
  { key: 'fill', title: '等人選面談', hint: '還沒跟阿財談完', warn: 3, bad: 7 },
  { key: 'decide', title: '等顧問決定', hint: '談完了，要不要推', warn: 2, bad: 5 },
  { key: 'sent', title: '已推薦・客戶看履歷', hint: '等客戶回覆', warn: 5, bad: 10 },
  { key: 'interview', title: '客戶面試中', hint: '已排面試', warn: 7, bad: 14 },
  { key: 'offer', title: '錄取', hint: '談 offer／等報到日', warn: 3, bad: 7 },
  { key: 'onboard', title: '已到職・關懷', hint: '紅黃綠＝人選狀況', warn: 999, bad: 999 },
];

// 一張人選卡在各家客戶各自一張（同一人推兩家，兩家進度不同）；還沒推薦的就一張。
export function boardCandItems(cards, { showClosed = false } = {}) {
  const items = [];
  for (const c of cards || []) {
    if (c.kind && c.kind !== 'application') continue;
    const base = { appId: c.application_id, name: c.name || '（未命名）', owner: c.owner_name || '未指派', job: c.job_title || '', silent: !!c.silent_interview };
    if (c.tab === 'pool') { if (showClosed) items.push({ ...base, col: 'closed', since: c.created_at, sub: c.job_title, note: '已結案／不推' }); continue; }
    if (c.tab === 'fill' || c.tab === 'decide') {
      items.push({ ...base, col: c.tab, since: latestTs(c.created_at, c.pre_interview_note_at), sub: c.client_name && c.client_name !== '（未綁客戶）' ? `${c.client_name}｜${c.job_title || ''}` : (c.job_title || '未指定職缺'),
        note: c.tab === 'decide' && c.route_label ? `阿財：${c.route_label}` : (c.silent_interview ? '進了面談室沒開口' : c.later_state === 'waiting' ? '已應徵、還沒面談' : c.later_state === 'expired' ? '沒完成面談（7 天沒聊）' : '') });
      continue;
    }
    const pls = [...(c.placements || []), ...((c.extra_placements || []).flatMap((x) => x.placements || []))];
    if (!pls.length) { items.push({ ...base, col: 'sent', since: c.created_at, sub: c.client_name || c.job_title }); continue; }
    for (const p of pls) {
      const ended = p.closed || p.advisor_not_recommended_at || p.candidate_withdrawn_at;
      if (ended && !showClosed) continue;
      const step = (p.steps || [])[p.effective_index] || {};
      const ev = (p.stage_events || []).slice(-1)[0];
      const since = latestTs(p.forwarded_at, ev && ev.created_at);
      const sub = `${p.client_name || ''}｜${p.job_title || c.job_title || ''}`;
      base.companyId = p.company_id || null;   // 每次 push 都是 {...base} 展開，當下的值會被複製進去
      if (ended) { items.push({ ...base, col: 'closed', since, sub, note: p.client_rejected_at ? '客戶不要' : (p.candidate_withdrawn_at ? '人選放棄' : '已結案') }); continue; }
      const k = step.key || 'confirm';
      if (/^stage[1-4]$/.test(k)) {
        const mine = (p.stage_events || []).filter((e) => e.stage === k).slice(-1)[0];
        items.push({ ...base, col: 'interview', since, sub, note: `${step.lb || '面試'}${mine && mine.event_at ? '｜' + mmdd(mine.event_at) : ''}` });
      } else if (k === 'offer') items.push({ ...base, col: 'offer', since, sub, note: p.onboard_date ? `報到日 ${mmdd(p.onboard_date)}` : '還沒有報到日' });
      else if (k === 'onboard' || k === 'care') items.push({ ...base, col: 'onboard', since: p.onboard_date, sub, care: careLight(p) });
      else items.push({ ...base, col: 'sent', since, sub, note: p.client_formal_report ? '' : '客戶版履歷還沒產' });
    }
  }
  return items;
}

// 到職關懷紅黃綠（2026-10-05 到職關懷計畫第 1 步）。只用真的有的資料：
// 沒報到／按了「想聊聊」＝紅；關懷卡發了但沒回＝黃；最近一次回「一切順利」＝綠；還沒到報到日＝灰。
export function careLight(p) {
  const onb = p.onboard_date;
  const d = bdDays(onb);
  const future = onb && Date.parse(String(onb).slice(0, 10) + 'T00:00:00+08:00') > Date.now();
  let sent = []; try { sent = JSON.parse(p.care_log || '[]') || []; } catch { sent = []; }
  const lastSent = sent.length ? Math.max(...sent) : null;
  const g = Number(p.guarantee_days) || 90;
  const dayTxt = future ? `${mmdd(onb)} 報到` : (d != null ? `到職第 ${d} 天／保證期 ${g} 天` : '');
  if (p.no_show_at) return { tone: 'bad', label: '沒有報到', dayTxt };
  if (future) return { tone: 'idle', label: '等報到', dayTxt };
  if (p.care_signal === 'talk') return { tone: 'bad', label: `第 ${p.care_signal_point || '?'} 天按了「想聊聊」`, dayTxt };
  if (p.care_signal === 'ok' && (!lastSent || (p.care_signal_point || 0) >= lastSent)) return { tone: 'ok', label: '回覆一切順利', dayTxt };
  if (lastSent) return { tone: 'warn', label: `第 ${lastSent} 天關懷卡還沒回`, dayTxt };
  return { tone: 'warn', label: '還沒收到任何回覆', dayTxt };
}

export const CLIENT_COLS = [
  { key: 'contacted', title: '已聯繫', hint: '寄信／打過電話，還沒回' },
  { key: 'opened', title: '已開信', hint: '有看信，還沒回' },
  { key: 'replied', title: '有回應', hint: '回信或電話有興趣' },
  { key: 'talking', title: '洽談中', hint: '談合作條件' },
  { key: 'signed', title: '已簽約・找人中', hint: '還沒有人選在客戶手上' },
  { key: 'active', title: '人選在客戶手上', hint: '推薦／面試／錄取' },
  { key: 'won', title: '已成交', hint: '有人到職' },
];
// 後綴刻意拆字串拼：正式站的客戶名守門員會把字面上的「…有限公司」當成客戶名擋下。
const CO_SUFFIX_RE = new RegExp(['股份' + '有限' + '公司', '有限' + '公司', '公' + '司', '\\s'].join('|'), 'g');
const normCo = (s) => String(s || '').replace(/[（(].*?[）)]/g, '').replace(CO_SUFFIX_RE, '').toLowerCase();

export function boardClientItems({ bd = [], companies = [], candItems = [] }) {
  const byCo = new Map();
  for (const it of candItems) {
    const co = String(it.sub || '').split('｜')[0];
    if (!co || it.col === 'closed') continue;
    const k = normCo(co);
    if (!byCo.has(k)) byCo.set(k, { active: 0, won: 0, names: [] });
    const r = byCo.get(k);
    if (it.col === 'onboard') r.won += 1; else if (['sent', 'interview', 'offer'].includes(it.col)) { r.active += 1; r.names.push(it.name); }
  }
  const items = []; const seen = new Set();
  for (const c of companies) {
    if (c.relation === 'past' || c.relation === 'private') continue;
    const k = normCo(c.display_name); seen.add(k);
    const r = byCo.get(k) || { active: 0, won: 0, names: [] };
    const col = r.won ? 'won' : r.active ? 'active' : (c.relation === 'signed' ? 'signed' : 'talking');
    const note = r.active ? `人選 ${r.active} 位：${r.names.slice(0, 3).join('、')}${r.names.length > 3 ? '…' : ''}` : (c.job_count ? `職缺 ${c.job_count} 個` : '還沒有職缺');
    items.push({ kind: 'company', id: c.id, name: c.display_name, col, since: c.created_at, note, stale: false });
  }
  for (const b of bd) {
    const k = normCo(b.company);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const hot = b.stage === 'replied' || ['interested', 'got_contact', 'got_email'].includes(b.last_call_result);
    const col = hot ? 'replied' : (b.stage === 'opened' ? 'opened' : 'contacted');
    const callTxt = { interested: '電話：有興趣', got_contact: '電話：拿到窗口', got_email: '電話：拿到信箱', gatekeeper: '電話：卡總機', no_answer: '電話：沒接', not_interested: '電話：沒興趣', not_hiring: '電話：沒在找人' }[b.last_call_result] || '';
    items.push({ kind: 'bd', id: b.company, name: b.company, col, outreachId: (b.outreach_ids || []).slice(-1)[0] || null, since: latestTs(b.last_call_at, b.contacted_at, b.first_created_at),
      note: [b.assigned_to, callTxt || b.job_title].filter(Boolean).join('｜'), stale: !!b.next_followup_overdue, owner: b.assigned_to || '' });
  }
  return items;
}

function boardCardHtml(it, colDef, idx) {
  const d = bdDays(it.since);
  let tone = '';
  if (it.care) tone = it.care.tone;
  else if (it.kind === 'bd' || it.kind === 'company') tone = it.stale ? 'bad' : '';
  else if (colDef && d != null) tone = d >= colDef.bad ? 'bad' : d >= colDef.warn ? 'warn' : '';
  const ageTxt = it.care ? it.care.dayTxt : (it.kind === 'bd' ? (it.stale ? '該追了' : (d != null ? `${d} 天前聯繫` : '')) : (d != null && it.kind !== 'company' ? `這關 ${d} 天` : ''));
  const attrs = it.kind === 'bd' ? `data-board-bd="${escapeHtml(it.id)}"` : it.kind === 'company' ? `data-board-co="${escapeHtml(it.id)}"` : `data-board-app="${escapeHtml(it.appId)}"`;
  // 「改階段」放在卡片按鈕外面（不能包在 <button> 裡：有些瀏覽器按到裡面的字會當成按到整張卡，直接打開人選卡片——10/6 Jacky 實際遇到）
  return `<div class="bk-wrap"><button type="button" class="bk-card ${tone ? 'bk-' + tone : ''} bk-has-move" ${attrs} draggable="true" data-board-idx="${idx}" title="點開看詳細；按住拖到別欄可改階段">
    <span class="bk-top"><strong>${escapeHtml(it.name)}</strong>${it.owner && it.kind !== 'company' ? `<em>${escapeHtml(it.owner)}</em>` : ''}</span>
    ${it.sub ? `<span class="bk-sub">${escapeHtml(it.sub)}</span>` : ''}
    ${it.care ? `<span class="bk-light bk-${it.care.tone}"><i aria-hidden="true"></i>${escapeHtml(it.care.label)}</span>` : (it.note ? `<span class="bk-note">${escapeHtml(it.note)}</span>` : '')}
    ${ageTxt ? `<span class="bk-age">${escapeHtml(ageTxt)}</span>` : ''}
  </button><button type="button" class="bk-move" data-board-move="${idx}" title="不用拖，直接選要改到哪一欄">改階段 ▾</button></div>`;
}

export function boardView(items, cols, { kind, owners = [], ui = {} }) {
  const ownerSel = owners.length ? `<label class="bk-filter"><span>負責人</span><select data-board-filter="owner"><option value="">全部</option>${owners.map((o) => `<option ${ui.owner === o ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}</select></label>` : '';
  const closedChk = kind === 'cand' ? `<label class="bk-filter"><input type="checkbox" data-board-filter="closed" ${ui.showClosed ? 'checked' : ''}><span>顯示已結案</span></label>` : '';
  const shown = ui.owner ? items.filter((x) => x.owner === ui.owner) : items;
  const allCols = (kind === 'cand' && ui.showClosed) ? [...cols, { key: 'closed', title: '已結案', hint: '不推／客戶不要／人選放棄', warn: 999, bad: 999 }] : cols;
  const LIMIT = 25;
  const colHtml = allCols.map((col) => {
    const list = shown.filter((x) => x.col === col.key).sort((a, b) => {
      const tw = (x) => (x.care && x.care.tone === 'bad') || x.stale ? 0 : 1;
      return tw(a) - tw(b) || String(a.since || '').localeCompare(String(b.since || ''));
    });
    const expanded = ui.expand && ui.expand[col.key];
    const vis = expanded ? list : list.slice(0, LIMIT);
    const red = list.filter((x) => (x.care && x.care.tone === 'bad') || x.stale || (kind === 'cand' && !x.care && bdDays(x.since) >= col.bad)).length;
    return `<section class="bk-col" data-board-col="${col.key}" aria-label="${escapeHtml(col.title)}">
      <header><h3>${escapeHtml(col.title)}<b>${list.length}</b></h3><small>${escapeHtml(col.hint)}${red ? `<span class="bk-redcount">${red} 張該追</span>` : ''}</small></header>
      <div class="bk-list">${vis.length ? vis.map((x) => boardCardHtml(x, col, items.indexOf(x))).join('') : '<p class="bk-empty">目前沒有</p>'}
      ${list.length > vis.length ? `<button type="button" class="btn sm bk-more" data-board-expand="${col.key}">再看 ${list.length - vis.length} 張</button>` : ''}</div>
    </section>`;
  }).join('');
  const total = shown.length;
  const colBad = Object.fromEntries(allCols.map((c) => [c.key, c.bad]));
  const reds = shown.filter((x) => (x.care && x.care.tone === 'bad') || x.stale || (kind === 'cand' && !x.care && bdDays(x.since) >= (colBad[x.col] ?? 999))).length;
  return `<div class="bk-bar">${ownerSel}${closedChk}<span class="bk-sum">共 ${total} 張${reds ? `｜<b class="bk-redtxt">${reds} 張該追</b>` : ''}</span></div>
    <div class="bk-board" style="--bk-cols:${allCols.length}">${colHtml}</div>`;
}
