# Low-risk startup experiment: one-response identity selection

Baseline: `819b4fcc35b49f46dc933bacfd34c7b401603463`. Both builds keep client-side React rendering, response page bootstrap, the new startup indicator, and the existing LiveStore startup path.

## Result

Automatic signed-out visits save 199–218 ms in this controlled experiment. The implementation asks the existing session endpoint for a public fallback when no account session exists. The server verifies the cookie once and returns the effective identity. Explicit public and session requests retain their behavior. Older API deployments still work through the existing 401-then-public fallback.

The automatic public response is private, no-store, and varies on Cookie. Signed-in requests use the identical account/access-specific cache-key path; an account lookup error still fails rather than selecting public. No manifest/page scope accepts an automatic mode, and no private identity is inferred from browser state.

## Article readiness, milliseconds

| CPU | Scope | Visit | Baseline | Candidate | Change |
| --- | --- | --- | ---: | ---: | ---: |
| 1× | public | cold | 479 | 475 | -4 |
| 1× | public | reload | 139 | 129 | -10 |
| 1× | auto | cold | 692 | 474 | -218 |
| 1× | auto | reload | 526 | 327 | -199 |
| 4× | public | cold | 685 | 688 | +3 |
| 4× | public | reload | 315 | 309 | -6 |
| 4× | auto | cold | 885 | 676 | -209 |
| 4× | auto | reload | 598 | 396 | -202 |

48 browser loads: three paired cold/reload samples per build, scope and CPU setting. Build order alternates by run. Fresh Chromium contexts represent cold visits; browser processes are not restarted for each sample. The two production builds run on separate loopback origins over real HTTP with gzip and normal browser caching, without Playwright request interception. Identity responses have an imposed 200 ms delay, manifest 400 ms, page API 350 ms. Both fixtures use the real session-response handler with a signed-out synthetic account and two small synthetic pages. HTML response time is approximately 1–3 ms. Real network and backend latency can differ substantially.

The frame-observed endpoint is visible React markdown, not the startup spinner or FCP. All loads seeded the response page, made zero page-body requests, and reported zero uncaught page errors, article disappearances, or article node replacements during a 900 ms follow-up window. Automatic identity requests fall from two to one. Explicit public timings differ by -10 to +3 ms, consistent with little effect on that unchanged path. This does not demonstrate a 200 ms production target, slower physical-device performance, browser bytecode-cache reuse after restart, or large-document readiness.

## Validation

- 48 focused identity/content unit tests and 32 application API tests pass.
- App and shared-content TypeScript checks, changed app-file lint, and bundle budgets pass.
- All five vendor chunks remain byte-identical to the saved baseline.
- Browser checks exercise account/public isolation, login/logout, access-key changes, explicit session recovery, stalled identity bodies, bootstrap seeding and article continuity in Chromium and WebKit.
- WebKit exposed a navigation race in the existing redirect test, where its next case began while the previous login navigation was still completing. The test now waits for the destination article before continuing; application login behavior is unchanged.

## Reproduce

Save the baseline `apps/app/dist` as `.playwright/identity-roundtrip/baseline-dist`, build the candidate, and start the fixture twice from the repository root:

```sh
PROFILE_SERVE=1 PROFILE_PORT=62173 PROFILE_DIST=.playwright/identity-roundtrip/baseline-dist bun apps/app/scripts/profile-bootstrap-cache.ts .playwright/identity-roundtrip/baseline-dist
PROFILE_SERVE=1 PROFILE_PORT=62174 bun apps/app/scripts/profile-bootstrap-cache.ts .playwright/identity-roundtrip/baseline-dist
bun apps/app/scripts/profile-identity-roundtrip.ts
```

The adjacent JSON contains the samples used above. Profile fixtures and reports contain synthetic content only. Stop fixtures before replacing a build.

## Next candidates, in priority order

1. **Public bootstrap identity on cold explicit-public visits.** Reuse the same-response public site information to start the public store while identity refresh runs in the background. A bounded, origin/site/route/version-validated payload is required; no account-session shortcut. This is smaller than removing the database dependency but benefits only explicit-public cold loads. Measure overlap first: the database/module work may already occupy most of the saved interval.
2. **Load math rendering only for documents that need it.** The current markdown vendor includes KaTeX for every page. This could reduce cold download and evaluation work, especially on slower CPUs. Use a conservative content trigger and retain math, currency, raw HTML and layout parity before adopting a split. Savings are not yet measured.
3. **Render the existing React article before database startup.** This has the largest remaining potential byte/CPU benefit, but requires stable article ownership across bootstrap, live queries, navigation and revocation. It is a separate architectural experiment, with greater regression risk than the first two.
