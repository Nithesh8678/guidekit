# GuideKit status

## Current platform completion checkpoint — 2026-10-29

Work is on `feat/platform-completion`, stacked on the unmerged `feat/heyclicky-guidance` branch. [Draft PR10](https://github.com/Nithesh8678/guidekit/pull/10) is reviewable; no main merge was performed. See [delivery-plan.md](delivery-plan.md) for scope and acceptance gates.

Implemented: bounded adaptive journeys, explicit private-host targets/public labels, opt-in reload resume, immutable prepare-before-activate publication with retry/rollback/unpublish, draft document editing/deduplication, retrieval preview/evaluation, installation diagnostics, content-hash/SRI script releases and a packed ESM/TypeScript SDK candidate. Account/team UI and APIs include profile/password, invitations, live roles, one-time local recovery/verification, workspace switching, audit and session revocation. Operations include consistent private backup, guarded restore, migrations, readiness, capacity and safe aggregate telemetry/retention. The local subscription runtime remains default; the optional hosted provider is explicitly selected, disabled by default and has no fallback.

Verification: exact remote code checkpoint `028e0cf47af634d661459d165b06d9f62560a2af` passed [Core checks](https://github.com/Nithesh8678/guidekit/actions/runs/40866462662): 178 unit/HTTP/runtime/graph/SDK/package checks, typecheck and production build, 43 Chromium cases, 13 dashboard contract cases and two real dashboard/API integrations. Locked dependency installation, the tracked-source secret scan and the advisory check passed with zero reported vulnerabilities. Automated model/speech paths use explicit fixtures; the separate live checks below use the real configured providers.

Live proof: fresh real subscription inference, cited published knowledge, validated action proposal and disposable host persistence passed. Actual TigerGraph sync, relationship retrieval, idempotency, tenant and version isolation passed. A new Cutroom company agent was published through the actual dashboard; its immutable v1 became active only after TigerGraph preparation. In the isolated real Cutroom editor, a real model rename proposal required approval, the authenticated command saved/read back the new project name, the SDK recorded `action_succeeded`, and normal Undo restored the original name. All three Cutroom host actions also passed real HTTP/SQLite/Chromium tests with fixture planning. Existing personal projects/media were not opened. Cutroom remains on its separate local branch; packaged Electron and hosted execution are unverified.

Cutroom's final local checkpoint is `19d809602a043b3de742d85203c4c62ffa4266ef`. A cancelled old SDK finishing after a newer connection now preserves the active API and instance; disconnect removes only owned state. The exact overlapping-load regression and a late load after final disconnect were independently verified in Chromium. The connected editor hotkey starts browser dictation, while connecting alone starts no microphone. Three focused lifecycle/voice cases and three approval/Undo workflow cases passed using disposable data and explicit model/speech fixtures. The manual editor was reconnected to the current integrity-pinned SDK; the separate Cutroom main branch and existing data remain unchanged.

Elapsed lifecycle proof: exact code checkpoint `028e0cf` ran active guidance for **600.006 seconds** in Chromium without clock acceleration. It recovered same-ID fields, a dialog, SPA route and changed-control identity, with typing bursts, earlier edits, geometry changes and Open chat/Resume. Exactly four planned inference calls occurred; typing caused none. Persistent active resources stayed bounded. Cancellation stopped guidance work, and full destroy left zero tracked persistent listeners, MutationObservers, ResizeObservers, timeouts, intervals and animation frames. No browser errors occurred. This used a separate source-built SDK, disposable site/data and explicit model/speech doubles, not a ten-minute live-provider or physical-device test. The local ignored `artifacts/endurance/2026-10-29T11-42-28.322Z/` directory retains the result, samples, screenshots and runner.

Recovery proof: before upgrading the running database from schema1 to3, took an online backup. Original row counts were preserved on upgrade. Restored that actual backup to a separate private directory, compared every original column/value across ten tables, verified the signing secret, migrated the copy successfully and removed only the owned drill copy. The running database was untouched by restore.

Security review found and fixed three concrete races, each regression-tested: old-password login completing during reset, revoked identity accepting an invitation, and delayed session touch undoing logout. No further concrete tenant/publication/knowledge issue was found in that focused review; this is not a certification.

Human voice status: the user confirmed real transcription works. Added voice selection, Preview/Stop preview, speed and remembered device preferences. The user still found browser output robotic and explicitly deferred voice quality. No premium/cloud TTS or paid model traffic was enabled. Physical mobile/packaged Electron, physical input-method acceptance, external mail delivery and public hosting remain acceptance gates; the ten-minute automated Chromium lifecycle check is now complete.

## Historical checkpoints

The records below describe earlier verified checkpoints; their smaller test counts and planned items are superseded by the current checkpoint above.

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

## Docked cursor follow-up (2026-10-29)

- A single retained SVG/cursor now lives for the SDK instance. It rests in the chat header during questions, departs from the actual dock center, travels smoothly to the target, and returns when chat opens or guidance finishes. A resumed guide departs from the dock again. First-target stroke reveal waits for arrival; scrolling/resizing during flight retargets from the current displayed pose. Reduced Motion keeps the dock/target transitions static.
- Dock geometry follows the chat panel's entrance animation and viewport/size changes. Guide callbacks yield renderer ownership while chat is open, including when the paused host target is hidden/replaced. Closing/destroying the SDK cancels pending flight and readiness callbacks. Actual browser speech-start/end events also drive the dock's speaking indicator.
- TypeScript and production build passed; **111/111 unit/HTTP/runtime/SDK/graph tests** and **28/28 Chromium acceptance tests** passed. New browser assertions verify exact dock departure, the same SVG/group identity throughout, intermediate movement, arrival-before-stroke, return/resume, mid-flight retargeting, paused host mutation, full dock opacity and cancellation/destroy cleanup.
- A real TigerGraph-backed subscription request in a separate demo tab returned the four-step guide; the cursor was visibly docked before the request, reached the first field after the answer, and returned to the chat header on Open chat. No form record was created during this verification. Physical audio and exact reference-product parity boundaries remain unchanged.
