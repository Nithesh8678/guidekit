import type { PageContext, PageTarget } from '../../contracts/src/index';
import type { CompiledAction } from './security';
import { publicLabel, safeContext, validId } from './security';
import { routeKey } from './scene';

const privateSelector = '[data-guidekit-private], [data-guidekit-root], [aria-hidden="true"], [inert]';
const sensitiveAutocomplete = /(?:password|cc-|credit|transaction|one-time-code|webauthn)/i;
const sensitiveName = /(?:password|passphrase|secret|token|credential|credit.?card|card.?number|cvv|cvc|ssn)/i;
export function isSafeTarget(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement) || !element.isConnected || element.closest(privateSelector)) return false;
  if (element.matches('input[type="password"],input[type="hidden"],input[type="file"],[contenteditable]:not([contenteditable="false"])')) return false;
  if (sensitiveAutocomplete.test(element.getAttribute('autocomplete') ?? '') || sensitiveName.test(`${element.getAttribute('name') ?? ''} ${element.id}`)) return false;
  if (element instanceof HTMLInputElement && ['password', 'hidden', 'file'].includes(element.type)) return false;
  const style = getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && element.getClientRects().length > 0;
}
function publicText(element: Element): string {
  if (element.closest(privateSelector)) return '';
  let text = '';
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, { acceptNode: node => node.parentElement?.closest(`${privateSelector},script,style,textarea,select,input,[contenteditable]:not([contenteditable="false"])`) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
  while (walker.nextNode() && text.length < 200) text += ` ${walker.currentNode.textContent ?? ''}`;
  return text.replace(/\s+/g, ' ').trim().slice(0, 160);
}
function labelFor(element: HTMLElement): string {
  // A host-authored public label avoids reading personal accessible text (such as filenames).
  if (validId(element.getAttribute('data-guidekit-id'))) {
    const authored = element.getAttribute('data-guidekit-label')?.trim();
    if (authored) return authored.slice(0, 160);
  }
  const aria = element.getAttribute('aria-label')?.trim();
  if (aria) return aria.slice(0, 160);
  const ids = element.getAttribute('aria-labelledby')?.split(/\s+/).slice(0, 4) ?? [];
  const labelled = ids.map(id => document.getElementById(id)).filter((item): item is HTMLElement => Boolean(item && !item.closest(privateSelector))).map(publicText).join(' ').trim();
  if (labelled) return labelled.slice(0, 160);
  if ('labels' in element) {
    const labels = (element as HTMLInputElement).labels;
    const label = labels ? Array.from(labels).map(publicText).join(' ').trim() : '';
    if (label) return label.slice(0, 160);
  }
  return publicText(element) || element.getAttribute('title')?.slice(0, 160) || element.getAttribute('placeholder')?.slice(0, 160) || '';
}
function roleFor(element: HTMLElement): string {
  const role = element.getAttribute('role');
  if (role) return role.slice(0, 40);
  if (element instanceof HTMLInputElement) return ['checkbox', 'radio', 'range'].includes(element.type) ? element.type : 'textbox';
  if (element instanceof HTMLTextAreaElement) return 'textbox';
  if (element instanceof HTMLSelectElement) return 'combobox';
  if (element instanceof HTMLAnchorElement) return 'link';
  if (element instanceof HTMLButtonElement || element.matches('summary')) return 'button';
  return 'region';
}

export class ContextCollector {
  constructor(private readonly targetMode: 'auto' | 'explicit' = 'auto') {
    if (!['auto', 'explicit'].includes(targetMode)) throw new Error('GuideKit targetMode must be auto or explicit.');
  }
  private sequence = 0;
  private ids = new WeakMap<HTMLElement, string>();
  private targets = new Map<string, HTMLElement>();
  private explicit = new Set<string>();
  private identities = new Map<string, string>();
  private documentPath = '';
  private documentRoute = '';
  private identity(target: HTMLElement): string { return `${roleFor(target)}:${publicLabel(labelFor(target))}`; }
  collect(actions: Map<string, CompiledAction>, allowedActions: string[], context: unknown): PageContext {
    const targets: PageTarget[] = [];
    this.targets.clear(); this.explicit.clear(); this.identities.clear(); this.documentPath = `${location.origin}${location.pathname}`;
    this.documentRoute = routeKey();
    const candidates = Array.from(document.querySelectorAll(this.targetMode === 'explicit' ? '[data-guidekit-id]' : '[data-guidekit-id],button,a[href],input,textarea,select,summary,[role="button"],[role="link"],[role="tab"],[role="menuitem"],[role="checkbox"],[role="switch"]')).slice(0, 2000);
    const explicitCounts = new Map<string, number>();
    for (const element of candidates) {
      const id = element.getAttribute('data-guidekit-id');
      if (id) explicitCounts.set(id, (explicitCounts.get(id) ?? 0) + 1);
    }
    for (const element of candidates) {
      if (targets.length >= 160) break;
      if (!isSafeTarget(element)) continue;
      const label = publicLabel(labelFor(element)).slice(0, 160); if (!label) continue;
      const explicit = element.getAttribute('data-guidekit-id');
      if (explicit && (!validId(explicit) || explicitCounts.get(explicit) !== 1)) continue;
      let id = explicit ?? this.ids.get(element);
      if (!id) { do { id = `gk_${++this.sequence}`; } while (explicitCounts.has(id)); this.ids.set(element, id); }
      if (this.targets.has(id)) continue;
      this.targets.set(id, element); if (explicit) this.explicit.add(id);
      this.identities.set(id, this.identity(element));
      const rawDescription = element.getAttribute('data-guidekit-description');
      const description = rawDescription ? publicLabel(rawDescription).slice(0, 250) : undefined;
      targets.push({ id, label, role: roleFor(element), ...(description ? { description } : {}) });
    }
    const url = new URL(location.href); url.search = ''; url.hash = '';
    return {
      url: url.href.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, 'redacted').slice(0, 1800), title: publicLabel(document.title).slice(0, 200), targets,
      actions: [...actions].filter(([name]) => allowedActions.includes(name)).slice(0, 30).map(([name, { definition }]) => ({ name, description: definition.description, inputSchema: definition.inputSchema, requiresConfirmation: true })),
      context: safeContext(context)
    };
  }
  resolve(id: string): HTMLElement | null {
    if (this.documentPath !== `${location.origin}${location.pathname}` || this.documentRoute !== routeKey()) return null;
    const target = this.targets.get(id);
    if (!this.explicit.has(id)) return this.targetMode !== 'explicit' && target && isSafeTarget(target) && this.identity(target) === this.identities.get(id) ? target : null;
    const matches = Array.from(document.querySelectorAll('[data-guidekit-id]')).filter(element => element.getAttribute('data-guidekit-id') === id);
    if (matches.length !== 1 || !isSafeTarget(matches[0]!) || this.identity(matches[0]!) !== this.identities.get(id)) return null;
    this.targets.set(id, matches[0]!); return matches[0]!;
  }
}
