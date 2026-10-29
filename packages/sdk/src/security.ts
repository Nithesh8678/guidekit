import { compileInputSchema, type InputValidator } from '../../contracts/src/schema';
import type { PublicAgent, RunResult } from '../../contracts/src/index';
import type { RegisteredAction } from './types';

export const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(value);
export const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export function endpointOrigin(endpoint: string): string {
  const url = new URL(endpoint);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new Error('GuideKit endpoint must be an HTTP(S) origin without credentials or a path.');
  if (typeof location !== 'undefined' && location.protocol === 'https:' && url.protocol !== 'https:') throw new Error('Use an HTTPS GuideKit endpoint on HTTPS websites.');
  return url.origin;
}

const privateKey = /(?:password|passphrase|secret|token|credential|authorization|cookie|cardnumber|creditcard|cvv|cvc|ssn|email)/i;
export const publicLabel = (value: string): string => value.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted email]');
/** Limits explicit host-provided context and drops common credential keys. */
export function safeContext(value: unknown): Record<string, unknown> {
  let remaining = 12_000;
  const visited = new WeakSet<object>();
  function copy(input: unknown, depth: number): unknown {
    if (remaining <= 0 || depth > 4) return undefined;
    if (typeof input === 'string') { const result = publicLabel(input.slice(0, Math.min(1200, remaining))); remaining -= result.length; return result; }
    if (typeof input === 'boolean' || input === null) return input;
    if (typeof input === 'number') return Number.isFinite(input) ? input : undefined;
    if (typeof input !== 'object' || input === null || visited.has(input)) return undefined;
    visited.add(input);
    if (Array.isArray(input)) return input.slice(0, 30).map(entry => copy(entry, depth + 1)).filter(entry => entry !== undefined);
    if (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) return undefined;
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const [key, entry] of Object.entries(input).slice(0, 40)) {
      if (privateKey.test(key) || ['__proto__', 'prototype', 'constructor'].includes(key)) continue;
      remaining -= key.length;
      const clean = copy(entry, depth + 1);
      if (clean !== undefined) result[key.slice(0, 100)] = clean;
    }
    return result;
  }
  return record(value) ? (copy(value, 0) as Record<string, unknown> ?? {}) : {};
}

export interface CompiledAction { definition: RegisteredAction; validate: InputValidator; }
export function compileAction(name: string, definition: RegisteredAction): CompiledAction {
  if (!validId(name) || !record(definition) || typeof definition.description !== 'string' || definition.description.length > 500 || !record(definition.inputSchema) || typeof definition.execute !== 'function' || definition.requiresConfirmation !== true) throw new Error('Actions require a valid name, description, object JSON Schema, execute function, and requiresConfirmation: true.');
  const schemaText = JSON.stringify(definition.inputSchema);
  if (schemaText.length > 20_000 || definition.inputSchema.type !== 'object' || /"\$(?:ref|dynamicRef|recursiveRef)"\s*:/.test(schemaText)) throw new Error('Use a bounded object JSON Schema without external or recursive references.');
  if (definition.timeoutMs !== undefined && (!Number.isFinite(definition.timeoutMs) || definition.timeoutMs < 100 || definition.timeoutMs > 120_000)) throw new Error('Action timeout must be between 100 and 120000 ms.');
  // Snapshot the descriptor so later host mutations cannot change an approved action.
  const copied = { ...definition, inputSchema: JSON.parse(schemaText) as Record<string, unknown> };
  return { definition: copied, validate: compileInputSchema(copied.inputSchema) };
}

export function parsePublicAgent(value: unknown): PublicAgent {
  if (!record(value) || !validId(value.id) || !Number.isInteger(value.version) || Number(value.version) < 1 || typeof value.name !== 'string' || value.name.length > 80 || typeof value.companyName !== 'string' || value.companyName.length > 100 || typeof value.greeting !== 'string' || value.greeting.length > 250 || typeof value.accentColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(value.accentColor) || !Array.isArray(value.allowedActions) || value.allowedActions.length > 30 || !value.allowedActions.every(validId)) throw new Error('The agent returned an invalid published configuration.');
  return value as unknown as PublicAgent;
}
export function parseRun(value: unknown): RunResult {
  if (!record(value) || !validId(value.runId) || typeof value.answer !== 'string' || value.answer.length < 1 || value.answer.length > 5000 || value.provider !== 'codex' || !Number.isInteger(value.version) || !Array.isArray(value.steps) || value.steps.length > 8 || !Array.isArray(value.citations) || value.citations.length > 8) throw new Error('The assistant returned an invalid response. Please try again.');
  for (const step of value.steps) if (!record(step) || !validId(step.targetId) || typeof step.text !== 'string' || step.text.length < 1 || step.text.length > 600) throw new Error('The assistant returned invalid guidance.');
  for (const citation of value.citations) if (!record(citation) || !validId(citation.documentId) || typeof citation.title !== 'string' || citation.title.length > 500 || typeof citation.excerpt !== 'string' || citation.excerpt.length > 5000) throw new Error('The assistant returned an invalid source.');
  if (value.action !== null && (!record(value.action) || !validId(value.action.name) || !validId(value.action.receiptId) || value.action.requiresConfirmation !== true || typeof value.action.reason !== 'string' || value.action.reason.length > 600 || !record(value.action.arguments) || JSON.stringify(value.action.arguments).length > 20_000)) throw new Error('The assistant returned an invalid action.');
  return value as unknown as RunResult;
}
