import assert from 'node:assert/strict';
import test from 'node:test';
import { ContextCollector, TargetIdentityAllocator } from '../src/context';

test('shared automatic IDs stay stable across immutable snapshots without inheriting new labels or private targets', () => {
  class ElementDouble {
    isConnected = true; id = ''; attributes = new Map<string, string>();
    getAttribute(key: string) { return this.attributes.get(key) ?? null; }
    closest(selector: string) { return selector.includes('[data-guidekit-private]') && this.attributes.has('data-guidekit-private') ? this : null; }
    matches() { return false; }
    getClientRects() { return [{}]; }
  }
  class ButtonDouble extends ElementDouble { constructor(label: string) { super(); this.attributes.set('aria-label', label); } }
  class InputDouble extends ElementDouble {}
  const first = new ButtonDouble('First'), second = new ButtonDouble('Second'); let elements = [first, second];
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ HTMLElement: ElementDouble, HTMLButtonElement: ButtonDouble, HTMLInputElement: InputDouble, HTMLTextAreaElement: class extends ElementDouble {}, HTMLSelectElement: class extends ElementDouble {}, HTMLAnchorElement: class extends ElementDouble {}, getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }), document: { title: 'Product', querySelectorAll: () => elements }, location: { origin: 'https://host.test', pathname: '/app', href: 'https://host.test/app', search: '', hash: '' } })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { value, configurable: true });
  }
  try {
    const allocator = new TargetIdentityAllocator(), old = new ContextCollector('auto', undefined, allocator), initial = old.collect(new Map(), [], {}), firstId = initial.targets[0]!.id;
    elements = [new ButtonDouble('Inserted'), second, first];
    const next = new ContextCollector('auto', undefined, allocator), after = next.collect(new Map(), [], {});
    assert.equal(after.targets.find(target => target.label === 'First')!.id, firstId); assert.equal(old.resolve(firstId), first as unknown as HTMLElement);
    first.attributes.set('aria-label', 'Changed label');
    const changed = new ContextCollector('auto', undefined, allocator), changedPage = changed.collect(new Map(), [], {});
    assert.equal(changedPage.targets.find(target => target.label === 'Changed label')!.id, firstId);
    assert.equal(old.resolve(firstId), null); assert.equal(next.resolve(firstId), null); assert.equal(changed.resolve(firstId), first as unknown as HTMLElement);
    first.attributes.set('data-guidekit-private', ''); assert.equal(changed.resolve(firstId), null);
  } finally { for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } }
});
