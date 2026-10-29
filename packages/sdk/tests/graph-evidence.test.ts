import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRun } from '../src/security';
import { View } from '../src/view';

const run = { runId: 'run_1', answer: 'Billing statements support CSV export.', steps: [], action: null, citations: [{ documentId: 'invoice', title: 'Invoice help', excerpt: 'Invoice belongs to billing.' }, { documentId: 'export', title: 'Statement export', excerpt: 'Billing statements support CSV export.' }], provider: 'codex', version: 1 };
const path = { nodes: ['invoice', 'billing', 'export'], relation: 'Documents share a concept through their source chunks.' };

test('optional knowledge evidence accepts local, TigerGraph and legacy responses within bounds', () => {
  assert.equal(parseRun(run).knowledge, undefined);
  assert.deepEqual(parseRun({ ...run, knowledge: { source: 'local', paths: [] } }).knowledge, { source: 'local', paths: [] });
  const knowledge = { source: 'tigergraph', paths: [path] };
  assert.deepEqual(parseRun({ ...run, knowledge }).knowledge, knowledge);
  assert.equal(parseRun({ ...run, knowledge: { source: 'tigergraph', paths: Array.from({ length: 32 }, () => ({ nodes: ['invoice', 'x'.repeat(64), 'export'], relation: 'r'.repeat(300) })) } }).knowledge!.paths.length, 32);
});

test('malformed and excessive knowledge metadata fails closed before rendering', () => {
  const invalid = [
    null, [], 'tigergraph', {}, { source: 'other', paths: [] }, { source: 'tigergraph' },
    { source: { toString: () => 'tigergraph' }, paths: [] },
    { source: 'tigergraph', paths: [], extra: 'unbounded data' },
    { source: 'tigergraph', paths: Array.from({ length: 33 }, () => path) },
    ...[
      {}, { ...path, nodes: ['invoice', 'billing'] }, { ...path, nodes: ['invoice', 'billing', 'export', 'extra'] },
      { ...path, nodes: ['invalid/id', 'billing', 'export'] }, { ...path, nodes: ['invoice', 'billing', '<script>'] },
      { ...path, nodes: ['invoice', '', 'export'] }, { ...path, nodes: ['invoice', 42, 'export'] },
      { ...path, nodes: ['invoice', 'x'.repeat(65), 'export'] }, { ...path, relation: 'x'.repeat(301) },
      { ...path, relation: 42 }, { ...path, extra: 'unexpected' }
    ].map(value => ({ source: 'tigergraph', paths: [value] }))
  ];
  for (const knowledge of invalid) assert.throws(() => parseRun({ ...run, knowledge }), /invalid knowledge/);
});

class TextElement {
  children: TextElement[] = [];
  className = ''; textContent = '';
  constructor(public readonly tagName: string) {}
  append(...children: TextElement[]) { this.children.push(...children); }
  get allText(): string { return [this.textContent, ...this.children.map(child => child.allText)].filter(Boolean).join('\n'); }
  set innerHTML(_value: string) { throw new Error('External knowledge must never be parsed as HTML.'); }
}

test('view maps citation titles and renders graph paths as safe text with a truthful empty-path label', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document'), tags: string[] = [];
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: (tag: string) => { tags.push(tag); return new TextElement(tag); } } });
  try {
    const view = Object.create(View.prototype) as View;
    Object.defineProperty(view, 'scroll', { value: () => {} });
    const container = new TextElement('div');
    const knowledge = parseRun({ ...run, knowledge: { source: 'tigergraph', paths: [{ nodes: ['invoice', '<script>alert(1)</script>', 'export'], relation: '<img src=x onerror=alert(1)>' }, { nodes: ['unknown_doc', 'billing', 'export'], relation: 'A related source.' }] } }).knowledge;
    view.knowledgeEvidence(container as unknown as HTMLElement, knowledge, run.citations);
    assert.match(container.allText, /TigerGraph relationships/);
    assert.ok(container.allText.includes('Invoice help → <script>alert(1)</script> → Statement export'));
    assert.ok(container.allText.includes('unknown_doc → billing → Statement export'));
    assert.ok(container.allText.includes('<img src=x onerror=alert(1)>'));
    assert.ok(tags.every(tag => ['details', 'summary', 'div', 'strong'].includes(tag)));
    const empty = new TextElement('div'); view.knowledgeEvidence(empty as unknown as HTMLElement, { source: 'tigergraph', paths: [] }, []);
    assert.equal(empty.allText, 'Knowledge retrieved with TigerGraph');
    const local = new TextElement('div'); view.knowledgeEvidence(local as unknown as HTMLElement, { source: 'local', paths: [] }, []);
    assert.equal(local.children.length, 0);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous); else Reflect.deleteProperty(globalThis, 'document');
  }
});
