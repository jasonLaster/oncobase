# Accessibility

The chat surface is naturally accessible if we hold the right invariants. Most failures come from over-eager animations, missing roles, focus traps in dialogs, or auto-scrolling that fights the screen reader.

## ARIA roles for the chat surface

`role="log"` + `aria-live="polite"` on the message list:

```tsx
<Conversation role="log">
  <ConversationContent aria-live="polite">
    {/* messages */}
  </ConversationContent>
</Conversation>
```

`role="log"` semantically declares the region as a chronological log of events. Screen readers announce new entries. `aria-live="polite"` means new content is announced at the next quiet moment, not interrupting other speech.

ai-elements `<Conversation>` sets `role="log"`. We add `aria-live="polite"` on `<ConversationContent>`.

**Don't** use `aria-live="assertive"` — it interrupts whatever the user is reading. Reserve assertive for genuine alerts (e.g., "Connection lost").

## Pending / streaming announcements

While the assistant is producing tokens, every appended chunk would re-fire the polite region. That's noisy. Two strategies:

1. **Announce only on finish.** The streaming-tail message has `aria-live="off"`. When it transitions to a committed message, mirror it into a separate `aria-live="polite"` region briefly, then drop. Used in some accessible chat libraries.

2. **Announce at intervals.** The streaming-tail content is throttled (50ms DOM commits already). If the tail re-renders within an aria-live region, screen readers usually coalesce updates within ~500ms. Our 50ms throttle is faster than the screen reader's debounce — it works in practice.

Option 2 is what ai-elements ships; it's the path of least resistance.

For "the model is thinking" status (before first token), use a separate `role="status"` region:

```tsx
{status === 'submitted' && (
  <div role="status" aria-label="Generating response">
    <BouncingDots />
  </div>
)}
```

## prefers-reduced-motion

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; }
}
```

Tailwind v4 ships `motion-reduce:` utilities:

```tsx
<span className="animate-bounce motion-reduce:animate-none" />
```

Apply to:
- Bouncing dots while submitted (we already do this).
- Streaming caret (if we add one).
- Auto-scroll smoothness (`<StickToBottom resize="smooth">` should fall back to `'instant'`; ai-elements does this).
- Spinner in tool blocks.

ai-elements components already respect `motion-reduce` for spinners. Verify in the snapshot suite.

## Focus management

Three rules:

1. **Composer keeps focus** when no dialog is open. autoFocus on `<PromptInputTextarea>` covers initial mount; we don't refocus on every render (would steal focus from any open menu).

2. **Modals trap focus.** Radix/base-ui dialogs do this for free.

3. **Focus moves predictably on action.** Click "Stop" → focus stays on Stop until it transitions to "Submit", then moves to the (now-focused) Submit button. ai-elements `<PromptInputSubmit>` is a single button whose label changes; focus naturally remains on it.

## Keyboard shortcuts

We should support, at minimum:
- `Enter` — submit (IME-safe).
- `Shift+Enter` — newline.
- `Cmd/Ctrl+K` — slash command palette (when added).
- `Cmd/Ctrl+B` — toggle sidebar (shadcn convention).
- `Cmd/Ctrl+/` — focus composer (regardless of where focus is).
- `Esc` — close any open dialog or palette; otherwise abort the active stream.
- `Up/Down` — when composer is empty, navigate to the previous/next user message and edit.

The shadcn Sidebar wires Cmd+B already. The cmdk palette wires Cmd+K. Composer focus and stream-abort-on-Esc are ours to add.

## Color contrast

CSS-variable themed UIs need verified contrast in both light and dark modes:
- User message bubble vs page background: ≥ 4.5:1 (text).
- Assistant message text vs page background: ≥ 4.5:1.
- Citations and wikilinks: ≥ 4.5:1 (often a tinted color; check both modes).
- Disabled states: ≥ 3:1 (per WCAG for non-essential text, including the disabled-message strikethrough).
- Focus rings: ≥ 3:1 against adjacent surfaces.

Tools: axe-core, Lighthouse, manual `oklch()` math for shadcn's tokens. The shadcn defaults pass 4.5:1 in both modes.

## Screen reader user paths

Walk the chat as if you were a screen reader user:

1. **New conversation** — page mounts. Hear: title heading, empty state hint, suggested questions list, composer with description "Type your question, Shift+Enter for newline".

2. **Submit** — hear "Sending message" (status region) or skip; hear assistant message landing.

3. **Streaming response** — hear chunks landing in the polite region. Tools log a brief status line ("Searching wiki for KEYNOTE-522") and then their results.

4. **Error** — hear "Error: …" via assertive region. Focus moves to the retry button.

5. **Edit message** — keyboard up arrow on empty composer focuses last user message. Enter to edit; Esc to cancel.

We don't fully cover #5 today. The pencil icon on hover is mouse-only.

## Reading order vs visual order

Some of our tool blocks are visually compact (small badges) but logically rich (search returned 12 results). Screen readers read what's in the DOM, not what's painted. If the visual order is "label, badge, …", the DOM order should match.

Don't use CSS positioning to reorder content for screen readers. Use `aria-label` on icon-only buttons, `sr-only` text on collapsed regions:

```tsx
<button onClick={toggle} aria-expanded={open}>
  {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
  <span className="sr-only">{open ? 'Collapse search results' : 'Expand search results'}</span>
</button>
```

## What our chat does

- `role="log"` + `aria-live="polite"` on the message region. ✓
- Bouncing dots have `role="status"` + `motion-reduce:animate-none`. ✓
- IME-safe Enter via ai-elements. ✓
- autoFocus on the composer. ✓
- Focus visible rings on the submit button (shadcn defaults). ✓
- `aria-label="Stop"` / `"Submit"` on the unified submit button. ✓
- `aria-label` on the scroll-pill button. ✓

## What to add

1. **Keyboard shortcut: `Cmd+/` to focus composer.** Useful when scrolled deep in history.

2. **Up-arrow to edit last user message.** When composer is empty + focused, Up arrow fills the textarea with the last user message and slices subsequent. Esc cancels. (Same UX as terminal history.)

3. **Esc to abort active stream.** When the chat status is `streaming`, Esc fires `handleStop()`. Today only the Stop button does it.

4. **Live region for "Searching wiki" status.** When a tool is running, announce its `state` change as a brief status. Today only the visual badge updates.

5. **Lighthouse / axe in CI.** Add `@axe-core/playwright` to a chat-a11y spec. Catch regressions automatically.

6. **Color-contrast check on theme switch.** Mostly automated by shadcn but worth verifying citations and the disabled-message strikethrough in both modes.

## Top patterns to steal

| Pattern                                              | From         |
| ---------------------------------------------------- | ------------ |
| `role="log"` + `aria-live="polite"` on message list  | ai-elements  |
| `role="status"` for thinking/loading indicators      | shadcn       |
| `motion-reduce:` utilities on every animation        | shadcn       |
| Up-arrow to edit history                             | (terminal)   |
| Esc to abort active stream                           | (recommended)|
| sr-only text on icon-only toggles                    | shadcn       |
| axe-core in CI                                        | (recommended)|
| Cmd+/ to focus composer                              | (recommended)|
