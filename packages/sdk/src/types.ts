import type { PageContext, PublicAgent, RunResult } from '../../contracts/src/index';

export interface ActionResult { success: boolean; message: string; }
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
}
export interface MountOptions {
  agentId: string;
  endpoint: string;
  actions?: Record<string, RegisteredAction>;
  /** Supply deliberately public, small application context. Never include secrets. */
  getContext?(): Record<string, unknown> | Promise<Record<string, unknown>>;
  hotkey?: string;
  voice?: VoiceOptions;
}
export interface GuideKitInstance {
  readonly ready: Promise<PublicAgent>;
  open(): void;
  close(): void;
  /** Call from a real user gesture. Starts voice input and enables browser spoken answers. */
  startVoice(): void;
  /** Commits the current recording; close/Escape/destroy instead discard it. */
  stopVoice(): void;
  destroy(): void;
  registerAction(name: string, action: RegisteredAction): void;
  setContext(context: Record<string, unknown>): void;
  ask(message: string): Promise<RunResult | null>;
  getPageContext(): Promise<PageContext>;
}
export interface GuideKitAPI {
  mount(options: MountOptions): GuideKitInstance;
  registerAction(name: string, action: RegisteredAction): void;
  setContext(context: Record<string, unknown>): void;
  open(): void;
  close(): void;
  startVoice(): void;
  stopVoice(): void;
  destroy(): void;
}
declare global { interface Window { GuideKit: GuideKitAPI; } }
