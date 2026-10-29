import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowRight, BookOpen, CheckCircle2, ChevronDown, Code2, FolderOpen, Layers3, LogOut, MessageSquare, Plus, Radio, RefreshCw, Save, Settings2, ShieldCheck, Sparkles, Upload, X } from 'lucide-react';
import type { Agent, AgentConfig, AgentDetail, RuntimeStatus, Workspace } from '@guidekit/contracts';
import { Knowledge } from './Knowledge';
import { Install } from './Install';
import { Auth } from './Auth';
import { AccountPanel } from './Account';
import { AccountLinkFlow, clearAccountLink, readAccountLink } from './AccountLink';
import { api, Brand, date, emptyDocumentDraft, errorMessage, Notice, Spinner, versionStatus, type DashboardDetail, type DocumentDraft, type PublicationResult } from './shared';

type Tab = 'setup' | 'knowledge' | 'install' | 'activity';
const DEMO_ORIGINS = ['http://127.0.0.1:4411', 'http://127.0.0.1:4412'];
const CRM_DOCUMENT = `Northstar CRM product guide\n\nThis independent CRM demonstration manages contacts stored in this browser. The Contacts page shows a New contact form with Full name, Company, and Status fields, then a Create contact button. Status values are exactly New, Qualified, and Customer. The optional Email field is private, is not provided to the agent, and is not stored by the demo's contact action. Do not ask for or claim to save an email address.\n\nTo explain contact creation, guide the visitor to Full name (contact-name), Company (contact-company), Status (contact-status), and Create contact (create-contact). Search contacts by name or company using contact-search. Use current page targets rather than assuming a control is visible.\n\nRegistered capabilities:\n- create_contact requires name, company, and status. Name and company must each be 1–100 characters. Status must be New, Qualified, or Customer. If no status was requested, propose New and show it in the confirmation. Ask for any missing name or company.\n- update_contact_status requires id and status. Obtain the existing contact's id from the current page context records; never invent an ID. Status must be New, Qualified, or Customer. The visible Qualify button sets a contact to Qualified.\n\nAlways ask the visitor to confirm an action before changing data. The host validates arguments, protects against duplicate contact creation, stores the result locally, and verifies persistence. Never claim success before receiving the host result. This demo is not connected to an external CRM.`;
const SUPPORT_DOCUMENT = `Fieldnotes Help Desk product guide\n\nThis independent support demonstration contains Help center topics, an Ask our team form, and Your requests. The form has Subject (ticket-subject), Details (ticket-description), Priority (ticket-priority), and Send request (create-ticket). Priority values are exactly Normal and High. There is no email field. Requests are stored in this browser; sending a request does not email or contact a support team.\n\nThe Help center includes three visible topics:\n- Where can I find my invoices? (help-billing): the article says to open Workspace settings, choose Billing, then Invoices; only workspace owners manage billing. These settings are explanatory content and are not implemented controls on this demo page.\n- How do I invite a teammate? (help-invites): the article describes Workspace settings, Members, and Invite member. These settings are not implemented controls on this demo page.\n- How do I get in touch? (help-support): use the Ask our team form on this page and include a short subject and details.\n\nRegistered capability:\n- create_ticket requires subject, description, and priority. Subject must be 1–160 characters; description must be 1–3000 characters; priority must be Normal or High. If no priority was requested, propose Normal and include it in the confirmation. Ask for missing subject or details.\n\nUse current page targets for visual guidance. Ask the visitor to confirm before creating a request. The host validates and verifies the browser-persisted record, returning an FN- request number. Never claim a request was saved before the host reports success, and never claim an external email was sent.`;

function configOf(agent: Agent): AgentConfig {
  return { name: agent.name, companyName: agent.companyName, description: agent.description, instructions: agent.instructions, greeting: agent.greeting, accentColor: agent.accentColor, allowedOrigins: agent.allowedOrigins, allowedActions: agent.allowedActions };
}
function initialConfig(companyName: string): AgentConfig {
  return { name: '', companyName, description: '', instructions: 'Be concise, helpful, and grounded in the company knowledge. Use the live page context for guidance. Ask for missing information and confirm before changing anything.', greeting: 'What would you like to do?', accentColor: '#365cf5', allowedOrigins: DEMO_ORIGINS, allowedActions: [] };
}
function Empty({ icon, title, children, action }: { icon: ReactNode; title: string; children: ReactNode; action?: ReactNode }) { return <div className="empty-state"><div className="empty-icon">{icon}</div><h3>{title}</h3><p>{children}</p>{action}</div>; }

export function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [checking, setChecking] = useState(true);
  const [startupError, setStartupError] = useState('');
  const [accountLink, setAccountLink] = useState(readAccountLink), [accountMessage, setAccountMessage] = useState('');
  useEffect(() => { const changed = () => setAccountLink(readAccountLink()); window.addEventListener('hashchange', changed); return () => window.removeEventListener('hashchange', changed); }, []);
  const checkAuth = useCallback(async () => {
    setChecking(true); setStartupError('');
    try { const result = await api<{ workspace: Workspace | null }>('/api/auth/me'); setWorkspace(result.workspace); }
    catch (error) { setStartupError(errorMessage(error)); }
    finally { setChecking(false); }
  }, []);
  useEffect(() => { void checkAuth(); }, [checkAuth]);
  if (checking) return <div className="app-loading"><Brand /><Spinner /><p>Opening your workspace…</p></div>;
  if (startupError) return <div className="app-loading"><Brand /><Notice>{startupError}</Notice><button className="button primary" onClick={() => void checkAuth()}><RefreshCw size={16} /> Retry connection</button><p>Start the GuideKit server, then retry.</p></div>;
  return <>{workspace ? <Dashboard key={`${workspace.user.id}:${workspace.tenant.id}`} workspace={workspace} onWorkspaceChange={setWorkspace} notice={accountMessage} onDismissNotice={() => setAccountMessage('')} onLogout={() => setWorkspace(null)} /> : <Auth key={accountMessage ? 'account-result' : 'access'} onAuthenticated={setWorkspace} initialMode={accountMessage ? 'login' : 'register'} message={accountMessage} />}{accountLink && <AccountLinkFlow key={`${accountLink.kind}:${accountLink.token}`} link={accountLink} workspace={workspace} onAuthenticated={setWorkspace} onClose={() => { clearAccountLink(); setAccountLink(null); }} onComplete={(message, value) => { clearAccountLink(); setAccountLink(null); setAccountMessage(message); if (value !== undefined) setWorkspace(value); else void api<{ workspace: Workspace | null }>('/api/auth/me').then(result => setWorkspace(result.workspace)).catch(() => setAccountMessage(`${message} Refresh to update account status.`)); }} />}</>;
}

function Dashboard({ workspace, onLogout, onWorkspaceChange, notice, onDismissNotice }: { workspace: Workspace; onLogout: () => void; onWorkspaceChange(workspace: Workspace): void; notice: string; onDismissNotice(): void }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<DashboardDetail | null>(null);
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [origins, setOrigins] = useState('');
  const [actions, setActions] = useState('');
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [tab, setTab] = useState<Tab>('setup');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState('');
  const [knowledgeBusy, setKnowledgeBusy] = useState(false);
  const [publicationBusy, setPublicationBusy] = useState(false);
  const [documentDraft, setDocumentDraft] = useState<DocumentDraft>(emptyDocumentDraft);
  const [createOpen, setCreateOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [runtimeError, setRuntimeError] = useState('');
  const [runtimeBusy, setRuntimeBusy] = useState(false);
  const [listError, setListError] = useState('');
  const selectionRef = useRef<string | null>(null);
  const normalizedConfig = config ? { ...config, allowedOrigins: origins.split(/\n|,/).map(value => value.trim()).filter(Boolean), allowedActions: actions.split(/\n|,/).map(value => value.trim()).filter(Boolean) } : null;
  const dirty = !!(detail && normalizedConfig && JSON.stringify(normalizedConfig) !== JSON.stringify(configOf(detail.agent)));
  const editingDocument = detail?.documents.find(document => document.id === documentDraft.id);
  const knowledgeDirty = documentDraft.id !== null ? !editingDocument || documentDraft.title !== editingDocument.title || documentDraft.content !== editingDocument.content : !!documentDraft.title || !!documentDraft.content;
  const hasUnsavedChanges = dirty || knowledgeDirty;
  const mutationBusy = !!busy || knowledgeBusy || publicationBusy;
  const pendingPublication = detail?.versions.some(version => ['preparing', 'syncing'].includes(versionStatus(version))) ?? false;
  const readOnly = workspace.role === 'viewer';

  const loadAgents = useCallback(async () => {
    setListError(''); setLoadingAgents(true);
    try { const result = await api<{ agents: Agent[] }>('/api/agents'); setAgents(result.agents); setSelected(current => current ?? result.agents[0]?.id ?? null); }
    catch (failure) { setListError(errorMessage(failure)); }
    finally { setLoadingAgents(false); }
  }, []);
  const loadDetail = useCallback(async (id: string, showLoading = true, preserveDraft = false) => {
    if (showLoading) setLoadingDetail(true);
    try {
      const result = await api<DashboardDetail>(`/api/agents/${id}`);
      if (selectionRef.current !== id) return;
      setDetail(result);
      if (!preserveDraft) { setConfig(configOf(result.agent)); setOrigins(result.agent.allowedOrigins.join('\n')); setActions(result.agent.allowedActions.join('\n')); }
    } catch (failure) { if (selectionRef.current === id) setError(errorMessage(failure)); }
    finally { if (selectionRef.current === id) setLoadingDetail(false); }
  }, []);
  const loadRuntime = useCallback(async () => {
    setRuntimeBusy(true); setRuntimeError('');
    try { setRuntime(await api<RuntimeStatus>('/api/runtime/status')); }
    catch (failure) { setRuntimeError(errorMessage(failure)); }
    finally { setRuntimeBusy(false); }
  }, []);
  useEffect(() => { void loadAgents(); void loadRuntime(); }, [loadAgents, loadRuntime]);
  useEffect(() => {
    selectionRef.current = selected; setDetail(null); setConfig(null); setDocumentDraft(emptyDocumentDraft()); setError(''); setSuccess('');
    if (selected) void loadDetail(selected);
  }, [selected, loadDetail]);
  useEffect(() => {
    if (!hasUnsavedChanges && !mutationBusy) return;
    const handleUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, [hasUnsavedChanges, mutationBusy]);
  useEffect(() => {
    if (!selected || !pendingPublication || mutationBusy) return;
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void loadDetail(selected, false, true); }, 2000);
    return () => clearInterval(timer);
  }, [selected, pendingPublication, mutationBusy, loadDetail]);

  function chooseAgent(id: string) {
    if (mutationBusy) return;
    if (id === selected) return;
    if (hasUnsavedChanges && !window.confirm('Discard unsaved changes and open another agent?')) return;
    setSelected(id); setTab('setup');
  }
  function beginCreate() {
    if (readOnly || mutationBusy || (hasUnsavedChanges && !window.confirm('Create another agent and leave this draft? Unsaved changes will be discarded if creation succeeds.'))) return;
    setCreateOpen(true);
  }
  function patch<K extends keyof AgentConfig>(key: K, value: AgentConfig[K]) { setConfig(current => current ? { ...current, [key]: value } : null); setSuccess(''); }
  function validateConfig(): AgentConfig {
    if (!normalizedConfig) throw new Error('Choose an agent first.');
    if (normalizedConfig.name.trim().length < 2 || normalizedConfig.companyName.trim().length < 2) throw new Error('Agent name and company name need at least 2 characters.');
    if (!normalizedConfig.allowedOrigins.length || normalizedConfig.allowedOrigins.length > 12) throw new Error('Add between 1 and 12 allowed website origins.');
    for (const origin of normalizedConfig.allowedOrigins) {
      let valid = false; try { const url = new URL(origin); valid = ['http:', 'https:'].includes(url.protocol) && url.origin === origin; } catch { /* Field error below. */ }
      if (!valid) throw new Error(`Use an exact origin without a trailing slash or path: ${origin}`);
    }
    if (normalizedConfig.allowedActions.length > 30 || normalizedConfig.allowedActions.some(action => !/^[a-zA-Z0-9_-]{1,160}$/.test(action))) throw new Error('Use up to 30 action IDs containing only letters, numbers, underscores, or hyphens.');
    return { ...normalizedConfig, allowedOrigins: [...new Set(normalizedConfig.allowedOrigins)], allowedActions: [...new Set(normalizedConfig.allowedActions)] };
  }
  async function save(publish = false) {
    if (!selected || mutationBusy || readOnly) return;
    if (publish && knowledgeDirty) { setError('Save or clear your unsaved document changes before publishing.'); setTab('knowledge'); return; }
    setError(''); setSuccess(''); setBusy(publish ? 'publish' : 'save');
    try {
      const valid = validateConfig();
      await api(`/api/agents/${selected}`, { method: 'PUT', body: JSON.stringify(valid) });
      const publication = publish ? await api<PublicationResult>(`/api/agents/${selected}/publish`, { method: 'POST', body: '{}' }) : null;
      await loadDetail(selected, false); await loadAgents();
      if (publication && versionStatus(publication.version) === 'failed') { setTab('install'); setError(`Version ${publication.version.number} could not become ready. ${publication.version.error || 'Check setup diagnostics and retry this saved version.'} ${publication.activeVersion ? `Version ${publication.activeVersion} remains active.` : 'No version is active yet.'}`); }
      else setSuccess(publication ? publication.activeVersion === publication.version.number ? `Version ${publication.version.number} is ready and active for new website sessions.` : `Version ${publication.version.number} is ${versionStatus(publication.version)}. Check its status in Install.` : 'Draft saved. Publish when you want these changes on your websites.');
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(''); }
  }
  async function logout() {
    if (mutationBusy) return;
    if (hasUnsavedChanges && !window.confirm('Discard unsaved changes and sign out?')) return;
    setBusy('logout'); setError('');
    try { await api('/api/auth/logout', { method: 'POST', body: '{}' }); onLogout(); }
    catch (failure) { setError(errorMessage(failure)); setBusy(''); }
  }
  async function refreshSelected() {
    if (!selected || mutationBusy) return;
    setError(''); await loadDetail(selected, false, true);
  }
  return <div className="dashboard-layout">
    <a className="skip-link" href="#main-content">Skip to agent editor</a>
    <aside className="sidebar"><Brand light /><div className="workspace-label"><span className="workspace-avatar">{workspace.tenant.name.slice(0, 1).toUpperCase()}</span><div><strong>{workspace.tenant.name}</strong><small>Developer workspace</small></div></div>
      <div className="sidebar-section-title"><span>Your agents</span><button className="icon-button" aria-label="Create agent" disabled={mutationBusy || readOnly} onClick={beginCreate}><Plus size={18} /></button></div>
      <nav className="agent-nav" aria-label="Agents">{loadingAgents && !agents.length ? <p className="sidebar-hint"><Spinner /> Loading agents…</p> : agents.map(agent => <button className={`agent-nav-item ${selected === agent.id ? 'selected' : ''}`} key={agent.id} disabled={mutationBusy} onClick={() => chooseAgent(agent.id)} aria-current={selected === agent.id ? 'page' : undefined}><span className="agent-nav-orb" style={{ background: agent.accentColor }}><Sparkles size={15} /></span><span>{agent.name}<small>{agent.publishedVersion ? `Published v${agent.publishedVersion}` : 'Draft'}</small></span>{selected === agent.id && <ChevronDown size={13} />}</button>)}{!loadingAgents && !agents.length && <p className="sidebar-hint">Your first agent starts here.</p>}</nav>
      <button className="new-agent-button" disabled={mutationBusy || readOnly} onClick={beginCreate}><Plus size={16} /> New agent</button>
      <div className="sidebar-bottom"><div className="runtime-label"><Radio size={16} /><strong>Model runtime</strong><button className="icon-button" aria-label="Refresh runtime status" disabled={runtimeBusy} onClick={() => void loadRuntime()}>{runtimeBusy ? <Spinner /> : <RefreshCw size={14} />}</button></div><span className={`runtime-state ${runtime?.available && runtime.authenticated ? 'ready' : ''}`}><span />{runtimeError ? 'Connection unavailable' : !runtime ? 'Checking connection' : runtime.authenticated ? `${runtime.provider === 'openai' ? 'OpenAI API' : 'ChatGPT'} connected` : runtime.available ? runtime.provider === 'openai' ? 'API configuration required' : 'Sign-in required' : `${runtime.provider === 'openai' ? 'OpenAI API' : 'Codex'} unavailable`}</span><p>{runtimeError || runtime?.message || 'Checking the configured model runtime.'}</p><button className="sidebar-user" onClick={() => void logout()} disabled={mutationBusy}><span><strong>{workspace.user.name}</strong><small>{workspace.user.email}</small></span>{busy === 'logout' ? <Spinner /> : <LogOut size={17} />}<span className="sr-only">Sign out</span></button></div>
    </aside>
    <main className="main-workspace" id="main-content"><header className="workspace-topbar"><span><FolderOpen size={16} /> Workspace <span className="breadcrumb-divider">/</span> <strong>{detail?.agent.name || 'Agents'}</strong></span><div className="topbar-actions"><button className="button secondary small" disabled={mutationBusy} onClick={() => setAccountOpen(true)}>Account & team</button><span className="local-badge"><span /> Local development</span><button className="icon-button mobile-signout" aria-label="Sign out" title="Sign out" disabled={mutationBusy} onClick={() => void logout()}>{busy === 'logout' ? <Spinner /> : <LogOut size={16} />}</button></div></header>
      <div className="workspace-content">{notice && <Notice kind="success">{notice} <button className="text-button" onClick={onDismissNotice}>Dismiss</button></Notice>}{readOnly && <Notice kind="info">You have viewer access. You can inspect agents, sources and saved versions. Ask an owner or admin for editor access to make changes.</Notice>}{listError && <Notice>{listError} <button className="text-button" onClick={() => void loadAgents()}>Retry</button></Notice>}
      {!selected && !loadingAgents ? <div className="first-agent"><span className="large-orb"><Sparkles size={30} /></span><h1>A useful guide starts<br />with your knowledge.</h1><p>Create an agent, give it your company's instructions, and connect it to your website.</p><button className="button primary" disabled={mutationBusy || readOnly} onClick={beginCreate}><Plus size={17} /> Create your first agent</button><div className="first-agent-path"><span><Settings2 size={18} /> Configure</span><ArrowRight size={16} /><span><BookOpen size={18} /> Add knowledge</span><ArrowRight size={16} /><span><Code2 size={18} /> Publish & embed</span></div></div> : loadingDetail || !detail || !config ? <div className="editor-loading">{error ? <><Notice>{error}</Notice><button className="button secondary" onClick={() => void refreshSelected()}>Retry loading agent</button></> : <><Spinner /><span>Loading agent…</span></>}</div> : <>
        <div className="editor-heading"><div><div className="agent-title-line"><span className="title-orb" style={{ background: config.accentColor }}><Sparkles size={22} /></span><h1>{detail.agent.name}</h1><span className={`badge ${detail.agent.publishedVersion ? 'badge-green' : 'badge-neutral'}`}>{detail.agent.publishedVersion ? `Live v${detail.agent.publishedVersion}` : 'Unpublished'}</span></div><p>Your knowledge, connected to the people using your product.</p></div><div className="heading-actions"><button className="button secondary" disabled={mutationBusy || readOnly || !dirty} onClick={() => void save()}>{busy === 'save' ? <Spinner /> : <Save size={16} />} Save draft</button><button className="button primary" disabled={mutationBusy || readOnly || knowledgeDirty || pendingPublication} onClick={() => void save(true)}>{busy === 'publish' ? <Spinner /> : <Upload size={16} />} Publish agent</button></div></div>
        <div className="version-bar"><span><span className={`version-dot ${hasUnsavedChanges ? 'changed' : ''}`} />{knowledgeDirty ? 'Unsaved document changes' : dirty ? 'Unsaved changes' : 'Draft saved'}<span className="version-separator" />{detail.documents.length} knowledge {detail.documents.length === 1 ? 'document' : 'documents'}</span><span>{detail.versions[0] ? `Latest version created ${date(detail.versions[0].createdAt)}` : 'Your agent becomes available after publishing.'}</span></div>
        <div className="editor-tabs" role="tablist" aria-label="Agent configuration">{([{ id: 'setup', label: 'Agent setup', icon: <Settings2 size={16} /> }, { id: 'knowledge', label: 'Knowledge', icon: <BookOpen size={16} /> }, { id: 'install', label: 'Install', icon: <Code2 size={16} /> }, { id: 'activity', label: 'Activity', icon: <MessageSquare size={16} /> }] as const).map(item => <button key={item.id} type="button" disabled={mutationBusy} role="tab" id={`tab-${item.id}`} aria-selected={tab === item.id} aria-controls={`panel-${item.id}`} tabIndex={tab === item.id ? 0 : -1} onClick={() => { setTab(item.id); setSuccess(''); }} onKeyDown={event => { if (mutationBusy) return; if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return; event.preventDefault(); const ids: Tab[] = ['setup', 'knowledge', 'install', 'activity']; const next = ids[(ids.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : 3)) % 4]; setTab(next); document.getElementById(`tab-${next}`)?.focus(); }}>{item.icon}{item.label}{item.id === 'knowledge' && detail.documents.length > 0 && <span className="tab-count">{detail.documents.length}</span>}</button>)}</div>
        {error && <Notice>{error} <button className="text-button" disabled={mutationBusy} onClick={() => void refreshSelected()}>Refresh agent</button></Notice>}{success && <Notice kind="success"><CheckCircle2 size={17} />{success}</Notice>}{knowledgeDirty && <Notice kind="info">A document has unsaved changes. Save or clear it before publishing. <button className="text-button" disabled={mutationBusy} onClick={() => setTab('knowledge')}>Open document editor</button></Notice>}{pendingPublication && <Notice kind="info"><Spinner />A saved version is being prepared. {detail.agent.publishedVersion ? 'Your active publication stays available.' : 'It becomes available after readiness is confirmed.'}</Notice>}
        <section className="tab-content" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === 'setup' && <div className="setup-grid"><fieldset className="editor-form" disabled={mutationBusy || readOnly}><div className="section-intro"><h2>The identity of your guide</h2><p>Set the name, voice, and boundaries visitors will experience.</p></div><div className="field-row"><label>Agent name<input value={config.name} onChange={event => patch('name', event.target.value)} minLength={2} maxLength={80} required /></label><label>Company name<input value={config.companyName} onChange={event => patch('companyName', event.target.value)} minLength={2} maxLength={100} required /></label></div><label>Description<textarea rows={2} value={config.description} onChange={event => patch('description', event.target.value)} maxLength={1500} placeholder="What does this agent help your visitors do?" /></label><label>Greeting<input value={config.greeting} onChange={event => patch('greeting', event.target.value)} maxLength={250} /></label><label>Instructions<textarea rows={6} value={config.instructions} onChange={event => patch('instructions', event.target.value)} maxLength={6000} /><small>Describe how the guide should help. Company documents belong in Knowledge.</small></label><div className="section-intro section-divider"><h2>Connection & permissions</h2><p>Choose where the agent runs and what it can request.</p></div><label>Allowed website origins<textarea rows={3} value={origins} onChange={event => { setOrigins(event.target.value); setSuccess(''); }} spellCheck={false} placeholder="https://your-product.com" /><small>One exact origin per line. Include protocol and port; omit paths and trailing slashes.</small></label><label>Allowed action IDs<textarea rows={3} value={actions} onChange={event => { setActions(event.target.value); setSuccess(''); }} spellCheck={false} placeholder="create_contact" /><small>Your website must register each action and validate its arguments. Changes always need visitor confirmation.</small></label><div className="permission-presets"><span>Add demo actions:</span><button className="pill-button" onClick={() => setActions(current => [...new Set([...current.split(/\n|,/).map(value => value.trim()).filter(Boolean), 'create_contact', 'update_contact_status'])].join('\n'))}>CRM contacts <Plus size={13} /></button><button className="pill-button" onClick={() => setActions(current => [...new Set([...current.split(/\n|,/).map(value => value.trim()).filter(Boolean), 'create_ticket'])].join('\n'))}>Support tickets <Plus size={13} /></button></div><div className="bottom-save"><button className="button primary" disabled={mutationBusy || readOnly || !dirty} onClick={() => void save()}>{busy === 'save' ? <Spinner /> : <Save size={16} />} Save draft</button><span>Publishing creates a separate, fixed version.</span></div></fieldset>
            <aside className="preview-column"><div className="greeting-preview"><div className="preview-label"><span>Greeting preview</span><span>Draft</span></div><div className="preview-chat-head"><span className="preview-avatar" style={{ background: config.accentColor }}><Sparkles size={21} /></span><div><strong>{config.name || 'Your agent'}</strong><small>{config.companyName || 'Your company'}</small></div></div><div className="preview-bubble">{config.greeting || 'Add a greeting to welcome visitors.'}</div><div className="preview-input">Your visitor's question…<span><ArrowRight size={16} /></span></div></div><label className="color-field">Accent color<div><input type="color" disabled={mutationBusy || readOnly} aria-label="Choose accent color" value={config.accentColor} onChange={event => patch('accentColor', event.target.value)} /><span>{config.accentColor}</span></div></label><div className="boundary-note"><ShieldCheck size={20} /><h3>Useful by design.<br />Bounded by you.</h3><p>The agent can explain and highlight. Changes go through the actions your website explicitly provides.</p></div></aside></div>}
          {tab === 'knowledge' && <Knowledge key={detail.agent.id} detail={detail} busy={mutationBusy || readOnly} draft={documentDraft} dirty={knowledgeDirty} examples={[{ title: 'CRM product guide', content: CRM_DOCUMENT, label: 'Use CRM example' }, { title: 'Support desk guide', content: SUPPORT_DOCUMENT, label: 'Use support example' }]} onDraftChange={setDocumentDraft} onBusyChange={setKnowledgeBusy} onChanged={async message => { await loadDetail(detail.agent.id, false, true); setSuccess(message); }} onError={setError} />}
          {tab === 'install' && <Install key={detail.agent.id} agent={detail.agent} versions={detail.versions} dirty={hasUnsavedChanges} busy={mutationBusy} readOnly={readOnly} onBusyChange={setPublicationBusy} onChanged={async message => { await loadDetail(detail.agent.id, false, true); await loadAgents(); setSuccess(message); }} onError={setError} />}
          {tab === 'activity' && <Activity detail={detail} onRefresh={() => void refreshSelected()} />}
        </section>
      </>}
      </div><footer className="workspace-footer"><span>GuideKit <span className="footer-dot" /> Core workspace</span><span>Knowledge informs. Your website authorizes.</span></footer>
    </main>{accountOpen && <AccountPanel workspace={workspace} agentDraftDirty={hasUnsavedChanges} onWorkspaceChange={onWorkspaceChange} onClose={() => setAccountOpen(false)} />}{createOpen && <CreateAgent companyName={workspace.tenant.name} onClose={() => setCreateOpen(false)} onCreated={async agent => { await loadAgents(); setSelected(agent.id); setTab('setup'); setCreateOpen(false); }} />}
  </div>;
}

function CreateAgent({ companyName, onClose, onCreated }: { companyName: string; onClose: () => void; onCreated: (agent: Agent) => Promise<void> }) {
  const [name, setName] = useState(''); const [company, setCompany] = useState(companyName); const [capability, setCapability] = useState('guidance'); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialogRef.current?.showModal(); }, []);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const config = initialConfig(company); config.name = name; config.allowedActions = capability === 'crm' ? ['create_contact', 'update_contact_status'] : capability === 'support' ? ['create_ticket'] : [];
      const result = await api<{ agent: Agent }>('/api/agents', { method: 'POST', body: JSON.stringify(config) }); await onCreated(result.agent);
    } catch (failure) { setError(errorMessage(failure)); setBusy(false); }
  }
  return <dialog className="create-dialog" ref={dialogRef} aria-labelledby="create-agent-title" onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}><form onSubmit={submit}><div className="dialog-heading"><span className="large-orb small-orb"><Sparkles size={24} /></span><button className="icon-button" type="button" aria-label="Close create agent" disabled={busy} onClick={onClose}><X size={20} /></button></div><h2 id="create-agent-title">Create your agent</h2><p className="muted">Start with a draft. Add knowledge and publish when it's ready.</p><label>Agent name<input autoFocus required minLength={2} maxLength={80} value={name} onChange={event => setName(event.target.value)} placeholder="Acme product guide" /></label><label>Company name<input required minLength={2} maxLength={100} value={company} onChange={event => setCompany(event.target.value)} /></label><label>Starting capabilities<select value={capability} onChange={event => setCapability(event.target.value)}><option value="guidance">Guidance and answers</option><option value="crm">CRM demo: contact actions</option><option value="support">Support demo: ticket actions</option></select><small>You can change the allowed actions later. The website must register them.</small></label>{error && <Notice>{error}</Notice>}<div className="dialog-actions"><button className="button secondary" type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="button primary" type="submit" disabled={busy}>{busy ? <Spinner /> : <Plus size={16} />} Create agent</button></div></form></dialog>;
}

function Activity({ detail, onRefresh }: { detail: AgentDetail; onRefresh: () => void }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return <div className="activity-layout"><div className="activity-heading"><div className="section-intro"><h2>See what your guide helped with</h2><p>Actual requests and reported action outcomes from this agent's website sessions.</p></div><button className="button secondary small" onClick={onRefresh}><RefreshCw size={15} /> Refresh activity</button></div>{!detail.sessions.length ? <Empty icon={<MessageSquare size={25} />} title="Your first conversation is ahead">Publish your agent and ask a question on a connected website. Requests will appear here.</Empty> : <div className="activity-list">{detail.sessions.map(session => <article className="activity-item" key={session.id}><div className="activity-item-top"><span className={`outcome-dot ${['succeeded', 'action_succeeded'].includes(session.status) ? 'succeeded' : ['failed', 'action_failed'].includes(session.status) ? 'failed' : ''}`} /><button className="activity-question" aria-expanded={expanded === session.id} onClick={() => setExpanded(current => current === session.id ? null : session.id)}>{session.question}</button><span className={`badge ${['succeeded', 'action_succeeded'].includes(session.status) ? 'badge-green' : ['failed', 'action_failed'].includes(session.status) ? 'badge-red' : 'badge-neutral'}`}>{session.status.replaceAll('_', ' ')}</span></div><div className="activity-meta"><span>{date(session.createdAt)}</span>{session.actionName && <code>{session.actionName}</code>}<span>Request {session.id.slice(0, 8)}</span></div>{expanded === session.id && <div className="activity-answer"><strong>Agent answer</strong><p>{session.answer}</p><small>Action status reflects the website's reported result. Host permissions remain authoritative.</small></div>}</article>)}</div>}</div>;
}
