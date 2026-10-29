import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, CheckCircle2, Circle, Code2, Copy, ExternalLink, Eye, FolderOpen, MessageSquare, RefreshCw, ShieldCheck, Upload, X } from 'lucide-react';
import type { Agent } from '@guidekit/contracts';
import { api, date, errorMessage, Notice, Spinner, versionStatus, type PublicationResult, type PublicationVersion, type SetupDiagnostics, type VersionSnapshot } from './shared';

interface Props {
  agent: Agent; versions: PublicationVersion[]; dirty: boolean; busy: boolean;
  onBusyChange(busy: boolean): void; onChanged(message: string): Promise<void>; onError(message: string): void;
}
function origin(value: string): string {
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== value) throw new Error('The server returned an invalid installation origin. Check its configuration.');
  return parsed.origin;
}
export function Install({ agent, versions, dirty, busy, onBusyChange, onChanged, onError }: Props) {
  const [copied, setCopied] = useState(false), [copyError, setCopyError] = useState(''), [working, setWorking] = useState(''), [inspecting, setInspecting] = useState<number | null>(null);
  const [diagnostics, setDiagnostics] = useState<SetupDiagnostics | null>(null), [diagnosticError, setDiagnosticError] = useState(''), [checking, setChecking] = useState(false);
  const workingRef = useRef(false), diagnosticGeneration = useRef(0), copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const check = useCallback(async () => {
    const generation = ++diagnosticGeneration.current; setChecking(true); setDiagnosticError('');
    try {
      const data = await api<SetupDiagnostics>(`/api/agents/${agent.id}/diagnostics`);
      origin(data.endpointOrigin);
      if (data.demoOrigins) { origin(data.demoOrigins.crm); origin(data.demoOrigins.support); }
      if (generation === diagnosticGeneration.current) setDiagnostics(data);
    } catch (failure) { if (generation === diagnosticGeneration.current) { setDiagnostics(null); setDiagnosticError(errorMessage(failure)); } }
    finally { if (generation === diagnosticGeneration.current) setChecking(false); }
  }, [agent.id]);
  const readinessKey = versions.map(version => `${version.number}:${versionStatus(version)}`).join(',');
  // A changed publication needs fresh dependency and snapshot readiness checks.
  useEffect(() => { void check(); return () => { diagnosticGeneration.current++; }; }, [agent.publishedVersion, readinessKey, check]);
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);
  const endpoint = diagnostics?.endpointOrigin;
  const snippet = endpoint ? `<script\n  src="${endpoint}/sdk/guidekit.js"\n  data-agent-id="${agent.id}"\n  data-endpoint="${endpoint}"\n  data-voice-provider="browser"\n  defer\n></script>` : '';
  async function copy() {
    setCopyError(''); if (!snippet) return;
    try { await navigator.clipboard.writeText(snippet); setCopied(true); if (copyTimer.current) clearTimeout(copyTimer.current); copyTimer.current = setTimeout(() => setCopied(false), 2000); }
    catch { setCopyError('Clipboard access is unavailable. Select and copy the snippet below.'); }
  }
  async function mutate(kind: 'retry' | 'activate' | 'unpublish', version?: PublicationVersion) {
    if (busy || workingRef.current) return;
    if (kind === 'activate' && !window.confirm(`Activate version ${version!.number} for new website sessions? Its saved configuration and knowledge will be used. Your current draft stays unchanged.`)) return;
    if (kind === 'unpublish' && !window.confirm('Unpublish this agent and stop new website sessions? Existing sessions keep their pinned version. Your draft and saved versions remain available.')) return;
    workingRef.current = true; setWorking(`${kind}:${version?.number ?? ''}`); onBusyChange(true); onError('');
    try {
      const path = kind === 'unpublish' ? `/api/agents/${agent.id}/unpublish` : `/api/agents/${agent.id}/versions/${version!.number}/${kind}`;
      const data = await api<PublicationResult>(path, { method: 'POST', body: '{}' });
      if (kind === 'retry' && versionStatus(data.version) === 'failed') {
        await onChanged(`Version ${data.version.number} remains unavailable. The active publication was preserved.`);
        onError(data.version.error || 'Knowledge synchronization did not complete. Check setup diagnostics and retry this version.');
      } else await onChanged(kind === 'unpublish' ? 'Agent unpublished. New website sessions are stopped; existing sessions keep their pinned version.' : kind === 'activate' ? `Version ${version!.number} activated for new website sessions. Your draft is unchanged.` : data.activeVersion === data.version.number ? `Version ${data.version.number} is ready and active for new website sessions.` : `Version ${data.version.number} is ready. Activate it when you want new website sessions to use it.`);
      await check();
    } catch (failure) { onError(errorMessage(failure)); }
    finally { workingRef.current = false; setWorking(''); onBusyChange(false); }
  }
  const demos = diagnostics?.demoOrigins ? [{ name: 'Contact CRM', description: 'Create contacts and update their status.', kind: 'crm' as const, origin: diagnostics.demoOrigins.crm }, { name: 'Support desk', description: 'Browse help and create a support ticket.', kind: 'support' as const, origin: diagnostics.demoOrigins.support }] : [];
  return <div className="install-layout">
    <div className="section-intro"><h2>One SDK. Your company's guide.</h2><p>Add the script to your website. The agent ID connects it to this agent's active, ready publication.</p></div>
    {!agent.publishedVersion && <Notice kind="info">Publish a ready version, or activate a saved ready version, before starting new website sessions.</Notice>}
    {dirty && <Notice kind="info">You have unsaved changes. Website sessions use the active saved version; your draft stays unchanged.</Notice>}
    <div className="install-status"><span className={`status-symbol ${agent.publishedVersion ? 'published' : ''}`}>{agent.publishedVersion ? <Check size={18} /> : <Circle size={18} />}</span><div><strong>{agent.publishedVersion ? `Active version ${agent.publishedVersion}` : 'No active publication'}</strong><p>{agent.publishedVersion ? 'New visitor sessions receive this ready snapshot.' : 'Preparing or failed candidates do not replace a working publication.'}</p></div>{agent.publishedVersion && <button className="button secondary small" disabled={busy} onClick={() => void mutate('unpublish')}>{working === 'unpublish:' ? <Spinner /> : null}Unpublish agent</button>}</div>
    <section className="setup-diagnostics" aria-labelledby="setup-diagnostics-title" aria-busy={checking}>
      <div className="activity-heading"><div className="section-intro"><h2 id="setup-diagnostics-title">Setup diagnostics</h2><p>Check the runtime, website permissions, knowledge and publication before trying the assistant. This check does not generate a model answer.</p></div><button className="button secondary small" disabled={checking || busy} onClick={() => void check()}>{checking ? <Spinner /> : <RefreshCw size={15} />}Check setup</button></div>
      {diagnosticError && <Notice>{diagnosticError}</Notice>}
      {!diagnostics && !diagnosticError && <p className="muted"><Spinner /> Checking your setup…</p>}
      {diagnostics && <><p className={`diagnostic-summary ${diagnostics.ready ? 'ready' : ''}`} role="status">{diagnostics.ready ? <CheckCircle2 size={17} /> : <AlertCircle size={17} />}{diagnostics.ready ? 'Setup checks passed. Test a question on your website to verify the full outcome.' : 'Review the checks below before opening a new website session.'}</p><ul className="diagnostic-checks">{diagnostics.checks.map(check => <li key={check.id} data-check-id={check.id}><span className={`badge ${check.status === 'pass' ? 'badge-green' : check.status === 'error' ? 'badge-red' : 'badge-neutral'}`}>{check.status === 'pass' ? 'Passed' : check.status === 'error' ? 'Needs attention' : 'Review'}</span><p>{check.message}</p></li>)}</ul></>}
    </section>
    {endpoint && <div className="code-block"><div><span><Code2 size={16} /> Website installation</span><button className="copy-button" onClick={() => void copy()}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? 'Copied' : 'Copy snippet'}</button></div><pre tabIndex={0}><code>{snippet}</code></pre></div>}
    {copyError && <Notice>{copyError}</Notice>}
    <div className="install-details"><div><strong>Agent ID</strong><code>{agent.id}</code></div><div><strong>Draft allowed origins</strong>{agent.allowedOrigins.map(value => <code key={value}>{value}</code>)}</div>{endpoint && <div><strong>Server endpoint</strong><code>{endpoint}</code></div>}</div>
    {!!demos.length && <><div className="section-intro section-divider"><h2>Try it on a real page</h2><p>Use either independent demo website with this same agent. Add the matching knowledge, origin and permitted actions first.</p></div><div className="demo-links">{demos.map(demo => <a key={demo.kind} className={`demo-link ${!agent.publishedVersion ? 'disabled-link' : ''}`} href={`${demo.origin}/?agentId=${encodeURIComponent(agent.id)}`} target="_blank" rel="noreferrer" aria-disabled={!agent.publishedVersion} onClick={event => { if (!agent.publishedVersion) event.preventDefault(); }}><span className="demo-link-icon">{demo.kind === 'crm' ? <FolderOpen size={23} /> : <MessageSquare size={23} />}</span><span><strong>Open {demo.name}</strong><small>{demo.description}</small></span><ExternalLink size={17} /></a>)}</div></>}
    <div className="integration-note"><ShieldCheck size={21} /><div><h3>Connect actions intentionally</h3><p>The script enables questions and visual guidance. Your application registers allowlisted actions, validates inputs and permissions, and reports the actual outcome. A visitor must confirm each change.</p><p>For a manual form workflow, call <code>GuideKit.reportStepResult(targetId, {'{ success, message }'})</code> after your website verifies its save. Clicking a submit button alone never confirms the outcome.</p><p>Use desktop Chrome or Edge for browser voice. Press ⌘⇧K on Mac or Ctrl+Shift+K on Windows to start listening; press it again to finish and send. Escape discards the recording. Voice recognition may send audio to your browser vendor; GuideKit does not store audio.</p>{diagnostics?.demoOrigins && <p><a href={`${diagnostics.demoOrigins.crm}/?install=manual`} target="_blank" rel="noreferrer">Open the SDK installation lab</a> to install, remove and reinstall the assistant on the CRM yourself.</p>}</div></div>
    <section className="publication-section" aria-labelledby="publications-title"><div className="section-intro section-divider"><h2 id="publications-title">Publication versions</h2><p>Each candidate preserves its configuration and knowledge. Only a ready snapshot can become active.</p></div>
      {versions.length ? <div className="publication-list">{versions.map(version => {
        const status = versionStatus(version), active = version.number === agent.publishedVersion;
        return <article className="publication-item" key={version.number} aria-label={`Version ${version.number}`}><div className="publication-summary"><span className="version-number">v{version.number}</span><div><strong>{active ? 'Active publication' : status === 'ready' ? 'Ready snapshot' : status === 'failed' ? 'Publication needs attention' : 'Preparing publication'}</strong><small>{date(version.createdAt)} · {version.documentCount} {version.documentCount === 1 ? 'document' : 'documents'}{version.graphSource ? ` · ${version.graphSource === 'tigergraph' ? 'TigerGraph' : 'Local knowledge'}` : ''}</small></div><span className={`badge ${status === 'ready' ? 'badge-green' : status === 'failed' ? 'badge-red' : 'badge-neutral'}`}>{status === 'syncing' ? 'Syncing knowledge' : status.charAt(0).toUpperCase() + status.slice(1)}</span></div>{version.error && <p className="publication-error" role="status">{version.error}</p>}<div className="publication-actions"><button className="button secondary small" disabled={busy} aria-label={`Inspect version ${version.number}`} onClick={() => setInspecting(version.number)}><Eye size={14} />Inspect</button>{status === 'failed' && <button className="button secondary small" disabled={busy} aria-label={`Retry version ${version.number}`} onClick={() => void mutate('retry', version)}>{working === `retry:${version.number}` ? <Spinner /> : <RefreshCw size={14} />}Retry preparation</button>}{status === 'ready' && !active && <button className="button secondary small" disabled={busy} aria-label={`Activate version ${version.number}`} onClick={() => void mutate('activate', version)}>{working === `activate:${version.number}` ? <Spinner /> : <Upload size={14} />}Activate version</button>}</div></article>;
      })}</div> : <p className="muted">No versions created yet. Save your knowledge, then publish from the top of this page.</p>}
    </section>
    {inspecting !== null && <SnapshotDialog agentId={agent.id} number={inspecting} onClose={() => setInspecting(null)} />}
  </div>;
}

function SnapshotDialog({ agentId, number, onClose }: { agentId: string; number: number; onClose(): void }) {
  const dialogRef = useRef<HTMLDialogElement>(null), [snapshot, setSnapshot] = useState<VersionSnapshot | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const previous = document.activeElement, dialog = dialogRef.current; dialog?.showModal();
    return () => { dialog?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    api<VersionSnapshot>(`/api/agents/${agentId}/versions/${number}`, { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setSnapshot(value); }).catch(failure => { if (!controller.signal.aborted) setError(errorMessage(failure)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [agentId, number, attempt]);
  return <dialog ref={dialogRef} className="create-dialog snapshot-dialog" aria-labelledby="snapshot-title" onCancel={event => { event.preventDefault(); onClose(); }}><div className="snapshot-heading"><h2 id="snapshot-title">Version {number} snapshot</h2><button className="icon-button" aria-label="Close version snapshot" onClick={onClose}><X size={20} /></button></div><p className="muted">Read-only saved configuration and source text. Your draft is unchanged.</p>{loading && <p role="status"><Spinner /> Loading snapshot…</p>}{error && <Notice>{error} <button className="text-button" onClick={() => setAttempt(value => value + 1)}>Retry loading snapshot</button></Notice>}{snapshot && !loading && <><dl className="snapshot-settings"><div><dt>Agent</dt><dd>{snapshot.config.name}</dd></div><div><dt>Company</dt><dd>{snapshot.config.companyName}</dd></div><div><dt>Status</dt><dd>{versionStatus(snapshot.version)}</dd></div><div><dt>Created</dt><dd>{date(snapshot.version.createdAt)}</dd></div><div><dt>Allowed origins</dt><dd>{snapshot.config.allowedOrigins.join(', ')}</dd></div><div><dt>Allowed actions</dt><dd>{snapshot.config.allowedActions.join(', ') || 'None'}</dd></div></dl><details><summary>Saved instructions and greeting</summary><pre className="document-preview">{snapshot.config.description}{'\n\n'}{snapshot.config.greeting}{'\n\n'}{snapshot.config.instructions}</pre></details><h3>Knowledge documents ({snapshot.documents.length})</h3><div className="snapshot-documents">{snapshot.documents.map(document => <details key={document.id}><summary>{document.title}</summary><pre className="document-preview">{document.content}</pre></details>)}</div></>}<div className="dialog-actions"><button className="button secondary" onClick={onClose}>Close snapshot</button></div></dialog>;
}
