import type { PageContext } from '../../contracts/src/index';

/** A route fingerprint stays local; query strings and fragments are never sent or persisted. */
export function routeKey(): string {
  const route = `${location.origin}${location.pathname}${location.search}${location.hash}`;
  let hash = 2166136261;
  for (const character of route) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(36);
}
function owned(node: Node): boolean { return Boolean((node instanceof Element ? node : node.parentElement)?.closest('[data-guidekit-root]')); }

/** Watches semantic scene changes, never keystrokes, input values or pointer movement. */
export class SceneObserver {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly observer: MutationObserver;
  private readonly interval: ReturnType<typeof setInterval>;
  private route = routeKey();
  private destroyed = false;
  constructor(private readonly read: () => PageContext, private readonly notify: (page: PageContext, route: string) => void, private readonly enabled: () => boolean = () => true) {
    this.observer = new MutationObserver(records => { if (records.some(record => !owned(record.target))) this.refresh(); });
    this.observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'open', 'class', 'style', 'aria-hidden', 'aria-label', 'aria-labelledby', 'role', 'title', 'data-guidekit-id', 'data-guidekit-private'] });
    window.addEventListener('popstate', this.refresh); window.addEventListener('hashchange', this.refresh);
    document.addEventListener('visibilitychange', this.refresh);
    // pushState/replaceState have no native event. Check only the small local route key.
    this.interval = setInterval(() => { const route = routeKey(); if (route !== this.route) { this.route = route; this.refresh(); } }, 500);
  }
  refresh = (): void => {
    if (this.destroyed || document.hidden || !this.enabled()) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; if (!this.destroyed && !document.hidden && this.enabled()) { this.route = routeKey(); this.notify(this.read(), this.route); } }, 180);
  };
  destroy(): void {
    this.destroyed = true; this.observer.disconnect(); clearInterval(this.interval); if (this.timer) clearTimeout(this.timer); this.timer = null;
    window.removeEventListener('popstate', this.refresh); window.removeEventListener('hashchange', this.refresh); document.removeEventListener('visibilitychange', this.refresh);
  }
}
