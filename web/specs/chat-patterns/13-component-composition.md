# Component Composition

shadcn's primitives are how the ai-elements (and our chat) compose. The patterns here are general; they apply to message rows, tool blocks, approval cards, the composer, the sidebar.

## Slot + asChild

`~/src/os/shadcn-ui/apps/v4/registry/new-york-v4/ui/button.tsx:41–61`

```tsx
function Button({ asChild = false, variant, size, className, ...props }) {
  const Comp = asChild ? Slot.Root : 'button';
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}
```

`asChild` lets the same component render as different DOM elements while inheriting styles + behavior. `<Button asChild><a href="…">Click</a></Button>` becomes a styled `<a>` without a wrapping `<button>`.

For a chat:
- `<MessageActions asChild>` could render as `<Toolbar>`, `<Menu>`, or `<ContextMenu>` depending on context.
- `<PromptInputSubmit asChild>` could render as a custom button if the design demands it.

## data-slot

Every component carries a `data-slot="<name>"` attribute. Targeting in CSS is by attribute, not by class:

```css
[data-slot="dialog-content"] { ... }
.dark [data-slot="dialog-content"] { ... }
```

Two wins:
1. Theme overrides without re-implementing the component.
2. CSS lives in one place (globals.css or a dedicated theme file) instead of co-located with each component.

For a chat:
- `data-slot="message-row"` on the user/assistant row.
- `data-slot="tool-block"` on tool renderers.
- `data-slot="streaming-tail"` on the active streaming message.

Theme overrides target these attributes. Per-tool styling goes on `data-tool="<name>"`.

## CVA — class-variance-authority

```ts
import { cva } from 'class-variance-authority';

const messageBubbleVariants = cva(
  'rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap',
  {
    variants: {
      role: {
        user: 'bg-[var(--accent-light)] text-[var(--brand)]',
        assistant: 'bg-transparent text-[var(--foreground)]',
        system: 'italic text-[var(--text-muted)]',
      },
      state: {
        active: '',
        disabled: 'opacity-50 line-through',
        editing: 'ring-2 ring-[var(--brand)]',
      },
    },
    defaultVariants: { role: 'user', state: 'active' },
  }
);
```

Combines: `role` × `state` = exhaustive variants. Type-safe (`VariantProps<typeof messageBubbleVariants>`). Adding a new variant doesn't require if/else gymnastics in render.

We currently inline class strings with ternary chains. CVA cleans that up.

## Compound components

The Sidebar, Dialog, Form, PromptInput, Conversation patterns all share this shape:

```tsx
<Root>
  <Trigger />
  <Content>
    <Header />
    <Body />
    <Footer>
      <Action />
      <Action />
    </Footer>
  </Content>
</Root>
```

Each level is a thin wrapper that:
- Adds `data-slot`.
- Applies a default class string (overridable via `className`).
- Forwards all other props.

The advantage over a monolithic `<Sidebar onClose, items, footer, ... />` config object: every consumer has full control over slot ordering, content, and conditional rendering. Composition wins.

For our chat, this means:
- `<Conversation>` + `<ConversationContent>` + `<ConversationScrollButton>` + `<ConversationEmptyState>` (which we have).
- `<PromptInput>` + `<PromptInputBody>` + `<PromptInputTextarea>` + `<PromptInputFooter>` + `<PromptInputSubmit>` (which we have).
- `<Message>` + `<MessageHeader>` + `<MessageContent>` + `<MessageFooter>` (which we don't have yet — we have a flat `<UserMessageRow>` and `<AssistantMessage>`).

Adding a `<Message>` compound would let us add per-message actions (copy, regenerate, delete, share) without rewriting the body.

## Sidebar primitives

`~/src/os/shadcn-ui/apps/v4/registry/new-york-v4/ui/sidebar.tsx:45–152`

```tsx
<SidebarProvider defaultOpen>
  <Sidebar variant="inset" collapsible="offcanvas">
    <SidebarHeader>
      <NewChatButton />
    </SidebarHeader>
    <SidebarContent>
      <SidebarGroup>
        <SidebarGroupLabel>Recent</SidebarGroupLabel>
        <SidebarMenu>
          {threads.map(t => (
            <SidebarMenuItem key={t.id}>
              <SidebarMenuButton isActive={t.id === activeId} asChild>
                <Link href={`/chat/${t.id}`}>{t.title}</Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroup>
    </SidebarContent>
    <SidebarFooter>
      <UserMenu />
    </SidebarFooter>
  </Sidebar>
  <SidebarInset>
    <header className="flex h-16 ...">
      <SidebarTrigger />
      <Separator orientation="vertical" />
      <ConversationTitle />
    </header>
    {/* main content (chat or wiki) */}
  </SidebarInset>
</SidebarProvider>
```

CSS variables drive widths:
```css
--sidebar-width: 16rem;
--sidebar-width-icon: 3rem;
--sidebar-width-mobile: 18rem;
```

Cmd+B toggles. `useIsMobile` collapses to off-canvas on small screens. Cookie-persisted state.

Our app already has a sidebar (`NavigationShell`). For a chat-style sidebar (recent conversations + new chat button), we'd add a chat-specific shell or fold conversations into the existing nav. The shadcn sidebar is over-spec for our current need but a great reference.

## Field + FieldError

`~/src/os/shadcn-ui/apps/v4/registry/new-york-v4/ui/field.tsx:81–95`

```tsx
<FieldGroup>
  <Field orientation="vertical" data-invalid={!!error}>
    <FieldLabel htmlFor="message-input">Prompt</FieldLabel>
    <FieldContent>
      <Textarea id="message-input" aria-describedby="message-help" />
      <FieldDescription id="message-help">Shift+Enter to send</FieldDescription>
      {error && <FieldError>{error.message}</FieldError>}
    </FieldContent>
  </Field>
</FieldGroup>
```

Form composition without a form library. The `data-invalid` attribute styles the field and the message; `aria-describedby` ties the description to the input. Same shape works for any form input — perfect for the composer if we ever add validation (max length, attachment count limits).

## Sonner

```ts
import { toast } from 'sonner';

toast.error('Failed to send', {
  description: 'Network error. Click to retry.',
  action: { label: 'Retry', onClick: () => resubmit() },
});

toast.success('Message saved', { description: 'Persisted to your wiki.' });

const id = toast.loading('Generating response…');
// later: toast.dismiss(id);
```

Sonner respects `next-themes` and uses CSS variables. Wraps the app at the root (we'd add `<Toaster />` to the root layout). One line per toast.

## What our chat does

- `<Conversation>` + `<PromptInput>` compound components from ai-elements. ✓
- `<PriorMessages>` + `<StreamingMessage>` split. ✓
- Per-part renderers wrapped in `React.memo`. ✓
- ai-elements ships its own ui primitives (button, input, textarea, dialog, etc.) — installed via the registry. ✓
- No Sonner integration in the chat path. (We have it elsewhere in the app maybe; check.)
- No `<Message>` compound — flat `<UserMessageRow>` + `<AssistantMessage>` components.
- No CVA — inline class strings with ternaries.

## What to add

1. **`<Message>` compound** with `<MessageHeader>`, `<MessageContent>`, `<MessageFooter>`. The footer hosts per-message actions (copy, regenerate, delete, fork). User and assistant messages share the compound; the role determines which actions appear.

2. **CVA for message bubbles + tool blocks.** Cleaner than inline class ternaries. Adds compile-time exhaustiveness.

3. **`<Toaster />` in the root layout** (if not already there). Use `toast.error` for transient network errors, `toast.success` for saved/copied notices, `toast.loading` for long-running actions (export, fork).

4. **`data-slot` on every chat component.** We do this for ai-elements components; extend to our custom ones (`<UserMessageRow>` → `data-slot="message-row"`, etc.). Lets a future theme override target chat without touching components.

5. **Accept `asChild` on `<Message>` and `<MessageActions>`.** Power users (or wikilink-rich pages) can drop in custom action UIs.

## Top patterns to steal

| Pattern                                              | From          |
| ---------------------------------------------------- | ------------- |
| `Slot` + `asChild` for polymorphic rendering         | shadcn        |
| `data-slot` attribute conventions                    | shadcn        |
| `cva` for variant + state combinations               | shadcn        |
| Compound components (Root/Trigger/Content/...)       | shadcn        |
| `<Field>` + `<FieldError>` for form composition       | shadcn        |
| `<Toaster>` (Sonner) at the root                     | shadcn        |
| CSS-variable theming                                  | shadcn        |
| Compound-component message row (header/content/footer)| (recommended) |
