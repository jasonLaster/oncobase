# Data overlay (data.diana-tnbc.com)

`data.diana-tnbc.com` serves files from the S3 bucket
`diana-omics-private-results-172630973301-us-east-1` (us-east-1) as
redirects to short-lived presigned GET URLs. Public files are open to
everyone. Private files use the visitor's diana-tnbc.com account and roles.
No bytes pass through Vercel.

Code: `server/data-overlay/`. The policy is `server/data-overlay/prefix-roles.ts`.

## Routing

- `vercel.json` rewrites every path on host `data.diana-tnbc.com` to
  `/api/app-shell?__path=$1`, ahead of the wiki rewrites.
  `api-runtime/root-app-shell.ts` sees the host and lazily loads
  `server/data-overlay/entry.ts`. It reads the client path from the raw
  request URL, because URL normalization would resolve `..` before the
  overlay could reject it.
- `api-runtime/index.ts` answers 404 for the data host, so a direct
  `data.diana-tnbc.com/api?...` call never reaches the wiki API.
- `server/standalone.ts` makes the same host dispatch. Outside production,
  `data.localhost` also counts as the data host.
- Vercel serves static files from `dist/` (`/assets/*`, `/favicon.ico`,
  `/robots.txt`, …) before it applies rewrites. Those app files therefore
  shadow same-named public datasets on the data host. Don't publish datasets
  at those paths.

## URL scheme

| URL | Result |
|---|---|
| `/` | Index: HTML, or JSON with `Accept: application/json` |
| `/index.json` | Index as JSON |
| `/private/<path>` | S3 key `private/<path>`, role checked |
| `/<anything else>` | S3 key `public/<anything else>`, open |
| `/_auth/signin?next=` | Start the sign-in handoff |
| `/_auth/callback` | Finish the handoff |
| `/_auth/signout` (POST) | End the data-host session |

Only a first segment of exactly `private` is private, so `/privatex/a`
maps to `public/privatex/a`. The overlay validates the path before
classifying it and answers 400 to any of these:

- `.` or `..` segments
- empty segments (`//`, a trailing `/`)
- backslashes, control characters or NUL
- percent-encoded `.`, `/`, `\`, `%` or NUL
- any `%` left after one decode (double encoding)
- invalid UTF-8
- keys over 1024 bytes

The key is built from the same decoded segments, then asserted to sit
strictly under `public/` or `private/`. Public keys under
`public/private/`, `public/_auth/` and `public/index.json` have no URL.

## Responses

| Case | Response | Expiry | Cache-Control |
|---|---|---|---|
| Public file | 302 to a presigned GET | 900 s | `no-store` |
| Private, permitted | 302 to a presigned GET; S3 is also asked to reply `private, no-store` | 300 s | `private, no-store` |
| Private, anonymous | 302 to diana-tnbc.com sign-in, the same for every path | — | `private, no-store` |
| Private, signed in without the role | 404 `Not found`; nothing is signed | — | `private, no-store` |
| Bad `Authorization: Bearer` | 401 (no redirect) | — | `private, no-store` |
| Index | 200 | — | `private, no-store` |

Every response also sends `CDN-Cache-Control: no-store`,
`Vercel-CDN-Cache-Control: no-store` and `Referrer-Policy: no-referrer`.

Public redirects aren't cached because signing is local HMAC work with no
S3 call. Caching them would save almost nothing, and a cached `Location`
would keep handing out a URL that is closer to expiry.

## Who can read private keys

The policy lives in `server/data-overlay/prefix-roles.ts`:

| Prefix | Roles |
|---|---|
| `private/slides/ucsf-svs/` (originals, PHI) | Patient, Admin |
| `private/slides/ucsf-svs-deid/` | Patient, Admin |
| `private/curefirst/` | Admin, Patient |
| `private/companies/serova/` | Serova, Patient |

- **Role names** are the site's existing roles. They come from
  `access.listUsersWithRoles` (explicit assignments plus email-pattern
  grants), which `isAdminSessionUser` also uses, and they match
  case-insensitively. The site owner counts as Admin. The roles are read
  again on every request.
- **Prefixes** start with `private/` and end with `/`. When several match,
  the longest one decides. The module refuses to load if a rule is
  malformed.
- **Default deny:** any key outside `public/` without a matching prefix is
  unreachable. That includes `staging/`, `runs/`, `modal/` and any
  unlisted `private/` path.
- **Index:** it lists the public manifest plus private objects. Private
  objects come from `ListObjectsV2` limited to the viewer's prefixes,
  capped at 1000 per prefix, and each key is checked against the policy
  again.

## Sign-in on the subdomain

The account cookie `wiki_user_session` is host-only (no `Domain`
attribute), and it stays that way.

1. An anonymous request for a private path, or **Sign in** on the index,
   sets a random `data_overlay_state` cookie on the data host. That cookie
   is host-only, HttpOnly, `Path=/_auth/` and lasts 10 minutes. The request
   then redirects to
   `https://diana-tnbc.com/api/data-overlay/handoff?next=…&state=…`.
2. That route requires an account session. Without one, it goes through
   `/sign-in` and back.
3. It then mints an HMAC-SHA256 token signed with
   `DATA_OVERLAY_HANDOFF_SECRET`. The token carries `{typ, sub: userId,
   site, aud: data origin, state, iat, exp = iat + 60 s}`. The route
   redirects to `<data origin>/_auth/callback?token=…&next=…`. The data
   origin always comes from configuration.
4. The callback verifies the following:
   - the signature, `typ`, `site` and `aud`
   - that the token is unexpired
   - that its lifetime is at most 60 s
   - that `state` equals the state cookie, so a leaked token is useless in
     another browser
5. The callback creates a new row in the same Convex `userSessions` table
   and sets it as `data_overlay_session`. The cookie is host-only,
   HttpOnly, `SameSite=Lax`, `Secure` and lasts 12 h. When an admin
   changes a user's role, that user's sessions are revoked, and this
   session goes with them.

API and agent clients can skip all of this. They send
`Authorization: Bearer <token>`, using an account token from
`POST /api/auth/tokens`. The overlay doesn't accept `?access_token=`.

## Audit

For every private request from a signed-in viewer, the overlay writes one
JSON line to the function's stdout. It lands in Vercel runtime logs:

```json
{"event":"data_overlay.private_access","time":"…","outcome":"granted|denied","userId":"…","email":"…","via":"cookie|bearer","key":"private/…","expiresInSeconds":300}
```

The repo has no other audit store. Keep logs for as long as the access
record is needed, for example with a log drain.

## Environment

| Variable | Required | Notes |
|---|---|---|
| `DATA_OVERLAY_S3_BUCKET` | yes | `diana-omics-private-results-172630973301-us-east-1` |
| `DATA_OVERLAY_AWS_REGION` | no | Default `us-east-1` |
| `DATA_OVERLAY_AWS_ACCESS_KEY_ID` | yes | Signer IAM user; the default AWS credential chain is never used |
| `DATA_OVERLAY_AWS_SECRET_ACCESS_KEY` | yes | Sensitive |
| `DATA_OVERLAY_HANDOFF_SECRET` | yes, for browser sign-in | At least 32 characters, for example `openssl rand -base64 48`. Sensitive. Without it the handoff answers 503; bearer tokens still work |
| `DATA_OVERLAY_ORIGIN` | no | Default `https://data.diana-tnbc.com`. It is the handoff audience and the callback target |
| `DATA_OVERLAY_MAIN_ORIGIN` | no | Default `https://diana-tnbc.com` |
| `DATA_OVERLAY_SITE_SLUG` | no | Default `diana`. Only this site's accounts are trusted |
| `DATA_OVERLAY_HOSTS` | no | Comma-separated host override for dispatch |

Without S3 settings, file and index requests answer 503. A private
request still checks auth first.

## Signer IAM permissions

- `s3:GetObject` on `arn:aws:s3:::<bucket>/public/*` and on each mapped
  prefix: `private/slides/ucsf-svs/*`, `private/slides/ucsf-svs-deid/*`,
  `private/curefirst/*` and `private/companies/serova/*`. Presigned URLs
  carry the signer's permissions, and the manifest read uses the same grant.
- `s3:ListBucket` on `arn:aws:s3:::<bucket>` with an `s3:prefix` condition
  limited to the four mapped private prefixes (`private/…/*`).
- `kms:Decrypt` on the SSE-KMS key used by `private/` objects.
- Nothing for `staging/`, `runs/` or `modal/`, and no write permissions.

When you add a prefix to `prefix-roles.ts`, grant the matching IAM scope.

## Ops steps

1. Create the signer IAM user and policy above.
2. In Vercel project `diana-tnbc-wiki-vite` (Production), set the
   `DATA_OVERLAY_*` variables.
3. Add the domain `data.diana-tnbc.com` to the project and create its DNS
   record.
4. Redeploy. Then check `/` (index), one public file, a private file while
   anonymous (redirects to sign-in), one without the role (404) and one with
   it (302 to S3).

Locally, run `bun server/standalone.ts` and open
`http://data.localhost:62003/`. Set `DATA_OVERLAY_ORIGIN=http://data.localhost:62003`,
`DATA_OVERLAY_MAIN_ORIGIN=http://localhost:62003` and the S3 variables
first.
