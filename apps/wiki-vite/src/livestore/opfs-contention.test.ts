import { expect, test } from "bun:test";
// Exercise the installed dependency patch, not a separate copy of the policy.
import { openAccessHandle } from "../../../../node_modules/@livestore/sqlite-wasm/dist/browser/opfs/AccessHandlePoolVFS.js";

test("OPFS acquisition has no delay when the file is available", async () => {
  const handle = {};
  let waits = 0;
  expect(await openAccessHandle({ createSyncAccessHandle: async () => handle }, async () => { waits++; })).toBe(handle);
  expect(waits).toBe(0);
});

test("OPFS acquisition waits for exclusive access after worker teardown", async () => {
  let attempts = 0;
  let waits = 0;
  const handle = {};
  expect(await openAccessHandle({ createSyncAccessHandle: async () => {
    if (++attempts < 3) throw new DOMException("Locked", "NoModificationAllowedError");
    return handle;
  } }, async () => { waits++; })).toBe(handle);
  expect(waits).toBe(2);
});

test("permanent OPFS contention is bounded and preserves the original error", async () => {
  const error = new DOMException("Locked", "NoModificationAllowedError");
  let waits = 0;
  await expect(openAccessHandle({ createSyncAccessHandle: async () => { throw error; } }, async () => { waits++; })).rejects.toBe(error);
  expect(waits).toBe(40);
});

test("permission and other storage errors are not retried", async () => {
  for (const error of [new DOMException("Denied", "NotAllowedError"), new Error("Disk failure")]) {
    let waits = 0;
    await expect(openAccessHandle({ createSyncAccessHandle: async () => { throw error; } }, async () => { waits++; })).rejects.toBe(error);
    expect(waits).toBe(0);
  }
});
