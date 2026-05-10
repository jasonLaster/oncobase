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

  const gatedResponse = await fetch(`${origin}/wiki/logistics/insurance`, {
    redirect: "manual",
  });
  if (gatedResponse.status !== 302) {
    throw new Error(`Standalone route gate smoke failed: ${gatedResponse.status}`);
  }
  const gatedLocation = gatedResponse.headers.get("location") ?? "";
  if (!gatedLocation.includes("/login") || !gatedLocation.includes("redirect=%2Fwiki%2Flogistics%2Finsurance")) {
    throw new Error(`Standalone route gate redirected to unexpected location: ${gatedLocation}`);
  }

  const sessionResponse = await fetch(`${origin}/api/wiki/session`);
  if (!sessionResponse.ok) {
    throw new Error(`Standalone session smoke failed: ${sessionResponse.status}`);
  }

  const searchResponse = await fetch(`${origin}/api/search?q=diagnosis&limit=3`);
  if (!searchResponse.ok) {
    throw new Error(`Standalone search smoke failed: ${searchResponse.status}`);
  }

  const searchBody = await searchResponse.json();
  if (!Array.isArray(searchBody.results) || searchBody.results.length === 0) {
    throw new Error("Standalone search smoke returned no results");
  }

  const toolResponse = await fetch(`${origin}/api/tools`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool: "search_wiki", args: { query: "diagnosis" } }),
  });
  if (!toolResponse.ok) {
    throw new Error(`Standalone tools smoke failed: ${toolResponse.status}`);
  }

  const toolBody = await toolResponse.json();
  if (!Array.isArray(toolBody) || toolBody.length === 0) {
    throw new Error("Standalone tools smoke returned no search results");
  }

  const chatMethodResponse = await fetch(`${origin}/api/chat`);
  if (chatMethodResponse.status !== 405 || chatMethodResponse.headers.get("allow") !== "POST") {
    throw new Error(`Standalone chat method smoke failed: ${chatMethodResponse.status}`);
  }

  const loginResponse = await fetch(`${origin}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "diana" }),
  });
  if (!loginResponse.ok || !loginResponse.headers.get("set-cookie")?.includes("authed=true")) {
    throw new Error(`Standalone login smoke failed: ${loginResponse.status}`);
  }
  const authCookie = loginResponse.headers.get("set-cookie")?.split(";")[0] ?? "";

  const htmlResponse = await fetch(`${origin}/wiki/logistics/insurance`, {
    headers: { Cookie: authCookie },
  });
  if (!htmlResponse.ok) {
    throw new Error(`Standalone authed HTML smoke failed: ${htmlResponse.status}`);
  }

  const fileErrorResponse = await fetch(`${origin}/api/file`);
  if (fileErrorResponse.status !== 400) {
    throw new Error(`Standalone file validation smoke failed: ${fileErrorResponse.status}`);
  }

  await runCommand(["bun", "run", "test:e2e:preview"], {
    PLAYWRIGHT_BASE_URL: origin,
    WIKI_VITE_SMOKE_PATH: "/wiki/logistics/insurance",
    WIKI_VITE_SMOKE_COOKIE: authCookie,
  });
} finally {
  server.kill();
  await server.exited.catch(() => undefined);
}
