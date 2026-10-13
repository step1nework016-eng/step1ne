// 客戶提供的職缺（未簽約）—— 2026-10-13 Jacky 核准的示意頁
// 規則：未簽約職缺「可以拿去發社群」，但「不上官網、阿財不面談」；客戶簽約、轉成正式職缺後才會上官網與阿財。
// 後端沿用既有的未簽約職缺機制（jobs.status='social_only'、job_social_only），這裡只是新的介面：
//   一次最多新增 10 個（貼 104 連結／貼文字／上傳截圖或 PDF）、每個欄位直接編輯、每個職缺有「客戶額外備註」。
// AI 讀取 104／截圖／PDF 的功能下一版接上；現在由顧問在清單上自己填名稱與工作內容。
import { api } from './core/api.js';
import { toast } from './core/ui.js';
import { escapeHtml, text } from './core/security.js';

const MAX = 10;

export function bdJobsPane(detail) {
  const jobs = detail.client_jobs || [];
  const open = jobs.filter((j) => j.status === 'social_only');
  const lock = `<div class="bdj-lock"><b>這個客戶還沒簽約</b>　這些職缺<b>可以拿去發社群</b>，但<b>不會上官網</b>，<b>阿財也不會面談</b>。客戶簽約、轉成正式客戶之後，可以逐個按「轉成正式職缺」。</div>`;
  const card = (j) => {
    const live = j.status !== 'social_only';
    const pay = (a, b) => (a || b) ? `${a || ''}${a && b ? '～' : ''}${b || ''}` : '';
    void pay;
    return `<article class="bdj-job" data-bdj-slug="${escapeHtml(j.slug)}">
      <div class="bdj-top"><div>${j.ai_read && !j.checked ? '<span class="bdj-chip no">AI 讀的，請核對</span> ' : ''}<span class="bdj-src">${text({ 104: '104 連結', text: '貼文字', file: '截圖／PDF', manual: '手動新增' }[j.src_kind] || '手動新增')}${j.src_url ? `　<a href="${escapeHtml(j.src_url)}" target="_blank" rel="noopener">${text(j.src_url.slice(0, 50))}</a>` : ''}</span></div>
        ${live ? '' : `<button type="button" class="bdj-btn sm" data-bdj-convert>轉成正式職缺</button>`}</div>
      ${live ? '<p class="help">這個職缺已轉成正式職缺，請到「職缺」管理修改。</p>' : `<div class="bdj-grid">
        <label class="bdj-f full">職缺名稱<input data-bdj-k="title" value="${escapeHtml(j.title)}" maxlength="80"></label>
        <label class="bdj-f">地點<input data-bdj-k="locations" value="${escapeHtml(j.locations || '')}" maxlength="200"></label>
        <label class="bdj-f">月薪（低～高，元）<span class="bdj-pay"><input data-bdj-k="salary_min" inputmode="numeric" value="${escapeHtml(j.salary_min || '')}" aria-label="月薪下限"><i>～</i><input data-bdj-k="salary_max" inputmode="numeric" value="${escapeHtml(j.salary_max || '')}" aria-label="月薪上限"></span></label>
        <label class="bdj-f full">客戶額外備註<textarea data-bdj-k="client_note" rows="2" maxlength="1000" placeholder="客戶特別交代的事：例如要找的人像誰、不要哪種背景、急不急、薪資彈性…">${text(j.client_note || '')}</textarea></label>
        <label class="bdj-f full">工作內容<textarea data-bdj-k="main_duties" rows="4">${text(j.main_duties || '')}</textarea></label>
        <label class="bdj-f full">條件<textarea data-bdj-k="required_conditions" rows="3">${text(j.required_conditions || '')}</textarea></label>
      </div>`}
      <div class="bdj-perm"><span class="bdj-chip ok">可發社群</span>${live ? '<span class="bdj-chip ok">上官網</span><span class="bdj-chip ok">阿財面談</span>' : '<span class="bdj-chip lock">不上官網</span><span class="bdj-chip lock">阿財不面談</span><span class="bdj-chip no">未簽約</span>'}</div>
    </article>`;
  };
  return `<section class="bdj" data-bdj>
    ${lock}
    <div class="bdj-head"><h4>客戶先給我們找的職缺 <small>（${open.length}）</small></h4><button type="button" class="bdj-btn primary" data-bdj-add>＋ 新增職缺（一次最多 ${MAX} 個）</button></div>
    <div class="bdj-panel" data-bdj-panel hidden>
      <div class="bdj-seg" role="radiogroup" aria-label="怎麼貼">
        <label><input type="radio" name="bdj-how" value="104" checked><span>貼 104 連結</span></label>
        <label><input type="radio" name="bdj-how" value="text"><span>直接貼文字</span></label>
        <label><input type="radio" name="bdj-how" value="file"><span>上傳截圖／PDF</span></label>
      </div>
      <p class="help" data-bdj-help>一行放一個 104 職缺連結。</p>
      <textarea data-bdj-paste rows="6" class="bdj-paste" aria-label="貼在這裡"></textarea>
      <div class="bdj-file" data-bdj-filebox hidden><input type="file" data-bdj-files accept="image/*,application/pdf" multiple><p class="help">一個檔案算一個職缺。</p></div>
      <div class="bdj-counter" data-bdj-counter><span data-bdj-n>0 個</span><span>最多 ${MAX} 個</span></div>
      <div class="bdj-notice">AI 自動讀取 104／截圖／PDF 的功能下一版上線。現在先幫你把每個職缺列成清單，<b>職缺名稱和工作內容請自己填好</b>（貼文字的話會自動帶入），確認後再新增。</div>
      <button type="button" class="bdj-btn" data-bdj-make>整理成清單</button>
      <div class="bdj-draft" data-bdj-draft></div>
      <div class="bdj-foot"><span class="muted" data-bdj-dcount></span><button type="button" class="bdj-btn" data-bdj-cancel>取消</button><button type="button" class="bdj-btn primary" data-bdj-ok disabled>確認新增</button></div>
    </div>
    <div class="bdj-list">${jobs.length ? jobs.map(card).join('') : '<div class="bdj-empty">還沒有職缺。客戶先給了職缺的話，按上面的「新增職缺」。</div>'}</div>
  </section>`;
}

export function wireBdJobs(root, detail, reload) {
  const box = root.querySelector('[data-bdj]');
  if (!box) return;
  const company = detail.company;
  const by = detail.assigned_to || '';
  const panel = box.querySelector('[data-bdj-panel]');
  const paste = box.querySelector('[data-bdj-paste]');
  const files = box.querySelector('[data-bdj-files]');
  const how = () => box.querySelector('[name=bdj-how]:checked').value;
  let draft = [];

  const parse = () => {
    const h = how(); const raw = paste.value;
    if (h === 'file') return Array.from(files.files || []).map((f) => ({ src_kind: 'file', src_url: '', title: f.name.replace(/\.[^.]+$/, ''), main_duties: '' }));
    if (h === '104') return raw.split('\n').map((x) => x.trim()).filter(Boolean).map((u) => ({ src_kind: '104', src_url: u, title: '', main_duties: '' }));
    return raw.split(/\n\s*(?:-{3,}|={3,})\s*\n|\n{3,}/).map((x) => x.trim()).filter(Boolean).map((t) => ({ src_kind: 'text', src_url: '', title: t.split('\n')[0].slice(0, 80), main_duties: t }));
  };
  const counter = () => {
    const n = parse().length;
    box.querySelector('[data-bdj-n]').textContent = `${n} 個`;
    const c = box.querySelector('[data-bdj-counter]');
    c.classList.toggle('over', n > MAX);
    c.lastElementChild.textContent = n > MAX ? `超過了，一次最多 ${MAX} 個，請分兩次` : `最多 ${MAX} 個`;
  };
  const setHow = () => {
    const h = how();
    box.querySelector('[data-bdj-help]').textContent = h === '104' ? '一行放一個 104 職缺連結。' : h === 'text' ? '每個職缺的文字貼進來，職缺和職缺之間空兩行，或單獨一行打 --- 隔開。' : '選截圖或 PDF 檔案，一個檔案算一個職缺。';
    paste.hidden = h === 'file'; box.querySelector('[data-bdj-filebox]').hidden = h !== 'file';
    counter();
  };
  box.querySelectorAll('[name=bdj-how]').forEach((r) => { r.onchange = setHow; });
  paste.oninput = counter; files.onchange = counter;
  box.querySelector('[data-bdj-add]').onclick = () => { panel.hidden = !panel.hidden; if (!panel.hidden) { setHow(); paste.focus(); } };
  box.querySelector('[data-bdj-cancel]').onclick = () => { panel.hidden = true; draft = []; box.querySelector('[data-bdj-draft]').innerHTML = ''; };

  const chk = () => {
    const ok = draft.length > 0 && draft.every((d) => d.title.trim() && d.main_duties.trim());
    box.querySelector('[data-bdj-ok]').disabled = !ok;
    box.querySelector('[data-bdj-dcount]').textContent = draft.length ? `${draft.length} 個職缺${ok ? '' : '，還有職缺名稱或工作內容沒填'}` : '';
  };
  const drawDraft = () => {
    box.querySelector('[data-bdj-draft]').innerHTML = draft.map((d, i) => `<article class="bdj-job">
      <div class="bdj-top"><div><span class="bdj-src">${text({ 104: '104 連結', text: '貼文字', file: '截圖／PDF' }[d.src_kind])}${d.src_url ? `　${text(d.src_url.slice(0, 60))}` : ''}</span>${d.err ? `<div class="bdj-err">${text(d.err)}</div>` : ''}</div><button type="button" class="bdj-btn sm" data-bdj-rm="${i}">不要這個</button></div>
      <div class="bdj-grid">
        <label class="bdj-f full">職缺名稱<input data-d="${i}" data-dk="title" value="${escapeHtml(d.title)}" maxlength="80"></label>
        <label class="bdj-f full">工作內容（社群文要靠這段寫）<textarea data-d="${i}" data-dk="main_duties" rows="4">${text(d.main_duties)}</textarea></label>
        <label class="bdj-f">地點<input data-d="${i}" data-dk="locations" value="${escapeHtml(d.locations || '')}"></label>
        <label class="bdj-f">月薪（低～高，元）<span class="bdj-pay"><input data-d="${i}" data-dk="salary_min" inputmode="numeric" value="${escapeHtml(d.salary_min || '')}" aria-label="月薪下限"><i>～</i><input data-d="${i}" data-dk="salary_max" inputmode="numeric" value="${escapeHtml(d.salary_max || '')}" aria-label="月薪上限"></span></label>
        <label class="bdj-f full">客戶額外備註<textarea data-d="${i}" data-dk="client_note" rows="2" placeholder="客戶特別交代的事">${text(d.client_note || '')}</textarea></label>
      </div></article>`).join('');
    box.querySelectorAll('[data-d]').forEach((el) => { el.oninput = () => { draft[el.dataset.d][el.dataset.dk] = el.value; chk(); }; });
    box.querySelectorAll('[data-bdj-rm]').forEach((b) => { b.onclick = () => { draft.splice(Number(b.dataset.bdjRm), 1); drawDraft(); }; });
    chk();
  };
  box.querySelector('[data-bdj-make]').onclick = () => {
    const items = parse();
    if (!items.length) { toast('先貼上內容或選檔案', 'error'); return; }
    if (items.length > MAX) { toast(`一次最多 ${MAX} 個`, 'error'); return; }
    draft = items; drawDraft();
  };
  box.querySelector('[data-bdj-ok]').onclick = async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    let okN = 0; const rest = [];
    for (const d of draft) {
      try {
        await api.post('/admin/bd/social-job', {
          company, by, title: d.title.trim(), main_duties: d.main_duties.trim(), locations: d.locations || '', client_note: d.client_note || '',
          salary_min: d.salary_min || '', salary_max: d.salary_max || '', salary_unit: 'MONTH', src_kind: d.src_kind, src_url: d.src_url || '', ai_read: false,
        });
        okN += 1;
      } catch (err) { d.err = err.message || '新增失敗'; rest.push(d); }
    }
    if (rest.length) { draft = rest; drawDraft(); toast(`已新增 ${okN} 個；${rest.length} 個沒成功，原因寫在那個職缺上`, 'error'); btn.disabled = false; if (okN) await reload({ openJobs: true, keepPanel: true }); return; }
    toast(`已新增 ${okN} 個未簽約職缺`, 'success');
    await reload({ openJobs: true });
  };

  // 直接編輯：離開欄位就存
  box.querySelectorAll('.bdj-list [data-bdj-k]').forEach((el) => {
    el.onchange = async () => {
      const slug = el.closest('[data-bdj-slug]').dataset.bdjSlug;
      try { await api.post('/admin/bd/client-job-update', { slug, [el.dataset.bdjK]: el.value }); toast('已儲存', 'success'); }
      catch (err) { toast(err.message || '儲存失敗', 'error'); }
    };
  });
  box.querySelectorAll('[data-bdj-convert]').forEach((b) => {
    b.onclick = async () => {
      const slug = b.closest('[data-bdj-slug]').dataset.bdjSlug;
      if (!window.confirm('轉成正式職缺後，會變成職缺草稿，之後依一般流程上架官網、阿財才會面談。確定要轉嗎？')) return;
      b.disabled = true;
      try { await api.post('/admin/social-job/convert', { slug, by }); toast('已轉成正式職缺（草稿）', 'success'); await reload({ openJobs: true }); }
      catch (err) { toast(err.message || '轉換失敗', 'error'); b.disabled = false; }
    };
  });
}
