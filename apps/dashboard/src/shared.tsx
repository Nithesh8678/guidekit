import type { ReactNode } from 'react';
import { Layers3, Loader2 } from 'lucide-react';
import type { AgentConfig, AgentDetail, KnowledgeDocument } from '@guidekit/contracts';

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...options, credentials: 'include', headers: { 'Content-Type': 'application/json', ...options.headers } });
  const body = await response.json().catch(() => null) as T & { error?: string };
  if (!response.ok) throw new Error(body?.error || `Request failed (${response.status}). Try again.`);
  return body;
}
export function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'Something went wrong. Please try again.'; }
export function date(value: string) { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
export function Spinner() { return <Loader2 size={16} className="spin" aria-hidden="true" />; }
export function Notice({ children, kind = 'error' }: { children: ReactNode; kind?: 'error' | 'success' | 'info' }) { return <div className={`notice notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>; }
export function Brand({ light = false }: { light?: boolean }) { return <div className={`brand ${light ? 'brand-light' : ''}`}><span className="brand-mark"><Layers3 size={22} strokeWidth={2.2} /></span><span>GuideKit</span></div>; }
export function DeliveryNotice({ generic = false }: { generic?: boolean }) { return <Notice kind="info">{generic ? 'If the account exists, its link uses this instance’s private account outbox. No email is sent by this local delivery mode.' : 'No email was sent. A link was queued in this instance’s private account outbox. Ask the local operator to deliver it securely.'} Links expire and work once.</Notice>; }

export type PublicationStatus = 'preparing' | 'syncing' | 'ready' | 'failed';
// Missing lifecycle fields are accepted for snapshots created before readiness tracking.
export type PublicationVersion = AgentDetail['versions'][number] & { status?: PublicationStatus; graphSource?: 'local' | 'tigergraph'; error?: string; completedAt?: string };
export type DashboardDetail = Omit<AgentDetail, 'versions'> & { versions: PublicationVersion[] };
export interface PublicationResult { version: PublicationVersion; activeVersion: number | null; }
export interface VersionSnapshot { version: PublicationVersion; config: AgentConfig; documents: KnowledgeDocument[]; }
export interface SetupDiagnostics { endpointOrigin: string; demoOrigins?: { crm: string; support: string }; ready: boolean; checks: { id: string; status: 'pass' | 'warning' | 'error'; message: string }[]; }
export interface DocumentDraft { id: string | null; title: string; content: string; }
export const emptyDocumentDraft = (): DocumentDraft => ({ id: null, title: '', content: '' });
export const versionStatus = (version: PublicationVersion): PublicationStatus => version.status ?? 'ready';
