import { expect, test } from "bun:test";
import { criticalReaderCss } from "./critical-reader-css";

test("critical styles preserve the reader's cascade and responsive rules without app controls", () => {
  const css = "@layer base{p{margin:0}img{max-width:100%}}:root{--brand:blue}.dark{--brand:red}.chat{color:red}.wiki-markdown p{line-height:1.7}@media(max-width:767px){.content-shell{padding-top:48px}.chat{height:4px}}@font-face{font-family:unused}";
  expect(criticalReaderCss(css)).toBe("@layer base{p{margin:0}img{max-width:100%}}:root{--brand:blue}.dark{--brand:red}.wiki-markdown p{line-height:1.7}@media(max-width:767px){.content-shell{padding-top:48px}}");
});
