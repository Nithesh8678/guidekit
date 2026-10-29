# Security boundaries

This release is a local-first core, not a hosted multi-user SaaS deployment. API and demo listeners bind to 127.0.0.1; Host checks reject DNS rebinding hosts. Personal ChatGPT credentials stay in the official Codex installation. There is no model API key or paid fallback.

Dashboard sessions use express-session, a durable SQLite store, random session IDs, HttpOnly/SameSite=Strict cookies, exact Origin checks for writes, and regeneration on login. Passwords use Argon2id via the maintained native library. Cookies intentionally omit Secure on loopback HTTP; hosted TLS/auth/identity and verified billing are separate work before any public service launch. Public source does not expose a local runtime.

All dashboard resources are tenant-scoped, including knowledge and history. Publishing snapshots configuration and documents. Embeds can access only the published version, receive random short-lived credentials stored as hashes, and remain bound to their origin and version. Website origins and public IDs are not identity proofs. Published docs are website-visible company help content; do not publish private internal documents. Host business authorization remains mandatory.

Model plans pass strict schema, known target IDs, action allowlists and action input schemas. A bounded interpreter validates a documented JSON Schema subset without code generation, regular expressions or recursive references, so the SDK works under a CSP without unsafe-eval. Models cannot issue arbitrary JavaScript or DOM selectors. Each mutation requires explicit confirmation, a host action with its own permissions/validation, and a host verification result. Receipts are scoped and final-state replays are idempotent. Expired approval cards cannot start host work. A reporting-only grace of 24 hours lets an existing receipt record its terminal result; expired sessions still cannot infer. The dashboard records host-reported outcomes; it cannot independently attest to an arbitrary third-party backend.

Inputs have byte/collection limits. Uploads support text/Markdown only; no arbitrary URL ingestion, filesystem paths or HTML rendering. Page collection excludes private/password/payment fields and never captures the whole screenshot. Docs, UI labels, user prompts and model outputs are untrusted. Prompt rules are defense in depth; hard permission checks do not depend on model obedience.

Rate limits, bounded parallel inference, deadlines and cancellation limit accidental subscription use. A local owner still controls which sites are allowed. Real authentication by browser bootstrap origin cannot defend against a malicious process already able to call loopback; that process is outside this local trust boundary. No deployment should expose this bridge to the internet.

## Dependency protection

GitHub CI runs `npm ci --ignore-scripts`, advisory and tracked-secret checks, type/build checks, unit/HTTP/runtime regressions and Chromium acceptance tests. Lockfiles and immutable action commits constrain dependencies; Dependabot proposes updates. These checks do not establish the absence of unknown malicious code.

## Optional external action provider

viaSocket is assessed in docs/viasocket.md, not connected. Any integration must retain host-side authorization, trusted tenant/user mapping, explicit approval and outcome verification. Its project signing secret and runnable script_id are credentials; they must never reach the model, public SDK, browser logs or repository. The public agent ID/origin-bound session does not authorize a visitor to use a company's connected accounts.
