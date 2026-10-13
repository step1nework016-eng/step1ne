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
let sys = { owner: localStorage.getItem(OWNER_KEY) || '', loading: false, error: '', bd: [], cands: [], at: '' };
const BD_STAGE_MAP = { '還沒聯繫': '待聯繫', '已聯繫': '已接觸', '有興趣': '有效對話', '已寄資料': '寄送資料', '談需求': '需求訪談已約', '簽約': '正式委託', '沒興趣': '停止開發', '暫緩': '暫不需要' };
const CAND_STAGE_MAP = { client: '已送件', interviewed: '已洽談', new: '名單建立' };
const todayStr = () => new Date().toLocaleDateString('en-CA');
const consultantName = () => { const c = (consultants || []).find((x) => x.id === sys.owner); return c ? c.display_name : ''; };
async function loadConsultants() {
  if (consultants) return consultants;
  try { consultants = (await api.get('/admin/consultants')).consultants || []; } catch { consultants = []; }
  consultants = consultants.filter((c) => c.is_active);
  if (!sys.owner && consultants.length === 1) sys.owner = consultants[0].id;
  return consultants;
}
async function loadSystem(force) {
  if (!sys.owner) { sys.bd = []; sys.cands = []; sys.error = ''; return; }
  if (!force && sys.at && sys.loadedFor === sys.owner) return;
  sys.loading = true; sys.error = '';
  try {
    const name = consultantName();
    const [b, c] = await Promise.all([api.get('/admin/bd/dashboard'), adapters.candidates(sys.owner)]);
    sys.bd = (b.rows || []).filter((r) => r.assigned_to === name && !r.ai_untouched);
    sys.cands = c || [];
    sys.at = new Date().toLocaleTimeString('zh-TW', { hour12: false }); sys.loadedFor = sys.owner;
  } catch (e) { sys.error = (e && e.message) || '讀取失敗'; }
  sys.loading = false;
}
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
  return [['開發進度公司', sys.bd.length], ['今天有通話紀錄', calledToday], ['今天寄過信', mailedToday], ['到期／逾期跟進', due], ['HOT／WARM 公司', hot], ['名下人選', sys.cands.length], ['今天新進人選', newCand]];
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

function toolbar() {
  return sysBar() + `<div class="card dly-row"><div class="dly-field"><label>工作日期</label><input id="dly-day" type="date" value="${esc(day)}"></div>
  <div class="dly-field"><label>今日 Top 3 職缺（以 / 分隔）</label><input id="dly-top3" style="min-width:290px" placeholder="會計 / BIM / 營運主管" value="${esc(state.top3)}"></div>
  <button class="btn primary" data-dly="save">儲存今天</button><button class="btn" data-dly="exportJSON">匯出 JSON 備份</button>
  <button class="btn" data-dly="importPick">匯入備份</button><input id="dly-import" type="file" accept=".json" hidden>
  <span class="dly-hint">資料存在此瀏覽器；換裝置前請匯出備份。</span></div>`;
}
function sectionOverview() {
  const bd = state.bd, c = state.candidate, ch = state.channel;
  const vals = [['104 企業名單', bd.length], ['企業已接觸', count('bd', (x) => x.stage && !['待篩選', '待聯繫'].includes(x.stage))], ['有效企業對話', count('bd', (x) => ['有效對話', '需求訪談已約', '寄送資料', '談合約', '正式委託'].includes(x.stage))], ['已約需求訪談', count('bd', (x) => x.stage === '需求訪談已約')], ['人才名單', c.length], ['已接觸人才', count('candidate', (x) => x.stage && x.stage !== '名單建立')], ['已洽談人才', count('candidate', (x) => ['已洽談', '合格待同意', '已同意推薦', '已送件', '客戶面試', 'Offer', '到職'].includes(x.stage))], ['已送件人才', count('candidate', (x) => ['已送件', '客戶面試', 'Offer', '到職'].includes(x.stage))], ['渠道實驗', ch.length], ['時段完成', state.schedule.filter((x) => x.done).length + '/' + schedules.length]];
  const goals = [['新增企業名單', bd.length, 15], ['企業實際接觸', vals[1][1], 10], ['有效企業對話', vals[2][1], 3], ['人才名單', c.length, 15], ['人才接觸', vals[5][1], 10], ['人才洽談', vals[6][1], 2], ['渠道動作', ch.length, 2]];
  const pending = [...bd.filter((x) => x.nextDate && x.nextDate <= day).map((x) => '🏢 ' + (x.company || '未命名企業') + '｜' + (x.next || '待跟進')), ...c.filter((x) => x.nextDate && x.nextDate <= day).map((x) => '👤 ' + (x.name || '未命名人選') + '｜' + (x.next || '待跟進'))];
  const sysDue = sysBdRows().filter((r) => r._overdue).map((r) => '🏢 ' + r.company + '｜' + (r.next_step || '待跟進') + (r._due ? '（' + r._due + '）' : ''));
  const sysCard = sys.owner ? `<div class="card"><h2>系統資料｜${esc(consultantName())}</h2><div class="dly-grid">${sysSummary().map(([n, v]) => `<div class="card" style="margin:0"><div class="dly-small">${esc(n)}</div><div class="dly-metric">${esc(v)}</div></div>`).join('')}</div><p class="dly-hint">這些數字直接來自顧問後台（開發進度、人選工作台），不是手動填的。下面的「今日漏斗與目標」是你自己記的表格。</p></div>` : '';
  return `${sysCard}<div class="dly-grid">${vals.map(([n, v]) => `<div class="card"><div class="dly-small">${esc(n)}</div><div class="dly-metric">${esc(v)}</div></div>`).join('')}</div>
  <div class="card"><h2>今日漏斗與目標</h2>${goals.map(([n, v, g]) => `<div style="margin:12px 0"><div class="dly-row"><b>${esc(n)}</b><span class="dly-right dly-small">${v} / ${g}</span></div><div class="dly-progress"><div style="width:${Math.min(100, v / g * 100)}%"></div></div></div>`).join('')}</div>
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
function sectionTable(type) {
  const [title, addLabel, hint] = TABLE_META[type];
  const cols = schemas[type];
  const rows = state[type].map((row, i) => `<tr>${cols.map(([k, label, kind]) => `<td>${kind && kind.includes('|')
    ? `<select data-t="${type}" data-i="${i}" data-k="${k}">${kind.split('|').map((v) => `<option ${row[k] === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>`
    : `<input type="${kind === 'date' ? 'date' : kind === 'number' ? 'number' : 'text'}" ${kind === 'number' ? 'min="0"' : ''} placeholder="${esc(label)}" value="${esc(row[k])}" data-t="${type}" data-i="${i}" data-k="${k}">`}</td>`).join('')}<td><button class="btn dly-danger" data-dly="rm:${type}:${i}">刪除</button></td></tr>`).join('')
    || `<tr><td colspan="${cols.length + 1}" class="dly-hint">尚無資料，請點「新增」。</td></tr>`;
  const extra = type === 'channel' ? '<div class="card"><h3>渠道判斷速查</h3><p>新鮮人：Threads／IG／校園；在地工程：地方社團／專業社群；財會：同業人才地圖／LinkedIn／財會社群；中高階：競業 Mapping／LinkedIn／轉介紹；日本：在日社群／LinkedIn／日本職涯平台。先確認各平台規範及是否允許招募貼文。</p></div>' : '';
  const sysBlock = type === 'bd' ? sysTableBd() : type === 'candidate' ? sysTableCand() : '';
  return `${sysBlock}<div class="card"><div class="dly-row"><h2>${esc(title)}</h2><button class="btn primary dly-right" data-dly="add:${type}">${addLabel}</button><button class="btn" data-dly="csv:${type}">匯出 CSV</button></div>${hint ? `<p class="dly-hint">${esc(hint)}</p>` : ''}<div class="dly-scroll"><table class="dly-table"><thead><tr>${cols.map((c) => `<th>${esc(c[1])}</th>`).join('')}<th>操作</th></tr></thead><tbody>${rows}</tbody></table></div></div>${extra}`;
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
    if (t.id === 'dly-owner') {
      sys.owner = t.value; try { localStorage.setItem(OWNER_KEY, sys.owner); } catch { /* 沒關係 */ }
      sys.at = ''; sys.loadedFor = ''; sys.bd = []; sys.cands = []; collect(root()); persist(); draw(target);
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
    if (act === 'save') { collect(root()); persist(); b.textContent = '已儲存 ✓'; setTimeout(() => { b.textContent = tab === 'review' ? '儲存檢討' : '儲存今天'; }, 1200); return; }
    if (act === 'exportJSON') { collect(root()); persist(); download('獵頭儀表板_' + day + '.json', JSON.stringify({ date: day, state }, null, 2), 'application/json'); return; }
    if (act === 'importPick') { target.querySelector('#dly-import').click(); return; }
    if (act === 'sysRefresh') { sys.loading = true; collect(root()); draw(target); loadSystem(true).then(() => { if (target.isConnected) draw(target); }); return; }
    if (act === 'importBd') { const n = importBd(); persist(); draw(target); alert('已匯入 ' + n + ' 家'); return; }
    if (act === 'importCand') { const n = importCand(); persist(); draw(target); alert('已匯入 ' + n + ' 位'); return; }
    if (act === 'add') { state[type].push({}); refresh(); return; }
    if (act === 'rm') { if (!confirm('確定刪除此筆紀錄？')) return; state[type].splice(Number(idx), 1); refresh(); return; }
    if (act === 'csv') { exportCSV(type); return; }
    if (act === 'copyScript') { const txt = target.querySelector('#dly-scriptText').textContent; (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => alert('已複製')).catch(() => prompt('請複製以下話術', txt)); return; }
    if (act === 'exportSummary') { exportSummary(root()); }
  };
}
