import { describe, expect, test } from "bun:test";

// Exercise the installed, locked dependency in a fresh runtime. This catches
// removal or drift of the patch, not just the reader's separate fallback helper.
describe("LiveStore OPFS import compatibility", () => {
  for (const [name, navigatorValue, available] of [
    ["missing navigator", "undefined", false],
    ["missing storage", "{}", false],
    ["missing getDirectory", "{ storage: {} }", false],
    ["denied storage", "{ storage: { getDirectory: async () => { throw new Error('denied'); } } }", false],
    ["available storage", "{ storage: { getDirectory: async () => ({ kind: 'directory' }) } }", true],
  ] as const) {
    test(name, () => {
      const result = Bun.spawnSync([process.execPath, "--eval", `
        Object.defineProperty(globalThis, 'navigator', { value: ${navigatorValue}, configurable: true });
        process.on('unhandledRejection', () => process.exit(2));
        const { rootHandlePromise } = await import('@livestore/adapter-web/opfs-utils');
        if (!(rootHandlePromise instanceof Promise)) process.exit(3);
        // Login can import this module long before the reader awaits the probe.
        await new Promise(resolve => setTimeout(resolve, 20));
        const outcome = await rootHandlePromise.then(() => true, () => false);
        if (outcome !== ${available}) process.exit(4);
      `], { cwd: import.meta.dir });
      expect(result.exitCode).toBe(0);
    });
  }
});
