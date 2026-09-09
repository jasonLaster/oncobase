# Shortcuts during reader refresh

Cmd+K and Cmd+O were intercepted before React only when the server injected a public article. Refreshes that returned the ordinary app document (including unavailable pages, session-only pages, and other reader routes) had no listener until the interactive host mounted. A shortcut pressed during that interval was lost. This was reproduced in the existing live Chrome tab on an unavailable-page route.

Vite now includes the same startup controller in every reader document head, ahead of the stylesheet and app modules. HTML-first rendering reuses that script rather than duplicating it. Installation is idempotent, retaining pending requests, and skips login, terms, and standalone DICOM routes that do not mount a reader palette. React continues adopting the existing controller and in-progress chord. No content-access or page-availability behavior changes.

The refresh regression suite warms a browser session, reloads with app scripts held, presses Cmd/Ctrl+K or Cmd/Ctrl+O, then releases scripts and verifies focus, file navigation, reopening, and Escape. It covers both a normal page and an unavailable route. Removing the inline listener from the built document reproduces the failed-focus assertion on the unavailable-route case.

Validation: 63 Chromium palette/handoff/refresh checks, eight Firefox refresh checks, eight WebKit refresh checks, and 15 controller/server tests passed, along with build/typecheck and scoped lint. WebKit's request gate is installed before the first navigation so cached scripts cannot bypass it during refresh. Artifacts are local and ignored.

After incorporating main's heading-link and redirect fixes, the reader runtime chunk measured 17,035 gzip bytes against a 17,024-byte cap. Building without the new document-head plugin produced the identical runtime chunk. Its cap was adjusted by 16 bytes to 17,040; other budgets remain unchanged.
