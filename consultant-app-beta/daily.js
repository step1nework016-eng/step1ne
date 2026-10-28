// 每日工作台（2026-10-14 Jacky）：把他的「獵頭顧問每日作戰儀表板」原檔的所有功能，原封不動整合進顧問後台。
// 7 個分頁（總覽／每日行程／企業 BD／人才追蹤／渠道追蹤／分階段話術／收盤檢討）、儲存今天、匯出匯入 JSON、CSV、
// 今日摘要 TXT、話術複製、漏斗目標條、今日下一步——功能與資料格式都沿用原檔。
// 資料仍存在這個瀏覽器（localStorage，鍵名與原檔相同：headhunter-v2-日期），原檔以前記的資料會直接看到。
import { escapeHtml } from './core/security.js';
import { api } from './core/api.js';
import { adapters } from './adapters.js';
import { statusBadge } from './core/status.js';

const schedules=[['09:00–09:30','盤點與選 Top 3','確認客戶／人才待辦及三個主攻職缺'],['09:30–10:00','104 後台篩企業','建立 A/B/C 名單與開發理由'],['10:00–11:30','企業 BD 第一輪','聯繫 A 級企業，確認痛點與訪談機會'],['11:30–12:00','企業追蹤與資料寄送','更新狀態、寄資料、排下次跟進'],['12:00–13:00','午餐休息','休息；非必要不排工作'],['13:00–13:40','Top 3 人才地圖','職稱、競業、技能、地區、關鍵字'],['13:40–15:30','主動搜尋人才','跨平台新增名單並做初步匹配'],['15:30–16:30','人選接觸與分享機會','私訊／電話／Email；安排洽談'],['16:30–17:10','發布渠道決策','選渠道、發布／測試、記錄來源'],['17:10–17:30','17:30 洽談準備','履歷、轉職動機、薪資、適合職缺'],['17:30–18:10','已約人選洽談','確認條件、意願、下一步'],['18:10–18:30','洽談紀錄','更新 CRM、履歷、送件條件'],['18:30–19:20','晚間人選 Follow-up','追蹤在職人選；尊重聯絡時段'],['19:20–20:00','數據收盤','更新漏斗、卡點、明日 Top 3']];
const schemas={bd:[['company','企業'],['job','104 職缺／來源'],['priority','優先','A|B|C'],['contact','窗口'],['method','聯繫方式'],['stage','階段','待篩選|待聯繫|已聯繫未接通|已接觸|有效對話|需求訪談已約|寄送資料|談合約|正式委託|暫不需要|停止開發'],['pain','痛點／需求'],['nextDate','跟進日','date'],['next','下一步']],candidate:[['name','人選'],['job','職缺'],['source','來源'],['contact','聯繫索引'],['stage','階段','名單建立|已聯繫|已回覆|已約洽談|已洽談|合格待同意|已同意推薦|已送件|客戶面試|Offer|到職|不適合'],['notes','條件'],['nextDate','跟進日','date'],['next','下一步']],channel:[['job','職缺'],['platform','平台'],['date','發布日','date'],['views','曝光','number'],['dm','私訊','number'],['line','LINE','number'],['talk','洽談','number'],['submit','送件','number'],['next','優化']]};
const scripts=[['企業｜總機轉接','您好，我是 Step1ne 的獵才顧問。我留意到貴公司在 104 有招募【職稱】，想向負責該職缺的招募窗口確認目前需求。方便協助轉接人資或提供適合聯繫的窗口嗎？','目標：取得正確窗口；避免要求不必要的個人資訊。'],['企業｜首次聯繫 HR','您好，我是 Step1ne 的獵才顧問。我看到貴公司目前在 104 招募【職稱】，想先確認這個職缺是否仍在招募？\n\n我們主要協助企業主動接觸尚未積極投遞履歷的在職人才。想請教目前招募比較困難的是履歷數量、專業經驗匹配，還是面試後留任意願？\n\n若目前有招募瓶頸，我希望約 15 分鐘了解職務與需求，再評估我們是否有適合的協助方式。','先問現況與痛點；不預設企業一定缺人。'],['企業｜確認需求訪談','為避免後續推薦方向有落差，我想先確認這次是補人還是擴編、主要工作任務、必備條件、薪資預算、工作地點、面試流程，以及預計到職時間。\n\n另外，這個職位目前最難找到的是哪一項能力？您希望我先提供人才市場評估，還是安排一次完整需求訪談？','會後整理 JD、Must-have、Nice-to-have 與決策者。'],['企業｜寄服務介紹／合約','您好，感謝剛才的交流。依照我們討論的【職缺】，先提供顧問服務流程與合作條款供您內部評估。\n\n為利後續確認適合的招募方式，也想請教方便安排【日期／時段】約 15–20 分鐘，進一步確認工作內容、薪資與招募時程嗎？謝謝。','只承諾實際可提供的資料與服務。'],['企業｜已有自行找到人','了解，恭喜貴公司順利找到合適的人才！那我先不打擾目前的招募安排。未來若遇到較難補齊的專業職或主管職，歡迎把我們當作備援資源。若方便，我可以寄一頁簡短服務介紹供您留存，之後有需要再聯繫即可。','不硬推；先徵求是否願意收資料。'],['企業｜暫不使用獵頭','了解，現階段以內部招募為主很合理。我想再確認一下，未來若有特定職位招募超過預期時間，貴公司是否會考慮外部顧問協助？若可以，我會在適當時間再簡短確認，不會頻繁打擾。','取得追蹤許可，尊重拒絕。'],['企業｜7–14 天跟進','您好，我是之前聯繫過您的 Step1ne 顧問。上次有提到【職稱】仍在招募，想確認目前進度是否順利？如果人選品質或招募時程仍有挑戰，我可以先針對這個職缺整理人才搜尋方向，供您判斷是否需要額外支援。','跟進要有上次談話脈絡。'],['人選｜首次主動接觸','您好，我是 Step1ne 的獵才顧問，目前協助企業尋找【職稱／領域】人才。留意到您有【相關專長】背景，想詢問您近期是否願意了解合適的職涯機會？\n\n如果方便，我可以先分享職務方向、工作地點及薪資區間，您評估有興趣再安排簡短交流。','不虛構對方經歷，不強迫透露現職資訊。'],['人選｜分享職缺與邀約','這次機會主要負責【工作重點】，地點在【地區】，薪資約【區間】，核心條件是【必備能力】。\n\n想先了解這類工作是否符合您下一階段的方向？如果有興趣，我們可以安排 15–20 分鐘電話，確認工作內容與雙方期待。','資訊未經確認時標示待確認。'],['人選｜電話洽談','想先從您目前的工作內容與未來職涯方向開始了解：最近有考慮轉職的原因嗎？下一份最看重職務、薪資、地點或發展中的哪幾項？目前待遇與期望區間方便分享嗎？最快何時可到職？\n\n最後我會再確認這個機會是否適合您；若不適合，也可以依您同意的範圍，未來分享其他職缺。','避免詢問與職務無關的敏感個資。'],['人選｜取得推薦同意','依照剛才討論，您與【職缺】的匹配點是【具體能力】，可能需要進一步確認的是【差距】。若您願意，我會先提供企業與職缺資訊供您評估；取得您的同意後，再依約定範圍提交履歷或人才摘要。可以嗎？','未取得同意前不向企業傳送可識別履歷。'],['人選｜未回覆追蹤','您好，前幾天有分享【職稱】的機會，不確定您是否有看到。若目前沒有轉職規劃也完全沒關係；若有興趣，我可以提供更完整的工作內容供您評估。謝謝！','追蹤 1–2 次後可暫停，避免騷擾。'],['人選｜洽談後結尾','謝謝今天的交流。我整理一下共識：您優先考慮【方向】、期望【薪資／地點】、預計【時間】。下一步我會在【日期】前提供【職缺資訊／待確認問題】，若您決定參與推薦，我們再確認履歷提交範圍。','務必寫明雙方下一步與日期。'],['企業｜人才反向開發','您好，我是 Step1ne 的獵才顧問。近期我們觀察到【領域】具備【能力組合】的人才流動趨勢，想了解貴公司是否有相關團隊擴編或關鍵職位規劃？\n\n若有需求，我可以先協助釐清人才條件與市場可行性，再討論合作方式。','若指向特定候選人，須先確認其對外揭露同意與匿名程度。']];

const TABS = ['overview', 'schedule', 'bd', 'candidate', 'channel', 'scripts', 'review'];
let day = new Date().toLocaleDateString('en-CA');
let state = null;
let scriptIdx = 0;
let currentTab = 'overview';
let boundUnload = false;
// ── 系統資料（2026-10-14）：先選顧問，再把「他名下」的開發進度與人選從後台讀進來 ──
const OWNER_KEY = 's1ne_candidate_owner';   // 跟人選工作台共用同一個「我是誰」
let consultants = null;
let sys = { owner: localStorage.getItem(OWNER_KEY) || '', loading: false, error: '', bd: [], cands: [], posts: [], calls: [], at: '', postsAt: '', postsErr: '', chFilter: '', chAccount: '', chView: 'overview' };
const BD_STAGE_MAP = { '還沒聯繫': '待聯繫', '已聯繫': '已接觸', '有興趣': '有效對話', '已寄資料': '寄送資料', '談需求': '需求訪談已約', '簽約': '正式委託', '沒興趣': '停止開發', '暫緩': '暫不需要' };
const CAND_STAGE_MAP = { client: '已送件', interviewed: '已洽談', new: '名單建立' };
const todayStr = () => new Date().toLocaleDateString('en-CA');
const plusDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };
const consultantName = () => { const c = (consultants || []).find((x) => x.id === sys.owner); return c ? c.display_name : ''; };
async function loadConsultants() {
  if (consultants) return consultants;
  try { consultants = (await api.get('/admin/consultants')).consultants || []; } catch { consultants = []; }
  consultants = consultants.filter((c) => c.is_active);
  if (!sys.owner && consultants.length === 1) sys.owner = consultants[0].id;
  return consultants;
}
async function loadSystem(force) {
  if (!sys.owner) { sys.bd = []; sys.cands = []; sys.calls = []; sys.error = ''; return; }
  if (!force && sys.at && sys.loadedFor === sys.owner) return;
  sys.loading = true; sys.error = '';
  try {
    const name = consultantName();
    const [b, c, rm] = await Promise.all([api.get('/admin/bd/dashboard'), adapters.candidates(sys.owner), api.get('/admin/consultant-reminders?for=' + encodeURIComponent(name) + '&day=' + encodeURIComponent(todayStr()) + '&to=' + encodeURIComponent(plusDays(7)) + '&back=3').catch(() => ({ items: [] }))]);
    sys.calls = (rm && rm.items) || [];
    // 2026-10-15：招募管道（訓練機構等）到了追蹤日也放進今日下一步
    try { const ch = await api.get('/admin/channels'); sys.channels = ((ch && ch.channels) || []).filter((x) => x.owner === name && x.status !== 'paused' && x.next_follow_at && x.next_follow_at <= todayStr()); } catch { sys.channels = []; }
    sys.bd = (b.rows || []).filter((r) => r.assigned_to === name && !r.ai_untouched);
    sys.cands = c || [];
    sys.at = new Date().toLocaleTimeString('zh-TW', { hour12: false }); sys.loadedFor = sys.owner;
  } catch (e) { sys.error = (e && e.message) || '讀取失敗'; }
  sys.loading = false;
}
// 渠道追蹤是全公司的：不受上面「我是哪位顧問」限制，所有顧問、所有帳號的貼文都看得到。
async function loadPosts(force) {
  if (!force && sys.postsAt) return;
  sys.postsErr = '';
  try {
    const q = await api.get('/admin/social-post-queue');
    sys.posts = ((q && q.queue) || []).filter((p) => p.social_post_status === 'posted');
    sys.postsAt = new Date().toLocaleTimeString('zh-TW', { hour12: false });
  } catch (e) { sys.postsErr = (e && e.message) || '讀取失敗'; }
}
const postsShown = () => sys.posts.filter((p) => (!sys.chFilter || p.consultant_name === sys.chFilter) && (!sys.chAccount || p.account_label === sys.chAccount));
const dueOf = (r) => String(r.next_due || '').slice(0, 10);
function sysBdRows() {
  const t = todayStr();
  return sys.bd.slice().sort((a, b) => (dueOf(a) || '9999').localeCompare(dueOf(b) || '9999')).map((r) => ({ ...r, _due: dueOf(r), _overdue: dueOf(r) && dueOf(r) <= t }));
}
function sysSummary() {
  const t = todayStr();
  const calledToday = sys.bd.filter((r) => String(r.last_call_at || '').slice(0, 10) === t).length;
  const mailedToday = sys.bd.filter((r) => String(r.contacted_at || '').slice(0, 10) === t).length;
  const due = sys.bd.filter((r) => dueOf(r) && dueOf(r) <= t).length;
  const hot = sys.bd.filter((r) => r.tag === 'HOT' || r.tag === 'WARM').length;
  const newCand = sys.cands.filter((c) => String(c.updatedAt || '').slice(0, 10) === t).length;
  return [['開發進度公司', sys.bd.length], ['今天有通話紀錄', calledToday], ['今天寄過信', mailedToday], ['到期／逾期跟進', due], ['HOT／WARM 公司', hot], ['名下人選', sys.cands.length], ['今天新進人選', newCand], ['社群貼文（全部顧問，近 30 則）', sys.posts.length], ['貼文曝光合計', sys.posts.reduce((a, p) => a + (Number(p.views) || 0), 0)], ['LINE 導入合計', sys.posts.reduce((a, p) => a + (Number(p.line_adds) || 0), 0)]];
}
function sysBar() {
  const opts = (consultants || []).map((c) => `<option value="${esc(c.id)}" ${c.id === sys.owner ? 'selected' : ''}>${esc(c.display_name)}</option>`).join('');
  const status = !sys.owner ? '請先選顧問，才會顯示他的資料' : sys.loading ? '讀取中…' : sys.error ? `<span class="dly-danger">讀取失敗：${esc(sys.error)}</span>` : `已載入 ${esc(sys.at)}（${esc(consultantName())}）`;
  return `<div class="card dly-row dly-sysbar"><div class="dly-field"><label>我是哪位顧問</label><select id="dly-owner"><option value="">請選擇…</option>${opts}</select></div>
  <button class="btn" data-dly="sysRefresh" ${sys.owner ? '' : 'disabled'}>重新讀取系統資料</button><span class="dly-hint">${status}</span></div>`;
}
const esc = escapeHtml;
const key = () => 'headhunter-v2-' + day;
const fresh = () => ({ top3: '', schedule: schedules.map(() => ({ done: false, note: '' })), bd: [], candidate: [], channel: [], reviewBd: '', reviewTalent: '', reviewTomorrow: '', reviewBlock: '' });

function load() {
  let st = null;
  try { st = JSON.parse(localStorage.getItem(key()) || 'null'); } catch { st = null; }
  state = { ...fresh(), ...(st || {}) };
  if (!Array.isArray(state.schedule) || state.schedule.length !== schedules.length) state.schedule = fresh().schedule;
}
function collect(root) {
  if (!root) return;
  const t = root.querySelector('#dly-top3');
  if (t) state.top3 = t.value;
  [['reviewBd', 'dly-reviewBd'], ['reviewTalent', 'dly-reviewTalent'], ['reviewTomorrow', 'dly-reviewTomorrow'], ['reviewBlock', 'dly-reviewBlock']].forEach(([k, id]) => {
    const el = root.querySelector('#' + id);
    if (el) state[k] = el.value;
  });
}
function persist() { try { localStorage.setItem(key(), JSON.stringify(state)); } catch { /* 存不了就算了，畫面上的資料還在 */ } }
function download(name, text, type) {
  const a = document.createElement('a'), url = URL.createObjectURL(new Blob([text], { type }));
  a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const count = (type, fn) => state[type].filter(fn).length;


// ── 今日下一步（放在最上面，顧問一看就知道今天要做什麼）──
function yesterdayTomorrow() {
  const d = new Date(day + 'T00:00:00'); d.setDate(d.getDate() - 1);
  const k = 'headhunter-v2-' + d.toLocaleDateString('en-CA');
  try { const o = JSON.parse(localStorage.getItem(k) || 'null'); return String((o && o.reviewTomorrow) || '').split('\n').map((x) => x.trim()).filter(Boolean); } catch { return []; }
}
function todayItems() {
  const t = todayStr();
  const items = [];
  // 2026-10-28 檢查：昨天沒打成的電話（之後沒記電洽紀錄）也列出來、標逾期，不會隔天就消失
  (sys.calls || []).filter((c) => String(c.call_at || '').slice(0, 10) === t || c.overdue).forEach((c) => items.push({ g: 'call', pri: c.overdue ? 0 : 1, k: 'call:' + c.id, rid: c.id, reply: (c.reply_at && !(state.seenReply || {})[c.id]) ? (c.reply_text || '（無內文）') : '', time: c.overdue ? '逾期 ' + String(c.call_at || '').slice(5, 16) : String(c.call_at || '').slice(11, 16), icon: '📞', title: (c.candidate_name || '電話／面談'), text: String(c.message || '').replace(/\s+/g, ' ').replace(/^電話／面談\s*/, '').slice(0, 90), attr: (() => { const id = c.application_id || ((sys.cands || []).find((x) => x.name && String(c.candidate_name || '').includes(x.name)) || {}).applicationId; return id ? `data-application="${esc(id)}"` : ''; })() }));
  sysBdRows().filter((r) => r._overdue).forEach((r) => items.push({ g: 'bd', pri: r._due < t ? 0 : 2, k: 'bd:' + r.company, time: r._due === t ? '今天' : '逾期 ' + r._due.slice(5), icon: '🏢', title: r.company, text: r.next_step || '待跟進', sub: r.call_phone || r.company_phone || '', attr: `data-bd-company="${esc(r.company)}"` }));
  sys.cands.filter((c) => c.stage === 'decide').forEach((c) => items.push({ g: 'decide', pri: 3, k: 'decide:' + c.applicationId, time: '等你決定', icon: '👤', title: (c.seqNo ? '#' + c.seqNo + ' ' : '') + c.name, text: c.job || '', attr: `data-application="${esc(c.applicationId)}"` }));
  state.bd.filter((x) => x.nextDate && x.nextDate <= t).forEach((x) => items.push({ g: 'mine', pri: 2, k: 'minebd:' + (x.company || '') + (x.next || ''), time: x.nextDate === t ? '今天' : '逾期 ' + x.nextDate.slice(5), icon: '📝', title: x.company || '未命名企業', text: x.next || '待跟進', attr: '' }));
  state.candidate.filter((x) => x.nextDate && x.nextDate <= t).forEach((x) => items.push({ g: 'mine', pri: 2, k: 'minecd:' + (x.name || '') + (x.next || ''), time: x.nextDate === t ? '今天' : '逾期 ' + x.nextDate.slice(5), icon: '📝', title: x.name || '未命名人選', text: x.next || '待跟進', attr: '' }));
  (sys.channels || []).forEach((x) => items.push({ g: 'bd', pri: x.next_follow_at < t ? 0 : 2, k: 'ch:' + x.id + ':' + x.next_follow_at, time: x.next_follow_at === t ? '今天' : '逾期 ' + x.next_follow_at.slice(5), icon: '🏫', title: x.name, text: x.next_step || '招募管道待跟進', attr: `data-channel-id="${x.id}"` }));
  const dn = (state.done || {});
  items.forEach((x) => { x.done = !!dn[x.k]; });
  return items.sort((a, b) => (a.done - b.done) || (a.pri - b.pri) || String(a.time).localeCompare(String(b.time)));
}
function todayPanel() {
  const items = todayItems();
  const carry = yesterdayTomorrow();
  const g = (k) => items.filter((x) => x.g === k).length;
  const nDone = items.filter((x) => x.done).length;
  const chips = [['✅ 已完成', nDone + '／' + items.length], ['📞 今天的電話／面談', g('call')], ['🏢 開發跟進（到期／逾期）', g('bd')], ['👤 等你決定的人選', g('decide')], ['📝 我自己記的跟進', g('mine')], ['昨天寫的明日事項', carry.length]].map(([n, v]) => `<span class="dly-chip ${v ? 'on' : ''}">${n} <b>${v}</b></span>`).join('');
  // 2026-10-15 Jacky：預設收起，只顯示最近一個要處理的；下拉展開看全部，再按一次收起
  const open = !!sys.todayAll;
  const firstTodo = items.find((x) => !x.done);
  // 收起時：剛按完成的那件留著顯示「已完成」（可還原），下面接著下一件
  const justDone = !open && sys.lastDoneK ? items.find((x) => x.k === sys.lastDoneK && x.done) : null;
  const shown = open ? items : [justDone, firstTodo].filter(Boolean);
  const rows = shown.map((x) => `<div class="dly-todo ${x.pri === 0 && !x.done ? 'late' : ''}${x.done ? ' done' : ''}${x.reply && !x.done ? ' replied' : ''}" ${x.attr} ${x.attr ? 'style="cursor:pointer"' : ''}><span class="dly-todo-t">${esc(x.time)}</span><span>${x.icon}</span><div style="flex:1"><b>${esc(x.title)}</b>${x.text ? `<div class="dly-small" style="margin-top:1px">${esc(x.text)}${x.sub ? '｜' + esc(x.sub) : ''}</div>` : ''}${x.reply ? `<div class="dly-replied">⚠️ 對方回信了：「${esc(x.reply)}」→ 先回信確認時間，確認了才打。<button class="btn" style="min-height:28px;padding:1px 8px;font-size:12px;margin-left:6px" data-dly="seenReply:${esc(x.rid)}">我看過了</button></div>` : ''}</div><button class="btn ${x.done ? '' : 'primary'}" style="min-height:32px;padding:2px 10px;font-size:13px" data-dly="doneItem:${encodeURIComponent(x.k || '')}" title="${x.done ? '還沒做完，放回待辦' : '做完了'}">${x.done ? '↩ 還原' : '✓ 完成'}</button>${x.rid && !x.done ? `<button class="btn dly-danger" style="min-height:32px;padding:2px 9px;font-size:13px" data-dly="cancelCall:${esc(x.rid)}" title="取消這筆預約與提醒">取消</button>` : ''}</div>`).join('');
  const empty = !sys.owner ? '<div class="dly-hint">請先在上面選顧問：選了之後，這裡會列出你今天的電話與面談、到期的開發跟進、等你決定的人選。</div>' : (items.length || carry.length ? '' : '<div class="dly-hint">目前沒有到期或今天要做的事。去「② 企業 BD」或「③ 人才追蹤」挑下一步，並設定下次跟進日。</div>');
  const hasMore = items.length > 1 || carry.length || (sys.calls || []).some((c) => String(c.call_at || '').slice(0, 10) > todayStr());
  const more = hasMore ? `<button type="button" class="btn dly-fold" data-dly="todayMore" aria-expanded="${open}">${open ? '收起 ▴' : `展開全部 ${items.length} 件 ▾`}</button>` : '';
  const allDone = !open && items.length && !firstTodo ? '<div class="dly-hint">今天的下一步都完成了 ✓</div>' : '';
  const up = (sys.calls || []).filter((c) => String(c.call_at || '').slice(0, 10) > todayStr());
  const upHtml = up.length ? `<div class="dly-carry"><b>接下來 7 天已約好（${up.length}）</b>${up.map((c) => `<div class="dly-todo" ${c.application_id ? `data-application="${esc(c.application_id)}" style="cursor:pointer"` : ''}><span class="dly-todo-t">${esc(String(c.call_at).slice(5, 16))}</span><span>📞</span><div style="flex:1"><b>${esc(c.candidate_name || '')}</b><div class="dly-small">${esc(String(c.message || '').replace(/^電話／面談\s*/, '').replace(/^電話\s*/, '').slice(0, 80))}</div></div><button class="btn dly-danger" style="min-height:32px;padding:2px 9px;font-size:13px" data-dly="cancelCall:${esc(c.id)}">取消</button></div>`).join('')}</div>` : '';
  const carryHtml = carry.length ? `<div class="dly-carry"><b>昨天寫的「明日 3 件事」</b><ol>${carry.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></div>` : '';
  return `<div class="card dly-today"><div class="dly-row"><h2 style="margin:0">🎯 今日下一步</h2><span class="dly-small">${esc(day)}${sys.at ? '｜系統資料 ' + esc(sys.at) : ''}</span></div><div class="dly-chips">${chips}</div>${open ? carryHtml : ''}${rows || ''}${allDone}${empty}${more}${open ? upHtml + bookForm() : ''}</div>`;
}

function bookForm() {
  if (!sys.owner) return '';
  const opts = sys.cands.map((c) => `<option value="${esc((c.seqNo ? '#' + c.seqNo + ' ' : '') + c.name)}"></option>`).join('');
  const d = new Date(); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1);
  const pad = (n) => String(n).padStart(2, '0');
  const dv = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
  return `<details class="dly-book"${sys.bookOpen ? ' open' : ''}><summary>＋ 記錄跟人選約好的面談／電話時間（會 TG 提醒你、同步到發財基地行事曆）</summary>
  <div class="dly-fields" style="margin-top:10px">
    <div class="dly-field"><label>人選（可直接打字找，或手動填對象）</label><input id="dly-bk-who" list="dly-bk-list" placeholder="例：#93 沈蓓芬"><datalist id="dly-bk-list">${opts}</datalist></div>
    <div class="dly-field"><label>約好的日期與時間</label><input id="dly-bk-at" type="datetime-local" value="${dv}"></div>
    <div class="dly-field"><label>提前多久提醒我</label><select id="dly-bk-before"><option value="30" selected>30 分鐘前</option><option value="60">1 小時前</option><option value="10">10 分鐘前</option><option value="1440">前一天</option></select></div>
    <div class="dly-field"><label>備註（要談什麼、推哪個職缺）</label><input id="dly-bk-note" placeholder="例：推美德供應鏈副總，先問紡織年資"></div>
  </div>
  <div class="dly-row" style="margin-top:8px"><button class="btn primary" data-dly="bookCall">記下並提醒我</button><span class="dly-hint" id="dly-bk-msg"></span></div></details>`;
}

function toolbar() {
  return sysBar() + todayPanel() + `<div class="card dly-row"><div class="dly-field"><label>工作日期</label><input id="dly-day" type="date" value="${esc(day)}"></div>
  <div class="dly-field"><label>今日 Top 3 職缺（以 / 分隔）</label><input id="dly-top3" style="min-width:290px" placeholder="會計 / BIM / 營運主管" value="${esc(state.top3)}"></div>
  <button class="btn primary" data-dly="save">儲存今天</button><button class="btn" data-dly="exportJSON">匯出 JSON 備份</button>
  <button class="btn" data-dly="importPick">匯入備份</button><input id="dly-import" type="file" accept=".json" hidden>
  <span class="dly-hint">資料存在此瀏覽器；換裝置前請匯出備份。</span></div>`;
}
function sectionOverview() {
  const bd = state.bd, c = state.candidate, ch = state.channel;
  const vals = [['104 企業名單', bd.length], ['企業已接觸', count('bd', (x) => x.stage && !['待篩選', '待聯繫'].includes(x.stage))], ['有效企業對話', count('bd', (x) => ['有效對話', '需求訪談已約', '寄送資料', '談合約', '正式委託'].includes(x.stage))], ['已約需求訪談', count('bd', (x) => x.stage === '需求訪談已約')], ['人才名單', c.length], ['已接觸人才', count('candidate', (x) => x.stage && x.stage !== '名單建立')], ['已洽談人才', count('candidate', (x) => ['已洽談', '合格待同意', '已同意推薦', '已送件', '客戶面試', 'Offer', '到職'].includes(x.stage))], ['已送件人才', count('candidate', (x) => ['已送件', '客戶面試', 'Offer', '到職'].includes(x.stage))], ['渠道實驗', ch.length], ['時段完成', state.schedule.filter((x) => x.done).length + '/' + schedules.length]];
  // 2026-10-15 Jacky：進度條自動抓系統資料（今天、這位顧問），再加上表格手填的，不用重複填
  const t = todayStr(); const nowHM = new Date().toTimeString().slice(0, 5);
  const today = (v) => String(v || '').slice(0, 10) === t;
  const S = {
    newBd: sys.bd.filter((r) => today(r.first_created_at)).length,
    touchBd: sys.bd.filter((r) => today(r.last_call_at) || today(r.contacted_at)).length,
    talkBd: sys.bd.filter((r) => today(r.last_call_at) && ['interested', 'got_contact', 'got_email'].includes(r.last_call_result)).length,
    newCand: sys.cands.filter((x) => today(x.updatedAt)).length,
    touchCand: (sys.calls || []).filter((x) => today(x.call_at)).length,
    talkCand: (sys.calls || []).filter((x) => today(x.call_at) && String(x.call_at).slice(11, 16) <= nowHM).length,
    posts: (sys.posts || []).filter((p) => p.consultant_name === consultantName() && today(p.posted_at || p.social_post_at)).length,
  };
  const goals = [['新增企業名單', bd.length, 15, S.newBd], ['企業實際接觸', vals[1][1], 10, S.touchBd], ['有效企業對話', vals[2][1], 3, S.talkBd], ['人才名單', c.length, 15, S.newCand], ['人才接觸', vals[5][1], 10, S.touchCand], ['人才洽談', vals[6][1], 2, S.talkCand], ['渠道動作', ch.length, 2, S.posts]]
    .map(([n, manual, g, s]) => [n, manual + s, g, s, manual]);
  const pending = [...bd.filter((x) => x.nextDate && x.nextDate <= day).map((x) => '🏢 ' + (x.company || '未命名企業') + '｜' + (x.next || '待跟進')), ...c.filter((x) => x.nextDate && x.nextDate <= day).map((x) => '👤 ' + (x.name || '未命名人選') + '｜' + (x.next || '待跟進'))];
  const sysDue = sysBdRows().filter((r) => r._overdue).map((r) => '🏢 ' + r.company + '｜' + (r.next_step || '待跟進') + (r._due ? '（' + r._due + '）' : ''));
  const sysCard = sys.owner ? `<div class="card"><h2>系統資料｜${esc(consultantName())}</h2><div class="dly-grid">${sysSummary().map(([n, v]) => `<div class="card" style="margin:0"><div class="dly-small">${esc(n)}</div><div class="dly-metric">${esc(v)}</div></div>`).join('')}</div><p class="dly-hint">這些數字直接來自顧問後台（開發進度、人選工作台），不是手動填的。下面的「今日漏斗與目標」是你自己記的表格。</p></div>` : '';
  return `<div data-daily-live></div>${sysCard}<div class="dly-grid">${vals.map(([n, v]) => `<div class="card"><div class="dly-small">${esc(n)}</div><div class="dly-metric">${esc(v)}</div></div>`).join('')}</div>
  <div class="card"><h2>今日漏斗與目標</h2>${sys.owner ? '' : '<p class="dly-hint">先在上面選「我是哪位顧問」，進度條才會自動抓你今天的系統資料。</p>'}${goals.map(([n, v, g, s, m]) => `<div style="margin:12px 0"><div class="dly-row"><b>${esc(n)}</b><span class="dly-right dly-small">${v} / ${g}　<span style="color:#586a77">（系統 ${s}＋手填 ${m}）</span></span></div><div class="dly-progress"><div style="width:${Math.min(100, v / g * 100)}%"></div></div></div>`).join('')}</div>
  <div class="card"><h2>今日下一步</h2>${sysDue.length ? `<p class="dly-small">系統：到期或逾期的開發跟進</p>${sysDue.map((x) => `<p>• ${esc(x)}</p>`).join('')}` : ''}${pending.length ? pending.map((x) => `<p>• ${esc(x)}</p>`).join('') : (sysDue.length ? '' : '<p class="dly-hint">沒有已登錄的當日到期跟進事項。請確認每筆有效對話都設定下一步日期。</p>')}</div>
  <p class="dly-hint">數字為起始管理目標，不代表保證轉換率；每週依實際數據調整。有效對話需有雙向互動及具體資訊，不能把未接通計入。</p>`;
}
function sectionSchedule() {
  return `<div class="card"><h2>09:00–20:00 時段任務</h2><div class="dly-scroll"><table class="dly-table"><thead><tr><th>完成</th><th>時間</th><th>工作</th><th>交付成果／檢查點</th><th>備註</th></tr></thead><tbody>${schedules.map((r, i) => `<tr><td><input type="checkbox" data-sdone="${i}" ${state.schedule[i] && state.schedule[i].done ? 'checked' : ''}></td><td><b>${esc(r[0])}</b></td><td>${esc(r[1])}</td><td>${esc(r[2])}</td><td><input placeholder="成果或備註" data-snote="${i}" value="${esc(state.schedule[i] && state.schedule[i].note)}"></td></tr>`).join('')}</tbody></table></div></div>`;
}
const TABLE_META = {
  bd: ['104 後台 → 企業開發紀錄', '＋新增企業', '建議 A 級優先：多職缺、急缺、專業稀缺、反覆刊登、薪資合理；刊登時間長僅是線索，不代表企業必然招募困難。'],
  candidate: ['人才搜尋與洽談紀錄', '＋新增人選', '只紀錄必要的工作資訊；避免在本地 HTML 放置身分證、完整履歷、敏感個資。對外推薦前確認人選同意。'],
  channel: ['職缺發布渠道實驗', '＋新增渠道', '']
};
function sysTableBd() {
  if (!sys.owner) return '<div class="card"><h2>系統資料：開發進度</h2><p class="dly-hint">請先在上面選顧問。</p></div>';
  const rows = sysBdRows();
  return `<div class="card"><div class="dly-row"><h2>系統資料：${esc(consultantName())} 的開發進度 <span class="dly-small">${rows.length} 家</span></h2><button class="btn primary dly-right" data-dly="importBd">全部匯入我的表格（略過已有的公司）</button></div>
  <p class="dly-hint">直接來自顧問後台「客戶 / BD → 開發進度」。依下次跟進日排序，到期或逾期的標紅。<b>點任何一列，就會開出該公司的開發卡片。</b></p>
  <div class="dly-scroll"><table class="dly-table"><thead><tr><th>公司</th><th>階段</th><th>標籤</th><th>窗口</th><th>電話</th><th>下次跟進</th><th>下一步</th><th>最近通話</th></tr></thead><tbody>${rows.map((r) => `<tr data-bd-company="${esc(r.company)}" style="cursor:pointer"><td><b>${esc(r.company)}</b></td><td>${esc(r.bd_stage || '')}</td><td>${esc(r.tag || '')}</td><td>${esc(r.hr_contact || r.contact_name || '')}</td><td>${esc(r.call_phone || r.company_phone || '')}</td><td class="${r._overdue ? 'dly-danger' : ''}">${esc(r._due)}</td><td>${esc(r.next_step || '')}</td><td>${esc(String(r.last_call_at || '').slice(0, 16))}</td></tr>`).join('') || '<tr><td colspan="8" class="dly-hint">這位顧問目前沒有開發進度的公司。</td></tr>'}</tbody></table></div></div>`;
}
function routeTag(c) { return c.routeCode ? `<span class="badge info" title="阿財分流">${esc(c.routeCode)} ${esc(c.routeLabel || '')}</span>` : ''; }
function sysTableCand() {
  if (!sys.owner) return '<div class="card"><h2>系統資料：人選</h2><p class="dly-hint">請先在上面選顧問。</p></div>';
  const rows = sys.cands;
  return `<div class="card"><div class="dly-row"><h2>系統資料：${esc(consultantName())} 名下的人選 <span class="dly-small">${rows.length} 位</span></h2><button class="btn primary dly-right" data-dly="importCand">全部匯入我的表格（略過已有的編號）</button></div>
  <p class="dly-hint">直接來自顧問後台「人選」工作台，階段是後台正式的分頁階段。<b>點任何一列，就會開出該人選的卡片。</b></p>
  <div class="dly-scroll"><table class="dly-table"><thead><tr><th>人選</th><th>應徵職缺</th><th>推薦給</th><th>目前階段</th><th>阿財分流</th><th>聯絡方式</th><th>期望待遇</th><th>進件時間</th></tr></thead><tbody>${rows.map((c) => {
    const placeholder = c.email && /@no-email\.step1ne\.local$/i.test(String(c.email).trim());
    const contact = [c.phone, (c.email && !placeholder) ? c.email : null].filter(Boolean).join(' · ') || '未留聯絡方式';
    const bound = c.clientName && c.clientName !== '（未綁客戶）';
    return `<tr data-application="${esc(c.applicationId)}" style="cursor:pointer"><td><small class="dly-small">${c.seqNo ? '#' + esc(c.seqNo) : ''}</small> <b>${esc(c.name)}</b>${c.lineBound ? ' <span class="badge success">LINE</span>' : ''}</td><td>${esc(c.job)}</td><td>${bound ? esc(c.clientName) : '—'}</td><td>${statusBadge(c.stage)}</td><td>${routeTag(c)}</td><td>${esc(contact)}</td><td>${esc(c.expected || '')}</td><td>${esc(String(c.updatedAt || '').slice(0, 16))}</td></tr>`;
  }).join('') || '<tr><td colspan="8" class="dly-hint">這位顧問名下目前沒有人選。</td></tr>'}</tbody></table></div></div>`;
}
const num0 = (v) => Number(v) || 0;
const nShow = (v) => (v === null || v === undefined || v === '' ? '' : v);
function chAggregate(list) {
  const m = new Map();
  list.forEach((p) => {
    const k = p.account_label || '(未命名帳號)';
    if (!m.has(k)) m.set(k, { account: k, consultant: p.consultant_name || '', platform: p.account_platform || '', posts: 0, views: 0, likes: 0, replies: 0, clicks: 0, line: 0, apps: 0, dm: 0, talk: 0, submit: 0 });
    const a = m.get(k);
    a.posts += 1; a.views += num0(p.views); a.likes += num0(p.likes); a.replies += num0(p.replies); a.clicks += num0(p.clicks); a.line += num0(p.line_adds); a.apps += num0(p.applicants_attributed); a.dm += num0(p.dm_contacts); a.talk += num0(p.valid_inquiries); a.submit += num0(p.submitted_candidates);
  });
  return [...m.values()].sort((x, y) => y.views - x.views);
}
function sysTableCh() {
  const accounts = [...new Set(sys.posts.map((p) => p.account_label).filter(Boolean))];
  const names = [...new Set(sys.posts.map((p) => p.consultant_name).filter(Boolean))];
  const st = sys.postsErr ? `<span class="dly-danger">讀取失敗：${esc(sys.postsErr)}</span>` : sys.postsAt ? `已載入 ${esc(sys.postsAt)}` : '讀取中…';
  const switcher = `<div class="dly-row" style="margin-bottom:10px"><div class="tabs dly-subtabs"><button class="${sys.chView === 'overview' ? 'active' : ''}" data-dly="chView:overview">📊 總覽（各帳號比較）</button><button class="${sys.chView === 'detail' ? 'active' : ''}" data-dly="chView:detail">🔎 帳號細項（逐則貼文）</button></div><button class="btn" data-dly="postsRefresh">重新讀取</button><span class="dly-hint">${st}</span></div>`;
  const note = `<p class="dly-hint">渠道追蹤是全公司的，<b>不會因為上面選的顧問而被限制</b>（後台只回傳最近 30 則已發出的貼文）。曝光、按讚、留言是社群平台抓回來的；點擊、LINE 導入、應徵是系統用追蹤連結算的；私訊、有效洽談、送件是各顧問在「社群」那邊手動填的，沒填就空白。</p>`;
  if (sys.chView === 'overview') {
    const agg = chAggregate(sys.posts.filter((p) => !sys.chFilter || p.consultant_name === sys.chFilter));
    const tot = agg.reduce((t, a) => { Object.keys(a).forEach((k) => { if (typeof a[k] === 'number') t[k] = (t[k] || 0) + a[k]; }); return t; }, {});
    const filt = `<div class="dly-field" style="margin-bottom:8px"><label>只看哪位顧問的帳號</label><select id="dly-chFilter"><option value="">全部顧問</option>${names.map((x) => `<option value="${esc(x)}" ${x === sys.chFilter ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></div>`;
    return `<div class="card"><h2>系統資料：社群渠道總覽 <span class="dly-small">${agg.length} 個帳號、${tot.posts || 0} 則貼文</span></h2>${switcher}${note}${filt}
    <div class="dly-scroll"><table class="dly-table"><thead><tr><th>帳號</th><th>顧問</th><th>平台</th><th>貼文數</th><th>曝光</th><th>平均曝光</th><th>讚</th><th>留言</th><th>點擊</th><th>LINE 導入</th><th>應徵（系統歸因）</th><th>私訊</th><th>有效洽談</th><th>送件</th></tr></thead><tbody>${agg.map((a) => `<tr data-dly="chAcct:${esc(a.account)}" style="cursor:pointer" title="點一下看這個帳號的逐則貼文"><td><b>${esc(a.account)}</b></td><td>${esc(a.consultant)}</td><td>${esc(a.platform)}</td><td>${a.posts}</td><td>${a.views}</td><td>${a.posts ? Math.round(a.views / a.posts) : 0}</td><td>${a.likes}</td><td>${a.replies}</td><td>${a.clicks}</td><td>${a.line}</td><td>${a.apps}</td><td>${a.dm}</td><td>${a.talk}</td><td>${a.submit}</td></tr>`).join('') || '<tr><td colspan="14" class="dly-hint">目前沒有已發出的社群貼文。</td></tr>'}${agg.length ? `<tr style="font-weight:700"><td>合計</td><td></td><td></td><td>${tot.posts}</td><td>${tot.views}</td><td>${tot.posts ? Math.round(tot.views / tot.posts) : 0}</td><td>${tot.likes}</td><td>${tot.replies}</td><td>${tot.clicks}</td><td>${tot.line}</td><td>${tot.apps}</td><td>${tot.dm}</td><td>${tot.talk}</td><td>${tot.submit}</td></tr>` : ''}</tbody></table></div>
    <p class="dly-hint"><b>點任何一個帳號，就會切到這個帳號的逐則貼文。</b></p></div>`;
  }
  const rows = postsShown();
  const selAcc = `<div class="dly-field"><label>帳號</label><select id="dly-chAccount"><option value="">全部帳號</option>${accounts.map((x) => `<option value="${esc(x)}" ${x === sys.chAccount ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></div>`;
  const selCon = `<div class="dly-field"><label>顧問</label><select id="dly-chFilter"><option value="">全部顧問</option>${names.map((x) => `<option value="${esc(x)}" ${x === sys.chFilter ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></div>`;
  return `<div class="card"><h2>系統資料：帳號細項（逐則貼文） <span class="dly-small">${rows.length} 則</span></h2>${switcher}${note}<div class="dly-row" style="margin-bottom:8px">${selAcc}${selCon}<button class="btn primary dly-right" data-dly="importCh">把這些貼文匯入我的表格（略過已有的）</button></div>
  <div class="dly-scroll"><table class="dly-table"><thead><tr><th>顧問</th><th>職缺</th><th>平台／帳號</th><th>發布時間</th><th>曝光</th><th>讚</th><th>留言</th><th>點擊</th><th>LINE 導入</th><th>應徵（系統歸因）</th><th>私訊</th><th>有效洽談</th><th>送件</th><th>貼文風格</th></tr></thead><tbody>${rows.map((p) => `<tr ${p.social_post_url ? `data-dly="openPost:${esc(p.queue_id)}" style="cursor:pointer"` : ''}><td>${esc(p.consultant_name)}</td><td><b>${esc(p.title)}</b></td><td>${esc(p.account_platform)}｜${esc(p.account_label)}</td><td>${esc(String(p.posted_at || p.social_post_at || '').slice(0, 16))}</td><td>${esc(nShow(p.views))}</td><td>${esc(nShow(p.likes))}</td><td>${esc(nShow(p.replies))}</td><td>${esc(nShow(p.clicks))}</td><td>${esc(nShow(p.line_adds))}</td><td>${esc(nShow(p.applicants_attributed))}</td><td>${esc(nShow(p.dm_contacts))}</td><td>${esc(nShow(p.valid_inquiries))}</td><td>${esc(nShow(p.submitted_candidates))}</td><td>${esc(p.style_name || '')}</td></tr>`).join('') || '<tr><td colspan="14" class="dly-hint">這個條件下沒有已發出的貼文。</td></tr>'}</tbody></table></div><p class="dly-hint"><b>點任何一列會開出那則貼文。</b></p></div>`;
}
function importCh() {
  const key = (p) => String(p.title || '') + '|' + String(p.posted_at || '').slice(0, 10) + '|' + String(p.account_label || '');
  const have = new Set(state.channel.map((x) => (x.job || '') + '|' + (x.date || '') + '|' + ((x.platform || '').split('｜')[1] || '')));
  let n = 0;
  postsShown().forEach((p) => {
    if (have.has(key(p))) return;
    const num = (v) => (Number(v) > 0 ? String(Number(v)) : '');
    state.channel.push({ job: p.title || '', platform: (p.account_platform || '') + '｜' + (p.account_label || ''), date: String(p.posted_at || '').slice(0, 10), views: num(p.views), dm: num(p.dm_contacts), line: num(p.line_adds), talk: num(p.valid_inquiries), submit: num(p.submitted_candidates), next: p.style_name ? '這則風格：' + p.style_name : '' });
    n += 1;
  });
  return n;
}
function importBd() {
  const have = new Set(state.bd.map((x) => (x.company || '').trim()));
  let n = 0;
  sysBdRows().forEach((r) => {
    if (have.has(r.company)) return;
    state.bd.push({ company: r.company, job: r.job_title || r.topic || '', priority: r.tag === 'HOT' ? 'A' : r.tag === 'WARM' ? 'B' : 'C', contact: r.hr_contact || r.contact_name || '', method: r.call_phone || r.company_phone || '', stage: BD_STAGE_MAP[r.bd_stage] || (r.contacted_at ? '已接觸' : '待聯繫'), pain: r.topic || '', nextDate: r._due || '', next: r.next_step || '' });
    n += 1;
  });
  return n;
}
function importCand() {
  const have = new Set(state.candidate.map((x) => (x.name || '').trim().split(' ')[0]));
  let n = 0;
  sys.cands.forEach((c) => {
    const code = 'S-' + String(c.seqNo || '').padStart(3, '0');
    if (have.has(code)) return;
    state.candidate.push({ name: code + ' ' + (c.name || ''), job: c.job || '', source: c.source || '', contact: '', stage: CAND_STAGE_MAP[c.stage] || '已洽談', notes: c.expected || '', nextDate: '', next: '' });
    n += 1;
  });
  return n;
}
// 2026-10-15 Jacky：企業 BD／人才追蹤可以切「表格」或「看板」（看板＝進度看板，同一套資料與拖拉）
const VIEW_KEY = (t) => 'dly_view_' + t;
function viewOf(type) { try { return localStorage.getItem(VIEW_KEY(type)) === 'board' ? 'board' : 'table'; } catch { return 'table'; } }
function viewSwitch(type) {
  const v = viewOf(type);
  return `<div class="dly-viewsw" role="tablist" aria-label="顯示方式"><button type="button" role="tab" aria-selected="${v === 'table'}" class="${v === 'table' ? 'on' : ''}" data-dly="view:${type}:table">表格</button><button type="button" role="tab" aria-selected="${v === 'board'}" class="${v === 'board' ? 'on' : ''}" data-dly="view:${type}:board">看板</button></div>`;
}
function mountBoards(root) {
  root.querySelectorAll('[data-daily-live]').forEach((el) => {
    if (el.dataset.mounted) return; el.dataset.mounted = '1';
    window.dispatchEvent(new CustomEvent('step1ne:daily-live', { detail: { target: el } }));
  });
  root.querySelectorAll('[data-daily-board]').forEach((el) => {
    if (el.dataset.mounted) return; el.dataset.mounted = '1';
    window.dispatchEvent(new CustomEvent('step1ne:daily-board', { detail: { target: el, kind: el.getAttribute('data-daily-board') } }));
  });
}
function sectionTable(type) {
  if ((type === 'bd' || type === 'candidate') && viewOf(type) === 'board') {
    return `${viewSwitch(type)}<div class="dly-board" data-daily-board="${type === 'bd' ? 'client' : 'cand'}"></div>`;
  }
  const [title, addLabel, hint] = TABLE_META[type];
  const cols = schemas[type];
  const rows = state[type].map((row, i) => `<tr>${cols.map(([k, label, kind]) => `<td>${kind && kind.includes('|')
    ? `<select data-t="${type}" data-i="${i}" data-k="${k}">${kind.split('|').map((v) => `<option ${row[k] === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>`
    : `<input type="${kind === 'date' ? 'date' : kind === 'number' ? 'number' : 'text'}" ${kind === 'number' ? 'min="0"' : ''} placeholder="${esc(label)}" value="${esc(row[k])}" data-t="${type}" data-i="${i}" data-k="${k}">`}</td>`).join('')}<td><button class="btn dly-danger" data-dly="rm:${type}:${i}">刪除</button></td></tr>`).join('')
    || `<tr><td colspan="${cols.length + 1}" class="dly-hint">尚無資料，請點「新增」。</td></tr>`;
  const extra = type === 'channel' ? '<div class="card"><h3>渠道判斷速查</h3><p>新鮮人：Threads／IG／校園；在地工程：地方社團／專業社群；財會：同業人才地圖／LinkedIn／財會社群；中高階：競業 Mapping／LinkedIn／轉介紹；日本：在日社群／LinkedIn／日本職涯平台。先確認各平台規範及是否允許招募貼文。</p></div>' : '';
  const sysBlock = type === 'bd' ? sysTableBd() : type === 'candidate' ? sysTableCand() : type === 'channel' ? sysTableCh() : '';
  return `${(type === 'bd' || type === 'candidate') ? viewSwitch(type) : ''}${sysBlock}<div class="card"><div class="dly-row"><h2>${esc(title)}</h2><button class="btn primary dly-right" data-dly="add:${type}">${addLabel}</button><button class="btn" data-dly="csv:${type}">匯出 CSV</button></div>${hint ? `<p class="dly-hint">${esc(hint)}</p>` : ''}<div class="dly-scroll"><table class="dly-table"><thead><tr>${cols.map((c) => `<th>${esc(c[1])}</th>`).join('')}<th>操作</th></tr></thead><tbody>${rows}</tbody></table></div></div>${extra}`;
}
function sectionScripts() {
  const s = scripts[scriptIdx];
  return `<div class="card"><h2>各階段聯繫話術｜可直接複製</h2><div class="dly-row"><div class="dly-field"><label>選擇情境</label><select id="dly-scriptSelect">${scripts.map((x, i) => `<option value="${i}" ${i === scriptIdx ? 'selected' : ''}>${esc(x[0])}</option>`).join('')}</select></div><button class="btn primary" data-dly="copyScript">複製話術</button></div><p class="dly-hint" id="dly-scriptTip">${esc(s[2])}</p><div id="dly-scriptText" class="dly-script">${esc(s[1])}</div></div>
  <div class="card"><h3>話術原則</h3><p>先確認現況，再探索招募阻礙，最後提出下一步；不要宣稱已有合適人選，除非確實有且已取得必要同意。企業拒絕時保留尊重，不施壓。候選人接觸時說明職缺來源與保密原則。</p></div>`;
}
function sectionReview() {
  return `<div class="card"><h2>每日 19:20–20:00 收盤</h2><div class="dly-fields">
  <div class="dly-field"><label>今日最有價值的企業對話</label><textarea id="dly-reviewBd">${esc(state.reviewBd)}</textarea></div>
  <div class="dly-field"><label>人才突破與卡點</label><textarea id="dly-reviewTalent">${esc(state.reviewTalent)}</textarea></div>
  <div class="dly-field"><label>明日優先 3 件事</label><textarea id="dly-reviewTomorrow">${esc(state.reviewTomorrow)}</textarea></div>
  <div class="dly-field"><label>需要老闆／客戶決策的問題</label><textarea id="dly-reviewBlock">${esc(state.reviewBlock)}</textarea></div></div>
  <div class="dly-row" style="margin-top:12px"><button class="btn primary" data-dly="save">儲存檢討</button><button class="btn" data-dly="exportSummary">匯出今日摘要 TXT</button></div></div>`;
}
const SECTIONS = { overview: sectionOverview, schedule: sectionSchedule, bd: () => sectionTable('bd'), candidate: () => sectionTable('candidate'), channel: () => sectionTable('channel'), scripts: sectionScripts, review: sectionReview };

function draw(root) {
  root.innerHTML = `<div class="dly">${toolbar()}${(SECTIONS[currentTab] || sectionOverview)()}</div>`;
  mountBoards(root);
}
function exportCSV(type) {
  const heads = schemas[type].map((x) => x[1]);
  const rows = state[type].map((r) => schemas[type].map((x) => r[x[0]] || ''));
  download(type + '_' + day + '.csv', '﻿' + [heads, ...rows].map((r) => r.map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\r\n'), 'text/csv;charset=utf-8');
}
function exportSummary(root) {
  collect(root); persist();
  const lines = ['獵頭每日工作摘要｜' + day, 'Top 3：' + state.top3, '', '企業名單：' + state.bd.length, '人才名單：' + state.candidate.length, '渠道數：' + state.channel.length, '', '今日企業對話：' + state.reviewBd, '人才突破：' + state.reviewTalent, '明日 Top 3：' + state.reviewTomorrow, '待決策：' + state.reviewBlock];
  download('每日摘要_' + day + '.txt', lines.join('\n'), 'text/plain;charset=utf-8');
}

export const DAILY_TABS = [['overview', '📊 總覽'], ['schedule', '🕘 每日行程'], ['bd', '🏢 企業 BD'], ['candidate', '👤 人才追蹤'], ['channel', '📣 渠道追蹤'], ['scripts', '💬 分階段話術'], ['review', '📝 收盤檢討']];

export async function loadDailyTab(target, tab) {
  currentTab = TABS.includes(tab) ? tab : 'overview';
  if (!state) load();
  await loadConsultants();
  if (!target.isConnected) return;
  if (!boundUnload) { boundUnload = true; window.addEventListener('beforeunload', () => { const r = document.querySelector('.dly'); if (r && state) { collect(r); persist(); } }); }
  draw(target);
  if (!sys.postsAt && (currentTab === 'channel' || currentTab === 'overview')) { loadPosts(false).then(() => { if (target.isConnected) { collect(target.querySelector('.dly')); draw(target); } }); }
  if (sys.owner && (!sys.at || sys.loadedFor !== sys.owner)) { sys.loading = true; draw(target); loadSystem(false).then(() => { if (target.isConnected) { collect(target.querySelector('.dly')); draw(target); } }); }
  const root = () => target.querySelector('.dly');
  const refresh = () => { collect(root()); persist(); draw(target); };
  target.oninput = (e) => {
    const t = e.target;
    if (t.dataset && t.dataset.snote !== undefined) { state.schedule[t.dataset.snote].note = t.value; persist(); }
    else if (t.dataset && t.dataset.t) { state[t.dataset.t][t.dataset.i][t.dataset.k] = t.value; persist(); }
    else if (t.id === 'dly-top3' || (t.id || '').startsWith('dly-review')) { collect(root()); persist(); }
  };
  target.onchange = (e) => {
    const t = e.target;
    if (t.id === 'dly-chAccount') { sys.chAccount = t.value; collect(root()); draw(target); return; }
    if (t.id === 'dly-chFilter') { sys.chFilter = t.value; collect(root()); draw(target); return; }
    if (t.id === 'dly-owner') {
      sys.owner = t.value; try { localStorage.setItem(OWNER_KEY, sys.owner); } catch { /* 沒關係 */ }
      sys.at = ''; sys.loadedFor = ''; sys.bd = []; sys.cands = []; sys.calls = []; collect(root()); persist(); draw(target);
      if (sys.owner) { sys.loading = true; draw(target); loadSystem(true).then(() => { if (target.isConnected) draw(target); }); }
      return;
    }
    if (t.id === 'dly-day') { collect(root()); persist(); day = t.value || day; load(); draw(target); return; }
    if (t.dataset && t.dataset.sdone !== undefined) { state.schedule[t.dataset.sdone].done = t.checked; persist(); return; }
    if (t.dataset && t.dataset.t && t.tagName === 'SELECT') { state[t.dataset.t][t.dataset.i][t.dataset.k] = t.value; persist(); return; }
    if (t.id === 'dly-scriptSelect') { scriptIdx = Number(t.value); const s = scripts[scriptIdx]; target.querySelector('#dly-scriptText').textContent = s[1]; target.querySelector('#dly-scriptTip').textContent = s[2]; return; }
    if (t.id === 'dly-import') {
      const f = t.files && t.files[0]; if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const o = JSON.parse(reader.result);
          if (!o.state || !o.date) throw Error('格式錯誤');
          day = o.date; state = { ...fresh(), ...o.state }; persist(); draw(target); alert('匯入完成');
        } catch (err) { alert('匯入失敗：' + err.message); }
      };
      reader.readAsText(f);
    }
  };
  target.onclick = (e) => {
    const b = e.target.closest('[data-dly]'); if (!b) return;
    const [act, type, idx] = b.getAttribute('data-dly').split(':');
    if (act === 'view') { try { localStorage.setItem(VIEW_KEY(type), idx); } catch { /* 沒關係 */ } collect(root()); persist(); draw(target); return; }
    if (act === 'save') { collect(root()); persist(); b.textContent = '已儲存 ✓'; setTimeout(() => { b.textContent = tab === 'review' ? '儲存檢討' : '儲存今天'; }, 1200); return; }
    if (act === 'exportJSON') { collect(root()); persist(); download('獵頭儀表板_' + day + '.json', JSON.stringify({ date: day, state }, null, 2), 'application/json'); return; }
    if (act === 'importPick') { target.querySelector('#dly-import').click(); return; }
    if (act === 'sysRefresh') { sys.loading = true; collect(root()); draw(target); loadSystem(true).then(() => { if (target.isConnected) draw(target); }); return; }
    if (act === 'importBd') { const n = importBd(); persist(); draw(target); alert('已匯入 ' + n + ' 家'); return; }
    if (act === 'bookCall') {
      const who = (target.querySelector('#dly-bk-who').value || '').trim(), at = target.querySelector('#dly-bk-at').value, msg = target.querySelector('#dly-bk-msg');
      if (!who) { msg.textContent = '請填人選或對象'; return; }
      const c = sys.cands.find((x) => ((x.seqNo ? '#' + x.seqNo + ' ' : '') + x.name) === who || x.name === who);
      msg.textContent = '儲存中…';
      api.post('/admin/consultant-reminders', { for: consultantName(), application_id: c ? c.applicationId : '', candidate_name: c ? c.name : who, call_at: at, note: target.querySelector('#dly-bk-note').value, remind_before: Number(target.querySelector('#dly-bk-before').value) })
        .then((r) => { sys.bookOpen = false; sys.at = ''; loadSystem(true).then(() => { if (target.isConnected) { collect(root()); draw(target); const m = target.querySelector('.dly-today .dly-hint'); alert('已記下：' + (r.call_at || at) + '，會在 ' + (r.remind_at || '') + ' 用 TG 提醒你'); } }); })
        .catch((err) => { msg.textContent = '失敗：' + ((err && err.message) || '請稍後再試'); });
      return;
    }
    if (act === 'cancelCall') {
      if (!confirm('取消這筆預約與提醒？')) return;
      api.post('/admin/consultant-reminders/cancel', { id: type, by: consultantName() }).then(() => { sys.at = ''; loadSystem(true).then(() => { if (target.isConnected) { collect(root()); draw(target); } }); }).catch(() => alert('取消失敗'));
      return;
    }
    if (act === 'seenReply') { state.seenReply = state.seenReply || {}; state.seenReply[type] = 1; persist(); collect(root()); draw(target); return; }
    if (act === 'doneItem') { const k = decodeURIComponent(type || ''); state.done = state.done || {}; if (state.done[k]) { delete state.done[k]; if (sys.lastDoneK === k) sys.lastDoneK = ''; } else { state.done[k] = new Date().toISOString().slice(11, 16); sys.lastDoneK = k; } persist(); collect(root()); draw(target); return; }
    if (act === 'todayMore') { sys.todayAll = !sys.todayAll; collect(root()); draw(target); return; }
    if (act === 'chView') { sys.chView = type; collect(root()); draw(target); return; }
    if (act === 'chAcct') { sys.chAccount = b.getAttribute('data-dly').slice('chAcct:'.length); sys.chView = 'detail'; collect(root()); draw(target); return; }
    if (act === 'postsRefresh') { sys.postsAt = ''; draw(target); loadPosts(true).then(() => { if (target.isConnected) draw(target); }); return; }
    if (act === 'importCh') { const n = importCh(); persist(); draw(target); alert('已匯入 ' + n + ' 則'); return; }
    if (act === 'openPost') { const p = sys.posts.find((x) => String(x.queue_id) === String(type)); if (p && p.social_post_url) window.open(p.social_post_url, '_blank', 'noopener'); return; }
    if (act === 'importCand') { const n = importCand(); persist(); draw(target); alert('已匯入 ' + n + ' 位'); return; }
    if (act === 'add') { state[type].push({}); refresh(); return; }
    if (act === 'rm') { if (!confirm('確定刪除此筆紀錄？')) return; state[type].splice(Number(idx), 1); refresh(); return; }
    if (act === 'csv') { exportCSV(type); return; }
    if (act === 'copyScript') { const txt = target.querySelector('#dly-scriptText').textContent; (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => alert('已複製')).catch(() => prompt('請複製以下話術', txt)); return; }
    if (act === 'exportSummary') { exportSummary(root()); }
  };
}
