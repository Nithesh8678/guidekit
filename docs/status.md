# Core status

## Implemented core

- Persistent developer workspaces with Argon2id passwords, durable sessions, tenant-scoped agents, text/Markdown knowledge uploads, draft editing and immutable version publishing.
- Shared script/ESM browser SDK: bounded page context, safe text/citations, hotkey, anchored step guidance, explicit action cards, host validation/verification, scoped receipts, cancellation and browser speech controls.
- Local official Codex app-server integration using existing ChatGPT authentication, dynamic catalog-default selection, capability restrictions and schema-constrained responses. No API key or paid fallback.
- Independent CRM and support websites using the same compiled SDK with different agent IDs, knowledge and registered actions.
- Locked dependency installation without lifecycle scripts, pinned GitHub Actions, secret/advisory checks and Dependabot.

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
- Browser-native microphone/speaker audio still needs a physical human test. Browser lifecycle tests and live TigerGraph integration are detailed in the checkpoint below.
- viaSocket was assessed as a suitable optional external-action provider. No viaSocket account, credentials, connected apps, remote action or provider-specific security behavior has been tested. See docs/viasocket.md.
- Cutroom integration is the next host checkpoint. It must use its existing revision/idempotency and permission-aware editor commands. The current real proof uses CRM and support hosts.
- Website business operations require developer-registered adapters and host authorization. No arbitrary-site, iframe/canvas or native-app full automation claim.
- Visual/motion refinement, commercial provider/hosting design, teams/SSO and billing follow core acceptance.
- Runtime checks establish the effective restricted config before starting a model thread and observed no tool items during live proof. They do not independently attest to the absence of process startup side effects from every possible machine-managed Codex configuration.

## Browser voice and TigerGraph checkpoint (2026-10-29)

- Selected browser speech recognition and browser speech synthesis. Wispr is not used and no Wispr credentials or token route are required.
- The SDK shortcut starts voice; pressing it again finishes/submits, while Escape and Cancel voice discard input. Permission failures, unsupported/insecure contexts, network failures, delayed callbacks, timeouts, transcript review and cleanup are covered by explicit speech doubles. Physical microphone transcription and audible speaker playback remain a human test.
- Added a real manual SDK installation lab at `/?install=manual` on both demo hosts: initial absence, validated snippet, actual script/session load, permitted host actions, removal/reinstall and honest bootstrap errors.
- Combined Chromium suite: 10/10 passed. Voice services are explicitly mocked in automated tests; application pages, SDK, requests, host mutations and browser events are real.
- TigerGraph Savanna 4.2.5: created GuideKit's five vertex types and four directed/reverse relationship pairs. All three GSQL queries compiled and installed successfully. Created the explicitly approved development database secret and saved it only in ignored mode-0600 local `.env`.
- Actual workspace status connected. Live synthetic proof passed: idempotent upsert; direct source plus related statement-export source through the shared billing concept; tenant isolation; published-version isolation. `npm run test:graph` reproduces this with unique synthetic scopes.
- Actual dashboard sync of CRM published v1 confirmed 26 vertices and 25 relationships. Actual browser + live ChatGPT subscription returned a TigerGraph-grounded answer, published source citation, visible graph evidence metadata and four anchored CRM form guidance steps after server restart.
- Server integration enforces immutable trusted scopes and validates returned IDs, titles, excerpts and path endpoints before inference; configured graph failures do not silently switch to local retrieval. Authenticated status/sync controls are visible in Install.
- Final local regression count: 55/55 unit/HTTP/runtime/SDK/graph tests passed; production build and typecheck passed; dependency audit reported zero vulnerabilities.
- CRM published v2 now has three useful documents and synced 53 vertices / 61 relationships. Live graph-backed inference cited both Contact qualification and Pipeline stages. Support published v1 also synced successfully (43 vertices / 47 relationships). Visitor graph details show bounded connections between cited documents.
