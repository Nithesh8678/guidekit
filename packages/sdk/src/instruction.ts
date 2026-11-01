/** A null result asks the presentation layer to show the full text safely. */
export function instructionGraphemes(text: string): string[] | null {
  if (typeof Intl.Segmenter !== 'function') return null;
  return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), part => part.segment);
}

/** Presentation is quick and bounded; it never gates a guidance step. */
export function instructionDuration(graphemes: number): number {
  if (!Number.isFinite(graphemes) || graphemes < 0) throw new RangeError('Invalid instruction length');
  return graphemes === 0 ? 0 : Math.min(1500, Math.max(600, 420 + graphemes * 8));
}
