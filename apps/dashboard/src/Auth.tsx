import { useId, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Check, Sparkles } from 'lucide-react';
import type { Workspace } from '@guidekit/contracts';
import { api, Brand, DeliveryNotice, errorMessage, Notice, Spinner } from './shared';
import './platform-auth.css';

interface Props {
  onAuthenticated(workspace: Workspace): void;
  initialMode?: 'register' | 'login';
  initialEmail?: string;
  lockEmail?: boolean;
  allowRegister?: boolean;
  compact?: boolean;
  message?: string;
  onBack?(): void;
  onHome?(): void;
  onModeChange?(mode: 'register' | 'login'): void;
}

export function Auth({ onAuthenticated, initialMode = 'register', initialEmail = '', lockEmail = false, allowRegister = true, compact = false, message, onBack, onHome, onModeChange }: Props) {
  const passwordHintId = useId();
  const [mode, setMode] = useState(initialMode), [email, setEmail] = useState(initialEmail), [busy, setBusy] = useState(false), [error, setError] = useState(''), [forgot, setForgot] = useState(false), [recovery, setRecovery] = useState<{ message: string; delivery: string } | null>(null);
  function changeMode(next: 'register' | 'login') { setMode(next); setForgot(false); setError(''); setRecovery(null); onModeChange?.(next); }
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
  const panel = <section className="auth-panel"><div className="auth-form-wrap">
    <div className="auth-form-intro"><span className="auth-form-icon" aria-hidden="true"><Sparkles size={22} /></span><h1>{forgot ? 'A fresh start.' : mode === 'register' ? 'Let’s build your guide.' : 'Good to see you again.'}</h1><p className="muted">{forgot ? 'Enter your email to request a password reset link.' : mode === 'register' ? 'Create a workspace. Make your product easier to use.' : 'Your workspace, your agents, your next great idea.'}</p></div>
    {message && <Notice kind="success">{message}</Notice>}
    <form onSubmit={submit} className="stack-form" key={`${mode}:${forgot}`} aria-busy={busy}>
      {!forgot && mode === 'register' && <div className="auth-name-fields"><label>Your name<input name="name" placeholder="Alex Chen" autoComplete="name" required minLength={2} maxLength={100} disabled={busy} /></label><label>Company name<input name="companyName" placeholder="Your company" autoComplete="organization" required minLength={2} maxLength={100} disabled={busy} /></label></div>}
      <label>Email address<input name="email" type="email" placeholder="you@company.com" autoComplete="email" required maxLength={200} value={email} readOnly={lockEmail} disabled={busy} onChange={event => { setEmail(event.target.value); setError(''); setRecovery(null); }} /></label>
      {!forgot && <label>Password<input name="password" type="password" aria-label="Password" aria-describedby={mode === 'register' ? passwordHintId : undefined} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required minLength={mode === 'register' ? 12 : 1} maxLength={256} disabled={busy} />{mode === 'register' && <small id={passwordHintId}>At least 12 characters. Make it something only you know.</small>}</label>}
      {error && <Notice>{error}</Notice>}{recovery && <><Notice kind="success">{recovery.message}</Notice>{recovery.delivery === 'local' && <DeliveryNotice generic />}</>}
      {!forgot && mode === 'login' && <button className="auth-recovery text-button" type="button" disabled={busy} onClick={() => { setForgot(true); setError(''); }}>Forgot password?</button>}
      <button className="button primary full-width auth-submit" type="submit" disabled={busy}>{busy ? <Spinner /> : null}{forgot ? 'Request recovery link' : mode === 'register' ? 'Create workspace' : 'Sign in'}{!busy && <ArrowRight size={18} />}</button>
      {forgot && <button className="text-button" type="button" disabled={busy} onClick={() => { setForgot(false); setRecovery(null); setError(''); }}>Back to sign in</button>}
      {onBack && <button className="text-button" type="button" disabled={busy} onClick={onBack}>Back to invitation</button>}
    </form>
    {!forgot && allowRegister && <p className="auth-switch">{mode === 'register' ? 'Already have a workspace?' : 'New to GuideKit?'} <button type="button" disabled={busy} onClick={() => changeMode(mode === 'register' ? 'login' : 'register')}>{mode === 'register' ? 'Sign in' : 'Create a workspace'}</button></p>}
    <p className="auth-note">Your account is stored securely by this GuideKit instance.</p>
  </div></section>;
  if (compact) return <div className="compact-auth platform-compact-auth">{panel}</div>;
  return <main className="platform-auth">
    <section className="platform-auth-story"><a className="platform-auth-brand" href="#" onClick={event => { if (onHome) { event.preventDefault(); onHome(); } }} aria-label="GuideKit home"><Brand /></a><div className="platform-auth-story-copy"><h2>A little guidance.<br />A lot more possibility.</h2><p>Give every person using your product a guide that knows the way.</p></div><div className="platform-auth-art"><img src="/assets/guide-path.webp" alt="" /><div className="platform-auth-caption"><span><Check size={14} /> Your knowledge, in action</span><p>From “how do I?” to “already done.”</p></div></div><p className="platform-auth-foot">Built for the people behind the product.</p></section>
    <div className="platform-auth-form-side"><a className="platform-auth-back" href="#" onClick={event => { if (onHome) { event.preventDefault(); onHome(); } }}><ArrowLeft size={15} /> Back to website</a>{panel}<footer className="platform-auth-bottom"><span>GuideKit</span><span>A better way to show the way.</span></footer></div>
  </main>;
}
