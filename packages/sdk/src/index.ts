import { Assistant } from './controller';
import { compileAction, safeContext } from './security';
import type { GuideKitAPI, GuideKitInstance, MountOptions, RegisteredAction } from './types';
export type { ActionResult, GuideKitAPI, GuideKitInstance, GuideStepResult, MountOptions, RegisteredAction, VoiceOptions } from './types';

let instance: GuideKitInstance | null = null;
const registered = new Map<string, RegisteredAction>();
let context: Record<string, unknown> = {};

export function mount(options: MountOptions): GuideKitInstance {
  if (!document.body) throw new Error('Mount GuideKit after the document body exists, or use a defer script.');
  const actions = Object.fromEntries(registered);
  // Construct and validate the replacement before tearing down a working assistant.
  const next = new Assistant({ ...options, actions: { ...actions, ...options.actions } });
  instance?.destroy(); instance = next; next.setContext(context); return next;
}
export function registerAction(name: string, action: RegisteredAction): void {
  compileAction(name, action);
  if (!registered.has(name) && registered.size >= 30) throw new Error('Register at most 30 GuideKit actions.');
  instance?.registerAction(name, action); registered.set(name, action);
}
export function setContext(value: Record<string, unknown>): void { context = safeContext(value); instance?.setContext(context); }
export function open(): void { instance?.open(); }
export function close(): void { instance?.close(); }
export function startVoice(): void { instance?.startVoice(); }
export function stopVoice(): void { instance?.stopVoice(); }
export function reportStepResult(targetId: string, result: import('./types').GuideStepResult): void { instance?.reportStepResult(targetId, result); }
export function destroy(): void { instance?.destroy(); instance = null; }

export const GuideKit: GuideKitAPI = { mount, registerAction, setContext, open, close, startVoice, stopVoice, reportStepResult, destroy };

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const script = document.currentScript instanceof HTMLScriptElement ? document.currentScript : null;
  const agentId = script?.dataset.agentId;
  const endpoint = script?.dataset.endpoint ?? (script?.src ? new URL(script.src).origin : undefined);
  window.GuideKit = GuideKit;
  document.dispatchEvent(new CustomEvent('guidekit:ready', { detail: { api: GuideKit } }));
  if (agentId && endpoint) {
    const start = () => {
      try {
        const provider = script?.dataset.voiceProvider;
        if (provider && !['browser', 'disabled'].includes(provider)) throw new Error('GuideKit data-voice-provider must be browser or disabled.');
        mount({ agentId, endpoint, ...(script?.dataset.hotkey ? { hotkey: script.dataset.hotkey } : {}), voice: {
          ...(provider ? { provider: provider as 'browser' | 'disabled' } : {}),
          ...(script?.dataset.voiceHotkey ? { hotkeyStartsListening: script.dataset.voiceHotkey !== 'false' } : {}),
          ...(script?.dataset.voiceAutoSubmit ? { autoSubmit: script.dataset.voiceAutoSubmit !== 'false' } : {})
        } });
      }
      catch (error) { document.dispatchEvent(new CustomEvent('guidekit:error', { detail: { message: error instanceof Error ? error.message : 'GuideKit could not start.' } })); }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
  }
}
