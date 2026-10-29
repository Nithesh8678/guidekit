import { useEffect, useRef, useState, type FormEvent } from 'react';
import { BookOpen, FileText, Layers3, Pencil, Plus, Save, Trash2, Upload, X } from 'lucide-react';
import type { AgentDetail, KnowledgeDocument } from '@guidekit/contracts';
import { api, emptyDocumentDraft, errorMessage, Notice, Spinner, type DocumentDraft } from './shared';

const MAX_DOCUMENT_BYTES = 256 * 1024;
interface Props {
  detail: AgentDetail; busy: boolean; draft: DocumentDraft; dirty: boolean;
  examples: { title: string; content: string; label: string }[];
  onDraftChange(draft: DocumentDraft): void; onBusyChange(busy: boolean): void;
  onChanged(message: string): Promise<void>; onError(message: string): void;
}
export function Knowledge({ detail, busy, draft, dirty, examples, onDraftChange, onBusyChange, onChanged, onError }: Props) {
  const [working, setWorking] = useState(''), [dragging, setDragging] = useState(false), [error, setError] = useState(''), [expanded, setExpanded] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null), titleRef = useRef<HTMLInputElement>(null), workingRef = useRef(false), mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  function begin(key: string) { if (busy || workingRef.current) return false; workingRef.current = true; setWorking(key); onBusyChange(true); return true; }
  function end() { workingRef.current = false; if (mountedRef.current) setWorking(''); onBusyChange(false); }
  function change(next: DocumentDraft) { setError(''); onDraftChange(next); }
  function replace(next: DocumentDraft) {
    if (busy || workingRef.current || (dirty && !window.confirm('Discard unsaved document changes?'))) return;
    change(next); titleRef.current?.focus();
  }
  async function readFile(file: File | undefined) {
    if (!file || busy || workingRef.current) return;
    setError('');
    if (!/\.(txt|md)$/i.test(file.name)) { setError('Choose a .txt or .md file. Other formats are not supported yet.'); return; }
    if (file.size > MAX_DOCUMENT_BYTES) { setError('This file is larger than 256 KB. Split it into smaller documents.'); return; }
    if (dirty && !window.confirm('Replace unsaved document changes with this file?')) return;
    if (!begin('read')) return;
    try {
      const content = await file.text();
      if (content.includes('\u0000')) throw new Error('This file contains binary data. Choose a plain text document.');
      if (mountedRef.current) change({ id: draft.id, title: file.name.replace(/\.(txt|md)$/i, ''), content });
    } catch (failure) { if (mountedRef.current) setError(errorMessage(failure)); }
    finally { if (fileRef.current) fileRef.current.value = ''; end(); }
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy || workingRef.current) return;
    setError(''); onError('');
    if (!draft.title.trim() || !draft.content.trim()) { setError('Add a title and document text before saving.'); return; }
    if (new TextEncoder().encode(draft.content).length > MAX_DOCUMENT_BYTES) { setError('Keep each document under 256 KB.'); return; }
    if (!begin('save')) return;
    try {
      await api(`/api/agents/${detail.agent.id}/documents${draft.id ? `/${draft.id}` : ''}`, { method: draft.id ? 'PUT' : 'POST', body: JSON.stringify({ title: draft.title, content: draft.content }) });
      onDraftChange(emptyDocumentDraft());
      await onChanged(draft.id ? 'Document updated in the draft. Existing versions keep their original knowledge.' : 'Knowledge added to the draft. Publish to make it available to new website sessions.');
    } catch (failure) { if (mountedRef.current) setError(errorMessage(failure)); }
    finally { end(); }
  }
  async function remove(document: KnowledgeDocument) {
    if (busy || workingRef.current || !window.confirm(`Remove “${document.title}” from the draft? Published versions keep their existing knowledge.${draft.id === document.id && dirty ? ' Unsaved edits to this document will be discarded.' : ''}`)) return;
    if (!begin(document.id)) return;
    setError(''); onError('');
    try { await api(`/api/agents/${detail.agent.id}/documents/${document.id}`, { method: 'DELETE' }); if (draft.id === document.id) onDraftChange(emptyDocumentDraft()); await onChanged('Document removed from the draft. Published versions are unchanged.'); }
    catch (failure) { if (mountedRef.current) setError(errorMessage(failure)); }
    finally { end(); }
  }
  const bytes = new TextEncoder().encode(draft.content).length;
  return <div className="knowledge-layout"><div>
    <div className="section-intro"><h2>{draft.id ? 'Edit draft document' : 'Give your guide the right context'}</h2><p>{draft.id ? 'Save a new draft revision. Published snapshots keep their original text.' : 'Add product documentation, company policies, and task instructions. Answers can cite these sources.'}</p></div>
    <form onSubmit={save} className="knowledge-form" aria-busy={!!working}>
      <div className={`upload-zone ${dragging ? 'dragging' : ''}`} onDragOver={event => { event.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); void readFile(event.dataTransfer.files[0]); }}><Upload size={24} /><strong>{draft.id ? 'Replace document text from a file' : 'Drop a document here'}</strong><span>Plain text or Markdown, up to 256 KB</span><button className="button secondary small" type="button" disabled={busy} onClick={() => fileRef.current?.click()}>Choose file</button><input ref={fileRef} type="file" disabled={busy} aria-label="Upload knowledge document" accept=".txt,.md,text/plain,text/markdown" className="sr-only" onChange={event => void readFile(event.target.files?.[0])} /></div>
      <div className="or-divider"><span>or paste your knowledge</span></div>
      <label>Document title<input ref={titleRef} disabled={busy} required value={draft.title} onChange={event => change({ ...draft, title: event.target.value })} minLength={1} maxLength={180} placeholder="Getting started with our product" /></label>
      <label>Document text<textarea aria-label="Document text" disabled={busy} required rows={9} value={draft.content} onChange={event => change({ ...draft, content: event.target.value })} placeholder="Add the information your agent should use when helping visitors…" aria-describedby="document-size" /><small id="document-size" className={bytes > MAX_DOCUMENT_BYTES ? 'field-error' : ''}>{(bytes / 1024).toFixed(1)} KB / 256 KB. Text is stored as knowledge; it does not retrain the model.</small></label>
      {!draft.id && <div className="example-row"><span>Try a demo document:</span>{examples.map(example => <button key={example.label} type="button" className="text-button" disabled={busy} onClick={() => replace({ id: null, title: example.title, content: example.content })}>{example.label}</button>)}</div>}
      {error && <Notice>{error}</Notice>}
      <div className="document-form-actions"><button className="button primary" disabled={busy || !dirty || !draft.title.trim() || !draft.content.trim() || bytes > MAX_DOCUMENT_BYTES} type="submit">{working === 'save' ? <Spinner /> : draft.id ? <Save size={16} /> : <Plus size={16} />}{draft.id ? 'Save document' : 'Add document'}</button>{(draft.id || dirty) && <button className="button secondary" disabled={busy} type="button" onClick={() => { change(emptyDocumentDraft()); titleRef.current?.focus(); }}><X size={15} />{draft.id ? 'Cancel editing' : 'Clear document'}</button>}</div>
      {dirty && <p className="document-unsaved" role="status">Unsaved document changes. Save this document before publishing.</p>}
    </form>
  </div><aside className="knowledge-library"><div className="library-heading"><h3>Draft knowledge</h3><span className="badge badge-neutral">{detail.documents.length}</span></div>
    {!detail.documents.length ? <div className="empty-state"><div className="empty-icon"><BookOpen size={23} /></div><h3>A clean starting point</h3><p>Add your first document. Published agents use a snapshot of this library.</p></div> : <div className="document-list">{detail.documents.map(document => <article className="document-item" key={document.id}><div className="document-row"><FileText size={19} /><button className="document-title" aria-expanded={expanded === document.id} onClick={() => setExpanded(current => current === document.id ? null : document.id)}><strong>{document.title}</strong><small>{Math.max(1, Math.ceil(new TextEncoder().encode(document.content).length / 1024))} KB · {new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(document.createdAt))}</small></button><button className="icon-button document-edit" aria-label={`Edit ${document.title}`} disabled={busy} onClick={() => replace({ id: document.id, title: document.title, content: document.content })}><Pencil size={16} /></button><button className="icon-button delete-button" aria-label={`Delete ${document.title}`} disabled={busy} onClick={() => void remove(document)}>{working === document.id ? <Spinner /> : <Trash2 size={16} />}</button></div>{expanded === document.id && <pre className="document-preview">{document.content}</pre>}</article>)}</div>}
    <p className="library-note"><Layers3 size={16} />Publishing freezes the current documents into a version. Editing this library changes the draft.</p>
  </aside></div>;
}
