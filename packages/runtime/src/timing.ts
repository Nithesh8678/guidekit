export type InferencePhase = 'startup' | 'restrictions' | 'authentication' | 'catalog' | 'thread' | 'first_delta' | 'inference' | 'cleanup';
export interface InferenceTiming { phase: InferencePhase; durationMs: number; elapsedMs: number; }
export type InferenceTimingObserver = (event: InferenceTiming) => void;

export function reportInferenceTiming(observer: InferenceTimingObserver | undefined, event: InferenceTiming): void {
  try { observer?.(event); }
  catch { /* Diagnostics cannot cancel, replace or expose a model response. */ }
}

/** Duration-only diagnostics. Observer failures must never change inference. */
export function inferenceTimer(observer?: InferenceTimingObserver) {
  const started = performance.now();
  const checkpoint = (phase: InferencePhase, phaseStarted = started) => {
    const now = performance.now();
    reportInferenceTiming(observer, { phase, durationMs: Math.max(0, Math.round(now - phaseStarted)), elapsedMs: Math.max(0, Math.round(now - started)) });
  };
  const measure = async function measure<T>(phase: InferencePhase, work: () => Promise<T>): Promise<T> {
    // Process initialization includes preparation before the initialize RPC.
    const phaseStarted = phase === 'startup' ? started : performance.now();
    try { return await work(); }
    finally {
      checkpoint(phase, phaseStarted);
    }
  };
  return Object.assign(measure, { checkpoint });
}
