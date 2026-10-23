// 2026-10-23「上傳履歷」連結（測試版）：人選打開就能上傳履歷，不經阿財面談。
// 公開頁 /resume-upload-beta/（之後正式版改 /resume-upload/），後端 public-worker POST /resume-upload。
// 兩種給法：
//   1. 寄 Email：從 official@ 寄（後端 POST /admin/resume-upload-link，先 preview → 可改 → test／send）。
//      ⚠️ 信件文字等 Jacky 確認前，後端只准寄到測試信箱（site_settings resume_upload_mail='on' 才放行）。
//   2. 複製連結：顧問自己貼到 LINE 官方帳號（連結帶 src=line，進件時看得出是 LINE 來的）。
// 用在：人選卡片（聯絡方式那排按鈕）、職缺管理抽屜最上面。
import { api } from './core/api.js';
import { $, loading, openSubDrawer, closeSubDrawer, toast } from './core/ui.js';
import { escapeHtml } from './core/security.js';

const PAGE = 'https://step1ne.com/resume-upload-beta/';
// 這些是系統用的空殼職缺，連結裡不能帶
const NO_JOB = new Set(['', 'unspecified', 'resume-upload-unspecified', 'entry-general-match']);

export function resumeUploadUrl(jobSlug = '', src = 'line') {
  const q = new URLSearchParams({ src });
  if (jobSlug && !NO_JOB.has(jobSlug)) q.set('job', jobSlug);
  return `${PAGE}?${q.toString()}`;
}

// 一排按鈕：寄 Email／複製連結（有職缺就多一顆「通用連結」）
export function resumeLinkButtons({ appId = '', email = '', name = '', jobSlug = '', jobTitle = '' } = {}) {
  const e = escapeHtml;
  const hasJob = jobSlug && !NO_JOB.has(jobSlug);
  const data = `data-ru-app="${e(appId)}" data-ru-email="${e(email)}" data-ru-name="${e(name)}" data-ru-job="${e(hasJob ? jobSlug : '')}" data-ru-jobtitle="${e(hasJob ? jobTitle : '')}"`;
  return `<button type="button" class="btn sm" data-ru-mail ${data} title="人選打開連結就能上傳履歷，不經阿財面談">寄上傳履歷連結</button>`
    + `<button type="button" class="btn sm" data-copy-text="${e(resumeUploadUrl(hasJob ? jobSlug : ''))}" title="貼到 LINE 官方帳號給人選">複製上傳履歷連結${hasJob ? '（帶這個職缺）' : ''}</button>`
    + (hasJob ? `<button type="button" class="btn sm" data-copy-text="${e(resumeUploadUrl(''))}" title="不指定職缺，人選自己選">複製通用上傳連結</button>` : '');
}

let getMe = () => '';
let cur = null;   // { appId, email, name, jobSlug, jobTitle }

function body(d) {
  const e = escapeHtml;
  if (d.error) return `<div class="notice">${e(d.error)}</div>`;
  return `<div class="ru-wrap" style="display:grid;gap:12px">
    ${d.live ? '' : '<div class="notice">🧪 測試版：這封信的文字還在等 Jacky 確認，目前只能「先寄測試信給我看」（寄到 aiagentg888@gmail.com）。要給人選連結，先用「複製上傳履歷連結」貼到 LINE。</div>'}
    ${d.warn ? `<div class="notice" style="border-color:var(--danger,#c0392b)">🚫 ${e(d.warn)}</div>` : ''}
    <div class="card" style="display:grid;gap:10px">
      <label class="field"><span>寄給（人選的 Email）</span><input id="ru-to" type="email" value="${e(d.to || cur.email || '')}" placeholder="name@example.com" style="min-height:44px"></label>
      ${cur.jobSlug ? `<label style="display:flex;gap:8px;align-items:center;min-height:44px"><input type="checkbox" id="ru-withjob" ${cur.withJob !== false ? 'checked' : ''}> 連結裡先幫人選選好「${e(cur.jobTitle || cur.jobSlug)}」（他還是可以改）</label>` : '<p class="help">沒有帶職缺：人選在頁面上自己選職類和職缺。</p>'}
      <button type="button" class="btn" data-ru-action="refresh" style="min-height:44px">依上面重新產生內文</button>
    </div>
    <label class="field"><span>主旨（可以直接改）</span><input id="ru-subject" value="${e(d.subject || '')}"></label>
    <label class="field"><span>內文（可以直接改，連結那一行不要刪）</span><textarea id="ru-text" rows="18" style="width:100%;font:inherit;line-height:1.7">${e(d.text || '')}</textarea></label>
    <p class="help">從 official@ 寄出，人選回信會接在同一串。人選送出履歷後，TG「履歷進件」會通知；不會排阿財面談。</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button type="button" class="btn" data-ru-action="test" style="min-height:44px">先寄測試信給我看</button>
      <button type="button" class="btn primary" data-ru-action="send" style="min-height:44px" ${d.live ? '' : 'disabled title="等 Jacky 確認信件文字後才會開放"'}>確認寄給人選</button>
    </div></div>`;
}

function payload(action) {
  const withJob = cur.jobSlug && ($('#ru-withjob') ? $('#ru-withjob').checked : true);
  cur.withJob = withJob;
  const to = ($('#ru-to') && $('#ru-to').value.trim()) || cur.email || '';
  cur.email = to;
  const p = { action, by: getMe() || null, to, application_id: cur.appId || null, job_slug: withJob ? cur.jobSlug : '', name: cur.name || '' };
  if (action !== 'preview' && action !== 'refresh') { p.subject = $('#ru-subject')?.value || ''; p.text = $('#ru-text')?.value || ''; }
  if (action === 'refresh') p.action = 'preview';
  return p;
}

async function open(ctx, reload) {
  if (ctx) cur = { ...ctx };
  if (!reload || !document.querySelector('#sub-overlay-root .ru-wrap')) {
    openSubDrawer({ title: '寄上傳履歷連結', subtitle: `${cur.name || ''}｜人選打開連結就能上傳履歷，不經阿財面談`, body: loading() });
  }
  let d;
  // 還沒有 Email（例如從職缺頁開）：先給空白表單讓顧問填，不打後端
  if (!cur.email && !cur.appId) d = { to: '', subject: '', text: '（填好 Email 後按「依上面重新產生內文」）', live: false };
  else {
    try { d = await api.post('/admin/resume-upload-link', payload(reload ? 'refresh' : 'preview')); }
    catch (e) { d = { ...(e.body || {}), error: (e.body && e.body.error) || e.message }; if (e.body && e.body.error === '請填人選的 Email') d = { to: '', subject: '', text: '', live: false, warn: '請先填人選的 Email' }; }
  }
  const el = $('#sub-overlay-root .drawer-body');
  if (el) el.innerHTML = body(d);
}

export function initResumeLink(meFn) {
  if (typeof meFn === 'function') getMe = meFn;
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
    const btn = t && t.closest('[data-ru-action]');
    if (!btn || btn.disabled || !cur) return;
    event.preventDefault();
    const act = btn.getAttribute('data-ru-action');
    if (act === 'refresh') { payload('refresh'); open(null, true); return; }
    if (!getMe()) { toast('請先在畫面最上方「我是」選你的名字，系統才記得是誰寄的', 'error'); document.querySelector('[data-me-global]')?.focus(); return; }
    const p = payload(act);
    if (!p.to) { toast('請先填人選的 Email', 'error'); $('#ru-to')?.focus(); return; }
    if (act === 'send' && !window.confirm(`確定要把上傳履歷連結寄給 ${p.to} 嗎？`)) return;
    btn.disabled = true;
    try {
      const r = await api.post('/admin/resume-upload-link', p);
      if (act === 'test') { toast(`測試信已排入寄件匣，約 1 分鐘內寄到 ${r.to}`, 'success'); btn.disabled = false; return; }
      toast(`已寄上傳履歷連結給 ${r.to}`, 'success');
      closeSubDrawer();
    } catch (e) { toast((e.body && e.body.error) || e.message || '沒有寄出去', 'error'); btn.disabled = false; }
  });
}
