# Surface gates

Three specs over one registry of surfaces (`surfaces.ts`): reader pages, overlays, admin, tools,
education and the marketing site, in light and dark, desktop (1440×900) and, where marked,
mobile (390×844). They run only against the local stack (`bun run local:stack`), which serves
the synthetic fixture vault in `scripts/fixtures/local-stack-vault`. The config refuses a
deployed or non-local URL, because CI uploads these screenshots from a public repository.

This suite lives outside `e2e/` on purpose: CI also runs `e2e/` against deployments.

| Spec | Gates | In CI |
| --- | --- | --- |
| `visual.spec.ts` | One screenshot per surface × theme × viewport against `__screenshots__/linux`. | Report only: diffs are uploaded, the job stays green. |
| `accessibility.spec.ts` | axe-core, every impact level, tags `wcag2a wcag2aa wcag21a wcag21aa wcag22aa`, ratcheted by `known-axe-violations.json`. | Blocking. |
| `keyboard.spec.ts` | Tab count to `<main>`, skip link, focus and announcement after client navigation, scroll restoration on Back, overlay focus trap / Escape / focus return, no invisible focus stops. Ratcheted by `known-keyboard-failures.json`. | Blocking. |
| `layout-shift.spec.ts` | Cumulative layout shift during a cold load with the CPU slowed 4x, per surface (light theme), under 0.1. | Blocking. |

## Running

From `apps/app`, with the stack up (`bun run local:stack`):

```sh
bun run surfaces:gates        # accessibility + keyboard + layout shift (fast, any OS)
bun run surfaces:test         # all three; visual compares only on Linux
bun run surfaces:ratchet      # rewrite the known-*.json ratchet files from the current run
bun run surfaces:typecheck    # tsc over this directory and the config
```

The suite starts its own standalone server on `SURFACES_PORT` (default 63010) and never reuses a
server already on that port. Filter as usual: `bun run surfaces:gates -- -g reader-article`.

### Visual baselines (Linux, in Docker)

Baselines are rendered in the official Playwright image matching `@playwright/test`, the same
image CI runs in, so fonts and anti-aliasing match.

```sh
bun run surfaces:update                   # regenerate __screenshots__/linux (needs Docker)
bun run surfaces:docker -- visual.spec.ts # compare in the container
bun run surfaces:docker -- -g "reader"    # any Playwright arguments
```

`docker/run.sh` mounts the repo read-only, copies it into the container, installs Linux
`node_modules` and starts a container-local stack, so the host's install and stack are never
touched. A named volume (`oncobase-surfaces-cache-linux-amd64`) caches bun, its install cache and
the `convex-local-backend` download; a run takes 2–3 minutes. On Apple Silicon the default
platform is `linux/amd64` (emulated, to match CI's runners); `SURFACES_DOCKER_PLATFORM=linux/arm64`
is faster but its pixels may differ slightly from CI.

A visual run on macOS writes to `__screenshots__/darwin/`, which is gitignored and only useful
for local before/after comparisons.

When a UI change is intended: run `bun run surfaces:update`, review the changed PNGs in the diff,
and commit them with the change.

## How the ratchets work

Each ratchet file records today's backlog, keyed by `surface.theme.viewport` (axe) or
`check.surface.viewport` (keyboard).

- **Fails on regressions.** A rule or check not in the file fails, as does an axe rule whose
  node count grew, or a numeric keyboard check (Tab presses to `<main>`, invisible focus stops)
  whose number grew.
- **Fails on unrecorded fixes.** If a recorded violation disappears, its node count drops, or a
  recorded keyboard failure now passes, the test fails and asks you to run
  `bun run surfaces:ratchet` and commit the smaller file. The files can therefore only shrink.
- **Updating.** `SURFACES_RATCHET=update` (what `surfaces:ratchet` sets) makes every test record
  its current state instead of asserting. `ratchet-teardown.ts` merges the results into the
  files; keys that were not run keep their values, so a filtered update is safe. Reviewers
  should see only deletions or smaller numbers in the diff. Growth needs a reason.

The axe and keyboard results are the same on macOS and in the Linux container, so the ratchet
files can be regenerated on either.

## The keyboard contract

`keyboard.spec.ts` is written against the contract the accessibility fixes implement:

- the first focusable element is the skip link `[data-test-id="skip-link"]`, targeting
  `main#main-content`; focus reaches `<main>` within 2 Tab presses;
- after a client-side navigation, focus moves to the article `h1` (`tabindex="-1"`) or `<main>`,
  and the polite live region `[data-test-id="route-announcer"]` reads `Loaded {page title}`;
- Back restores the previous scroll position;
- the command palette, actions menu, mobile navigation sheet, the admin "Create role" modal and
  the expanded table keep Tab inside, close on Escape and return focus to their opener;
- no focus stop is invisible once its focus transition has finished.

## Adding a surface

Add an entry to `SURFACES` in `surfaces.ts`, using a fixture page that exists. Then run
`bun run surfaces:ratchet` and `bun run surfaces:update`, and commit the new ratchet entries and
baselines.
