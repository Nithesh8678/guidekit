# GuideKit browser SDK

One framework-independent SDK loads a company's published agent. Build the IIFE entry `src/index.ts` with esbuild; the server serves it at `/sdk/guidekit.js`.

```html
<script defer src="http://127.0.0.1:4410/sdk/guidekit.js"
  data-agent-id="YOUR_AGENT_ID"
  data-endpoint="http://127.0.0.1:4410"></script>
```

The website origin must be allowed in the agent's published configuration. Use HTTPS in HTTPS hosts. The default hotkey is Command/Ctrl + Shift + K; `data-hotkey="alt+k"` overrides it. The assistant is modeless. Escape ends an active guide and restores chat; during voice input it cancels dictation without sending. Otherwise it closes chat.

## Host integration

Listen before the script loads, or register directly once `window.GuideKit` exists:

```js
document.addEventListener('guidekit:ready', () => {
  GuideKit.registerAction('create_task', {
    description: 'Create a task in the current project',
    requiresConfirmation: true,
    inputSchema: {
      type: 'object',
      properties: { title: { type: 'string', minLength: 1, maxLength: 100 } },
      required: ['title'], additionalProperties: false
    },
    async execute(args, { signal, idempotencyKey }) {
      // Your application backend must independently authorize this operation.
      // It must deduplicate by idempotencyKey and honor signal where possible.
      const response = await fetch('/api/tasks', {
        method: 'POST', credentials: 'same-origin', signal,
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(args)
      });
      if (!response.ok) return { success: false, message: 'The task was not created.' };
      const task = await response.json();
      return { success: Boolean(task.id), message: task.id ? `Created task ${task.id}.` : 'No task was returned.' };
    }
  });
  GuideKit.setContext({ currentProject: 'public_project_id' });
});
```

`mount({ agentId, endpoint, actions, getContext, hotkey })` supports manual installation and returns `{ ready, ask, getPageContext, registerAction, setContext, open, close, startVoice, stopVoice, reportStepResult, destroy }`. `ready` resolves after the first published session is established. Global `registerAction` works before or after mount. Mount and action functions are also ESM exports.

Add stable `data-guidekit-id="create-task"` attributes and optional `data-guidekit-description` metadata to guide controls reliably. Duplicate explicit IDs are omitted. Without annotations the SDK discovers up to 80 labeled visible semantic controls. It never clicks them automatically. Same-ID replacements are recovered during a short grace period. A missing or newly private target stops the guide and offers Refresh guide with fresh bounded page context.

For applications containing private filenames or other personal labels, use `mount({ agentId, endpoint, targetMode: 'explicit' })` or script `data-target-mode="explicit"`. This shares and resolves **only** unique host-authored `data-guidekit-id` controls, while retaining all existing visibility, sensitive-control and private-section exclusions. It also applies to adaptive snapshots and reload Resume. Keep authored labels/descriptions deliberately public. `auto` remains the default. Hosts requiring this privacy boundary should check `GuideKit.capabilities.explicitTargets === true` before mounting; old SDKs must not be allowed to silently ignore the option. ESM consumers can import the frozen `SDK_CAPABILITIES` object.

An explicitly identified control can also use `data-guidekit-label="Selected timeline clip"` to share a public label while preserving its personal filename for the application's own accessibility UI. The SDK consults this bounded public override before reading accessible label/text, and uses it consistently to verify live target identity. The attribute is ignored on controls without a valid `data-guidekit-id`.

Add `data-guidekit-private` to any section that should be excluded. Password, hidden, file, payment, and content-editable controls are excluded. Form values are never added to model context or sent to the GuideKit server by guidance observation. While a guide is active, the SDK locally checks known nonprivate controls for filled/valid state and trusted input/change events. Query strings, hashes, full page text, and screenshots are never collected. Only deliberately public context should be supplied through `setContext`/`getContext`.

All actions require a published allowlist, host registration, JSON Schema validation, and explicit visitor approval. Host `validate` is optional additional validation; it cannot replace server-side permissions. `execute` must return a verified `{success,message}` result. Default action timeout is 30 seconds; optional `timeoutMs` is bounded to 100–120000 ms. Execution is never retried automatically. The receipt ID is the host idempotency key. A successful outcome is displayed only after the service acknowledges the receipt; failed recording exposes a separate retry that does not re-execute the operation.

Browser dictation requires HTTPS/localhost and microphone permission, and may process audio through the browser vendor's service. The default shortcut starts voice and enables browser spoken answers; press it again to finish/send. The chat microphone defaults to transcript review unless the host configures autoSubmit. The speaker button toggles spoken output. Typed chat works when voice is unsupported or denied. Close/Stop cancels requests, active guidance, dictation, speech, and signals any host action to abort. An abort cannot undo work already committed by the host; inspect the outcome before retrying.

Events are dispatched on `document`: `guidekit:ready` (API initialized), `guidekit:mounted` (session ready), `guidekit:response`, `guidekit:action-result`, `guidekit:target-missing`, `guidekit:guide-finished` (`verified` status), `guidekit:error`. Events contain identifiers/status only, never model arguments or the session credential.

Run security tests with `npx tsx --test packages/sdk/tests/security.test.ts`. Browser checks should verify two distinct origins, origin rejection, alignment after scrolling, missing-target recovery, cancellation, safe text rendering, and confirm-before-execute.

## Observed guidance

The cursor rests in the chat header while the visitor asks a question. Guidance hides the chat panel and flies that same cursor from its dock to the current known control, with a compact card beside it. The first stroke waits for arrival. Opening chat or completing a guide returns the cursor to its dock; Resume guide flies it back out. Scrolling during flight retargets from the displayed position instead of teleporting. Native single-line text advances after valid input settles for 1200 ms, or immediately after a valid edited field is left for another page control. It does not move keyboard focus during automatic advancement. Textarea input waits for leaving the field, avoiding interruption while writing paragraphs. Native dropdown/toggle changes advance immediately; Next can keep an existing default. Required fields, native validity, aria-invalid and IME composition block automatic advancement. Pause and Automatic progress provide manual control. All guidance observation and timers end on completion, cancellation, missing/private controls or SDK destruction; the docked renderer remains idle while chat is visible and is removed on destroy.

A submit click alone is not evidence that a save succeeded. After your application has verified a visitor's manual form submission, report its local result:

```js
const saved = await saveAndVerifyContact();
GuideKit.reportStepResult('create-contact', {
  success: Boolean(saved.id),
  message: saved.id ? 'Contact saved and verified.' : 'The contact could not be saved.'
});
```

The target ID must be in the active guide. This only advances local guidance; it does not authorize an operation, create an action receipt, or replace host validation. A failed result keeps the guide on the step with recovery guidance. Final verified success brings chat back. Loading-state button changes do not terminate a pending save; a 30-second active confirmation window ends with an explicit unverified message if no host result arrives. Pause suspends that deadline. The visitor can also choose Finish guide, which does not claim a successful save. Custom controls without observable native events use Next or an explicit host result.

Steps can select one validated annotation kind: `target`, `ring`, `frame`, `arrow`, `underline` or `number`. The local retained renderer resolves live CSS-pixel geometry, ignores pointer events and honors Reduce Motion. Browser speech `onstart` releases the corresponding drawing beat; unavailable output falls back to text. A four-Hz local check during active, visible guidance catches movement that emits no DOM event, then uses bounded frame tracking while the target animates. It stops on pause, chat, cancellation or completion. Public context reads use separate snapshots so they cannot change an existing guide's target identity. See [motion architecture and timing](../../docs/guidance-motion.md).

## Adaptive journeys

SPA route changes, newly opened dialogs and relevant changed controls can continue the same goal with a fresh bounded page snapshot. The SDK carries only completed public control IDs/labels/roles and observed/manual/host-verified evidence into each continuation. It waits for a settled scene, permits at most six automatic continuation requests, and allows only one request in flight. Input values, geometry animation and pointer movement do not trigger model calls. Pause/Open chat aborts pending continuation and retains its intent for an explicit Resume; cancellation and newer questions discard obsolete responses.

The planner marks intermediate segments `continue`, questions `needs_input`, and intended final segments `done`. A model disposition is never proof of a successful business operation. Final save confirmation still comes from the website. Continuation requests cannot execute DOM actions; the server rejects business-action proposals on continuation requests. The host still registers, authorizes and verifies all real operations.

Adaptive journeys are on by default. Set `journey: { enabled: false }` (script `data-adaptive="false"`) for a single-snapshot guide. Reload/full-document resume is **off by default**. A host can enable `journey: { resume: 'session' }` (script `data-journey-resume="session"`), which offers the visitor an **Allow task resume** choice. Only after consent does sessionStorage hold a task ID, the visitor's sanitized goal and completed control IDs/evidence, expiring after 30 minutes. It stores no field values, labels, URLs, audio, model arguments, cookies or session credentials. The goal itself may contain information the visitor typed in chat; explain this in your site's privacy notice. On a new page, the visitor must choose **Resume previous task** before any continuation request. A fresh embed session, published configuration and page context are used; no old session credential is restored.
