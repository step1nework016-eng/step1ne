import { LEGACY_ROUTES, ROUTES } from '../config.js';

const routeToKey = Object.fromEntries(Object.entries(ROUTES).map(([key, path]) => [path, key]));

function normalize(path) { return path.endsWith('/') ? path : `${path}/`; }

export function resolveRoute() {
  const path = normalize(location.pathname);
  const legacy = LEGACY_ROUTES[path];
  if (legacy) return { key: routeToKey[legacy[0]] || 'home', sub: legacy[1], legacy: true };
  return { key: routeToKey[path] || 'home', sub: new URLSearchParams(location.search).get('tab') || '', legacy: false };
}

export function navigate(key, sub = '', replace = false) {
  const path = ROUTES[key] || ROUTES.home;
  const url = sub ? `${path}?tab=${encodeURIComponent(sub)}` : path;
  history[replace ? 'replaceState' : 'pushState']({ key, sub }, '', url);
  window.dispatchEvent(new CustomEvent('step1ne:navigate'));
}
