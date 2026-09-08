// The initial reader accepts arbitrary published Markdown and HTML classes.
// Selector pruning dropped utility rules, heading anchors and CSS properties,
// changing the layout until the interactive stylesheet arrived. Inline the
// compiled cascade exactly; gzip compresses its repeated selectors on the wire.
export function criticalReaderCss(css: string) {
  if (/<\/style/i.test(css)) throw new Error("Unsafe critical stylesheet");
  return css;
}
