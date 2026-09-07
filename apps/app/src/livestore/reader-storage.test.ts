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

test("a silent OPFS probe has a deadline and ignores late completion", async () => {
  let resolve!: (directory: FileSystemDirectoryHandle) => void;
  const probe = new Promise<FileSystemDirectoryHandle>((done) => { resolve = done; });
  const result = await resolveReaderStorage({ getDirectory: () => probe }, 5);
  expect(result).toBe("memory");
  resolve({} as FileSystemDirectoryHandle);
  await Promise.resolve();
  expect(result).toBe("memory");
});

test("late OPFS rejection is consumed after the timeout", async () => {
  let reject!: (error: Error) => void;
  const probe = new Promise<FileSystemDirectoryHandle>((_, fail) => { reject = fail; });
  expect(await resolveReaderStorage({ getDirectory: () => probe }, 5)).toBe("memory");
  reject(new Error("Late storage failure"));
  await new Promise((resolve) => setTimeout(resolve, 0));
});
