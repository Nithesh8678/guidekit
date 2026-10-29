# SDK release candidate

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

The default browser integration supports accessible same-document HTML controls. Cross-origin frames, native application UI and canvas internals require a deliberate host adapter. Privacy opt-out is `data-guidekit-private`; sensitive field values are never collected. A host with private dynamic labels should select explicit-target collection and mark only reviewed controls. Adaptive journeys are bounded; reload resume is off by default and requires both host opt-in and visitor consent. Browser speech depends on supported browser APIs, a secure/localhost origin and user permission; a scripted speech fixture is not a physical microphone test.

Validation includes loading the packed ESM artifact, compiling a separate TypeScript consumer against its declarations and verifying manifest hashes. npm registry publication, a CDN, long-lived hosted availability and every customer framework/browser combination are separate release gates.
