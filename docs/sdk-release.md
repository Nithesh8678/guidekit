# SDK 0.3 release candidate

The current build target is `0.3.0-alpha.1`. This is the reusable SDK's release-candidate version; building or packing it does not publish it to npm or establish hosted availability.

`npm run build` produces three reusable forms from the same SDK source:

- `dist/sdk/guidekit.js` and `guidekit.mjs`: local development aliases, revalidated on each load.
- `dist/sdk/releases/<content-hash>/`: script/ESM bundles and a manifest with SHA-384 integrity values. These URLs receive immutable caching.
- `dist/sdk-package/`: the `@guidekit/sdk` npm release candidate with ESM, script, generated TypeScript declarations, license and explicit package exports. It has not been published to npm.

Read `/sdk/manifest.json` from your trusted GuideKit endpoint to choose a release. Pin the returned script path and integrity value in your website code. Keep a prior release directory when deploying new assets; rollback is a host change to the prior pinned path, independently of selecting an older ready agent knowledge version. Do not replace content under a hash URL. The mutable manifest is a build-time installation aid, not an instruction to hot-upgrade every installed customer.

```html
<!-- Replace HASH, INTEGRITY, agent ID and endpoint with your reviewed configuration. -->
<script defer src="http://127.0.0.1:4410/sdk/releases/HASH/guidekit.js"
  integrity="INTEGRITY" crossorigin="anonymous"
  data-agent-id="YOUR_PUBLISHED_AGENT_ID"
  data-endpoint="http://127.0.0.1:4410"></script>
```

For a package consumer, run `npm pack --ignore-scripts --pack-destination ../sdk-archives` from `dist/sdk-package/`, install the resulting local tarball, then:

```ts
import { mount, type RegisteredAction } from '@guidekit/sdk';
const actions: Record<string, RegisteredAction> = { /* trusted host implementations */ };
const assistant = mount({ agentId: 'YOUR_PUBLISHED_AGENT_ID', endpoint: 'http://127.0.0.1:4410', actions });
await assistant.ready;
```

Register actions before auto-mount or pass them to `mount`. Actions must validate bounded inputs, enforce the host's authenticated permissions, honor cancellation, use the supplied idempotency key and verify persisted application state. An SDK receipt or click observation never grants host permissions. Destroy the instance when the owning app unmounts. Multiple company agents use this same SDK; company knowledge stays in their server-side, tenant-scoped snapshots.

The default browser integration supports accessible same-document HTML controls. Cross-origin frames, native application UI and canvas internals require a deliberate host adapter. Privacy opt-out is `data-guidekit-private`; sensitive field values are never collected. A host with private dynamic labels should set `targetMode: "explicit"`, mark only reviewed `data-guidekit-id` controls and use generic `data-guidekit-label` values. Runtime `GuideKit.capabilities` advertises this supported boundary. Adaptive journeys are bounded; reload resume is off by default and requires both host opt-in and visitor consent. Browser speech depends on supported browser APIs, a secure/localhost origin and user permission; a scripted speech fixture is not a physical microphone test.

## Host workflow progress

Check both the trusted release manifest and the loaded runtime for `hostWorkflowProgress: true` before depending on this API. The runtime exports the frozen `SDK_CAPABILITIES`, also available as `GuideKit.capabilities`:

```ts
{ apiVersion: 1, explicitTargets: true, adaptiveJourneys: true, hostWorkflowProgress: true }
```

For longer applications, mount with `journey: { maxContinuations: 12 }`. The default remains six continuation requests; explicit limits must be integers from 1 through 24. One request is allowed in flight. The collector shares at most 160 safe controls while scanning at most 2,000 candidates. These are limits, not a promise that every offscreen, private or custom-rendered control is discoverable.

Report asynchronous manual operations before opening a native picker or starting host work:

```ts
assistant.reportStepResult('import-assets', {
  status: 'pending',
  message: 'Choose files, then wait for the import to finish…'
});
// The trusted host handles the actual picker/import and verifies its outcome.
const result = await importAndVerifyFromUserChoice();
assistant.setContext({ workflow: { assetCount: result.count } }, {
  revision: result.publicWorkflowRevision
});
assistant.reportStepResult('import-assets', {
  success: result.success,
  scope: 'step',
  message: result.success ? 'Import verified.' : 'Import failed. Check the website.'
});
```

`pending` applies to the current known step. It prevents speculative advancement while the host is working, including when its button disappears. The active deadline defaults to 120 seconds; `timeoutMs` may be an integer from 1,000 to 300,000. Repeated pending reports cannot extend the active deadline. Pause suspends it; cancellation/destroy clears it. An unknown outcome ends unverified and does not retry a business operation. An ordinary unextended click still uses the 30-second confirmation window.

Use `scope: 'step'` for a verified intermediate operation: a plan marked `continue` may proceed with the same goal. Use `scope: 'goal'` only when the host actually verifies the requested overall outcome. A native final form submit with scope omitted retains the legacy terminal-save behavior even if a planner asks to continue. A planner's `done` disposition or no-step answer is informational, never a substitute for a host success report. A failed report retains recovery guidance. None of these reports executes an operation or grants permission.

`setContext(publicContext, { revision })` lets a host signal semantic progress when control IDs/labels stay unchanged. Revisions are safe integers or nonempty strings of at most 160 characters, remain local, and are excluded from task-resume memory. Change them for meaningful workflow progress, never typed values or playback position. Revision changes can replan at an expected continuing transition. Fresh scene snapshots also read asynchronous `getContext()`; stale, aborted and changed-route reads cannot replace current guidance. File controls, media bytes, personal filenames and form values stay excluded.

## Interaction and modal boundaries

Trusted clicks on nested SVG icons resolve through bounded local ancestry to their known safe HTML control. This supports icon buttons without introducing model selectors or automatic clicks. Privacy and trusted-event checks still apply.

The SDK-owned overlay has `aria-live="off"`; its authored step text keeps `aria-live="polite"`. This uses the live-region exemption in Radix's `aria-hidden`/`hideOthers` dependency, preserving accessible guidance while application/private `aria-hidden` attributes remain intact. The SDK does not disable a host focus trap or reparent into transformed dialog content. Hosts may need a narrowly scoped outside-interaction exception for their SDK controls so HUD clicks do not dismiss a modal; ordinary outside dismissal must still work. Cutroom's synthetic integration checks this behavior. Native HTML `<dialog>` top-layer/inert behavior is a separate integration boundary.

Validation includes loading the packed ESM artifact, compiling a separate TypeScript consumer against its declarations and verifying manifest hashes. npm registry publication, a CDN, long-lived hosted availability and every customer framework/browser combination are separate release gates.

Browser narration supports `voice.output: {voiceURI?, language?, rate?, remember?}`. The visitor can use Voice settings and Preview without starting a microphone or changing future answer playback. Only the chosen URI/language/rate persist per website origin; `remember:false` disables this preference storage.
