# OncoGuide

Next.js App Router with static export, built from the public
[OncoGuide content repository](https://github.com/jasonLaster/oncoguide).
Lessons use the same `/education/...` paths and also support `/wiki/education/...`.
The existing Diana education site and its content remain available.

```sh
bun install --frozen-lockfile
bun --cwd packages/smart-table build
bun --cwd apps/oncoguide build
bun --cwd apps/oncoguide test:unit
bun --cwd apps/oncoguide test:e2e
```

`content.lock.json` pins the default content commit. Set
`ONCOGUIDE_CONTENT_DIR=/absolute/path/to/oncoguide` to build a reviewed local
checkout, or `ONCOGUIDE_CONTENT_SHA` to build another committed revision.
`ONCOGUIDE_BASE_URL` runs browser tests against an existing deployment. The local
browser checks serve the exported `out/` directory, not a development server.

The content repo's Vercel project builds this app from the exact Oncobase commit
in its `renderer.lock.json`. Native Git previews and production builds therefore
run on content changes without cross-repository deployment tokens. Content PRs
also run the same static build and browser checks in GitHub Actions. To release
updated application components, update that renderer commit in the content repo;
the resulting content commit is reviewed and rebuilt like any other release.

The app compiles Markdown at build time using the shared renderer's optional host
adapters. Images and downloads become local static assets, education links stay
local, and other wiki links point back to Diana. Source Markdown is unchanged.
Navigation and article markup are statically rendered; small Client Components
provide search, themes, mobile navigation and the shared Markdown enhancements.
The client entry points do not import the Markdown compiler or the care runtime.

The initial content copy uses `scripts/copy-content.ts <diana-repo>
<empty-destination> [commit/ref]`. It reads committed Markdown only, copies its
referenced asset graph (including inferred dark variants), verifies LFS hashes,
and records a source provenance receipt. It does not delete or publish Diana
content, and never exports its private Git history.
