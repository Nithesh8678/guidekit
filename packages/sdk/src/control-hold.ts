export interface HoldKeyEvent {
  key: string; isTrusted: boolean; repeat?: boolean; isComposing?: boolean;
  ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean;
}
export interface ControlHoldCallbacks { enabled(): boolean; start(): boolean; finish(): void; cancel(): void; }

/** Gesture state only: never prevents host shortcuts or reads page/input text. */
export class ControlHold {
  private pressed = false;
  private started = false;
  private destroyed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(private readonly callbacks: ControlHoldCallbacks, private readonly armMs = 120) {}
  keydown(event: HoldKeyEvent): void {
    if (this.destroyed || !event.isTrusted) return;
    if (event.isComposing || event.key !== 'Control' || event.metaKey || event.altKey || event.shiftKey) { this.cancel(); return; }
    if (this.pressed || event.repeat || !event.ctrlKey || !this.callbacks.enabled()) return;
    this.pressed = true;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.destroyed && this.pressed && this.callbacks.enabled()) this.started = this.callbacks.start();
    }, this.armMs);
  }
  keyup(event: HoldKeyEvent): void {
    if (this.destroyed || !event.isTrusted || event.key !== 'Control' || !this.pressed) return;
    this.clearTimer(); this.pressed = false;
    const started = this.started; this.started = false;
    if (started) this.callbacks.finish();
  }
  /** Control+wheel is a native zoom gesture, not a voice commitment. */
  wheel(event: { isTrusted: boolean }): void {
    if (!this.destroyed && event.isTrusted && this.pressed) this.cancel();
  }
  cancel(): void {
    this.clearTimer(); this.pressed = false;
    const started = this.started; this.started = false;
    if (started) this.callbacks.cancel();
  }
  destroy(): void { if (!this.destroyed) { this.cancel(); this.destroyed = true; } }
  private clearTimer(): void { if (this.timer) clearTimeout(this.timer); this.timer = null; }
}
