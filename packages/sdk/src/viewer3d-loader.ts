import type { VisualScene } from '../../contracts/src/visual';
import type { VisualPresentation, VisualSelection } from './session-types';

/** The lazy boundary deliberately contains no renderer or Three.js types. */
export interface VisualViewer {
  present(scene: VisualScene, runId: string): Promise<VisualPresentation>;
  selection(): VisualSelection | null;
  focusObject(id: string): boolean;
  cancelPresentation(): void;
  hide(): void;
  show(): void;
  dispose(): void;
}
export interface VisualViewerModule { createViewer3D(container: HTMLElement, options: { onHide(): void }): VisualViewer; }
const cancelled = () => new DOMException('The explanation presentation was replaced or stopped.', 'AbortError');
declare const __GUIDEKIT_VIEWER_INTEGRITY__: string;
declare const __GUIDEKIT_VIEWER_FILENAME__: string;
const scriptBase = import.meta.url || (typeof document !== 'undefined' && document.currentScript instanceof HTMLScriptElement ? document.currentScript.src : '');

export function verifiedViewerURL(base: string, filename: string, integrity: string): URL {
  if (!base || !/^viewer3d-[a-f0-9]{24}\.mjs$/.test(filename) || !/^sha384-[A-Za-z0-9+/]+=*$/.test(integrity)) throw new Error('The verified explanation module is unavailable in this SDK build.');
  const url = new URL(filename, base);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('The explanation module needs a trusted web origin.');
  return url;
}

/** Only the adjacent build-owned, SRI-verified module may cross this boundary. */
export function loadVerifiedViewer(signal?: AbortSignal): Promise<VisualViewerModule> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(cancelled()); return; }
    const integrity = typeof __GUIDEKIT_VIEWER_INTEGRITY__ === 'string' ? __GUIDEKIT_VIEWER_INTEGRITY__ : '';
    const filename = typeof __GUIDEKIT_VIEWER_FILENAME__ === 'string' ? __GUIDEKIT_VIEWER_FILENAME__ : '';
    let url: URL; try { url = verifiedViewerURL(scriptBase, filename, integrity); } catch (error) { reject(error); return; }
    const script = document.createElement('script'); script.type = 'module'; script.src = url.href; script.integrity = integrity; script.crossOrigin = 'anonymous';
    let settled = false;
    const finish = (error?: unknown, module?: VisualViewerModule) => {
      if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', stop); script.onload = null; script.onerror = null; script.remove();
      if (error) reject(error); else resolve(module!);
    };
    const stop = () => finish(cancelled());
    const timer = setTimeout(() => finish(new Error('The explanation module took too long to load. Try again.')), 15000);
    signal?.addEventListener('abort', stop, { once: true });
    script.onerror = () => finish(new Error('The explanation module could not be verified or loaded.'));
    script.onload = () => {
      // The same URL is already in the browser's integrity-verified module map.
      void import(/* @vite-ignore */ url.href).then(module => {
        if (signal?.aborted) { finish(cancelled()); return; }
        if (typeof module.createViewer3D !== 'function') { finish(new Error('The explanation module has an invalid interface.')); return; }
        finish(undefined, module as VisualViewerModule);
      }, error => finish(error));
    };
    document.head.append(script);
  });
}

/** Imports cannot be aborted, but obsolete imports may never create a viewer. */
export class VisualViewerLoader {
  private module: Promise<VisualViewerModule> | null = null;
  private viewer: VisualViewer | null = null;
  private generation = 0;
  private disposed = false;
  private loading: AbortController | null = null;
  private presentation: AbortController | null = null;
  constructor(private readonly container: HTMLElement, private readonly load: (signal?: AbortSignal) => Promise<VisualViewerModule>, private readonly onHide: () => void) {}
  private ensureModule(): Promise<VisualViewerModule> {
    if (!this.module) {
      const controller = new AbortController(); this.loading = controller;
      const pending = this.load(controller.signal); this.module = pending;
      void pending.then(() => { if (this.loading === controller) this.loading = null; }, () => { if (this.module === pending) this.module = null; if (this.loading === controller) this.loading = null; });
    }
    return this.module;
  }
  preload(): void { if (!this.disposed) void this.ensureModule().catch(() => undefined); }
  async present(scene: VisualScene, runId: string): Promise<VisualPresentation> {
    if (this.disposed) throw cancelled();
    const generation = ++this.generation;
    this.presentation?.abort(); const operation = new AbortController(); this.presentation = operation;
    let stop!: () => void;
    const interrupted = new Promise<never>((_resolve, reject) => { stop = () => reject(cancelled()); operation.signal.addEventListener('abort', stop, { once: true }); });
    try {
      const module = await Promise.race([this.ensureModule(), interrupted]);
      if (this.disposed || generation !== this.generation) throw cancelled();
      this.viewer ??= module.createViewer3D(this.container, { onHide: this.onHide });
      const presentation = await Promise.race([this.viewer.present(scene, runId), interrupted]);
      if (this.disposed || generation !== this.generation) throw cancelled();
      return presentation;
    } finally { operation.signal.removeEventListener('abort', stop); if (this.presentation === operation) this.presentation = null; }
  }
  selection(): VisualSelection | null { return this.viewer?.selection() ?? null; }
  focusObject(id: string): boolean { return !this.disposed && /^[a-zA-Z0-9_-]{1,80}$/.test(id) ? this.viewer?.focusObject(id) ?? false : false; }
  cancelPresentation(): void { ++this.generation; this.presentation?.abort(); this.presentation = null; this.viewer?.cancelPresentation(); }
  hide(): void { this.cancelPresentation(); if (this.loading) { this.loading.abort(); this.loading = null; this.module = null; } this.viewer?.hide(); }
  show(): void { if (!this.disposed) this.viewer?.show(); }
  clear(): void { this.cancelPresentation(); if (this.loading) { this.loading.abort(); this.loading = null; this.module = null; } this.viewer?.dispose(); this.viewer = null; }
  dispose(): void { this.disposed = true; this.clear(); }
}
