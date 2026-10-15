import { LEGACY_ROUTES, ROUTES } from '../config.js';

const routeToKey = Object.fromEntries(Object.entries(ROUTES).map(([key, path]) => [path, key]));

function normalize(path) { return path.endsWith('/') ? path : `${path}/`; }

export function resolveRoute() {
  const path = normalize(location.pathname);
  const legacy = LEGACY_ROUTES[path];
  if (legacy) { const k = routeToKey[legacy[0]] || 'daily'; return { key: k === 'home' ? 'daily' : k, sub: legacy[1], legacy: true }; }
  // 2026-10-15 Jacky：首頁拿掉，打開後台直接進每日工作台
  let key = routeToKey[path] || 'daily';
  if (key === 'home') key = 'daily';
  return { key, sub: new URLSearchParams(location.search).get('tab') || '', legacy: false };
}

export function navigate(key, sub = '', replace = false) {
  const path = ROUTES[key] || ROUTES.home;
  const url = sub ? `${path}?tab=${encodeURIComponent(sub)}` : path;
  history[replace ? 'replaceState' : 'pushState']({ key, sub }, '', url);
  window.dispatchEvent(new CustomEvent('step1ne:navigate'));
}
