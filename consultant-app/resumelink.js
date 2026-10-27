// 「上傳履歷」連結：人選打開就能上傳履歷，不經阿財面談。
// 公開頁 /resume-upload-beta/，後端 public-worker POST /resume-upload。
// 2026-10-27 Jacky 核准信件文字、正式上線（RU_LINK_V2）：
//   入口①：人選中心頁首「寄上傳履歷連結」——LINE 來、還不在系統裡的人選，填姓名＋（Email）＋職缺。
//   入口②：人選卡片「總覽 → 聯絡人選」——帶好這位人選的姓名、Email、職缺。
//   兩種給法，連結內容一樣（只差 src）：
//     1. 複製連結（貼到 LINE）：src=line，前端直接算，不打後端。
//     2. 寄出（Email）：後端 POST /admin/resume-upload-link 從 official@ 寄，src=email。
//   連結帶 by=<顧問 id>（畫面最上方「我是」）：人選上傳後，新人選卡片自動指派給這位顧問。
import { api } from './core/api.js';
import { $, loading, openSubDrawer, closeSubDrawer, toast } from './core/ui.js';
import { escapeHtml } from './core/security.js';

const PAGE = 'https://step1ne.com/resume-upload-beta/';
// 系統用的空殼職缺，連結裡不能帶
const NO_JOB = new Set(['', 'unspecified', 'other', 'resume-upload-unspecified', 'entry-general-match']);
const CLOSED = new Set(['closed', 'social_only', 'draft']);

// 跟後端 /admin/resume-upload-link 算法一樣：src → job → by
export function resumeUploadUrl(jobSlug = '', src = 'line', by = '') {
  let u = `${PAGE}?src=${encodeURIComponent(src)}`;
  if (jobSlug && !NO_JOB.has(jobSlug)) u += `&job=${encodeURIComponent(jobSlug)}`;
  if (by) u += `&by=${encodeURIComponent(by)}`;
  return u;
}

// 一顆按鈕，點了打開「寄上傳履歷連結」視窗（裡面可以寄 Email，也可以複製連結貼 LINE）
export function resumeLinkButtons({ appId = '', email = '', name = '', jobSlug = '', jobTitle = '', label = '寄上傳履歷連結', cls = 'btn sm' } = {}) {
  const e = escapeHtml;
  const hasJob = jobSlug && !NO_JOB.has(jobSlug);
  return `<button type="button" class="${e(cls)}" data-ru-mail data-ru-app="${e(appId)}" data-ru-email="${e(email)}" data-ru-name="${e(name)}" data-ru-job="${e(hasJob ? jobSlug : '')}" data-ru-jobtitle="${e(hasJob ? jobTitle : '')}" title="人選打開連結就能上傳履歷，不經阿財面談；上傳後自動建卡片、負責顧問是你">${e(label)}</button>`;
}

let deps = { me: () => '', meId: () => '', jobs: async () => [], jobLabel: (j) => j.title };
let cur = null;     // { appId, email, name, jobSlug, jobTitle }
let dirty = false;  // 顧問自己改過主旨／內文 → 不要自動蓋掉
let live = false;
let pvTimer = null;
let pvSeq = 0;

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
  return `<div class="ru-wrap" style="display:grid;gap:14px">
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
  </div>`;
}

function readForm() {
  cur.name = ($('#ru-name')?.value || '').trim();
  cur.email = ($('#ru-to')?.value || '').trim();
  cur.jobSlug = $('#ru-job')?.value || '';
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
  openSubDrawer({ title: '寄上傳履歷連結', subtitle: cur.appId ? `${cur.name || ''}｜人選打開連結就能上傳履歷` : 'LINE 來、還不在系統裡的人選：給他連結，上傳後自動建卡片', body: loading() });
  let jobs = [];
  try { jobs = (await deps.jobs() || []).filter((j) => !CLOSED.has(String(j.status || '')) && !NO_JOB.has(j.slug)); }
  catch { jobs = []; }
  const el = $('#sub-overlay-root .drawer-body');
  if (!el) return;
  el.innerHTML = formHtml(jobs);
  readForm();
  updateLink();
  preview(true);
  if (!cur.name) $('#ru-name')?.focus();
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
    if (['ru-name', 'ru-to', 'ru-job'].includes(t.id)) {
      readForm(); updateLink();
      clearTimeout(pvTimer); pvTimer = setTimeout(() => preview(false), 450);
    }
  });
  document.addEventListener('change', (ev) => {
    const t = ev.target instanceof Element ? ev.target : null;
    if (t && t.closest('[data-me-global]')) updateLink();
  });
  document.addEventListener('click', async (event) => {
    const t = event.target instanceof Element ? event.target : null;
    const opener = t && t.closest('[data-ru-mail]');
    if (opener) {
      event.preventDefault();
      open({ appId: opener.getAttribute('data-ru-app') || '', email: opener.getAttribute('data-ru-email') || '',
        name: opener.getAttribute('data-ru-name') || '', jobSlug: opener.getAttribute('data-ru-job') || '',
        jobTitle: opener.getAttribute('data-ru-jobtitle') || '' });
      return;
    }
    const btn = t && t.closest('#sub-overlay-root [data-ru-action]');
    if (!btn || btn.disabled || !cur) return;
    event.preventDefault();
    readForm(); updateLink();
    const act = btn.getAttribute('data-ru-action');
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
