import { useState, type FormEvent } from 'react';
import { ArrowRight, BookOpen, ShieldCheck, Sparkles } from 'lucide-react';
import type { Workspace } from '@guidekit/contracts';
import { api, Brand, DeliveryNotice, errorMessage, Notice, Spinner } from './shared';

interface Props { onAuthenticated(workspace: Workspace): void; initialMode?: 'register' | 'login'; initialEmail?: string; lockEmail?: boolean; allowRegister?: boolean; compact?: boolean; message?: string; onBack?(): void; }
export function Auth({ onAuthenticated, initialMode = 'register', initialEmail = '', lockEmail = false, allowRegister = true, compact = false, message, onBack }: Props) {
  const [mode, setMode] = useState(initialMode), [email, setEmail] = useState(initialEmail), [busy, setBusy] = useState(false), [error, setError] = useState(''), [forgot, setForgot] = useState(false), [recovery, setRecovery] = useState<{ message: string; delivery: string } | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const form = event.currentTarget, data = new FormData(form);
    try {
      if (forgot) { setRecovery(await api('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) })); return; }
      const body = mode === 'register' ? { name: String(data.get('name')), companyName: String(data.get('companyName')), email, password: String(data.get('password')) } : { email, password: String(data.get('password')) };
      const result = await api<{ workspace: Workspace }>(`/api/auth/${mode}`, { method: 'POST', body: JSON.stringify(body) }); form.reset(); onAuthenticated(result.workspace);
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  const panel = <section className="auth-panel"><div className="auth-form-wrap"><span className="local-label"><span /> Developer workspace</span><h2>{forgot ? 'Recover your account.' : mode === 'register' ? 'Make it your guide.' : 'Welcome back.'}</h2><p className="muted">{forgot ? 'Request a single-use recovery link. The response is the same whether an account exists or not.' : mode === 'register' ? 'Create your workspace to configure your first agent.' : 'Sign in to continue building your agents.'}</p>
    {!forgot && allowRegister && <div className="auth-tabs" aria-label="Account access"><button type="button" disabled={busy} aria-pressed={mode === 'register'} onClick={() => { setMode('register'); setError(''); }}>New workspace</button><button type="button" disabled={busy} aria-pressed={mode === 'login'} onClick={() => { setMode('login'); setError(''); }}>Existing account</button></div>}
    {message && <Notice kind="success">{message}</Notice>}
    <form onSubmit={submit} className="stack-form" key={`${mode}:${forgot}`} aria-busy={busy}>
      {!forgot && mode === 'register' && <><label>Your name<input name="name" autoComplete="name" required minLength={2} maxLength={100} disabled={busy} /></label><label>Company name<input name="companyName" autoComplete="organization" required minLength={2} maxLength={100} disabled={busy} /></label></>}
      <label>Email address<input name="email" type="email" autoComplete="email" required maxLength={200} value={email} readOnly={lockEmail} disabled={busy} onChange={event => { setEmail(event.target.value); setError(''); setRecovery(null); }} /></label>
      {!forgot && <label>Password<input name="password" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required minLength={mode === 'register' ? 12 : 1} maxLength={256} disabled={busy} />{mode === 'register' && <small>Use at least 12 characters.</small>}</label>}
      {error && <Notice>{error}</Notice>}{recovery && <><Notice kind="success">{recovery.message}</Notice>{recovery.delivery === 'local' && <DeliveryNotice generic />}</>}
      <button className="button primary full-width" type="submit" disabled={busy}>{busy ? <Spinner /> : <ArrowRight size={17} />}{forgot ? 'Request recovery link' : mode === 'register' ? 'Create workspace' : 'Sign in'}</button>
      {!forgot && mode === 'login' && <button className="text-button" type="button" disabled={busy} onClick={() => { setForgot(true); setError(''); }}>Forgot password?</button>}
      {forgot && <button className="text-button" type="button" disabled={busy} onClick={() => { setForgot(false); setRecovery(null); setError(''); }}>Back to sign in</button>}
      {onBack && <button className="text-button" type="button" disabled={busy} onClick={onBack}>Back to invitation</button>}
    </form><p className="auth-note">Your account and agent configuration are stored by this local GuideKit instance.</p>
  </div></section>;
  return compact ? <div className="compact-auth">{panel}</div> : <main className="auth-layout"><section className="auth-story"><Brand light /><div className="auth-copy"><h1>Your product.<br />A guide that knows it.</h1><p>Bring your company knowledge and website together. Publish a visual assistant that helps people move from a question to a completed task.</p><div className="connection-demo" aria-hidden="true"><div className="connection-source"><BookOpen size={22} /><span>Your knowledge</span><small>Docs, answers, instructions</small></div><div className="connection-line"><span /></div><div className="connection-guide"><span className="mini-orb"><Sparkles size={20} /></span><span>Your website guide</span><small>Explain. Show. Help.</small></div></div></div><div className="auth-foot"><ShieldCheck size={17} /><span>Local runtime. Company-scoped knowledge. Actions you control.</span></div></section>{panel}</main>;
}
