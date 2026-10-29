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

## Observed guidance and motion branch (2026-10-29)

- Implemented on `feat/heyclicky-guidance` for later review/merge. This feature branch has not been merged into `main`.
- Chat/launcher tuck away for a compact anchored guide. Trusted typing, quiet periods, native selections, field exits and composition state drive local automatic progress. Fast Tab/future edits, earlier corrections, Pause, Back, Automatic progress, Open chat/Resume and Escape are covered. Initial/resumed editing focus is deliberate; automatic advancement never moves the typing cursor.
- Replaced the static highlight with a retained click-through SVG renderer: target/ring/frame/arrow/underline/number primitives, stable seeded geometry, local stroke reveal/glow, interruptible quadratic cursor flights, and persistent pointing/speaking/waiting surfaces. Timing parameters follow the supplied engineering handoff; no proprietary drawing engine is imported. See `docs/guidance-motion.md` for parameter provenance and the browser adaptation.
- Browser speech `onstart` releases each visual beat. Stalled/unavailable speech falls back to text after a bounded wait; generation and utterance guards discard interrupted callbacks. These lifecycle checks use explicit speech doubles, not physical microphone or audible playback claims.
- Each reasoning task and history guide owns its semantic snapshot. Late route-changed responses, duplicate IDs, changed public labels/roles, private targets and detached refs cannot silently acquire a new meaning. Same-identity replacement can recover; missing targets restore chat with Refresh guide.
- Scroll/resize, CSS transforms and pure host WAAPI movement remeasure current bounds, including under Reduce Motion. Active visible sessions use a four-Hz local identity/geometry check; frame tracking runs only during bounded host/assistant animation. Pause/chat/hidden pages suspend geometry polling and rendering; completion/destroy removes timers, observers, animation frames and listeners.
- Submit clicks wait for host-verified results. Button loading/relabel/hide does not terminate a pending save; 30 seconds without confirmation returns an explicit unverified outcome. Host callbacks grant no action authority and create no action receipts. Both demo hosts report only after save/read-back verification.
- Final local checks: **106/106** unit/HTTP/runtime/graph/SDK tests; TypeScript and production build passed; **24/24 Chromium** acceptance tests passed. Current dependency audit found zero vulnerabilities; tracked-source secret check passed before publication.
- Chromium normal-motion fixture: **182 animation-frame intervals**, median **16.7 ms**, p95 **16.8 ms**. Maximum settled shape-versus-expected-target alignment error across initial layout, scroll, ancestor transform, resize and next step: **0.022 CSS pixels**. These are local synthetic browser measurements, not universal FPS, model latency, or a benchmark of HeyClicky. The synthetic ask round trip in that run was 2.4 ms and is unrelated to real inference latency.
- Actual in-app browser with the existing published CRM v3: TigerGraph-backed live subscription inference returned a four-step form guide; chat hid; typing a test name automatically moved the drawing to Company while focus stayed in Name; stopping restored chat. The unsaved test input was cleared and existing records were preserved. Real graph v3 retrieval separately returned three sources. A transient graph retrieval failure was surfaced explicitly before a later live request succeeded; no fallback was introduced.
- Remaining verification boundaries: exact current HeyClicky visual parity was not measured in the supplied research; physical speech/IME commit, a ten-minute real session and device-wide native capture/overlays were not exercised. This implements browser website guidance; no native macOS overlays, cross-application capture, canvas/iframe interpretation or multi-monitor AppKit transforms are claimed.
