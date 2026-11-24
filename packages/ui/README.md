# @oncobase/ui

Oncobase imports [UI SDK](https://ui-sdk.dev/) only through this package, so the pinned beta version lives in one place.

```ts
import { Dialog, DialogContent, DialogTitle } from "@oncobase/ui/dialog";
```

Every `@ui-sdk/react/<entry>` has a matching `@oncobase/ui/<entry>`. There is no root import.

Docs for the installed version ship with the package: start at `node_modules/@ui-sdk/react/docs/llms.txt`, then read only the component pages you need (`docs/components/<name>.md`). The agent skill is `node_modules/@ui-sdk/core/skills/ui-sdk/SKILL.md`.

Components are unstyled. Style them in the consuming package with `data-slot` and state attributes (`data-open`, `data-pressed`, `data-highlighted`, ...). Global stylesheets declare `@layer ui-sdk;` above Tailwind so app styles win.
