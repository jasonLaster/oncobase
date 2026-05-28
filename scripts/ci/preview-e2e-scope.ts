type GitHubFile = {
  filename: string;
};

type GitHubPull = {
  number: number;
};

type GitHubCommit = {
  parents?: Array<{ sha: string }>;
};

type GitHubCompare = {
  files?: GitHubFile[];
};

const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const eventPath = process.env.GITHUB_EVENT_PATH;
const outputPath = process.env.GITHUB_OUTPUT;

const SKIPPABLE_EXACT_PATHS = new Set([
  ".gitignore",
  ".github/workflows/post-deploy.yml",
  ".github/workflows/pr-checks.yml",
  "bun.lock",
  "scripts/ci/preview-e2e-scope.ts",
  "web/docs/architecture/04-publishing.md",
  "web/package.json",
  "web/e2e/header-shell.spec.ts",
  "web/scripts/admin/add-publish-token.ts",
  "web/scripts/admin/backfill-content-hashes.ts",
  "web/scripts/admin/changed-slugs.test.ts",
  "web/scripts/admin/changed-slugs.ts",
  "web/scripts/publish/bootstrap.ts",
  "web/scripts/publish/build-vault-starter.ts",
  "web/src/app/(main)/admin/access/access-data.ts",
  "web/src/lib/chat-page-reader.test.ts",
  "web/src/lib/chat-page-reader.ts",
  "web/src/lib/page-metadata.ts",
  "web/src/lib/render-markdown.ts",
  "web/src/lib/wikilinks.test.ts",
  "web/src/lib/wikilinks.ts",
  "web/tsconfig.json",
]);

const SKIPPABLE_PREFIXES = ["obsidian/", "packages/oncobase/"];

function assertEnv(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

async function github<T>(path: string): Promise<T> {
  const authToken = assertEnv(token, "GITHUB_TOKEN");
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${authToken}`,
      "x-github-api-version": "2022-11-28",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API ${path} failed: ${response.status} ${await response.text()}`);
  }

  return (await response.json()) as T;
}

async function githubPaginated<T>(path: string): Promise<T[]> {
  const results: T[] = [];
  let page = 1;

  while (true) {
    const separator = path.includes("?") ? "&" : "?";
    const batch = await github<T[]>(`${path}${separator}per_page=100&page=${page}`);
    results.push(...batch);
    if (batch.length < 100) return results;
    page += 1;
  }
}

function changedFileNames(files: GitHubFile[]): string[] {
  return files.map((file) => file.filename).filter(Boolean);
}

async function filesForPull(owner: string, repo: string, pullNumber: number): Promise<string[]> {
  const files = await githubPaginated<GitHubFile>(
    `/repos/${owner}/${repo}/pulls/${pullNumber}/files`
  );
  return changedFileNames(files);
}

async function filesForDeployment(owner: string, repo: string, sha: string): Promise<string[]> {
  const pulls = await github<GitHubPull[]>(
    `/repos/${owner}/${repo}/commits/${sha}/pulls`
  );

  if (pulls.length > 0) {
    return filesForPull(owner, repo, pulls[0].number);
  }

  const commit = await github<GitHubCommit>(`/repos/${owner}/${repo}/commits/${sha}`);
  const parent = commit.parents?.[0]?.sha;
  if (!parent) {
    console.log("Commit has no parent; running preview E2E.");
    return [];
  }

  const comparison = await github<GitHubCompare>(
    `/repos/${owner}/${repo}/compare/${parent}...${sha}`
  );
  return changedFileNames(comparison.files ?? []);
}

function isSkippablePath(path: string): boolean {
  return (
    SKIPPABLE_EXACT_PATHS.has(path) ||
    SKIPPABLE_PREFIXES.some((prefix) => path.startsWith(prefix))
  );
}

function shouldRunPreviewE2e(paths: string[]): boolean {
  return paths.length === 0 || !paths.every(isSkippablePath);
}

async function main() {
  const repoSlug = assertEnv(repository, "GITHUB_REPOSITORY");
  const [owner, repo] = repoSlug.split("/");
  if (!owner || !repo) {
    throw new Error(`Invalid GITHUB_REPOSITORY: ${repoSlug}`);
  }

  const event = JSON.parse(await Bun.file(assertEnv(eventPath, "GITHUB_EVENT_PATH")).text());
  let paths: string[];

  if (event.pull_request?.number) {
    paths = await filesForPull(owner, repo, event.pull_request.number);
  } else if (event.deployment?.sha) {
    paths = await filesForDeployment(owner, repo, event.deployment.sha);
  } else {
    console.log("No pull request or deployment context; running preview E2E.");
    paths = [];
  }

  const shouldRun = shouldRunPreviewE2e(paths);
  console.log(`Changed files: ${paths.join(", ") || "(none)"}`);
  console.log(
    shouldRun
      ? "Running preview E2E."
      : "Skipping preview E2E for unit-covered publisher/library changes."
  );

  if (outputPath) {
    appendFileSync(outputPath, `should_run=${shouldRun ? "true" : "false"}\n`);
  } else {
    console.log(`should_run=${shouldRun ? "true" : "false"}`);
  }
}

await main();
import { appendFileSync } from "node:fs";
