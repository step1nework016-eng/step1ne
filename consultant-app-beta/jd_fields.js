// 職缺 JD 逐欄位編輯（2026-09-29 從舊後台 consultant-old/jobs 搬過來）。
// 後台 /admin/jobs/:slug/content 回的是結構化 spec（duties/must/why…），不是一整段文字；
// 新版原本放一個大文字框讀 content.content，所以每個職缺都顯示空白、存檔也存不進去。
// 格式跟舊後台一致：清單一行一項、工作內容用「## 標題」分組、為什麼值得看第一行標題。
export const JD_FIELDS = [
  ['title', '職缺名稱', 'line'],
  ['subtitle', '副標', 'line'],
  ['locations', '工作地點（一行一項）', 'list'],
  ['salary_min', '薪資下限', 'line'],
  ['salary_max', '薪資上限', 'line'],
  ['spec', '職缺條件一覽（一行一項，格式：欄位名：內容）', 'kv'],
  ['intro', '職缺介紹', 'text'],
  ['duties', '工作內容（用「## 標題」開新的一組；沒有分組就直接列項目）', 'duties'],
  ['must', '必要條件（一行一項）', 'list'],
  ['plus', '加分條件（一行一項）', 'list'],
  ['why', '為什麼值得看（第一行標題、下面接說明，項目之間空一行）', 'why'],
  ['benefits', '福利（一行一項）', 'list'],
  ['faq', '常見問答（一題一組：第一行寫問題、下面接答案，題目之間空一行）', 'faq'],
  ['card_desc', '職缺卡描述', 'text'],
  ['description', 'SEO 描述', 'text'],
];

const lines = (b) => b.split('\n').map((x) => x.trim()).filter(Boolean);
const blocks = (s) => String(s || '').split(/\n\s*\n/).map(lines).filter((l) => l.length);

export function jdFieldVal(kind, v) {
  if (kind === 'list') return Array.isArray(v) ? v.join('\n') : String(v || '');
  if (kind === 'kv') return (Array.isArray(v) ? v : []).map((r) => `${r[0] || ''}：${r[1] || ''}`).join('\n');
  if (kind === 'duties') return (Array.isArray(v) ? v : []).map((g) => (g.h ? `## ${g.h}\n` : '') + (g.items || []).join('\n')).join('\n\n');
  if (kind === 'why') return (Array.isArray(v) ? v : []).map((w) => `${w.h || ''}\n${w.p || ''}`).join('\n\n');
  if (kind === 'faq') return (Array.isArray(v) ? v : []).map((x) => `${(x && x[0]) || ''}\n${(x && x[1]) || ''}`).join('\n\n');
  return v == null ? '' : String(v);
}

export function jdFieldParse(kind, s) {
  if (kind === 'list') return lines(String(s || ''));
  if (kind === 'kv') return lines(String(s || '')).map((l) => {
    let i = l.indexOf('：'); if (i < 0) i = l.indexOf(':');
    return i < 0 ? null : [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }).filter(Boolean);
  if (kind === 'duties') return blocks(s).map((l) => (l[0].startsWith('## ') ? { h: l[0].slice(3).trim(), items: l.slice(1) } : { h: '', items: l }));
  if (kind === 'why') return blocks(s).map((l) => ({ h: l[0], p: l.slice(1).join(' ') }));
  if (kind === 'faq') return blocks(s).map((l) => [l[0], l.slice(1).join(' ')]);
  return String(s || '');
}
