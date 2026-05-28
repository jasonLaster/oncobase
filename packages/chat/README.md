# @diana-tnbc/chat

Configurable full-stack chat UI for Next.js apps. The package owns the reusable
client experience, AI SDK transport wiring, Convex persistence references, and
small route helpers. Host apps own their generated Convex API, route handler,
domain prompts, tool definitions, markdown rendering, and product copy.

## Package Boundary

- Pass generated Convex function references through `ChatRuntimeProvider`.
- Configure host paths with `routes`, for example `/chat` or `/assistant`.
- Configure empty-state copy, suggested prompts, and labels with `copy`.
- Configure host-specific markdown with `MarkdownRenderer`.
- Configure host-specific tool displays with `ToolCallRenderer`.
- Configure source extraction with `extractSources`.
- Use `ConversationListCore`, `ConversationActionsMenu`, and `ArchivedChatsCore` when a non-Next host needs the same chat sidebar rows, actions, and archived-management surface with its own router adapter.

Convex codegen should run in the host app that defines the Convex functions. This
package should not import `@convex/_generated/*` or any host source aliases.

```tsx
"use client";

import { ChatRuntimeProvider } from "@diana-tnbc/chat/runtime";
import { api } from "@convex/_generated/api";

export function AppChatProvider({ children }: { children: React.ReactNode }) {
  return (
    <ChatRuntimeProvider
      apiPath="/api/chat"
      convexApi={{ conversations: api.conversations }}
      routes={{ basePath: "/assistant" }}
      copy={{
        emptyStateTitle: "Assistant",
        emptyStateDescription: "Ask a question to start a conversation",
      }}
    >
      {children}
    </ChatRuntimeProvider>
  );
}
```
