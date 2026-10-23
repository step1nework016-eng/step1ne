// 2026-10-23 特殊職缺檢查卡（第一個套用：主管／家庭專屬司機職缺）
// 只有 site_settings special_check_jobs 清單裡的職缺才顯示；其他職缺的人選卡片完全不變（清單抓一次就記住，不在清單就不打 API）。
// 內容：面談出席紀錄（顧問按有到／放鳥）＋AI 讀履歷的疑點＋三個分數＋司法院裁判書「自己查」入口。不推 TG。
import { api } from './core/api.js';
import { toast } from './core/ui.js';
import { escapeHtml } from './core/security.js';

const e = (v) => escapeHtml(v == null ? '' : String(v));
let jobsPromise = null;

function specialJobs() {
  if (!jobsPromise) jobsPromise = api.get('/admin/special-check/jobs').then((r) => (r && r.jobs) || []).catch(() => { jobsPromise = null; return []; });
  return jobsPromise;
}

const base = (id) => `/admin/application/${encodeURIComponent(id)}/special-check`;
const who = () => { try { return localStorage.getItem('s1ne_candidate_owner') || '顧問'; } catch { return '顧問'; } };

const SCORE_LABEL = { interview_willingness: '願意來面談', offer_success: '成功錄取', stability: '穩定性' };

function scoreRow(key, s) {
  const n = Math.max(0, Math.min(100, Number(s && s.score) || 0));
  const tone = n >= 70 ? 'sc-hi' : n >= 40 ? 'sc-mid' : 'sc-lo';
  return `<div class="sc-score ${tone}"><div class="sc-score-top"><span>${e(SCORE_LABEL[key])}</span><b>${n}</b></div>
    <div class="sc-track" role="img" aria-label="${e(SCORE_LABEL[key])} ${n} 分"><i style="width:${n}%"></i></div>
    <small>${e(s && s.reason)}</small></div>`;
}

function render(d, appId) {
  const att = d.attendance || {};
  const card = d.card || null;
  const r = card && card.result;
  const red = att.no_show >= 2;
  const apptRows = (att.appointments || []).map((a) => {
    const when = a.slot || (a.created_at ? `安排於 ${String(a.created_at).slice(0, 16)}` : '時間未定');
    const rec = a.recorded;
    return `<div class="sc-appt"><span>${e(when)}${a.status === 'pending' ? ' <small class="muted">（人選還沒選時段）</small>' : ''}</span>
      ${rec ? `<span class="badge ${rec.result === 'attended' ? 'success' : 'danger'}">${rec.result === 'attended' ? '有到' : '放鳥'}</span>`
        : `<span class="sc-btns"><button type="button" class="btn sm" data-sc-mark="attended" data-sc-appt="${e(a.id)}">有到</button><button type="button" class="btn sm danger" data-sc-mark="no_show" data-sc-appt="${e(a.id)}">放鳥</button></span>`}</div>`;
  }).join('');
  const recRows = (att.records || []).filter((x) => !x.appointment_id).map((x) =>
    `<div class="sc-appt"><span>${e(x.at || String(x.created_at || '').slice(0, 16))}${x.note ? ` <small class="muted">${e(x.note)}</small>` : ''}</span>
      <span class="sc-btns"><span class="badge ${x.result === 'attended' ? 'success' : 'danger'}">${x.result === 'attended' ? '有到' : '放鳥'}</span><button type="button" class="btn sm ghost" data-sc-del="${e(x.id)}" aria-label="撤銷這筆紀錄">撤銷</button></span></div>`).join('');

  let aiHtml;
  if (!d.has_resume) aiHtml = '<p class="help">還沒有履歷文字（履歷上傳後系統會自動讀），讀到履歷才會產生疑點與分數。</p>';
  else if (!r) aiHtml = `<p class="help">AI 正在讀履歷，約 1～3 分鐘後重新打開卡片就看得到。${card && card.error ? `<br>上次失敗：${e(card.error)}` : ''}</p>`;
  else {
    const flags = r.resume_flags || [];
    aiHtml = `<h5>履歷疑點 <span class="badge ${flags.length ? 'warning' : 'success'}">${flags.length ? flags.length + ' 項' : '沒發現'}</span></h5>
      ${flags.length ? `<ul class="sc-flags">${flags.map((f) => `<li><b>${e(f.type)}</b>${e(f.detail)}</li>`).join('')}</ul>` : '<p class="help">履歷時間軸沒看到明顯對不上的地方。</p>'}
      <h5>三個分數</h5>
      <div class="sc-scores">${['interview_willingness', 'offer_success', 'stability'].map((k) => scoreRow(k, (r.scores || {})[k])).join('')}</div>
      <p class="help">初期估計，累積 20～30 位實際結果後再校正。只依任期／相關經驗／通勤／薪資／履歷更新／求職意向／出席紀錄，不看年齡、性別、婚育、外貌、國籍、身心障礙。
      ${card.needs_refresh || card.status === 'queued' ? '<b>有新紀錄，分數更新中…</b>' : `（${e(card.generated_at)} 產生）`}</p>`;
  }
  const j = d.judicial || {};
  return `<section class="sc-card${red ? ' sc-red' : ''}" aria-label="主管司機檢查">
    <header><h4>🚗 主管司機檢查</h4>${r && !card.needs_refresh ? '<button type="button" class="btn sm ghost" data-sc-refresh>重算</button>' : ''}</header>
    <h5>面談出席</h5>
    <p class="sc-att">約了 <b>${att.booked || 0}</b> 次 · 到了 <b>${att.attended || 0}</b> 次 · 放鳥 <b class="${red ? 'sc-bad' : ''}">${att.no_show || 0}</b> 次${red ? ' <span class="badge danger">放鳥 2 次以上</span>' : ''}</p>
    ${apptRows}${recRows}
    <div class="sc-add"><input type="datetime-local" data-sc-at aria-label="面談時間（系統外約的）"><input data-sc-note placeholder="備註（選填）" aria-label="備註"><button type="button" class="btn sm" data-sc-mark="attended">記一次：有到</button><button type="button" class="btn sm danger" data-sc-mark="no_show">記一次：放鳥</button></div>
    <p class="help" style="margin-top:4px">上面列的是系統裡約過的面談；在系統外（電話、LINE）約的，用這一列補記。</p>
    ${aiHtml}
    <h5>司法院裁判書</h5>
    <p class="help" style="margin-top:0">${e(j.note)}</p>
    <button type="button" class="btn sm" data-sc-judicial data-name="${e(j.name)}" data-url="${e(j.url)}">到司法院查「${e(j.name)}」（姓名會先複製）</button>
  </section>`;
}

export async function loadSpecialCheck(appId, jobSlug, isCurrent) {
  const box = document.getElementById('special-check-box');
  if (!box || !jobSlug) return;
  const jobs = await specialJobs();
  if (!jobs.includes(jobSlug)) return;
  const draw = async () => {
    let d;
    try { d = await api.get(base(appId)); } catch (err) { box.innerHTML = `<p class="help">主管司機檢查載入失敗：${e(err.message)}</p>`; return; }
    if (isCurrent && !isCurrent()) return;
    if (!d || !d.enabled) { box.innerHTML = ''; return; }
    box.innerHTML = render(d, appId);
  };
  box.onclick = async (ev) => {
    const mark = ev.target.closest('[data-sc-mark]');
    const del = ev.target.closest('[data-sc-del]');
    const jud = ev.target.closest('[data-sc-judicial]');
    const ref = ev.target.closest('[data-sc-refresh]');
    try {
      if (mark) {
        const appt = mark.getAttribute('data-sc-appt');
        const at = appt ? '' : (box.querySelector('[data-sc-at]')?.value || '').replace('T', ' ');
        const note = appt ? '' : (box.querySelector('[data-sc-note]')?.value || '').trim();
        mark.disabled = true;
        await api.post(`${base(appId)}/attendance`, { result: mark.getAttribute('data-sc-mark'), appointment_id: appt || undefined, at: at || undefined, note: note || undefined, by: who() });
        toast('已記錄，分數 1～3 分鐘內更新', 'success');
        await draw();
      } else if (del) {
        if (!window.confirm('撤銷這筆出席紀錄？')) return;
        await api.post(`${base(appId)}/attendance/delete`, { id: del.getAttribute('data-sc-del') });
        toast('已撤銷', 'success');
        await draw();
      } else if (ref) {
        await api.post(`${base(appId)}/refresh`, {});
        toast('已排入重算，1～3 分鐘內更新', 'success');
        await draw();
      } else if (jud) {
        const name = jud.getAttribute('data-name') || '';
        try { await navigator.clipboard.writeText(name); toast(`已複製「${name}」，貼到司法院搜尋框按送出`, 'success'); } catch { toast(`請在司法院搜尋框輸入「${name}」`, 'info'); }
        window.open(jud.getAttribute('data-url'), '_blank', 'noopener');
      }
    } catch (err) {
      toast(err.message || '操作失敗', 'error');
      if (mark) mark.disabled = false;
    }
  };
  await draw();
}
