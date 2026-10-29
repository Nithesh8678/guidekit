# Dashboard verification

Build with Node 24 and `npm run build`, then run:

```sh
npx playwright test --config apps/dashboard/playwright.config.ts
npx playwright test --config apps/dashboard/playwright.integration.config.ts
```

The first suite serves built dashboard assets on loopback port 4630 and intercepts API and SDK-manifest requests with explicit synthetic fixtures. Its 13 cases verify publication failure/retry controls, draft preservation, safe immutable inspection, account/team roles, invitation/recovery fragments, configured installation origins, immutable release/SRI snippets, readiness polling, retrieval previews/evaluation, diagnostic failures, usage/activity, keyboard focus and mobile overflow. It does not prove the server or a live provider. Account-link tokens and all credentials in these cases are synthetic; the suite checks that link tokens are not copied into browser storage or request URLs.

The second suite uses the actual server, account APIs, SQLite repository, SDK manifest and publication lifecycle in the existing isolated fixture on ports 4510–4512. Its two cases verify knowledge edits, immutable versions, rollback, unpublish, pinned-session retrieval, preview/evaluation, profile/password changes, other-session revocation, local invitation/revoke delivery and security activity. Inference is synthetic and retrieval uses the real local index; no model subscription, TigerGraph credentials or external service is used. Real invitation/reset/verification links are not read from the operator outbox by this browser suite; those UI paths use the explicit contract fixtures above. Do not run this alongside the root browser suite, which uses the same fixture ports.
