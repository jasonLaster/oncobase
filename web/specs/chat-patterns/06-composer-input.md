# Composer / Input

The textarea + submit + status. Often the most-touched part of the UI.

## ai-elements `<PromptInput>` — the canonical compound

`~/src/os/vercel-ai/` (via npx ai-elements add) and the registry source for `prompt-input.tsx` ships with:

```tsx
<PromptInput onSubmit={handlePromptSubmit}>
  <PromptInputBody>
    <PromptInputTextarea autoFocus value={input} onChange={...} placeholder="..." />
  </PromptInputBody>
  <PromptInputFooter>
    <span className="flex-1" />
    <PromptInputSubmit status={chatStatus} disabled={!input.trim()} onStop={handleStop} />
  </PromptInputFooter>
</PromptInput>
```

Slots:
- `<PromptInput>` — `<form>` wrapper. Owns submit handling, file/attachment provider context, max-files / max-size validation, drop-zone (when `globalDrop`).
- `<PromptInputBody>` — flex container around the textarea. `display: contents` so it doesn't add a wrapper to layout.
- `<PromptInputTextarea>` — `<InputGroupTextarea>` with built-in IME-safe Enter handling. Calls `form.requestSubmit()` on Enter, ignores Shift+Enter, ignores Enter while composing (`e.nativeEvent.isComposing` or `e.keyCode === 229`).
- `<PromptInputFooter>` — flex row for buttons.
- `<PromptInputSubmit status, onStop, disabled>` — the unified Submit/Stop button. Renders an arrow icon when `status === 'ready'`, a square (stop) when `status === 'streaming'`, an X when `status === 'error'`. `aria-label="Submit"` or `aria-label="Stop"`.

Optional slots from the same component:
- `<PromptInputHeader>` — for chips above the textarea (attachments, referenced sources).
- `<PromptInputTools>` — left-cluster of action buttons (attach, voice, model picker).
- `<PromptInputActionAddAttachments>` / `<PromptInputActionAddScreenshot>` — preset DropdownMenuItems for file actions.

## IME-safe Enter — the actual implementation

`~/src/os/vercel-ai/packages/ai-elements/src/prompt-input.tsx:967–1012` (or the file you copied to `src/components/ai-elements/prompt-input.tsx`)

```ts
const handleKeyDown: KeyboardEventHandler = useCallback((e) => {
  onKeyDown?.(e);
  if (e.defaultPrevented) return;

  if (e.key === 'Enter') {
    if (isComposing || e.nativeEvent.isComposing) return;
    if (e.shiftKey) return;                           // Shift+Enter = newline
    e.preventDefault();
    const submitButton = e.currentTarget.form?.querySelector('button[type="submit"]');
    if (submitButton?.disabled) return;
    e.currentTarget.form?.requestSubmit();
  }

  if (e.key === 'Backspace' && e.currentTarget.value === '' && attachments.files.length > 0) {
    // Empty + Backspace removes the last attachment chip
    e.preventDefault();
    attachments.remove(attachments.files.at(-1).id);
  }
}, [...]);

const handleCompositionEnd = useCallback(() => setIsComposing(false), []);
const handleCompositionStart = useCallback(() => setIsComposing(true), []);
```

Two layers of IME guard:
1. React `compositionstart` / `compositionend` events update `isComposing` state.
2. Native `e.nativeEvent.isComposing` as a fallback (some browsers don't fire React's events reliably during fast typing).
3. `e.keyCode === 229` is the legacy fallback for browsers that fire `keydown` with keyCode 229 during composition (Chrome on Linux historically).

Always check all three.

## Auto-resize textarea

shadcn's `<Textarea>` uses Tailwind v4's `field-sizing-content`:

```css
.field-sizing-content { field-sizing: content; }
```

Native CSS that resizes to fit content, capped by `min-h` / `max-h`. No JS needed. Browser support: Chrome 123+, Firefox 127+, Safari TP. **Falls back gracefully**: without support, the textarea is fixed-height at the `rows` attribute.

For older browsers, the manual approach (e.g., our existing `<GrowingTextarea>`) measures `scrollHeight` on each input event and sets `style.height`. Works but causes layout reads on every keystroke.

Recommendation: use `field-sizing-content` (it's what ai-elements ships) and let old browsers see the fallback row count. Removes a layout-thrash hot spot.

## File attachments

ai-elements PromptInput ships file-attachment infrastructure:

```ts
type AttachmentsContext = {
  files: (FileUIPart & { id: string })[];
  add: (files: File[] | FileList) => void;
  remove: (id: string) => void;
  clear: () => void;
  openFileDialog: () => void;
};
```

The provider tracks files. Drag/drop, paste, file-input click, and screenshot capture all funnel through `add()`. The submit handler converts `blob:` URLs to `data:` URLs before send (so the server doesn't get URLs that only work in the browser session).

The wire format: `FileUIPart` is `{ type: 'file', mediaType, url | data, filename }`. AI SDK accepts these directly in `convertToModelMessages`.

If we don't accept attachments today, leaving the file infra dormant is fine — `<PromptInput>` works without ever opening the file dialog.

## Slash commands / cmdk

shadcn `<Command>` from `~/src/os/shadcn-ui/apps/v4/registry/new-york-v4/ui/command.tsx`:

```tsx
<CommandDialog open={open} onOpenChange={setOpen}>
  <CommandInput placeholder="Type a command…" />
  <CommandList>
    <CommandEmpty>No results.</CommandEmpty>
    <CommandGroup heading="Suggestions">
      <CommandItem onSelect={() => insertSlashCommand('/summarize')}>/summarize</CommandItem>
      <CommandItem onSelect={() => insertSlashCommand('/export')}>/export</CommandItem>
    </CommandGroup>
  </CommandList>
</CommandDialog>
```

For agent chats, slash commands are useful for canned actions:
- `/summarize` — emit a "summarize this conversation" user message
- `/export` — download conversation as markdown
- `/fork` — branch the conversation at the current message
- `/clear` — start fresh (with confirmation)

Trigger via `Cmd+K` or by typing `/` at the start of an empty composer. ai-elements has `<PromptInputCommand>` etc. but the simpler path is a separate `<CommandDialog>` keyed off `Cmd+K`.

## Voice input — when to bother

ai-elements has `<PromptInputActionAddScreenshot>` and an attach-from-microphone helper (`captureScreenshot()`). For voice, the canonical pattern is:

```tsx
<PromptInputButton onClick={startRecording} icon={<MicIcon />} tooltip="Voice (Cmd+;)" />
```

Server-side: a separate `/api/transcribe` route that accepts audio and returns text. AI SDK's `transcribe()` from `ai` wraps the OpenAI/Whisper APIs.

For agent research apps (our use case), voice is low-priority. Defer.

## Status states

`useChat({ ... }).status` is one of `'ready' | 'submitted' | 'streaming' | 'error'`.

UX rules:
- `submitted` — pre-first-token; show a placeholder ("Thinking…" or animated dots) at the position where the assistant message will land.
- `streaming` — first token has arrived; the streaming-tail message is rendering.
- `error` — show the error inline with a retry affordance; clear error when the user types again.
- `ready` — the composer is interactive again.

Disable the textarea? Don't — the user might want to type the next question while the model finishes. Just disable Submit (the Submit button reads as Stop during streaming, and clicking it aborts).

## What our chat does

`web/src/app/(main)/chat/_components/chat-interface.tsx`:
- `<PromptInput>` + `<PromptInputBody>` + `<PromptInputTextarea>` + `<PromptInputFooter>` + `<PromptInputSubmit status, onStop>`. ✓
- IME-safe Enter (in `<PromptInputTextarea>`). ✓
- File attachments: dormant infra (we don't accept files yet). ✓
- No slash commands.
- No voice.
- Status drives the submit button. ✓

## What to add

1. **Slash commands.** A small `<CommandDialog>` keyed to `Cmd+K` and to typing `/` in an empty composer. Initial commands: `/clear`, `/export`, `/fork`, plus a way to insert any of the suggested questions.
2. **Switch to `field-sizing-content`** in the textarea — drop the JS-based growing logic in `<GrowingTextarea>`. We already use `<PromptInputTextarea>` which uses `field-sizing-content`; the legacy file is unused.
3. **Better submitted-state indicator.** Today we show animated dots only when `lastMessage?.role === 'user'`. Once a step-start arrives, switch to a "Thinking" or "Searching wiki" status pulled from `data-status` parts the server emits.
4. **Persist composer drafts to sessionStorage** keyed by conversation id. If the user navigates away and back without sending, the in-progress text is still there.

## Top patterns to steal

| Pattern                                                  | From         |
| -------------------------------------------------------- | ------------ |
| `<PromptInput>` compound API with header/body/footer     | ai-elements  |
| 3-layer IME guard (state + nativeEvent + keyCode)        | ai-elements  |
| `field-sizing-content` for autosize                      | shadcn       |
| `<CommandDialog>` for slash commands                     | shadcn       |
| File attachments via context provider                    | ai-elements  |
| Backspace-to-remove-last-chip on empty textarea          | ai-elements  |
| Submit/Stop unified button driven by `status`            | ai-elements  |
| Don't disable the textarea while streaming               | (recommended)|
| Persist composer drafts to sessionStorage                | (recommended)|
