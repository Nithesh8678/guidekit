import type { Citation, RunResult } from '../../../packages/contracts/src/index.js';

type Evidence = { citations: Citation[]; knowledge: NonNullable<RunResult['knowledge']> };
export interface EvidenceScope { tenantId: string; agentId: string; version: number; sessionId: string; journeyId: string; question: string; }

/** Reuses validated immutable publication evidence only inside the same active task. */
export class JourneyEvidenceCache {
  private readonly entries = new Map<string, { value: Evidence; expires: number }>();
  constructor(private readonly now = Date.now, private readonly ttlMs = 120_000, private readonly capacity = 32) {}
  async read(scope: EvidenceScope, reuse: boolean, load: () => Promise<Evidence>): Promise<{ evidence: Evidence; cached: boolean }> {
    const key = JSON.stringify([scope.tenantId, scope.agentId, scope.version, scope.sessionId, scope.journeyId, scope.question]);
    const now = this.now();
    for (const [id, entry] of this.entries) if (entry.expires <= now) this.entries.delete(id);
    const entry = this.entries.get(key);
    if (reuse && entry) return { evidence: structuredClone(entry.value), cached: true };
    // A refresh failure must not retain old evidence as an implicit fallback.
    this.entries.delete(key);
    const evidence = await load();
    if (JSON.stringify(evidence).length <= 64000) {
      while (this.entries.size >= this.capacity) this.entries.delete(this.entries.keys().next().value!);
      this.entries.set(key, { value: structuredClone(evidence), expires: this.now() + this.ttlMs });
    }
    return { evidence, cached: false };
  }
  clear(): void { this.entries.clear(); }
}
