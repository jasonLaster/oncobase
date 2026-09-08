import { expect, test } from "bun:test";
import { renderStaticReader } from "./build-static-reader";
import type { ReaderSnapshot } from "../server/reader-cache-context";
test("static snapshots retain source-bound HTML, redaction, bootstrap validation and noindex", () => {
  const snapshot:ReaderSnapshot={siteSlug:"diana",contentRevision:"site:1",gate:{enabled:true,passwordHash:"fixture"},piiPatterns:[],
    page:{slug:"index",title:"Home",content:'A readable page.\n\n<script>alert(1)</script>\n\nContact <redact label="the contact">person@example.com</redact>.',contentHash:"source",bodyDigest:"digest",description:undefined,tags:[],sensitive:false}};
  const template='<html><head><title>Test</title></head><body><div id="root"></div></body></html>';
  const html=renderStaticReader(snapshot,new URL("https://diana.test/"),template,":root{--brand:blue}")!;
  expect(html).toContain('id="wiki-html-first"');expect(html).toContain('data-hash="source"');
  expect(html).toContain('name="robots" content="noindex, nofollow"');
  expect(html).toContain('"origin":"https://diana.test"');
  expect(html).not.toContain("person@example.com"); expect(html).not.toContain("<script>alert(1)</script>");
  expect(renderStaticReader({...snapshot,page:null},new URL("https://diana.test/"),template,"")).toBeNull();
});
