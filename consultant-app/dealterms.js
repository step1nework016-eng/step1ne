// 2026-10-22 Jacky：開發客戶卡片最上面「成交條件」——一眼看到給過這家什麼：
//   合約（哪一版、哪天、誰寄的，最新那份標「最新」）、已簽約的收費條件、公司簡介版本、給過的匿名人選、其他附件。
// 資料：系統寄的信（detail.mails，含附件）＋信箱裡的往來信件（/admin/mail-archive/bd，含附件）＋client_contract。
// 檔案一律走後台登入下載（filepreview.js），不做公開連結。
import { escapeHtml, text } from './core/security.js';
import { fileButtons, wireFileButtons } from './filepreview.js';
import { fetchBdArchive, keyHeaders } from './mail.js';

// ── 合約版本：同一份 PDF 大小一樣，用大小當指紋（2026-10-22 逐份打開 PDF 核對過內容） ──
const CONTRACT_BY_SIZE = {
  369249: { label: '舊公版', terms: '一般 1.5／管理 2 個月，保證 30 天' },
  430715: { label: '精簡版（PH 原稿）', terms: '一般 1.5／管理 2 個月；高階 25%／26%' },
  431605: { label: '精簡版（PH 原稿）', terms: '一般 1.5／管理 2 個月；高階 25%／26%' },
  449853: { label: '10/12 新公版', terms: '一般 2／管理 2.5 個月；高階 24%／25%；40 日法定條款' },
  449850: { label: '10/14 修訂版', terms: '一般 1.5／管理 2 個月；高階 24%／25%；40 日法定條款' },
  434617: { label: '中高階版', terms: '一般 1.5／管理 2 個月；高階 20%～26%，保證 60 日' },
  412073: { label: '約聘版', terms: '依約聘期間 30%／25%／20%，保證 30 天' },
};
const INTRO_BY_SIZE = { 1191899: '舊版 8 頁', 3482108: '舊版 8 頁', 1483714: '精簡版 6 頁' };
const INTRO_BY_ID = { 'step1ne-solution-2026': '舊版 8 頁', 'step1ne-solution-2026-lite': '精簡版 6 頁' };

export function attKind(filename, kind) {
  const n = String(filename || '');
  if (kind === 'anon_cv' || /匿名|人選推薦/.test(n) || /^[A-Z]{1,2}-\d/.test(n)) return 'cand';
  if (kind === 'company_intro' || /解決方案|公司簡介|公司介紹/.test(n)) return 'intro';
  if (/合約|契約|委任/.test(n)) return 'contract';
  return 'other';
}

// 回傳 { label, terms, sure }：sure=false 表示用檔名／日期推的，要預覽確認
export function contractVersion(filename, size, date) {
  const hit = CONTRACT_BY_SIZE[size];
  if (hit) return { ...hit, sure: true };
  const n = String(filename || '');
  if (/20261014改/.test(n)) return { ...CONTRACT_BY_SIZE[449850], sure: true };
  if (/20261012改/.test(n)) return { ...CONTRACT_BY_SIZE[449853], sure: true };
  if (/約聘/.test(n)) return { label: '約聘版（未核對）', terms: '', sure: false };
  if (/中高階|高階/.test(n)) return { label: '中高階版（未核對）', terms: '', sure: false };
  if (!/招募|委任/.test(n)) return { label: '補充文件', terms: '', sure: false };
  const d = String(date || '').slice(0, 10);
  if (d && d < '2026-10-12') return { label: '舊公版（推定）', terms: '', sure: false };
  return { label: '版本未辨識', terms: '', sure: false };
}

export function introVersion(fileId, size, date) {
  if (INTRO_BY_ID[fileId]) return INTRO_BY_ID[fileId];
  if (INTRO_BY_SIZE[size]) return INTRO_BY_SIZE[size];
  const d = String(date || '').slice(0, 10);
  return d && d < '2026-10-02' ? '舊版 8 頁（推定）' : '版本未辨識';
}

export function candCode(filename) {
  const n = String(filename || '').replace(/\.[a-z0-9]+$/i, '');
  const m = n.match(/([A-Z]{1,2}-[0-9A-Za-z]{2,6})/);
  if (!m) return { code: '', title: n.replace(/^匿名人選推薦_?/, '') };
  return { code: m[1], title: n.slice(n.indexOf(m[1]) + m[1].length).replace(/^[_\s-]+/, '') };
}

const isJunk = (a) => /^(image\d*|outlook-|~wrl)/i.test(String(a.filename || '')) || (/^image\//.test(a.mime || '') && (a.size || 0) < 80000);
const md = (s) => { const m = String(s || '').match(/^\d{4}-(\d{2})-(\d{2})/); return m ? `${+m[1]}/${+m[2]}` : ''; };
const who = (s) => String(s || '').replace(/@step1ne\.com$/i, '@').replace(/^jackychen@$/, 'Jacky').replace(/^official@$/, 'official@');

// 把兩個來源合成一份「我們寄出去的附件」清單（同一封信同一個檔只留一筆）
export function collectSent(detail, archive) {
  const out = [];
  const seen = new Set();
  const push = (x) => {
    const key = `${String(x.filename).replace(/[_\s]+(?=\.[a-z0-9]+$)/i, '')}|${String(x.at).slice(0, 16)}`;
    if (seen.has(key)) return;
    seen.add(key); out.push(x);
  };
  for (const m of (detail.mails || [])) {
    if (m.status !== 'sent') continue;
    for (const a of (m.attachments || [])) {
      push({ ...a, at: m.sent_at || m.at, by: m.approved_by && m.signer && m.approved_by !== m.signer ? `${m.signer}（${m.approved_by} 核准）` : (m.signer || m.approved_by || '系統'),
        via: '系統寄信', path: `/admin/file/${encodeURIComponent(a.file_id)}`, kind: attKind(a.filename, a.kind) });
    }
  }
  for (const m of ((archive && archive.items) || [])) {
    if (!/@step1ne\.com/i.test(String(m.from_addr || ''))) continue; // 只算我們寄出去的
    for (const a of (m.atts || [])) {
      if (isJunk(a)) continue;
      push({ ...a, at: m.sent_at, by: m.mailbox === 'jackychen@step1ne.com' ? 'Jacky' : (m.from_name && !/official/i.test(m.from_name) ? m.from_name : who(m.mailbox)),
        via: m.mailbox, path: `/admin/mail-archive/file/${encodeURIComponent(a.file_id)}`, kind: attKind(a.filename, '') });
    }
  }
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

const nameCell = (n) => `<span class="dt-name" title="${escapeHtml(n || '')}">${text(n || '附件')}</span>`;
const metaCell = (x) => `<span class="dt-meta">${text(md(x.at))}　${text(x.by || '')}</span>`;

export function dealTermsHtml(detail, archive, { loadingArchive = false, archiveError = '' } = {}) {
  const sent = collectSent(detail, archive);
  const contracts = sent.filter((x) => x.kind === 'contract');
  const intros = sent.filter((x) => x.kind === 'intro');
  const cands = sent.filter((x) => x.kind === 'cand');
  const others = sent.filter((x) => x.kind === 'other');
  const cc = detail.client_contract;
  const rows = [];

  if (cc) {
    rows.push(`<div class="dt-signed"><b>已簽約：${text(cc.contract_date || md(cc.confirmed_at) || '日期未填')}</b>${cc.contract_kind ? `<span class="muted">${text(cc.contract_kind)}</span>` : ''}
      <ul class="dt-fees">${(cc.fees || []).map((f) => `<li><span>${text(f.name)}</span>→ ${text(f.line)}</li>`).join('')}</ul></div>`);
  }
  if (contracts.length) {
    rows.push(`<div class="dt-g"><h5>合約 <small>${contracts.length} 份</small></h5>${contracts.map((x, i) => {
      const v = contractVersion(x.filename, x.size, x.at);
      return `<div class="dt-row"><div class="dt-l"><span class="dt-top">${i === 0 ? '<span class="dt-new">最新</span>' : ''}<b class="dt-ver${v.sure ? '' : ' unsure'}" title="${escapeHtml(v.sure ? '已核對過檔案內容' : '用檔名／日期推的，請按預覽確認')}">${text(v.label)}</b>${metaCell(x)}</span>${v.terms ? `<span class="dt-terms">${text(v.terms)}</span>` : ''}${nameCell(x.filename)}</div>${fileButtons(x.path, x.filename)}</div>`;
    }).join('')}</div>`);
  }
  if (intros.length) {
    rows.push(`<div class="dt-g"><h5>公司簡介</h5>${intros.map((x) => `<div class="dt-row"><div class="dt-l"><span class="dt-top"><b class="dt-ver">${text(introVersion(x.file_id, x.size, x.at))}</b>${metaCell(x)}</span>${nameCell(x.filename)}</div>${fileButtons(x.path, x.filename)}</div>`).join('')}</div>`);
  }
  if (cands.length) {
    const by = new Map();
    cands.forEach((x) => { const c = candCode(x.filename); const k = c.code || x.filename; if (!by.has(k)) by.set(k, { ...x, ...c, times: [] }); by.get(k).times.push(md(x.at)); });
    rows.push(`<div class="dt-g"><h5>給過的人選 <small>${by.size} 位</small></h5>${[...by.values()].map((x) => `<div class="dt-row"><div class="dt-l"><span class="dt-top">${x.code ? `<b class="dt-code">${text(x.code)}</b>` : ''}<span class="dt-name" title="${escapeHtml(x.filename)}">${text(x.title || x.filename)}</span><span class="dt-meta">${text([...new Set(x.times)].join('、'))}</span></span></div>${fileButtons(x.path, x.filename)}</div>`).join('')}</div>`);
  }
  if (others.length) {
    rows.push(`<div class="dt-g"><h5>報價／其他附件</h5>${others.map((x) => `<div class="dt-row"><div class="dt-l"><span class="dt-top">${nameCell(x.filename)}${metaCell(x)}</span></div>${fileButtons(x.path, x.filename)}</div>`).join('')}</div>`);
  }
  const notes = [];
  if (loadingArchive) notes.push('正在讀信箱裡以前寄過的附件…');
  if (archiveError) notes.push(`信箱紀錄讀不到：${archiveError}`);
  if (archive && archive.hidden_private) notes.push(`還有 ${archive.hidden_private} 封在 Jacky 信箱，要先到「信箱紀錄」頁輸入私人鑰匙才算得進來。`);
  const empty = !rows.length && !loadingArchive
    ? `<div class="dt-empty"><span>還沒給過合約或資料</span><button type="button" class="bdc-btn" data-dt-gomail>開寄信畫面（附合約／公司簡介供參考）→</button></div>` : '';
  return `<h4 class="dt-h">成交條件 <small>給過這家什麼</small></h4>${rows.join('')}${empty}${notes.map((n) => `<p class="dt-note">${text(n)}</p>`).join('')}`;
}

// 抽屜打開後呼叫：先用手上的資料畫，信箱紀錄回來再畫一次
export async function loadDealTerms(root, detail) {
  const box = root && root.querySelector('[data-dt-box]');
  if (!box) return;
  const paint = (archive, opt) => {
    box.innerHTML = dealTermsHtml(detail, archive, opt);
    wireFileButtons(box, () => keyHeaders());
    box.querySelector('[data-dt-gomail]')?.addEventListener('click', () => {
      /** @type {HTMLElement|null} */ (document.querySelector('[data-bdc-gomail]'))?.click();
    });
  };
  paint(null, { loadingArchive: true });
  try {
    const archive = await fetchBdArchive(detail.company);
    if (document.body.contains(box)) paint(archive, {});
  } catch (e) {
    if (document.body.contains(box)) paint(null, { archiveError: (e && e.message) || '' });
  }
}
