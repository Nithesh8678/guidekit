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

Browser auto install exposes window.GuideKit = { mount, registerAction, setContext, open, close, startVoice, stopVoice, reportStepResult, destroy }. Host registration may occur before or after auto-mount via event guidekit:ready. Must support plain static pages and crossorigin SDK API, no React required in SDK.

## Restricted model provider (runtime agent)
Export createCodexProvider(options?: {model?:string;bin?:string;cwd?:string}) -> {status():Promise<RuntimeStatus>; infer(input:{prompt:string;schema:Record<string,unknown>;signal?:AbortSignal}):Promise<string>; close():Promise<void>}. Result is schema-constrained model JSON; server validates modelPlanSchema and filters citation/target/action IDs. Never enable arbitrary shell/web/network model tools or borrow secrets into app env. Existing official local login; no paid fallback. Runtime files only agent-owned. Server creates prompt and selects published knowledge. Status must distinguish installed/authenticated from completed live inference.

Local `reportStepResult(targetId, {success, message?})` reports a host-verified manual website outcome to the active guide. It never invokes a host action or writes a server receipt. Native form observation remains local; only known safe target IDs and bounded public context reach inference.

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
