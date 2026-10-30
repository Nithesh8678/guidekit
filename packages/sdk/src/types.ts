import type { PageContext, PublicAgent, RunResult } from '../../contracts/src/index';

export interface ActionResult { success: boolean; message: string; }
/** Local host observation for a guided step. This does not authorize or execute an action. */
export type GuideStepResult =
  | { status: 'pending'; message?: string; /** Defaults to 120 seconds, maximum 300 seconds. */ timeoutMs?: number }
  | { success: boolean; message?: string; /** A verified intermediate operation may continue the same task. */ scope?: 'step' | 'goal' };
export interface GuideContextOptions { /** Explicit semantic workflow revision; never use input values or playback position. */ revision?: string | number; }
export interface RegisteredAction {
  description: string;
  inputSchema: Record<string, unknown>;
  requiresConfirmation: true;
  execute(arguments_: Record<string, unknown>, options: { signal: AbortSignal; idempotencyKey: string }): Promise<ActionResult>;
  validate?(arguments_: Record<string, unknown>): boolean;
  /** Defaults to 30 seconds; maximum 120 seconds. The host must honor signal. */
  timeoutMs?: number;
}
export interface VoiceOptions {
  /** Browser speech recognition is the default; requires HTTPS/localhost and permission. */
  provider?: 'browser' | 'disabled';
  /** Defaults to true: the keyboard shortcut starts/stops a voice question. */
  hotkeyStartsListening?: boolean;
  /** Defaults to true for shortcut/API voice; microphone dictation defaults to review. */
  autoSubmit?: boolean;
  /** Browser TTS preferences. These do not change speech recognition or enable the microphone. */
  output?: {
    voiceURI?: string;
    language?: string;
    /** Between 0.8 and 1.2; defaults to a relaxed 0.98. */
    rate?: number;
    /** Store only voice URI/language/rate on this origin. Defaults to true. */
    remember?: boolean;
  };
}
export interface MountOptions {
  agentId: string;
  endpoint: string;
  /** Explicit mode shares only host-authored data-guidekit-id controls. Defaults to auto. */
  targetMode?: 'auto' | 'explicit';
  actions?: Record<string, RegisteredAction>;
  /** Supply deliberately public, small application context. Never include secrets. */
  getContext?(): Record<string, unknown> | Promise<Record<string, unknown>>;
  hotkey?: string;
  voice?: VoiceOptions;
  /** Adaptive SPA/modal guidance is enabled by default. Session resume is off unless opted in. */
  journey?: { enabled?: boolean; resume?: 'disabled' | 'session'; /** Default 6, bounded to 1–24. */ maxContinuations?: number };
}
export interface GuideKitInstance {
  readonly ready: Promise<PublicAgent>;
  open(): void;
  close(): void;
  /** Call from a real user gesture. Starts voice input and enables browser spoken answers. */
  startVoice(): void;
  /** Commits the current recording; close/Escape/destroy instead discard it. */
  stopVoice(): void;
  reportStepResult(targetId: string, result: GuideStepResult): void;
  destroy(): void;
  registerAction(name: string, action: RegisteredAction): void;
  setContext(context: Record<string, unknown>, options?: GuideContextOptions): void;
  ask(message: string): Promise<RunResult | null>;
  getPageContext(): Promise<PageContext>;
}
export interface GuideKitAPI {
  readonly capabilities: Readonly<{ apiVersion: 1; explicitTargets: true; adaptiveJourneys: true; hostWorkflowProgress: true }>;
  mount(options: MountOptions): GuideKitInstance;
  registerAction(name: string, action: RegisteredAction): void;
  setContext(context: Record<string, unknown>, options?: GuideContextOptions): void;
  open(): void;
  close(): void;
  startVoice(): void;
  stopVoice(): void;
  reportStepResult(targetId: string, result: GuideStepResult): void;
  destroy(): void;
}
declare global { interface Window { GuideKit: GuideKitAPI; } }
