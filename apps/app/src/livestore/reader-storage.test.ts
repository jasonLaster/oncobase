import { describe, expect, test } from "bun:test";
import { resolveReaderStorage } from "./reader-storage";

describe("reader storage selection", () => {
  test("uses persistent storage only when it can be opened", async () => {
    expect(await resolveReaderStorage({
      getDirectory: async () => ({}) as FileSystemDirectoryHandle,
    })).toBe("opfs");
  });

  test("falls back when storage is missing or access is denied", async () => {
    expect(await resolveReaderStorage(undefined)).toBe("memory");
    expect(await resolveReaderStorage({
      getDirectory: async () => { throw new DOMException("Storage denied", "UnknownError"); },
    })).toBe("memory");
  });
});
