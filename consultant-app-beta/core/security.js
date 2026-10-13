export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[char]);
}

export function safeUrl(value) {
  try {
    const base = typeof location === 'undefined' ? 'https://step1ne.com' : location.origin;
    const url = new URL(String(value), base);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '#';
  } catch { return '#'; }
}

export function text(value, fallback = '—') {
  const normalized = String(value ?? '').trim();
  return normalized ? escapeHtml(normalized) : fallback;
}
