import type { AssistantMode } from '../../contracts/src/index';

export type SessionPhase = 'inactive' | 'observing' | 'starting' | 'listening' | 'finalizing' | 'reading' | 'thinking' | 'presenting' | 'paused' | 'error';
/** Controller-owned presentation state, separate from a model's private reasoning. */
export interface AssistantSessionState {
  active: boolean;
  mode: AssistantMode;
  phase: SessionPhase;
  observing: boolean;
}
export interface VisualPresentation { sceneId: string; renderer: 'webgl' | 'svg'; }
export interface VisualSelection { sceneId: string; selectedObjectId?: string; }
