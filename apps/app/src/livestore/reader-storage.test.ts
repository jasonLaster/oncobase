import { describe, expect, test } from "bun:test";
import { networkAwareBootDeadline, isDiagnosticMemoryStorageRequest, resolveReaderStorage, readerBootDeadline,
  READER_LEADER_BOOT_TIMEOUT_MS, READER_FOLLOWER_BOOT_TIMEOUT_MS } from "./reader-storage";

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

test("memory comparison is opt-in for one diagnostics document", () => {
  expect(isDiagnosticMemoryStorageRequest(new URL("https://example.com/?paintDebug=1&readerStorage=memory"))).toBe(true);
  for (const query of ["", "?readerStorage=memory", "?paintDebug=1", "?paintDebug=1&readerStorage=opfs"]) {
    expect(isDiagnosticMemoryStorageRequest(new URL("https://example.com/" + query))).toBe(false);
  }
});

test("only an already held lock in the exact store partition shortens follower recovery", async () => {
  const query = async () => ({ held: [{ name: "livestore-tab-lock-private-user-a" }], pending: [{ name: "livestore-tab-lock-private-user-b" }] });
  expect(await readerBootDeadline({ query }, "private-user-a")).toBe(READER_FOLLOWER_BOOT_TIMEOUT_MS);
  expect(await readerBootDeadline({ query }, "private-user-b")).toBe(READER_LEADER_BOOT_TIMEOUT_MS);
  expect(await readerBootDeadline({ query }, "public")).toBe(READER_LEADER_BOOT_TIMEOUT_MS);
});

test("missing, rejected, and stalled lock probes retain the normal leader deadline", async () => {
  expect(await readerBootDeadline(undefined, "public")).toBe(READER_LEADER_BOOT_TIMEOUT_MS);
  expect(await readerBootDeadline({ query: async () => { throw new Error("denied"); } }, "public")).toBe(READER_LEADER_BOOT_TIMEOUT_MS);
  let reject!: (error: Error) => void;
  const pending = new Promise<LockManagerSnapshot>((_, fail) => { reject = fail; });
  expect(await readerBootDeadline({ query: () => pending }, "public", 5)).toBe(READER_LEADER_BOOT_TIMEOUT_MS);
  reject(new Error("late failure"));
  await new Promise(resolve => setTimeout(resolve, 0));
});


test("cold downloads get a bounded runtime budget without extending cached or unrelated boots", () => {
  const resource = { name: "https://reader.test/assets/vendor.js", duration: 16_000, encodedBodySize: 120_000, transferSize: 120_300 };
  expect(networkAwareBootDeadline(3000, [resource], "https://reader.test")).toBe(64_000);
  expect(networkAwareBootDeadline(15_000, [resource], "https://reader.test")).toBe(64_000);
  expect(networkAwareBootDeadline(750, [{ ...resource, transferSize: 0 }], "https://reader.test")).toBe(750);
  expect(networkAwareBootDeadline(3000, [{ ...resource, duration: 200 }], "https://reader.test")).toBe(3000);
  expect(networkAwareBootDeadline(3000, [{ ...resource, duration: 100_000 }], "https://reader.test")).toBe(90_000);
  expect(networkAwareBootDeadline(3000, [{ ...resource, name: "https://other.test/large.js" }], "https://reader.test")).toBe(3000);
  expect(networkAwareBootDeadline(3000, [{ ...resource, name: "https://reader.test/large.pdf" }], "https://reader.test")).toBe(3000);
});
