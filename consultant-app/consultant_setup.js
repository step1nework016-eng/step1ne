// 2026-10-28 Jacky：「顧問上工設定」——管理員在這裡新增顧問、決定他用哪個 Gmail 登入、配給他哪些 AI 助手、換頭像。
// 版面照 ~/Desktop/104/顧問上工設定_示意_20261028.html（Jacky 核准的示意圖）。只接在測試版。
// ⚠️ 這階段「只是設定」：還沒有任何地方依這裡的角色／助手去擋資料；不會去 Cloudflare 開登入、不會寄邀請信。
// 後端：GET/POST /admin/consultant-settings、PATCH /admin/consultant-settings/<id>、POST …/<id>/avatar
// 2026-10-28 加「社群帳號」區：Threads／LinkedIn 綁定狀態卡＋綁定按鈕（GET …/<id>/oauth/<平台> 拿授權網址）、
// LINE OA 連結、貼文風格（存 social_accounts.skill_prompt；語氣卡由 social_post_agent.py 自動重抽）。
import { CONFIG } from './config.js';
import { api } from './core/api.js';
import { $, $$, loading, errorState, toast } from './core/ui.js';
import { escapeHtml } from './core/security.js';

// 9 個崗位：名稱跟順序照 Step1ne_agent職務說明書_20261028.json（r1～r9），說明照示意圖
const HELPERS = [
  ['r1', '開發客戶', '幫他列今天要打的公司、追客戶回信'],
  ['r2', '職缺上架', '把他接的需求表整理成職缺草稿'],
  ['r3', '找人', '依他名下職缺每天找人、放進滑卡'],
  ['r4', '阿財初篩', '人選應徵他的職缺時跟阿財面談'],
  ['r5', '電洽助理', '打電話前的準備卡、電話提醒、整理逐字稿'],
  ['r6', '推薦給客戶', '產客戶版履歷、追送件進度'],
  ['r7', '錄取後關懷', '到職第 7／30／60／80 天提醒他去關心'],
  ['r8', '請款收費', '他成交的案子到期提醒、催款'],
  ['r9', '社群經營', '用他自己的社群帳號產稿、排程發文']];
const SHARED = [['阿財面談引擎', '所有應徵者都會跟阿財聊，全公司一套'], ['寄信員', 'official@ 信箱代寄，全公司一套'], ['看門狗監控', 'AI 師傅、社群停擺通知，管理員才收得到']];
const DEV = [['agent 盤點／排程', '看所有 AI 員工狀態、開關排程'], ['部署與測試版', '改後台、上線前測試']];
const ROLES = [['consultant', '顧問'], ['admin', '管理員'], ['admin_dev', '管理員兼開發者']];
const ROLE_ZH = Object.fromEntries(ROLES);
const COLORS = ['#1f5fa8', '#0f6e56', '#993c1d', '#6a3fa0', '#8a5a00', '#2f6f8f', '#a33a5b'];
const PLATFORM_ZH = { threads: 'Threads', linkedin: 'LinkedIn', line_community: 'LINE 社群', facebook: 'Facebook', instagram: 'Instagram' };
const NEXT_PHASE = '下一階段（需要 Jacky 在 Cloudflare 開 Google 登入）';

let hooks = { onConsultantsChanged: null };
const ui = { data: null, cur: null, adding: false, target: null };
const avatarUrls = new Map(); // file_id → blob: 網址（頭像要帶 Authorization 才拿得到，不能直接 <img src>）

export function initConsultantSetup(h) { hooks = { ...hooks, ...h }; }

export const consultantSetupView = () => `<div class="page-head"><div><h1>顧問上工設定</h1><p>管理員在這裡新增顧問、決定他用哪個 Gmail 登入、配給他哪些 AI 助手。AI 助手之後只會幫他處理他自己名下的職缺、人選和社群帳號。</p></div><div class="actions"></div></div>
<div class="cs-banner" role="note">測試版：目前只是設定，還不會限制每個人看得到什麼</div>
<div id="page-data"></div>`;

const me = () => (document.querySelector('[data-me-global]') || {}).value || '';
const colorOf = (id) => { let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; };

function avatarHtml(c, size = 36) {
  const url = c.avatar_file_id && avatarUrls.get(c.avatar_file_id);
  const st = `width:${size}px;height:${size}px`;
  if (url) return `<img class="cs-av" style="${st}" src="${url}" alt="">`;
  return `<span class="cs-av" style="${st};background:${colorOf(c.id)};font-size:${Math.round(size * 0.42)}px" aria-hidden="true">${escapeHtml(String(c.display_name || '?').slice(0, 1).toUpperCase())}</span>`;
}

async function fetchAvatar(fid) {
  if (!fid || avatarUrls.has(fid)) return;
  avatarUrls.set(fid, '');
  try {
    const tok = localStorage.getItem(CONFIG.tokenKey) || '';
    const r = await fetch(`${CONFIG.apiBase}/admin/file/${encodeURIComponent(fid)}`, { headers: { Authorization: `Bearer ${tok}` } });
    if (!r.ok) throw new Error(String(r.status));
    avatarUrls.set(fid, URL.createObjectURL(await r.blob()));
  } catch { avatarUrls.delete(fid); }
}
async function loadAvatars() {
  const ids = (ui.data?.consultants || []).map((c) => c.avatar_file_id).filter((f) => f && !avatarUrls.has(f));
  if (!ids.length) return;
  await Promise.all(ids.map(fetchAvatar));
  paint();
}

export async function loadConsultantSetupTab(target) {
  ui.target = target;
  target.innerHTML = loading();
  try {
    ui.data = await api.get('/admin/consultant-settings');
    const list = ui.data.consultants || [];
    if (!ui.adding && (!ui.cur || !list.find((c) => c.id === ui.cur))) ui.cur = list[0]?.id || null;
    paint();
    loadAvatars();
  } catch (e) { target.innerHTML = errorState(e, 'refresh'); }
}

async function reload(keepId) {
  ui.data = await api.get('/admin/consultant-settings');
  if (keepId) { ui.cur = keepId; ui.adding = false; }
  if (hooks.onConsultantsChanged) hooks.onConsultantsChanged();
  paint();
  loadAvatars();
}

function paint() {
  const t = ui.target; if (!t || !ui.data) return;
  const list = ui.data.consultants || [];
  // 2026-10-28 Jacky：移除的顧問（is_active=0）資料保留，名單上收進最下面「已移除的顧問」
  const personBtn = (c) => `<button type="button" class="cs-person${c.is_active ? '' : ' off'}" data-cs-sel="${escapeHtml(c.id)}" aria-current="${!ui.adding && c.id === ui.cur}">${avatarHtml(c)}<span><span class="cs-pn">${escapeHtml(c.display_name)}</span><span class="cs-role">${escapeHtml(c.role_zh || '顧問')}${c.is_active ? '' : '（已停用）'}</span></span></button>`;
  const live = list.filter((c) => c.is_active), gone = list.filter((c) => !c.is_active);
  t.innerHTML = `<div class="cs-layout"><nav class="cs-card cs-people" aria-label="顧問名單">${live.map(personBtn).join('')}
    <button type="button" class="cs-person cs-add" data-cs-add aria-current="${ui.adding}">＋ 新增顧問</button>
    ${gone.length ? `<details class="cs-gone"${gone.some((c) => c.id === ui.cur) ? ' open' : ''}><summary>已移除的顧問（${gone.length}）</summary>${gone.map(personBtn).join('')}</details>` : ''}</nav>
    <section class="cs-card" id="cs-detail">${ui.adding ? addForm() : detail(list.find((c) => c.id === ui.cur))}</section></div>`;
  wire(t);
}

function sw(attrs, on, disabled, label) {
  return `<label class="cs-sw"><input type="checkbox" ${on ? 'checked' : ''} ${disabled ? 'disabled' : ''} ${attrs} aria-label="${escapeHtml(label)}"><span></span></label>`;
}

function detail(c) {
  if (!c) return '<p class="muted">還沒有顧問，按左邊「＋ 新增顧問」。</p>';
  const isAdmin = c.role !== 'consultant';
  const jobsTxt = c.open_jobs ? `${c.open_jobs} 個開放中` : `0 個（還沒有，管理員在職缺頁指派${ui.data.open_jobs_unassigned ? `；目前有 ${ui.data.open_jobs_unassigned} 個開放職缺還沒指定負責顧問` : ''}）`;
  const log = (c.change_log || []).slice(0, 5);
  return `<div class="cs-head">${avatarHtml(c, 64)}<div><h2>${escapeHtml(c.display_name)}</h2>
      <div class="cs-avbtns"><label class="btn sm cs-upl">上傳頭像<input type="file" accept="image/jpeg,image/png,image/webp" data-cs-avatar="${escapeHtml(c.id)}" hidden></label>${c.avatar_file_id ? `<button type="button" class="btn sm ghost" data-cs-avatar-rm="${escapeHtml(c.id)}">拿掉頭像</button>` : ''}<span class="cs-hint">jpg／png／webp，2MB 以內，會自動裁成正方形</span></div></div></div>
    <div class="cs-row"><b>登入 Gmail</b><div class="cs-inline"><input type="email" id="cs-mail" value="${escapeHtml(c.login_email || '')}" placeholder="例如 xxx@gmail.com" autocomplete="off"><button type="button" class="btn sm" data-cs-save-mail>儲存</button></div></div>
    <div class="cs-row"><b>角色</b><select id="cs-role">${ROLES.map(([v, l]) => `<option value="${v}" ${v === c.role ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="cs-row"><b>名下職缺</b><span>${jobsTxt}</span></div>
    ${socialSection(c)}
    <div class="cs-sec">配給他的 AI 助手（9 個崗位）</div>
    <div class="cs-grid">${HELPERS.map(([id, t, d]) => { const on = (c.helpers || []).includes(id); return `<div class="cs-agent${on ? ' on' : ''}">${sw(`data-cs-helper="${id}"`, on, false, t)}<div><div class="t">${t}</div><div class="d">${d}</div></div></div>`; }).join('')}</div>
    <div class="cs-sec">全公司共用（不能取消）</div>
    <div class="cs-grid">${SHARED.map(([t, d]) => `<div class="cs-agent lock">${sw('', true, true, t + '（共用，不能取消）')}<div><div class="t">${t}<span class="cs-tag l">共用</span></div><div class="d">${d}</div></div></div>`).join('')}</div>
    ${c.role === 'admin_dev' ? `<div class="cs-sec">開發者工具</div><div class="cs-grid">${DEV.map(([t, d]) => `<div class="cs-agent on">${sw('', true, true, t)}<div><div class="t">${t}<span class="cs-tag dev">開發者</span></div><div class="d">${d}</div></div></div>`).join('')}</div>` : ''}
    <div class="cs-scope">${isAdmin ? '管理員：看得到全部顧問的職缺、人選、成果，也可以替別人配 AI 助手。' : '顧問：登入後只看得到自己名下的職缺、人選、社群帳號；AI 助手的成果也只送給他。'}<br><small>（這是之後要做到的樣子；測試版現在還不會真的擋。）</small></div>
    ${c.is_active ? '' : `<div class="notice" style="margin-top:12px">${escapeHtml(c.display_name)} 已移除：不會出現在指派名單、社群自動發文已暫停。人選、職缺、發文紀錄都還在，按下面「恢復」就回來。</div>`}
    <div class="cs-foot">${!c.is_active ? `<button type="button" class="btn sm" data-cs-active="1">恢復這位顧問</button>`
      : (isAdmin || ['jacky', 'phoebe'].includes(c.id)) ? `<span class="muted" style="font-size:13px">管理員不能移除</span>`
      : `<button type="button" class="btn sm ghost" data-cs-active="0" style="color:var(--bad,#b4322a)">移除這位顧問</button>`}
      ${log.length ? `<details class="cs-log"><summary>最近改了什麼（${log.length}）</summary><ul>${log.map((l) => `<li><time>${escapeHtml(l.at || '')}</time> ${escapeHtml(l.text || '')}<span class="muted">（${escapeHtml(l.by || '')}）</span></li>`).join('')}</ul></details>` : ''}</div>`;
}

// ── 社群帳號區 ───────────────────────────────────────────────
const day = (s) => String(s || '').slice(0, 10);
function socCard(c, plat) {
  const s = c.social || {}; const a = s[plat] || { bound: false };
  const name = PLATFORM_ZH[plat];
  const who = a.username ? '@' + a.username : (a.label || name);
  let status, sub = '';
  if (a.bound) {
    status = `<span class="cs-ok">✅ 已綁定 ${escapeHtml(who)}${a.expires_at ? ` · 到期 ${escapeHtml(day(a.expires_at))}` : ''}</span>`;
    sub = plat === 'threads' ? '系統每週自動續期，不用管' : '到期前要再按一次「重新綁定」';
  } else if (a.id) {
    status = '<span class="cs-no">未綁定</span>'; sub = '卡片已建好（風格、LINE 連結有存），還沒授權帳號';
  } else {
    status = '<span class="cs-no">未綁定</span>';
  }
  const tOff = plat === 'threads' && !(ui.data.threads_oauth || {}).ready;
  const btn = `<button type="button" class="btn sm${a.bound ? ' ghost' : ' primary'}" data-cs-bind="${plat}">${a.bound ? '重新綁定' : '綁定 ' + name}</button>`;
  return `<div class="cs-soc-card${a.bound ? ' on' : ''}"><div class="t">${name}</div><div>${status}</div>${sub ? `<div class="d">${sub}</div>` : ''}
    <div class="cs-inline">${btn}</div>${tOff ? `<div class="cs-meta" data-cs-meta hidden></div>` : ''}</div>`;
}
function socialSection(c) {
  const s = c.social || {};
  const names = (ui.data.social_names || []).filter((n) => !n.claimed_by || n.claimed_by === c.display_name);
  const opts = [`<option value="">用顯示名稱「${escapeHtml(c.display_name)}」</option>`]
    .concat(names.filter((n) => n.name.toLowerCase() !== String(c.display_name).toLowerCase())
      .map((n) => `<option value="${escapeHtml(n.name)}" ${s.explicit && s.name === n.name ? 'selected' : ''}>${escapeHtml(n.name)}</option>`)).join('');
  const vc = s.voice_card ? `<details class="cs-log"><summary>AI 抓出來的語氣卡（產稿時用）</summary><p class="cs-vc">${escapeHtml(s.voice_card)}</p>
      <p class="cs-hint">${s.voice_card_manual ? '這張語氣卡是手改過的，改上面的風格不會自動更新它（要改請到「社群」頁的顧問卡片）。' : '改了上面的風格後，下次產稿 AI 會自動重抽這張語氣卡。'}</p></details>` : '';
  return `<div class="cs-sec">社群帳號</div>
    <div class="cs-row"><b><label for="cs-socname">對應社群名稱</label></b><div><select id="cs-socname">${opts}</select>
      <div class="cs-hint">社群自動發文用的名字。舊顧問的社群名字跟顯示名稱不一樣時（例如 Dan H），在這裡選。</div></div></div>
    <div class="cs-soc">${socCard(c, 'threads')}${socCard(c, 'linkedin')}</div>
    <div class="cs-row"><b>審核通知</b><span>${s.tg_topic ? '✅ 已有 TG 審核主題' : '還沒有 TG 審核主題（第一次綁定 Threads 時會自動開）'}</span></div>
    <div class="cs-row"><b><label for="cs-line">LINE OA 連結</label></b><div class="cs-inline"><input id="cs-line" type="url" inputmode="url" value="${escapeHtml(s.line_link || '')}" placeholder="例如 https://lin.ee/xxxx" autocomplete="off"><button type="button" class="btn sm" data-cs-save-line>儲存</button></div></div>
    <div class="cs-row cs-top"><b><label for="cs-style">貼文風格</label></b><div><textarea id="cs-style" rows="7" placeholder="貼上他的 Threads 貼文風格說明（口吻、自稱、常用句型、emoji 習慣…）">${escapeHtml(s.skill_prompt || '')}</textarea>
      <div class="cs-inline"><button type="button" class="btn sm" data-cs-save-style>儲存風格</button><span class="cs-hint">${s.skill_prompt ? `目前 ${s.skill_prompt.length} 字` : '還沒有風格，AI 會用公司預設寫法'}</span></div>${vc}</div></div>`;
}

function addForm() {
  const def = (ui.data?.default_helpers || ['r3', 'r4', 'r5', 'r6', 'r9']).map((id) => (HELPERS.find((h) => h[0] === id) || [, id])[1]).join('、');
  return `<h2>新增顧問</h2>
    <ol class="cs-steps"><li class="now">① 填資料</li><li>② 系統開通登入<span class="cs-badge">${NEXT_PHASE}</span></li><li>③ 寄邀請信<span class="cs-badge">${NEXT_PHASE}</span></li><li>④ 他第一次登入、綁社群帳號</li></ol>
    <form id="cs-add-form" novalidate>
    <div class="cs-row"><b><label for="cs-new-name">顯示名稱</label></b><input id="cs-new-name" maxlength="40" placeholder="例如 Anna" required></div>
    <div class="cs-row"><b><label for="cs-new-mail">登入 Gmail</label></b><input id="cs-new-mail" type="email" placeholder="他自己的 Gmail，例如 anna@gmail.com" required autocomplete="off"></div>
    <div class="cs-row"><b><label for="cs-new-role">角色</label></b><select id="cs-new-role"><option value="consultant" selected>顧問</option><option value="admin">管理員</option></select></div>
    <div class="cs-row"><b>頭像</b><div class="cs-inline"><span id="cs-new-av-prev">${avatarHtml({ id: 'new', display_name: '新' }, 44)}</span><label class="btn sm cs-upl">上傳頭像<input type="file" accept="image/jpeg,image/png,image/webp" id="cs-new-av" hidden></label><span class="cs-hint">可以之後再補</span></div></div>
    <div class="cs-row"><b>預設 AI 助手</b><span>${def}（建好後可以再調）</span></div>
    <div class="cs-row"><b>邀請信</b><span class="muted">還不會寄。${NEXT_PHASE}</span></div>
    <button type="submit" class="btn primary cs-create">建立顧問</button></form>
    <div class="cs-scope">按下「建立」目前只會做：在顧問名單建一筆、存好 Gmail 和角色、開好預設的 AI 助手。<b>還不會</b>把 Gmail 加進後台登入名單、也不會寄信——那兩步是下一階段。</div>`;
}

// 圖片 → 置中裁成正方形 → 縮到 256px → jpeg（Safari 的 canvas 不一定能存 webp，jpeg 最穩）
async function squareAvatar(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('頭像只收 jpg／png／webp');
  if (file.size > 2 * 1024 * 1024) throw new Error('頭像超過 2MB，請換小一點的圖');
  const src = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('圖片讀不出來')); i.src = src; });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const out = Math.min(256, side);
    const cv = document.createElement('canvas'); cv.width = out; cv.height = out;
    const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, out, out);
    g.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, out, out);
    const dataUrl = cv.toDataURL('image/jpeg', 0.88);
    return { b64: dataUrl.split(',')[1], mime: 'image/jpeg', preview: dataUrl };
  } finally { URL.revokeObjectURL(src); }
}

async function uploadAvatar(id, file) {
  const a = await squareAvatar(file);
  const r = await api.post(`/admin/consultant-settings/${encodeURIComponent(id)}/avatar`, { b64: a.b64, mime: a.mime, by: me() });
  if (r.avatar_file_id) avatarUrls.set(r.avatar_file_id, a.preview);
  return r;
}

async function patch(id, body, okMsg) {
  try {
    const r = await api.patch(`/admin/consultant-settings/${encodeURIComponent(id)}`, { ...body, by: me() });
    if (!r.unchanged) toast(okMsg, 'success');
    await reload(id);
    return true;
  } catch (e) { toast(e.message || '儲存失敗', 'error'); await reload(id).catch(() => {}); return false; }
}

let newAvatarFile = null;
function wire(t) {
  $$('[data-cs-sel]', t).forEach((b) => { b.onclick = () => { ui.cur = b.getAttribute('data-cs-sel'); ui.adding = false; paint(); }; });
  const add = $('[data-cs-add]', t); if (add) add.onclick = () => { ui.adding = true; newAvatarFile = null; paint(); $('#cs-new-name')?.focus(); };
  const c = (ui.data.consultants || []).find((x) => x.id === ui.cur);

  $$('[data-cs-helper]', t).forEach((inp) => {
    inp.onchange = async () => {
      const hid = inp.getAttribute('data-cs-helper'); const name = (HELPERS.find((h) => h[0] === hid) || [])[1];
      inp.disabled = true;
      inp.closest('.cs-agent')?.classList.toggle('on', inp.checked);
      await patch(c.id, { helper: { id: hid, on: inp.checked } }, `${c.display_name}：「${name}」已${inp.checked ? '開啟' : '關閉'}`);
    };
  });
  const role = $('#cs-role', t);
  if (role) role.onchange = async () => {
    if (c.role === 'admin_dev' && role.value !== 'admin_dev' && !window.confirm(`把 ${c.display_name} 改成「${ROLE_ZH[role.value]}」？他會看不到開發者工具。`)) { role.value = c.role; return; }
    await patch(c.id, { role: role.value }, `${c.display_name} 的角色改成「${ROLE_ZH[role.value]}」`);
  };
  const saveMail = $('[data-cs-save-mail]', t);
  if (saveMail) saveMail.onclick = async () => {
    const v = ($('#cs-mail', t).value || '').trim();
    if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) { toast('Gmail 格式不對，例如 anna@gmail.com', 'error'); return; }
    saveMail.disabled = true;
    await patch(c.id, { login_email: v }, `${c.display_name} 的登入 Gmail 已儲存`);
  };
  const act = $('[data-cs-active]', t);
  if (act) act.onclick = async () => {
    const on = act.getAttribute('data-cs-active') === '1';
    if (!on && !window.confirm(`移除 ${c.display_name}？\n\n・名單上收到「已移除的顧問」，不能再被指派職缺\n・他的社群帳號自動發文會暫停\n・人選、職缺、發文紀錄全部保留，之後可以按「恢復」`)) return;
    await patch(c.id, { is_active: on ? 1 : 0 }, on ? `${c.display_name} 已恢復` : `${c.display_name} 已移除（資料保留）`);
  };
  const av = $('[data-cs-avatar]', t);
  if (av) av.onchange = async () => {
    const f = av.files && av.files[0]; if (!f) return;
    try { await uploadAvatar(c.id, f); toast(`${c.display_name} 的頭像已更新`, 'success'); await reload(c.id); }
    catch (e) { toast(e.message || '頭像上傳失敗', 'error'); }
  };
  const avRm = $('[data-cs-avatar-rm]', t);
  if (avRm) avRm.onclick = async () => {
    try { await api.post(`/admin/consultant-settings/${encodeURIComponent(c.id)}/avatar`, { remove: true, by: me() }); toast('頭像已拿掉', 'success'); await reload(c.id); }
    catch (e) { toast(e.message || '失敗', 'error'); }
  };

  // 社群帳號
  const socName = $('#cs-socname', t);
  if (socName) socName.onchange = async () => {
    socName.disabled = true;
    await patch(c.id, { social_name: socName.value }, `${c.display_name} 的社群帳號對應改成「${socName.value || c.display_name}」`);
  };
  $$('[data-cs-bind]', t).forEach((b) => {
    b.onclick = async () => {
      const plat = b.getAttribute('data-cs-bind');
      // 先同步開分頁（等 API 回來才開會被瀏覽器當成彈出視窗擋掉）
      const w = (plat === 'linkedin' || (ui.data.threads_oauth || {}).ready) ? window.open('', '_blank') : null;
      b.disabled = true;
      try {
        const r = await api.get(`/admin/consultant-settings/${encodeURIComponent(c.id)}/oauth/${plat}`);
        if (r.ready && r.url) {
          if (w) w.location.href = r.url; else window.open(r.url, '_blank', 'noopener');
          toast(`已開新分頁：請${c.display_name}本人登入${PLATFORM_ZH[plat]}按「允許」，完成後切回這頁會自動更新`, 'success');
          // 2026-10-28 Jacky：綁完切回來要自己顯示「已綁定」，不用手動重新整理
          // 要先真的離開過這頁（切去授權分頁）再回來才更新，避免一按下去就立刻重抓
          let left = document.visibilityState !== 'visible' || !document.hasFocus();
          const away = () => { left = true; };
          const back = () => { if (!left || document.visibilityState !== 'visible') return;
            document.removeEventListener('visibilitychange', back); window.removeEventListener('focus', back); window.removeEventListener('blur', away);
            reload(c.id).catch(() => {}); };
          window.addEventListener('blur', away);
          document.addEventListener('visibilitychange', back); window.addEventListener('focus', back);
        } else {
          if (w) w.close();
          const box = b.closest('.cs-soc-card').querySelector('[data-cs-meta]');
          if (box) {
            box.hidden = false;
            box.innerHTML = `<b>需要 Jacky 先在 Meta 設定回傳網址</b>，設好之前這顆按鈕還不能用。要貼到 Meta 的網址：
              <div class="cs-inline"><code>${escapeHtml(r.redirect_uri || '')}</code><button type="button" class="btn sm ghost" data-cs-copy>複製</button></div>`;
            const cp = box.querySelector('[data-cs-copy]');
            cp.onclick = async () => { try { await navigator.clipboard.writeText(r.redirect_uri || ''); toast('網址已複製', 'success'); } catch { toast('複製失敗，請手動選取', 'error'); } };
            cp.focus();
          }
        }
      } catch (e) { if (w) w.close(); toast(e.message || '拿不到綁定網址', 'error'); }
      b.disabled = false;
    };
  });
  const saveLine = $('[data-cs-save-line]', t);
  if (saveLine) saveLine.onclick = async () => {
    const v = ($('#cs-line', t).value || '').trim();
    if (v && !/^https:\/\/\S+$/.test(v)) { toast('LINE 連結要是 https:// 開頭，例如 https://lin.ee/xxxx', 'error'); return; }
    saveLine.disabled = true;
    await patch(c.id, { social: { line_link: v } }, `${c.display_name} 的 LINE 連結已儲存`);
  };
  const saveStyle = $('[data-cs-save-style]', t);
  if (saveStyle) saveStyle.onclick = async () => {
    const v = ($('#cs-style', t).value || '').trim();
    if (!v) { toast('貼文風格不能是空的', 'error'); return; }
    saveStyle.disabled = true;
    await patch(c.id, { social: { skill_prompt: v } }, `${c.display_name} 的貼文風格已儲存（AI 下次產稿會照新風格）`);
  };

  const nav = $('#cs-new-av', t);
  if (nav) nav.onchange = async () => {
    const f = nav.files && nav.files[0]; if (!f) return;
    try { const a = await squareAvatar(f); newAvatarFile = f; $('#cs-new-av-prev', t).innerHTML = `<img class="cs-av" style="width:44px;height:44px" src="${a.preview}" alt="">`; }
    catch (e) { newAvatarFile = null; nav.value = ''; toast(e.message, 'error'); }
  };
  const form = $('#cs-add-form', t);
  if (form) form.onsubmit = async (ev) => {
    ev.preventDefault();
    const name = $('#cs-new-name', t).value.trim(); const mail = $('#cs-new-mail', t).value.trim(); const r = $('#cs-new-role', t).value;
    if (!name) { toast('請填顯示名稱', 'error'); $('#cs-new-name', t).focus(); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail)) { toast('Gmail 格式不對，例如 anna@gmail.com', 'error'); $('#cs-new-mail', t).focus(); return; }
    const btn = $('.cs-create', t); btn.disabled = true; btn.textContent = '建立中…';
    try {
      const res = await api.post('/admin/consultant-settings', { display_name: name, login_email: mail, role: r, by: me() });
      if (newAvatarFile) { try { await uploadAvatar(res.id, newAvatarFile); } catch (e) { toast('顧問建好了，但頭像沒傳上去：' + (e.message || ''), 'error'); } }
      newAvatarFile = null;
      toast(`已建立顧問 ${name}（登入開通、邀請信是下一階段）`, 'success');
      await reload(res.id);
    } catch (e) { toast(e.message || '建立失敗', 'error'); btn.disabled = false; btn.textContent = '建立顧問'; }
  };
}
