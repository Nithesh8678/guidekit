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
- POST /api/agents/:id/publish -> { version: AgentVersion }
- GET /api/runtime/status -> RuntimeStatus

No document file multipart needed: frontend reads .txt/.md <=256KB and submits text. No URL crawling or PDF claimed. Config requires allowedOrigins (exact HTTP(S) origins), allowedActions string[]. Demo defaults: http://127.0.0.1:4411 and http://127.0.0.1:4412. Install uses script src=http://127.0.0.1:4410/sdk/guidekit.js data-agent-id=AGENT_ID data-endpoint=http://127.0.0.1:4410. Demo links /?agentId=ID at each demo origin.

## Embed protocol
- POST /api/embed/:agentId/session {} (Origin required) -> { token, expiresAt, agent: PublicAgent }. Public published knowledge only; not authorization for private host operations.
- POST /api/embed/session/ask AskSchema (Bearer, same Origin) -> RunResult. AbortSignal cancels inference; requestId provides idempotent retry.
- POST /api/embed/session/action-result ActionResultSchema -> { ok: true }. Receipt must belong to session/run. Only pending -> terminal once; cancelled/failed never shown as success.

SDK registers descriptors/functions through GuideKit.mount({agentId, endpoint, actions, getContext?, hotkey?}). actions: Record<string, {description, inputSchema, requiresConfirmation:true, execute(args, {signal, idempotencyKey}): Promise<{success:boolean,message:string}>, validate?(args):boolean}>. SDK must validate args against JSON Schema (use Ajv dependency requested to coordinator), allowlisted name, and agent allowedActions, always require explicit confirmation. RunResult steps targetIds only from context; missing target stops guidance, never auto-click arbitrary DOM. Auto-discovery uses data-guidekit-id or synthetic map IDs for visible semantic controls, excluding SDK and data-guidekit-private.

Browser auto install exposes window.GuideKit = { mount, registerAction, setContext, open, close, destroy }. Host registration may occur before or after auto-mount via event guidekit:ready. Must support plain static pages and crossorigin SDK API, no React required in SDK.

## Restricted model provider (runtime agent)
Export createCodexProvider(options?: {model?:string;bin?:string;cwd?:string}) -> {status():Promise<RuntimeStatus>; infer(input:{prompt:string;schema:Record<string,unknown>;signal?:AbortSignal}):Promise<string>; close():Promise<void>}. Result is schema-constrained model JSON; server validates modelPlanSchema and filters citation/target/action IDs. Never enable arbitrary shell/web/network model tools or borrow secrets into app env. Existing official local login; no paid fallback. Runtime files only agent-owned. Server creates prompt and selects published knowledge. Status must distinguish installed/authenticated from completed live inference.
