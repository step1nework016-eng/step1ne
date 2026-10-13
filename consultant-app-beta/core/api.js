import { CONFIG } from '../config.js';

export class ApiError extends Error {
  constructor(message, status, body, path, code, retryable) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    this.path = path;
    this.code = code || null;
    this.retryable = retryable !== undefined ? !!retryable : true;
  }
}

function parseBody(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

export async function request(path, options = {}) {
  const { recruit = false, body, headers = {}, signal, ...init } = options;
  const token = localStorage.getItem(CONFIG.tokenKey) || '';
  const response = await fetch(`${recruit ? CONFIG.recruitApiBase : CONFIG.apiBase}${path}`, {
    ...init,
    signal,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers
    }
  });
  const parsed = parseBody(await response.text());
  if (response.status === 401) {
    window.dispatchEvent(new CustomEvent('step1ne:unauthorized'));
    throw new ApiError('登入憑證已失效，請重新輸入 ADMIN_TOKEN。', 401, parsed, path);
  }
  if (!response.ok) {
    // 2026-09-17 v2.0 稽核修正：precall-card 這類端點的 error 是物件
    // {code,message,retryable}（Contract 08 第 21-23 節），不是字串——原本這裡
    // 只認字串型 error，物件會被塞進樣板字串變成「[object Object]」，使用者
    // 完全看不懂錯誤訊息。兩種形狀都要認得，不要只支援其中一種端點的慣例。
    const errObj = parsed && typeof parsed.error === 'object' && parsed.error ? parsed.error : null;
    const message = parsed?.message || (typeof parsed?.error === 'string' ? parsed.error : errObj?.message) || `HTTP ${response.status}`;
    throw new ApiError(message, response.status, parsed, path, errObj?.code, errObj ? errObj.retryable : undefined);
  }
  return parsed;
}

export const api = Object.freeze({
  get: (path, options = {}) => request(path, { ...options, method: 'GET' }),
  post: (path, body, options = {}) => request(path, { ...options, method: 'POST', body }),
  patch: (path, body, options = {}) => request(path, { ...options, method: 'PATCH', body }),
  put: (path, body, options = {}) => request(path, { ...options, method: 'PUT', body }),
  del: (path, body, options = {}) => request(path, { ...options, method: 'DELETE', body })
});
