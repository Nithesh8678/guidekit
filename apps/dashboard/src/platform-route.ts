/** Public website and account entry routes. Account tokens stay owned by AccountLink. */
export type PlatformRoute = 'landing' | 'signup' | 'login' | 'dashboard';

export function readPlatformRoute(hash = location.hash): PlatformRoute {
  if (hash === '#signup') return 'signup';
  if (hash === '#login') return 'login';
  if (hash === '#dashboard' || hash === '#main-content') return 'dashboard';
  return 'landing';
}

export function platformHash(route: PlatformRoute): string {
  return route === 'landing' ? '' : `#${route}`;
}

export function navigatePlatform(route: PlatformRoute, replace = false): void {
  const hash = platformHash(route);
  if (replace) history.replaceState(null, '', `${location.pathname}${location.search}${hash}`);
  else if (location.hash !== hash) {
    if (hash) location.hash = hash;
    else history.pushState(null, '', `${location.pathname}${location.search}`);
  }
}
