// 客戶提供的職缺（未簽約）—— 2026-10-13 Jacky 核准的示意頁
// 規則：未簽約職缺「可以拿去發社群」，但「不上官網、阿財不面談」；客戶簽約、轉成正式職缺後才會上官網與阿財。
// 後端沿用既有的未簽約職缺機制（jobs.status='social_only'、job_social_only），這裡只是新的介面：
//   一次最多新增 10 個（貼 104 連結／貼文字／上傳截圖或 PDF）、每個欄位直接編輯、每個職缺有「客戶額外備註」。
// 104 連結：後端 /admin/bd/read-104 直接讀職缺內容（結構化資料，不用 AI）。
// 貼文字／截圖／PDF：後端存檔排工作，本機 ai_worker（job_read.py）用 AI 讀出欄位，這裡輪詢結果。
import { api } from './core/api.js';
import { toast } from './core/ui.js';
import { escapeHtml, text } from './core/security.js';

const MAX = 10;
const readAsB64 = (blob) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1] || ''); r.onerror = reject; r.readAsDataURL(blob); });
// 截圖先縮到長邊 1800px 的 JPG（手機截圖很大，縮了 AI 一樣讀得到、上傳也快）
async function prepFile(f) {
  if (f.type === 'application/pdf') return { name: f.name, mime: 'application/pdf', b64: await readAsB64(f) };
  const bmp = await createImageBitmap(f);
  const k = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return { name: f.name, mime: 'image/jpeg', b64: c.toDataURL('image/jpeg', 0.85).split(',')[1] };
}
// 公司名稱粗略比對（拿掉括號裡的字和公司型態字樣，再看有沒有互相包含）
const sameCorp = (a, b) => {
  const n = (x) => String(x || '').replace(/[（(][^）)]*[）)]/g, '').replace(/\u80a1\u4efd\u6709\u9650\u516c\u53f8|\u6709\u9650\u516c\u53f8|\u516c\u53f8|\u53f0\u7063|\u81fa\u7063/g, '').replace(/\s/g, '');
  const x = n(a); const y = n(b);
  return !x || !y || x.includes(y) || y.includes(x);
};

export function bdJobsPane(detail) {
  const jobs = detail.client_jobs || [];
  const open = jobs.filter((j) => j.status === 'social_only');
  const lock = `<div class="bdj-lock"><b>這個客戶還沒簽約</b>　這些職缺<b>可以拿去發社群</b>，但<b>不會上官網</b>，<b>阿財也不會面談</b>。客戶簽約、轉成正式客戶之後，可以逐個按「轉成正式職缺」。</div>`;
  const card = (j) => {
    const live = j.status !== 'social_only';
    const pay = (a, b) => (a || b) ? `${a || ''}${a && b ? '～' : ''}${b || ''}` : '';
    void pay;
    return `<article class="bdj-job" data-bdj-slug="${escapeHtml(j.slug)}">
      <div class="bdj-top"><div>${j.ai_read && !j.checked ? `<span class="bdj-chip no">${j.src_kind === '104' ? '讀自 104，請核對' : 'AI 讀的，請核對'}</span> ` : ''}<span class="bdj-src">${text({ 104: '104 連結', text: '貼文字', file: '截圖／PDF', manual: '手動新增' }[j.src_kind] || '手動新增')}${j.src_url ? `　<a href="${escapeHtml(j.src_url)}" target="_blank" rel="noopener">${text(j.src_url.slice(0, 50))}</a>` : ''}</span></div>
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
      <div class="bdj-file" data-bdj-filebox hidden><input type="file" data-bdj-files accept="image/*,application/pdf" multiple aria-label="選擇截圖或 PDF"><p class="help">一次最多選 ${MAX} 個檔案（截圖或 PDF），一個檔案算一個職缺。</p><ul class="bdj-filelist" data-bdj-filelist></ul></div>
      <div class="bdj-counter" data-bdj-counter><span data-bdj-n>0 個</span><span>最多 ${MAX} 個</span></div>
      <div class="bdj-notice"><b>貼 104 連結</b>：系統直接讀出職缺內容。<b>貼文字、截圖、PDF</b>：由 AI 讀出（約 1～3 分鐘）。讀出來的每個職缺你都可以逐格修改，確認後才會新增。</div>
      <button type="button" class="bdj-btn primary" data-bdj-make>整理成清單</button>
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
  // 選的檔案列出來，可以一個一個拿掉（用 DataTransfer 重組，最多 10 個）
  const drawFiles = () => {
    const ul = box.querySelector('[data-bdj-filelist]');
    const list = Array.from(files.files || []);
    ul.innerHTML = list.map((f, i) => `<li><span class="fn">${text(f.name)}</span><button type="button" data-bdj-fx="${i}" aria-label="拿掉 ${escapeHtml(f.name)}">×</button></li>`).join('');
    ul.querySelectorAll('[data-bdj-fx]').forEach((b) => {
      b.onclick = () => {
        const dt = new DataTransfer();
        list.forEach((f, i) => { if (i !== Number(b.dataset.bdjFx)) dt.items.add(f); });
        files.files = dt.files; drawFiles(); counter();
      };
    });
  };
  paste.oninput = counter;
  files.onchange = () => {
    if ((files.files || []).length > MAX) {
      const dt = new DataTransfer();
      Array.from(files.files).slice(0, MAX).forEach((f) => dt.items.add(f));
      files.files = dt.files;
      toast(`一次最多 ${MAX} 個，已留下前 ${MAX} 個`, 'error');
    }
    drawFiles(); counter();
  };
  box.querySelector('[data-bdj-add]').onclick = () => { panel.hidden = !panel.hidden; if (!panel.hidden) { setHow(); paste.focus(); } };
  box.querySelector('[data-bdj-cancel]').onclick = () => { panel.hidden = true; draft = []; box.querySelector('[data-bdj-draft]').innerHTML = ''; };

  const chk = () => {
    const ok = draft.length > 0 && draft.every((d) => d.title.trim() && d.main_duties.trim());
    box.querySelector('[data-bdj-ok]').disabled = !ok;
    box.querySelector('[data-bdj-dcount]').textContent = draft.length ? `${draft.length} 個職缺${ok ? '' : '，還有職缺名稱或工作內容沒填'}` : '';
  };
  const drawDraft = () => {
    box.querySelector('[data-bdj-draft]').innerHTML = draft.map((d, i) => `<article class="bdj-job">
      <div class="bdj-top"><div>${d.read ? `<span class="bdj-chip no">${d.src_kind === '104' ? '讀自 104，請核對' : 'AI 讀的，請核對'}</span> ` : ''}<span class="bdj-src">${text({ 104: '104 連結', text: '貼文字', file: '截圖／PDF' }[d.src_kind])}${d.src_url ? `　${text(d.src_url.slice(0, 60))}` : ''}${d.file_name && d.src_kind === 'file' ? `　${text(d.file_name)}` : ''}</span>${d.err ? `<div class="bdj-err">${text(d.err)}</div>` : ''}${d.read && d.corp && !sameCorp(d.corp, company) ? `<div class="bdj-err">⚠ 這個職缺是「${text(d.corp)}」刊登的，跟這家客戶「${text(company)}」名稱不同，請確認連結有沒有貼錯。</div>` : ''}${(d.law5 || []).length ? `<div class="bdj-err">內容有不能寫的字：${text(d.law5.join('、'))}（年齡、性別、婚姻、國籍、外貌等違反就業服務法第 5 條），請改掉才能新增。</div>` : ''}</div><button type="button" class="bdj-btn sm" data-bdj-rm="${i}">不要這個</button></div>
      <div class="bdj-grid">
        <label class="bdj-f full">職缺名稱<input data-d="${i}" data-dk="title" value="${escapeHtml(d.title)}" maxlength="80"></label>
        <label class="bdj-f full">工作內容（社群文要靠這段寫）<textarea data-d="${i}" data-dk="main_duties" rows="4">${text(d.main_duties)}</textarea></label>
        <label class="bdj-f">地點<input data-d="${i}" data-dk="locations" value="${escapeHtml(d.locations || '')}"></label>
        <label class="bdj-f">月薪（低～高，元）<span class="bdj-pay"><input data-d="${i}" data-dk="salary_min" inputmode="numeric" value="${escapeHtml(d.salary_min || '')}" aria-label="月薪下限"><i>～</i><input data-d="${i}" data-dk="salary_max" inputmode="numeric" value="${escapeHtml(d.salary_max || '')}" aria-label="月薪上限"></span></label>
        <label class="bdj-f full">條件<textarea data-d="${i}" data-dk="required_conditions" rows="3">${text(d.required_conditions || '')}</textarea></label>
        <label class="bdj-f full">客戶額外備註<textarea data-d="${i}" data-dk="client_note" rows="2" placeholder="客戶特別交代的事">${text(d.client_note || '')}</textarea></label>
      </div></article>`).join('');
    box.querySelectorAll('[data-d]').forEach((el) => { el.oninput = () => { draft[el.dataset.d][el.dataset.dk] = el.value; chk(); }; });
    box.querySelectorAll('[data-bdj-rm]').forEach((b) => { b.onclick = () => { draft.splice(Number(b.dataset.bdjRm), 1); drawDraft(); }; });
    chk();
  };
  box.querySelector('[data-bdj-make]').onclick = async (e) => {
    const items = parse();
    if (!items.length) { toast('先貼上內容或選檔案', 'error'); return; }
    if (items.length > MAX) { toast(`一次最多 ${MAX} 個`, 'error'); return; }
    if (how() === '104') {
      const btn = e.currentTarget; btn.disabled = true; btn.textContent = '讀取中…';
      try {
        const r = await api.post('/admin/bd/read-104', { urls: items.map((x) => x.src_url) });
        draft = (r.items || []).map((it, i) => (it.ok
          ? { src_kind: '104', src_url: it.url, title: it.title, main_duties: it.main_duties, locations: it.locations, salary_min: it.salary_min || '', salary_max: it.salary_max || '',
              required_conditions: it.required_conditions, pay_text: it.pay_text, corp: it.company, law5: it.law5 || [], read: true }
          : { src_kind: '104', src_url: items[i].src_url, title: '', main_duties: '', err: it.error || '讀不到' }));
      } catch (err) { toast(err.message || '讀取失敗，請改貼文字', 'error'); draft = items; }
      btn.disabled = false; btn.textContent = '整理成清單';
      drawDraft(); return;
    }
    // 貼文字／截圖／PDF：交給 AI 讀（本機 ai_worker），輪詢到讀完
    const btn = e.currentTarget; btn.disabled = true;
    try {
      const mode = how() === 'text' ? 'text' : 'files';
      btn.textContent = '上傳中…';
      const payload = mode === 'text'
        ? { company, mode, texts: items.map((x) => x.main_duties), by }
        : { company, mode, files: await Promise.all(Array.from(files.files).map(prepFile)), by };
      const r = await api.post('/admin/bd/read-jobs', payload);
      const t0 = Date.now(); let st = { status: 'queued', items: [], total: items.length };
      while (Date.now() - t0 < 6 * 60 * 1000) {
        btn.textContent = `AI 讀取中… ${(st.items || []).length}／${st.total || items.length}`;
        await new Promise((res) => setTimeout(res, 3000));
        st = await api.get(`/admin/bd/read-jobs/status?id=${encodeURIComponent(r.task_id)}`);
        if (st.status === 'done' || st.status === 'error') break;
      }
      if (st.status !== 'done' && st.status !== 'error') toast('讀取比較久，先把讀到的列出來；沒讀到的請自己填', 'error');
      const got = new Map((st.items || []).map((it) => [it.idx, it]));
      draft = items.map((x, i) => {
        const it = got.get(i);
        if (it && it.ok) {
          return { src_kind: x.src_kind, src_url: '', file_name: x.title, title: it.title || '', main_duties: [it.main_duties, it.extra ? `其他：${it.extra}` : ''].filter(Boolean).join('\n\n'),
            locations: it.locations || '', salary_min: it.salary_min || '', salary_max: it.salary_max || '', required_conditions: [it.required_conditions, it.pay_text && !it.salary_min ? `薪資：${it.pay_text}` : ''].filter(Boolean).join('\n'),
            corp: it.company || '', law5: it.law5 || [], read: true };
        }
        return { ...x, file_name: x.title, err: (it && it.error) || 'AI 沒有讀到這個，請自己填', title: mode === 'text' ? x.title : '', main_duties: mode === 'text' ? x.main_duties : '' };
      });
    } catch (err) { toast(err.message || '讀取失敗，請自己填', 'error'); draft = items; }
    btn.disabled = false; btn.textContent = '整理成清單';
    drawDraft();
  };
  box.querySelector('[data-bdj-ok]').onclick = async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    let okN = 0; const rest = [];
    for (const d of draft) {
      try {
        await api.post('/admin/bd/social-job', {
          company, by, title: d.title.trim(), main_duties: d.main_duties.trim(), locations: d.locations || '', client_note: d.client_note || '',
          salary_min: d.salary_min || '', salary_max: d.salary_max || '', salary_unit: 'MONTH', required_conditions: d.required_conditions || '',
          src_kind: d.src_kind, src_url: d.src_url || '', ai_read: !!d.read,
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
