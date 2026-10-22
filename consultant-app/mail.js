// 2026-10-12 加：信箱紀錄（official@／jackychen@ 的收件＋寄件備份，Mac 上 mail_archive.py 每 10 分鐘存進來）。
//
// 權限：official@ 有後台登入就看得到；jackychen@ 只有帶「私人鑰匙」（X-Mail-Key）才會回傳——
// 這是伺服器端擋的，這裡只是把鑰匙存在瀏覽器、每次請求帶上。沒有鑰匙時畫面上就是看不到那些信。
// 安全：信件內文一律當純文字顯示（escapeHtml），不渲染任何信裡的 HTML。
import { CONFIG } from './config.js';
import { request } from './core/api.js';
import { $, $$, loading, errorState, empty, openSubDrawer, toast } from './core/ui.js';
import { escapeHtml, text } from './core/security.js';
import { fileButtons, wireFileButtons } from './filepreview.js';

const KEY = 's1ne_mail_key';
const PRIVATE_BOX = 'jackychen@step1ne.com';
const BOX_LABEL = { 'official@step1ne.com': 'official@', [PRIVATE_BOX]: 'jackychen@' };
const LINK_LABEL = { candidate: '人選', client: '客戶', client_contact: '客戶窗口', bd: '開發' };
const PAGE = 50;

let hooks = { openCandidate: null, openCompany: null };
const ui = { mailbox: '', folder: '', from: '', to: '', q: '', hideSystem: false, offset: 0, items: [], hasMore: false, label: null };

export function initMail(h) { hooks = { ...hooks, ...h }; }

// 2026-10-12：從 TG 複製常會連中文說明一起貼進來；HTTP 標頭只能放英數，夾到中文整個請求會失敗（Failed to fetch）。
// 只取最長那段英數字（鑰匙本身），其餘丟掉。
function cleanKey(v) { const m = String(v || '').match(/[A-Za-z0-9_\-]{16,}/g); return m ? m.sort((a, b) => b.length - a.length)[0] : ''; }
function mailKey() { try { return cleanKey(localStorage.getItem(KEY) || ''); } catch { return ''; } }
function setMailKey(v) { try { const k = cleanKey(v); if (k) localStorage.setItem(KEY, k); else localStorage.removeItem(KEY); } catch { /* 私密視窗存不了 */ } }
export function keyHeaders() { const k = mailKey(); return k ? { 'X-Mail-Key': k } : {}; }

export async function mailGet(path) {
  try {
    return await request(path, { method: 'GET', headers: keyHeaders() });
  } catch (e) {
    if (e?.body?.code === 'bad_mail_key') {
      setMailKey('');
      toast('私人鑰匙不對或已作廢，已從這台瀏覽器清掉', 'error');
      return request(path, { method: 'GET' });
    }
    throw e;
  }
}

const fmtSize = (n) => { const b = Number(n) || 0; return b >= 1048576 ? `${(b / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(b / 1024))}KB`; };
const shortTime = (s) => String(s || '').slice(5, 16).replace('-', '/');
const firstAddr = (s) => String(s || '').split(',')[0].trim();

export function mailPageView() {
  return `<div class="page-head"><div><h1>信箱紀錄</h1><p>official@ 跟 Jacky 信箱的收件、寄件備份，每 10 分鐘自動存一次。點一封看內文跟附件。</p></div><div class="actions"></div></div>
  <div id="mail-key-box" class="mail-keybox card"></div>
  <form id="mail-filters" class="filters mail-filters" autocomplete="off">
    <select name="mailbox" aria-label="信箱"><option value="">全部信箱</option><option value="official@step1ne.com">official@</option><option value="${PRIVATE_BOX}" data-private>jackychen@</option></select>
    <select name="folder" aria-label="收件或寄件"><option value="">收件＋寄件</option><option value="in">收件</option><option value="sent">寄件</option></select>
    <label class="mail-date"><span>從</span><input type="date" name="from"></label>
    <label class="mail-date"><span>到</span><input type="date" name="to"></label>
    <input type="search" name="q" placeholder="搜尋姓名、公司、主旨、Email" aria-label="搜尋">
    <label class="mail-check"><input type="checkbox" name="hideSystem"> 不看系統自動信副本</label>
    <button class="btn primary" type="submit">查詢</button>
  </form>
  <div id="page-data">${loading()}</div>`;
}

function renderKeyBox() {
  const box = $('#mail-key-box');
  if (!box) return;
  if (ui.label) {
    box.innerHTML = `<div class="mail-key-row"><span class="badge success">已解鎖</span><span>這台瀏覽器有 <b>${escapeHtml(ui.label)}</b> 的私人鑰匙，Jacky 信箱的信也會列出來。</span><button type="button" class="btn sm" id="mail-key-clear">從這台移除鑰匙</button></div>`;
    $('#mail-key-clear', box).onclick = () => { setMailKey(''); ui.label = null; ui.offset = 0; loadMailList(); };
  } else {
    box.innerHTML = `<form class="mail-key-row" id="mail-key-form" autocomplete="off"><span class="badge">未解鎖</span><span>Jacky 信箱（jackychen@）的信只有 Jacky、Phoebe 看得到，要先貼上 TG 私訊收到的「私人鑰匙」。</span>
      <input type="password" id="mail-key-input" placeholder="貼上私人鑰匙" aria-label="私人鑰匙" autocomplete="off"><button class="btn sm primary" type="submit">輸入私人鑰匙</button></form>`;
    $('#mail-key-form', box).onsubmit = async (e) => {
      e.preventDefault();
      const v = cleanKey($('#mail-key-input', box).value);
      if (!v) return;
      setMailKey(v);
      try {
        const r = await request('/admin/mail-archive/key', { method: 'GET', headers: { 'X-Mail-Key': v } });
        if (!r.label) throw new Error('鑰匙不對');
        toast(`已解鎖：${r.label}`, 'success');
        ui.offset = 0;
        loadMailList();
      } catch {
        setMailKey('');
        toast('這把鑰匙不對（或已作廢），沒有存起來', 'error');
      }
    };
  }
  const priv = $('#mail-filters option[data-private]');
  if (priv) priv.hidden = !ui.label;
}

export async function loadMailTab() {
  const form = $('#mail-filters');
  if (form) {
    form.mailbox.value = ui.mailbox; form.folder.value = ui.folder; form.from.value = ui.from;
    form.to.value = ui.to; form.q.value = ui.q; form.hideSystem.checked = ui.hideSystem;
    form.onsubmit = (e) => {
      e.preventDefault();
      Object.assign(ui, { mailbox: form.mailbox.value, folder: form.folder.value, from: form.from.value, to: form.to.value,
        q: form.q.value.trim(), hideSystem: form.hideSystem.checked, offset: 0 });
      loadMailList();
    };
  }
  ui.offset = 0;
  return loadMailList();
}

function listQuery(extra = {}) {
  const sp = new URLSearchParams();
  const v = { mailbox: ui.mailbox, folder: ui.folder, from: ui.from, to: ui.to, q: ui.q, limit: String(PAGE), offset: String(ui.offset), ...extra };
  if (ui.hideSystem) sp.set('hide_system', '1');
  Object.entries(v).forEach(([k, val]) => { if (val) sp.set(k, val); });
  return `/admin/mail-archive/list?${sp}`;
}

async function loadMailList() {
  const target = $('#page-data');
  if (!target) return;
  if (!ui.offset) target.innerHTML = loading();
  try {
    const r = await mailGet(listQuery());
    ui.label = r.key_label || null;
    ui.items = ui.offset ? ui.items.concat(r.items || []) : (r.items || []);
    ui.hasMore = !!r.has_more;
    renderKeyBox();
    target.innerHTML = mailRows(ui.items, { lockedHint: !ui.label })
      + (ui.hasMore ? '<div class="mail-more"><button class="btn" id="mail-more">載入更多</button></div>' : '');
    wireRows(target);
    const more = $('#mail-more', target);
    if (more) more.onclick = () => { ui.offset += PAGE; loadMailList(); };
  } catch (e) {
    renderKeyBox();
    target.innerHTML = errorState(e);
  }
}

function linkBadge(m) {
  if (!m.link_type) return '';
  return `<span class="badge info" title="自動對到的卡片">${escapeHtml(LINK_LABEL[m.link_type] || m.link_type)}｜${text(m.link_name)}</span>`;
}

export function mailRows(items, { lockedHint = false, compact = false } = {}) {
  const hint = lockedHint ? `<p class="help mail-hint">Jacky 信箱（jackychen@）的信沒有列出來——要先在上方輸入私人鑰匙才看得到。</p>` : '';
  if (!items.length) return hint + empty('沒有符合的信', compact ? '' : '換個條件再查一次');
  return hint + `<div class="list mail-list">${items.map((m) => {
    const dir = m.folder === 'sent' ? '<span class="badge warning">寄</span>' : '<span class="badge success">收</span>';
    const who = m.folder === 'sent' ? `→ ${text(firstAddr(m.to_addrs))}` : `${text(m.from_name || m.from_addr)} →`;
    const att = (m.att_saved || m.att_count) ? `<span class="badge" title="附件數">附件 ${escapeHtml(String(m.att_saved || m.att_count))}</span>` : '';
    const sys = m.is_system_copy ? '<span class="badge" title="系統自動寄出的信放進寄件備份的副本">系統信</span>' : '';
    return `<button type="button" class="list-row mail-row" data-mail-id="${escapeHtml(String(m.id))}">
      <span class="mail-meta">${dir}<small>${escapeHtml(shortTime(m.sent_at))}</small>${compact ? '' : `<small>${escapeHtml(BOX_LABEL[m.mailbox] || m.mailbox)}</small>`}</span>
      <span class="mail-main"><b>${text(m.subject, '（無主旨）')}</b><small>${who}</small></span>
      <span class="mail-tags">${att}${sys}${compact ? '' : linkBadge(m)}</span></button>`;
  }).join('')}</div>`;
}

export function wireRows(root) {
  $$('[data-mail-id]', root).forEach((b) => { b.onclick = () => openMail(b.getAttribute('data-mail-id')); });
}

export async function openMail(id) {
  openSubDrawer({ title: '載入信件…', body: loading() });
  try {
    const r = await mailGet(`/admin/mail-archive/item/${encodeURIComponent(id)}`);
    const m = r.mail;
    const links = r.links || [];
    const atts = r.attachments || [];
    const linkBtns = links.map((l) => {
      const label = `${LINK_LABEL[l.link_type] || l.link_type}｜${l.link_name || l.link_id}`;
      if (l.link_type === 'candidate' && hooks.openCandidate) return `<button type="button" class="btn sm" data-mail-open-cand="${escapeHtml(l.link_id)}">${escapeHtml(label)}</button>`;
      if (l.link_type === 'client' && hooks.openCompany) return `<button type="button" class="btn sm" data-mail-open-co="${escapeHtml(l.link_id)}">${escapeHtml(label)}</button>`;
      return `<span class="badge">${escapeHtml(label)}</span>`;
    }).join('');
    // 2026-10-22：附件可以預覽（PDF 直接看、Word／Excel 轉成網頁）也可以下載
    const attHtml = atts.length ? atts.map((a) => `<div class="fp-att"><span class="fp-att-name"><span class="fp-fn" title="${escapeHtml(a.filename || '附件')}">${escapeHtml(a.filename || '附件')}</span><small>（${escapeHtml(fmtSize(a.size))}）</small></span>${fileButtons(`/admin/mail-archive/file/${encodeURIComponent(a.file_id)}`, a.filename || '附件')}</div>`).join('') : '<span class="help">沒有附件</span>';
    const skipped = m.att_skipped ? `<p class="notice">${escapeHtml(m.att_skipped)}</p>` : '';
    const missing = (m.att_count || 0) > atts.length ? `<p class="help">有 ${escapeHtml(String(m.att_count - atts.length))} 個附件還沒存好，下一輪會自動補。</p>` : '';
    openSubDrawer({
      title: m.subject || '（無主旨）',
      subtitle: `${BOX_LABEL[m.mailbox] || m.mailbox}・${m.folder === 'sent' ? '寄件' : '收件'}・${m.sent_at || ''}`,
      body: `<dl class="mail-head">
          <dt>寄件人</dt><dd>${text(m.from_name ? `${m.from_name} <${m.from_addr}>` : m.from_addr)}</dd>
          <dt>收件人</dt><dd>${text(m.to_addrs)}</dd>
          ${m.cc_addrs ? `<dt>副本</dt><dd>${text(m.cc_addrs)}</dd>` : ''}
        </dl>
        ${links.length ? `<h3>對到的卡片</h3><div class="actions-row">${linkBtns}</div>` : ''}
        <h3>附件</h3><div class="fp-atts">${attHtml}</div>${skipped}${missing}
        <h3>內文</h3><pre class="mail-body">${escapeHtml(m.body_text || '（沒有文字內容）')}</pre>
        ${m.body_truncated ? '<p class="help">內文太長，只存了前面約 5 萬字。</p>' : ''}
        ${m.is_system_copy ? '<p class="help">這封是系統自動寄出的信放進寄件備份的副本。</p>' : ''}`,
    });
    const root = $('#sub-overlay-root');
    $$('[data-mail-file]', root).forEach((b) => { b.onclick = () => downloadMailFile(b.getAttribute('data-mail-file'), b.getAttribute('data-mail-file-name')); });
    wireFileButtons(root, () => keyHeaders());
    $$('[data-mail-open-cand]', root).forEach((b) => { b.onclick = () => { $('#sub-overlay-root').innerHTML = ''; hooks.openCandidate(b.getAttribute('data-mail-open-cand')); }; });
    $$('[data-mail-open-co]', root).forEach((b) => { b.onclick = () => { $('#sub-overlay-root').innerHTML = ''; hooks.openCompany(b.getAttribute('data-mail-open-co')); }; });
  } catch (e) {
    openSubDrawer({ title: '信件打不開', body: errorState(e) });
  }
}

async function downloadMailFile(fileId, name) {
  try {
    const res = await fetch(`${CONFIG.apiBase}/admin/mail-archive/file/${encodeURIComponent(fileId)}`, {
      headers: { authorization: `Bearer ${localStorage.getItem(CONFIG.tokenKey) || ''}`, ...keyHeaders() },
    });
    if (!res.ok) { const body = await res.json().catch(() => null); throw new Error(body?.error || `下載失敗 HTTP ${res.status}`); }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const el = document.createElement('a');
    el.href = url; el.download = name || '附件'; document.body.appendChild(el); el.click(); el.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (e) { toast(e.message, 'error'); }
}

// 人選卡／客戶卡底下的「信件」區塊：抽屜畫好之後呼叫，接在抽屜內容最後面。
export async function injectMailSection(kind, id) {
  const body = $('#overlay-root .drawer .drawer-body');
  if (!body || !id) return;
  const sec = document.createElement('section');
  sec.className = 'mail-card-section';
  sec.innerHTML = `<h3>信件</h3><div class="mail-card-list">${loading('讀取信件中')}</div>`;
  body.appendChild(sec);
  try {
    const r = await mailGet(`/admin/mail-archive/list?link=${encodeURIComponent(`${kind}:${id}`)}&limit=20`);
    const box = $('.mail-card-list', sec);
    if (!box) return;
    const more = r.has_more ? '<p class="help">只列最近 20 封，其他到「信箱紀錄」頁搜尋。</p>' : '';
    box.innerHTML = mailRows(r.items || [], { lockedHint: !r.key_label, compact: true }) + more;
    wireRows(box);
  } catch (e) {
    const box = $('.mail-card-list', sec);
    if (box) box.innerHTML = `<p class="help">信件讀不到：${escapeHtml(e.message || '')}</p>`;
  }
}

// 2026-10-22 Jacky：開發客戶卡片「進度紀錄」底下的「信箱裡的往來信件」。
// 用收件人 Email／公司網域對到這家（後端 /admin/mail-archive/bd），包含 Jacky 以前從自己信箱寄的合約。
// 同一張卡片「成交條件」跟「信箱裡的往來信件」都要這份資料：同一家 20 秒內只打一次
const bdArchiveCache = new Map();
export function fetchBdArchive(company) {
  const hit = bdArchiveCache.get(company);
  if (hit && Date.now() - hit.at < 20000) return hit.p;
  const p = mailGet(`/admin/mail-archive/bd?company=${encodeURIComponent(company)}`);
  bdArchiveCache.set(company, { at: Date.now(), p });
  p.catch(() => bdArchiveCache.delete(company));
  return p;
}

export async function loadBdMailArchive(box, company) {
  if (!box || !company) return;
  box.innerHTML = loading('讀取信箱裡的往來信件');
  try {
    const r = await fetchBdArchive(company);
    const items = r.items || [];
    const hidden = r.hidden_private
      ? `<p class="help mail-hint">還有 <b>${escapeHtml(String(r.hidden_private))}</b> 封在 Jacky 信箱（jackychen@），要先到左邊「信箱紀錄」頁輸入私人鑰匙才看得到。</p>` : '';
    const keys = (r.keys && (r.keys.domains || []).length) ? `<p class="help">用這家的信箱網域對：${(r.keys.domains || []).map((d) => `@${escapeHtml(d)}`).join('、')}${(r.keys.emails || []).length ? `，以及 ${escapeHtml(String(r.keys.emails.length))} 個聯絡信箱` : ''}</p>`
      : ((r.keys && (r.keys.emails || []).length) ? `<p class="help">用這家的 ${escapeHtml(String(r.keys.emails.length))} 個聯絡信箱對</p>` : '<p class="help">這家還沒有任何聯絡信箱，系統對不到信。記紀錄時填上對方信箱，之後就會自動帶入。</p>');
    box.innerHTML = (items.length ? mailRows(items, { compact: true }) : `<p class="help">信箱裡還沒有跟這家來回的信。</p>`) + hidden + keys
      + (r.total > items.length ? `<p class="help">只列最近 ${escapeHtml(String(items.length))} 封，其他到「信箱紀錄」頁搜尋。</p>` : '');
    wireRows(box);
  } catch (e) {
    box.innerHTML = `<p class="help">信件讀不到：${escapeHtml(e.message || '')}</p>`;
  }
}
