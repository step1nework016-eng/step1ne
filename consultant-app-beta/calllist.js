// 2026-10-27 Jacky：電話名單（CALLLIST_V1）
// 兩頁共用同一套「一列一張卡」：
//   ・人選電話名單 /consultant/calllist/ ：名單存在 call_lists／call_list_items（後端 /admin/call-lists）
//     送出 → /admin/call-lists/<id>/result（附加一筆人選時間軸「電洽紀錄」，不跑 AI、不寄任何東西給人選）
//   ・公司開發名單 /consultant/bdcalls/ ：bd_outreach 某一批（後端 /admin/bd-batch-calls）
//     送出 → /admin/bd/log（跟「客戶/BD → 開發進度」卡片同一條路，pipeline 看板也讀得到）
// 每一列三步：①點狀態（只是選取，可改選）②備註可留空 ③按「送出」才真的存。
// 選了「再約時間」要先選日期時間；送出後另外登記 TG 提醒（/admin/consultant-reminders，跟顧問助理 remind 同一套）。
// 再送一次＝追加一筆，不覆蓋舊紀錄。選了／打了沒送出就換到別列 → 那列顯示「還沒送出」。
// 2026-11-06 Jacky：公司名單改一列式（客戶／上週做什麼／這週要做什麼／快速記錄），按結果一下就存；
// 沒意願的只在畫面上收到「已隱藏」，不動備選池、不停任何信或提醒。人選名單維持原本的卡片。
import { api, usageUserHeader } from './core/api.js';
import { toast } from './core/ui.js';
import { escapeHtml } from './core/security.js';
import { CONFIG } from './config.js';
import { fourLightsHtml, patchCallLight } from './fourlights.js';

const e = (v) => escapeHtml(v == null ? '' : String(v));
const ICON_PHONE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg>';
const REMIND_BEFORE = 30; // 分鐘，跟 /admin/consultant-reminders 預設一樣

const CAND = {
  kind: 'cand',
  results: [['interested', '有意願'], ['no_answer', '沒接'], ['not_interested', '沒興趣'], ['callback', '再約時間'], ['bad_number', '空號錯號']],
  tone: { interested: 'good', no_answer: 'mid', not_interested: 'bad', callback: 'info', bad_number: 'bad' },
};
const BD = {
  kind: 'bd',
  results: [['no_answer', '沒接'], ['interested', '有興趣'], ['send_info', '要資料'], ['not_interested', '沒意願'], ['callback', '再約時間']],
  tone: { interested: 'good', no_answer: 'mid', not_interested: 'bad', send_info: 'good', callback: 'info' },
};
// 開發進度卡片以前記的其他結果，讀回來時也認得
const BD_OLD = { gatekeeper: '被總機擋', got_contact: '問到窗口', got_email: '拿到信箱', not_hiring: '沒在徵人', other: '其他' };

const STAGE_ZH = { screening: '阿財初審', confirm: '顧問確認', stage1: '第一階段', stage2: '第二階段', stage3: '第三階段', stage4: '第四階段', offer: '錄取', onboard: '報到', care: '到職關懷', backup: '備選', closed: '結案' };
const STATUS_ZH = { new: '寄信待回應', interviewed: '阿財面談完', ready: '待顧問看', passed: '通過', pending_assessment: '待測驗', pending_screen: '待初審', rejected: '不適合', reported: '已出報告', closed: '結案', later: '之後再聯絡', scheduled: '已約面談', withdrawn: '人選退出', duplicate: '重複應徵' };

function curStatus(it) {
  if (it.manual_stage && STAGE_ZH[it.manual_stage]) return STAGE_ZH[it.manual_stage];
  if (it.interview_state === 'done') return '阿財面談完';
  if (it.interview_state === 'active') return '阿財面談中';
  return STATUS_ZH[it.status] || it.status || '—';
}
// 「住哪」只顯示到區：新竹市新竹市 → 新竹市；新竹市東區大 → 新竹市東區；台中市北屯區 不變
export function district(s) {
  s = String(s || '').trim();
  const m = s.match(/^(.{2}[市縣])(.*)$/);
  if (!m) return s;
  const d = m[2].match(/^(.{1,3}?[區鄉鎮市])/);
  if (!d || d[1] === m[1]) return m[1];
  return m[1] + d[1];
}
const md = (ts) => { const s = String(ts || ''); return s.length >= 16 ? `${parseInt(s.slice(5, 7), 10)}/${parseInt(s.slice(8, 10), 10)} ${s.slice(11, 16)}` : s; };
const mdDay = (ts) => { const s = String(ts || ''); return s.length >= 10 ? `${parseInt(s.slice(5, 7), 10)}/${parseInt(s.slice(8, 10), 10)}` : s; };
function nowLocal() { const d = new Date(Date.now() + 8 * 3600e3); return d.toISOString().slice(0, 16).replace('T', ' '); }
function remindAtText(cb) {
  const t = new Date(cb.replace(' ', 'T') + ':00+08:00'); if (isNaN(t)) return '';
  t.setMinutes(t.getMinutes() - REMIND_BEFORE);
  return md(new Date(t.getTime() + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' '));
}
function presetTime(daysAhead, hhmm) {
  const d = new Date(Date.now() + 8 * 3600e3 + daysAhead * 86400e3);
  return `${d.toISOString().slice(0, 10)} ${hhmm}`;
}
function me() { const s = document.querySelector('[data-me-global]'); return s ? s.value : ''; }
function phoneDigits(p) { return String(p || '').replace(/[^\d+#,]/g, ''); }
function telLink(p, label) {
  const raw = String(p || '').trim(); if (!raw) return '';
  const first = raw.split(/[、,;／/]| 或 /)[0].trim();
  const ext = (first.match(/(?:#|分機|轉)\s*(\d+)/) || [])[1];
  const main = phoneDigits(first.replace(/(?:#|分機|轉)\s*\d+/, ''));
  if (!main) return `<span class="cl-phone-txt">${e(raw)}</span>`;
  return `<a class="cl-call" href="tel:${e(main)}${ext ? ',' + e(ext) : ''}">${ICON_PHONE}<span>${label ? `<small>${e(label)}</small>` : ''}${e(raw)}</span></a>`;
}

// ── 共用狀態 ──
const S = { q: '', cfg: null, items: [], tab: '', filter: 'all', major: '', pending: {}, open: {}, unsent: new Set(), active: null, target: null, listId: '', lists: [], batch: '', batches: [], queue: [], sel: '', moreOpen: false, week: {}, weekTimers: {}, weekMsg: {}, acted: {}, loadedAt: 0, dockTimer: 0 };
const LS = 's1ne_calllist_ui';
function saveUi(extra = {}) { try { localStorage.setItem(LS, JSON.stringify({ ...loadUi(), tab: S.tab, filter: S.filter, major: S.major, ...extra })); } catch { /* 私密視窗存不了就算了 */ } }
function loadUi() { try { return JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch { return {}; } }

const pend = (id) => (S.pending[id] = S.pending[id] || { result: '', note: '', cb: '' });
const isDirty = (id) => { const p = S.pending[id]; return !!(p && (p.result || p.note.trim())); };
const labelOf = (code) => (S.cfg.results.find((r) => r[0] === code) || [])[1] || BD_OLD[code] || code || '';
const assigneeOf = (it) => (S.cfg.kind === 'cand' ? it.assignee : it.assigned_to) || '未指派';
// 2026-10-30 Jacky：同一家公司在兩位顧問的名單上（例如 Jacky 打過、Phoebe 也有），兩個人的分頁都看得到、都能追蹤
const inTab = (it, tab) => assigneeOf(it) === tab || (S.cfg.kind === 'bd' && String(it.assignees || '').split(',').map((x) => x.trim()).includes(tab));

function rowHead(it) {
  if (S.cfg.kind === 'cand') {
    const m = it.meta || {};
    const sub = [m.edu, district(m.live) ? `住 ${district(m.live)}` : '', m.sent_at ? `${mdDay(m.sent_at)} 寄信` : ''].filter(Boolean).map(e).join('<i>｜</i>');
    // 2026-10-27 Jacky：打電話時要能直接看履歷——姓名旁邊加「📄 履歷」，開新分頁預覽
    const cv = it.application_id ? `<button type="button" class="cl-cv" data-cl-resume="${e(it.application_id)}" title="開新分頁看履歷">📄 履歷</button><button type="button" class="cl-cv" data-application="${e(it.application_id)}" title="在右邊打開人選卡片">👤 人選卡片 →</button>` : '';
    return `<div class="cl-top"><h3>${e(it.name || '（找不到這位人選）')}</h3>${cv}${m.loc ? `<span class="cl-tag">${e(m.loc)}</span>` : ''}<span class="cl-status">${e(curStatus(it))}</span></div>
      <p class="cl-sub">${sub}</p>
      ${it.job_title ? `<p class="cl-job">應徵：${e(it.job_title)}</p>` : ''}
      ${fourLightsHtml(it.lights, 'list')}
      <div class="cl-phones">${telLink(it.phone) || '<span class="cl-phone-txt">沒有電話</span>'}</div>`;
  }
  return '';
}
// 2026-10-29 Jacky：Phoebe 打開就要知道「上次聯繫到哪、今天要做什麼」，點卡片看完整聯繫紀錄
const AI_ACT = { call: '打電話追進度', email: '寄信追進度', mail: '寄信追進度', wait: '等對方回覆', visit: '約拜訪', pause: '先暫停', none: '' };
const today = () => nowLocal().slice(0, 10);
export function bdTodo(it) {
  const st = it.status_info || {};
  if (it.callback_at) return { text: `約好 ${md(it.callback_at)} 回撥`, due: String(it.callback_at).slice(0, 10) };
  if (st.next_step) return { text: st.next_step, due: st.next_due || '' };
  if (it.last_next_step) return { text: it.last_next_step, due: it.last_next_due || '' };
  if (st.ai_action || st.ai_memo) return { text: [AI_ACT[st.ai_action] ?? st.ai_action, st.ai_memo].filter(Boolean).join('：'), due: st.ai_due || '' };
  const d = { got_email: '確認對方收到資料、問主管評估結果', interested: '約時間談需求／合約', send_info: '寄公司介紹資料', got_contact: '打給問到的窗口', no_answer: '再打一次', gatekeeper: '換時段或改找人資分機' }[it.last_result];
  return d ? { text: d, due: '' } : null;
}
// 2026-11-02 Jacky：「今天要確認」只放聯繫過的客戶（已聯繫打勾，或電話有接通／對方回信會自動打勾）；沒聯繫過的走「新名單補滿」
function isDueToday(it) { if (S.cfg && S.cfg.kind === 'bd' && !it.contacted_at) return false; const t = bdTodo(it); return !!(t && t.due && t.due <= today()); }
// ── 2026-11-06 Jacky：公司名單的隱藏與排序（只影響畫面，不寫入任何東西）──
const BD_NO = new Set(['not_interested', 'not_hiring', '拒絕']);
const BD_KEEN = new Set(['interested', 'send_info', 'got_email']);
const BD_RESTORE = '放回名單';
const hist = (it) => it.history || [];
// 最新一筆有結果的電話／其他紀錄；後台自動留的寄信紀錄不算翻案
function bdLatest(it) { const h = hist(it).find((x) => x.result && x.kind !== 'mail'); return h ? h.result : (it.last_result || ''); }
// 回傳隱藏原因；空字串＝照常顯示
export function bdHiddenWhy(it) {
  const st = it.status_info || {};
  if (st.tag === 'NO') return '客戶標籤 NO';
  if (['沒興趣', '暫緩'].includes(st.stage)) return `階段「${st.stage}」`;
  if (st.parked_at) return `備選池${st.parked_reason ? `：${st.parked_reason}` : ''}`;
  const latest = bdLatest(it);
  if (!BD_NO.has(latest)) return '';
  if (['簽約', '談需求', '有興趣'].includes(st.stage) || ['HOT', 'WARM'].includes(st.tag)) return '';
  if (st.next_step && st.next_due && st.next_due >= today()) return '';
  const h = hist(it), at = h.findIndex((x) => x.result === latest && x.kind !== 'mail');
  if (at > 0 && h.slice(0, at).some((x) => x.kind === 'mail' && x.result === 'interested')) return '';
  const rec = h[at];
  return `${rec ? `${mdDay(rec.at)} ` : ''}${labelOf(latest)}${rec && rec.caller ? `（${rec.caller}）` : ''}`;
}
function isKeen(it) {
  const st = it.status_info || {};
  return ['HOT', 'WARM'].includes(st.tag) || ['有興趣', '談需求', '簽約'].includes(st.stage) || anonSent(it)
    || BD_KEEN.has(bdLatest(it)) || (hist(it)[0] || {}).result === 'interested';
}
const lastTouch = (it) => String((hist(it)[0] || {}).at || it.last_at || '').slice(0, 10);
function weekMonday(offsetWeeks = 0) { const d = new Date(`${today()}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + offsetWeeks * 7); return d.toISOString().slice(0, 10); }
function recLine(x) {
  const note = String(x.note || '').replace(/^\s*\S*\s*寄出（[^）]*）：/, '').replace(/\s+/g, ' ').trim();
  const kind = x.kind === 'mail' ? '寄信' : x.kind === 'other' ? '備註' : '電話';
  const res = x.kind === 'mail' || !x.result ? '' : labelOf(x.result);
  return `${mdDay(x.at)} ${kind}${res ? `：${res}` : ''}${note ? `${res ? '。' : '：'}${note}` : ''}`;
}
function bdPastCell(it) {
  const h = hist(it).filter((x) => !/^（系統記錄）/.test(String(x.note || '')));
  const mon = weekMonday(), prev = weekMonday(-1);
  const lw = h.filter((x) => { const d = String(x.at || '').slice(0, 10); return d >= prev && d < mon; });
  const tw = h.filter((x) => String(x.at || '').slice(0, 10) >= mon);
  const line = (x, pre = '') => { const t = recLine(x); return `<p class="cl-past-l" title="${e(t)}">${pre}${e(t)}</p>`; };
  if (!h.length) { const why = String(it.why_company || '').trim(); return `<p class="cl-past-none">還沒聯繫過</p>${why ? `<p class="cl-past-l" title="${e(why)}">${e(why)}</p>` : ''}`; }
  const out = [];
  if (lw.length) out.push(line(lw[0]) + (lw.length > 1 ? `<small class="cl-past-more">上週另有 ${e(lw.length - 1)} 筆</small>` : ''));
  else out.push('<p class="cl-past-none">上週沒有動作</p>');
  if (tw.length) out.push(line(tw[0], '<b>本週</b> '));
  else if (!lw.length) out.push(line(h[0], '<b>最近</b> '));
  return out.join('');
}
function bdRowHtml(it) {
  const id = String(it.id), p = pend(id), why = bdHiddenWhy(it), keen = !why && isKeen(it);
  const qi = S.queue.find((x) => x.it === it);
  const contact = it.hr_contact || it.contact_name || '';
  const phones = [telLink(it.hr_phone, it.hr_phone && it.company_phone && it.hr_phone !== it.company_phone ? '人資' : ''),
    it.company_phone && it.company_phone !== it.hr_phone ? telLink(it.company_phone, it.hr_phone ? '總機' : '') : ''].filter(Boolean).join('');
  const tag = why ? '<span class="cl-st no">已隱藏</span>' : keen ? '<span class="cl-st hot">有意願</span>' : '<span class="cl-st wait">待聯絡</span>';
  const link104 = it.company_104_url ? `<a class="cl-104" href="${e(it.company_104_url)}" target="_blank" rel="noopener">104 ↗</a>` : `<a class="cl-104" href="https://www.104.com.tw/company/search/?keyword=${encodeURIComponent(String(it.company || '').replace(/_.*$/, ''))}" target="_blank" rel="noopener" title="系統沒存這家的 104 公司頁，改用公司名搜尋">104 搜尋 ↗</a>`;
  const t = bdTodo(it);
  const weekVal = id in S.week ? S.week[id] : (t ? t.text : '');
  const due = !why && t && t.due && !(id in S.week) ? (t.due < today() ? `<span class="cl-due late">已過 ${e(mdDay(t.due))}</span>` : t.due === today() ? '<span class="cl-due now">今天</span>' : `<span class="cl-due">${e(mdDay(t.due))}</span>`) : '';
  const done = touchedToday(it) ? '<span class="cl-qok">今天打過</span>' : '';
  const qWhy = qi && !why && qi.tag !== 'new' ? `<span class="cl-due ${qi.tag === 'prio' ? 'prio' : qi.tag === 'due' ? 'late' : qi.tag === 'retry' ? 'now' : ''}">${e(qi.why)}</span>` : '';
  const acted = S.acted[id];
  const actedBox = acted ? `<div class="cl-acted" role="status"><span>${e(acted.text)}</span>${acted.logId ? '<button type="button" class="cl-undo" data-cl-undo>復原</button>' : ''}</div>` : '';
  const canSend = p.result === 'callback' && p.cb;
  const cbBox = p.result === 'callback' ? `<div class="cl-cb" role="group" aria-label="再約時間">
      <label>約幾點再打？<input type="datetime-local" data-cl-cb value="${e(p.cb.replace(' ', 'T'))}" min="${e(nowLocal().replace(' ', 'T'))}"></label>
      <div class="cl-cb-quick"><button type="button" data-cl-quick="${e(presetTime(1, '11:00'))}">明天 11:00</button><button type="button" data-cl-quick="${e(presetTime(1, '14:00'))}">明天 14:00</button><button type="button" data-cl-quick="${e(presetTime(1, '19:00'))}">明天 19:00</button></div>
      <p class="cl-cb-hint">${p.cb ? `儲存後會在 <b>${e(remindAtText(p.cb))}</b> 用 TG 私訊提醒${e(me() || '你')}（提前 ${REMIND_BEFORE} 分鐘）` : '先選日期時間，才能儲存'}</p>
      <button type="button" class="cl-send" data-cl-send ${canSend ? '' : 'disabled'}>儲存</button></div>` : '';
  const acts = why
    ? `<div class="cl-acts"><button type="button" class="cl-qb" data-cl-restore>放回名單</button></div>`
    : `<div class="cl-acts" role="group" aria-label="${e(it.company)} 通話結果">${S.cfg.results.map(([v, lb]) => (v === 'callback'
      ? `<button type="button" class="cl-qb" data-cl-res="callback" aria-pressed="${p.result === 'callback'}">${e(lb)}</button>`
      : `<button type="button" class="cl-qb ${S.cfg.tone[v]}" data-cl-qres="${v}">${e(lb)}</button>`)).join('')}</div>
      ${cbBox}
      <input type="text" class="cl-note" data-cl-note aria-label="${e(it.company)} 備註" placeholder="備註可留空，先打再按結果；Enter 只存備註" maxlength="300" value="${e(p.note)}" enterkeyhint="done">`;
  return `<article class="cl-row cl-bd-row${touchedToday(it) ? ' cl-today' : ''}${why ? ' cl-hid' : ''}${S.unsent.has(id) && isDirty(id) ? ' unsent' : ''}${S.sel === id ? ' cl-sel' : ''}" data-cl-id="${e(id)}">
    <div class="cl-co"><button type="button" class="cl-co-name" data-bd-company="${e(it.company)}" title="打開這家的客戶卡片">${e(it.company)}</button>
      ${contact || it.job_title ? `<p class="cl-co-sub">${[contact, it.job_title].filter(Boolean).map(e).join('<i>｜</i>')}</p>` : ''}
      <div class="cl-co-tags">${tag}${done}${qWhy}</div>
      <div class="cl-phones">${phones || '<span class="cl-phone-txt">沒有電話</span>'}${link104}</div></div>
    <div class="cl-past"><div class="cl-lab">上週做什麼</div>${bdPastCell(it)}</div>
    <div class="cl-week"><div class="cl-lab">這週要做什麼</div>${why ? `<p class="cl-hid-why">隱藏原因：${e(why)}</p>` : `<input type="text" class="cl-week-in" data-cl-week aria-label="${e(it.company)} 這週要做什麼" maxlength="500" value="${e(weekVal)}" placeholder="打字即存" enterkeyhint="done"><div class="cl-week-foot">${due}<span class="cl-week-msg" data-cl-week-msg aria-live="polite">${e(S.weekMsg[id] || '')}</span></div>`}</div>
    <div class="cl-rec"><div class="cl-lab">快速記錄</div>${acts}${actedBox}</div>
  </article>`;
}
// 這週要做什麼：打字就存（停 0.9 秒或離開欄位）。走 /admin/bd/company-status，不新增聯繫紀錄、不會排 AI 重算
async function saveWeek(id) {
  clearTimeout(S.weekTimers[id]); delete S.weekTimers[id];
  if (!(id in S.week)) return;
  const it = S.items.find((x) => String(x.id) === id); if (!it) return;
  const text = S.week[id].trim(), st = it.status_info || {}, t = bdTodo(it);
  const msg = (m) => { S.weekMsg[id] = m; const el = S.target.querySelector(`[data-cl-id="${CSS.escape(id)}"] [data-cl-week-msg]`); if (el) el.textContent = m; };
  if (text === (t ? t.text : '')) { delete S.week[id]; msg(''); return; }
  const who = me();
  if (!who) { msg('先在畫面最上方「我是」選名字才存得了'); return; }
  const due = st.next_due || (t && t.due) || '';
  msg('儲存中…');
  try {
    await api.post('/admin/bd/company-status', { company: it.company, next_step: text, next_due: due, by: who });
    it.status_info = { ...st, next_step: text || null, next_due: text ? (due || null) : null };
    if (S.week[id].trim() === text) delete S.week[id];
    msg(`已存 ${nowLocal().slice(11, 16)}`);
  } catch (err) { msg(`沒存到：${err.message || '請再試一次'}`); }
}
function bdCounts() {
  S.queue = buildQueue(tabRows());
  const mine = bdMine();
  const hid = mine.filter(bdHiddenWhy).length, live = mine.length - hid;
  return { queue: S.queue.length, all: live, hidden: hid };
}
const bdMine = () => S.items.filter((it) => inTab(it, S.tab));
function refreshBdCounts() {
  const c = bdCounts();
  S.target.querySelectorAll('[data-cl-filter]').forEach((b) => { const n = b.querySelector('b'); if (n) n.textContent = c[b.dataset.clFilter] ?? 0; });
  const sum = S.target.querySelector('#cl-sum'); if (sum) sum.textContent = bdSumText(c);
}
const bdSumText = (c) => `今日要打 ${c.queue} 家｜隱藏 ${c.hidden} 家`;
function renderBd(t) {
  const people = [...new Set(S.items.flatMap((it) => [assigneeOf(it), ...String(it.assignees || '').split(',').map((x) => x.trim()).filter(Boolean)]))].sort((a, b) => (a === '未指派') - (b === '未指派') || a.localeCompare(b));
  if (!people.includes(S.tab)) S.tab = people.includes(me()) ? me() : people[0] || '';
  const c = bdCounts();
  S.acted = {};
  const rows = visibleRows();
  if (!t.querySelector('#cl-left')) {
    t.innerHTML = `<div class="cl-split bd-mode"><div class="cl-left" id="cl-left"></div><aside id="cl-dock" class="cl-dock" aria-label="客戶卡片" aria-live="polite">${dockEmpty()}</aside></div>`;
  }
  const scope = `<label class="cl-pick">名單範圍<select data-cl-batch><option value="*" ${S.batch === '*' ? 'selected' : ''}>全部名單合在一起（自動排今天要打）</option>${S.batches.map((b) => `<option value="${e(b.batch_id)}" ${b.batch_id === S.batch ? 'selected' : ''}>只看：${e(b.label || b.batch_id)}（${e(b.n)} 家）</option>`).join('')}</select></label>`;
  const chip = (k, lb) => `<button type="button" class="cl-chip${S.filter === k ? ' on' : ''}" data-cl-filter="${k}" aria-pressed="${S.filter === k}">${e(lb)} <b>${e(c[k] || 0)}</b></button>`;
  t.querySelector('#cl-left').innerHTML = `<div class="cl-wrap cl-bd">
    <div class="cl-tabs" role="tablist">${people.map((p) => `<button type="button" role="tab" aria-selected="${p === S.tab}" class="${p === S.tab ? 'on' : ''}" data-cl-tab="${e(p)}">${e(p)} <small>${e(S.items.filter((it) => inTab(it, p) && !bdHiddenWhy(it)).length)}</small></button>`).join('')}</div>
    <div class="cl-bd-bar"><label class="cl-search"><span class="sr-only">搜尋客戶</span><input type="search" data-cl-q value="${e(S.q)}" placeholder="搜尋客戶、聯絡人…" autocomplete="off"></label>
      ${chip('queue', '今日要打')}${chip('all', '全部名單')}${chip('hidden', '已隱藏')}<span class="cl-sum" id="cl-sum">${e(bdSumText(c))}</span></div>
    <details class="cl-bd-more" data-cl-more ${S.moreOpen ? 'open' : ''}><summary>今日進度、每天目標、名單範圍</summary>${scope}${warRoom(tabRows())}</details>
    <div class="cl-bd-head" aria-hidden="true"><span>客戶</span><span>上週做什麼</span><span>這週要做什麼</span><span>快速記錄</span></div>
    <div class="cl-list">${listHtml(rows)}</div></div>`;
}
async function restoreRow(id) {
  const it = S.items.find((x) => String(x.id) === id); if (!it) return;
  const who = me();
  if (!who) { toast('先在畫面最上方「我是」選你的名字，系統才記得是誰放回的', 'error'); document.querySelector('[data-me-global]')?.focus(); return; }
  const st = it.status_info || {};
  const row = S.target.querySelector(`[data-cl-id="${CSS.escape(id)}"] [data-cl-restore]`); if (row) { row.disabled = true; row.textContent = '放回中…'; }
  try {
    if (st.parked_at) await api.post('/admin/bd/park', { company: it.company, parked: false, by: who });
    if (st.tag === 'NO') await api.post('/admin/bd/tag', { company: it.company, tag: '', by: who });
    const badStage = ['沒興趣', '暫緩'].includes(st.stage);
    const r = await api.post('/admin/bd/log', { company: it.company, kind: 'other', result: BD_RESTORE, note: '放回電話名單', by: who, outreach_id: it.id, event_at: nowLocal(), ...(badStage ? { stage: '已聯繫' } : {}) });
    it.status_info = { ...st, parked_at: null, parked_reason: null, next_step: null, next_due: null, ...(st.tag === 'NO' ? { tag: null } : {}), ...(badStage ? { stage: '已聯繫' } : {}) };
    it.history = [{ at: nowLocal(), result: BD_RESTORE, note: '放回電話名單', caller: who, kind: 'other', id: r.id }, ...hist(it)];
    toast('已放回名單', 'success');
    removeRowEl(id); refreshBdCounts();
  } catch (err) {
    toast(err.message || '放回失敗，請再按一次', 'error');
    if (row) { row.disabled = false; row.textContent = '放回名單'; }
  }
}
async function undoRow(id) {
  const it = S.items.find((x) => String(x.id) === id), a = S.acted[id]; if (!it || !a || !a.logId) return;
  try {
    await api.post('/admin/bd/delete-record', { id: a.logId, by: me() });
    if (a.prevNext && a.prevNext.next_step) await api.post('/admin/bd/company-status', { company: it.company, next_step: a.prevNext.next_step, next_due: a.prevNext.next_due || '', by: me() });
    Object.assign(it, a.prevItem);
    it.status_info = a.prevStatus;
    delete S.acted[id];
    toast('已復原，那筆紀錄收回了', 'success');
    if (a.gone) { closeHidBar(); putRowBack(it, a.nextId); refreshBdCounts(); }
    else { rerenderRow(id); refreshBdCounts(); }
  } catch (err) { toast(err.message || '復原失敗', 'error'); }
}
// 只存備註：不算一通電話，也不影響隱藏與排序
async function saveNoteOnly(id) {
  const it = S.items.find((x) => String(x.id) === id), p = pend(id), note = p.note.trim(), who = me(); if (!it || !note) return;
  if (!who) { toast('先在畫面最上方「我是」選你的名字', 'error'); return; }
  try {
    const typed = id in S.week ? S.week[id].trim() : '';
    const r = await api.post('/admin/bd/log', { company: it.company, kind: 'other', note, by: who, outreach_id: it.id, event_at: nowLocal(), next_step: typed });
    it.history = [{ at: nowLocal(), result: null, note, caller: who, kind: 'other', id: r.id }, ...hist(it)];
    it.status_info = { ...(it.status_info || {}), next_step: typed || null, next_due: null, ai_action: null, ai_due: null, ai_memo: null };
    delete S.week[id]; delete S.pending[id];
    toast('備註已存', 'success'); rerenderRow(id);
  } catch (err) { toast(err.message || '備註沒存到', 'error'); }
}
// 右欄卡片或別人的修改：不必重新整理，閒著的時候自己抓新資料
function bdBusy() {
  const a = document.activeElement;
  return !!(a && a.closest && a.closest('#cl-left') && a.matches('input,select,textarea')) || Object.keys(S.pending).some(isDirty) || Object.keys(S.weekTimers).length > 0 || Object.keys(S.week).length > 0;
}
function bdRefreshSoon(ms) {
  clearTimeout(S.dockTimer);
  S.dockTimer = setTimeout(() => { if (S.cfg === BD && S.target && S.target.isConnected && !document.hidden && !bdBusy()) loadBd(true); }, ms);
}

function rowHtml(it) {
  if (S.cfg.kind === 'bd') return bdRowHtml(it);
  const id = String(it.id);
  const done = !!it.last_result;
  const p = pend(id);
  // 2026-10-29 Jacky：不要「已記錄」框＋「再記一筆」按鈕——每張卡都直接是輸入列，點結果、打字，按「儲存」才進系統（上一筆看「上次」那行）
  const qi = S.queue.find((x) => x.it === it);
  const unsent = S.unsent.has(id) && isDirty(id);
  const canSend = p.result && (p.result !== 'callback' || p.cb);
  const doneToday = touchedToday(it);
  const lastLine = S.cfg.kind === 'cand' && done ? `<div class="cl-brief"><p><b>上次</b> ${e(mdDay(it.last_at))} ${e(labelOf(it.last_result))}${it.last_by ? `（${e(it.last_by)}）` : ''}${it.last_note ? `：${e(it.last_note)}` : ''}</p>${it.callback_at ? `<p class="cl-todo"><b>約好回撥</b> ${e(md(it.callback_at))}</p>` : ''}</div>` : '';
  const cbBox = p.result === 'callback' ? `<div class="cl-cb" role="group" aria-label="再約時間">
      <label>約幾點再打？<input type="datetime-local" data-cl-cb value="${e(p.cb.replace(' ', 'T'))}" min="${e(nowLocal().replace(' ', 'T'))}"></label>
      <div class="cl-cb-quick"><button type="button" data-cl-quick="${e(presetTime(1, '11:00'))}">明天 11:00</button><button type="button" data-cl-quick="${e(presetTime(1, '14:00'))}">明天 14:00</button><button type="button" data-cl-quick="${e(presetTime(1, '19:00'))}">明天 19:00</button></div>
      <p class="cl-cb-hint">${p.cb ? `儲存後會在 <b>${e(remindAtText(p.cb))}</b> 用 TG 私訊提醒${e(me() || '你')}（提前 ${REMIND_BEFORE} 分鐘）` : '先選日期時間，才能儲存'}</p></div>` : '';
  const form = `
      <div class="cl-btns" role="group" aria-label="通話結果">${S.cfg.results.map(([v, lb]) => `<button type="button" class="cl-res ${S.cfg.tone[v]}" data-cl-res="${v}" aria-pressed="${p.result === v}">${e(lb)}</button>`).join('')}</div>
      ${cbBox}
      <div class="cl-send-row"><input type="text" data-cl-note placeholder="${done ? '這次聊了什麼（會追加一筆，不蓋掉上一筆）' : '備註（可留空）'}" maxlength="300" value="${e(p.note)}" enterkeyhint="done"><button type="button" class="cl-send" data-cl-send ${canSend ? '' : 'disabled'}>儲存</button></div>`;
  return `<article class="cl-row${doneToday ? ' cl-today' : ''}${unsent ? ' unsent' : ''}${S.sel === id ? ' cl-sel' : ''}" data-cl-id="${e(id)}">
    ${qi ? `<div class="cl-q"><span class="cl-qn">#${e(qi.n)}</span><span class="cl-due ${qi.tag === 'prio' ? 'prio' : qi.tag === 'due' ? 'late' : qi.tag === 'retry' ? 'now' : ''}">${e(qi.why)}</span>${doneToday ? '<span class="cl-qok">✓ 今天打過了</span>' : ''}</div>` : ''}
    ${unsent ? '<div class="cl-unsent" role="status">還沒儲存——選了狀態或打了備註，要按「儲存」才會存進系統</div>' : ''}
    ${rowHead(it)}${lastLine}${form}</article>`;
}


function dockEmpty() { return `<div class="state cl-dock-empty"><strong>點左邊任一張卡片</strong><p>完整${S.cfg.kind === 'bd' ? '客戶' : '人選'}卡片會出現在這裡：紀錄、寄信、${S.cfg.kind === 'bd' ? '開發進度' : '履歷與面談'}都在這邊，左邊名單一直都在。</p></div>`; }
function closeDock() { const d = document.getElementById('cl-dock'); if (d) { d.classList.remove('open'); d.innerHTML = dockEmpty(); } document.querySelector('.cl-split')?.classList.remove('has-dock'); S.sel = ''; document.querySelectorAll('.cl-row.cl-sel').forEach((r) => r.classList.remove('cl-sel')); }
// ── 2026-10-29 Jacky：每天自動排「今天要打」──
// ①之前聯繫過、今天到期（含已過期）／約好今天回撥的全部排 → ②沒接滿 2 個工作天的重打 → ③新名單補滿到每天目標。
// 今天已經打過的照樣留在清單（標「今天打過了」），進度＝打過／清單總數。
const GOAL_LS = 's1ne_calllist_goal';
const GOAL_DEF = { bd: 25, cand: 30 };
function goalOf(kind) { try { const g = JSON.parse(localStorage.getItem(GOAL_LS) || '{}'); return Number(g[kind]) || GOAL_DEF[kind]; } catch { return GOAL_DEF[kind]; } }
function setGoal(kind, n) { try { const g = JSON.parse(localStorage.getItem(GOAL_LS) || '{}'); g[kind] = n; localStorage.setItem(GOAL_LS, JSON.stringify(g)); } catch { /* 私密視窗存不了就用預設 */ } }
function touchedToday(it) { const t = today(); return String(it.last_at || '').startsWith(t) || (it.history || []).some((h) => String(h.at || '').startsWith(t)); }
function workdaysBetween(a, b) { let n = 0; const d = new Date(`${a}T00:00:00Z`), end = new Date(`${b}T00:00:00Z`); while (d < end) { d.setUTCDate(d.getUTCDate() + 1); const w = d.getUTCDay(); if (w !== 0 && w !== 6) n += 1; } return n; }
function morningState(it) {
  const t = today();
  const h = (it.history || []).filter((x) => String(x.at || '') < t).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  if (h.length) return { last: h[0].result, at: String(h[0].at) };
  const at = String(it.last_at || '');
  return at && at < t ? { last: it.last_result, at } : { last: null, at: '' };
}
// 新名單沒有分區欄位：用職缺名稱粗分（BIM／繪圖最對口 → 營造機電 → 其他）
function newCat(it) { const s = `${it.job_title || ''} ${it.why_company || ''} ${it.industry || ''}`; return /BIM|Revit|繪圖|CAD|製圖/i.test(s) ? 1 : /營造|機電|建築|工程|工務|土木/.test(s) ? 2 : 3; }
const NEWCAT = { 1: '新名單｜BIM／繪圖', 2: '新名單｜營造機電', 3: '新名單｜其他' };
function buildQueue(rows) {
  const kind = S.cfg.kind, goal = goalOf(kind), t = today(), q = [];
  const add = (it, why, tag) => { if (!q.some((x) => x.it === it)) q.push({ it, why, tag }); };
  // 2026-10-30 Jacky：他給的名單（priority_rank）照他的順序放最上面——還沒打的、打過要追蹤的都算；只有「不需要」的拿掉
  if (kind === 'bd') rows.filter((it) => (it.status_info || {}).priority_rank && !BD_NO.has(bdLatest(it)))
    .sort((a, b) => a.status_info.priority_rank - b.status_info.priority_rank)
    .forEach((it) => add(it, `優先名單 #${it.status_info.priority_rank}｜${it.last_result ? `上次${labelOf(it.last_result)}，要追蹤` : '還沒打'}`, 'prio'));
  if (kind === 'bd') rows.filter(isDueToday).sort((a, b) => String(bdTodo(a).due).localeCompare(String(bdTodo(b).due))).forEach((it) => add(it, bdTodo(it).due < t ? `已過期 ${mdDay(bdTodo(it).due)}` : '今天到期', 'due'));
  else rows.filter((it) => it.callback_at && String(it.callback_at).slice(0, 10) <= t).forEach((it) => add(it, `約好 ${md(it.callback_at)} 回撥`, 'due'));
  if (kind === 'bd') {
    // 2026-11-06 Jacky：寄過匿名的、有意願但沒排日期又兩個工作天沒動的，都進今天要打；剛放回名單的也進來
    rows.filter(anonSent).forEach((it) => add(it, '已寄匿名人選', 'prio'));
    rows.filter((it) => { if (!isKeen(it)) return false; const td = bdTodo(it); if (td && td.due && td.due > t) return false; const at = lastTouch(it); return touchedToday(it) || !at || workdaysBetween(at, t) >= 2; })
      .forEach((it) => add(it, '有意願，該追了', 'due'));
    rows.filter((it) => bdLatest(it) === BD_RESTORE).forEach((it) => add(it, '剛放回名單', 'due'));
  }
  rows.filter((it) => { const m = morningState(it); return m.last === 'no_answer' && workdaysBetween(m.at.slice(0, 10), t) >= 2; })
    .forEach((it) => { if (q.length < goal) add(it, `沒接（${mdDay(morningState(it).at)}），滿 2 個工作天重打`, 'retry'); });
  const fresh = rows.filter((it) => !morningState(it).last && !q.some((x) => x.it === it));
  if (kind === 'bd') fresh.sort((a, b) => (!!(b.hr_phone || b.company_phone) - !!(a.hr_phone || a.company_phone)) || (newCat(a) - newCat(b)) || ((a._ord || 0) - (b._ord || 0)));
  else fresh.sort((a, b) => String((a.meta || {}).sent_at || '9').localeCompare(String((b.meta || {}).sent_at || '9')) || ((a.sort || 0) - (b.sort || 0)));
  for (const it of fresh) { if (q.length >= goal) break; add(it, kind === 'bd' ? NEWCAT[newCat(it)] : `寄信未回（${mdDay((it.meta || {}).sent_at) || '—'} 寄）`, 'new'); }
  // 2026-11-06 Jacky：有意願的排最前面，接著才是待聯絡（各自維持上面的先後）
  if (kind === 'bd') { const keen = new Set(q.filter((x) => isKeen(x.it)).map((x) => x.it)); q.sort((a, b) => keen.has(b.it) - keen.has(a.it)); }
  q.forEach((x, i) => { x.n = i + 1; });
  return q;
}
function warRoom(rows) {
  const kind = S.cfg.kind, q = S.queue, who = S.tab;
  const done = q.filter((x) => touchedToday(x.it)).length;
  const t = today();
  const calls = rows.reduce((n, it) => { const h = (it.history || []).filter((x) => String(x.at || '').startsWith(t) && (!x.kind || x.kind === 'call') && (!x.caller || x.caller === who)).length; return n + (h || (String(it.last_at || '').startsWith(t) ? 1 : 0)); }, 0);
  const good = kind === 'bd' ? ['interested', 'send_info', 'got_email'] : ['interested'];
  const leads = rows.filter((it) => String(it.last_at || '').startsWith(t) && good.includes(it.last_result)).length;
  const cnt = (g) => q.filter((x) => x.tag === g).length;
  const pct = q.length ? Math.round(done / q.length * 100) : 0;
  const d = new Date(`${t}T00:00:00Z`);
  return `<section class="cl-war" aria-label="今日作戰">
    <div class="cl-war-head"><div><b>今日作戰</b><span>${d.getUTCMonth() + 1}/${d.getUTCDate()}（${'日一二三四五六'[d.getUTCDay()]}）・${e(who || '—')}</span></div><button type="button" class="btn sm" data-cl-tg>複製 TG 戰報</button></div>
    <div class="cl-kpis">
      <div class="cl-kpi"><span>今天要打（自動排）</span><strong>${done}<small> / ${q.length}</small></strong><small>打完 ${pct}%</small></div>
      <div class="cl-kpi"><span>今天打了</span><strong>${calls}<small> 通</small></strong><small>${kind === 'bd' ? '含追蹤和新名單' : '這份名單'}</small></div>
      <div class="cl-kpi"><span>${kind === 'bd' ? '有效進展' : '有意願'}</span><strong>${leads}<small> ${kind === 'bd' ? '家' : '位'}</small></strong><small>${kind === 'bd' ? '有興趣・要資料・拿到信箱' : '今天說有意願的'}</small></div>
    </div>
    <div class="cl-bar cl-war-bar"><i style="width:${pct}%"></i></div>
    <div class="cl-mix">${kind === 'bd' && cnt('prio') ? `<span><b>${cnt('prio')}</b>優先名單</span>` : ''}<span><b>${cnt('due')}</b>${kind === 'bd' ? '到期追蹤' : '約好回撥'}</span><span><b>${cnt('retry')}</b>沒接重打</span><span><b>${cnt('new')}</b>新名單補滿</span>
      <label class="cl-goalset">每天目標<input type="number" min="5" max="80" value="${goalOf(kind)}" data-cl-goal aria-label="每天目標通數">通</label></div>
    <p class="cl-war-rule">排法：${kind === 'bd' ? '有意願的一律排最前面，接著才是待聯絡。各自裡面：⓪ Jacky 指定的優先名單 → ' : ''}①${kind === 'bd' ? '之前聯繫過、今天到期（含已過期）' : '約好今天回撥的'}全部排 → ②沒接滿 2 個工作天的重打 → ③${kind === 'bd' ? '新名單（BIM／繪圖 → 營造機電 → 其他，有電話的先）' : '寄信未回，早寄的先'}補到每天目標。</p>
  </section>`;
}
function tgText(rows) {
  const q = S.queue, t = today();
  const done = q.filter((x) => touchedToday(x.it)).length;
  const by = (k) => rows.filter((it) => String(it.last_at || '').startsWith(t) && it.last_result === k).map((it) => String(it.company || it.name || '').replace(/(\u80a1\u4efd)?\u6709\u9650\u516c\u53f8$/, ''));
  return `${S.tab}｜${mdDay(t)} ${S.cfg.kind === 'bd' ? '公司開發' : '人選電話'}進度\n・今天要打 ${q.length}，打完 ${done}\n・${S.cfg.kind === 'bd' ? '有興趣' : '有意願'}：${by('interested').join('、') || '—'}\n${S.cfg.kind === 'bd' ? `・要資料／拿到信箱：${[...by('send_info'), ...by('got_email')].join('、') || '—'}\n` : ''}・沒接：${by('no_answer').length}`;
}

function counts(rows) {
  const c = { all: rows.length, todo: 0, called: 0 };
  S.cfg.results.forEach(([v]) => { c[v] = 0; });
  rows.forEach((it) => { if (it.last_result) { c.called += 1; c[it.last_result] = (c[it.last_result] || 0) + 1; } else c.todo += 1; });
  if (S.cfg.kind === 'bd') c.due = rows.filter(isDueToday).length;
  return c;
}
// 2026-10-28 Jacky：「相關科系的讓 Phoebe 打電話好打，名單可以篩科系」。學歷欄是「學校 科系」，取最後一段分類。
const MAJORS = [
  ['arch', '建築／室內', /建築|室內|空間設計/], ['civil', '土木／營建', /土木|營建|營造|測量|結構|空間資訊|水利|防災/],
  ['mech', '機械', /機械|機電|自動化/], ['ee', '電機／電子', /電機|電子|光電|通訊|冷凍|空調|能源|電力|控制/],
  ['env', '環境', /環境|環工|環安/], ['urban', '都市計劃', /都市|地政|景觀/], ['chem', '化工／材料', /化學|化工|材料/],
  ['it', '資訊', /資訊|資工|多媒體|數位|軟體/], ['design', '設計', /設計|美術|藝術/],
  ['biz', '管理／商科', /管理|企業|行銷|國際|流通|財金|財務|會計|經濟|商/],
];
const RELATED = ['arch', 'civil', 'mech', 'ee', 'env', 'urban'];
function majorOf(it) {
  const edu = String((it.meta || {}).edu || '').trim();
  if (!edu) return 'none';
  const dept = edu.split(/\s+/).slice(1).join(' ') || edu;
  const hit = MAJORS.find(([, , re]) => re.test(dept));
  return hit ? hit[0] : 'other';
}
function majorMatch(it) {
  if (!S.major || S.cfg.kind === 'bd') return true;
  const k = majorOf(it);
  return S.major === 'related' ? RELATED.includes(k) : k === S.major;
}
// 公司名單：已隱藏的不算在今天要打、也不算在任何進度數字裡
function tabRows() { return S.items.filter((it) => inTab(it, S.tab) && majorMatch(it) && !(S.cfg.kind === 'bd' && bdHiddenWhy(it))); }
// 2026-11-02 Jacky：兩頁各自一個搜尋框（不共用）——公司頁搜公司名／聯絡人，人選頁搜姓名／電話；
// 有打字就搜整份名單（不管上面選誰的分頁、哪個篩選），清掉就回原本的篩選
const norm = (v) => String(v == null ? '' : v).toLowerCase().replace(/[\s\-()（）]/g, '');
function qMatch(it) {
  const q = norm(S.q); if (!q) return true;
  const hay = S.cfg.kind === 'bd' ? [it.company, it.hr_contact, it.contact_name, it.job_title] : [it.name, it.phone, it.job_title];
  return hay.some((v) => norm(v).includes(q));
}
function visibleRows() {
  if (S.cfg.kind === 'bd') {
    const hid = S.filter === 'hidden';
    const keep = (it) => !!bdHiddenWhy(it) === hid;
    if (norm(S.q)) return S.items.filter((it) => keep(it) && qMatch(it));
    if (hid) return bdMine().filter(bdHiddenWhy).sort((a, b) => lastTouch(b).localeCompare(lastTouch(a)));
    if (S.filter === 'all') {
      const idx = new Map(S.queue.map((x, i) => [x.it, i]));
      return [...tabRows()].sort((a, b) => (isKeen(b) - isKeen(a)) || ((idx.has(a) ? idx.get(a) : 1e6) - (idx.has(b) ? idx.get(b) : 1e6)) || lastTouch(b).localeCompare(lastTouch(a)));
    }
    return S.queue.map((x) => x.it);
  }
  if (norm(S.q)) return S.items.filter(qMatch);
  const rows = tabRows();
  if (S.filter === 'queue') return S.queue.map((x) => x.it);
  if (S.filter === 'today') return rows.filter(touchedToday);
  if (S.filter === 'all') return rows;
  if (S.filter === 'todo') return rows.filter((it) => !it.last_result || S.open[String(it.id)]);
  if (S.filter === 'due') return rows.filter(isDueToday);
  return rows.filter((it) => it.last_result === S.filter);
}

function renderAll() {
  const t = S.target; if (!t) return;
  if (S.cfg.kind === 'bd') { renderBd(t); return; }
  const people = [...new Set(S.items.flatMap((it) => [assigneeOf(it), ...String(it.assignees || '').split(',').map((x) => x.trim()).filter(Boolean)]))].sort((a, b) => (a === '未指派') - (b === '未指派') || a.localeCompare(b));
  if (!people.includes(S.tab)) S.tab = people.includes(me()) ? me() : people[0] || '';
  S.queue = buildQueue(tabRows());
  const c = counts(tabRows());
  c.queue = S.queue.length; c.today = tabRows().filter(touchedToday).length;
  // 科系下拉（只有人選名單、而且有學歷資料才出現）；手機用原生 select
  const allMine = S.items.filter((it) => assigneeOf(it) === S.tab);
  const hasEdu = S.cfg.kind === 'cand' && allMine.some((it) => (it.meta || {}).edu);
  const mc = (pred) => allMine.filter(pred).length;
  const majorSel = !hasEdu ? '' : `<label class="cl-pick">科系<select data-cl-major>
      <option value="" ${!S.major ? 'selected' : ''}>全部科系（${allMine.length}）</option>
      <option value="related" ${S.major === 'related' ? 'selected' : ''}>相關科系：建築・土木・機電・環境（${mc((it) => RELATED.includes(majorOf(it)))}）</option>
      ${MAJORS.map(([k, lb]) => { const n = mc((it) => majorOf(it) === k); return n ? `<option value="${k}" ${S.major === k ? 'selected' : ''}>${lb}（${n}）</option>` : ''; }).join('')}
      ${mc((it) => majorOf(it) === 'other') ? `<option value="other" ${S.major === 'other' ? 'selected' : ''}>其他科系（${mc((it) => majorOf(it) === 'other')}）</option>` : ''}
      ${mc((it) => majorOf(it) === 'none') ? `<option value="none" ${S.major === 'none' ? 'selected' : ''}>沒寫學歷（${mc((it) => majorOf(it) === 'none')}）</option>` : ''}
    </select></label>`;
  const head = S.cfg.kind === 'cand'
    ? (S.lists.length > 1 ? `<label class="cl-pick">名單<select data-cl-list>${S.lists.map((l) => `<option value="${e(l.id)}" ${l.id === S.listId ? 'selected' : ''}>${e(l.title)}（${e(l.done)}/${e(l.n)}）</option>`).join('')}</select></label>` : (S.lists[0] ? `<p class="cl-listname">名單：${e(S.lists[0].title)}</p>` : ''))
    : `<label class="cl-pick">名單<select data-cl-batch><option value="*" ${S.batch === '*' ? 'selected' : ''}>全部名單合在一起（自動排今天要打）</option>${S.batches.map((b) => `<option value="${e(b.batch_id)}" ${b.batch_id === S.batch ? 'selected' : ''}>只看：${e(b.label || b.batch_id)}（${e(b.n)} 家）</option>`).join('')}</select></label>`;
  const chip = (k, lb) => `<button type="button" class="cl-chip${S.filter === k ? ' on' : ''}" data-cl-filter="${k}" aria-pressed="${S.filter === k}">${e(lb)} <b>${e(c[k] || 0)}</b></button>`;
  const rows = visibleRows();
  // 右欄（客戶卡片／人選卡片）只建一次，左邊重畫時不動它（裡面的按鈕都已經接好事件）
  if (!t.querySelector('#cl-left')) {
    t.innerHTML = `<div class="cl-split"><div class="cl-left" id="cl-left"></div><aside id="cl-dock" class="cl-dock" aria-label="${S.cfg.kind === 'bd' ? '客戶卡片' : '人選卡片'}" aria-live="polite">${dockEmpty()}</aside></div>`;
  }
  t.querySelector('#cl-left').innerHTML = `<div class="cl-wrap">${head}
    ${warRoom(tabRows())}
    <div class="cl-tabs" role="tablist">${people.map((p) => `<button type="button" role="tab" aria-selected="${p === S.tab}" class="${p === S.tab ? 'on' : ''}" data-cl-tab="${e(p)}">${e(p)} <small>${e(S.items.filter((it) => inTab(it, p)).length)}</small></button>`).join('')}</div>
    ${majorSel}
    <div class="cl-progress"><span>已打 <b>${e(c.called)}</b> / ${e(c.all)}</span><div class="cl-bar"><i style="width:${c.all ? Math.round(c.called / c.all * 100) : 0}%"></i></div></div>
    <label class="cl-search"><span class="sr-only">${S.cfg.kind === 'bd' ? '搜尋公司' : '搜尋人選'}</span><input type="search" data-cl-q value="${e(S.q)}" placeholder="${S.cfg.kind === 'bd' ? '搜尋公司名、聯絡人…' : '搜尋人選姓名、電話…'}" autocomplete="off"></label>
    <div class="cl-chips">${chip('queue', '今天要打')}${chip('today', '今天打過')}${chip('todo', '還沒打')}${chip('all', '全部')}${S.cfg.results.map(([v, lb]) => chip(v, lb)).join('')}</div>
    <div class="cl-list">${listHtml(rows)}</div></div>`;
}
function listHtml(rows) {
  if (norm(S.q)) {
    // 公司名單：這一欄沒找到、但另一邊有，直接講，不要讓人以為資料不見了
    const other = S.cfg.kind === 'bd' ? S.items.filter((it) => !!bdHiddenWhy(it) !== (S.filter === 'hidden') && qMatch(it)).length : 0;
    const otherNote = other ? `<p class="cl-q-hint">${S.filter === 'hidden' ? '名單上' : '「已隱藏」裡'}另有 ${e(other)} 筆符合，切過去看。</p>` : '';
    return rows.length ? `<p class="cl-q-hint">搜「${e(S.q)}」：整份名單找到 ${e(rows.length)} 筆</p>${otherNote}${rows.map(rowHtml).join('')}` : `<div class="state"><strong>找不到「${e(S.q)}」</strong><p>換個字再試，或把搜尋框清掉。</p>${otherNote}</div>`;
  }
  return rows.length ? rows.map(rowHtml).join('') : '<div class="state"><strong>這裡沒有名單</strong><p>換個篩選看看。</p></div>';
}
// 2026-11-02 Jacky：寄過匿名人選的客戶＝顧問優先追（2026-11-06 起直接排進今天要打）
const anonSent = (it) => /匿名/.test(String((it.status_info || {}).priority_list || ''));
function rerenderRow(id) {
  const el = S.target && S.target.querySelector(`[data-cl-id="${CSS.escape(id)}"]`);
  const it = S.items.find((x) => String(x.id) === id);
  if (el && it) { el.outerHTML = rowHtml(it); }
}
// 2026-11-06 Jacky：「未及時隱藏」——列一按就離開畫面，不等切換畫面；只動這一列，其他列不重排
function removeRowEl(id) {
  const el = S.target && S.target.querySelector(`[data-cl-id="${CSS.escape(id)}"]`);
  const list = S.target && S.target.querySelector('.cl-list');
  const next = el && el.nextElementSibling && el.nextElementSibling.dataset ? el.nextElementSibling.dataset.clId || '' : '';
  if (el) el.remove();
  if (list && !list.querySelector('[data-cl-id]')) list.innerHTML = listHtml(visibleRows());
  return next;
}
function closeHidBar() {
  clearTimeout(S.hidBarTimer);
  S.target && S.target.querySelector('.cl-hid-bar')?.remove();
}
function hideRowNow(id, it) {
  const a = S.acted[id]; if (!a) return;
  a.gone = true; a.nextId = removeRowEl(id);
  closeHidBar();
  const wrap = S.target.querySelector('.cl-wrap'); if (!wrap) return;
  wrap.insertAdjacentHTML('beforeend', `<div class="cl-hid-bar" role="status"><span>「${e(it.company)}」已隱藏</span>${a.logId ? `<button type="button" class="cl-undo" data-cl-bar-undo="${e(id)}">復原</button>` : ''}<button type="button" class="cl-hid-bar-x" data-cl-bar-close aria-label="關閉提示">關閉</button></div>`);
  wrap.querySelector('[data-cl-bar-undo]')?.focus({ preventScroll: true });
  S.hidBarTimer = setTimeout(closeHidBar, 15000);
}
function putRowBack(it, nextId) {
  const list = S.target && S.target.querySelector('.cl-list'); if (!list) return;
  const next = nextId && list.querySelector(`[data-cl-id="${CSS.escape(nextId)}"]`);
  if (!list.querySelector('[data-cl-id]')) list.innerHTML = '';
  if (next) next.insertAdjacentHTML('beforebegin', rowHtml(it));
  else list.insertAdjacentHTML('beforeend', rowHtml(it));
}
function markUnsentExcept(id) {
  S.active = id;
  Object.keys(S.pending).forEach((k) => {
    if (k !== id && isDirty(k) && !S.unsent.has(k)) { S.unsent.add(k); rerenderRow(k); }
  });
}

async function submitRow(id) {
  const it = S.items.find((x) => String(x.id) === id); if (!it) return;
  const p = pend(id);
  const who = me();
  if (!who) { toast('先在畫面最上方「我是」選你的名字，系統才記得是誰打的', 'error'); document.querySelector('[data-me-global]')?.focus(); return; }
  if (!p.result) { toast('先點一個狀態', 'error'); return; }
  if (p.result === 'callback' && !p.cb) { toast('再約時間要先選日期時間', 'error'); return; }
  if (p.result === 'callback' && p.cb < nowLocal()) { toast('這個時間已經過了，請選未來的時間', 'error'); return; }
  const btn = S.target.querySelector(`[data-cl-id="${CSS.escape(id)}"] [data-cl-send]`); if (btn) { btn.disabled = true; btn.textContent = '儲存中…'; }
  const note = p.note.trim();
  let prevSnap = null;
  try {
    if (S.cfg.kind === 'cand') {
      const r = await api.post(`/admin/call-lists/${encodeURIComponent(S.listId)}/result`, { item_id: it.id, result: p.result, note, by: who, callback_at: p.cb || '' });
      Object.assign(it, { last_result: p.result, last_note: note || null, last_at: r.last_at, last_by: who, callback_at: p.result === 'callback' ? p.cb : null, call_count: (Number(it.call_count) || 0) + 1 });
      patchCallLight(it.lights, p.result);
    } else {
      const cbTxt = p.result === 'callback' ? `再打電話（約 ${md(p.cb)}）` : p.result === 'send_info' ? '寄公司介紹資料給對方' : '';
      // 資料庫有一條自動規則：每寫一筆紀錄就清掉這家舊的下一步、請 AI 重排。顧問剛打字的「這週要做」不能被清，一起帶進去
      clearTimeout(S.weekTimers[id]); delete S.weekTimers[id];
      const typedWeek = id in S.week ? S.week[id].trim() : '';
      const nextStep = typedWeek || cbTxt;
      const nextDue = p.result === 'callback' ? p.cb.slice(0, 10) : p.result === 'send_info' ? nowLocal().slice(0, 10) : '';
      prevSnap = { prevItem: { last_result: it.last_result, last_note: it.last_note, last_at: it.last_at, last_by: it.last_by, last_log_id: it.last_log_id, last_next_step: it.last_next_step, callback_at: it.callback_at, call_count: it.call_count, history: it.history }, prevStatus: it.status_info, prevNext: { next_step: (it.status_info || {}).next_step, next_due: (it.status_info || {}).next_due } };
      const r = await api.post('/admin/bd/log', {
        company: it.company, kind: 'call', result: p.result, note: note || (p.result === 'send_info' ? '對方請我們寄資料' : ''), by: who, outreach_id: it.id,
        event_at: nowLocal(), next_step: nextStep, next_due: nextDue,
      });
      delete S.week[id]; delete S.weekMsg[id];
      it.status_info = { ...(it.status_info || {}), next_step: nextStep || null, next_due: nextStep ? (nextDue || null) : null, ai_action: null, ai_due: null, ai_memo: null };
      Object.assign(it, { last_result: p.result, last_note: note || (p.result === 'send_info' ? '對方請我們寄資料' : null), last_at: nowLocal(), last_by: who, last_log_id: r.id, last_next_step: nextStep || null, callback_at: p.result === 'callback' ? p.cb : null, call_count: (Number(it.call_count) || 0) + 1 });
    }
    let remindMsg = '';
    if (p.result === 'callback') {
      try {
        const rr = await api.post('/admin/consultant-reminders', S.cfg.kind === 'cand'
          ? { for: who, application_id: it.application_id, candidate_name: it.name, call_at: p.cb, note: '電話名單：再約時間' + (note ? '｜' + note : '') }
          : { for: who, candidate_name: it.company, call_at: p.cb, note: '公司開發：再約時間' + (note ? '｜' + note : '') });
        remindMsg = `，${md(rr.remind_at)} 會 TG 提醒你`;
      } catch (err) { toast(`紀錄已存，但 TG 提醒沒設成：${err.message || '失敗'}`, 'error'); }
    }
    delete S.pending[id]; S.unsent.delete(id); S.open[id] = false;
    toast(`已記錄「${labelOf(it.last_result)}」${remindMsg}`, 'success');
    if (S.cfg.kind === 'bd') {
      it.history = [{ at: it.last_at, result: it.last_result, note: it.last_note, caller: who, kind: 'call' }, ...(it.history || [])];
      // 公司名單：這一列就地更新，不重排、不跳走。2026-11-06 Jacky：沒意願要立刻隱藏，復原改放在畫面下方的提示列
      const hiddenNow = !!bdHiddenWhy(it);
      S.acted[id] = { text: hiddenNow ? `已記錄「${labelOf(it.last_result)}」，這家已移到「已隱藏」` : `已記錄「${labelOf(it.last_result)}」`, logId: ['send_info', 'callback'].includes(it.last_result) ? '' : it.last_log_id, ...prevSnap };
      if (hiddenNow && S.filter !== 'hidden') { hideRowNow(id, it); refreshBdCounts(); }
      else {
        rerenderRow(id); refreshBdCounts();
        S.target.querySelector(`[data-cl-id="${CSS.escape(id)}"] .cl-undo, [data-cl-id="${CSS.escape(id)}"] .cl-qb`)?.focus();
      }
    } else renderAll();
    // 右欄正開著這一家／這一位：重開一次，剛存的紀錄馬上看得到
    if (S.sel === id) S.target.querySelector(`[data-cl-id="${CSS.escape(id)}"]`)?.querySelector('[data-bd-company],[data-application]')?.click();
  } catch (err) {
    toast(err.message || '儲存失敗，請再按一次儲存', 'error');
    if (S.cfg.kind === 'bd' && p.result !== 'callback') p.result = '';
    if (btn) { btn.disabled = false; btn.textContent = '儲存'; }
  }
}

async function openResume(appId) {
  const w = window.open('', '_blank');   // 先開分頁，避免等下載完才開被瀏覽器擋
  try {
    const res = await fetch(`${CONFIG.apiBase}/admin/resume/${encodeURIComponent(appId)}`, {
      headers: { authorization: `Bearer ${localStorage.getItem(CONFIG.tokenKey) || ''}`, ...usageUserHeader() },
    });
    if (!res.ok) throw new Error(res.status === 404 ? '這位人選沒有履歷檔' : `打不開履歷（${res.status}）`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    if (w) w.location.href = url; else window.open(url, '_blank');
  } catch (err) { if (w) w.close(); toast(err.message || '打不開履歷', 'error'); }
}

function wire(t) {
  t.onclick = (ev) => {
    const el = ev.target instanceof Element ? ev.target : null; if (!el) return;
    if (el.closest('[data-cl-dock-close]')) { closeDock(); if (S.cfg === BD) bdRefreshSoon(300); return; }
    if (el.closest('#cl-dock')) { if (S.cfg === BD) bdRefreshSoon(4000); return; }   // 右欄卡片自己的按鈕，交給卡片處理；存了什麼，左邊過幾秒跟上
    const fold = el.closest('.cl-due-fold > summary'); if (fold) { ev.preventDefault(); saveUi({ dueOpen: !fold.parentElement.open }); renderAll(); return; }
    if (el.closest('[data-cl-tg]')) { const txt = tgText(tabRows()); navigator.clipboard?.writeText(txt).then(() => toast('TG 戰報已複製', 'success'), () => toast(txt)); return; }
    const row = el.closest('[data-cl-id]');
    // 點卡片（客戶卡片／人選卡片按鈕，或卡片空白處）→ 右欄打開完整卡片
    if (row && (el.closest('[data-bd-company],[data-application]') || (S.cfg !== BD && !el.closest('a,button,input,select,textarea,summary,details,label')))) {
      S.sel = row.dataset.clId;
      document.querySelectorAll('.cl-row.cl-sel').forEach((r) => r.classList.toggle('cl-sel', r === row)); row.classList.add('cl-sel');
      if (!el.closest('[data-bd-company],[data-application]')) row.querySelector('[data-bd-company],[data-application]')?.click();
      if (!el.closest('[data-bd-company],[data-application]')) return;
    }
    if (row) markUnsentExcept(row.dataset.clId);
    const tab = el.closest('[data-cl-tab]'); if (tab) { S.tab = tab.dataset.clTab; saveUi(); renderAll(); return; }
    const barUndo = el.closest('[data-cl-bar-undo]'); if (barUndo) { undoRow(barUndo.dataset.clBarUndo); return; }
    if (el.closest('[data-cl-bar-close]')) { closeHidBar(); return; }
    const f = el.closest('[data-cl-filter]'); if (f) { S.filter = f.dataset.clFilter; saveUi(); renderAll(); return; }
    const cvBtn = el.closest('[data-cl-resume]'); if (cvBtn) { openResume(cvBtn.dataset.clResume); return; }
    const jump = el.closest('[data-cl-jump]'); if (jump) { ev.preventDefault(); const card = S.target.querySelector(`[data-cl-id="${CSS.escape(jump.dataset.clJump)}"]`); if (card) { card.scrollIntoView({ behavior: 'smooth', block: 'start' }); card.classList.add('flash'); setTimeout(() => card.classList.remove('flash'), 1500); } else { S.filter = 'all'; renderAll(); } return; }
    if (!row) return;
    const id = row.dataset.clId;
    const qres = el.closest('[data-cl-qres]');
    if (qres) {
      if (!me()) { toast('先在畫面最上方「我是」選你的名字，系統才記得是誰打的', 'error'); document.querySelector('[data-me-global]')?.focus(); return; }
      const p = pend(id); p.result = qres.dataset.clQres; p.cb = ''; submitRow(id); return;
    }
    if (el.closest('[data-cl-restore]')) { restoreRow(id); return; }
    if (el.closest('[data-cl-undo]')) { undoRow(id); return; }
    const res = el.closest('[data-cl-res]');
    if (res) { const p = pend(id); p.result = p.result === res.dataset.clRes ? '' : res.dataset.clRes; rerenderRow(id); if (p.result === 'callback') S.target.querySelector(`[data-cl-id="${CSS.escape(id)}"] [data-cl-cb]`)?.focus(); return; }
    const q = el.closest('[data-cl-quick]'); if (q) { pend(id).cb = q.dataset.clQuick; rerenderRow(id); return; }
    if (el.closest('[data-cl-send]')) { submitRow(id); return; }
    if (el.closest('[data-cl-reopen]')) { S.open[id] = true; rerenderRow(id); return; }
    if (el.closest('[data-cl-close]')) { S.open[id] = false; delete S.pending[id]; S.unsent.delete(id); rerenderRow(id); }
  };
  t.oninput = (ev) => {
    const el = ev.target;
    if (el.matches && el.matches('[data-cl-q]')) { S.q = el.value; const l = S.target.querySelector('.cl-list'); if (l) l.innerHTML = listHtml(visibleRows()); return; }
    if (el.matches && el.matches('[data-cl-goal]')) { const n = parseInt(el.value, 10); if (n >= 5 && n <= 80) setGoal(S.cfg.kind, n); return; }
    const row = el.closest && el.closest('[data-cl-id]'); if (!row) return;
    const id = row.dataset.clId; const p = pend(id);
    if (el.matches('[data-cl-note]')) { p.note = el.value; }
    if (el.matches('[data-cl-week]')) { S.week[id] = el.value; clearTimeout(S.weekTimers[id]); S.weekTimers[id] = setTimeout(() => saveWeek(id), 900); }
  };
  t.onkeydown = (ev) => {
    const el = ev.target; if (!(el instanceof Element) || ev.key !== 'Enter' || ev.isComposing) return;
    if (el.matches('[data-cl-week]')) { ev.preventDefault(); saveWeek(el.closest('[data-cl-id]').dataset.clId); return; }
    if (!el.matches('[data-cl-note]')) return;
    ev.preventDefault(); const id = el.closest('[data-cl-id]').dataset.clId;
    if (S.cfg.kind === 'bd' && !pend(id).result) { saveNoteOnly(id); return; }
    if (pend(id).result) submitRow(id); else toast('先點一個狀態，再按儲存', 'error');
  };
  t.onfocusin = (ev) => { const row = ev.target.closest && ev.target.closest('[data-cl-id]'); if (row && row.dataset.clId !== S.active) markUnsentExcept(row.dataset.clId); };
  t.addEventListener('toggle', (ev) => { if (ev.target.matches && ev.target.matches('[data-cl-more]')) S.moreOpen = ev.target.open; }, true);
  t.onchange = (ev) => {
    const el = ev.target;
    if (el.matches('[data-cl-goal]')) { renderAll(); return; }
    if (el.closest('#cl-dock')) return;
    if (el.matches('[data-cl-week]')) { saveWeek(el.closest('[data-cl-id]').dataset.clId); return; }
    if (el.matches('[data-cl-cb]')) { const id = el.closest('[data-cl-id]').dataset.clId; pend(id).cb = el.value.replace('T', ' ').slice(0, 16); rerenderRow(id); return; }
    if (el.matches('[data-cl-list]')) { S.listId = el.value; loadCandidates(); }
    if (el.matches('[data-cl-major]')) { S.major = el.value; saveUi(); renderAll(); return; }
    if (el.matches('[data-cl-batch]')) { S.batch = el.value; loadBd(); }
  };
}
// 切回這個分頁時，超過一分鐘沒更新就抓新資料（別的顧問可能剛記過）
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.cfg === BD && Date.now() - S.loadedAt > 60000) bdRefreshSoon(0); });
window.addEventListener('beforeunload', (ev) => { if (Object.keys(S.pending).some(isDirty) || Object.keys(S.weekTimers).length) { ev.preventDefault(); ev.returnValue = ''; } });

function resetFor(cfg, target) {
  const ui = loadUi();
  if (S.cfg !== cfg) { S.pending = {}; S.open = {}; S.unsent = new Set(); }
  S.cfg = cfg; S.target = target; S.tab = ui.tab || me() || ''; S.filter = ui.filter || 'queue'; S.major = ui.major || ''; S.sel = '';
  if (cfg.kind === 'bd') { if (!['queue', 'all', 'hidden'].includes(S.filter)) S.filter = 'queue'; }
  else if (!['all', 'todo', 'queue', 'today'].includes(S.filter) && !cfg.results.some((r) => r[0] === S.filter)) S.filter = 'queue';
  target.innerHTML = '';
  wire(target);
}
async function loadCandidates() {
  const t = S.target;
  try {
    if (!S.lists.length || !S.listId) {
      S.lists = (await api.get('/admin/call-lists?kind=candidate')).lists || [];
      if (!S.lists.length) { t.innerHTML = '<div class="state"><strong>目前沒有電話名單</strong><p>請 Claude 幫你建一份名單。</p></div>'; return; }
      if (!S.lists.some((l) => l.id === S.listId)) S.listId = S.lists[0].id;
    }
    const r = await api.get(`/admin/call-lists/${encodeURIComponent(S.listId)}`);
    S.items = r.items || [];
    renderAll();
  } catch (err) { t.innerHTML = `<div class="state error"><strong>名單讀不到</strong><p>${e(err.message || '請重新整理')}</p></div>`; }
}
async function loadBd(silent = false) {
  const t = S.target;
  try {
    const one = S.batch && S.batch !== '*';
    const r = await api.get(`/admin/bd-batch-calls${one ? `?batch=${encodeURIComponent(S.batch)}` : ''}`);
    S.batches = r.batches || [];
    if (one) {
      S.batch = r.batch;
      // 2026-11-06 Jacky：每家只佔一列，同一批同公司有好幾個職缺也只留最前面那列
      const seen = new Set(); S.items = (r.items || []).filter((it) => (seen.has(it.company) ? false : seen.add(it.company)));
    } else {
      // 2026-10-29 Jacky：跟進中＋給 Phoebe 的新名單合在一起，系統自動排今天要打誰（同一家只留一張，以跟進中那張為準）
      const others = S.batches.filter((b) => b.batch_id !== r.batch);
      const more = await Promise.all(others.map((b) => api.get(`/admin/bd-batch-calls?batch=${encodeURIComponent(b.batch_id)}`).catch(() => ({ items: [] }))));
      const byCo = new Map();
      (r.items || []).forEach((it, i) => byCo.set(it.company, { ...it, _ord: i }));
      more.forEach((m, bi) => (m.items || []).forEach((it, i) => { const had = byCo.get(it.company); if (!had) byCo.set(it.company, { ...it, _ord: 1000 * (bi + 1) + i }); else if (it.assigned_to && !String(had.assignees || had.assigned_to || '').split(',').includes(it.assigned_to)) had.assignees = [had.assignees || had.assigned_to, it.assigned_to].filter(Boolean).join(','); }));
      S.batch = '*'; S.items = [...byCo.values()];
    }
    S.loadedAt = Date.now();
    if (!S.items.length) { t.innerHTML = '<div class="state"><strong>目前沒有開發名單</strong></div>'; return; }
    if (silent) { const y = window.scrollY; renderAll(); window.scrollTo(0, y); } else renderAll();
  } catch (err) { if (!silent) t.innerHTML = `<div class="state error"><strong>名單讀不到</strong><p>${e(err.message || '請重新整理')}</p></div>`; }
}

export function loadCallList(target) { resetFor(CAND, target); target.innerHTML = '<div class="state loading"><span class="spinner"></span><div>讀取名單…</div></div>'; return loadCandidates(); }
export function loadBdCalls(target) { resetFor(BD, target); target.innerHTML = '<div class="state loading"><span class="spinner"></span><div>讀取名單…</div></div>'; return loadBd(); }
