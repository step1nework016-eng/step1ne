// 2026-10-15 Jacky：招募管道管理（看板＋抽屜）。
// 找 BIM 工程師會請很多家訓練機構幫忙推人，要追每一家的進度、下次什麼時候追、推了幾個人、成效如何。
// 一家一張卡；拖到別欄＝改狀態。點卡片開抽屜：基本資料、合作職缺、聯絡紀錄、這家推來的人選與成效。
// 成效數字是從「連到這家的人選」自動算的（推薦→談過→推給客戶→錄取），人選要在抽屜裡用名字加進來。
import { api } from './core/api.js';
import { $, closeOverlay, drawer, errorState, loading, toast } from './core/ui.js';
import { escapeHtml } from './core/security.js';

const esc = escapeHtml;
const COLS = [
  ['todo', '還沒聯絡', '名單上，還沒打過電話或寄信'],
  ['contacted', '已聯絡', '聯絡過，還沒談合作方式'],
  ['talking', '洽談中', '在談怎麼合作、要推什麼人'],
  ['active', '合作中', '正在幫我們推人'],
  ['paused', '暫停／不合作', '先停或談不成'],
];
const KINDS = ['訓練機構', '學校／系所', '職訓局／公部門', '社群／社團', '人力平台', '其他'];
let hooks = { openCandidate: null };
// 2026-10-15 Jacky：負責人預設 Phoebe（電訪是她在打），可以改選別人
const DEFAULT_OWNER = 'Phoebe';
let consultantNames = null;
async function loadConsultantNames() {
  if (consultantNames) return consultantNames;
  try { consultantNames = ((await api.get('/admin/consultants')).consultants || []).filter((c) => c.is_active).map((c) => c.display_name); } catch { consultantNames = []; }
  return consultantNames;
}
function ownerOptions(cur) {
  const names = [...new Set([...(consultantNames || []), cur].filter(Boolean))];
  return names.map((n) => `<option ${n === cur ? 'selected' : ''}>${esc(n)}</option>`).join('');
}
let data = { channels: [], jobs: [], statuses: {} };
let target = null;
const VIEW_KEY = 's1ne_channels_view';
const ui = { tab: 'log', owner: '', q: '', view: (() => { try { return localStorage.getItem(VIEW_KEY) || 'board'; } catch { return 'board'; } })() };

export function initChannels(h) { hooks = { ...hooks, ...h }; }
const me = () => (document.querySelector('[data-me-global]') || {}).value || '';
const today = () => new Date().toLocaleDateString('en-CA');
const jobTitle = (slug) => (data.jobs.find((j) => j.slug === slug) || {}).title || slug;
const needMe = () => { if (me()) return false; toast('請先在最上方「我是」選你的名字', 'error'); return true; };

function dueTone(c) {
  if (!c.next_follow_at || c.status === 'paused') return '';
  const t = today();
  return c.next_follow_at < t ? 'bad' : c.next_follow_at === t ? 'warn' : '';
}
function cardHtml(c) {
  const tone = dueTone(c);
  const due = c.next_follow_at ? (tone === 'bad' ? `逾期 ${c.next_follow_at.slice(5)}` : tone === 'warn' ? '今天要追' : `下次追 ${c.next_follow_at.slice(5)}`) : '沒設下次追蹤日';
  const s = c.stats || {};
  const jobs = (c.jobs || []).map(jobTitle).join('、');
  return `<div class="bk-wrap"><button type="button" class="bk-card ${tone ? 'bk-' + tone : ''}" draggable="true" data-ch-id="${c.id}" title="點開看詳細；按住拖到別欄可改狀態">
    <span class="bk-top"><strong>${esc(c.name)}</strong>${c.owner ? `<em>${esc(c.owner)}</em>` : ''}</span>
    ${jobs ? `<span class="bk-sub">${esc(jobs)}</span>` : ''}
    <span class="ch-stats"><b>推 ${s.referred || 0}</b>｜談 ${s.talked || 0}｜送客戶 ${s.forwarded || 0}｜錄取 ${s.hired || 0}</span>
    ${c.next_step ? `<span class="bk-note">下一步：${esc(c.next_step)}</span>` : ''}
    <span class="bk-age">${esc(due)}</span>
  </button></div>`;
}
function boardHtml() {
  const owners = [...new Set(data.channels.map((c) => c.owner).filter(Boolean))].sort();
  const q = ui.q.trim().toLowerCase();
  const shown = data.channels.filter((c) => (!ui.owner || c.owner === ui.owner) && (!q || [c.name, c.contact_name, c.note].join(' ').toLowerCase().includes(q)));
  const due = shown.filter((c) => dueTone(c)).length;
  const tot = shown.reduce((a, c) => { const s = c.stats || {}; a[0] += s.referred || 0; a[1] += s.talked || 0; a[2] += s.forwarded || 0; a[3] += s.hired || 0; return a; }, [0, 0, 0, 0]);
  const bar = `<div class="bk-bar">
      <div class="ch-viewsw" role="group" aria-label="顯示方式"><button type="button" class="btn sm ${ui.view === 'board' ? 'primary' : ''}" data-ch-view="board" aria-pressed="${ui.view === 'board'}">看板</button><button type="button" class="btn sm ${ui.view === 'table' ? 'primary' : ''}" data-ch-view="table" aria-pressed="${ui.view === 'table'}">表格</button></div>
      <label class="bk-filter"><span>負責人</span><select data-ch-filter="owner"><option value="">全部</option>${owners.map((o) => `<option ${ui.owner === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>
      <label class="bk-filter"><span>搜尋</span><input data-ch-filter="q" value="${esc(ui.q)}" placeholder="機構名、窗口…" style="min-height:40px"></label>
      <span class="bk-sum">共 ${shown.length} 家${due ? `｜<b class="bk-redtxt">${due} 家該追</b>` : ''}｜合計 推 ${tot[0]}・談 ${tot[1]}・送客戶 ${tot[2]}・錄取 ${tot[3]}</span>
    </div>`;
  if (ui.view === 'table') {
    const order = Object.fromEntries(COLS.map(([k], i) => [k, i]));
    const rows = shown.slice().sort((a, b) => (dueTone(b) ? 1 : 0) - (dueTone(a) ? 1 : 0) || (order[a.status] - order[b.status]) || String(a.next_follow_at || '9999').localeCompare(String(b.next_follow_at || '9999')));
    return bar + `<div class="ch-tablewrap"><table class="ch-table"><thead><tr><th>機構</th><th>狀態</th><th>類型</th><th>窗口</th><th>電話</th><th>下次追蹤</th><th>下一步</th><th>推／談／送／錄</th><th>負責</th></tr></thead><tbody>${rows.map((c) => {
      const tone = dueTone(c); const st = c.stats || {};
      return `<tr data-ch-row="${c.id}" tabindex="0"><td><b>${esc(c.name)}</b></td>
        <td><select data-ch-status="${c.id}" aria-label="${esc(c.name)} 狀態">${COLS.map(([k, t]) => `<option value="${k}" ${c.status === k ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></td>
        <td>${esc(c.kind || '')}</td><td>${esc(c.contact_name || '')}</td><td class="ch-nowrap">${esc(c.phone || '')}</td>
        <td class="ch-nowrap ${tone === 'bad' ? 'aging-bad' : tone === 'warn' ? 'aging-warn' : ''}">${esc(c.next_follow_at || '—')}${tone === 'bad' ? '（逾期）' : tone === 'warn' ? '（今天）' : ''}</td>
        <td>${esc(c.next_step || '')}</td><td class="ch-nowrap">${st.referred || 0}／${st.talked || 0}／${st.forwarded || 0}／${st.hired || 0}</td><td>${esc(c.owner || '')}</td></tr>`;
    }).join('') || '<tr><td colspan="9" class="help">目前沒有</td></tr>'}</tbody></table></div>`;
  }
  const cols = COLS.map(([k, title, hint]) => {
    const list = shown.filter((c) => c.status === k).sort((a, b) => (dueTone(b) ? 1 : 0) - (dueTone(a) ? 1 : 0) || String(a.next_follow_at || '9999').localeCompare(String(b.next_follow_at || '9999')));
    const red = list.filter((c) => dueTone(c)).length;
    return `<section class="bk-col" data-ch-col="${k}" aria-label="${esc(title)}"><header><h3>${esc(title)}<b>${list.length}</b></h3><small>${esc(hint)}${red ? `<span class="bk-redcount">${red} 家該追</span>` : ''}</small></header>
      <div class="bk-list">${list.length ? list.map(cardHtml).join('') : '<p class="bk-empty">目前沒有</p>'}</div></section>`;
  }).join('');
  return bar + `<div class="bk-board" style="--bk-cols:${COLS.length}">${cols}</div>`;
}

export async function loadChannelsTab(el) {
  target = el;
  // 2026-10-16：已經顯示過的看板重新整理時不清空畫面（同 core/ui.js boundary 的做法）
  const refresh = target.dataset.ready === '1' && target.childElementCount > 0;
  const y = window.scrollY;
  if (!refresh) target.innerHTML = loading(); else target.classList.add('is-refreshing');
  try { data = await api.get('/admin/channels'); } catch (e) { target.classList.remove('is-refreshing'); if (!refresh) target.innerHTML = errorState(e); return; }
  target.classList.remove('is-refreshing');
  draw();
  target.dataset.ready = '1';
  if (refresh) window.scrollTo(0, y);
}
function draw() {
  if (!target || !document.body.contains(target)) return;
  target.innerHTML = boardHtml();
  target.querySelectorAll('[data-ch-filter]').forEach((el) => {
    const k = el.getAttribute('data-ch-filter');
    el.addEventListener(k === 'q' ? 'input' : 'change', () => {
      ui[k] = el.value;
      if (k === 'q') { const pos = el.selectionStart; draw(); const n = target.querySelector('[data-ch-filter="q"]'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } } else draw();
    });
  });
  target.querySelectorAll('[data-ch-view]').forEach((b) => b.addEventListener('click', () => { ui.view = b.getAttribute('data-ch-view'); try { localStorage.setItem(VIEW_KEY, ui.view); } catch { /* 存不了就算了 */ } draw(); }));
  target.querySelectorAll('[data-ch-row]').forEach((tr) => {
    const open = (e) => { if (e.target.closest('select')) return; openChannel(Number(tr.getAttribute('data-ch-row'))); };
    tr.addEventListener('click', open); tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(e); });
  });
  target.querySelectorAll('[data-ch-status]').forEach((sel) => sel.addEventListener('change', async () => {
    const id = Number(sel.getAttribute('data-ch-status')); const c = data.channels.find((x) => x.id === id);
    if (needMe()) { sel.value = c.status; return; }
    try { await api.post('/admin/channels/save', { id, status: sel.value, by: me() }); c.status = sel.value; toast(`已改成「${data.statuses[sel.value] || sel.value}」`, 'success'); draw(); }
    catch (err) { sel.value = c.status; toast(err.message || '改狀態失敗', 'error'); }
  }));
  target.querySelectorAll('[data-ch-id]').forEach((card) => {
    card.addEventListener('click', () => openChannel(Number(card.getAttribute('data-ch-id'))));
    card.addEventListener('dragstart', (e) => { card.classList.add('bk-dragging'); try { e.dataTransfer.setData('text/plain', card.getAttribute('data-ch-id')); e.dataTransfer.effectAllowed = 'move'; } catch { /* 舊瀏覽器 */ } });
    card.addEventListener('dragend', () => { card.classList.remove('bk-dragging'); target.querySelectorAll('.bk-over').forEach((c) => c.classList.remove('bk-over')); });
  });
  target.querySelectorAll('[data-ch-col]').forEach((col) => {
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('bk-over'); });
    col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('bk-over'); });
    col.addEventListener('drop', async (e) => {
      e.preventDefault(); col.classList.remove('bk-over');
      let id = 0; try { id = Number(e.dataTransfer.getData('text/plain')); } catch { /* 舊瀏覽器 */ }
      const c = data.channels.find((x) => x.id === id); const to = col.getAttribute('data-ch-col');
      if (!c || c.status === to || needMe()) return;
      try { await api.post('/admin/channels/save', { id, status: to, by: me() }); c.status = to; draw(); toast(`已改成「${data.statuses[to] || to}」`, 'success'); }
      catch (err) { toast(err.message || '改狀態失敗', 'error'); }
    });
  });
}

// ── 抽屜 ──
function formHtml(c) {
  const v = (k) => esc(c[k] || '');
  const sel = (k, opts) => opts.map(([val, lab]) => `<option value="${esc(val)}" ${String(c[k] || '') === String(val) ? 'selected' : ''}>${esc(lab)}</option>`).join('');
  const jobs = new Set(c.jobs || []);
  const jobList = data.jobs.slice().sort((a, b) => (jobs.has(b.slug) ? 1 : 0) - (jobs.has(a.slug) ? 1 : 0));
  return `<form data-ch-form class="ch-form">
    <div class="form-grid">
      <label class="field span-2"><span>機構名稱 *</span><input name="name" value="${v('name')}" required maxlength="80" placeholder="例：某某職訓中心"></label>
      <label class="field"><span>狀態</span><select name="status">${sel('status', COLS.map(([k, t]) => [k, t]))}</select></label>
      <label class="field"><span>類型</span><select name="kind">${sel('kind', KINDS.map((k) => [k, k]))}</select></label>
      <label class="field"><span>下次追蹤日</span><input type="date" name="next_follow_at" value="${v('next_follow_at')}"></label>
      <label class="field"><span>負責顧問</span><select name="owner">${ownerOptions(c.owner || DEFAULT_OWNER)}</select></label>
      <label class="field span-2"><span>下一步要做什麼</span><input name="next_step" value="${v('next_step')}" maxlength="200" placeholder="例：寄職缺說明給窗口、約下週去說明會"></label>
      <label class="field"><span>窗口</span><input name="contact_name" value="${v('contact_name')}" maxlength="60"></label>
      <label class="field"><span>電話</span><input name="phone" value="${v('phone')}" maxlength="60" inputmode="tel"></label>
      <label class="field"><span>Email</span><input name="email" value="${v('email')}" maxlength="120" inputmode="email"></label>
      <label class="field"><span>網站</span><input name="website" value="${v('website')}" maxlength="300" placeholder="https://"></label>
      <div class="field span-2"><span>合作職缺（可多選）</span>
        <input data-ch-jobq placeholder="打字篩選職缺…" style="margin-bottom:6px">
        <div class="ch-jobs">${jobList.map((j) => `<label class="ch-job"><input type="checkbox" name="jobs" value="${esc(j.slug)}" ${jobs.has(j.slug) ? 'checked' : ''}><span>${esc(j.title)}</span></label>`).join('')}</div></div>
      <label class="field span-2"><span>備註</span><textarea name="note" rows="3" maxlength="2000" placeholder="合作條件、學員特色、要注意的事">${v('note')}</textarea></label>
    </div>
    <div class="actions-row"><button class="btn primary" type="submit">${c.id ? '儲存' : '新增這家'}</button>${c.id ? '<button class="btn danger sm" type="button" data-ch-del style="margin-left:auto">刪除這家</button>' : ''}</div>
  </form>`;
}
function stageOf(r) {
  const st = String(r.fwd_stage || r.manual_stage || '');
  if (st === 'onboard') return '已到職';
  if (st === 'offer') return '錄取';
  if (r.forwards > 0) return '已推給客戶';
  if (r.interview_ended_at || r.consultant_call_at) return '談過';
  return '剛推來';
}
// 2026-10-15 Jacky：聯絡紀錄比照「開發進度」卡片（下一步大色塊、統計、進度階段、新增紀錄表單、時間軸），沿用 bdc-* 樣式
const RESULTS = [['no_answer', '沒接／沒人'], ['gatekeeper', '被擋在總機'], ['got_contact', '問到承辦人'], ['got_email', '拿到信箱'], ['will_forward', '願意轉發職缺'], ['evaluating', '要再評估'], ['has_students', '有學員可推'], ['declined', '不接受合作'], ['other', '其他']];
const RESULT_ZH = Object.fromEntries(RESULTS);
const KIND_ZH = { call: '電話', mail: '寄信', other: '其他' };
const WD = '日一二三四五六';
const ICON = {
  call: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg>',
  mail: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  other: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
};
const taipeiNow = () => new Date(Date.now() + 8 * 3600e3);
const nowLocal = () => taipeiNow().toISOString().slice(0, 16);
const md = (t) => { t = String(t || ''); if (!/^\d{4}-\d{2}-\d{2}/.test(t)) return ''; const d = new Date(`${t.slice(0, 10)}T00:00:00Z`); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${WD[d.getUTCDay()]}）`; };
const mdTime = (s) => { const t = String(s || '').replace('T', ' '); return t.length >= 16 ? `${md(t)} ${t.slice(11, 16)}` : md(t); };
const logTime = (l) => String(l.event_at || l.at || '').replace('T', ' ');
function dueInfo(due) {
  if (!due) return { t: '沒有設期限', late: false };
  const diff = Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today()}T00:00:00Z`)) / 86400000);
  if (diff < 0) return { t: `已逾期 ${-diff} 天（原定 ${md(due)}）`, late: true };
  if (diff === 0) return { t: `今天要做（${md(due)}）`, late: false };
  if (diff === 1) return { t: `明天（${md(due)}）`, late: false };
  return { t: `${diff} 天後（${md(due)}）`, late: false };
}
function topHtml(d) {
  const c = d.channel; const logs = d.logs || [];
  const userLogs = logs.filter((l) => ['call', 'mail', 'other'].includes(l.kind));
  let next;
  if (c.next_step || c.next_follow_at) {
    const di = dueInfo(c.next_follow_at);
    const src = logs.find((l) => l.id === c.next_log_id);
    const from = src ? `這是 ${esc(mdTime(logTime(src)))} ${esc(src.by || '顧問')} 寫的${src.result || src.text ? `　·　當時狀況：${esc(RESULT_ZH[src.result] || KIND_ZH[src.kind] || '')}${src.text ? '：' + esc(String(src.text).slice(0, 40)) + (String(src.text).length > 40 ? '…' : '') : ''}` : ''}` : '';
    next = `<section class="bdc-next${di.late ? ' late' : ''}"><div class="bdc-lbl">下一步</div><div class="bdc-what">${esc(c.next_step || '（沒寫要做什麼）')}</div><div class="bdc-when">${esc(di.t)}</div>${from ? `<div class="bdc-from">${from}</div>` : ''}
      <div class="bdc-row"><button type="button" class="bdc-btn solid" data-ch-next="done">做完了，記一筆</button><button type="button" class="bdc-btn" data-ch-next="snooze">延 1 天</button></div></section>`;
  } else {
    const last = userLogs[0];
    next = `<section class="bdc-next none"><div class="bdc-lbl">下一步</div><div class="bdc-what">目前沒有待辦</div><div class="bdc-from">${last ? `上一次紀錄：${esc(mdTime(logTime(last)))}　${esc(last.by || '')}　${esc(RESULT_ZH[last.result] || KIND_ZH[last.kind] || '')}` : '還沒有任何紀錄'}</div>
      <div class="bdc-row"><button type="button" class="bdc-btn" data-ch-newlog>新增紀錄</button></div></section>`;
  }
  const s = d.stats || {};
  const calls = userLogs.filter((l) => l.kind === 'call').length;
  const mails = userLogs.filter((l) => l.mail_sent || l.kind === 'mail').length;
  const last = userLogs[0];
  const stat = `<section class="bdc-sec"><p class="bdc-statline">📞 <b>${calls}</b> 通電話　✉ <b>${mails}</b> 封信　🗓 最後聯繫 <b>${last ? esc(md(logTime(last))) : '—'}</b>${last ? `（${esc(last.by || '')}）` : ''}　👥 推來 <b>${s.referred || 0}</b>・談過 <b>${s.talked || 0}</b>・送客戶 <b>${s.forwarded || 0}</b>・錄取 <b>${s.hired || 0}</b></p></section>`;
  const cnt = {}; const lastAt = {};
  logs.slice().reverse().forEach((l) => { if (l.status_to) { cnt[l.status_to] = (cnt[l.status_to] || 0) + 1; lastAt[l.status_to] = logTime(l); } });
  const sub = (k) => (cnt[k] ? `${cnt[k] > 1 ? `×${cnt[k]}　` : ''}${esc(md(lastAt[k]))}` : '—');
  const main = COLS.filter(([k]) => k !== 'paused'); const ci = main.findIndex(([k]) => k === c.status);
  const steps = `<section class="bdc-sec"><h4>開發進度 <small>要換階段，在這裡點，再記一筆</small></h4>
    <div class="bdc-steps" role="radiogroup" aria-label="合作階段">${main.map(([k, t], i) => `<button type="button" class="bdc-step${i < ci ? ' past' : ''}${i === ci ? ' now' : ''}" role="radio" aria-checked="${i === ci}" data-ch-stage="${k}"><b>${esc(t)}</b><span>${sub(k)}</span></button>`).join('')}</div>
    <div class="bdc-exits"><button type="button" class="bdc-step${c.status === 'paused' ? ' now red' : ''}" data-ch-stage="paused"><b>暫停／不合作</b><span>${sub('paused')}</span></button><span class="bdc-hint">對方不接受合作或先擱著，按左邊。</span></div></section>`;
  return `<div class="bdc">${next}${stat}${steps}</div>`;
}
function logPaneHtml(d) {
  const c = d.channel; const logs = d.logs || [];
  const people = [...new Set([c.owner, ...(consultantNames || []), me()].filter(Boolean))];
  const item = (l) => {
    const k = ['call', 'mail', 'other'].includes(l.kind) ? l.kind : null;
    if (!k) return `<li class="bdc-item sys"><span class="bdc-dot" aria-hidden="true">${ICON.other}</span><div class="bdc-card bdc-sys"><div class="bdc-top"><span class="bdc-t">${esc(l.text || '')}</span><span class="bdc-time">${esc(mdTime(logTime(l)))}　${esc(l.by || '系統')}</span></div></div></li>`;
    const sent = l.mail_sent ? `<span class="bdc-chip ok">信已寄出 ${esc(mdTime(l.mail_sent_at || logTime(l)))}</span>` : (k === 'mail' ? '<span class="bdc-chip no">信還沒寄</span>' : '');
    const nxt = l.next_step || l.next_due ? `<div class="bdc-nxt${l.next_done ? ' done' : ''}">下一步：${esc(l.next_step || '')}${l.next_due ? `（${esc(md(l.next_due))}）` : ''}${l.next_done ? '　已完成' : ''}</div>` : '';
    return `<li class="bdc-item ${k}"><span class="bdc-dot" aria-hidden="true">${ICON[k]}</span><div class="bdc-card">
      <div class="bdc-top"><span class="bdc-t">${KIND_ZH[k]}${l.result ? `　${esc(RESULT_ZH[l.result] || l.result)}` : ''}</span><span class="bdc-time">${esc(mdTime(logTime(l)))}　${esc(l.by || '')}</span></div>
      <div class="bdc-chips">${sent}${l.status_to ? `<span class="bdc-chip stage">階段 → ${esc(data.statuses[l.status_to] || l.status_to)}</span>` : ''}</div>
      ${l.text ? `<p class="bdc-note">${esc(l.text)}</p>` : ''}${l.contact_name ? `<small class="muted">問到：${esc(l.contact_name)}</small>` : ''}${nxt}
      <div class="bdc-mini">${!l.mail_sent && k !== 'other' ? `<button type="button" data-ch-sent="${l.id}">標記信已寄出</button>` : ''}${(l.next_step || l.next_due) && !l.next_done ? `<button type="button" data-ch-done="${l.id}">這步做完了</button>` : ''}<button type="button" class="bd-del" data-ch-logdel="${l.id}">刪除</button></div>
    </div></li>`;
  };
  return `<section class="bdc-logpane">
    <h4 class="bdc-h">新增紀錄 <small>每一個動作都記一筆</small></h4>
    <div class="bdc-need" data-ch-need hidden></div>
    <form class="bdc-form" data-ch-logform autocomplete="off">
      <div class="bdc-seg" role="radiogroup" aria-label="做了什麼">${Object.entries(KIND_ZH).map(([v, lb], i) => `<label><input type="radio" name="kind" value="${v}"${i === 0 ? ' checked' : ''}><span>${lb}</span></label>`).join('')}</div>
      <div class="bdc-grid">
        <label class="bdc-f">時間<input type="datetime-local" name="event_at" value="${nowLocal()}" required></label>
        <label class="bdc-f" data-ch-call>結果<select name="result">${RESULTS.map(([v, lb]) => `<option value="${v}">${lb}</option>`).join('')}</select></label>
        <label class="bdc-f">誰記的<select name="by">${people.map((x) => `<option${x === (me() || c.owner) ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
        <label class="bdc-f" data-ch-call>問到的窗口（選填）<input name="contact_name" maxlength="60" placeholder="例：曾小姐 分機1621"></label>
        <div class="bdc-f full"><label class="bdc-check"><input type="checkbox" name="mail_sent"> 這次有寄信　<small class="muted">（勾了才記「已寄出」和時間）</small></label></div>
        <label class="bdc-f full">備註<textarea name="note" rows="3" placeholder="聊到什麼、對方說什麼（例：承辦人說下週一把職缺發給 AutoCAD 班學員）"></textarea></label>
        <div class="bdc-f full ch-ai" data-ch-mail data-email="${esc(c.email || '')}" hidden>
          <div class="ch-ai-row"><button type="button" class="bdc-btn" data-ch-ai>AI 幫我擬信</button><button type="button" class="bdc-btn" data-ch-self>自己寫</button><small class="muted" data-ch-ai-msg>會參考上面「備註」寫的內容（例：洪先生不在，請我把職缺寄到信箱），約 1～2 分鐘擬好</small></div>
          <div class="ch-draft" data-ch-draft hidden>
            <label class="bdc-f">收件人<input type="email" name="m_to" maxlength="120" placeholder="對方的 Email"></label>
            <label class="bdc-f">主旨<input type="text" name="m_subject" maxlength="200"></label>
            <label class="bdc-f">內文（可以直接改）<textarea name="m_text" rows="16"></textarea></label>
            <label class="bdc-f">附加檔案（選填，最多 5 個、每個 8MB 內；pdf、word、excel、ppt、圖片）<input type="file" name="m_files" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.odt,.ods"></label>
            <div class="ch-files muted" data-ch-files></div>
            <div class="bdc-actions"><button type="button" class="bdc-btn primary" data-ch-send>寄出這封信</button><small class="muted">從 official@step1ne.com 寄出，署名是「誰記的」那位；寄出後自動記一筆「信已寄出」</small></div>
          </div>
        </div>
        <label class="bdc-f">階段調整<select name="status_to"><option value="">不調整</option>${COLS.map(([k, t]) => `<option value="${k}">${esc(t)}</option>`).join('')}</select></label>
        <label class="bdc-f">下一步到期日<input type="date" name="next_due"></label>
        <label class="bdc-f full">下一步要做什麼<input type="text" name="next_step" maxlength="200" placeholder="例：寄 BIM 職缺說明給曾小姐，週五再打電話確認有沒有轉發"></label>
      </div>
      <div class="bdc-actions"><button type="submit" class="bdc-btn primary">存這筆紀錄</button></div>
    </form>
    <h4 class="bdc-h">全部紀錄 <small>共 ${logs.length} 筆</small></h4>
    ${logs.length ? `<ol class="bdc-tl">${logs.map(item).join('')}</ol>` : '<p class="help">還沒有紀錄。打完電話或寄完信，在上面記一筆。</p>'}
  </section>`;
}
function refsHtml(d) {
  const refs = (d.refs || []).map((r) => `<div class="list-row"><span><b class="ch-link" data-ch-cand="${esc(r.application_id)}" role="button" tabindex="0">${r.seq_no ? '#' + r.seq_no + ' ' : ''}${esc(r.name || '（找不到人選）')}</b><small>${esc(r.job_title || '')}${r.owner ? '｜' + esc(r.owner) : ''}｜${esc(String(r.created_at || '').slice(0, 10))} 加入</small></span><span class="badge info">${esc(stageOf(r))}</span><button class="btn sm" data-ch-unref="${esc(r.application_id)}" title="不是這家推來的，移掉">移除</button></div>`).join('');
  return `<p class="help">人選要先在系統裡（應徵或手動新增過），打名字或編號找到後按「加入」。上面的推來／談過／送客戶／錄取會自動算。</p>
    <div class="ch-search"><input data-ch-q placeholder="打人選名字、編號或電話" style="flex:1"><button class="btn" type="button" data-ch-find>找</button></div>
    <div data-ch-results class="list"></div>
    <div class="list" style="margin-top:8px">${refs || '<p class="help">還沒有連到任何人選</p>'}</div>`;
}
function detailHtml(d) {
  const tab = ui.tab || 'log';
  const tabs = [['log', '進度紀錄'], ['refs', `推來的人選（${(d.refs || []).length}）`], ['info', '基本資料']];
  return `${topHtml(d)}
    <div class="tabs ch-tabs" role="tablist">${tabs.map(([k, t]) => `<button type="button" role="tab" class="${tab === k ? 'active' : ''}" aria-selected="${tab === k}" data-ch-tab="${k}">${esc(t)}</button>`).join('')}</div>
    <div data-ch-pane="log" ${tab === 'log' ? '' : 'hidden'}>${logPaneHtml(d)}</div>
    <div data-ch-pane="refs" ${tab === 'refs' ? '' : 'hidden'}>${refsHtml(d)}</div>
    <div data-ch-pane="info" ${tab === 'info' ? '' : 'hidden'}>${formHtml(d.channel)}</div>`;
}

export async function openChannel(id) {
  await loadConsultantNames();
  if (!id) {
    drawer({ title: '新增招募管道', subtitle: '例如訓練機構、學校、職訓局', body: formHtml({ status: 'todo', kind: '訓練機構', jobs: [] }) });
    wireForm(null);
    return;
  }
  drawer({ title: '招募管道', body: loading() });
  let d; try { d = await api.get('/admin/channels/' + id); } catch (e) { $('#overlay-root .drawer-body').innerHTML = errorState(e); return; }
  const root = $('#overlay-root');
  root.querySelector('.drawer header h2').textContent = d.channel.name;
  root.querySelector('.drawer header p').textContent = `${d.channel.kind || ''}｜${data.statuses[d.channel.status] || d.channel.status}${d.channel.next_follow_at ? '｜下次追 ' + d.channel.next_follow_at : ''}`;
  const body = root.querySelector('.drawer-body');
  const keep = body.scrollTop;
  body.innerHTML = detailHtml(d);
  body.scrollTop = keep;
  wireForm(d.channel.id);
  wireDetail(d.channel.id);
}
function wireForm(id) {
  const body = $('#overlay-root .drawer-body'); if (!body) return;
  const f = body.querySelector('[data-ch-form]');
  const jq = body.querySelector('[data-ch-jobq]');
  if (jq) jq.addEventListener('input', () => { const q = jq.value.trim(); body.querySelectorAll('.ch-job').forEach((l) => { l.style.display = !q || l.textContent.includes(q) ? '' : 'none'; }); });
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); if (needMe()) return;
    const fd = new FormData(f);
    const payload = { by: me(), jobs: fd.getAll('jobs') };
    for (const k of ['name', 'status', 'kind', 'next_follow_at', 'owner', 'next_step', 'contact_name', 'phone', 'email', 'website', 'note']) payload[k] = fd.get(k) || '';
    if (id) payload.id = id;
    const btn = f.querySelector('[type=submit]'); btn.disabled = true;
    try {
      const r = await api.post('/admin/channels/save', payload);
      toast(id ? '已儲存' : '已新增', 'success');
      await refreshBoard();
      openChannel(r.id || id);
    } catch (err) { toast(err.message || '儲存失敗', 'error'); btn.disabled = false; }
  });
  const del = body.querySelector('[data-ch-del]');
  if (del) del.addEventListener('click', async () => {
    if (!window.confirm('確定刪除這家？聯絡紀錄和人選連結會一起刪掉（人選本身不會被刪）。')) return;
    try { await api.post('/admin/channels/delete', { id }); closeOverlay(); toast('已刪除', 'success'); refreshBoard(); }
    catch (err) { toast(err.message || '刪除失敗', 'error'); }
  });
}
function wireDetail(id) {
  const body = $('#overlay-root .drawer-body'); if (!body) return;
  const lf = body.querySelector('[data-ch-logform]');
  const need = body.querySelector('[data-ch-need]');
  const showTab = (k) => { ui.tab = k; body.querySelectorAll('[data-ch-tab]').forEach((b) => { const on = b.getAttribute('data-ch-tab') === k; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); }); body.querySelectorAll('[data-ch-pane]').forEach((p) => { p.hidden = p.getAttribute('data-ch-pane') !== k; }); };
  body.querySelectorAll('[data-ch-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.getAttribute('data-ch-tab'))));
  const focusForm = () => { showTab('log'); lf.elements.note.focus(); lf.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
  const renderNeed = () => {
    const v = lf.elements.status_to.value;
    if (!v) { need.hidden = true; need.innerHTML = ''; return; }
    need.hidden = false;
    need.innerHTML = `<div>你要把階段改成「<b>${esc(data.statuses[v] || v)}</b>」。<b>填完下面這筆紀錄、按「存這筆紀錄」之後，才會真的改。</b>${v === 'paused' ? '　請在備註寫原因。' : ''}　<button type="button" class="bdc-btn sm" data-ch-need-x>先不改</button></div>`;
    need.querySelector('[data-ch-need-x]').onclick = () => { lf.elements.status_to.value = ''; renderNeed(); };
  };
  body.querySelectorAll('[data-ch-stage]').forEach((b) => b.addEventListener('click', () => { lf.elements.status_to.value = b.getAttribute('data-ch-stage'); renderNeed(); focusForm(); }));
  lf.elements.status_to.addEventListener('change', renderNeed);
  const syncKind = () => { const k = lf.querySelector('[name=kind]:checked').value; const call = k === 'call'; lf.querySelectorAll('[data-ch-call]').forEach((el) => { el.hidden = !call; }); lf.querySelectorAll('[data-ch-mail]').forEach((el) => { el.hidden = k !== 'mail'; }); if (k === 'mail') lf.elements.mail_sent.checked = true; };
  lf.querySelectorAll('[name=kind]').forEach((r) => r.addEventListener('change', syncKind)); syncKind();
  body.querySelector('[data-ch-newlog]')?.addEventListener('click', focusForm);
  body.querySelector('[data-ch-next="done"]')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try { await api.post('/admin/channels/next', { id, action: 'done' }); toast('這一步標成完成了，請記下結果', 'success'); await refreshBoard(); await openChannel(id); const b2 = $('#overlay-root .drawer-body'); b2?.querySelector('[data-ch-logform] [name=note]')?.focus(); }
    catch (err) { toast(err.message || '失敗', 'error'); e.currentTarget.disabled = false; }
  });
  body.querySelector('[data-ch-next="snooze"]')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try { await api.post('/admin/channels/next', { id, action: 'snooze', days: 1 }); toast('已延 1 天', 'success'); await refreshBoard(); openChannel(id); }
    catch (err) { toast(err.message || '失敗', 'error'); e.currentTarget.disabled = false; }
  });
  // 2026-10-20：AI 擬信 → 頁面上看過、可改 → 寄出（寄出同時自動記一筆已寄信）
  const mbox = lf.querySelector('[data-ch-mail]');
  if (mbox) {
    const aiBtn = mbox.querySelector('[data-ch-ai]'); const msg = mbox.querySelector('[data-ch-ai-msg]'); const dbox = mbox.querySelector('[data-ch-draft]');
    const origEmail = mbox.getAttribute('data-email') || '';
    aiBtn.addEventListener('click', async () => {
      const f = lf.elements; if (!f.by.value) { toast('請先選「誰記的」', 'error'); return; }
      aiBtn.disabled = true; msg.textContent = 'AI 擬信中……約 1～2 分鐘，可以先做別的事，別關掉這個視窗';
      try {
        const r = await api.post('/admin/channels/ai-draft', { id, note: f.note.value.trim(), by: f.by.value });
        const t0 = Date.now();
        while (Date.now() - t0 < 8 * 60 * 1000) {
          await new Promise((ok) => setTimeout(ok, 4000));
          if (!document.body.contains(mbox)) return;
          const g = await api.get('/admin/channels/ai-draft?job=' + encodeURIComponent(r.job_id));
          if (g.status === 'done' && g.draft) {
            f.m_to.value = g.draft.to || origEmail; f.m_subject.value = g.draft.subject || ''; f.m_text.value = g.draft.text || '';
            dbox.hidden = false; msg.textContent = '擬好了，請看過、需要就直接改，再按「寄出這封信」。想重擬可以改備註再按一次。';
            if (!f.m_to.value) { msg.textContent += '　⚠️ 這個管道還沒有 Email，請先填收件人（寄出後會順便存進管道資料）。'; f.m_to.focus(); }
            aiBtn.disabled = false; aiBtn.textContent = '重新擬一次'; return;
          }
          if (g.status === 'failed' || g.status === 'error') throw new Error(g.error || 'AI 擬信失敗');
        }
        throw new Error('等太久了，請再按一次');
      } catch (err) { msg.textContent = '擬信失敗：' + (err.message || '請再試一次'); aiBtn.disabled = false; }
    });
    mbox.querySelector('[data-ch-self]').addEventListener('click', () => { const f = lf.elements; dbox.hidden = false; if (!f.m_to.value) f.m_to.value = origEmail; (f.m_to.value ? f.m_subject : f.m_to).focus(); });
    const fin = lf.elements.m_files; const flist = mbox.querySelector('[data-ch-files]');
    fin.addEventListener('change', () => { const xs = [...(fin.files || [])]; flist.textContent = xs.length ? '會附上：' + xs.map((x) => `${x.name}（${Math.max(1, Math.round(x.size / 1024))} KB）`).join('、') : ''; });
    mbox.querySelector('[data-ch-send]').addEventListener('click', async (ev) => {
      const f = lf.elements; const to = f.m_to.value.trim(); const sb = ev.currentTarget;
      if (!f.by.value) { toast('請先選「誰記的」', 'error'); return; }
      if (!to || !f.m_subject.value.trim() || !f.m_text.value.trim()) { toast('收件人、主旨、內文都要有', 'error'); return; }
      const picked = [...(f.m_files.files || [])];
      if (picked.length > 5) { toast('附件最多 5 個', 'error'); return; }
      const big = picked.find((x) => x.size > 8 * 1024 * 1024); if (big) { toast(`「${big.name}」超過 8MB`, 'error'); return; }
      if (!window.confirm(`確定從 official@step1ne.com 寄給 ${to}？` + (picked.length ? `\n附件：${picked.map((x) => x.name).join('、')}` : ''))) return;
      sb.disabled = true;
      try {
        const toB64 = (file) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => no(new Error(`讀不到「${file.name}」`)); r.readAsDataURL(file); });
        const attachments = [];
        for (const x of picked) attachments.push({ name: x.name, mime: x.type || 'application/octet-stream', b64: await toB64(x) });
        await api.post('/admin/channels/send-mail', { id, by: f.by.value, to, subject: f.m_subject.value.trim(), text: f.m_text.value, attachments,
          note: f.note.value.trim(), status_to: f.status_to.value, next_step: f.next_step.value.trim(), next_due: f.next_due.value, save_email: !origEmail });
        toast('信已排入寄送（約 1 分鐘內寄出），也記好一筆紀錄了', 'success'); await refreshBoard(); openChannel(id);
      } catch (err) { toast(err.message || '寄出失敗', 'error'); sb.disabled = false; }
    });
  }
  lf.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = lf.elements; const kind = lf.querySelector('[name=kind]:checked').value;
    if (f.status_to.value && !f.note.value.trim()) { toast('要改階段，請先在備註寫這次發生了什麼', 'error'); f.note.focus(); return; }
    if (!f.note.value.trim() && !f.next_step.value.trim() && kind !== 'call') { toast('請寫備註或下一步', 'error'); f.note.focus(); return; }
    const btn = lf.querySelector('[type=submit]'); btn.disabled = true;
    try {
      await api.post('/admin/channels/log', { id, by: f.by.value, kind, event_at: f.event_at.value, result: kind === 'call' ? f.result.value : '', contact_name: kind === 'call' ? f.contact_name.value.trim() : '',
        mail_sent: f.mail_sent.checked, text: f.note.value.trim(), status_to: f.status_to.value, next_step: f.next_step.value.trim(), next_due: f.next_due.value });
      toast(f.status_to.value ? '已存這筆紀錄，階段已更新' : '已存這筆紀錄', 'success'); await refreshBoard(); openChannel(id);
    } catch (err) { toast(err.message || '儲存失敗', 'error'); btn.disabled = false; }
  });
  const upd = (sel, body2, msg) => body.querySelectorAll(sel).forEach((b) => b.addEventListener('click', async () => {
    if (body2.delete && !window.confirm('刪除這筆紀錄？')) return;
    b.disabled = true;
    try { await api.post('/admin/channels/log-update', { log_id: Number(b.getAttribute(sel.slice(1, -1))), ...body2 }); toast(msg, 'success'); await refreshBoard(); openChannel(id); }
    catch (err) { toast(err.message || '失敗', 'error'); b.disabled = false; }
  }));
  upd('[data-ch-done]', { next_done: true }, '這步標成完成了');
  upd('[data-ch-sent]', { mail_sent: true }, '已記下寄出時間');
  upd('[data-ch-logdel]', { delete: true }, '已刪除');
  const q = body.querySelector('[data-ch-q]'); const out = body.querySelector('[data-ch-results]');
  const find = async () => {
    const v = q.value.trim(); if (!v) return;
    out.innerHTML = loading('找人選中');
    try {
      const r = await api.get('/admin/search?q=' + encodeURIComponent(v));
      const c = (r && r.candidates) || [];
      out.innerHTML = c.length ? c.map((x) => `<div class="list-row"><span><b>${x.seq_no ? '#' + x.seq_no + ' ' : ''}${esc(x.name || '')}</b><small>${esc(x.job_title || '')}${x.owner ? '｜' + esc(x.owner) : ''}</small></span><button class="btn sm primary" data-ch-ref="${esc(x.id)}">加入</button></div>`).join('') : '<p class="help">找不到，人選要先在系統裡</p>';
      out.querySelectorAll('[data-ch-ref]').forEach((b) => b.addEventListener('click', async () => {
        if (needMe()) return;
        try { await api.post('/admin/channels/ref', { id, application_id: b.getAttribute('data-ch-ref'), by: me() }); toast('已加入', 'success'); await refreshBoard(); openChannel(id); }
        catch (err) { toast(err.message || '加入失敗', 'error'); }
      }));
    } catch (err) { out.innerHTML = errorState(err); }
  };
  body.querySelector('[data-ch-find]').addEventListener('click', find);
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); find(); } });
  body.querySelectorAll('[data-ch-unref]').forEach((b) => b.addEventListener('click', async () => {
    if (needMe() || !window.confirm('把這位人選從這家移掉？（人選本身不會被刪）')) return;
    try { await api.post('/admin/channels/ref', { id, application_id: b.getAttribute('data-ch-unref'), by: me(), remove: true }); await refreshBoard(); openChannel(id); }
    catch (err) { toast(err.message || '移除失敗', 'error'); }
  }));
  body.querySelectorAll('[data-ch-cand]').forEach((b) => {
    const go = () => { if (hooks.openCandidate) hooks.openCandidate(b.getAttribute('data-ch-cand')); };
    b.addEventListener('click', go); b.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  });
}
async function refreshBoard() {
  try { data = await api.get('/admin/channels'); } catch { return; }
  draw();
}
