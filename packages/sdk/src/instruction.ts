/** A null result asks the presentation layer to show the full text safely. */
export function instructionGraphemes(text: string): string[] | null {
  if (typeof Intl.Segmenter !== 'function') return null;
  return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), part => part.segment);
}

export const INSTRUCTION_CADENCE_MS = 22;
export const INSTRUCTION_LAYOUT_MS = 40;

/** Small reading pauses belong to local presentation, never task completion. */
export function instructionDelay(grapheme: string): number {
  if (/[.!?。！？\n]/u.test(grapheme)) return 66;
  if (/[,;:，；：]/u.test(grapheme)) return 34;
  return INSTRUCTION_CADENCE_MS;
}

/** At most one whole grapheme per painted frame, including after a long stall. */
export class InstructionCadence {
  private index = 0;
  private nextAt: number;
  private lastAt: number;
  private paintedAt = -Infinity;
  constructor(private readonly graphemes: readonly string[], startedAt: number) {
    if (!Number.isFinite(startedAt)) throw new RangeError('Invalid instruction clock');
    this.nextAt = startedAt; this.lastAt = startedAt;
  }
  get complete(): boolean { return this.index === this.graphemes.length; }
  advance(now: number): string | null {
    if (!Number.isFinite(now)) throw new RangeError('Invalid instruction clock');
    this.lastAt = Math.max(this.lastAt, now);
    if (this.complete || this.lastAt < this.nextAt || this.paintedAt === this.lastAt) return null;
    this.paintedAt = this.lastAt;
    const grapheme = this.graphemes[this.index++]!, delay = instructionDelay(grapheme);
    // Carry ordinary frame quantization to retain the desired cadence. Drop
    // accumulated debt after a delayed frame instead of rushing to catch up.
    this.nextAt = this.lastAt - this.nextAt > INSTRUCTION_CADENCE_MS * 2 ? this.lastAt + delay : this.nextAt + delay;
    return grapheme;
  }
}
