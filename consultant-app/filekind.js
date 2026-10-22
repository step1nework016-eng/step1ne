// 2026-10-22：判斷一個附件能不能在瀏覽器裡直接看（純函式，不碰畫面，方便測試）。
// pdf / image：瀏覽器原生；docx：mammoth 轉成網頁；sheet（xlsx/xls/csv）：SheetJS 轉成表格；
// text：純文字；none：只能下載（舊版 .doc、.ppt、壓縮檔…）。
export function previewKind(name, mime) {
  const ext = (String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';
  const m = String(mime || '').toLowerCase();
  if (ext === 'pdf') return 'pdf';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return 'image';
  if (ext === 'docx') return 'docx';
  if (['xlsx', 'xls', 'csv'].includes(ext)) return 'sheet';
  if (ext === 'txt') return 'text';
  if (ext) {
    // 副檔名認得但不在上面 → 看 mime 再決定一次（例如沒副檔名的舊檔）
    if (m === 'application/pdf') return 'pdf';
    return 'none';
  }
  if (m === 'application/pdf') return 'pdf';
  if (/^image\/(png|jpe?g|gif|webp)$/.test(m)) return 'image';
  if (m.includes('wordprocessingml')) return 'docx';
  if (m.includes('spreadsheetml') || m === 'application/vnd.ms-excel' || m === 'text/csv') return 'sheet';
  if (m === 'text/plain') return 'text';
  return 'none';
}

export function blobType(kind, mime) {
  if (kind === 'pdf') return 'application/pdf';
  if (kind === 'text') return 'text/plain;charset=utf-8';
  return mime || 'application/octet-stream';
}
