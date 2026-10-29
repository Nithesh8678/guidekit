/** Playback events belong to one narration beat, never to request-start time. */
export interface SpeechEvents { onStart(): void; onEnd(): void; onError(): void; }
export type BeatRelease = 'speech' | 'text' | 'unavailable';

/** A single bounded beat. Superseded audio callbacks cannot release a later mark. */
export class BeatScheduler {
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  start(speak: (events: SpeechEvents) => boolean, release: (reason: BeatRelease) => void): void {
    this.cancel(); const generation = this.generation; let released = false;
    const finish = (reason: BeatRelease) => {
      if (generation !== this.generation || released) return;
      released = true; clearTimeout(this.timer); this.timer = undefined; release(reason);
    };
    let queued = false;
    try { queued = speak({ onStart: () => finish('speech'), onEnd: () => finish('unavailable'), onError: () => finish('unavailable') }); }
    catch { finish('unavailable'); }
    if (!queued) finish('text');
    else if (!released) this.timer = setTimeout(() => finish('unavailable'), 2500);
  }
  cancel(): void { ++this.generation; clearTimeout(this.timer); this.timer = undefined; }
}
