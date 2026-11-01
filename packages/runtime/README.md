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

The server may call `prepare()` when a visitor opens an assistant session. This
starts at most one fresh, restricted, **single-use** process ahead of demand. It
initializes the protocol, verifies restrictions and ChatGPT authentication, and
loads the model catalog; it sends no prompt and starts no thread or model turn.
An inference atomically claims this process, checks restrictions and account
identity again, and creates its own ephemeral thread. An account change fails
closed without using the cached catalog. The process is destroyed after that
one inference. Concurrent inferences claim separate processes.

After preparation has been explicitly enabled, claiming a process replenishes
at most one spare. An unclaimed spare expires after 60 seconds, including one
still starting up. Expiry never replenishes another spare, so an idle workspace
does not run a background preparation loop. Each claim receives a fresh
90-second inference deadline. Cancellation stops the claimed process; provider
shutdown stops all active and prepared processes and waits for state cleanup.
The existing server admission limit bounds active inference separately from the
one-spare limit. Without `prepare()`, inference keeps the original cold path.

The catalog's default model is resolved at runtime, because an installed CLI's
saved model name can differ from models accepted by the current ChatGPT plan.
An explicit `model` option must be present in that account's advertised catalog.
`outputSchema` constrains the final JSON; the application must still validate
and authorize every target, citation, and proposed action before use.

`status()` reports login separately from a completed inference in this process.
Only `infer()` success records live verification. A 90-second timeout and caller
AbortSignal terminate inference. Codex stderr and account metadata are never
forwarded to the UI or logs.

`infer({ onTiming })` can report duration-only phase diagnostics: `startup`,
`restrictions`, `authentication`, `catalog`, `thread`, `inference`, and `cleanup`.
Each event contains only `phase`, `durationMs`, and `elapsedMs`; it contains no
prompt, model output, account identity, paths, or credentials. Startup includes
private-directory preparation, process launch, and initialization on the cold
path. For a prepared process, timings begin when `infer()` claims it: startup is
zero if ready, or measures the remaining preparation wait. Background preparation
time is deliberately excluded from request latency and is not eliminated work.
Claim-time restrictions and authentication checks are still measured. The inference
phase ends at completed model output, separately from subprocess/state cleanup.
Completed, failed, and cancelled phases are measured, and observer exceptions do
not change inference or enforcement. The separately enabled hosted provider
reports its `inference` phase only. These measurements describe runtime phases;
website collection, retrieval, rendering, and host outcomes require separate
measurement.

This is a local single-owner demo integration. It must not be exposed as a
shared hosted service using the owner's subscription.

Verified 2026-10-29 with installed Codex 0.151.0: live structured JSON inference
using the account-advertised default model, with zero tool items observed.
The protocol fixture tests cover authentication, capability enforcement,
unexpected tools, cancellation, invalid JSON, and status boundaries.

References: [App-server protocol](https://learn.chatgpt.com/docs/app-server),
[configuration](https://learn.chatgpt.com/docs/config-file/config-reference),
[plan usage limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).
