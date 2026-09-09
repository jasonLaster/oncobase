// Explicit directories prevent Bun's substring filter "server" from collecting
// e2e/visual-observer.spec.ts. The Node in-memory SQLite adapter shares one
// fixed-size WASM heap per process; run its two store suites in separate heaps,
// as independent browser workers do. Keep every test and propagate all failures.
const directories = ["src", "server", "scripts", "convex/lib"];
const files: string[] = [];
for (const directory of directories) {
  for await (const path of new Bun.Glob("**/*.test.{ts,tsx}").scan(directory)) {
    files.push(`./${directory}/${path}`);
  }
}
const storeSuites = ["./src/bootstrap/seed-page.test.ts", "./src/livestore/schema.test.ts"];
const groups = [files.filter(file => !storeSuites.includes(file)).sort(), ...storeSuites.map(file => [file])];
let failed = false;
for (const group of groups) {
  const child = Bun.spawn([process.execPath, "test", ...group], { stdout: "inherit", stderr: "inherit" });
  if (await child.exited !== 0) failed = true;
}
process.exit(failed ? 1 : 0);

export {};
