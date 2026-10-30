import { useEffect, useState } from 'react';
import { api, errorMessage, Notice, Spinner } from './shared';

interface Metrics { periodStart: string; statuses: { status: string; count: number; averageDurationMs: number | null }[]; workspaceUsage: { runs: number; dailyLimit: number; remaining: number }; }
export function ActivityMetrics({ agentId, refreshKey }: { agentId: string; refreshKey: number }) {
  const [metrics, setMetrics] = useState<Metrics | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    api<Metrics>(`/api/agents/${agentId}/metrics`, { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setMetrics(value); }).catch(failure => { if (!controller.signal.aborted) setError(errorMessage(failure)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); return () => controller.abort();
  }, [agentId, refreshKey, attempt]);
  return <section className="activity-metrics" aria-label="Request usage" aria-busy={loading}>{error ? <Notice>{error} <button className="text-button" onClick={() => setAttempt(value => value + 1)}>Retry usage</button></Notice> : !metrics ? <p role="status"><Spinner /> Loading request usage…</p> : <><p className="usage-summary"><strong>Workspace requests today (UTC)</strong><span>{metrics.workspaceUsage.runs.toLocaleString()} / {metrics.workspaceUsage.dailyLimit.toLocaleString()} used · {metrics.workspaceUsage.remaining.toLocaleString()} remaining across all agents</span></p>{metrics.statuses.length ? <div className="metrics-table-wrap"><table><caption>This agent since {new Date(metrics.periodStart).toLocaleDateString(undefined, { timeZone: 'UTC' })} (UTC)</caption><thead><tr><th>Status</th><th>Requests</th><th>Average duration</th></tr></thead><tbody>{metrics.statuses.map(item => <tr key={item.status}><td>{item.status.replaceAll('_', ' ')}</td><td>{item.count.toLocaleString()}</td><td>{item.averageDurationMs === null ? '—' : `${Math.round(item.averageDurationMs).toLocaleString()} ms`}</td></tr>)}</tbody></table></div> : <p className="muted">No requests recorded for this agent today.</p>}</>}</section>;
}
