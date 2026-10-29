# Security boundaries

This release is a local-first core, not a hosted multi-user SaaS deployment. API and demo listeners bind to 127.0.0.1; Host checks reject DNS rebinding hosts. Personal ChatGPT credentials stay in the official Codex installation. There is no model API key or paid fallback.

Dashboard sessions use express-session, a durable SQLite store, random session IDs, HttpOnly/SameSite=Strict cookies, exact Origin checks for writes, and regeneration on login. Passwords use Argon2id via the maintained native library. Cookies intentionally omit Secure on loopback HTTP; hosted TLS/auth/identity and verified billing are separate work before any public service launch. Public source does not expose a local runtime.

All dashboard resources are tenant-scoped, including knowledge and history. Publishing snapshots configuration and documents. Embeds can access only the published version, receive random short-lived credentials stored as hashes, and remain bound to their origin and version. Website origins and public IDs are not identity proofs. Published docs are website-visible company help content; do not publish private internal documents. Host business authorization remains mandatory.

Model plans pass strict schema, known target IDs, action allowlists and action input schemas. Models cannot issue arbitrary JavaScript or DOM selectors. Each mutation requires explicit confirmation, a host action with its own permissions/validation, and a host verification result. Receipts are scoped and final-state replays are idempotent. The dashboard records host-reported outcomes; it cannot independently attest to an arbitrary third-party backend.

Inputs have byte/collection limits. Uploads support text/Markdown only; no arbitrary URL ingestion, filesystem paths or HTML rendering. Page collection excludes private/password/payment fields and never captures the whole screenshot. Docs, UI labels, user prompts and model outputs are untrusted. Prompt rules are defense in depth; hard permission checks do not depend on model obedience.

Rate limits, bounded parallel inference, deadlines and cancellation limit accidental subscription use. A local owner still controls which sites are allowed. Real authentication by browser bootstrap origin cannot defend against a malicious process already able to call loopback; that process is outside this local trust boundary. No deployment should expose this bridge to the internet.

## Dependency protection

GitHub CI uses Socket Firewall Free around `npm ci --ignore-scripts`, pinned to an immutable action commit. This blocks confirmed-malicious package downloads using Socket's service without an API key. It complements npm advisory checks, lockfiles, dependency updates, source review and tests; it does not establish application security or absence of unknown malicious code.

Sources: https://docs.socket.dev/docs/socket-firewall-free and https://github.com/SocketDev/action . The GitHub App integration is optional and is not claimed installed. Project runtime does not depend on Socket availability; CI intentionally fails if its protected install cannot complete.
