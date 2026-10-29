# GuideKit browser SDK

One framework-independent SDK loads a company's published agent. Build the IIFE entry `src/index.ts` with esbuild; the server serves it at `/sdk/guidekit.js`.

```html
<script defer src="http://127.0.0.1:4410/sdk/guidekit.js"
  data-agent-id="YOUR_AGENT_ID"
  data-endpoint="http://127.0.0.1:4410"></script>
```

The website origin must be allowed in the agent's published configuration. Use HTTPS in HTTPS hosts. The default hotkey is Command/Ctrl + Shift + K; `data-hotkey="alt+k"` overrides it. The assistant is modeless and Escape closes it when focus is inside.

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

`mount({ agentId, endpoint, actions, getContext, hotkey })` supports manual installation and returns `{ ready, ask, getPageContext, registerAction, setContext, open, close, destroy }`. `ready` resolves after the first published session is established. Global `registerAction` works before or after mount. Mount and action functions are also ESM exports.

Add stable `data-guidekit-id="create-task"` attributes and optional `data-guidekit-description` metadata to guide controls reliably. Duplicate explicit IDs are omitted. Without annotations the SDK discovers up to 80 labeled visible semantic controls. It never clicks them automatically. Removed or private targets stop the guide.

Add `data-guidekit-private` to any section that should be excluded. Password, hidden, file, payment, and content-editable controls are excluded. Form values, query strings, hashes, full page text, and screenshots are never collected. Only deliberately public context should be supplied through `setContext`/`getContext`.

All actions require a published allowlist, host registration, JSON Schema validation, and explicit visitor approval. Host `validate` is optional additional validation; it cannot replace server-side permissions. `execute` must return a verified `{success,message}` result. Default action timeout is 30 seconds; optional `timeoutMs` is bounded to 100–120000 ms. Execution is never retried automatically. The receipt ID is the host idempotency key. A successful outcome is displayed only after the service acknowledges the receipt; failed recording exposes a separate retry that does not re-execute the operation.

Browser dictation is optional, requires HTTPS/localhost and microphone permission, and may process audio through the browser vendor's service. Review and send the transcribed question. Spoken answers are opt-in via the speaker button. Typed chat works when voice is unsupported or denied. Close/Stop cancels requests, active guidance, dictation, speech, and signals any host action to abort. An abort cannot undo work already committed by the host; inspect the outcome before retrying.

Events are dispatched on `document`: `guidekit:ready` (API initialized), `guidekit:mounted` (session ready), `guidekit:response`, `guidekit:action-result`, `guidekit:target-missing`, `guidekit:error`. Events contain identifiers/status only, never model arguments or the session credential.

Run security tests with `npx tsx --test packages/sdk/tests/security.test.ts`. Browser checks should verify two distinct origins, origin rejection, alignment after scrolling, missing-target recovery, cancellation, safe text rendering, and confirm-before-execute.
