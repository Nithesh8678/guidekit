# Test GuideKit yourself

Start the saved production build with `npm start` from the project folder. The dashboard is http://127.0.0.1:4410, CRM is http://127.0.0.1:4411, and support desk is http://127.0.0.1:4412. Keep this terminal running. Use desktop Chrome or Edge for microphone testing; browser speech recognition is not available in every embedded browser. A working network and microphone permission are needed. Audio may be processed by your browser vendor. GuideKit does not record or store audio.

## Configure and install

1. Open the dashboard. Use your existing account, or create your own workspace. Create a CRM agent with the CRM starting capabilities.
2. In Knowledge choose **Use CRM example**, then **Add document**. Check Setup contains the CRM origin `http://127.0.0.1:4411` and the actions `create_contact` and `update_contact_status`. Save and **Publish agent**.
3. Publishing prepares TigerGraph before activating the candidate. Wait for the ready/active confirmation, then check Install → Setup diagnostics and Publication versions. A failed candidate leaves the previous version active; use Retry preparation after fixing connectivity. Inspect a version to see its immutable source snapshot, or activate an earlier ready version to roll back.
4. Copy the installation snippet. Open http://127.0.0.1:4411/?install=manual . Initially there must be no assistant launcher and the page says **SDK not loaded**.
5. Paste the snippet and click **Install SDK**. Wait for **Connected**, the correct agent name, published version and permitted action count. The actual SDK and session API are used; a failed connection must show an error.

## Voice, guidance and actions

1. With the CRM tab focused, press **Command+Shift+K** on Mac or **Ctrl+Shift+K** on Windows. Allow microphone access when asked. Wait for **Listening**.
2. Say: **How do I add a contact?** Press the same shortcut again to finish and send. The chat should tuck away and leave a compact guide next to the active field. Type a full name, then pause briefly: the highlight should move to Company without moving your typing cursor. Fill Company, then select a Status. Dropdown changes advance immediately. Next keeps an existing/default selection. The guide follows valid field exits immediately, supports fast Tab navigation, and reads step instructions if browser spoken answers are enabled. Click Create contact yourself: the guide waits for the host to verify the saved record, then returns to chat. Pause, Back, Next and Automatic progress let you control the pace. Open chat pauses the guide and offers Resume guide.
3. Start again and say: **Create a contact named Taylor Morgan at Acme Studio, status New.** Finish with the shortcut. Review action details. Nothing should be saved before **Approve and run**. Approve once and verify the new contact, success receipt, and persistence after reloading.
4. During guidance, press **Escape** or Stop visual guidance: the guide should stop and chat should return, with no pending auto-advance. Try another action proposal and **Decline**. No record should appear. Start speech and press **Escape**: the panel closes, recognition stops, and delayed speech must not send a question. Reopen and check typing still works.
5. Use **Remove assistant** in the installation panel. The launcher must disappear and the shortcut must do nothing. Reinstall from the snippet to reconnect.
6. In Dashboard → Activity, refresh and inspect the actual request/action outcomes. Synthetic CRM records are stored in this browser, not in an external CRM.

Before asking, look for the cursor docked in the chat header. After the answer is ready, chat should tuck away and that same cursor should fly to the first field before its highlight draws. Try Open chat: the cursor should fly back into the header. Resume guide sends it out again. During a walkthrough, scroll and resize: movement mid-flight should retarget smoothly, the drawn mark must follow the real field, and the small guide card must stay within the viewport. Progress is retained across chat. With the OS/browser Reduce Motion preference enabled, marks should appear without sweeping cursor flights. To compare normal motion, disable that preference and start a fresh guide. Narration uses actual browser speech playback; an unavailable voice falls back to the visible instructions.

If voice is unsupported, the microphone is disabled with a reason and typed chat works. If permission is denied, allow microphone access in the browser's site settings and retry. If recognition reports a network error, check connectivity and retry or type; the application does not claim successful transcription. A browser service failure cannot be guaranteed away by application code.

## Show TigerGraph's contribution

Add two short documents to a test agent: **Invoice routing** with `Invoice questions use the billing workflow.`, and **Statement exports** with `Billing statement exports are available to workspace owners.` Publish and wait for that version to become ready, then open a fresh website session and ask **What should I know about an invoice?** The graph can connect both sources through `billing`, including the second document that never says `invoice`. Expand **TigerGraph relationships** in the answer to see document → concept → related document evidence. Relationship paths explain retrieval; source excerpts support the answer's facts.

The same SDK works on the support website with a separately configured support agent and its own knowledge, origins and `create_ticket` action. Test it after the CRM flow; the core platform is independent of either host.

## Platform and recovery checks

- Edit a knowledge document, save it, and inspect an earlier version in Install. Its source text must stay frozen. Use Knowledge → Test published knowledge to preview matching sources without a model call; temporary expected-document cases measure retrieval only.
- Publish a new version, activate an earlier ready version and inspect new versus already-pinned website sessions. Unpublish stops new sessions; existing sessions retain their version. Do this on a separate test agent, since it intentionally changes availability.
- Open Account & team for profile, password, session revocation, invitations, roles, workspace switching and audit. Local account links arrive in the private operator outbox under the selected data directory, not in an external mailbox. Never share its contents. Use separate synthetic accounts for role/recovery experiments.
- Install supplies a content-hash script URL, integrity and anonymous crossorigin. Copy the complete snippet into the installation lab. An altered integrity value must fail to load. Keep a prior release path for host rollback.
- Activity shows real request outcomes plus workspace request capacity and aggregate per-agent durations. Development speech/model fixtures are explicitly separate from live checks.
- Follow [operations.md](operations.md) for online backup, private archive verification, guarded offline restore and history retention. Test restore into a new disposable directory; never experiment on your only live copy.
- Cutroom's separately committed `feat/guidekit-integration` branch has an opt-in connection in Provider and privacy settings. Follow that checkout's `docs/guidekit-integration.md`; its temporary demo on port 5373 uses a separate workspace and does not open your existing media.

Automated checks: `npm run check`, `npm run test:e2e`, `npm run test:dashboard`, and `npm run test:dashboard:integration`. Run browser suites sequentially because some share fixture ports. The optional `npm run test:live` uses the local subscription; `npm run test:graph` checks the configured real graph with synthetic scopes. Physical speech quality, real input methods and packaged-device behavior remain separate human/device checks.
