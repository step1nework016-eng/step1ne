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
let data = { channels: [], jobs: [], statuses: {} };
let target = null;
const ui = { owner: '', q: '' };

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
  const cols = COLS.map(([k, title, hint]) => {
    const list = shown.filter((c) => c.status === k).sort((a, b) => (dueTone(b) ? 1 : 0) - (dueTone(a) ? 1 : 0) || String(a.next_follow_at || '9999').localeCompare(String(b.next_follow_at || '9999')));
    const red = list.filter((c) => dueTone(c)).length;
    return `<section class="bk-col" data-ch-col="${k}" aria-label="${esc(title)}"><header><h3>${esc(title)}<b>${list.length}</b></h3><small>${esc(hint)}${red ? `<span class="bk-redcount">${red} 家該追</span>` : ''}</small></header>
      <div class="bk-list">${list.length ? list.map(cardHtml).join('') : '<p class="bk-empty">目前沒有</p>'}</div></section>`;
  }).join('');
  return `<div class="bk-bar">
      <label class="bk-filter"><span>負責人</span><select data-ch-filter="owner"><option value="">全部</option>${owners.map((o) => `<option ${ui.owner === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>
      <label class="bk-filter"><span>搜尋</span><input data-ch-filter="q" value="${esc(ui.q)}" placeholder="機構名、窗口…" style="min-height:40px"></label>
      <span class="bk-sum">共 ${shown.length} 家${due ? `｜<b class="bk-redtxt">${due} 家該追</b>` : ''}｜合計 推 ${tot[0]}・談 ${tot[1]}・送客戶 ${tot[2]}・錄取 ${tot[3]}</span>
    </div>
    <div class="bk-board" style="--bk-cols:${COLS.length}">${cols}</div>`;
}

export async function loadChannelsTab(el) {
  target = el;
  target.innerHTML = loading();
  try { data = await api.get('/admin/channels'); } catch (e) { target.innerHTML = errorState(e); return; }
  draw();
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
      <label class="field"><span>負責顧問</span><input name="owner" value="${v('owner') || esc(me())}" maxlength="40"></label>
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
function detailHtml(d) {
  const s = d.stats || {};
  const kpi = [['推來', s.referred], ['談過', s.talked], ['推給客戶', s.forwarded], ['錄取／到職', s.hired]].map(([l, n]) => `<div class="kpi"><span>${l}</span><strong>${n || 0}</strong></div>`).join('');
  const refs = (d.refs || []).map((r) => `<div class="list-row"><span><b class="ch-link" data-ch-cand="${esc(r.application_id)}" role="button" tabindex="0">${r.seq_no ? '#' + r.seq_no + ' ' : ''}${esc(r.name || '（找不到人選）')}</b><small>${esc(r.job_title || '')}${r.owner ? '｜' + esc(r.owner) : ''}｜${esc(String(r.created_at || '').slice(0, 10))} 加入</small></span><span class="badge info">${esc(stageOf(r))}</span><button class="btn sm" data-ch-unref="${esc(r.application_id)}" title="不是這家推來的，移掉">移除</button></div>`).join('');
  const logs = (d.logs || []).map((l) => `<div class="ch-log"><small>${esc(String(l.at || '').slice(0, 16))}｜${esc(l.by || '')}</small><div>${esc(l.text || '')}</div></div>`).join('');
  return `<div class="kpi-grid ch-kpi">${kpi}</div>
    <h3 class="ch-h">基本資料</h3>${formHtml(d.channel)}
    <h3 class="ch-h">聯絡紀錄</h3>
    <form data-ch-logform class="ch-logform"><textarea name="text" rows="2" maxlength="2000" placeholder="這次聯絡談了什麼（例：已寄 BIM 職缺說明，對方說下週發給學員）" required></textarea>
      <div class="form-grid"><label class="field"><span>下次追蹤日（選填）</span><input type="date" name="next_follow_at"></label><label class="field"><span>下一步（選填）</span><input name="next_step" maxlength="200"></label></div>
      <div class="actions-row"><button class="btn primary" type="submit">記下這次聯絡</button></div></form>
    <div class="ch-logs">${logs || '<p class="help">還沒有紀錄</p>'}</div>
    <h3 class="ch-h">這家推來的人選（${(d.refs || []).length}）</h3>
    <p class="help">人選要先在系統裡（應徵或手動新增過），打名字或編號找到後按「加入」。成效數字會自動算。</p>
    <div class="ch-search"><input data-ch-q placeholder="打人選名字、編號或電話" style="flex:1"><button class="btn" type="button" data-ch-find>找</button></div>
    <div data-ch-results class="list"></div>
    <div class="list" style="margin-top:8px">${refs || '<p class="help">還沒有連到任何人選</p>'}</div>`;
}

export async function openChannel(id) {
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
  lf.addEventListener('submit', async (e) => {
    e.preventDefault(); if (needMe()) return;
    const fd = new FormData(lf);
    try { await api.post('/admin/channels/log', { id, by: me(), text: fd.get('text'), next_follow_at: fd.get('next_follow_at') || null, next_step: fd.get('next_step') || null }); toast('已記下', 'success'); await refreshBoard(); openChannel(id); }
    catch (err) { toast(err.message || '記錄失敗', 'error'); }
  });
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
