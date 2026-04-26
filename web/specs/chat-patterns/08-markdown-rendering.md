# Markdown Rendering

Streaming text is markdown. The renderer has to handle:
- Partial code fences (`` ```ts `` with no closing fence yet)
- Partial tables (one row half-typed)
- Math blocks ($$ … $$ that's still streaming)
- Wikilinks, citations, custom syntax

## Streamdown

`~/src/os/vercel-ai` (referenced from ai-elements; published as `streamdown` on npm)

```tsx
import { Streamdown } from 'streamdown';

<Streamdown
  parseIncompleteMarkdown
  remarkPlugins={[remarkGfm, remarkMath]}
  rehypePlugins={[rehypeKatex]}
  components={{ table: MdTable, thead: MdThead, ... }}
  shikiTheme={['github-light', 'github-dark']}
  mermaid
  caret="block"
>
  {markdown}
</Streamdown>
```

What it does that `react-markdown` doesn't:
1. **`parseIncompleteMarkdown`** — closes orphan fences/tables/lists at parse time so the in-flight block renders as a code block (rather than a backtick-paragraph). Critical for streaming.
2. **Block-level memoization** — splits the markdown into blocks and memoizes parses. Adding tokens to the trailing block doesn't re-parse prior blocks.
3. **Built-in security** — sanitizes HTML, restricts URL schemes (rejects `javascript:`, `data:` for non-images), escapes by default.
4. **CJK plugin** — proper word boundary detection for languages without spaces.
5. **Shiki integration** — syntax highlighting that doesn't re-tokenize on every delta.
6. **Mermaid integration** — diagrams render after the closing fence.
7. **Math via katex** — same as `rehype-katex`, integrated.
8. **Streaming caret** — optional cursor that shows where text is currently arriving.

## Block parsing — `parseMarkdownIntoBlocks`

```ts
import { parseMarkdownIntoBlocks } from 'streamdown';

const blocks = parseMarkdownIntoBlocks(content);
// ['# Heading', '\nFirst paragraph.\n', '\n```ts\nconst x = 1;\n```\n', ...]

// Render each block independently; memoize per block.
```

This is the same trick the AI SDK chatbot reference uses: split the markdown by block, render each, memoize. New tokens land in the trailing block; the rest are stable.

## Wikilinks + citations as preprocess

Our chat has two app-specific markdown extensions:

- `[[slug]]` and `[[slug|alias]]` — wikilinks resolved to local hrefs.
- `[1]`, `[2]` — citations linked to the sources block.

Both are **string transforms** that run before the markdown parser sees the content. They can stay as string transforms with Streamdown:

```ts
const resolved = resolveWikilinks(content);            // string -> string
const linked = preprocessCitationMarkdown(resolved);   // string -> string
return <Streamdown>{linked}</Streamdown>;
```

Don't try to make them Streamdown plugins. The string-transform path is correct, simple, and runs once per content change.

## Custom code blocks

`~/src/os/shadcn-ui/apps/v4/registry/new-york-v4/ui/code-block.tsx` (or ai-elements `<CodeBlock>`):

```tsx
<CodeBlock language="typescript" code={code} showLineNumbers>
  <CodeBlockHeader>
    <CodeBlockTitle>app.ts</CodeBlockTitle>
    <CodeBlockActions>
      <CodeBlockCopyButton />
      <CodeBlockLanguageSelector />
    </CodeBlockActions>
  </CodeBlockHeader>
  <CodeBlockContent />
  <CodeBlockContainer />
</CodeBlock>
```

If you want copy buttons on every code block, override Streamdown's `code` component:

```tsx
<Streamdown
  components={{
    code: ({ className, children }) => {
      const lang = className?.replace('language-', '');
      if (!lang) return <code className={className}>{children}</code>; // inline
      return <CodeBlock language={lang} code={String(children)} showLineNumbers />;
    },
  }}
>
  {content}
</Streamdown>
```

Note: code blocks don't get syntax highlighting until the closing fence arrives. During streaming, show plain text inside a `<pre>`. Streamdown handles this by detecting incomplete fences and styling them as plain pre.

## Math

Streamdown's `math` plugin uses `remark-math` + `rehype-katex` under the hood. Same as our existing setup.

Inline: `$x = 1$`. Block: `$$\int_0^\infty e^{-x^2} dx = \frac{\sqrt{\pi}}{2}$$`.

During streaming, partial math (`$$\int_0^\infty…`) renders as plain text (no katex error spew). When the closing `$$` arrives, it re-parses as math.

## XSS hardening

Both `react-markdown` and Streamdown require explicit opt-in for raw HTML (`rehype-raw`). Without it, `<script>` tags are escaped. Both honor the URL transform — bad URL schemes get stripped.

If you accept HTML at all, also include `rehype-sanitize` with the GitHub-flavored schema. Streamdown bakes this in by default; react-markdown does not.

## TUI lessons

`~/src/os/codex/codex-rs/tui/src/history_cell.rs`

The TUI shows what is essentially a markdown-on-text rendering. Two important lessons:

1. **Buffer accumulation, parse on transition.** The TUI accumulates text deltas in a buffer string. It only re-parses (for ANSI styling, link highlighting, etc.) when the cell transitions from active to committed, or when explicitly asked. The web equivalent is to parse on every render but cache the parse result (block memoization).

2. **Render committed cells from cache.** When the active cell finalizes, its parsed output is cached. Subsequent re-renders of the transcript read from cache. The web equivalent is `<MemoizedBlock>` per-block memoization.

## What our chat does

`web/src/components/markdown-renderer-client.tsx`:
- `react-markdown` with `remark-gfm`, `remark-math`, `remark-cleanmath`, `rehype-raw`, `rehype-katex`.
- `<MdTable>` etc. component overrides for tables.
- `resolveWikilinks` + `preprocessCitationMarkdown` as string preprocess.
- `MarkdownHeadingAnchors` for in-page anchors.

`web/src/components/chat/streaming-markdown.tsx`:
- `Streamdown` with the same plugins, behind `NEXT_PUBLIC_CHAT_STREAMDOWN=1` (currently off).

The MessageMarkdown component in `messages.tsx` routes through `<StreamingMarkdown>` which falls through to `react-markdown` when the flag is off.

## What to add

1. **Flip the Streamdown flag on by default** after a markdown-gallery snapshot run confirms parity. The flag exists to de-risk the migration; we should stop running parallel paths.

2. **Custom `<CodeBlock>` with copy button** in Streamdown's `components.code`. Today we have shiki via Streamdown but no copy affordance.

3. **Streaming caret** (`caret="block"` on Streamdown). Tiny visual upgrade — shows the user where text is landing. Disable under `prefers-reduced-motion`.

4. **Mermaid diagrams.** Optional; useful if any of the wiki content includes mermaid. Streamdown supports it natively.

5. **Sanitize-by-default for the streaming path.** Today our `react-markdown` setup uses `rehype-raw` which allows raw HTML. Streamdown sanitizes by default. After flipping, audit any wiki page that legitimately uses HTML.

## Top patterns to steal

| Pattern                                              | From         |
| ---------------------------------------------------- | ------------ |
| `parseIncompleteMarkdown` for streaming              | streamdown   |
| Block-level memoization                              | streamdown   |
| URL transform / sanitize-by-default                  | streamdown   |
| Buffer accumulation, parse on transition             | codex TUI    |
| `<CodeBlock>` with copy + language label             | ai-elements  |
| Streaming caret indicator                            | streamdown   |
| String-transform preprocessors before the parser     | (recommended)|
| Cache parsed blocks by content hash                  | (recommended)|
