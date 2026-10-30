# API and ownership contract

Shared types: packages/contracts/src/index.ts. All JSON errors: { error: string }. Browser admin requests use credentials: 'include'. Auth is a persistent HttpOnly cookie, mutations require exact permitted dashboard Origin. Runtime embed requests omit cookies and use Bearer token.

## Dashboard API
- GET /api/auth/me -> { workspace: Workspace | null }
- POST /api/auth/register { email, password (12+), name, companyName } -> { workspace }
- POST /api/auth/login { email, password } -> { workspace }
- POST /api/auth/logout -> { ok: true }
- GET /api/agents -> { agents: Agent[] }
- POST /api/agents AgentConfig -> { agent: Agent }
- GET /api/agents/:id -> AgentDetail
- PUT /api/agents/:id AgentConfig -> { agent }
- POST /api/agents/:id/documents { title, content } -> { document }
- DELETE /api/agents/:id/documents/:documentId -> { ok: true }
- POST /api/agents/:id/publish -> { version: AgentVersion, activeVersion: number | null } (201 includes a failed candidate; inspect its status)
- GET /api/runtime/status -> RuntimeStatus

No document file multipart needed: frontend reads .txt/.md <=256KB and submits text. No URL crawling or PDF claimed. Config requires allowedOrigins (exact HTTP(S) origins), allowedActions string[]. Demo defaults: http://127.0.0.1:4411 and http://127.0.0.1:4412. Install reads /sdk/manifest.json and pins a content-hash script path with SHA-384 integrity and anonymous crossorigin. /sdk/guidekit.js is a development alias. Demo links /?agentId=ID at each demo origin.

## Embed protocol
- POST /api/embed/:agentId/session {} (Origin required) -> { token, expiresAt, agent: PublicAgent }. Public published knowledge only; not authorization for private host operations.
- POST /api/embed/session/ask AskSchema (Bearer, same Origin) -> RunResult. AbortSignal cancels inference; requestId provides idempotent retry.
- POST /api/embed/session/action-result ActionResultSchema -> { ok: true }. Receipt must belong to session/run. Only pending -> terminal once; cancelled/failed never shown as success.

SDK registers descriptors/functions through GuideKit.mount({agentId, endpoint, actions, getContext?, hotkey?}). actions: Record<string, {description, inputSchema, requiresConfirmation:true, execute(args, {signal, idempotencyKey}): Promise<{success:boolean,message:string}>, validate?(args):boolean}>. SDK and server validate args using the shared bounded JSON Schema interpreter (no dynamic code generation, patterns or references), allowlisted name, and agent allowedActions, always require explicit confirmation. Supported schema types: object/array/string/number/integer/boolean/null; properties, required, enum/const and value bounds. Undeclared object keys fail closed. RunResult steps targetIds only from context; missing targets get a short same-ID recovery grace, then request a bounded fresh-context journey segment, or stop with manual recovery when adaptive guidance is disabled. Guidance never auto-clicks arbitrary DOM. Auto-discovery uses data-guidekit-id or synthetic map IDs for visible semantic controls, excluding SDK and data-guidekit-private.

Browser auto install exposes window.GuideKit = { capabilities, mount, registerAction, setContext, open, close, startVoice, stopVoice, reportStepResult, destroy }. Host registration may occur before or after auto-mount via event guidekit:ready. Must support plain static pages and crossorigin SDK API, no React required in SDK. Discovery shares at most 160 safe targets from at most 2,000 candidates; explicit mode bounds live resolution as well as collection. Trusted SVG/path clicks map through bounded local ancestry to a known safe HTML control; model output cannot supply selectors or scripts.

## Restricted model provider (runtime agent)
Export createCodexProvider(options?: {model?:string;bin?:string;cwd?:string}) -> {status():Promise<RuntimeStatus>; infer(input:{prompt:string;schema:Record<string,unknown>;signal?:AbortSignal}):Promise<string>; close():Promise<void>}. Result is schema-constrained model JSON; server validates modelPlanSchema and filters citation/target/action IDs. Never enable arbitrary shell/web/network model tools or borrow secrets into app env. Existing official local login; no paid fallback. Runtime files only agent-owned. Server creates prompt and selects published knowledge. Status must distinguish installed/authenticated from completed live inference.

## SDK 0.3 host workflow contract

These are local browser APIs, not new server action endpoints. The trusted runtime and its manifest advertise `hostWorkflowProgress: true` alongside `apiVersion: 1`, `explicitTargets: true` and `adaptiveJourneys: true`. The runtime capability object is frozen; the same SDK serves every company agent.

```ts
type GuideStepResult =
  | { status: 'pending'; message?: string; timeoutMs?: number }
  | { success: boolean; message?: string; scope?: 'step' | 'goal' };

reportStepResult(targetId: string, result: GuideStepResult): void;
setContext(publicContext: Record<string, unknown>, options?: {
  revision?: string | number;
}): void;
```

`reportStepResult` reports the trusted host's manual-operation observation. It never invokes a host action, grants authorization, writes a server receipt or replaces host validation. Native form observation remains local; only known safe target IDs and bounded public context reach inference. Result messages are at most 1,000 characters; the compact guidance hint displays at most 240.

| Report | Local behavior |
| --- | --- |
| `status: 'pending'` for the current known step | Wait for the host; suppress speculative continuation and accept its later outcome even if the target detaches. Default active deadline 120,000 ms; explicit integer `timeoutMs` 1,000–300,000. Repeated pending does not extend an active deadline. |
| `success: false` | Show recovery on the step; discard queued progress rather than automatically retrying the operation. |
| `success: true, scope: 'step'` | Record host-verified step evidence. A continuing segment may request the next scene; a final/done segment ends verified. |
| `success: true, scope: 'goal'` | End with a host-verified overall outcome. The host must actually verify that outcome. |
| `success: true`, scope omitted | Preserve legacy native-final-submit termination. A non-submit intermediate segment marked continue may proceed. |

Pause suspends a host deadline. Resume reapplies a deferred result once; cancellation/destroy clears timers and cannot be restarted by a late result. Without an explicit pending extension, final clicks use the ordinary 30-second confirmation window. A deadline reports an unverified outcome and never authorizes retry. Planner disposition `done`, including an answer with no steps, is informational; it cannot independently produce a verified completion event.

`setContext` sanitizes deliberately public context. Its optional semantic revision is a safe integer or a nonempty string of at most 160 characters without control characters. Revisions stay local and are not persisted in resume memory. Meaningful revision changes can trigger a continuation only at an expected continuing transition; arbitrary context updates, keystrokes, input values and geometry do not trigger per-change inference. Live scene snapshots include fresh synchronous/asynchronous `getContext()` with obsolete-read, cancellation and route guards.

`MountOptions.journey.maxContinuations` is an integer 1–24, default 6. Only one request runs at a time, completed evidence remains bounded to 24 entries, and server continuation requests still reject business-action proposals. Native file pickers/imports remain host operations; the SDK does not read file controls or media.

For Radix-style dialogs, only the SDK-owned overlay root uses `aria-live="off"` to participate in the `aria-hidden` library's live-region exemption. Authored child step announcements stay polite. Application/private hidden attributes and host focus traps are preserved. Hosts must scope any modal outside-interaction exception to their own SDK UI; native HTML dialog top-layer/inert support is a separate adapter concern.

## Platform completion additions

- PUT /api/agents/:id/documents/:documentId updates draft text only; duplicate content and size/capacity violations fail explicitly.
- Version metadata includes status preparing/syncing/ready/failed, graphSource, optional error/completedAt. GET /versions/:number inspects the immutable config/documents; POST /versions/:number/retry prepares that snapshot; POST /versions/:number/activate selects a ready snapshot; POST /unpublish stops new sessions. A release epoch fences stale network completions.
- GET /diagnostics reports the configured SDK endpoint/demo origins and actual active-snapshot permissions. It checks dependencies without generating a model answer.
- POST /knowledge-preview {question,version?} returns bounded citations, relationship evidence and an explicit no-source state. POST /knowledge-evaluate {version?,cases:[{question,expectedDocumentIds}]} supports up to ten cases and reports retrieval precision/recall/reciprocal rank, never generated-answer accuracy. GET /metrics returns aggregate outcomes/latency and workspace capacity.
- Optional AskSchema.journey contains id, revision, original goal, reason and at most24 completed target/label/role/evidence entries; no field values. RunResult.journey echoes id/revision/disposition. Automatic continuation cannot issue business-action proposals. Each request ID is bound to its full page/journey payload; legacy stored responses keep their earlier replay compatibility.
- MountOptions.targetMode explicit limits discovery and live resolution to host-authored targets. data-guidekit-label overrides personal accessible labels on explicit targets; privacy/visibility/identity checks still apply. SDK capabilities advertise this contract.
- Workspace exposes role and emailVerified. GET /api/account returns current membership, accessible workspaces and delivery mode. PUT /account/profile, POST /account/password, /account/revoke-sessions, /account/verification and /account/switch operate on the authenticated identity. POST /auth/forgot-password, /reset-password, /verify, /invitations/preview and /invitations/accept handle one-time links.
- GET /api/workspace/members lists the current organization; admin/owner invitation and member-role routes enforce live permissions. GET /workspace/audit is admin/owner only. Viewer agent mutations are denied server-side; retrieval preview/evaluation remain readable. Owners cannot be demoted/removed by these routes.
- Default account delivery writes a private local operator outbox. No external email transport is silently enabled. Tokens never enter API response URLs, browser persistent storage or audit details.
- GET /health is liveness; GET /ready distinguishes unavailable database/runtime/graph dependencies. The optional API-backed provider is selected at startup, never by an embed request.
