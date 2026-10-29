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
export interface MountOptions {
  agentId: string;
  endpoint: string;
  actions?: Record<string, RegisteredAction>;
  /** Supply deliberately public, small application context. Never include secrets. */
  getContext?(): Record<string, unknown> | Promise<Record<string, unknown>>;
  hotkey?: string;
}
export interface GuideKitInstance {
  readonly ready: Promise<PublicAgent>;
  open(): void;
  close(): void;
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
  destroy(): void;
}
declare global { interface Window { GuideKit: GuideKitAPI; } }
