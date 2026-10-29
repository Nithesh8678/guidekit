# GuideKit engineering rules

Build the shared visual/voice agent platform. Cutroom is a host integration, never the product boundary. Core first. TigerGraph is the selected graph sponsor integration; browser speech recognition and synthesis are the selected voice approach. Motion polish follows verified behavior.

Run locally on loopback. Use the owner's official Codex/ChatGPT login through app-server; no API key, credential extraction, shared hosted subscription relay, or paid fallback. Treat model success as unverified until a completed live request and website outcome have been observed.

The coordinator owns root manifests, lockfile, contracts, database, auth, server, shared docs and integration. SDK agent owns packages/sdk. Dashboard agent owns apps/dashboard. Runtime agent owns packages/runtime. Work in isolated branches/worktrees once the baseline is committed. Commit only owned files and report checks and SHA; propose contract changes to the coordinator. No agent edits another agent's files without handoff.

Never commit .data, credentials, cookies, transcripts, user documents, runtime databases, personal media, or evidence containing private account details. Public repository authorized by the user. Scan tracked changes before every push. No force pushes.

Every resource is tenant-scoped. Published agent versions snapshot their knowledge/config. Runtime sessions are origin- and version-bound. Model outputs are untrusted validated data, never executable code. The browser host registers allowlisted actions, validates arguments, checks its own permissions, requires confirmation for changes, and verifies outcomes. Browser success reports are observations, not a replacement for host authorization.

Never capture password/payment/private fields or entire page text. Collect bounded accessible element labels and explicit context; allow data-guidekit-private opt-out. No arbitrary selectors or arbitrary script from the model. Highlight known target IDs and remeasure on scroll/resize. Cancellation must stop requests and active guidance.

Commands: npm ci; npm run typecheck; npm test; npm run build; npm run test:e2e; npm run test:live (real subscription use, manual opt-in). Update docs/status.md with implemented/tested/live-tested/released boundaries. No mock model fallback outside explicit tests.
