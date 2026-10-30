import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AgentDetail, Citation, KnowledgePath } from '@guidekit/contracts';
import { api, errorMessage, Notice, Spinner, versionStatus, type VersionSnapshot } from './shared';

interface Preview { version: number; citations: Citation[]; knowledge: { source: 'local' | 'tigergraph'; paths: KnowledgePath[] }; sufficient: boolean; message: string; }
interface EvaluationCase { question: string; expectedDocumentIds: string[]; }
interface Evaluation { version: number; cases: { question: string; retrievedDocumentIds: string[]; recall: number; precision: number; reciprocalRank: number }[]; meanRecall: number; meanReciprocalRank: number; scope: string; }
const percent = (value: number) => `${Math.round(value * 100)}%`;
export function RetrievalTools({ detail, disabled }: { detail: AgentDetail; disabled: boolean }) {
  const ready = detail.versions.filter(version => versionStatus(version) === 'ready'), readyKey = ready.map(version => version.number).join(',');
  const preferred = ready.find(item => item.number === detail.agent.publishedVersion)?.number ?? ready[0]?.number ?? 0;
  const [version, setVersion] = useState(preferred), [snapshot, setSnapshot] = useState<VersionSnapshot | null>(null), [question, setQuestion] = useState(''), [expected, setExpected] = useState<string[]>([]), [cases, setCases] = useState<EvaluationCase[]>([]);
  const [preview, setPreview] = useState<(Preview & { question: string }) | null>(null), [evaluation, setEvaluation] = useState<Evaluation | null>(null), [working, setWorking] = useState(''), [error, setError] = useState(''), [attempt, setAttempt] = useState(0), [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const job = useRef<AbortController | null>(null);
  useEffect(() => { if (!ready.some(item => item.number === version)) setVersion(preferred); }, [readyKey, preferred, version]);
  useEffect(() => {
    job.current?.abort(); setWorking(''); setSnapshot(null); setPreview(null); setEvaluation(null); setCases([]); setExpected([]); setError('');
    if (!version) return;
    const controller = new AbortController(); setLoadingSnapshot(true);
    api<VersionSnapshot>(`/api/agents/${detail.agent.id}/versions/${version}`, { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setSnapshot(value); }).catch(failure => { if (!controller.signal.aborted) setError(errorMessage(failure)); }).finally(() => { if (!controller.signal.aborted) setLoadingSnapshot(false); });
    return () => { controller.abort(); job.current?.abort(); };
  }, [detail.agent.id, version, attempt]);
  async function run(kind: 'preview' | 'evaluate') {
    if (working || disabled || !snapshot || (kind === 'preview' ? !question.trim() : !cases.length)) return;
    const controller = new AbortController(); job.current = controller; setWorking(kind); setError('');
    try {
      if (kind === 'preview') { setPreview(null); const result = await api<Preview>(`/api/agents/${detail.agent.id}/knowledge-preview`, { method: 'POST', signal: controller.signal, body: JSON.stringify({ version, question: question.trim() }) }); if (!controller.signal.aborted) setPreview({ ...result, question: question.trim() }); }
      else { setEvaluation(null); const result = await api<Evaluation>(`/api/agents/${detail.agent.id}/knowledge-evaluate`, { method: 'POST', signal: controller.signal, body: JSON.stringify({ version, cases }) }); if (!controller.signal.aborted) setEvaluation(result); }
    } catch (failure) { if (!controller.signal.aborted) setError(errorMessage(failure)); }
    finally { if (!controller.signal.aborted) setWorking(''); }
  }
  function addCase(event: FormEvent) { event.preventDefault(); if (cases.length >= 10 || !question.trim() || !expected.length) return; setCases(current => [...current, { question: question.trim(), expectedDocumentIds: [...expected] }]); setEvaluation(null); setExpected([]); }
  const title = (id: string) => snapshot?.documents.find(document => document.id === id)?.title ?? id;
  return <section className="retrieval-tools" aria-labelledby="retrieval-title"><div className="section-intro"><h2 id="retrieval-title">Test published knowledge</h2><p>Preview source retrieval without generating a model answer. Tests use a ready, immutable snapshot and exclude your unsaved document editor.</p></div>
    {!ready.length ? <Notice kind="info">Publish a ready version before testing retrieval.</Notice> : <>
      <label>Knowledge snapshot<select aria-label="Knowledge snapshot" value={version} disabled={disabled || !!working} onChange={event => setVersion(Number(event.target.value))}>{ready.map(item => <option key={item.number} value={item.number}>Version {item.number}{item.number === detail.agent.publishedVersion ? ' · active' : ''}</option>)}</select></label>
      {loadingSnapshot && <p role="status"><Spinner /> Loading snapshot sources…</p>}{error && <Notice>{error} {!snapshot && <button className="text-button" onClick={() => setAttempt(value => value + 1)}>Retry snapshot sources</button>}</Notice>}
      {snapshot && <><form className="retrieval-form" onSubmit={event => { event.preventDefault(); void run('preview'); }}><label>Retrieval test question<input aria-label="Retrieval test question" required maxLength={500} value={question} disabled={disabled || !!working} onChange={event => { setQuestion(event.target.value); setError(''); }} placeholder="Where do customers find their invoices?" /></label><button className="button secondary small" disabled={disabled || !!working || !question.trim()}>{working === 'preview' ? <Spinner /> : null}Preview retrieved sources</button></form>
        {preview && <div className="retrieval-result" aria-live="polite"><h3>Sources for “{preview.question}” · v{preview.version}</h3><p className="muted">{preview.knowledge.source === 'tigergraph' ? 'Retrieved with TigerGraph relationships.' : 'Retrieved with local full-text search.'}</p><Notice kind={preview.sufficient ? 'info' : 'error'}>{preview.message}</Notice>{preview.citations.map((citation, index) => <article className="retrieval-source" key={`${citation.documentId}:${index}`}><h3>{citation.title}</h3><p>{citation.excerpt}</p></article>)}{!!preview.knowledge.paths.length && <details><summary>TigerGraph relationship paths</summary><ul>{preview.knowledge.paths.map((path, index) => <li key={index}>{path.nodes.map((node, index) => index === 1 ? node : title(node)).join(' → ')}<small>{path.relation}</small></li>)}</ul></details>}</div>}
        <details className="retrieval-evaluation"><summary>Evaluate a temporary question set</summary><p className="muted">Choose the documents you expect for the question above, then add up to 10 cases. Changing snapshots clears this temporary set. Scores measure source retrieval, not generated-answer quality or factual correctness.</p><form onSubmit={addCase}><fieldset disabled={disabled || !!working || cases.length >= 10}><legend>Expected source documents (up to 8)</legend>{snapshot.documents.map(document => <label className="source-choice" key={document.id}><input type="checkbox" checked={expected.includes(document.id)} disabled={!expected.includes(document.id) && expected.length >= 8} onChange={event => setExpected(current => event.target.checked ? [...current, document.id] : current.filter(id => id !== document.id))} />{document.title}</label>)}</fieldset><button className="button secondary small" disabled={disabled || !!working || !question.trim() || !expected.length || cases.length >= 10}>Add evaluation case</button></form>
          {!!cases.length && <><ol className="evaluation-cases">{cases.map((item, index) => <li key={index}><div><strong>{item.question}</strong><small>Expected: {item.expectedDocumentIds.map(title).join(', ')}</small></div><button className="text-button" disabled={!!working} aria-label={`Remove evaluation case ${index + 1}`} onClick={() => { setCases(current => current.filter((_, at) => at !== index)); setEvaluation(null); }}>Remove</button></li>)}</ol><button className="button secondary small" disabled={disabled || !!working} onClick={() => void run('evaluate')}>{working === 'evaluate' ? <Spinner /> : null}Evaluate {cases.length} {cases.length === 1 ? 'case' : 'cases'}</button></>}
          {evaluation && <div className="evaluation-result" role="status"><p>Version {evaluation.version}: mean recall {percent(evaluation.meanRecall)} · mean reciprocal rank {evaluation.meanReciprocalRank.toFixed(2)}</p><div className="metrics-table-wrap"><table><caption>Retrieval-only evaluation results</caption><thead><tr><th>Question</th><th>Recall</th><th>Precision</th><th>Reciprocal rank</th></tr></thead><tbody>{evaluation.cases.map((item, index) => <tr key={index}><td>{item.question}</td><td>{percent(item.recall)}</td><td>{percent(item.precision)}</td><td>{item.reciprocalRank.toFixed(2)}</td></tr>)}</tbody></table></div><p className="muted">{evaluation.scope}</p></div>}
        </details>
      </>}
    </>}
  </section>;
}
