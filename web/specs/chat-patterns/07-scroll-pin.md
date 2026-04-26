# Scroll Pin / Stick-to-Bottom

The contract: stay at bottom while the assistant types, release when the user scrolls up, show a "new messages" pill, click the pill to return to bottom.

## use-stick-to-bottom

The library powers ai-elements `<Conversation>` and is the canonical implementation.

`~/src/os/vercel-ai` ships ai-elements with `<Conversation>` wrapping `<StickToBottom>`:

```tsx
<StickToBottom resize="smooth" initial="smooth" role="log">
  <StickToBottom.Content className="...">
    {messages.map(...)}
  </StickToBottom.Content>
  {/* Scroll-pill rendered conditionally when not at bottom */}
</StickToBottom>
```

The library's `useStickToBottomContext()` exposes:
- `isAtBottom: boolean` — true when the user is at the bottom (or close to it within a threshold)
- `escapedFromLock: boolean` — true after the user scrolls away from auto-pin
- `scrollToBottom(): void` — programmatic scroll
- `stopScroll(): void` — cancel the in-flight smooth scroll

The pin "escape" is **velocity-aware**: small wheel events near the bottom keep the pin; deliberate upward scroll releases it. This is the difference between a pin that fights the user and one that respects them.

## ai-elements `<ConversationScrollButton>`

```tsx
function ConversationScrollButton(props) {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  if (isAtBottom) return null;
  return (
    <Button onClick={scrollToBottom} variant="outline" size="icon"
      className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full">
      <ArrowDownIcon className="size-4" />
    </Button>
  );
}
```

UX choices:
- **Centered horizontally**, not right-aligned. Mobile thumbs reach the center more comfortably.
- **Visible only when not at bottom.** Click moves to bottom + clears the new-messages indicator.
- **Pill, not square.** Distinguishes from the composer's submit button.

## When the user IS at the bottom and a new message arrives

The library auto-pins. No code needed.

## When the user is scrolled UP and a new message arrives

The library does not auto-scroll. The pill appears (because `isAtBottom === false`).

If you want a "new messages" indicator (count of how many landed since the last pin), wrap the pill:

```tsx
function NewMessagesPill() {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  const messagesLengthRef = useRef(0);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (isAtBottom) {
      setUnread(0);
      messagesLengthRef.current = messages.length;
    } else {
      setUnread(messages.length - messagesLengthRef.current);
    }
  }, [isAtBottom, messages.length]);

  if (isAtBottom) return null;
  return <Button onClick={scrollToBottom}>{unread} new {unread === 1 ? 'message' : 'messages'}</Button>;
}
```

Recommended only if your threads are long enough that users care about the count. For our chat, the simpler arrow-down pill is sufficient.

## Mid-stream resize (window, sidebar toggle)

The library handles this via `resize="smooth"` (or `'instant'`). A `ResizeObserver` on the content fires; if the user was at bottom, it stays at bottom (without a visible jump). Otherwise the scroll position is preserved relative to the content.

## Mid-stream theme switch

Theme switches change CSS variables, which can shift line heights via font metrics. With `resize="smooth"`, this is invisible to the user. Without it, the page jumps.

## Codex's TUI scrollback

Codex doesn't use a stick-to-bottom library — the terminal does scrollback for free. The TUI just renders the latest frame at the bottom of the viewport; new content pushes old content up. The "pin" is implicit because the terminal cursor follows the cursor position.

For a web chat, the analogous pattern is **always inserting at the bottom** of a vertically-scrolling container that has its own scrollback (the parent's overflow). This is what `<StickToBottom>` does, plus the velocity-aware escape.

## Virtualization + stick-to-bottom

If you adopt `@tanstack/react-virtual`, the stick-to-bottom contract gets harder. The virtualizer needs to know the scroll element; the stick-to-bottom hook also needs to know it. They have to share.

`@tanstack/react-virtual` exposes a `scrollElement` ref. `<StickToBottom>` exposes `scrollRef` from `useStickToBottomContext()`. Use the same DOM node for both, and the virtualizer + pin contract cooperate.

For now: don't virtualize. If you do, the integration is non-trivial.

## What our chat does

`web/src/app/(main)/chat/_components/chat-interface.tsx`:
- `<Conversation>` (ai-elements) with `<ConversationContent>` + `<ConversationScrollButton>`. ✓
- `role="log"` on `<Conversation>` (set by ai-elements). ✓
- `aria-live="polite"` on `<ConversationContent>` (we override). ✓
- Pill: `<ConversationScrollButton>`, ai-elements default (centered, arrow icon). ✓

## What to add

1. **"N new messages" pill** when the thread is busy (e.g., during a multi-step agent run). The simple `ArrowDownIcon` pill is fine for casual use; if streaming runs are long, the count adds context.
2. **Scroll position memory across thread switches.** When the user navigates from `/chat/[id]` back to the same id later, restore their last scroll position (if `isAtBottom` was false). LocalStorage keyed by conversation id, capped at 50 entries.
3. **Smooth-resize during sidebar toggle.** We already have this via `resize="smooth"`. Verify the right-comments-rail toggle (when added) also fires a `ResizeObserver`-visible event.

## Top patterns to steal

| Pattern                                          | From          |
| ------------------------------------------------ | ------------- |
| use-stick-to-bottom for the pin contract         | ai-elements   |
| Velocity-aware escape (not threshold-based only) | use-stick-to-bottom |
| Centered scroll-to-bottom pill                   | ai-elements   |
| `resize="smooth"` for mid-stream sidebar toggles | use-stick-to-bottom |
| `role="log"` + `aria-live="polite"` on the list  | ai-elements   |
| Don't virtualize until measured                  | (everywhere)  |
| Restore scroll position on thread reopen         | (recommended) |
