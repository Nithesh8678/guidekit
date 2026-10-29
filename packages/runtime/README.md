# Local subscription runtime

`createCodexProvider()` uses the installed official Codex app-server over stdio
and the owner's existing ChatGPT login. Run `codex login` before starting the
application. The provider never reads authentication files, supplies API keys,
or falls back to paid API usage.

Each inference starts a fresh ephemeral read-only thread in a private temporary
directory. Shell, web, connectors, plugins, hooks, browser/computer use, memory,
and subagents are disabled with process-scoped configuration. The effective
configuration is checked before a model turn. Unexpected tool activity stops
the process. Temporary state is removed after completion or cancellation.

The catalog's default model is resolved at runtime, because an installed CLI's
saved model name can differ from models accepted by the current ChatGPT plan.
An explicit `model` option must be present in that account's advertised catalog.
`outputSchema` constrains the final JSON; the application must still validate
and authorize every target, citation, and proposed action before use.

`status()` reports login separately from a completed inference in this process.
Only `infer()` success records live verification. A 90-second timeout and caller
AbortSignal terminate inference. Codex stderr and account metadata are never
forwarded to the UI or logs.

This is a local single-owner demo integration. It must not be exposed as a
shared hosted service using the owner's subscription.

Verified 2026-10-29 with installed Codex 0.151.0: live structured JSON inference
using the account-advertised default model, with zero tool items observed.
The protocol fixture tests cover authentication, capability enforcement,
unexpected tools, cancellation, invalid JSON, and status boundaries.

References: [App-server protocol](https://learn.chatgpt.com/docs/app-server),
[configuration](https://learn.chatgpt.com/docs/config-file/config-reference),
[plan usage limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).
