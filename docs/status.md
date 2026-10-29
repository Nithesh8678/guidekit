# Core status

## Implemented core

- Persistent developer workspaces with Argon2id passwords, durable sessions, tenant-scoped agents, text/Markdown knowledge uploads, draft editing and immutable version publishing.
- Shared script/ESM browser SDK: bounded page context, safe text/citations, hotkey, anchored step guidance, explicit action cards, host validation/verification, scoped receipts, cancellation and browser speech controls.
- Local official Codex app-server integration using existing ChatGPT authentication, dynamic catalog-default selection, capability restrictions and schema-constrained responses. No API key or paid fallback.
- Independent CRM and support websites using the same compiled SDK with different agent IDs, knowledge and registered actions.
- Socket Firewall-protected dependency installation, pinned GitHub Actions, secret/advisory checks and Dependabot.

## Verified on 2026-10-29

- TypeScript and production build passed.
- 29 unit/HTTP/runtime security tests passed, including cross-company isolation, published snapshots, expired credentials, schema rejection, unexpected runtime tools, cancellation and restart persistence.
- Three Chromium acceptance tests passed: full dashboard-to-embed flow, strict CSP/privacy/mobile guidance recovery, approved/declined actions, both independent websites, persistent records and dashboard outcomes. These use an explicitly isolated test model.
- Real ChatGPT subscription inference completed through the implemented provider and the full HTTP API. The reproducible `npm run test:live` passed with grounded/cited output, validated proposal, disposable host persistence and recorded receipt.
- Actual browser + live subscription: created a workspace and CRM agent, added knowledge, published, obtained a cited trial-policy answer with four live guidance steps, approved a contact proposal, observed the saved contact and successful receipt, then reloaded and verified persistence.
- Actual browser + live subscription on a second origin: separately configured support agent proposed a ticket; after approval, the host saved/read back request FN-0001 and the SDK recorded success. No external email was sent.
- Restarted the real service and verified that login, agent config, published knowledge and session outcomes survived.
- Public repository verified: https://github.com/Nithesh8678/guidekit . CI evidence should be tied to the exact reported commit.

## Explicit boundaries / next work

- This is a working local core, not a public hosted SaaS deployment or a completed enterprise security certification.
- Browser-native voice controls are implemented; microphone/speaker audio has not been physically tested. Wispr API access and TigerGraph workflow relationships remain optional; neither is falsely represented as connected.
- Cutroom integration is the next host checkpoint. It must use its existing revision/idempotency and permission-aware editor commands. The current real proof uses CRM and support hosts.
- Website business operations require developer-registered adapters and host authorization. No arbitrary-site, iframe/canvas or native-app full automation claim.
- Visual/motion refinement, commercial provider/hosting design, teams/SSO and billing follow core acceptance.
- Runtime checks establish the effective restricted config before starting a model thread and observed no tool items during live proof. They do not independently attest to the absence of process startup side effects from every possible machine-managed Codex configuration.
