import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowRight, BookOpen, Check, CheckCircle2, ChevronDown, Circle, Code2, Copy, ExternalLink, FileText, FolderOpen, Layers3, Loader2, LogOut, MessageSquare, Plus, Radio, RefreshCw, Save, Settings2, ShieldCheck, Sparkles, Trash2, Upload, X } from 'lucide-react';
import type { Agent, AgentConfig, AgentDetail, RuntimeStatus, Workspace } from '@guidekit/contracts';

type Tab = 'setup' | 'knowledge' | 'install' | 'activity';
const DEMO_ORIGINS = ['http://127.0.0.1:4411', 'http://127.0.0.1:4412'];
const MAX_DOCUMENT_BYTES = 256 * 1024;
const CRM_DOCUMENT = `Contact workspace guide\n\nThe CRM demonstration manages company contacts. To add a contact, open Contacts and choose Add contact. Enter the person's name and email, then save. Contact statuses are lead, active, and archived.\n\nRegistered capabilities:\n- create_contact accepts name and email, and optionally company. Ask the visitor to confirm before creating a contact.\n- update_contact_status changes an existing contact's status using contactId and status. Confirm the change first.\n\nUse the current page context to identify the visible controls. Never invent a contact ID or claim a change succeeded before receiving the host result. The host performs its own validation and permission checks.`;
const SUPPORT_DOCUMENT = `Support desk guide\n\nThe support demonstration lets visitors browse help topics and create a support ticket. Select New ticket to start. Describe the issue clearly and include an email address where the team can reply.\n\nRegistered capability:\n- create_ticket creates a ticket after the visitor confirms the details. Use the registered action's input schema for the exact fields.\n\nUse the live page context to locate controls. Never promise an outcome until the host confirms the ticket was created. If required information is missing, ask the visitor for it.`;

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...options, credentials: 'include', headers: { 'Content-Type': 'application/json', ...options.headers } });
  const body = await response.json().catch(() => null) as T & { error?: string };
  if (!response.ok) throw new Error(body?.error || `Request failed (${response.status}). Try again.`);
  return body;
}
function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'Something went wrong. Please try again.'; }
function date(value: string) { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
function configOf(agent: Agent): AgentConfig {
  return { name: agent.name, companyName: agent.companyName, description: agent.description, instructions: agent.instructions, greeting: agent.greeting, accentColor: agent.accentColor, allowedOrigins: agent.allowedOrigins, allowedActions: agent.allowedActions };
}
function initialConfig(companyName: string): AgentConfig {
  return { name: '', companyName, description: '', instructions: 'Be concise, helpful, and grounded in the company knowledge. Use the live page context for guidance. Ask for missing information and confirm before changing anything.', greeting: 'What would you like to do?', accentColor: '#365cf5', allowedOrigins: DEMO_ORIGINS, allowedActions: [] };
}
function Spinner() { return <Loader2 size={16} className="spin" aria-hidden="true" />; }
function Notice({ children, kind = 'error' }: { children: ReactNode; kind?: 'error' | 'success' | 'info' }) { return <div className={`notice notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>; }
function Empty({ icon, title, children, action }: { icon: ReactNode; title: string; children: ReactNode; action?: ReactNode }) { return <div className="empty-state"><div className="empty-icon">{icon}</div><h3>{title}</h3><p>{children}</p>{action}</div>; }

export function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [checking, setChecking] = useState(true);
  const [startupError, setStartupError] = useState('');
  const checkAuth = useCallback(async () => {
    setChecking(true); setStartupError('');
    try { const result = await api<{ workspace: Workspace | null }>('/api/auth/me'); setWorkspace(result.workspace); }
    catch (error) { setStartupError(errorMessage(error)); }
    finally { setChecking(false); }
  }, []);
  useEffect(() => { void checkAuth(); }, [checkAuth]);
  if (checking) return <div className="app-loading"><Brand /><Spinner /><p>Opening your workspace…</p></div>;
  if (startupError) return <div className="app-loading"><Brand /><Notice>{startupError}</Notice><button className="button primary" onClick={() => void checkAuth()}><RefreshCw size={16} /> Retry connection</button><p>Start the GuideKit server, then retry.</p></div>;
  if (!workspace) return <Auth onAuthenticated={setWorkspace} />;
  return <Dashboard workspace={workspace} onLogout={() => setWorkspace(null)} />;
}

function Brand({ light = false }: { light?: boolean }) {
  return <div className={`brand ${light ? 'brand-light' : ''}`}><span className="brand-mark"><Layers3 size={22} strokeWidth={2.2} /></span><span>GuideKit</span></div>;
}

function Auth({ onAuthenticated }: { onAuthenticated: (workspace: Workspace) => void }) {
  const [mode, setMode] = useState<'register' | 'login'>('register');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const data = new FormData(event.currentTarget);
    const body = mode === 'register' ? { name: String(data.get('name')), companyName: String(data.get('companyName')), email: String(data.get('email')), password: String(data.get('password')) } : { email: String(data.get('email')), password: String(data.get('password')) };
    try { const result = await api<{ workspace: Workspace }>(`/api/auth/${mode}`, { method: 'POST', body: JSON.stringify(body) }); onAuthenticated(result.workspace); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  return <main className="auth-layout">
    <section className="auth-story"><Brand light /><div className="auth-copy"><h1>Your product.<br />A guide that knows it.</h1><p>Bring your company knowledge and website together. Publish a visual assistant that helps people move from a question to a completed task.</p>
      <div className="connection-demo" aria-hidden="true"><div className="connection-source"><BookOpen size={22} /><span>Your knowledge</span><small>Docs, answers, instructions</small></div><div className="connection-line"><span /></div><div className="connection-guide"><span className="mini-orb"><Sparkles size={20} /></span><span>Your website guide</span><small>Explain. Show. Help.</small></div></div>
    </div><div className="auth-foot"><ShieldCheck size={17} /><span>Local runtime. Company-scoped knowledge. Actions you control.</span></div></section>
    <section className="auth-panel"><div className="auth-form-wrap"><span className="local-label"><span /> Developer workspace</span><h2>{mode === 'register' ? 'Make it your guide.' : 'Welcome back.'}</h2><p className="muted">{mode === 'register' ? 'Create your workspace to configure your first agent.' : 'Sign in to continue building your agents.'}</p>
      <div className="auth-tabs" aria-label="Account access"><button type="button" aria-pressed={mode === 'register'} onClick={() => { setMode('register'); setError(''); }}>Create workspace</button><button type="button" aria-pressed={mode === 'login'} onClick={() => { setMode('login'); setError(''); }}>Sign in</button></div>
      <form onSubmit={submit} className="stack-form" key={mode}>
        {mode === 'register' && <><label>Your name<input name="name" autoComplete="name" required minLength={2} maxLength={100} placeholder="Alex Morgan" /></label><label>Company name<input name="companyName" autoComplete="organization" required minLength={2} maxLength={100} placeholder="Your company" /></label></>}
        <label>Email address<input name="email" type="email" autoComplete="email" required maxLength={254} placeholder="you@company.com" /></label>
        <label>Password<input name="password" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required minLength={mode === 'register' ? 12 : 1} maxLength={256} />{mode === 'register' && <small>Use at least 12 characters.</small>}</label>
        {error && <Notice>{error}</Notice>}
        <button className="button primary full-width" type="submit" disabled={busy}>{busy ? <Spinner /> : <ArrowRight size={17} />}{mode === 'register' ? 'Create workspace' : 'Sign in'}</button>
      </form><p className="auth-note">Your account and agent configuration are stored by this local GuideKit instance.</p>
    </div></section>
  </main>;
}

function Dashboard({ workspace, onLogout }: { workspace: Workspace; onLogout: () => void }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<AgentDetail | null>(null);
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [origins, setOrigins] = useState('');
  const [actions, setActions] = useState('');
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [tab, setTab] = useState<Tab>('setup');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [runtimeError, setRuntimeError] = useState('');
  const [runtimeBusy, setRuntimeBusy] = useState(false);
  const [listError, setListError] = useState('');
  const selectionRef = useRef<string | null>(null);
  const normalizedConfig = config ? { ...config, allowedOrigins: origins.split(/\n|,/).map(value => value.trim()).filter(Boolean), allowedActions: actions.split(/\n|,/).map(value => value.trim()).filter(Boolean) } : null;
  const dirty = !!(detail && normalizedConfig && JSON.stringify(normalizedConfig) !== JSON.stringify(configOf(detail.agent)));

  const loadAgents = useCallback(async () => {
    setListError(''); setLoadingAgents(true);
    try { const result = await api<{ agents: Agent[] }>('/api/agents'); setAgents(result.agents); setSelected(current => current ?? result.agents[0]?.id ?? null); }
    catch (failure) { setListError(errorMessage(failure)); }
    finally { setLoadingAgents(false); }
  }, []);
  const loadDetail = useCallback(async (id: string, showLoading = true, preserveDraft = false) => {
    if (showLoading) setLoadingDetail(true);
    try {
      const result = await api<AgentDetail>(`/api/agents/${id}`);
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
    selectionRef.current = selected; setDetail(null); setConfig(null); setError(''); setSuccess('');
    if (selected) void loadDetail(selected);
  }, [selected, loadDetail]);
  useEffect(() => {
    if (!dirty) return;
    const handleUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, [dirty]);

  function chooseAgent(id: string) {
    if (id === selected) return;
    if (dirty && !window.confirm('Discard unsaved changes and open another agent?')) return;
    setSelected(id); setTab('setup');
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
    if (!selected) return;
    setError(''); setSuccess(''); setBusy(publish ? 'publish' : 'save');
    try {
      const valid = validateConfig();
      await api(`/api/agents/${selected}`, { method: 'PUT', body: JSON.stringify(valid) });
      if (publish) await api(`/api/agents/${selected}/publish`, { method: 'POST', body: '{}' });
      await loadDetail(selected, false); await loadAgents();
      setSuccess(publish ? 'Published. Your websites can now start sessions with this version.' : 'Draft saved. Publish when you want these changes on your websites.');
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(''); }
  }
  async function logout() {
    if (dirty && !window.confirm('Discard unsaved changes and sign out?')) return;
    setBusy('logout'); setError('');
    try { await api('/api/auth/logout', { method: 'POST', body: '{}' }); onLogout(); }
    catch (failure) { setError(errorMessage(failure)); setBusy(''); }
  }
  async function refreshSelected() {
    if (!selected) return;
    if (dirty && !window.confirm('Discard unsaved changes and refresh this agent?')) return;
    setError(''); await loadDetail(selected);
  }
  return <div className="dashboard-layout">
    <a className="skip-link" href="#main-content">Skip to agent editor</a>
    <aside className="sidebar"><Brand light /><div className="workspace-label"><span className="workspace-avatar">{workspace.tenant.name.slice(0, 1).toUpperCase()}</span><div><strong>{workspace.tenant.name}</strong><small>Developer workspace</small></div></div>
      <div className="sidebar-section-title"><span>Your agents</span><button className="icon-button" aria-label="Create agent" onClick={() => setCreateOpen(true)}><Plus size={18} /></button></div>
      <nav className="agent-nav" aria-label="Agents">{loadingAgents && !agents.length ? <p className="sidebar-hint"><Spinner /> Loading agents…</p> : agents.map(agent => <button className={`agent-nav-item ${selected === agent.id ? 'selected' : ''}`} key={agent.id} onClick={() => chooseAgent(agent.id)} aria-current={selected === agent.id ? 'page' : undefined}><span className="agent-nav-orb" style={{ background: agent.accentColor }}><Sparkles size={15} /></span><span>{agent.name}<small>{agent.publishedVersion ? `Published v${agent.publishedVersion}` : 'Draft'}</small></span>{selected === agent.id && <ChevronDown size={13} />}</button>)}{!loadingAgents && !agents.length && <p className="sidebar-hint">Your first agent starts here.</p>}</nav>
      <button className="new-agent-button" onClick={() => setCreateOpen(true)}><Plus size={16} /> New agent</button>
      <div className="sidebar-bottom"><div className="runtime-label"><Radio size={16} /><strong>Local runtime</strong><button className="icon-button" aria-label="Refresh runtime status" disabled={runtimeBusy} onClick={() => void loadRuntime()}>{runtimeBusy ? <Spinner /> : <RefreshCw size={14} />}</button></div><span className={`runtime-state ${runtime?.available && runtime.authenticated ? 'ready' : ''}`}><span />{runtimeError ? 'Connection unavailable' : !runtime ? 'Checking connection' : runtime.authenticated ? 'ChatGPT connected' : runtime.available ? 'Sign-in required' : 'Codex unavailable'}</span><p>{runtimeError || runtime?.message || 'Checking your local Codex connection.'}</p><button className="sidebar-user" onClick={() => void logout()} disabled={busy === 'logout'}><span><strong>{workspace.user.name}</strong><small>{workspace.user.email}</small></span>{busy === 'logout' ? <Spinner /> : <LogOut size={17} />}<span className="sr-only">Sign out</span></button></div>
    </aside>
    <main className="main-workspace" id="main-content"><header className="workspace-topbar"><span><FolderOpen size={16} /> Workspace <span className="breadcrumb-divider">/</span> <strong>{detail?.agent.name || 'Agents'}</strong></span><div className="topbar-actions"><span className="local-badge"><span /> Local development</span><button className="icon-button mobile-signout" aria-label="Sign out" title="Sign out" disabled={busy === 'logout'} onClick={() => void logout()}>{busy === 'logout' ? <Spinner /> : <LogOut size={16} />}</button></div></header>
      <div className="workspace-content">{listError && <Notice>{listError} <button className="text-button" onClick={() => void loadAgents()}>Retry</button></Notice>}
      {!selected && !loadingAgents ? <div className="first-agent"><span className="large-orb"><Sparkles size={30} /></span><h1>A useful guide starts<br />with your knowledge.</h1><p>Create an agent, give it your company's instructions, and connect it to your website.</p><button className="button primary" onClick={() => setCreateOpen(true)}><Plus size={17} /> Create your first agent</button><div className="first-agent-path"><span><Settings2 size={18} /> Configure</span><ArrowRight size={16} /><span><BookOpen size={18} /> Add knowledge</span><ArrowRight size={16} /><span><Code2 size={18} /> Publish & embed</span></div></div> : loadingDetail || !detail || !config ? <div className="editor-loading">{error ? <><Notice>{error}</Notice><button className="button secondary" onClick={() => void refreshSelected()}>Retry loading agent</button></> : <><Spinner /><span>Loading agent…</span></>}</div> : <>
        <div className="editor-heading"><div><div className="agent-title-line"><span className="title-orb" style={{ background: config.accentColor }}><Sparkles size={22} /></span><h1>{detail.agent.name}</h1><span className={`badge ${detail.agent.publishedVersion ? 'badge-green' : 'badge-neutral'}`}>{detail.agent.publishedVersion ? `Live v${detail.agent.publishedVersion}` : 'Unpublished'}</span></div><p>Your knowledge, connected to the people using your product.</p></div><div className="heading-actions"><button className="button secondary" disabled={!!busy || !dirty} onClick={() => void save()}>{busy === 'save' ? <Spinner /> : <Save size={16} />} Save draft</button><button className="button primary" disabled={!!busy} onClick={() => void save(true)}>{busy === 'publish' ? <Spinner /> : <Upload size={16} />} Publish agent</button></div></div>
        <div className="version-bar"><span><span className={`version-dot ${dirty ? 'changed' : ''}`} />{dirty ? 'Unsaved changes' : 'Draft saved'}<span className="version-separator" />{detail.documents.length} knowledge {detail.documents.length === 1 ? 'document' : 'documents'}</span><span>{detail.versions[0] ? `Last published ${date(detail.versions[0].createdAt)}` : 'Your agent becomes available after publishing.'}</span></div>
        <div className="editor-tabs" role="tablist" aria-label="Agent configuration">{([{ id: 'setup', label: 'Agent setup', icon: <Settings2 size={16} /> }, { id: 'knowledge', label: 'Knowledge', icon: <BookOpen size={16} /> }, { id: 'install', label: 'Install', icon: <Code2 size={16} /> }, { id: 'activity', label: 'Activity', icon: <MessageSquare size={16} /> }] as const).map(item => <button key={item.id} type="button" role="tab" id={`tab-${item.id}`} aria-selected={tab === item.id} aria-controls={`panel-${item.id}`} tabIndex={tab === item.id ? 0 : -1} onClick={() => { setTab(item.id); setSuccess(''); }} onKeyDown={event => { if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return; event.preventDefault(); const ids: Tab[] = ['setup', 'knowledge', 'install', 'activity']; const next = ids[(ids.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : 3)) % 4]; setTab(next); document.getElementById(`tab-${next}`)?.focus(); }}>{item.icon}{item.label}{item.id === 'knowledge' && detail.documents.length > 0 && <span className="tab-count">{detail.documents.length}</span>}</button>)}</div>
        {error && <Notice>{error}</Notice>}{success && <Notice kind="success"><CheckCircle2 size={17} />{success}</Notice>}
        <section className="tab-content" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === 'setup' && <div className="setup-grid"><div className="editor-form"><div className="section-intro"><h2>The identity of your guide</h2><p>Set the name, voice, and boundaries visitors will experience.</p></div><div className="field-row"><label>Agent name<input value={config.name} onChange={event => patch('name', event.target.value)} minLength={2} maxLength={80} required /></label><label>Company name<input value={config.companyName} onChange={event => patch('companyName', event.target.value)} minLength={2} maxLength={100} required /></label></div><label>Description<textarea rows={2} value={config.description} onChange={event => patch('description', event.target.value)} maxLength={1500} placeholder="What does this agent help your visitors do?" /></label><label>Greeting<input value={config.greeting} onChange={event => patch('greeting', event.target.value)} maxLength={250} /></label><label>Instructions<textarea rows={6} value={config.instructions} onChange={event => patch('instructions', event.target.value)} maxLength={6000} /><small>Describe how the guide should help. Company documents belong in Knowledge.</small></label><div className="section-intro section-divider"><h2>Connection & permissions</h2><p>Choose where the agent runs and what it can request.</p></div><label>Allowed website origins<textarea rows={3} value={origins} onChange={event => { setOrigins(event.target.value); setSuccess(''); }} spellCheck={false} placeholder="https://your-product.com" /><small>One exact origin per line. Include protocol and port; omit paths and trailing slashes.</small></label><label>Allowed action IDs<textarea rows={3} value={actions} onChange={event => { setActions(event.target.value); setSuccess(''); }} spellCheck={false} placeholder="create_contact" /><small>Your website must register each action and validate its arguments. Changes always need visitor confirmation.</small></label><div className="permission-presets"><span>Add demo actions:</span><button className="pill-button" onClick={() => setActions(current => [...new Set([...current.split(/\n|,/).map(value => value.trim()).filter(Boolean), 'create_contact', 'update_contact_status'])].join('\n'))}>CRM contacts <Plus size={13} /></button><button className="pill-button" onClick={() => setActions(current => [...new Set([...current.split(/\n|,/).map(value => value.trim()).filter(Boolean), 'create_ticket'])].join('\n'))}>Support tickets <Plus size={13} /></button></div><div className="bottom-save"><button className="button primary" disabled={!!busy || !dirty} onClick={() => void save()}>{busy === 'save' ? <Spinner /> : <Save size={16} />} Save draft</button><span>Publishing creates a separate, fixed version.</span></div></div>
            <aside className="preview-column"><div className="greeting-preview"><div className="preview-label"><span>Greeting preview</span><span>Draft</span></div><div className="preview-chat-head"><span className="preview-avatar" style={{ background: config.accentColor }}><Sparkles size={21} /></span><div><strong>{config.name || 'Your agent'}</strong><small>{config.companyName || 'Your company'}</small></div></div><div className="preview-bubble">{config.greeting || 'Add a greeting to welcome visitors.'}</div><div className="preview-input">Your visitor's question…<span><ArrowRight size={16} /></span></div></div><label className="color-field">Accent color<div><input type="color" aria-label="Choose accent color" value={config.accentColor} onChange={event => patch('accentColor', event.target.value)} /><span>{config.accentColor}</span></div></label><div className="boundary-note"><ShieldCheck size={20} /><h3>Useful by design.<br />Bounded by you.</h3><p>The agent can explain and highlight. Changes go through the actions your website explicitly provides.</p></div></aside></div>}
          {tab === 'knowledge' && <Knowledge detail={detail} busy={!!busy} onChanged={async message => { await loadDetail(detail.agent.id, false, true); setSuccess(message); }} onError={setError} />}
          {tab === 'install' && <Install agent={detail.agent} versions={detail.versions} dirty={dirty} />}
          {tab === 'activity' && <Activity detail={detail} onRefresh={() => void refreshSelected()} />}
        </section>
      </>}
      </div><footer className="workspace-footer"><span>GuideKit <span className="footer-dot" /> Core workspace</span><span>Knowledge informs. Your website authorizes.</span></footer>
    </main>{createOpen && <CreateAgent companyName={workspace.tenant.name} onClose={() => setCreateOpen(false)} onCreated={async agent => { await loadAgents(); setSelected(agent.id); setTab('setup'); setCreateOpen(false); }} />}
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

function Knowledge({ detail, busy, onChanged, onError }: { detail: AgentDetail; busy: boolean; onChanged: (message: string) => Promise<void>; onError: (message: string) => void }) {
  const [title, setTitle] = useState(''); const [content, setContent] = useState(''); const [working, setWorking] = useState(''); const [dragging, setDragging] = useState(false); const [error, setError] = useState(''); const [expanded, setExpanded] = useState<string | null>(null); const fileRef = useRef<HTMLInputElement>(null);
  const bytes = new TextEncoder().encode(content).length;
  async function readFile(file: File | undefined) {
    if (!file) return;
    setError('');
    if (!/\.(txt|md)$/i.test(file.name)) { setError('Choose a .txt or .md file. Other formats are not supported yet.'); return; }
    if (file.size > MAX_DOCUMENT_BYTES) { setError('This file is larger than 256 KB. Split it into smaller documents.'); return; }
    try { const text = await file.text(); if (text.includes('\u0000')) throw new Error('This file contains binary data. Choose a plain text document.'); setTitle(file.name.replace(/\.(txt|md)$/i, '')); setContent(text); }
    catch (failure) { setError(errorMessage(failure)); }
    if (fileRef.current) fileRef.current.value = '';
  }
  async function add(event: FormEvent) {
    event.preventDefault(); setError(''); onError('');
    if (!content.trim()) { setError('Add some document text before saving.'); return; }
    if (bytes > MAX_DOCUMENT_BYTES) { setError('Keep each document under 256 KB.'); return; }
    setWorking('add');
    try { await api(`/api/agents/${detail.agent.id}/documents`, { method: 'POST', body: JSON.stringify({ title, content }) }); setTitle(''); setContent(''); await onChanged('Knowledge added to the draft. Publish to make it available to new website sessions.'); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { setWorking(''); }
  }
  async function remove(id: string, documentTitle: string) {
    if (!window.confirm(`Remove “${documentTitle}” from the draft? Published versions keep their existing knowledge.`)) return;
    setWorking(id); setError(''); onError('');
    try { await api(`/api/agents/${detail.agent.id}/documents/${id}`, { method: 'DELETE' }); await onChanged('Document removed from the draft. Published versions are unchanged.'); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { setWorking(''); }
  }
  return <div className="knowledge-layout"><div><div className="section-intro"><h2>Give your guide the right context</h2><p>Add product documentation, company policies, and task instructions. Answers can cite these sources.</p></div><form onSubmit={add} className="knowledge-form"><div className={`upload-zone ${dragging ? 'dragging' : ''}`} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); void readFile(event.dataTransfer.files[0]); }}><Upload size={24} /><strong>Drop a document here</strong><span>Plain text or Markdown, up to 256 KB</span><button className="button secondary small" type="button" disabled={!!working || busy} onClick={() => fileRef.current?.click()}>Choose file</button><input ref={fileRef} type="file" aria-label="Upload knowledge document" accept=".txt,.md,text/plain,text/markdown" className="sr-only" onChange={event => void readFile(event.target.files?.[0])} /></div><div className="or-divider"><span>or paste your knowledge</span></div><label>Document title<input required value={title} onChange={event => setTitle(event.target.value)} minLength={1} maxLength={160} placeholder="Getting started with our product" /></label><label>Document text<textarea required rows={9} value={content} onChange={event => setContent(event.target.value)} placeholder="Add the information your agent should use when helping visitors…" /><small className={bytes > MAX_DOCUMENT_BYTES ? 'field-error' : ''}>{(bytes / 1024).toFixed(1)} KB / 256 KB. Text is stored as knowledge; it does not retrain the model.</small></label><div className="example-row"><span>Try a demo document:</span><button type="button" className="text-button" onClick={() => { setTitle('CRM product guide'); setContent(CRM_DOCUMENT); }}>Use CRM example</button><button type="button" className="text-button" onClick={() => { setTitle('Support desk guide'); setContent(SUPPORT_DOCUMENT); }}>Use support example</button></div>{error && <Notice>{error}</Notice>}<button className="button primary" disabled={!!working || busy || !content.trim() || bytes > MAX_DOCUMENT_BYTES} type="submit">{working === 'add' ? <Spinner /> : <Plus size={16} />} Add document</button></form></div>
    <aside className="knowledge-library"><div className="library-heading"><h3>Draft knowledge</h3><span className="badge badge-neutral">{detail.documents.length}</span></div>{!detail.documents.length ? <Empty icon={<BookOpen size={23} />} title="A clean starting point">Add your first document. Published agents use a snapshot of this library.</Empty> : <div className="document-list">{detail.documents.map(document => <article className="document-item" key={document.id}><div className="document-row"><FileText size={19} /><button className="document-title" aria-expanded={expanded === document.id} onClick={() => setExpanded(current => current === document.id ? null : document.id)}><strong>{document.title}</strong><small>{new TextEncoder().encode(document.content).length < 1024 ? '<1' : Math.ceil(new TextEncoder().encode(document.content).length / 1024)} KB · {new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(document.createdAt))}</small></button><button className="icon-button delete-button" aria-label={`Delete ${document.title}`} disabled={!!working || busy} onClick={() => void remove(document.id, document.title)}>{working === document.id ? <Spinner /> : <Trash2 size={16} />}</button></div>{expanded === document.id && <pre className="document-preview">{document.content}</pre>}</article>)}</div>}<p className="library-note"><Layers3 size={16} />Publishing freezes the current documents into a version. Editing this library changes the draft.</p></aside></div>;
}

function Install({ agent, versions, dirty }: { agent: Agent; versions: AgentDetail['versions']; dirty: boolean }) {
  const [copied, setCopied] = useState(false); const [copyError, setCopyError] = useState('');
  const snippet = `<script\n  src="http://127.0.0.1:4410/sdk/guidekit.js"\n  data-agent-id="${agent.id}"\n  data-endpoint="http://127.0.0.1:4410"\n  defer\n></script>`;
  async function copy() { setCopyError(''); try { await navigator.clipboard.writeText(snippet); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { setCopyError('Clipboard access is unavailable. Select and copy the snippet below.'); } }
  return <div className="install-layout"><div className="section-intro"><h2>One SDK. Your company's guide.</h2><p>Add the script to your website. The agent ID connects it to this agent's published configuration.</p></div>{!agent.publishedVersion && <Notice kind="info">Publish your agent first. The SDK only starts sessions with a published version.</Notice>}{dirty && <Notice kind="info">You have unsaved changes. The installation uses the most recently published version.</Notice>}<div className="install-status"><span className={`status-symbol ${agent.publishedVersion ? 'published' : ''}`}>{agent.publishedVersion ? <Check size={18} /> : <Circle size={18} />}</span><div><strong>{agent.publishedVersion ? `Published version ${agent.publishedVersion}` : 'Waiting for first publish'}</strong><p>{agent.publishedVersion ? 'New visitor sessions receive this fixed version.' : 'Add knowledge, save your draft, then publish from the top of this page.'}</p></div></div><div className="code-block"><div><span><Code2 size={16} /> Website installation</span><button className="copy-button" onClick={() => void copy()}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? 'Copied' : 'Copy snippet'}</button></div><pre tabIndex={0}><code>{snippet}</code></pre></div>{copyError && <Notice>{copyError}</Notice>}<div className="install-details"><div><strong>Agent ID</strong><code>{agent.id}</code></div><div><strong>Allowed origins</strong>{agent.allowedOrigins.map(origin => <code key={origin}>{origin}</code>)}</div></div><div className="section-intro section-divider"><h2>Try it on a real page</h2><p>Use either independent demo website with this same agent. Add the matching knowledge and permitted actions first.</p></div><div className="demo-links">{[{ name: 'Contact CRM', description: 'Create contacts and update their status.', port: 4411 }, { name: 'Support desk', description: 'Browse help and create a support ticket.', port: 4412 }].map(demo => <a key={demo.port} className={`demo-link ${!agent.publishedVersion ? 'disabled-link' : ''}`} href={`http://127.0.0.1:${demo.port}/?agentId=${encodeURIComponent(agent.id)}`} target="_blank" rel="noreferrer" aria-disabled={!agent.publishedVersion} onClick={event => { if (!agent.publishedVersion) event.preventDefault(); }}><span className="demo-link-icon">{demo.port === 4411 ? <FolderOpen size={23} /> : <MessageSquare size={23} />}</span><span><strong>Open {demo.name}</strong><small>{demo.description}</small></span><ExternalLink size={17} /></a>)}</div><div className="integration-note"><ShieldCheck size={21} /><div><h3>Connect actions intentionally</h3><p>The script enables questions and visual guidance. To let the agent change data, your application registers allowlisted actions, validates inputs and permissions, and reports the actual outcome. A visitor must confirm each change.</p><p>Voice depends on browser support and microphone permission. Typed chat remains available.</p></div></div><div className="section-intro section-divider"><h2>Published versions</h2><p>Each publication preserves its configuration and knowledge.</p></div>{versions.length ? <div className="version-list">{versions.map(version => <div key={version.number}><span className="version-number">v{version.number}</span><span><strong>{version.number === agent.publishedVersion ? 'Current publication' : 'Earlier publication'}</strong><small>{date(version.createdAt)}</small></span><span>{version.documentCount} {version.documentCount === 1 ? 'document' : 'documents'}</span>{version.number === agent.publishedVersion && <span className="badge badge-green">Live</span>}</div>)}</div> : <p className="muted">No versions published yet.</p>}</div>;
}

function Activity({ detail, onRefresh }: { detail: AgentDetail; onRefresh: () => void }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return <div className="activity-layout"><div className="activity-heading"><div className="section-intro"><h2>See what your guide helped with</h2><p>Actual requests and reported action outcomes from this agent's website sessions.</p></div><button className="button secondary small" onClick={onRefresh}><RefreshCw size={15} /> Refresh activity</button></div>{!detail.sessions.length ? <Empty icon={<MessageSquare size={25} />} title="Your first conversation is ahead">Publish your agent and ask a question on a connected website. Requests will appear here.</Empty> : <div className="activity-list">{detail.sessions.map(session => <article className="activity-item" key={session.id}><div className="activity-item-top"><span className={`outcome-dot ${session.status === 'succeeded' ? 'succeeded' : session.status === 'failed' ? 'failed' : ''}`} /><button className="activity-question" aria-expanded={expanded === session.id} onClick={() => setExpanded(current => current === session.id ? null : session.id)}>{session.question}</button><span className={`badge ${session.status === 'succeeded' ? 'badge-green' : session.status === 'failed' ? 'badge-red' : 'badge-neutral'}`}>{session.status.replaceAll('_', ' ')}</span></div><div className="activity-meta"><span>{date(session.createdAt)}</span>{session.actionName && <code>{session.actionName}</code>}<span>Request {session.id.slice(0, 8)}</span></div>{expanded === session.id && <div className="activity-answer"><strong>Agent answer</strong><p>{session.answer}</p><small>Action status reflects the website's reported result. Host permissions remain authoritative.</small></div>}</article>)}</div>}</div>;
}
