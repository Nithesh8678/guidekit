export type InferencePhase = 'startup' | 'restrictions' | 'authentication' | 'catalog' | 'thread' | 'inference' | 'cleanup';
export interface InferenceTiming { phase: InferencePhase; durationMs: number; elapsedMs: number; }
export type InferenceTimingObserver = (event: InferenceTiming) => void;

/** Duration-only diagnostics. Observer failures must never change inference. */
export function inferenceTimer(observer?: InferenceTimingObserver) {
  const started = performance.now();
  return async function measure<T>(phase: InferencePhase, work: () => Promise<T>): Promise<T> {
    // Process initialization includes preparation before the initialize RPC.
    const phaseStarted = phase === 'startup' ? started : performance.now();
    try { return await work(); }
    finally {
      const now = performance.now();
      try { observer?.({ phase, durationMs: Math.max(0, Math.round(now - phaseStarted)), elapsedMs: Math.max(0, Math.round(now - started)) }); }
      catch { /* Diagnostics cannot cancel, replace or expose a model response. */ }
    }
  };
}
