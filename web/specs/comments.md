# Comments Feature Spec

Liveblocks-powered commenting system that supports page-level and text-selection-anchored comments across document pages in the wiki when comments are enabled.

## Availability

- The comments product surface is gated by `NEXT_PUBLIC_ENABLE_COMMENTS`.
- When disabled:
  - `/comments` redirects to `/`
  - the "View comments" navigation link is hidden
- When enabled:
  - document pages render the comments sidebar
  - `/comments` exposes the global timeline

## Authentication & Identity

- **Signed-in users** (via `/api/auth/signin`) are identified by their Convex user ID, display their real name and email.
- **Guest users** get a persistent random identity (e.g. "Swift Fox 472") stored in a cookie, localStorage, and Convex. Identity survives page reloads and browser restarts and can be resolved by other users.
- **Auth mode detection**: the client probes `GET /api/liveblocks-auth` on mount. If the server has `LIVEBLOCKS_SECRET_KEY` (or `LIVEBLOCKS_API_KEY`) configured, it switches to the authenticated endpoint; otherwise it falls back to the public API key.
- The `/api/liveblocks*` and `/api/auth/*` routes are exempt from the site-wide password middleware.
- The document comment UI resolves Liveblocks author IDs through `/api/liveblocks-users`, which reads signed-in user names from Convex `users` and guest names from Convex `guestNames`.

## Document Comments (per-page sidebar)

Every document page (`/[...slug]` and `/`) wraps its content in `<DocumentComments>`, which renders a collapsible comments/outline rail.

### Sidebar

- **Comments / Outline toggle** at the top of the sidebar.
- **Thread count** displayed below the toggle (e.g. "3 unresolved threads").
- **Resolved filter**: a dropdown menu lets the user toggle between "Show unresolved only" (default) and "View all threads".
- **Collapse/expand**: the rail can be collapsed to a narrow icon strip on large screens and a compact bottom bar on smaller screens. State persists in localStorage.
- On phone and iPad widths (`< lg`), comments and outline share one fixed bottom rail. The phone rail sits above the bottom navigation, while iPad widths pin it to the viewport bottom.
- **Resizable**: the right sidebar is resizable (matching the left sidebar's drag-to-resize behavior) and persists width in localStorage.

### Creating Comments

- **Page-level comment**: click "Add a page-level comment" button in the sidebar to open the Composer.
- **Selection-anchored comment**: select text in the article, a floating comment bubble appears above the selection. Clicking it opens the Composer in the sidebar with the selection quoted.
- The Composer stores metadata: `documentSlug`, `documentTitle`, and anchor offsets/quote/prefix/suffix for selection comments.

### Viewing Comments

- Threads are sorted by anchor position (if anchored) then by creation date.
- Anchored threads show a "Linked selection" header with the quoted text.
- Clicking a thread's linked selection scrolls the article to the highlighted range.
- The active thread's highlight is visually distinct (stronger opacity).
- **Shareable URLs**: selecting/focusing a comment adds a query param (e.g. `?thread=th_xxx`) so the URL can be shared with others to link directly to a specific thread.

### Text Highlights

- Anchored comments produce translucent highlight overlays on the document text.
- Highlights are rendered in a `pointer-events-none` overlay so they do not block text selection.
- Pending selections (before submitting) show a distinct highlight color.
- No numbered markers — only the highlight itself is shown.

### Comment Actions (per-comment dropdown)

For comments authored by the current user, the dropdown includes:

- **Edit comment**
- **Delete comment**
- **Copy comment** (custom action, copies plain text to clipboard)

For comments by other users:

- **Subscribe / Unsubscribe from thread**
- **Copy comment**

On the **first comment** of every thread (visible to all users):

- **Delete thread** — removes the entire thread regardless of authorship.

### Thread Actions

- **Resolve thread** button on each thread.
- **Add reaction** button on each comment.
- **Reply** composer at the bottom of each thread.

### Dropdown z-index

Liveblocks portals (dropdowns, emoji pickers) require `z-index: 50` (via `.lb-portal` CSS override) to render above the fixed sidebar (`z-30`).

## Global Comments Page (`/comments`)

- Accessible from the sidebar navigation ("View comments" link).
- Server-side API (`/api/liveblocks-threads`) fetches all threads in bulk using the Liveblocks Node SDK, resolves Convex user IDs to display names.
- Timeline sorted by most recent activity (newest first).
- Each item shows: author name (resolved from Convex or formatted guest ID), document title (linked, right-aligned), anchor quote (if any), preview text, comment count, and relative timestamp.
- Toggle between "Open only" and "View all comments" (including resolved).

## Sidebar Navigation

- **"Chat with wiki"** link always visible from navigation, even if chat is disabled and the route redirects.
- **"View comments"** link appears only when comments are enabled (no unread count).

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `LIVEBLOCKS_SECRET_KEY` or `LIVEBLOCKS_API_KEY` | For auth mode | Liveblocks secret key; enables authenticated sessions with user identity |
| `NEXT_PUBLIC_LIVEBLOCKS_PUBLIC_KEY` | No | Public key override (falls back to hardcoded dev key) |

## Key Files

- `components/document-comments.tsx` — per-document sidebar, highlight overlay, delete thread action
- `components/comments-page-client.tsx` — global /comments timeline (client)
- `app/api/liveblocks-threads/route.ts` — server-side thread fetching + user name resolution
- `components/liveblocks-provider-shell.tsx` — auth/public mode detection, guest identity
- `components/liveblocks-room.tsx` — per-room provider wrapper
- `app/api/liveblocks-auth/route.ts` — Liveblocks session endpoint
- `app/api/liveblocks-users/route.ts` — Liveblocks user ID resolution from Convex
- `lib/guest-user.ts` — guest identity generation and persistence
- `lib/session-user.ts` — signed-in user extraction from request
- `lib/liveblocks-comments.ts` — shared comment utilities (metadata, sorting, text extraction)
- `lib/liveblocks-user-resolution.ts` — server-side Convex-backed author resolution

## QA Checklist

### Page Load
- [x] Document page loads with comments sidebar visible
- [x] Comments sidebar shows correct thread count
- [x] Sidebar toggle between Comments and Outline works
- [x] Sidebar collapse/expand works and persists across reload
- [x] Right sidebar drag-to-resize works

### Global Comments
- [x] `/comments` page loads and shows threads from across documents
- [x] Each thread links to its source document (right-aligned)
- [x] Timeline is sorted by most recent activity (newest first)
- [x] User names resolved (Convex users show real names, guests show persisted guest names)
- [x] Fast loading via server-side API (not client-side room scanning)

### Creating Comments
- [x] Page-level comment: click button, type, submit — thread appears
- [x] Selection comment: select text, click bubble, type, submit — thread appears with anchor
- [x] Selection highlight appears while composing

### Comment Actions
- [x] Three-dot menu on own comment shows: Edit, Delete, Copy
- [x] Edit opens inline editor, saves changes
- [x] Delete removes the comment
- [x] Copy copies plain text to clipboard
- [x] Three-dot menu on others' comments shows: Subscribe/Unsubscribe, Copy
- [x] Delete thread action on first comment removes entire thread

### Identity
- [x] Signed-in user's name appears on their comments
- [x] Guest user gets a persistent random name (e.g. "Swift Fox 472")
- [x] Guest name survives page reload

### Text Selection
- [x] Can select text in the article without being blocked by overlays
- [x] Highlight overlays appear for anchored comments but don't interfere with selection
- [x] Clicking an anchored thread scrolls to and highlights the relevant text
- [x] Focusing an anchored thread updates the `thread` URL query param

### Sidebar Navigation
- [x] "Chat with wiki" link visible (no feature flag)
- [x] "View comments" link visible (no unread count)

### Pending
- None.
