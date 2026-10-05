# Two sites: oncobase.io and diana-tnbc.com

One deployment (the `diana-tnbc-wiki-vite` Vercel project) serves two public sites and answers by host:

| Host | Site | Pages |
| --- | --- | --- |
| `oncobase.io` (and subdomains) | Oncobase, the open-source platform | `/` home, `/features`, `/compare`, plus `/features.md`, `/compare.md`, `/llms.txt`, `/robots.txt`, `/sitemap.xml` |
| everything else (`diana-tnbc.com`) | Diana's knowledge base | the landing page at `/`, `/sign-in`, `/education`, `/terms-and-conditions`, and the gated wiki and API |

Oncobase's pages used to live on Diana's domain. Splitting them gives each site its own story, header, and address: Diana's site is about a family and a diagnosis, and oncobase.io is for anyone deciding whether to use or build on Oncobase (`specs/features-page.md`, `specs/compare-page.md`).

## How the host decides

`src/site-host.ts` has `isOncobaseHost` (oncobase.io, its subdomains, and `oncobase.localhost`; the `ONCOBASE_SITE_HOSTS` environment variable adds comma-separated preview aliases on the server) and `siteOrigin` (the other site's origin as seen from here). The inline reader scripts copy the host pattern because they are serialized into the HTML head, and `site-host.test.ts` keeps the copies equal.

**Server** (`server/app-shell.ts`, `server/marketing-site.ts`). `createWikiViteHandler` checks the host first:

- On the marketing host the request goes to `handleMarketingRequest` and never reaches the password gate, the session code, or Convex. It serves the three pages (the built `index.html` with that page's share card, a canonical URL on `oncobase.io`, no `noindex`, and `<meta name="wiki-site" content="oncobase">`), built files (scripts, styles, images, and the markdown and text files for agents), `robots.txt` (open) and `sitemap.xml`. Everything else is a 404, including `/api/*`, `/wiki/*`, `/sign-in`, and `/education`. Methods other than GET and HEAD get a 405.
- On any other host `/features`, `/compare`, and their `.md` twins redirect (301, five minute cache) to the same path on oncobase.io. Locally the target is `oncobase.localhost` on the same port.
- Vercel serves files in `dist` before the function, so `/features.md`, `/compare.md`, `/llms.txt`, images, and scripts are reachable on both hosts in production. That is fine: they are public, and the generated text points at oncobase.io.

**Client** (`src/root-route.ts`, `src/main.tsx`). `siteResponse()` reads the `wiki-site` marker the server sets. On the marketing site `rootRouteFor` returns `oncobase-home`, `features`, `compare`, or `not-found` and never `reader`, so no reader module, session prefetch, startup-cache handling, or telemetry runs (`reader-telemetry.ts` also drops spans on this host, and the reader shortcut and preload head scripts return early).

**Links across** use `oncobaseUrl()` and `dianaUrl()` from `src/site-links.ts`, which keep the port on localhost and use the real domains elsewhere.

## The two headers

Both sites use the shared two-row header (`PublicChrome.tsx`): a primary row that never changes within a site, and a sub header with the current page's sections. Oncobase's primary row is the Oncobase brand (a link to `/`), Features, Compare, the theme toggle, and GitHub. Diana's is the Diana brand, Education, Oncobase (a link to oncobase.io), the theme toggle, and Sign in. Diana's landing sub header calls the education section "Cartoons" so it doesn't repeat the primary "Education".

## The oncobase.io home page

`OncobaseHomePage.tsx` (`oncobase-home.css`): a textured hero ("Take control of your care.") with the pinned reader screenshot; "Read it, ask it, protect it, see it." with four tour cards into `/features#…`; "Pick the simplest thing that works." (notes tool, private knowledge base, building your own, each pointing at the right page); "Made for you and your agent." with the markdown and text files; "Built by a family going through it." with a link to Diana's site and the osteosarc.com credit; and a closing GitHub call to action. Share card: `public/oncobase-og.jpg`, also used by features and compare. An unknown path shows `MarketingNotFound`.

## Local development

Diana's site: `http://localhost:60377/` (the Vite dev server). Oncobase's site: `http://oncobase.localhost:60377/` (browsers send `*.localhost` to the loopback address). `scripts/dev-landing-plugin.ts` mirrors the host routing in dev: it marks `oncobase.localhost` pages, answers its `/api/*` with 404, and redirects `/features` and `/compare` on the Diana host. For the real server, `bun run local:stack serve` and send a `Host: oncobase.io` header. Playwright specs for the marketing site call `useMarketingSite()` from `e2e/marketing.ts`, which points them at `oncobase.localhost`.

## Going live (steps outside the code)

1. Attach `oncobase.io` (and `www.oncobase.io`, redirecting to the apex) to the `diana-tnbc-wiki-vite` project. The domain is registered with Vercel in the `jlasters-projects` team and uses Vercel nameservers, so no DNS changes are needed.
2. Deploy this change. Nothing else is required for the site to answer: the host check is built in.
3. For a preview deployment, set `ONCOBASE_SITE_HOSTS` to the preview alias you want to treat as the marketing site.
4. Submit `https://oncobase.io/sitemap.xml` to search consoles.

The theme preference and any other `localStorage` are per origin, so a visitor's theme choice does not carry between the two sites.

## Verification

`server/app-shell.test.ts` (marketing pages, no database, no API or wiki, built files, robots and sitemap, subdomains and aliases, Diana's redirects), `src/site-host.test.ts`, `src/root-route.test.ts`, `e2e/oncobase-site.spec.ts` (home, identical primary header, no reader or API requests, not-found pages, the redirect, overflow at five widths, axe), the features and compare specs (run on the marketing host), `e2e/journeys/public.spec.ts` (Diana's landing and header), and `scripts/local-smoke.ts` and `scripts/verify-standalone.ts` (both hosts on the real server).
