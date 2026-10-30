import { useEffect, useRef, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import type { Workspace, WorkspaceRole } from '@guidekit/contracts';
import { Auth } from './Auth';
import { api, errorMessage, Notice, Spinner } from './shared';

export interface AccountLink { kind: 'reset' | 'verify' | 'invite' | 'invalid'; token: string; }
export function readAccountLink(): AccountLink | null {
  if (!location.hash.startsWith('#account/')) return null;
  const match = location.hash.match(/^#account\/(reset|verify|invite)\?token=([A-Za-z0-9_-]{43})$/);
  return match ? { kind: match[1] as AccountLink['kind'], token: match[2]! } : { kind: 'invalid', token: '' };
}
export function clearAccountLink() { history.replaceState(null, '', `${location.pathname}${location.search}`); }
interface Props { link: AccountLink; workspace: Workspace | null; onAuthenticated(workspace: Workspace): void; onClose(): void; onComplete(message: string, workspace?: Workspace | null): void; }
export function AccountLinkFlow({ link, workspace, onAuthenticated, onClose, onComplete }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [preview, setPreview] = useState<{ email: string; companyName: string; role: WorkspaceRole } | null>(null), [login, setLogin] = useState(false);
  useEffect(() => { const previous = document.activeElement, dialog = dialogRef.current; dialog?.showModal(); return () => { dialog?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); }; }, []);
  useEffect(() => {
    if (link.kind !== 'invite') return;
    const controller = new AbortController(); setBusy(true);
    api<{ email: string; companyName: string; role: WorkspaceRole }>('/api/auth/invitations/preview', { method: 'POST', body: JSON.stringify({ token: link.token }), signal: controller.signal }).then(value => { if (!controller.signal.aborted) setPreview(value); }).catch(failure => { if (!controller.signal.aborted) setError(errorMessage(failure)); }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [link.kind, link.token]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || link.kind === 'invalid') return;
    const form = event.currentTarget, data = new FormData(form); setBusy(true); setError('');
    try {
      if (link.kind === 'reset') {
        if (data.get('password') !== data.get('confirm')) throw new Error('The new passwords do not match.');
        await api('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ token: link.token, password: String(data.get('password')) }) }); form.reset(); onComplete('Password reset. Sign in with your new password.', null);
      } else if (link.kind === 'verify') { await api('/api/auth/verify', { method: 'POST', body: JSON.stringify({ token: link.token }) }); onComplete('Email address verified.'); }
      else {
        const signedIn = workspace?.user.email.toLowerCase() === preview?.email.toLowerCase();
        const result = await api<{ workspace: Workspace }>('/api/auth/invitations/accept', { method: 'POST', body: JSON.stringify({ token: link.token, ...(!signedIn ? { name: String(data.get('name')), password: String(data.get('password')) } : {}) }) }); form.reset(); onComplete(`Joined ${result.workspace.tenant.name}.`, result.workspace);
      }
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  const signedIn = workspace?.user.email.toLowerCase() === preview?.email.toLowerCase();
  return <dialog ref={dialogRef} className="create-dialog account-link-dialog" aria-labelledby="account-link-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}><div className="snapshot-heading"><h2 id="account-link-title">{link.kind === 'reset' ? 'Reset your password' : link.kind === 'verify' ? 'Verify your email' : link.kind === 'invite' ? 'Workspace invitation' : 'Invalid account link'}</h2><button className="icon-button" aria-label="Close account link" disabled={busy} onClick={onClose}><X size={20} /></button></div>
    {link.kind === 'invalid' ? <Notice>This account link is malformed. Request a fresh link from the local operator.</Notice> : login && preview ? <Auth compact initialMode="login" initialEmail={preview.email} lockEmail allowRegister={false} onAuthenticated={value => { onAuthenticated(value); setLogin(false); setError(''); }} onBack={() => setLogin(false)} /> : <>
      <p className="muted">{link.kind === 'reset' ? 'Choose a new password. Other dashboard sessions will be signed out.' : link.kind === 'verify' ? 'Confirm this single-use link to verify its email address.' : preview ? `Join ${preview.companyName} as ${preview.role}. This invitation is for ${preview.email}.` : 'Checking the invitation…'}</p>
      {error && <Notice>{error}</Notice>}
      <form className="stack-form" onSubmit={submit} aria-busy={busy}>
        {link.kind === 'reset' && <><label>New password<input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={256} disabled={busy} /></label><label>Confirm new password<input name="confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={256} disabled={busy} /></label></>}
        {link.kind === 'invite' && preview && !signedIn && <><p className="muted">Create the invited account below, or sign in if this email already has an account.{workspace ? ` You are currently signed in as ${workspace.user.email}.` : ''}</p><label>Your name<input name="name" autoComplete="name" required minLength={2} maxLength={100} disabled={busy} /></label><label>New account password<input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={256} disabled={busy} /></label><button className="button secondary" type="button" disabled={busy} onClick={() => setLogin(true)}>Sign in to invited account</button></>}
        <button className="button primary" disabled={busy || (link.kind === 'invite' && !preview)} type="submit">{busy ? <Spinner /> : null}{link.kind === 'reset' ? 'Reset password' : link.kind === 'verify' ? 'Verify email address' : signedIn ? 'Accept invitation' : 'Create account and join'}</button>
      </form>
    </>}<div className="dialog-actions"><button className="button secondary" disabled={busy} onClick={onClose}>Cancel account link</button></div>
  </dialog>;
}
