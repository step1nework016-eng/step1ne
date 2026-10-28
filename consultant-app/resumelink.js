// 「上傳履歷」連結：人選打開就能上傳履歷，不經阿財面談。
// 公開頁 /resume-upload-beta/，後端 public-worker POST /resume-upload。
// 2026-10-27 Jacky 核准信件文字、正式上線（RU_LINK_V2）：
//   入口①：人選中心頁首「給人選連結」（原「寄上傳履歷連結」）——LINE 來、還不在系統裡的人選，填姓名＋（Email）＋職缺。
//   入口②：人選卡片「總覽 → 聯絡人選」——帶好這位人選的姓名、Email、職缺。
//   兩種給法，連結內容一樣（只差 src）：
//     1. 複製連結（貼到 LINE）：src=line，前端直接算，不打後端。
//     2. 寄出（Email）：後端 POST /admin/resume-upload-link 從 official@ 寄，src=email。
//   連結帶 by=<顧問 id>（畫面最上方「我是」）：人選上傳後，新人選卡片自動指派給這位顧問。
// 2026-10-27 RU_LINK_V3「給人選連結」：Jacky 說不要再加按鈕、連結集中一處、擇一用分頁——
//   分頁①「還沒聊過 → 應徵連結」：選職缺 → 給那個職缺官網頁上同一種應徵連結（只複製貼 LINE，不寄信）。
//     無經驗／培訓缺走 /apply-quick/，其他走 /apply/，「沒經驗、還不確定哪個缺」走 /apply-general/。
//   分頁②「已經聊過 → 上傳履歷連結」：就是原本的上傳履歷（複製＋寄信），行為不變。
//   人選卡片「聯絡人選」打開時預設分頁②；人選中心頁首／職缺抽屜預設分頁①。
import { api } from './core/api.js';
import { $, loading, openSubDrawer, closeSubDrawer, toast } from './core/ui.js';
import { escapeHtml } from './core/security.js';

const PAGE = 'https://step1ne.com/resume-upload-beta/';
// 系統用的空殼職缺，連結裡不能帶
const NO_JOB = new Set(['', 'unspecified', 'other', 'resume-upload-unspecified', 'entry-general-match']);
const CLOSED = new Set(['closed', 'social_only', 'draft']);

// 走「快速應徵」的職缺。系統裡沒有欄位標記這件事，官網職缺頁按鈕看的是
// step1ne-recruit/jobtpl/quick_apply.py 的 QUICK_APPLY_SLUGS、後端收件看 public-worker 的 QUICK_JOBS，
// 兩邊都是這四個；那邊改，這裡也要一起改（不然顧問給的連結會被快速應徵表單擋掉）。
export const QUICK_APPLY_SLUGS = new Set([
  'bim-mep-drafting-engineer-hsinchu',
  'semiconductor-bim-mep-drafting-trainee-hsinchu',
  'bim-engineer-houli',
  'trainee-engineering-design-engineer',
  'engineering-drafting-trainee-tongluo',
]);
export const GENERAL = '__general__';
const SITE = 'https://step1ne.com';

// 應徵連結：跟官網職缺頁「我要應徵」同一套網址，只把 utm 換成顧問給的
export function applyUrl(jobSlug = '', jobTitle = '', medium = 'line') {
  if (!jobSlug || jobSlug === GENERAL || NO_JOB.has(jobSlug)) return `${SITE}/apply-general/`;
  const path = QUICK_APPLY_SLUGS.has(jobSlug) ? '/apply-quick/' : '/apply/';
  return `${SITE}${path}?job=${encodeURIComponent(jobSlug)}&title=${encodeURIComponent(jobTitle || '')}`
    + `&utm_source=consultant&utm_medium=${encodeURIComponent(medium)}&utm_campaign=${encodeURIComponent(jobSlug)}`;
}
export function applyKind(jobSlug = '') {
  if (!jobSlug || jobSlug === GENERAL || NO_JOB.has(jobSlug)) return '不指定職缺｜人選自己選方向';
  return QUICK_APPLY_SLUGS.has(jobSlug) ? '快速應徵｜無經驗／培訓職缺，表單比較短' : '一般應徵｜這個職缺官網頁上的同一個應徵表單';
}

// 跟後端 /admin/resume-upload-link 算法一樣：src → job → by
export function resumeUploadUrl(jobSlug = '', src = 'line', by = '') {
  let u = `${PAGE}?src=${encodeURIComponent(src)}`;
  if (jobSlug && !NO_JOB.has(jobSlug)) u += `&job=${encodeURIComponent(jobSlug)}`;
  if (by) u += `&by=${encodeURIComponent(by)}`;
  return u;
}

// 一顆按鈕「給人選連結」，打開兩分頁視窗：①應徵連結（還沒聊過）②上傳履歷連結（已經聊過）
// tab：'apply' | 'upload'；沒給的話，有人選卡片（appId）→ upload，其他 → apply
export function resumeLinkButtons({ appId = '', email = '', name = '', jobSlug = '', jobTitle = '', label = '給人選連結', cls = 'btn sm', tab = '' } = {}) {
  const e = escapeHtml;
  const hasJob = jobSlug && !NO_JOB.has(jobSlug);
  const t = tab || (appId ? 'upload' : 'apply');
  return `<button type="button" class="${e(cls)}" data-ru-mail data-ru-tab="${e(t)}" data-ru-app="${e(appId)}" data-ru-email="${e(email)}" data-ru-name="${e(name)}" data-ru-job="${e(hasJob ? jobSlug : '')}" data-ru-jobtitle="${e(hasJob ? jobTitle : '')}" title="還沒聊過的給應徵連結、已經聊過的給上傳履歷連結，兩種都在這裡" style="min-height:44px">${e(label)}</button>`;
}

let deps = { me: () => '', meId: () => '', jobs: async () => [], jobLabel: (j) => j.title };
let cur = null;     // { appId, email, name, jobSlug, jobTitle }
let dirty = false;  // 顧問自己改過主旨／內文 → 不要自動蓋掉
let live = false;
let pvTimer = null;
let pvSeq = 0;
let openJobs = [];  // 這次打開時公開招募中的職缺（分頁①算連結要用職缺名）

function groupedOptions(jobs, selected) {
  const e = escapeHtml;
  const groups = new Map();
  jobs.forEach((j) => {
    const g = j.company_display_name || '其他';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(j);
  });
  return [...groups.entries()].map(([g, list]) => `<optgroup label="${e(g)}">${list.map((j) => `<option value="${e(j.slug)}" ${j.slug === selected ? 'selected' : ''}>${e(deps.jobLabel(j))}${QUICK_APPLY_SLUGS.has(j.slug) ? '（快速應徵）' : ''}</option>`).join('')}</optgroup>`).join('');
}

function applyPaneHtml(jobs, selected) {
  const e = escapeHtml;
  return `<div class="card" style="display:grid;gap:10px">
      <label class="field"><span>要給人選哪個職缺的應徵連結</span><select id="ru-apply-job" style="min-height:44px">
        <option value="${GENERAL}" ${selected ? '' : 'selected'}>沒經驗、還不確定哪個缺（綜合應徵）</option>${groupedOptions(jobs, selected)}</select></label>
      <p class="help" data-ru-apply-kind style="margin:0"></p>
      <p class="help" style="margin:0">人選會跟阿財完整面談</p>
      <input id="ru-apply-link" readonly value="" aria-label="應徵連結" style="min-height:44px;font-size:13px;color:var(--muted,#6b7280)" onclick="this.select()">
      <div><button type="button" class="btn primary" data-ru-action="copy-apply" style="min-height:44px">複製應徵連結（貼到 LINE）</button></div>
    </div>
    <p class="help">人選填完應徵表單就會進阿財面談，面談完系統自動建人選卡片。這種連結只給複製；要寄 Email 請用「約電話」那套信。</p>`;
}

function jobSelectHtml(jobs, selected) {
  const e = escapeHtml;
  const groups = new Map();
  jobs.forEach((j) => {
    const g = j.company_display_name || '其他';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(j);
  });
  return `<option value="">還不確定／其他職缺（人選自己選）</option>`
    + [...groups.entries()].map(([g, list]) => `<optgroup label="${e(g)}">${list.map((j) => `<option value="${e(j.slug)}" ${j.slug === selected ? 'selected' : ''}>${e(deps.jobLabel(j))}</option>`).join('')}</optgroup>`).join('');
}

function formHtml(jobs) {
  const e = escapeHtml;
  const open = jobs.some((j) => j.slug === cur.jobSlug);
  const lost = cur.jobSlug && !open;
  const tab = cur.tab === 'apply' ? 'apply' : 'upload';
  const tabBtn = (k, l) => `<button type="button" role="tab" id="ru-tab-${k}" aria-controls="ru-pane-${k}" aria-selected="${tab === k}" class="${tab === k ? 'active' : ''}" data-ru-tabbtn="${k}" style="min-height:44px;flex:1 1 auto">${l}</button>`;
  return `<div class="ru-wrap" style="display:grid;gap:14px">
    <div class="tabs tabs-group" role="tablist" aria-label="給人選哪一種連結" style="flex-wrap:wrap;overflow:visible;margin-bottom:0">${tabBtn('apply', '還沒聊過 → 應徵連結')}${tabBtn('upload', '已經聊過 → 上傳履歷連結')}</div>
    <div id="ru-pane-apply" role="tabpanel" aria-labelledby="ru-tab-apply" data-ru-pane="apply" style="display:grid;gap:14px" ${tab === 'apply' ? '' : 'hidden'}>
      ${applyPaneHtml(jobs, open ? cur.jobSlug : '')}
    </div>
    <div id="ru-pane-upload" role="tabpanel" aria-labelledby="ru-tab-upload" data-ru-pane="upload" style="display:grid;gap:14px" ${tab === 'upload' ? '' : 'hidden'}>
    <div class="notice" data-ru-me-warn ${deps.me() ? 'hidden' : ''}>請先在畫面最上方「我是」選你的名字——人選上傳後，卡片會自動算在你名下。</div>
    <div class="card" style="display:grid;gap:10px">
      <label class="field"><span>人選姓名（必填）</span><input id="ru-name" value="${e(cur.name || '')}" placeholder="例如：王小明" autocomplete="off" style="min-height:44px"></label>
      <label class="field"><span>Email（要寄信才需要；只複製連結貼 LINE 可以不填）</span><input id="ru-to" type="email" value="${e(cur.email || '')}" placeholder="name@example.com" autocomplete="off" style="min-height:44px"></label>
      <label class="field"><span>應徵職缺</span><select id="ru-job" style="min-height:44px">${jobSelectHtml(jobs, open ? cur.jobSlug : '')}</select></label>
      ${lost ? `<p class="help">這位人選原本的職缺「${e(cur.jobTitle || cur.jobSlug)}」目前沒有公開招募，連結不能帶它，請改選或用「還不確定」。</p>` : '<p class="help">連結會先幫人選選好這個職缺，他自己還是可以改。</p>'}
    </div>
    <div class="card" style="display:grid;gap:8px">
      <strong>方法一：複製連結，貼到 LINE</strong>
      <input id="ru-link" readonly value="" aria-label="上傳履歷連結" style="min-height:44px;font-size:13px;color:var(--muted,#6b7280)" onclick="this.select()">
      <div><button type="button" class="btn primary" data-ru-action="copy" style="min-height:44px">複製連結（貼到 LINE）</button></div>
    </div>
    <div class="card" style="display:grid;gap:8px">
      <strong>方法二：寄 Email（從 official@ 寄出）</strong>
      <div data-ru-live-warn></div>
      <label class="field"><span>主旨（可以直接改）</span><input id="ru-subject" value=""></label>
      <label class="field"><span>內文預覽（可以直接改，連結那一行不要刪）</span><textarea id="ru-text" rows="16" style="width:100%;font:inherit;line-height:1.7"></textarea></label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button type="button" class="btn" data-ru-action="refresh" style="min-height:44px">依上面重新產生內文</button>
        <button type="button" class="btn" data-ru-action="test" style="min-height:44px">先寄測試信給我看</button>
        <button type="button" class="btn primary" data-ru-action="send" style="min-height:44px">寄出（Email）</button>
      </div>
    </div>
    <p class="help">人選送出履歷後：系統自動建人選卡片（掛在上面選的職缺、負責顧問是你），TG「履歷進件」會通知。不會排阿財面談。同一個 Email 已經在系統的話，履歷補進原本那張卡片。</p>
    </div>
  </div>`;
}

function readForm() {
  cur.name = ($('#ru-name')?.value || '').trim();
  cur.email = ($('#ru-to')?.value || '').trim();
  cur.jobSlug = $('#ru-job')?.value || '';
}

function updateApply() {
  const sel = $('#ru-apply-job');
  if (!sel) return;
  const slug = sel.value;
  const j = openJobs.find((x) => x.slug === slug);
  const box = $('#ru-apply-link');
  if (box) box.value = applyUrl(slug, j ? j.title : '', 'line');
  const k = document.querySelector('#sub-overlay-root [data-ru-apply-kind]');
  if (k) k.textContent = applyKind(slug);
}

function switchTab(tab) {
  cur.tab = tab;
  document.querySelectorAll('#sub-overlay-root [data-ru-tabbtn]').forEach((b) => {
    const on = b.getAttribute('data-ru-tabbtn') === tab;
    b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on));
  });
  document.querySelectorAll('#sub-overlay-root [data-ru-pane]').forEach((p) => { p.hidden = p.getAttribute('data-ru-pane') !== tab; });
}

function updateLink() {
  const box = $('#ru-link');
  if (box) box.value = resumeUploadUrl(cur.jobSlug, 'line', deps.meId());
  const w = document.querySelector('#sub-overlay-root [data-ru-me-warn]');
  if (w) w.hidden = !!deps.me();
}

async function preview(force) {
  if (dirty && !force) return;
  const seq = ++pvSeq;
  try {
    const d = await api.post('/admin/resume-upload-link', { action: 'preview', by: deps.me() || null, to: cur.email, name: cur.name,
      application_id: cur.appId || null, job_slug: cur.jobSlug || '', src: 'email' });
    if (seq !== pvSeq) return;
    live = !!d.live;
    if ($('#ru-subject')) $('#ru-subject').value = d.subject || '';
    if ($('#ru-text')) $('#ru-text').value = d.text || '';
    dirty = false;
    const w = document.querySelector('#sub-overlay-root [data-ru-live-warn]');
    if (w) w.innerHTML = (live ? '' : '<div class="notice">信件寄送還沒開放，目前只能「先寄測試信給我看」。要給人選連結，先用上面的「複製連結」貼到 LINE。</div>')
      + (d.warn ? `<div class="notice">🚫 ${escapeHtml(d.warn)}</div>` : '');
    const sendBtn = document.querySelector('#sub-overlay-root [data-ru-action="send"]');
    if (sendBtn) sendBtn.disabled = !live;
  } catch (e) {
    if (seq !== pvSeq) return;
    const w = document.querySelector('#sub-overlay-root [data-ru-live-warn]');
    if (w) w.innerHTML = `<div class="notice">${escapeHtml((e.body && e.body.error) || e.message || '內文產生失敗')}</div>`;
  }
}

async function open(ctx) {
  cur = { ...ctx };
  dirty = false;
  if (cur.tab !== 'apply' && cur.tab !== 'upload') cur.tab = cur.appId ? 'upload' : 'apply';
  openSubDrawer({ title: '給人選連結', subtitle: cur.appId ? `${cur.name || ''}｜還沒聊過給應徵連結、已經聊過給上傳履歷連結` : '還沒聊過給應徵連結（會跟阿財面談）、已經聊過給上傳履歷連結（不經阿財）', body: loading() });
  let jobs = [];
  try { jobs = (await deps.jobs() || []).filter((j) => !CLOSED.has(String(j.status || '')) && !NO_JOB.has(j.slug)); }
  catch { jobs = []; }
  openJobs = jobs;
  const el = $('#sub-overlay-root .drawer-body');
  if (!el) return;
  el.innerHTML = formHtml(jobs);
  readForm();
  updateLink();
  updateApply();
  preview(true);
  if (cur.tab === 'upload' && !cur.name) $('#ru-name')?.focus();
}

function need(fields) {
  if (fields.includes('me') && !deps.me()) { toast('請先在畫面最上方「我是」選你的名字，系統才記得是誰給的連結', 'error'); document.querySelector('[data-me-global]')?.focus(); return false; }
  if (fields.includes('me') && !deps.meId()) { toast('找不到「我是」對應的顧問，請重新整理頁面再試一次', 'error'); return false; }
  if (fields.includes('name') && !cur.name) { toast('請填人選姓名', 'error'); $('#ru-name')?.focus(); return false; }
  if (fields.includes('email') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cur.email)) { toast('寄 Email 要填人選的 Email', 'error'); $('#ru-to')?.focus(); return false; }
  return true;
}

export function initResumeLink(opts) {
  if (typeof opts === 'function') deps.me = opts;
  else deps = { ...deps, ...(opts || {}) };
  document.addEventListener('input', (ev) => {
    const t = ev.target instanceof Element ? ev.target : null;
    if (!t || !cur || !t.closest('#sub-overlay-root .ru-wrap')) return;
    if (t.id === 'ru-subject' || t.id === 'ru-text') { dirty = true; return; }
    if (t.id === 'ru-apply-job') { updateApply(); return; }
    if (['ru-name', 'ru-to', 'ru-job'].includes(t.id)) {
      readForm(); updateLink();
      clearTimeout(pvTimer); pvTimer = setTimeout(() => preview(false), 450);
    }
  });
  document.addEventListener('change', (ev) => {
    const t = ev.target instanceof Element ? ev.target : null;
    if (t && t.closest('[data-me-global]')) updateLink();
    if (t && t.id === 'ru-apply-job' && cur) updateApply();
  });
  document.addEventListener('click', async (event) => {
    const t = event.target instanceof Element ? event.target : null;
    const opener = t && t.closest('[data-ru-mail]');
    if (opener) {
      event.preventDefault();
      open({ appId: opener.getAttribute('data-ru-app') || '', email: opener.getAttribute('data-ru-email') || '',
        name: opener.getAttribute('data-ru-name') || '', jobSlug: opener.getAttribute('data-ru-job') || '',
        jobTitle: opener.getAttribute('data-ru-jobtitle') || '', tab: opener.getAttribute('data-ru-tab') || '' });
      return;
    }
    const tb = t && t.closest('#sub-overlay-root [data-ru-tabbtn]');
    if (tb && cur) { event.preventDefault(); switchTab(tb.getAttribute('data-ru-tabbtn')); return; }
    const btn = t && t.closest('#sub-overlay-root [data-ru-action]');
    if (!btn || btn.disabled || !cur) return;
    event.preventDefault();
    const act = btn.getAttribute('data-ru-action');
    if (act === 'copy-apply') {
      updateApply();
      const link = $('#ru-apply-link')?.value || '';
      try { await navigator.clipboard.writeText(link); toast('已複製應徵連結，貼到 LINE 給人選就好', 'success'); }
      catch { $('#ru-apply-link')?.select(); toast('瀏覽器不讓自動複製，連結已經選起來了，請按 ⌘C／Ctrl+C', 'error'); }
      return;
    }
    readForm(); updateLink();
    if (act === 'refresh') { dirty = false; preview(true); return; }
    if (act === 'copy') {
      if (!need(['me', 'name'])) return;
      const link = resumeUploadUrl(cur.jobSlug, 'line', deps.meId());
      try { await navigator.clipboard.writeText(link); toast(`已複製 ${cur.name} 的上傳履歷連結，貼到 LINE 給他就好`, 'success'); }
      catch { $('#ru-link')?.select(); toast('瀏覽器不讓自動複製，連結已經選起來了，請按 ⌘C／Ctrl+C', 'error'); }
      return;
    }
    if (!need(act === 'send' ? ['me', 'name', 'email'] : ['me'])) return;
    if (act === 'send' && !window.confirm(`確定要把上傳履歷連結寄給 ${cur.name}（${cur.email}）嗎？`)) return;
    btn.disabled = true;
    try {
      const r = await api.post('/admin/resume-upload-link', { action: act, by: deps.me(), to: cur.email, name: cur.name,
        application_id: cur.appId || null, job_slug: cur.jobSlug || '', src: 'email',
        subject: $('#ru-subject')?.value || '', text: $('#ru-text')?.value || '' });
      if (act === 'test') { toast(`測試信已排入寄件匣，約 1 分鐘內寄到 ${r.to}`, 'success'); btn.disabled = false; return; }
      toast(`已寄上傳履歷連結給 ${cur.name}（${r.to}）`, 'success');
      closeSubDrawer();
    } catch (e) { toast((e.body && e.body.error) || e.message || '沒有寄出去', 'error'); btn.disabled = false; }
  });
}
