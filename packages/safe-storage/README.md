# @oncobase/safe-storage

`localStorage` and `sessionStorage` facades whose methods never throw.

Browsers can block Web Storage entirely: Safari private mode, blocked site data,
sandboxed iframes, enterprise policies. There, even reading `window.localStorage`
throws a `SecurityError`; a full quota makes `setItem` throw. One unguarded read
on a render or boot path crashes the reader into its recovery card, so every
app and package goes through this package. ESLint forbids raw access elsewhere.

```ts
import { safeLocalStorage, safeSessionStorage, memoryBackedLocalStorage } from "@oncobase/safe-storage";

safeLocalStorage.getItem("key");        // string | null, null when blocked
safeLocalStorage.setItem("key", "1");   // true when persisted, false when dropped
safeLocalStorage.removeItem("key");
safeLocalStorage.keys();                // string[], [] when blocked
```

- **Reads** fall back to `null` (callers apply their default).
- **Writes** are dropped silently; `setItem` returns whether the value persisted, so
  a caller that relies on persistence (a reload-once guard) can check it.
- **`memoryBackedLocalStorage`** keeps a value in memory for the page's lifetime when
  persistence fails, so a UI preference that is re-read from storage (the theme)
  still changes. Do not use it where a later read must reflect durable state.

No dependencies; safe to import from the server (every method is a no-op
without `window`).
