# Dashboard verification

Build with Node 24 and `npm run build`, then run:

```sh
npx playwright test --config apps/dashboard/playwright.config.ts
npx playwright test --config apps/dashboard/playwright.integration.config.ts
```

The first suite serves built dashboard assets on loopback port 4630 and intercepts every API request with explicit synthetic fixtures. It verifies publication failure/retry controls, draft preservation, safe immutable inspection, nondefault installation origins, readiness polling, diagnostic failures, activity colors, keyboard focus and mobile overflow. It does not prove the server or a live provider.

The second suite uses the actual server, account APIs, SQLite repository and publication lifecycle in the existing isolated fixture on ports 4510–4512. It verifies knowledge edits, immutable versions, rollback, unpublish, and pinned-session retrieval. Only inference is synthetic; no model subscription, TigerGraph credentials or external service is used. Do not run this alongside the root browser suite, which uses the same fixture ports.
