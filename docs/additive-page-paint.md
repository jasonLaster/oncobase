# Additive page painting

Investigated September 7, 2026, for
`/sources/meeting-notes/09-06---laura-esserman-response-guided-surgery-overview`.

The deployed page uses the Vite reader. Its saved first-frame HTML is inserted
before React starts; the live reader later takes over. Separate assertions on
initial visibility and eventual loaded content cannot detect a reversal during
that handoff.

The new frame monitor reproduced an unstyled cached reload on the development
server: navigation moved from x=8 to x=0, and the right rail changed from 1424px
wide to 64px. On mobile, desktop navigation could appear before CSS hid it.
Loading the app stylesheet through a render-blocking link in `index.html`
prevents the saved HTML from painting before its styles. The former import in
`main.tsx` is removed. Vite still emits one bundled stylesheet in production.

This is a confirmed local regression, not a confirmed diagnosis of the reported
production event. Two live Chromium probes, each including a cold load and a
cached reload, did not reproduce the flash. No production changes were deployed.

Validation: production build and typecheck passed; focused ESLint passed; all
four deterministic tests passed on both Chromium and WebKit (eight total).

## Regression contract

`apps/app/e2e/additive-paint.spec.ts` uses a synthetic static meeting note at the
reported route. It covers desktop defaults, saved left/right pane widths, and
mobile, each with a cold load, a cached reload, and delayed manifest refreshes.
The cached phase holds application scripts until the saved HTML is visibly on
screen, then observes the handoff to React. It also verifies snapshot persistence
and live-reader readiness so a missing snapshot cannot silently bypass coverage.

`paint-monitor.ts` is installed before application scripts. Every animation frame
checks the title, markdown body, navigation, Comments and Diagnostics links, and
right rail. Once a region appears it must remain visible, and visible rails must
retain their width and horizontal position. The monitor checks CSS visibility as
well as DOM presence and chooses the visible copy when saved/live trees coexist.
Failures attach a compact frame history. A control test deliberately hides the
article for frames and shrinks the sidebar, then restores the article; it proves
the monitor catches a regression that final-state assertions miss.

The contract is scoped to a static route without user interaction. It does not
forbid removal after logout, permission revocation, deleted content, explicit
navigation, or user-driven resizing. It is frame sampling, not a guarantee about
every pixel or every browser/network schedule.

## Running

From `apps/app`:

```sh
PLAYWRIGHT_PORT=61040 bun run test:e2e e2e/additive-paint.spec.ts
```

For a production bundle, run `bun run build`, serve it with
`bunx vite preview --host 127.0.0.1 --port 61041`, then:

```sh
PLAYWRIGHT_BASE_URL=http://127.0.0.1:61041 bun run test:e2e e2e/additive-paint.spec.ts
```

Set `PLAYWRIGHT_BROWSER=webkit` for the persistent-profile WebKit check. The live
probe is opt-in and signs in through the existing Diana gate login flow:

```sh
ADDITIVE_PAINT_LIVE=1 PLAYWRIGHT_BASE_URL=https://diana-tnbc.com bun run test:e2e e2e/additive-paint.spec.ts --grep 'live reported'
```
