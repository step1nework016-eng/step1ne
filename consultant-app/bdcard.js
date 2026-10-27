// 客戶開發卡片改版（2026-10-13 Jacky 核准示意頁：客戶開發卡片_新版UIUX_示意.html）
// 卡片由上到下：公司名 → 下一步（大色塊）→ 客戶標籤 → 統計 → 開發進度（階段）→ 分頁。
// 規則（Jacky 定的）：
//   ・階段只能在「開發進度」那排改；點了要跳到「進度紀錄」，填完那筆紀錄存下去階段才會真的換
//   ・同一個階段可以重複按（每按一次記一筆）
//   ・客戶標籤（HOT／WARM／FUTURE／NO／MATERIAL）每家只能選一個，也是填完紀錄才改
//   ・這裡全部是顧問手填，不用 AI（AI 只用在「匯入電洽內容」跟「新增職缺」）
import { api } from './core/api.js';
import { toast } from './core/ui.js';
import { escapeHtml, text } from './core/security.js';
import { fileButtons, wireFileButtons } from './filepreview.js';
import { loadBdMailArchive } from './mail.js';

export const BD_STAGES = ['還沒聯繫', '已聯繫', '有興趣', '已寄資料', '談需求', '簽約'];
export const BD_EXITS = ['沒興趣', '暫緩'];
export const BD_TAGS = [
  { k: 'HOT', zh: '有需求＋願意了解', act: '約需求訪談', days: null, color: '#c2410c', rule: '有需求、願意了解 → 約需求訪談' },
  { k: 'WARM', zh: '有缺，還想自己找', act: '7～14 天後追蹤', days: 7, color: '#b7791f', rule: '現在有缺，但還想自己找 → 7～14 天 Follow-up' },
  { k: 'FUTURE', zh: '現在沒需求', act: '30～60 天後追蹤', days: 30, color: '#2867ed', rule: '現在沒需求 → 30～60 天追蹤' },
  { k: 'NO', zh: '沒意願／不適合', act: '暫停，不再追', days: null, color: '#374151', rule: '完全沒意願或不適合 → 暫停' },
  { k: 'MATERIAL', zh: '要求寄介紹／合約', act: '當天寄出服務介紹或合約', days: 0, color: '#7c3aed', rule: '要求寄服務介紹或合約 → 當天寄，不要拖到明天' },
];
const RESULTS = [['no_answer', '沒接／沒人'], ['gatekeeper', '被擋在總機'], ['got_contact', '問到窗口'], ['got_email', '拿到信箱'], ['interested', '有興趣'], ['not_hiring', '沒在徵人'], ['not_interested', '沒興趣'], ['other', '其他']];
// 2026-10-27 公司開發名單頁多了「請寄資料」「再約時間」兩種結果（只在那一頁點，下拉不列）
const RESULT_ZH = { ...Object.fromEntries(RESULTS), send_info: '請寄資料', callback: '再約時間' };
const KIND_ZH = { call: '電話', mail: '寄信', other: '其他' };
const WD = '日一二三四五六';
const ICON = {
  call: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg>',
  mail: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  other: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
};

const taipeiNow = () => new Date(Date.now() + 8 * 3600e3);
const todayStr = () => taipeiNow().toISOString().slice(0, 10);
const addDays = (n) => { const d = taipeiNow(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const nowLocal = () => taipeiNow().toISOString().slice(0, 16);
const md = (s) => {
  const t = String(s || '');
  if (!/^\d{4}-\d{2}-\d{2}/.test(t)) return '';
  const d = new Date(`${t.slice(0, 10)}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${WD[d.getUTCDay()]}）`;
};
const mdTime = (s) => {
  const t = String(s || '').replace('T', ' ');
  return t.length >= 16 ? `${md(t)} ${t.slice(11, 16)}` : md(t);
};

// 一筆紀錄的實際發生時間：新欄位 event_at，舊資料用 created_at
const logTime = (l) => String(l.event_at || l.created_at || '').replace('T', ' ');
const logKind = (l) => l.kind || 'call';

export function bdCurrentStage(detail) {
  const st = detail.company_status || {};
  if (st.stage) return st.stage;
  return (detail.calls || []).length ? '已聯繫' : '還沒聯繫';
}

function sortedLogs(detail) {
  return (detail.calls || []).slice().sort((a, b) => logTime(b).localeCompare(logTime(a)));
}

function dueInfo(due) {
  if (!due) return { t: '沒有設期限', late: false };
  const diff = Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${todayStr()}T00:00:00Z`)) / 86400000);
  if (diff < 0) return { t: `已逾期 ${-diff} 天（原定 ${md(due)}）`, late: true };
  if (diff === 0) return { t: `今天要做（${md(due)}）`, late: false };
  if (diff === 1) return { t: `明天（${md(due)}）`, late: false };
  return { t: `${diff} 天後（${md(due)}）`, late: false };
}

// ───────────────────────── 卡片上半部 ─────────────────────────
export function bdCardTop(detail) {
  const company = detail.company || '';
  const st = detail.company_status || {};
  const logs = sortedLogs(detail);
  const stage = bdCurrentStage(detail);
  const tag = st.tag || '';

  // 下一步（大色塊）：就是最近一次寫的下一步
  let nextHtml;
  if (st.next_step) {
    const di = dueInfo(st.next_due);
    const src = logs.find((l) => l.id === st.next_log_id) || null;
    const from = src
      ? `這是 ${text(mdTime(logTime(src)))} ${text(src.caller || '顧問')} 寫的　·　當時狀況：${text(RESULT_ZH[src.result] || src.result || KIND_ZH[logKind(src)])}${src.note ? '：' + text(String(src.note).slice(0, 40)) + (String(src.note).length > 40 ? '…' : '') : ''}`
      : `${text(st.updated_by || '顧問')} 寫的`;
    nextHtml = `<section class="bdc-next${di.late ? ' late' : ''}">
      <div class="bdc-lbl"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>下一步</div>
      <div class="bdc-what">${text(st.next_step)}</div>
      <div class="bdc-when">${text(di.t)}</div>
      <div class="bdc-from">${from}</div>
      <div class="bdc-row"><button type="button" class="bdc-btn solid" data-bdc-next="done">做完了，記一筆</button><button type="button" class="bdc-btn" data-bdc-next="snooze">延 1 天</button></div></section>`;
  } else {
    const last = logs[0];
    nextHtml = `<section class="bdc-next none">
      <div class="bdc-lbl">下一步</div><div class="bdc-what">目前沒有待辦</div>
      <div class="bdc-from">${last ? `上一次紀錄：${text(mdTime(logTime(last)))}　${text(last.caller || '顧問')}　${text(RESULT_ZH[last.result] || KIND_ZH[logKind(last)])}` : '還沒有任何紀錄'}</div>
      <div class="bdc-row"><button type="button" class="bdc-btn" data-bdc-newlog>新增紀錄</button></div></section>`;
  }

  // 客戶標籤
  const cur = BD_TAGS.find((t) => t.k === tag);
  const tagsHtml = `<section class="bdc-sec"><h4>客戶標籤 <small>每家公司只能選一個，點了就存</small></h4>
    <div class="bdc-tagrow" role="radiogroup" aria-label="客戶標籤">${BD_TAGS.map((t) => `<button type="button" class="bdc-tg${tag === t.k ? ' on' : ''}" role="radio" aria-checked="${tag === t.k}" data-bdc-tag="${t.k}" title="${escapeHtml(t.zh)}" style="${tag === t.k ? `border-color:${t.color}` : ''}"><b><i style="background:${t.color}"></i>${t.k}</b><span>${text(t.zh)}</span></button>`).join('')}</div>
    <p class="bdc-rule">${cur ? `目前標籤：<b>${cur.k}</b>。規則：${text(cur.rule)}` : '還沒分類。電話打完請選一個標籤。'}</p></section>`;

  // 統計
  const calls = logs.filter((l) => logKind(l) === 'call').length;
  const mails = logs.filter((l) => l.mail_sent).length;
  const last = logs[0];
  // 2026-10-15 Jacky：統計四格太佔版面，改成一行
  const statsHtml = `<p class="bdc-statline">📞 <b>${calls}</b> 通電話　✉ <b>${mails}</b> 封信　🗓 最後聯繫 <b>${last ? text(md(logTime(last))) : '—'}</b>${last ? `（${text(last.caller || '顧問')}）` : ''}　💼 客戶職缺 <b>${(detail.client_jobs || []).length}</b></p>`;

  // 開發進度（階段）
  const cnt = {}; const lastAt = {};
  logs.slice().reverse().forEach((l) => { if (l.stage_to) { cnt[l.stage_to] = (cnt[l.stage_to] || 0) + 1; lastAt[l.stage_to] = logTime(l); } });
  if (st.stage && !cnt[st.stage]) { cnt[st.stage] = 1; lastAt[st.stage] = st.stage_at || ''; }
  const sub = (s) => (cnt[s] ? `${cnt[s] > 1 ? `×${cnt[s]}　` : ''}${text(md(lastAt[s]))}` : '—');
  const ci = BD_STAGES.indexOf(stage);
  const stepsHtml = `<section class="bdc-sec"><h4>開發進度 <small>要換階段，在這裡點</small></h4><div class="bdc-remind" data-bdc-remind hidden></div>
    <div class="bdc-steps" role="radiogroup" aria-label="開發階段">${BD_STAGES.map((s, i) => `<button type="button" class="bdc-step${i < ci ? ' past' : ''}${i === ci ? ' now' : ''}" role="radio" aria-checked="${i === ci}" data-bdc-stage="${s}"><b>${s}</b><span>${sub(s)}</span></button>`).join('')}</div>
    <div class="bdc-exits">${BD_EXITS.map((s) => `<button type="button" class="bdc-step${stage === s ? ' now red' : ''}" data-bdc-stage="${s}"><b>${s}</b><span>${sub(s)}</span></button>`).join('')}<span class="bdc-hint">客戶沒興趣或先擱著，按左邊。同一個階段可以重複按，每按一次都要記一筆。</span></div></section>`;

  return `<div class="bdc" data-bdc-company="${escapeHtml(company)}" data-bdc-stage-now="${escapeHtml(stage)}">${nextHtml}${tagsHtml}<section class="bdc-sec">${statsHtml}</section>${stepsHtml}</div>`;
}

// ───────────────────────── 進度紀錄（分頁內容） ─────────────────────────
// 系統自動記的事件（送達、開信、對方回信、追信寄出、退信…）：唯讀，併在全部紀錄裡
function systemEvents(detail) {
  // 2026-10-22：系統寄的信改成下面 mailItem 一封一張完整卡片（主旨、內文、收件人、附件），這裡不再重複「已寄出」那一行
  const hasMails = (detail.mails || []).length > 0;
  return (detail.timeline || [])
    .filter((t) => !t.call_log_id && !String(t.kind || '').startsWith('☎') && !String(t.kind || '').includes('擬稿'))
    .filter((t) => !hasMails || !(String(t.kind || '').startsWith('已寄公司介紹') || /·寄出$/.test(String(t.kind || ''))))
    .map((t) => ({ sys: true, at: String(t.at || '').replace('T', ' '), label: String(t.kind || '') }));
}

// 2026-10-22 Jacky：系統寄出的信（公司介紹／合約／開發信）在紀錄裡一封一張卡：
// 收件人、時間、誰署名、誰核准、主旨、內文（點開）、附件（預覽／下載）
const MAIL_ST = { pending: ['等 Jacky／Phoebe 在 TG 核准', 'no'], sending: ['寄送中', 'no'], sent: ['已寄出', 'ok'], draft: ['被退回，沒寄', 'no'], rejected: ['決定不寄', 'no'], blocked: ['被擋下，沒寄', 'no'] };
const ATT_KIND = { company_intro: '公司介紹', contract: '合約', anon_cv: '匿名履歷' };
function mailItem(m) {
  const [st, cls] = MAIL_ST[m.status] || [m.status || '', 'no'];
  const atts = (m.attachments || []).map((a) => `<div class="fp-att"><span class="fp-att-name">${ATT_KIND[a.kind] ? `<span class="bdc-chip stage">${ATT_KIND[a.kind]}</span>` : ''}<span class="fp-fn" title="${escapeHtml(a.filename || '')}">${text(a.filename)}</span></span>${fileButtons(`/admin/file/${encodeURIComponent(a.file_id)}`, a.filename)}</div>`).join('');
  return `<li class="bdc-item mail sysmail"><span class="bdc-dot" aria-hidden="true">${ICON.mail}</span><div class="bdc-card">
    <div class="bdc-top"><span class="bdc-t">系統寄信${m.pack ? '　公司介紹／合約' : '　開發信'}</span><span class="bdc-time">${text(mdTime(m.at))}</span></div>
    <div class="bdc-chips"><span class="bdc-chip ${cls}">${text(st)}${m.status === 'sent' && m.sent_at ? ` ${text(mdTime(m.sent_at))}` : ''}</span>${m.opened_at ? `<span class="bdc-chip ok">對方開過信 ${text(mdTime(m.opened_at))}</span>` : ''}</div>
    <dl class="bdc-mailhead"><dt>收件人</dt><dd>${text(m.to || '（沒有信箱）')}</dd><dt>署名</dt><dd>${text(m.signer || '—')}</dd>${m.approved_by ? `<dt>${m.status === 'sent' ? '核准寄出' : '處理人'}</dt><dd>${text(m.approved_by)}</dd>` : ''}<dt>主旨</dt><dd class="bdc-subj" title="${escapeHtml(m.subject || '')}"><b>${text(m.subject || '（無主旨）')}</b></dd></dl>
    <details class="bdc-mailbody"><summary><span class="bdc-open">展開信件內文</span><span class="bdc-close">收合信件內文</span></summary><pre class="bd-letter-body">${text(m.body)}</pre></details>
    ${atts ? `<div class="fp-atts"><small class="muted">附件</small>${atts}</div>` : '<small class="muted">沒有附件</small>'}
  </div></li>`;
}

export function bdLogPane(detail) {
  const logs = sortedLogs(detail);
  const sys = systemEvents(detail);
  const mails = detail.mails || [];
  const people = [...new Set([detail.assigned_to, 'Jacky', 'Phoebe', ...(detail.people || [])].filter(Boolean))];
  const stageOpts = ['', ...BD_STAGES.slice(1), ...BD_EXITS];
  const item = (l) => {
    const k = logKind(l);
    const sent = l.mail_sent
      ? `<span class="bdc-chip ok">信已寄出 ${text(mdTime(l.mail_sent_at || logTime(l)))}</span>`
      : (k === 'mail' ? '<span class="bdc-chip no">信還沒寄</span>' : '');
    const nxt = l.next_step
      ? `<div class="bdc-nxt${l.next_done ? ' done' : ''}">下一步：${text(l.next_step)}${l.next_due ? `（${text(md(l.next_due))}）` : ''}${l.next_done ? '　已完成' : ''}</div>` : '';
    return `<li class="bdc-item ${k}"><span class="bdc-dot" aria-hidden="true">${ICON[k]}</span><div class="bdc-card">
      <div class="bdc-top"><span class="bdc-t">${KIND_ZH[k]}${l.result ? `　${text(RESULT_ZH[l.result] || l.result)}` : ''}</span><span class="bdc-time">${text(mdTime(logTime(l)))}　${text(l.caller || '顧問')}</span></div>
      <div class="bdc-chips">${sent}${l.stage_to ? `<span class="bdc-chip stage">階段 → ${text(l.stage_to)}</span>` : ''}${l.tag_to ? `<span class="bdc-chip stage">標籤 → ${text(l.tag_to)}</span>` : ''}</div>
      ${l.note ? `<p class="bdc-note">${text(l.note)}</p>` : ''}${l.contact_name || l.hr_phone || l.email ? `<small class="muted">問到：${[l.contact_name && `窗口 ${text(l.contact_name)}`, l.hr_phone && `電話 ${text(l.hr_phone)}`, l.email && `信箱 ${text(l.email)}`].filter(Boolean).join('・')}</small>` : ''}
      ${nxt}
      ${(!l.mail_sent && k !== 'other') || (l.next_step && !l.next_done) || true ? `<div class="bdc-mini">${!l.mail_sent && k !== 'other' ? `<button type="button" data-bdc-sent="${l.id}">標記信已寄出</button>` : ''}${l.next_step && !l.next_done ? `<button type="button" data-bdc-done="${l.id}">這步做完了</button>` : ''}<button type="button" class="bd-del" data-action="bd-delete-record" data-kind="call" data-id="${l.id}" data-company="${escapeHtml(detail.company || '')}">刪除</button></div>` : ''}
    </div></li>`;
  };
  const sysItem = (e) => `<li class="bdc-item sys"><span class="bdc-dot" aria-hidden="true">${ICON.mail}</span><div class="bdc-card bdc-sys"><div class="bdc-top"><span class="bdc-t">${text(e.label)}</span><span class="bdc-time">${text(mdTime(e.at))}　系統</span></div></div></li>`;
  return `<section class="bdc-logpane" data-bdc-logpane>
    ${detail.markBtn ? `<div class="bdc-mark"><b>成交標記</b><small class="muted">談到職缺、成交時按這裡</small>${detail.markBtn}</div>` : ''}
    <h4 class="bdc-h">新增紀錄 <small>每一個動作都記一筆</small></h4>
    <div class="bdc-need" data-bdc-need hidden></div>
    <form class="bdc-form" data-bdc-form autocomplete="off">
      <div class="bdc-seg" role="radiogroup" aria-label="做了什麼">${Object.entries(KIND_ZH).map(([v, lb], i) => `<label><input type="radio" name="kind" value="${v}"${i === 0 ? ' checked' : ''}><span>${lb}</span></label>`).join('')}</div>
      <div class="bdc-grid">
        <label class="bdc-f">時間<input type="datetime-local" name="event_at" value="${nowLocal()}" required></label>
        <label class="bdc-f" data-bdc-call>結果<select name="result">${RESULTS.map(([v, lb]) => `<option value="${v}">${lb}</option>`).join('')}</select></label>
        <label class="bdc-f">誰記的<select name="by">${people.map((x) => `<option${x === detail.assigned_to ? ' selected' : ''}>${text(x)}</option>`).join('')}</select></label>
        <div class="bdc-f full bdc-mailjump" data-bdc-mailjump>
          <div><b>要寄合約／公司簡介給對方？</b><small class="muted">從系統寄：信會先送 TG，Jacky 或 Phoebe 按核准才寄出；寄出後信件全文和附件會自動出現在下面紀錄，不用另外記。</small></div>
          <button type="button" class="bdc-btn" data-bdc-gomail>開寄信畫面（附合約／公司簡介供參考）→</button>
        </div>
        <div class="bdc-f full"><label class="bdc-check"><input type="checkbox" name="mail_sent"> 這次有寄信（從自己信箱寄的）　<small class="muted">（勾了才記「已寄出」和時間）</small></label></div>
        <label class="bdc-f full">備註<textarea name="note" rows="3" placeholder="聊到什麼、對方說什麼"></textarea></label>
        <div class="bdc-f full bdc-imp" data-bdc-call>
          <div class="bdc-imp-h"><b>匯入電洽內容，讓 AI 整理</b><small class="muted">選填　AI 只用在這裡和「新增職缺」</small></div>
          <textarea name="transcript" rows="4" placeholder="有通話逐字稿就貼這裡，AI 會整理重點和下一通的講法；上面的時間、階段、下一步照樣可以自己填"></textarea>
          <input type="file" name="transcript_file" accept=".md,.txt,text/plain,text/markdown" aria-label="上傳逐字稿檔">
        </div>
        <label class="bdc-f">客戶標籤調整<select name="tag"><option value="">不調整</option>${BD_TAGS.map((t) => `<option value="${t.k}">${t.k}　${text(t.zh)}</option>`).join('')}</select></label>
        <label class="bdc-f">階段調整<select name="stage">${stageOpts.map((s) => `<option value="${s}">${s || '不調整'}</option>`).join('')}</select></label>
        <label class="bdc-f">下一步到期日<input type="date" name="next_due"></label>
        <label class="bdc-f full">下一步要做什麼<input type="text" name="next_step" maxlength="200" placeholder="例：寄公司簡介給劉小姐，下週二再打電話追"></label>
      </div>
      <div class="bdc-actions"><button type="submit" class="bdc-btn primary">存這筆紀錄</button></div>
    </form>
    <h4 class="bdc-h">全部紀錄 <small>共 ${logs.length} 筆${mails.length ? `＋系統寄的信 ${mails.length} 封` : ''}</small></h4>
    ${logs.length || sys.length || mails.length ? `<ol class="bdc-tl">${[...logs.map((l) => ({ at: logTime(l), html: item(l) })), ...sys.map((e) => ({ at: e.at, html: sysItem(e) })), ...mails.map((m) => ({ at: String(m.at || '').replace('T', ' '), html: mailItem(m) }))].sort((a, b) => String(b.at).localeCompare(String(a.at))).map((x) => x.html).join('')}</ol>` : '<p class="help">還沒有紀錄。打完電話或寄完信，在上面記一筆。</p>'}
    <h4 class="bdc-h">信箱裡的往來信件 <small>official@ 與 Jacky 信箱的寄件／收件，包含以前從自己信箱寄的合約，用對方信箱自動對到這家</small></h4>
    <div class="bdc-archive" data-bdc-archive></div>
  </section>`;
}

// ───────────────────────── 事件連線 ─────────────────────────
export function wireBdCard(root, detail, reload) {
  const top = root.querySelector('.bdc');
  const pane = root.querySelector('[data-bdc-logpane]');
  if (!top || !pane) return;
  const company = top.dataset.bdcCompany;
  const form = pane.querySelector('[data-bdc-form]');
  const need = pane.querySelector('[data-bdc-need]');
  const pending = { stage: '', tag: '' };

  const showLogTab = () => /** @type {HTMLElement|null} */ (document.querySelector('[data-bd-detail-tab="log"]'))?.click();
  const renderNeed = () => {
    if (!pending.stage && !pending.tag) { need.hidden = true; need.innerHTML = ''; return; }
    const parts = [];
    if (pending.stage) parts.push(`階段改成「<b>${text(pending.stage)}</b>」`);
    if (pending.tag) parts.push(`客戶標籤改成「<b>${text(pending.tag)}</b>」`);
    const why = (pending.stage === '沒興趣' || pending.stage === '暫緩' || pending.tag === 'NO') ? '　請在備註寫原因。' : '';
    need.hidden = false;
    need.innerHTML = `<div>你要把${parts.join('，')}。<b>填完下面這筆紀錄、按「存這筆紀錄」之後，才會真的改。</b>${why}${pending.tag ? '　下一步我先幫你填了建議，可以改。' : ''}　<button type="button" class="bdc-btn sm" data-bdc-need-cancel>先不改</button></div>`;
    need.querySelector('[data-bdc-need-cancel]').onclick = () => {
      pending.stage = ''; pending.tag = '';
      form.elements.stage.value = ''; form.elements.tag.value = '';
      renderNeed();
    };
  };
  const focusForm = () => {
    showLogTab();
    renderNeed();
    form.elements.note.focus();
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  // 點階段 → 跳到紀錄
  top.querySelectorAll('[data-bdc-stage]').forEach((b) => {
    b.onclick = () => {
      pending.stage = b.dataset.bdcStage;
      form.elements.stage.value = pending.stage;
      focusForm();
    };
  });
  // 點標籤 → 直接存（不用寫紀錄；時間軸會自動留一筆）
  top.querySelectorAll('[data-bdc-tag]').forEach((b) => {
    b.onclick = async () => {
      const t = BD_TAGS.find((x) => x.k === b.dataset.bdcTag);
      const same = (detail.company_status || {}).tag === t.k;
      b.disabled = true;
      try {
        await api.post('/admin/bd/tag', { company, tag: same ? '' : t.k, by: form.elements.by.value });
        toast(same ? '已清除標籤' : `標籤已改成 ${t.k}`, 'success');
        await reload({ remindTag: same ? '' : t.k });
      } catch (err) { toast(err.message || '失敗', 'error'); b.disabled = false; }
    };
  });
  // 下一步：做完／延期
  top.querySelector('[data-bdc-next="done"]')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try {
      await api.post('/admin/bd/next', { company, action: 'done' });
      toast('這一步標成完成了，請記下結果', 'success');
      await reload({ openLog: true });
    } catch (err) { toast(err.message || '失敗', 'error'); e.currentTarget.disabled = false; }
  });
  top.querySelector('[data-bdc-next="snooze"]')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try {
      await api.post('/admin/bd/next', { company, action: 'snooze', days: 1 });
      toast('已延 1 天', 'success');
      await reload({});
    } catch (err) { toast(err.message || '失敗', 'error'); e.currentTarget.disabled = false; }
  });
  top.querySelector('[data-bdc-newlog]')?.addEventListener('click', () => { showLogTab(); form.elements.next_step.focus(); form.scrollIntoView({ behavior: 'smooth', block: 'center' }); });

  // 選「寄信」「其他」就不顯示電洽的欄位（結果、匯入電洽內容）
  const syncKind = () => {
    const call = form.querySelector('[name=kind]:checked').value === 'call';
    form.querySelectorAll('[data-bdc-call]').forEach((el) => { el.hidden = !call; });
    const mj = form.querySelector('[data-bdc-mailjump]');
    if (mj) mj.hidden = form.querySelector('[name=kind]:checked').value === 'other';
  };
  form.querySelectorAll('[name=kind]').forEach((r) => { r.onchange = syncKind; });
  syncKind();

  // 2026-10-22 Jacky：記完電話可以直接寄信——跳到同一張卡片的「寄公司介紹信」分頁，預設「電話後補資料」＋附公司介紹
  //（「電話後補資料」這版信只寫「附上資料給您參考」，不催簽、不寫用印回傳）
  pane.querySelector('[data-bdc-gomail]')?.addEventListener('click', () => {
    /** @type {HTMLElement|null} */ (document.querySelector('[data-bd-detail-tab="mail"]'))?.click();
    const mp = document.getElementById('bd-detail-pane-mail');
    if (!mp) return;
    const sc = /** @type {HTMLSelectElement|null} */ (mp.querySelector('[data-pack-scenario]'));
    if (sc && sc.value !== 'inbound') { sc.value = 'followup'; sc.dispatchEvent(new Event('change')); }
    const intro = /** @type {HTMLInputElement|null} */ (mp.querySelector('[data-pack-intro]'));
    if (intro) intro.checked = true;
    mp.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  // 系統寄的信的附件：預覽／下載（帶後台登入，不是公開連結）
  wireFileButtons(pane);
  // 信箱裡的往來信件（含 jackychen@，要私人鑰匙）
  loadBdMailArchive(pane.querySelector('[data-bdc-archive]'), company);
  form.elements.transcript_file?.addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) form.elements.transcript.value = await f.text();
  });

  // 下拉改了也要跟著 pending（讓顧問手動選也算）
  form.elements.stage.onchange = () => { pending.stage = form.elements.stage.value; renderNeed(); };
  form.elements.tag.onchange = () => { pending.tag = form.elements.tag.value; renderNeed(); };

  // 存紀錄
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = form.elements;
    const stage = f.stage.value; const tag = f.tag.value;
    if ((stage || tag) && !f.note.value.trim()) { toast('要改階段或標籤，請先在備註寫這次發生了什麼', 'error'); f.note.focus(); return; }
    const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
    try {
      const r = await api.post('/admin/bd/log', {
        company, kind: form.querySelector('[name=kind]:checked').value, event_at: f.event_at.value, result: form.querySelector('[name=kind]:checked').value === 'call' ? f.result.value : '',
        mail_sent: f.mail_sent.checked, note: f.note.value.trim(), stage, tag, next_step: f.next_step.value.trim(), next_due: f.next_due.value, by: f.by.value,
      });
      void r;
      const isCall = form.querySelector('[name=kind]:checked').value === 'call';
      if (isCall && f.transcript.value.trim()) {
        try { await api.post('/admin/bd/transcript', { company, caller: f.by.value, transcript: f.transcript.value, note: f.note.value.trim() }); toast('逐字稿已送去 AI 整理，約 1～3 分鐘後重開卡片就看得到', 'success'); }
        catch (err) { toast(`紀錄已存，但逐字稿沒送成：${err.message || '失敗'}`, 'error'); }
      }
      toast(stage || tag ? '已存這筆紀錄，階段／標籤已更新' : '已存這筆紀錄', 'success');
      await reload({ remindStage: !stage && form.querySelector('[name=kind]:checked').value !== 'other' });
    } catch (err) { toast(err.message || '儲存失敗', 'error'); btn.disabled = false; }
  };

  // 事後標「這步做完了」
  pane.querySelectorAll('[data-bdc-done]').forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      try { await api.post('/admin/bd/log-update', { id: Number(b.dataset.bdcDone), next_done: true }); toast('這步標成完成了', 'success'); await reload({ openLog: true }); }
      catch (err) { toast(err.message || '失敗', 'error'); b.disabled = false; }
    };
  });

  // 事後補標信已寄出
  pane.querySelectorAll('[data-bdc-sent]').forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      try { await api.post('/admin/bd/log-update', { id: Number(b.dataset.bdcSent), mail_sent: true, by: form.elements.by.value }); toast('已記下寄出時間', 'success'); await reload({ openLog: true }); }
      catch (err) { toast(err.message || '失敗', 'error'); b.disabled = false; }
    };
  });
}

export function bdShowTagRemind(root, tag) {
  if (tag !== 'NO') return;
  const box = root.querySelector('[data-bdc-remind]');
  if (!box) return;
  box.hidden = false;
  box.innerHTML = '<div>標籤已改成 NO，這家之後不會再提醒。如果客戶也不再往來，記得在下面把階段改成「沒興趣」或「暫緩」。　<button type="button" class="bdc-btn sm" data-bdc-remind-x>知道了</button></div>';
  box.querySelector('[data-bdc-remind-x]').onclick = () => { box.hidden = true; };
}

export function bdShowStageRemind(root, stage) {
  const box = root.querySelector('[data-bdc-remind]');
  if (!box) return;
  box.hidden = false;
  box.innerHTML = `<div>這筆紀錄沒有調整階段。客戶有進展的話，請點下面的階段切換（目前停在「${text(stage)}」）。　<button type="button" class="bdc-btn sm" data-bdc-remind-x>知道了</button></div>`;
  box.querySelector('[data-bdc-remind-x]').onclick = () => { box.hidden = true; };
}
