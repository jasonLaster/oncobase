# Operator Runbook

Procedures for the multi-tenant wiki platform. The CLI surface
deliberately covers the common operations; everything else is a
short numbered procedure operators run by hand. Promote a procedure
to a CLI command after the third manual run.

Deferred operation tripwires should be promoted into this runbook or
tracked in a public issue when they become active work.

## Quick reference — `wiki:` scripts

```
bun run wiki:site:create <slug> --owner <email> [--title <t>] [--domain <h>] [--password-hash <h>]
bun run wiki:site:archive --site <slug>
bun run wiki:site:restore --site <slug>
bun run wiki:site:lock-clear --site <slug>
bun run wiki:init     --site <slug> --vault <path> [--publish-url <url>]
bun run wiki:check    --site <slug>
bun run wiki:publish  --site <slug> [--dry-run] [--force]
```

All scripts read `apps/web/.env.local` for `NEXT_PUBLIC_CONVEX_URL` and,
for publish operations, the per-site
`WIKI_PUBLISH_TOKEN_<UPPERSLUG>` env var.

## Create A New Site

1. `bun run wiki:site:create <slug> --owner <email>` (defaults the
   domain to `<slug>.localhost` for dev or `<slug>.<WIKI_BASE_DOMAIN>`
   if set).
2. Save the printed publish token immediately — only its hash is
   stored.
3. In the Vercel dashboard for the production project, add the
   domain that's printed in the CLI output.
4. Tell the publisher to run `wiki:init`, set their token in
   `WIKI_PUBLISH_TOKEN_<UPPERSLUG>` (in their shell or
   `apps/web/.env.local`), then `wiki:check` and `wiki:publish`.
5. Verify the host serves a fresh page and the cross-site leak
   suite stays green.

## Add A Custom Domain To An Existing Site

1. Confirm the request is from the site owner.
2. Append the host to the site's `domains` array via
   `bunx convex run sites:create` is wrong here — that mutation
   creates a fresh row. For an existing site, use the Convex
   dashboard (or write a one-line `bunx convex run` against a new
   `sites:addDomain` mutation when this happens for the second
   time — the tripwire to ship it).
3. Add the domain to the Vercel project (dashboard).
4. Have the publisher set DNS:
   `CNAME <host> → cname.vercel-dns.com`.
5. Verify the host resolves to the site, the password gate works
   if enabled, and `x-site-slug` injection is rejected.

## Add A Publish Token

Use additive publish tokens for normal recovery, new machines, or
additional publishers. Existing tokens keep working.

```sh
bun run wiki:site:token:add --site <slug> --name "Jason laptop"
```

Send the printed plaintext token to the publisher through a private
channel, then have them run `wiki:check` to verify.

For the local operator machine, write the token directly to the
standard publisher token file:

```sh
bun run wiki:site:token:add --site <slug> --name "operator laptop" --write-local
```

## Rotate All Publish Tokens

Full rotation should be rare: use it only when an existing token is
known to be compromised. Until a revocation CLI exists:

1. Generate a replacement token + hash:
   ```sh
   TOKEN=wpt_$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')
   HASH=sha256:$(printf %s "$TOKEN" | shasum -a 256 | awk '{print $1}')
   ```
2. In Convex, set `sites.publishTokenHash` to `HASH` and
   `sites.publishTokenHashes` to `[HASH]`.
3. Send the plaintext token to the publisher through a private
   channel.
4. Have the publisher run `wiki:check` to verify.
5. Confirm old tokens return 401 from `/api/publish/begin`.

## Archive A Site

`bun run wiki:site:archive --site <slug>`

Stops serving the site within ~15 seconds (the proxy host cache
expires). Data stays intact for reversible recovery.

## Reactivate An Archived Site

`bun run wiki:site:restore --site <slug>`

Wait up to 15 seconds, then verify home, search, comments,
downloads.

## Re-Run A Failed Publish

1. Check `sites.lastPublishStatus` and `lastPublishError` — either
   in the Convex dashboard or via:
   ```sh
   bunx convex run sites:getBySlug '{"slug":"<slug>"}'
   ```
2. Clear a stuck publish lock:
   `bun run wiki:site:lock-clear --site <slug>`. Lock auto-expires
   after 10 minutes anyway.
3. Have the publisher rerun with `--force` if hashes look
   inconsistent.
4. Verify `lastPublishedAt` advances and the cache invalidates.

`wiki:publish --dry-run` is safe to run before clearing or retrying:
it passes `dryRun: true` to `/api/publish/begin`, so it does not
acquire the 10-minute publish lock.

## Rebuild Embeddings

The publisher CLI generates embeddings using their own
`OPENAI_API_KEY`. To rebuild after a content or PII-pattern change:

`OPENAI_API_KEY=... bun run wiki:publish --site <slug> --force`

## Seed A Dev Convex Deployment

Used during the multi-site migration to populate a fresh dev
deployment with Diana data. Same flow works for any
operator-controlled site.

1. Generate token, ensure Diana row carries its hash:
   ```sh
   TOKEN=wpt_$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')
   HASH=sha256:$(printf %s "$TOKEN" | shasum -a 256 | awk '{print $1}')
   bunx convex run sites:ensureDiana \
     "{\"publishTokenHash\":\"$HASH\",\"domain\":\"localhost\"}"
   ```
2. Init the publisher CLI:
   ```sh
   bun run wiki:init --site diana \
     --vault <path-to-obsidian> \
     --publish-url http://localhost:3000/api/publish
   ```
3. Pull `BLOB_READ_WRITE_TOKEN` into `apps/web/.env.local` if asset
   uploads are wanted. Without it, `wiki:publish` still ingests
   every markdown file but skips assets with a clean
   `Vercel Blob: No token found` error.
4. Run a publish:
   ```sh
   WIKI_PUBLISH_TOKEN_DIANA=$TOKEN \
     OPENAI_API_KEY=...optional... \
     bun run wiki:publish --site diana
   ```
5. Verify by hitting `http://localhost:3000/?token=diana` and
   running the cross-site leak suite:
   `bunx playwright test e2e/multi-site-isolation.spec.ts`.

## Destroy A Site (Hard Delete)

Irreversible. Run by hand, slowly. There is no CLI command for
this on purpose — operator attention is the safety mechanism.

1. Get written authorization from the site owner.
2. `bun run wiki:site:archive --site <slug>` and wait 7 days for
   accidental-delete recovery.
3. Remove the domain(s) from the Vercel project (dashboard).
4. Delete Convex rows scoped by the site's `siteId`. Currently
   manual via the Convex dashboard or a one-shot script. Tables
   with `siteId`: `documents`, `pdfAssets`, `fileAssets`, `meta`,
   `conversations`, `messages`, `commentRooms`, `users`,
   `userSessions`, `guestNames`, `roles`, `rolePermissions`,
   `userRoles`.
5. Delete Blob keys under `sites/<siteSlug>/`.
6. Delete the Liveblocks workspace (when v1 ships per-site
   workspaces; today the deployment-level fallback is shared).
7. Delete the `sites` row.
8. Verify hosts return 404, no Blob keys remain under the prefix,
   and `bunx convex run sites:getBySlug '{"slug":"<slug>"}'`
   returns `null`.

## Export A Site's Data

1. Ask the publisher to run `wiki:publish --dry-run` to confirm
   their local vault is the source of truth — that's the
   markdown export. The dry run also reports stale remote documents
   and assets that the next real publish will tombstone.
2. Convex export for chat / comments / users (handoff): query the
   site-scoped tables via the dashboard or a one-shot script
   targeting the row's `siteId`.
3. Blob keys under `sites/<siteSlug>/` are downloadable via the
   Vercel Blob console.

## Audit Cross-Site Access After An Incident

1. Pull recent logs by `siteSlug`:
   `vercel logs --since=24h | grep '"x-site-slug"'`.
2. Query Convex for rows with mismatched siteId / siteSlug: any
   `documents`/`messages`/etc. row whose `siteId` doesn't map to
   an active `sites` row is suspect.
3. The cross-site leak Playwright suite
   (`e2e/multi-site-isolation.spec.ts`) is the structural-leak
   regression net. If a leak happens in the wild, add a
   regression case to that suite.
