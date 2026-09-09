import { expect, test } from "bun:test";
import { readerPreferences } from "./reader-preferences";

test("reader preference cookies carry only bounded boolean presentation state", () => {
  const prefs = readerPreferences('wiki_reader_tree=' + encodeURIComponent(JSON.stringify({ sources: true, wiki: false, bad: "true" })) + '; wiki_user_session=synthetic');
  expect(prefs).toEqual({ expanded: { sources: true, wiki: false }, accountPending: true });
  for (const raw of ["%broken", "[]", "null", "a".repeat(3501)]) expect(readerPreferences('wiki_reader_tree=' + raw).expanded).toEqual({});
  expect(readerPreferences('authed=gate; wiki_user_session=')).toEqual({ expanded: {}, accountPending: false });
});
