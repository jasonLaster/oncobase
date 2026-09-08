import { expect, test } from "bun:test";
import { criticalReaderCss } from "./critical-reader-css";

test("initial styles retain the complete cascade, utilities and property dependencies", () => {
  const css = "@layer base,utilities;@property --tw-shadow{syntax:'*';inherits:false;initial-value:0 0 #0000}@layer utilities{.flex{display:flex}.rounded{border-radius:4px}}.wiki-heading-group{position:relative}.heading-anchor{opacity:0}.wiki-markdown p{line-height:1.7}@media(max-width:767px){.content-shell{padding-top:48px}}";
  expect(criticalReaderCss(css)).toBe(css);
  expect(() => criticalReaderCss("</style><script>bad()</script>")).toThrow();
});
