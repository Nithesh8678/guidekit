import assert from 'node:assert/strict';
import test from 'node:test';
import { GuidanceSession, type GuidanceResult, type GuidanceState } from '../src/guidance';

// Explicit DOM doubles exercise observation logic without pretending a real page ran.
// Browser acceptance tests separately cover actual controls, user input and visibility.
class ElementDouble {
  tagName: string; id = ''; isConnected = true; visible = true; disabled = false; readOnly = false;
  attributes = new Map<string, string>(); ownerDocument!: DocumentDouble; parent: ElementDouble | null = null;
  constructor(tag: string) { this.tagName = tag.toUpperCase(); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  closest(selector: string): ElementDouble | null {
    const selectors = selector.split(',').map(value => value.trim());
    if (selectors.some(value => value === '[data-guidekit-root]' && this.attributes.has('data-guidekit-root') || value === '[data-guidekit-private]' && this.attributes.has('data-guidekit-private') || value === '[aria-hidden="true"]' && this.getAttribute('aria-hidden') === 'true' || value === '[inert]' && this.attributes.has('inert'))) return this;
    return this.parent?.closest(selector) ?? null;
  }
  matches(selector: string): boolean {
    if (selector === ':disabled') return this.disabled;
    return this instanceof InputDouble && ['password', 'hidden', 'file'].includes(this.type);
  }
  getClientRects() { return this.visible ? [{}] : []; }
  contains(element: ElementDouble): boolean { return element === this || Boolean(element.parent && this.contains(element.parent)); }
}
class InputDouble extends ElementDouble {
  type = 'text'; value = ''; checked = false; validity = { valid: true }; willValidate = true; form: FormDouble | null = null;
  constructor(type = 'text') { super('input'); this.type = type; }
}
class TextareaDouble extends ElementDouble { value = ''; validity = { valid: true }; willValidate = true; constructor() { super('textarea'); } }
class SelectDouble extends ElementDouble { value = ''; validity = { valid: true }; willValidate = true; constructor() { super('select'); } }
class ButtonDouble extends ElementDouble { type = 'button'; form: FormDouble | null = null; validity = { valid: true }; willValidate = false; constructor() { super('button'); } }
class FormDouble extends ElementDouble { elements: ElementDouble[] = []; constructor() { super('form'); } }
class DocumentDouble {
  documentElement = new ElementDouble('html'); listeners = new Map<string, Set<(event: Event) => void>>();
  addEventListener(name: string, callback: (event: Event) => void) { const callbacks = this.listeners.get(name) ?? new Set(); callbacks.add(callback); this.listeners.set(name, callbacks); }
  removeEventListener(name: string, callback: (event: Event) => void) { this.listeners.get(name)?.delete(callback); }
  fire(type: string, target: ElementDouble, extra: Record<string, unknown> = {}) { for (const callback of [...this.listeners.get(type) ?? []]) callback({ type, target, isTrusted: true, ...extra } as unknown as Event); }
  get listenerCount() { return [...this.listeners.values()].reduce((count, listeners) => count + listeners.size, 0); }
}
class ObserverDouble {
  static instances: ObserverDouble[] = [];
  connected = false;
  constructor(private readonly callback: MutationCallback) { ObserverDouble.instances.push(this); }
  observe() { this.connected = true; }
  disconnect() { this.connected = false; }
  update(target: ElementDouble) { if (this.connected) this.callback([{ target } as unknown as MutationRecord], this as unknown as MutationObserver); }
}
function environment(elements: Array<[string, ElementDouble]>) {
  ObserverDouble.instances = [];
  const doc = new DocumentDouble(); const targets = new Map(elements);
  for (const element of targets.values()) element.ownerDocument = doc;
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ document: doc, HTMLElement: ElementDouble, HTMLInputElement: InputDouble, MutationObserver: ObserverDouble, getComputedStyle: (element: ElementDouble) => ({ display: element.visible ? 'block' : 'none', visibility: 'visible', opacity: '1' }) })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { value, configurable: true });
  }
  const updates: GuidanceState[] = []; const finishes: GuidanceResult[] = [];
  const session = new GuidanceSession(elements.map(([targetId]) => ({ targetId, text: `Use ${targetId}` })), id => targets.get(id) as unknown as HTMLElement ?? null, { onUpdate: state => updates.push(state), onFinish: result => finishes.push(result) });
  return { session, doc, targets, updates, finishes, get state() { return updates.at(-1)!; }, fire: (type: string, target: ElementDouble, extra?: Record<string, unknown>) => doc.fire(type, target, extra), mutate: () => ObserverDouble.instances[0]!.update(doc.documentElement), restore: () => { session.destroy(); for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } } };
}

test('only user typing, nonempty validity and 1200 ms of quiet advance a text field; values stay out of emitted metadata', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const name = new InputDouble(); const company = new InputDouble(); const state = environment([['name', name], ['company', company]]);
  try {
    state.session.start(); name.value = 'Not an event'; context.mock.timers.tick(5000); assert.equal(state.state.index, 0);
    state.fire('input', name, { isTrusted: false }); context.mock.timers.tick(5000); assert.equal(state.state.index, 0);
    name.value = 'Taylor'; state.fire('input', name); context.mock.timers.tick(1199); assert.equal(state.state.index, 0);
    name.value = 'Taylor Morgan'; state.fire('input', name); context.mock.timers.tick(1199); assert.equal(state.state.index, 0);
    context.mock.timers.tick(1); assert.equal(state.state.index, 1); assert.equal(state.state.completed, 1); assert.equal(state.state.target, company);
    assert.equal(JSON.stringify(state.updates.map(({ target, ...metadata }) => metadata)).includes('Taylor'), false);
    company.value = ' '; state.fire('input', company); context.mock.timers.tick(1200); assert.equal(state.session.active, true);
  } finally { state.restore(); context.mock.timers.reset(); }
});

test('native validity, aria-invalid, disabled and readonly controls cannot auto-complete', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const name = new InputDouble(); const state = environment([['name', name], ['save', new ButtonDouble()]]);
  try {
    state.session.start(); name.value = 'Taylor';
    name.validity.valid = false; state.fire('input', name); context.mock.timers.tick(1200); assert.equal(state.state.index, 0);
    name.validity.valid = true; name.setAttribute('aria-invalid', 'true'); state.fire('input', name); context.mock.timers.tick(1200); assert.equal(state.state.index, 0);
    name.setAttribute('aria-invalid', 'false'); name.disabled = true; state.fire('input', name); context.mock.timers.tick(1200); assert.equal(state.state.index, 0);
    name.disabled = false; name.readOnly = true; state.fire('input', name); context.mock.timers.tick(1200); assert.equal(state.state.index, 0);
    name.readOnly = false; state.fire('input', name); context.mock.timers.tick(1200); assert.equal(state.state.index, 1);
  } finally { state.restore(); context.mock.timers.reset(); }
});

test('IME composition blocks quiet completion until composition ends', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const name = new InputDouble(); const state = environment([['name', name], ['save', new ButtonDouble()]]);
  try {
    state.session.start(); name.value = 'Taylor'; state.fire('compositionstart', name); state.fire('input', name, { isComposing: true });
    context.mock.timers.tick(5000); assert.equal(state.state.index, 0);
    state.fire('compositionend', name); context.mock.timers.tick(1199); assert.equal(state.state.index, 0);
    context.mock.timers.tick(1); assert.equal(state.state.index, 1);
  } finally { state.restore(); context.mock.timers.reset(); }
});

test('textarea waits for a real field exit, and moving to GuideKit controls cannot cause an accidental advance', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const description = new TextareaDouble(); const state = environment([['description', description], ['save', new ButtonDouble()]]); const hud = new ElementDouble('div'); hud.setAttribute('data-guidekit-root', '');
  try {
    state.session.start(); description.value = 'A long description'; state.fire('input', description); context.mock.timers.tick(6000); assert.equal(state.state.index, 0);
    state.fire('focusout', description, { relatedTarget: hud }); context.mock.timers.tick(0); assert.equal(state.state.index, 0);
    state.fire('focusout', description, { relatedTarget: null }); context.mock.timers.tick(0); assert.equal(state.state.index, 1);
  } finally { state.restore(); context.mock.timers.reset(); }
});

test('valid choices advance after dispatch, while final click waits for a verified host result and permits retry', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const status = new SelectDouble(); const save = new ButtonDouble(); const state = environment([['status', status], ['save', save]]);
  try {
    state.session.start(); state.fire('change', status); assert.equal(state.state.index, 0); context.mock.timers.tick(0); assert.equal(state.state.index, 1);
    state.fire('click', save); assert.equal(state.state.waiting, true); context.mock.timers.tick(10000); assert.deepEqual(state.finishes, []);
    state.session.reportResult('unknown', { success: true }); assert.equal(state.session.active, true);
    state.session.reportResult('save', { success: false, message: 'The save failed. Try again.' }); assert.match(state.state.hint, /save failed/); assert.equal(state.state.waiting, false);
    state.fire('click', save); assert.equal(state.state.waiting, true);
    state.session.reportResult('save', { success: true }); assert.deepEqual(state.finishes, [{ reason: 'completed', verified: true, message: 'The website confirmed the result.' }]); assert.equal(state.doc.listenerCount, 0);
  } finally { state.restore(); context.mock.timers.reset(); }
});

test('nonfinal click advances after dispatch; submit waits for the next newly available known target', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const open = new ButtonDouble(); const submit = new ButtonDouble(); const after = new InputDouble(); after.visible = false;
  const form = new FormDouble(); submit.type = 'submit'; submit.form = form; form.elements = [submit];
  const state = environment([['open', open], ['submit', submit], ['after', after]]);
  try {
    state.session.start(); state.fire('click', open); assert.equal(state.state.index, 0); context.mock.timers.tick(0); assert.equal(state.state.index, 1);
    state.fire('click', submit); context.mock.timers.tick(0); assert.equal(state.state.index, 1);
    state.fire('submit', form); context.mock.timers.tick(0); assert.equal(state.state.index, 1);
    after.visible = true; state.mutate(); assert.equal(state.state.index, 2); assert.equal(state.state.completed, 2);
  } finally { state.restore(); context.mock.timers.reset(); }
});

test('invalid form submission stays on the save step, including an invalid sibling control', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const save = new ButtonDouble(); const name = new InputDouble(); name.validity.valid = false; const form = new FormDouble(); save.type = 'submit'; save.form = form; form.elements = [name, save];
  const state = environment([['save', save]]);
  try { state.session.start(); state.fire('click', save); assert.equal(state.state.waiting, false); assert.match(state.state.hint, /required fields/); context.mock.timers.tick(5000); assert.equal(state.finishes.length, 0); }
  finally { state.restore(); context.mock.timers.reset(); }
});

test('pause, auto-off and manual Next never silently verify a result; deferred host results wait for resume', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const name = new InputDouble(); const save = new ButtonDouble(); const state = environment([['name', name], ['save', save]]);
  try {
    state.session.start(); name.value = 'Taylor'; state.fire('input', name); context.mock.timers.tick(600); state.session.setPaused(true); context.mock.timers.tick(6000); assert.equal(state.state.index, 0);
    state.session.setPaused(false); state.session.setAutomatic(false); state.fire('input', name); context.mock.timers.tick(6000); assert.equal(state.state.index, 0);
    state.session.next(); assert.equal(state.state.index, 1); state.session.next(); assert.equal(state.finishes[0]!.verified, false);
  } finally { state.restore(); context.mock.timers.reset(); }
  const paused = environment([['save', new ButtonDouble()]]);
  try { paused.session.start(); paused.session.setPaused(true); paused.session.reportResult('save', { success: true }); assert.equal(paused.finishes.length, 0); paused.session.setPaused(false); assert.equal(paused.finishes[0]!.verified, true); }
  finally { paused.restore(); }
});

test('editing a previous field cancels the pending next-field timer and returns to the first unfinished step', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const name = new InputDouble(); const company = new InputDouble(); const state = environment([['name', name], ['company', company], ['save', new ButtonDouble()]]);
  try {
    state.session.start(); name.value = 'Taylor'; state.fire('input', name); context.mock.timers.tick(1200); assert.equal(state.state.index, 1);
    company.value = 'Acme'; state.fire('input', company); context.mock.timers.tick(600);
    state.fire('focusin', name); assert.equal(state.state.index, 0); context.mock.timers.tick(1200); assert.equal(state.state.index, 0);
    name.value = 'Taylor Morgan'; state.fire('input', name); assert.equal(state.state.completed, 0); context.mock.timers.tick(1200); assert.equal(state.state.index, 2); // Company was already genuinely edited and valid.
    state.session.back(); assert.equal(state.state.index, 1); state.session.next(); assert.equal(state.state.index, 2);
  } finally { state.restore(); context.mock.timers.reset(); }
});

test('same-ID replacement recovers within 1200 ms, but detached or private targets never complete from a stale timer', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const name = new InputDouble(); const state = environment([['name', name], ['save', new ButtonDouble()]]);
  try {
    state.session.start(); name.value = 'Taylor'; state.fire('input', name); context.mock.timers.tick(600);
    name.isConnected = false; state.targets.delete('name'); state.mutate(); assert.equal(state.state.target, null); assert.equal(state.state.waiting, true);
    context.mock.timers.tick(1199); const replacement = new InputDouble(); replacement.ownerDocument = state.doc; state.targets.set('name', replacement); state.mutate(); context.mock.timers.tick(1); assert.equal(state.state.target, replacement); assert.equal(state.finishes.length, 0);
    replacement.value = 'Taylor'; state.fire('input', replacement); context.mock.timers.tick(600); replacement.setAttribute('data-guidekit-private', '');
    context.mock.timers.tick(600); assert.equal(state.state.target, null); assert.equal(state.state.index, 0);
    context.mock.timers.tick(1200); assert.equal(state.finishes[0]!.reason, 'missing'); assert.equal(state.finishes[0]!.verified, false);
  } finally { state.restore(); context.mock.timers.reset(); }
});

test('stop and destroy remove all observers, listeners and timers, with no delayed completion or restart', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const name = new InputDouble(); const state = environment([['name', name], ['save', new ButtonDouble()]]);
  try {
    state.session.start(); name.value = 'Taylor'; state.fire('input', name); assert.equal(state.doc.listenerCount, 8);
    state.session.destroy(); assert.equal(state.doc.listenerCount, 0); assert.equal(ObserverDouble.instances[0]!.connected, false); assert.equal(state.session.active, false);
    state.session.start(); state.fire('input', name); state.session.reportResult('save', { success: true }); context.mock.timers.tick(20000); state.mutate(); assert.deepEqual(state.finishes, [{ reason: 'stopped', verified: false }]);
  } finally { state.restore(); context.mock.timers.reset(); }
});

test('host verification can arrive synchronously before the click completes, without a duplicate or late finish', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const save = new ButtonDouble(); const state = environment([['save', save]]);
  try { state.session.start(); state.fire('click', save); state.session.reportResult('save', { success: true }); state.fire('submit', new FormDouble()); state.session.reportResult('save', { success: true }); context.mock.timers.tick(2000); assert.equal(state.finishes.length, 1); assert.equal(state.finishes[0]!.verified, true); }
  finally { state.restore(); context.mock.timers.reset(); }
});

test('rapid Tab and filling the next known field needs no second edit or idle wait after either field exit', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const name = new InputDouble(); const company = new InputDouble(); const save = new ButtonDouble(); const state = environment([['name', name], ['company', company], ['save', save]]);
  try {
    state.session.start(); name.value = 'Taylor'; state.fire('input', name);
    state.fire('focusout', name, { relatedTarget: company }); state.fire('focusin', company); company.value = 'Acme'; state.fire('input', company);
    state.fire('focusout', company, { relatedTarget: save }); state.fire('focusin', save);
    assert.equal(state.state.index, 0); context.mock.timers.tick(0); assert.equal(state.state.index, 2); assert.equal(state.state.completed, 2);
    state.fire('click', save); assert.equal(state.state.waiting, true); context.mock.timers.tick(1200); assert.equal(state.finishes.length, 0);
    state.session.reportResult('save', { success: true }); assert.equal(state.finishes[0]!.verified, true);
  } finally { state.restore(); context.mock.timers.reset(); }
});

test('a trusted future choice is remembered, but an invalid future field cannot be skipped', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const name = new InputDouble(); const status = new SelectDouble(); const company = new InputDouble(); const state = environment([['name', name], ['status', status], ['company', company], ['save', new ButtonDouble()]]);
  try {
    state.session.start(); name.value = 'Taylor'; state.fire('input', name);
    state.fire('change', status); company.value = 'Acme'; state.fire('input', company); company.validity.valid = false;
    context.mock.timers.tick(1200); assert.equal(state.state.index, 2); assert.equal(state.state.completed, 2); assert.equal(state.finishes.length, 0);
    company.validity.valid = true; context.mock.timers.tick(5000); assert.equal(state.state.index, 2); // Fixing validity programmatically does not impersonate another edit.
    state.fire('input', company); context.mock.timers.tick(1200); assert.equal(state.state.index, 3);
  } finally { state.restore(); context.mock.timers.reset(); }
});

test('future textarea and IME input retain their completion rules when the guide catches up', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const name = new InputDouble(); const description = new TextareaDouble(); const company = new InputDouble(); const state = environment([['name', name], ['description', description], ['company', company], ['save', new ButtonDouble()]]);
  try {
    state.session.start(); name.value = 'Taylor'; state.fire('input', name);
    description.value = 'Still writing'; state.fire('input', description);
    company.value = 'Acme'; state.fire('compositionstart', company); state.fire('input', company, { isComposing: true });
    context.mock.timers.tick(5000); assert.equal(state.state.index, 1);
    state.fire('focusout', description, { relatedTarget: company }); context.mock.timers.tick(0); assert.equal(state.state.index, 2);
    context.mock.timers.tick(5000); assert.equal(state.state.index, 2);
    state.fire('compositionend', company); context.mock.timers.tick(1200); assert.equal(state.state.index, 3);
  } finally { state.restore(); context.mock.timers.reset(); }
});

test('earlier user edits discard a deferred final host result instead of completing from a stale receipt', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const name = new InputDouble(); const save = new ButtonDouble(); const state = environment([['name', name], ['save', save]]);
  try {
    state.session.start(); name.value = 'Taylor'; state.fire('input', name); context.mock.timers.tick(1200); assert.equal(state.state.index, 1);
    state.fire('click', save); state.session.setPaused(true); state.session.reportResult('save', { success: true }); assert.equal(state.finishes.length, 0);
    state.fire('focusin', name); name.value = 'Taylor Morgan'; state.fire('input', name); assert.equal(state.state.index, 0); assert.equal(state.state.completed, 0);
    state.session.setPaused(false); assert.equal(state.finishes.length, 0); context.mock.timers.tick(1200); assert.equal(state.state.index, 1); assert.equal(state.finishes.length, 0);
  } finally { state.restore(); context.mock.timers.reset(); }
});

test('a disappearing nonfinal clicked control advances only when the next known target newly appears', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const open = new ButtonDouble(); const name = new InputDouble(); name.visible = false; const state = environment([['open', open], ['name', name], ['save', new ButtonDouble()]]);
  try {
    state.session.start(); state.fire('click', open); open.isConnected = false; name.visible = true; state.mutate(); assert.equal(state.state.index, 1); assert.equal(state.state.completed, 1);
    context.mock.timers.tick(1200); assert.equal(state.finishes.length, 0);
  } finally { state.restore(); }
  const visibleOpen = new ButtonDouble(); const visibleNext = new InputDouble(); const existing = environment([['open', visibleOpen], ['name', visibleNext]]);
  try {
    existing.session.start(); existing.fire('click', visibleOpen); visibleOpen.isConnected = false; existing.mutate(); assert.equal(existing.state.index, 0);
    context.mock.timers.tick(1200); assert.equal(existing.finishes[0]!.reason, 'missing'); assert.equal(existing.finishes[0]!.verified, false);
  } finally { existing.restore(); context.mock.timers.reset(); }
});

test('remembered future input is discarded if its safe element is replaced or made private before consumption', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const name = new InputDouble(); const company = new InputDouble(); const state = environment([['name', name], ['company', company], ['save', new ButtonDouble()]]);
  try {
    state.session.start(); name.value = 'Taylor'; state.fire('input', name); company.value = 'Acme'; state.fire('input', company);
    const replacement = new InputDouble(); replacement.ownerDocument = state.doc; replacement.value = 'Prefilled by the site'; company.isConnected = false; state.targets.set('company', replacement);
    context.mock.timers.tick(1200); assert.equal(state.state.index, 1); context.mock.timers.tick(5000); assert.equal(state.state.index, 1);
    state.fire('input', replacement); replacement.setAttribute('data-guidekit-private', ''); context.mock.timers.tick(1200); assert.equal(state.state.target, null); context.mock.timers.tick(1200); assert.equal(state.finishes[0]!.reason, 'missing');
  } finally { state.restore(); context.mock.timers.reset(); }
});
