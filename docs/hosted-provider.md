# Optional OpenAI provider preparation

The local Codex provider remains the default. `createOpenAIProvider()` is a
separate server-side Responses API adapter, disabled unless `enabled: true`, an
explicit model identifier and an API key are supplied. It does not inspect Codex
credentials or read environment files, and neither provider falls back to the
other. No real API request or paid inference was used to implement or test it.

The factory lives in `packages/runtime/src/openai.ts`. Server wiring chooses the
provider once at startup; an embed request must never select a provider, supply
credentials, change the endpoint or inject a transport. A configuration recipe is:

```ts
import { createOpenAIProvider } from './packages/runtime/src/openai.js';

const provider = createOpenAIProvider({
  enabled: process.env.GUIDEKIT_OPENAI_ENABLED === 'true',
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.GUIDEKIT_OPENAI_MODEL,
});
```

These names illustrate the server configuration; the factory itself does not
read them. Keep the key in the server's secret manager or private process
environment, never browser code, embed snippets, source control, image layers or
request logs. Choose a model available to the operator's API project that supports
Responses and strict Structured Outputs. The module has no default model and
makes no claim about account entitlement, pricing or supported model availability.
The injectable `fetch` option exists for trusted fixture tests, not deployment
configuration or untrusted requests.

`status()` sends a bounded authenticated **GET** to the configured model's fixed
`https://api.openai.com/v1/models/{model}` endpoint only when explicitly enabled
and configured. Results are cached for 15 seconds. A returned, matching model
object establishes model access at that check; key presence alone does not set
`authenticated: true`. A status check does not generate an answer or verify
inference billing, quota, Structured Outputs compatibility, or host actions.
See the [official model retrieval reference](https://developers.openai.com/api/reference/resources/models/methods/retrieve).

`infer({prompt, schema, signal})` sends a single POST to the fixed
`https://api.openai.com/v1/responses` endpoint. It uses `text.format` with
`type: "json_schema"`, `strict: true`, `store: false`, no tools, and an 8,192-token
output limit. Callers must supply a supported strict object schema: every
property required and `additionalProperties: false` on each object. Nullable
fields can represent absence. The server must still validate the resulting JSON
against the application contract and supplied target/action allowlists.
See [official Structured Outputs guidance](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses).

Only a completed assistant message containing one `output_text` JSON object is
returned. Reasoning metadata can be present but is not returned. Refusals,
incomplete/truncated responses, tools, extra messages, non-JSON output and malformed
envelopes fail closed. Redirects are disabled, response bodies are bounded to
512 KiB (64 KiB for status), final text to 64,000 bytes, schemas to 32 KiB and
prompts to 180,000 characters. Inference has a 90-second deadline; status has a
10-second deadline. Cancellation and `close()` abort active fetches and reject
waiting work even if a test transport ignores its signal. There are no retries
or automatic paid fallback calls. Errors never forward raw provider bodies or
transport exception text.

The [Responses reference](https://developers.openai.com/api/reference/typescript/resources/responses/methods/create)
describes these request/output fields. `store: false` disables persisted response
state; it is not a promise of zero retention under every API data policy. Prompts,
bounded website context and retrieved company knowledge leave the local machine
when this provider is enabled. The operator must approve that data flow and apply
its API project's access, spend, rate and retention controls before live use.

Run the isolated fixture suite with:

```sh
node --import tsx --test packages/runtime/src/openai.test.ts
```

The suite injects every transport and never loads a real key or calls OpenAI.
Live inference, production hosted deployment, tenant-specific billing/secrets,
and a completed website outcome remain unverified by these tests. Public service
hosting still requires separate tenant authentication, deployment and operations
work; this adapter does not change the current loopback server policy.
