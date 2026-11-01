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
  private maxTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly observer: MutationObserver;
  private readonly interval: ReturnType<typeof setInterval>;
  private route = routeKey();
  private destroyed = false;
  private generation = 0;
  private reading: AbortController | null = null;
  private dirty = false;
  constructor(private readonly read: (signal: AbortSignal) => PageContext | Promise<PageContext>, private readonly notify: (page: PageContext, route: string) => void, private readonly enabled: () => boolean = () => true) {
    this.observer = new MutationObserver(records => { if (records.some(record => !owned(record.target))) this.queue(false); });
    this.observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'open', 'class', 'style', 'aria-hidden', 'aria-label', 'aria-labelledby', 'role', 'title', 'data-guidekit-id', 'data-guidekit-label', 'data-guidekit-private'] });
    window.addEventListener('popstate', this.refresh); window.addEventListener('hashchange', this.refresh);
    document.addEventListener('visibilitychange', this.refresh);
    // pushState/replaceState have no native event. Check only the small local route key.
    this.interval = setInterval(() => { const route = routeKey(); if (route !== this.route) { this.route = route; this.refresh(); } }, 500);
  }
  refresh = (): void => this.queue(true);
  private invalidate(): void {
    ++this.generation; this.reading?.abort(); this.reading = null; this.dirty = false;
    if (this.timer) clearTimeout(this.timer);
    if (this.maxTimer) clearTimeout(this.maxTimer);
    this.timer = null; this.maxTimer = null;
  }
  private queue(hard: boolean): void {
    if (this.destroyed) return;
    if (document.hidden || !this.enabled()) { this.invalidate(); return; }
    // Controller reads host context first, then collects current DOM targets.
    // Rendering while that context resolves should not starve its snapshot.
    // Route/explicit-context refreshes are hard invalidations; DOM-only changes
    // coalesce into one fresh follow-up read after this one completes.
    if (!hard && this.reading) { this.dirty = true; return; }
    if (hard) this.invalidate(); else ++this.generation;
    if (this.timer) clearTimeout(this.timer);
    const read = () => {
      if (this.timer) clearTimeout(this.timer);
      if (this.maxTimer) clearTimeout(this.maxTimer);
      this.timer = null; this.maxTimer = null;
      if (this.destroyed || document.hidden || !this.enabled()) return;
      const generation = this.generation;
      const route = routeKey(), controller = new AbortController(); this.reading = controller;
      void Promise.resolve().then(() => this.read(controller.signal)).then(page => {
        if (this.destroyed || controller.signal.aborted || generation !== this.generation || document.hidden || !this.enabled()) return;
        if (route !== routeKey()) { this.refresh(); return; }
        this.route = route; this.notify(page, route);
      }).catch(() => { /* A failed/stale host context read must not replace an active scene. */ }).finally(() => {
        if (this.reading !== controller) return;
        this.reading = null;
        if (this.dirty) { this.dirty = false; this.queue(false); }
      });
    };
    this.timer = setTimeout(read, 180);
    // Animated hosts can mutate continuously. A trailing debounce alone would
    // never read their current controls; cap this local settle window instead.
    this.maxTimer ??= setTimeout(read, 500);
  }
  destroy(): void {
    this.destroyed = true; this.invalidate(); this.observer.disconnect(); clearInterval(this.interval);
    window.removeEventListener('popstate', this.refresh); window.removeEventListener('hashchange', this.refresh); document.removeEventListener('visibilitychange', this.refresh);
  }
}
