const appDir = new URL("..", import.meta.url).pathname;
const port = Number(process.env.PORT ?? 62006);
const origin = `http://127.0.0.1:${port}`;

async function runCommand(command: string[], env: Record<string, string | undefined> = {}) {
  const proc = Bun.spawn(command, {
    cwd: appDir,
    env: { ...process.env, ...env },
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`${command.join(" ")} failed with exit ${exitCode}`);
  }
}

async function waitForServer() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/api/wiki/session`);
      if (response.ok) return;
    } catch {
      // Keep polling until the standalone server is ready.
    }
    await Bun.sleep(250);
  }
  throw new Error(`Timed out waiting for ${origin}`);
}

await runCommand(["bun", "run", "build"]);

const server = Bun.spawn(["bun", "server/standalone.ts"], {
  cwd: appDir,
  env: { ...process.env, PORT: String(port) },
  stdout: "inherit",
  stderr: "inherit",
});

try {
  await waitForServer();

  const htmlResponse = await fetch(`${origin}/wiki/logistics/insurance`);
  if (!htmlResponse.ok) {
    throw new Error(`Standalone HTML smoke failed: ${htmlResponse.status}`);
  }

  const sessionResponse = await fetch(`${origin}/api/wiki/session`);
  if (!sessionResponse.ok) {
    throw new Error(`Standalone session smoke failed: ${sessionResponse.status}`);
  }

  await runCommand(["bun", "run", "test:e2e:preview"], {
    PLAYWRIGHT_BASE_URL: origin,
    WIKI_VITE_SMOKE_PATH: "/wiki/logistics/insurance",
  });
} finally {
  server.kill();
  await server.exited.catch(() => undefined);
}
