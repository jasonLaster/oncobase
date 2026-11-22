import crypto from "node:crypto";
import { compileOncobaseIgnore, isExcludedVaultPath } from "@oncobase/wiki-content/markdown-document";

export type RepoFile = {
  filePath: string;
  raw: string;
  sha: string;
};

export type RepoCommitResult = {
  commitSha: string;
  commitUrl?: string;
};

export type RepoAuthor = {
  name: string;
  email: string;
};

export class RepoConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepoConflictError";
  }
}

export type RepoFileCommitInput = {
  filePath: string;
  content: string;
  operation: "edit" | "create";
  baseSha?: string;
};

export interface VaultRepoAdapter {
  readonly branch: string;
  readonly repoLabel: string;
  resolveFile(slug: string, ref?: string): Promise<RepoFile | null>;
  readIgnoreRules(ref?: string): Promise<string | null>;
  commitFile(args: {
    filePath: string;
    content: string;
    baseSha: string;
    message: string;
    author: RepoAuthor;
  }): Promise<RepoCommitResult>;
  commitFiles(args: {
    files: RepoFileCommitInput[];
    message: string;
    author: RepoAuthor;
  }): Promise<RepoCommitResult>;
  findCommitByProposalId(proposalId: string): Promise<RepoCommitResult | null>;
}

export type GitHubRepoAuth =
  | {
      kind: "app";
      appId: string;
      privateKeyPem: string;
      installationId: string;
    }
  | {
      kind: "token";
      token: string;
    };

export type GitHubAppConfig = {
  siteSlug: string;
  auth: GitHubRepoAuth;
  owner: string;
  repo: string;
  branch: string;
  vaultRoot: string;
};

function normalizeVaultRoot(root: string | undefined): string {
  return (root ?? "").trim().replace(/^\/+|\/+$/g, "");
}

function joinRepoPath(vaultRoot: string, relativePath: string): string {
  const clean = relativePath.replace(/^\/+/, "");
  return vaultRoot ? `${vaultRoot}/${clean}` : clean;
}

export function normalizePem(raw: string): string {
  let value = raw.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }
  if (!value.includes("-----BEGIN")) {
    try {
      const decoded = Buffer.from(value, "base64").toString("utf8").trim();
      if (decoded.includes("-----BEGIN")) value = decoded;
    } catch {
      // keep original value
    }
  }
  value = value.includes("\\n") ? value.replace(/\\n/g, "\n") : value;
  const match = value.match(
    /^(-----BEGIN [A-Z0-9 ]+-----)([\s\S]+?)(-----END [A-Z0-9 ]+-----)$/,
  );
  if (!match) return value;
  const [, header, body, footer] = match;
  const compact = body.replace(/\s+/g, "");
  const wrapped = compact.match(/.{1,64}/g)?.join("\n") ?? compact;
  return `${header}\n${wrapped}\n${footer}\n`;
}

export function readGitHubAppConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): GitHubAppConfig | null {
  const repoFull = env.WIKI_EDIT_GITHUB_REPO?.trim();
  if (!repoFull) return null;
  const parts = repoFull.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

  const appId = env.WIKI_EDIT_GITHUB_APP_ID?.trim();
  const privateKey = env.WIKI_EDIT_GITHUB_PRIVATE_KEY?.trim();
  const installationId = env.WIKI_EDIT_GITHUB_INSTALLATION_ID?.trim();
  const token = env.WIKI_EDIT_GITHUB_TOKEN?.trim();

  let auth: GitHubRepoAuth | null = null;
  if (appId && privateKey && installationId) {
    auth = {
      kind: "app",
      appId,
      privateKeyPem: normalizePem(privateKey),
      installationId,
    };
  } else if (token) {
    auth = { kind: "token", token };
  }
  if (!auth) return null;

  return {
    siteSlug: env.WIKI_EDIT_SITE_SLUG?.trim() || "diana",
    auth,
    owner: parts[0],
    repo: parts[1],
    branch: env.WIKI_EDIT_GITHUB_BRANCH?.trim() || "main",
    vaultRoot: normalizeVaultRoot(env.WIKI_EDIT_GITHUB_VAULT_ROOT),
  };
}

function base64Url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

function createGitHubAppJwt(appId: string, privateKeyPem: string, nowSec = Math.floor(Date.now() / 1000)): string {
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({
      iat: nowSec - 60,
      exp: nowSec + 9 * 60,
      iss: appId,
    }),
  );
  const signingInput = `${header}.${payload}`;
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(signingInput)
    .sign(privateKeyPem)
    .toString("base64url");
  return `${signingInput}.${signature}`;
}

function encodeRepoPath(repoPath: string): string {
  return repoPath.split("/").map(encodeURIComponent).join("/");
}

export class GitHubAppRepoAdapter implements VaultRepoAdapter {
  readonly branch: string;
  readonly repoLabel: string;
  private cachedToken: { token: string; expiresAtMs: number } | null = null;

  constructor(
    private readonly config: GitHubAppConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.branch = config.branch;
    this.repoLabel = `${config.owner}/${config.repo}`;
  }

  private async installationToken(): Promise<string> {
    if (this.config.auth.kind === "token") {
      return this.config.auth.token;
    }
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAtMs - now > 5 * 60 * 1000) {
      return this.cachedToken.token;
    }
    const jwt = createGitHubAppJwt(this.config.auth.appId, this.config.auth.privateKeyPem);
    const response = await this.fetchImpl(
      `https://api.github.com/app/installations/${encodeURIComponent(this.config.auth.installationId)}/access_tokens`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${jwt}`,
          "User-Agent": "oncobase-wiki-editor",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) {
      throw new Error(`GitHub App token exchange failed (${response.status})`);
    }
    const payload = (await response.json()) as { token?: string; expires_at?: string };
    if (!payload.token) throw new Error("GitHub App token exchange returned no token");
    const expiresAtMs = payload.expires_at ? Date.parse(payload.expires_at) : now + 50 * 60 * 1000;
    this.cachedToken = { token: payload.token, expiresAtMs };
    return payload.token;
  }

  private async githubHeaders(): Promise<Record<string, string>> {
    return {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${await this.installationToken()}`,
      "User-Agent": "oncobase-wiki-editor",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  private async readContentFile(relativePath: string, ref = this.branch): Promise<RepoFile | null> {
    const repoPath = joinRepoPath(this.config.vaultRoot, relativePath);
    const url = `https://api.github.com/repos/${encodeURIComponent(this.config.owner)}/${encodeURIComponent(this.config.repo)}/contents/${encodeRepoPath(repoPath)}?ref=${encodeURIComponent(ref)}`;
    const response = await this.fetchImpl(url, {
      headers: await this.githubHeaders(),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`GitHub file read failed (${response.status}) for ${relativePath}`);
    }
    const data = (await response.json()) as {
      type?: string;
      content?: string;
      encoding?: string;
      sha?: string;
    };
    if (data.type !== "file" || typeof data.content !== "string" || typeof data.sha !== "string") {
      return null;
    }
    const raw =
      data.encoding === "base64"
        ? Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf8")
        : data.content;
    return { filePath: relativePath, raw, sha: data.sha };
  }

  async readIgnoreRules(ref = this.branch): Promise<string | null> {
    const file = await this.readContentFile(".oncobaseignore", ref);
    return file?.raw ?? null;
  }

  async resolveFile(slug: string, ref = this.branch): Promise<RepoFile | null> {
    const cleanSlug = slug.replace(/^\/+/, "").replace(/\.(?:md|mdx)$/i, "");
    if (!cleanSlug || cleanSlug.includes("..") || cleanSlug.includes("\\")) return null;
    const [md, mdx] = await Promise.all([
      this.readContentFile(`${cleanSlug}.md`, ref),
      this.readContentFile(`${cleanSlug}.mdx`, ref),
    ]);
    if (md && mdx) {
      throw new Error(`Ambiguous page path: both ${cleanSlug}.md and ${cleanSlug}.mdx exist.`);
    }
    const match = md ?? mdx;
    if (!match) return null;
    const ignoreMatchers = compileOncobaseIgnore(await this.readIgnoreRules(ref));
    if (isExcludedVaultPath(match.filePath, ignoreMatchers)) return null;
    return match;
  }

  async commitFile({
    filePath,
    content,
    baseSha,
    message,
    author,
  }: {
    filePath: string;
    content: string;
    baseSha: string;
    message: string;
    author: RepoAuthor;
  }): Promise<RepoCommitResult> {
    const repoPath = joinRepoPath(this.config.vaultRoot, filePath);
    const url = `https://api.github.com/repos/${encodeURIComponent(this.config.owner)}/${encodeURIComponent(this.config.repo)}/contents/${encodeRepoPath(repoPath)}`;
    const response = await this.fetchImpl(url, {
      method: "PUT",
      headers: {
        ...(await this.githubHeaders()),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message,
        content: Buffer.from(content, "utf8").toString("base64"),
        sha: baseSha,
        branch: this.branch,
        author: { name: author.name, email: author.email },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 409 || response.status === 422) {
      throw new RepoConflictError("The file in GitHub changed since this edit was proposed.");
    }
    if (!response.ok) {
      throw new Error(`GitHub commit failed (${response.status})`);
    }
    const payload = (await response.json()) as {
      commit?: { sha?: string; html_url?: string };
    };
    const commitSha = payload.commit?.sha;
    if (!commitSha) throw new Error("GitHub commit succeeded without returning a commit SHA");
    return { commitSha, commitUrl: payload.commit?.html_url };
  }

  /**
   * Commit one or more edited/created files in a single atomic Git commit using
   * GitHub's Git Data API (blobs -> tree -> commit -> non-force ref CAS).
   */
  async commitFiles({
    files,
    message,
    author,
  }: {
    files: RepoFileCommitInput[];
    message: string;
    author: RepoAuthor;
  }): Promise<RepoCommitResult> {
    if (files.length === 0) {
      throw new Error("commitFiles requires at least one file");
    }
    const repoBase = `https://api.github.com/repos/${encodeURIComponent(this.config.owner)}/${encodeURIComponent(this.config.repo)}`;
    const headers = {
      ...(await this.githubHeaders()),
      "Content-Type": "application/json",
    };

    // 1. Read branch head commit & its base tree SHA.
    const refRes = await this.fetchImpl(
      `${repoBase}/git/ref/heads/${encodeRepoPath(this.branch)}`,
      { headers, signal: AbortSignal.timeout(10_000) },
    );
    if (!refRes.ok) {
      throw new Error(`GitHub branch ref lookup failed (${refRes.status})`);
    }
    const refData = (await refRes.json()) as { object?: { sha?: string } };
    const headCommitSha = refData.object?.sha;
    if (!headCommitSha) throw new Error("GitHub branch ref returned no commit SHA");

    const commitRes = await this.fetchImpl(`${repoBase}/git/commits/${encodeURIComponent(headCommitSha)}`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (!commitRes.ok) {
      throw new Error(`GitHub commit lookup failed (${commitRes.status})`);
    }
    const commitData = (await commitRes.json()) as { tree?: { sha?: string } };
    const baseTreeSha = commitData.tree?.sha;
    if (!baseTreeSha) throw new Error("GitHub head commit returned no tree SHA");

    // 2. Verify per-file preconditions against headCommitSha before writing any blobs.
    await Promise.all(
      files.map(async (file) => {
        if (file.operation === "edit") {
          const current = await this.readContentFile(file.filePath, headCommitSha);
          if (!current || current.sha !== file.baseSha) {
            throw new RepoConflictError(
              `The file "${file.filePath}" in GitHub changed since this edit was proposed.`,
            );
          }
        } else {
          const cleanSlug = file.filePath.replace(/^\/+/, "").replace(/\.(?:md|mdx)$/i, "");
          const [md, mdx] = await Promise.all([
            this.readContentFile(`${cleanSlug}.md`, headCommitSha),
            this.readContentFile(`${cleanSlug}.mdx`, headCommitSha),
          ]);
          if (md || mdx) {
            throw new RepoConflictError(
              `The page "${cleanSlug}" already exists in GitHub.`,
            );
          }
        }
      }),
    );

    // 3. Create blobs in parallel.
    const blobShas = await Promise.all(
      files.map(async (file) => {
        const blobRes = await this.fetchImpl(`${repoBase}/git/blobs`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            content: Buffer.from(file.content, "utf8").toString("base64"),
            encoding: "base64",
          }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!blobRes.ok) {
          throw new Error(`GitHub blob creation failed (${blobRes.status}) for ${file.filePath}`);
        }
        const blobData = (await blobRes.json()) as { sha?: string };
        if (!blobData.sha) throw new Error(`GitHub blob creation returned no SHA for ${file.filePath}`);
        return blobData.sha;
      }),
    );

    // 4. Create new tree layered on baseTreeSha.
    const treeRes = await this.fetchImpl(`${repoBase}/git/trees`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: files.map((file, index) => ({
          path: joinRepoPath(this.config.vaultRoot, file.filePath),
          mode: "100644",
          type: "blob",
          sha: blobShas[index]!,
        })),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!treeRes.ok) {
      throw new Error(`GitHub tree creation failed (${treeRes.status})`);
    }
    const treeData = (await treeRes.json()) as { sha?: string };
    if (!treeData.sha) throw new Error("GitHub tree creation returned no SHA");

    // 5. Create atomic commit.
    const newCommitRes = await this.fetchImpl(`${repoBase}/git/commits`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        message,
        tree: treeData.sha,
        parents: [headCommitSha],
        author: { name: author.name, email: author.email },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!newCommitRes.ok) {
      throw new Error(`GitHub commit creation failed (${newCommitRes.status})`);
    }
    const newCommitData = (await newCommitRes.json()) as { sha?: string; html_url?: string };
    const commitSha = newCommitData.sha;
    if (!commitSha) throw new Error("GitHub commit creation returned no SHA");

    // 6. Atomic non-force ref compare-and-swap on the target branch.
    const updateRefRes = await this.fetchImpl(
      `${repoBase}/git/refs/heads/${encodeRepoPath(this.branch)}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({ sha: commitSha, force: false }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (updateRefRes.status === 409 || updateRefRes.status === 422) {
      throw new RepoConflictError(
        "The target branch changed while committing. Ask Chat to propose a fresh edit or retry.",
      );
    }
    if (!updateRefRes.ok) {
      throw new Error(`GitHub branch ref update failed (${updateRefRes.status})`);
    }

    return {
      commitSha,
      commitUrl:
        newCommitData.html_url ??
        `https://github.com/${this.config.owner}/${this.config.repo}/commit/${commitSha}`,
    };
  }

  async findCommitByProposalId(proposalId: string): Promise<RepoCommitResult | null> {
    const marker = `Oncobase-Proposal: ${proposalId}`;
    const url = `https://api.github.com/repos/${encodeURIComponent(this.config.owner)}/${encodeURIComponent(this.config.repo)}/commits?sha=${encodeURIComponent(this.branch)}&per_page=20`;
    const response = await this.fetchImpl(url, {
      headers: await this.githubHeaders(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const commits = (await response.json()) as Array<{
      sha?: string;
      html_url?: string;
      commit?: { message?: string };
    }>;
    const hit = commits.find((entry) => entry.commit?.message?.includes(marker));
    if (!hit?.sha) return null;
    return { commitSha: hit.sha, commitUrl: hit.html_url };
  }
}

/**
 * In-memory repo adapter for unit tests and local-stack E2E tests (avoids
 * dirtying a developer's real local Obsidian vault checkout).
 */
export class MemoryRepoAdapter implements VaultRepoAdapter {
  readonly branch: string;
  readonly repoLabel: string;
  readonly files = new Map<string, { raw: string; sha: string }>();
  readonly commits: Array<{
    commitSha: string;
    commitUrl: string;
    filePath: string;
    message: string;
    author: RepoAuthor;
    content: string;
  }> = [];

  constructor(
    initialFiles: Record<string, string> = {},
    options: { branch?: string; repoLabel?: string } = {},
  ) {
    this.branch = options.branch ?? "main";
    this.repoLabel = options.repoLabel ?? "local/memory-vault";
    for (const [filePath, raw] of Object.entries(initialFiles)) {
      this.setFile(filePath, raw);
    }
  }

  private shaFor(content: string): string {
    return crypto.createHash("sha1").update(content).digest("hex");
  }

  setFile(filePath: string, raw: string): string {
    const clean = filePath.replace(/^\/+/, "");
    const sha = this.shaFor(raw);
    this.files.set(clean, { raw, sha });
    return sha;
  }

  async readIgnoreRules(): Promise<string | null> {
    return this.files.get(".oncobaseignore")?.raw ?? null;
  }

  async resolveFile(slug: string): Promise<RepoFile | null> {
    const cleanSlug = slug.replace(/^\/+/, "").replace(/\.(?:md|mdx)$/i, "");
    if (!cleanSlug || cleanSlug.includes("..") || cleanSlug.includes("\\")) return null;
    const md = this.files.get(`${cleanSlug}.md`);
    const mdx = this.files.get(`${cleanSlug}.mdx`);
    if (md && mdx) {
      throw new Error(`Ambiguous page path: both ${cleanSlug}.md and ${cleanSlug}.mdx exist.`);
    }
    const filePath = md ? `${cleanSlug}.md` : mdx ? `${cleanSlug}.mdx` : null;
    const entry = md ?? mdx;
    if (!filePath || !entry) return null;
    const ignoreMatchers = compileOncobaseIgnore(await this.readIgnoreRules());
    if (isExcludedVaultPath(filePath, ignoreMatchers)) return null;
    return { filePath, raw: entry.raw, sha: entry.sha };
  }

  async commitFile({
    filePath,
    content,
    baseSha,
    message,
    author,
  }: {
    filePath: string;
    content: string;
    baseSha: string;
    message: string;
    author: RepoAuthor;
  }): Promise<RepoCommitResult> {
    return this.commitFiles({
      files: [{ filePath, content, operation: "edit", baseSha }],
      message,
      author,
    });
  }

  async commitFiles({
    files,
    message,
    author,
  }: {
    files: RepoFileCommitInput[];
    message: string;
    author: RepoAuthor;
  }): Promise<RepoCommitResult> {
    if (files.length === 0) throw new Error("commitFiles requires at least one file");

    // Validate every file before mutating any state (atomic all-or-nothing).
    for (const file of files) {
      const clean = file.filePath.replace(/^\/+/, "");
      const current = this.files.get(clean);
      if (file.operation === "edit") {
        if (!current || current.sha !== file.baseSha) {
          throw new RepoConflictError(`The file "${clean}" changed since this edit was proposed.`);
        }
      } else {
        const cleanSlug = clean.replace(/\.(?:md|mdx)$/i, "");
        if (this.files.has(`${cleanSlug}.md`) || this.files.has(`${cleanSlug}.mdx`)) {
          throw new RepoConflictError(`The page "${cleanSlug}" already exists in the repository.`);
        }
      }
    }

    const shas: string[] = [];
    for (const file of files) {
      shas.push(this.setFile(file.filePath, file.content));
    }
    const commitSha = crypto
      .createHash("sha1")
      .update(`${shas.join(",")}:${message}:${this.commits.length}`)
      .digest("hex");
    const commitUrl = `https://github.com/${this.repoLabel}/commit/${commitSha}`;
    this.commits.push({
      commitSha,
      commitUrl,
      filePath: files.map((f) => f.filePath.replace(/^\/+/, "")).join(","),
      message,
      author,
      content: files[0]!.content,
    });
    return { commitSha, commitUrl };
  }

  async findCommitByProposalId(proposalId: string): Promise<RepoCommitResult | null> {
    const marker = `Oncobase-Proposal: ${proposalId}`;
    const hit = [...this.commits].reverse().find((c) => c.message.includes(marker));
    return hit ? { commitSha: hit.commitSha, commitUrl: hit.commitUrl } : null;
  }
}

const testAdapters = new Map<string, VaultRepoAdapter>();
let cachedEnvAdapter: { key: string; adapter: GitHubAppRepoAdapter } | null = null;

export function setTestRepoAdapter(siteSlug: string, adapter: VaultRepoAdapter | null) {
  if (adapter) testAdapters.set(siteSlug, adapter);
  else testAdapters.delete(siteSlug);
}

export function getRepoAdapterForSite(
  siteSlug: string,
  env: Record<string, string | undefined> = process.env,
): VaultRepoAdapter | null {
  const override = testAdapters.get(siteSlug);
  if (override) return override;
  const config = readGitHubAppConfigFromEnv(env);
  if (!config || config.siteSlug !== siteSlug) return null;
  const authKey =
    config.auth.kind === "app"
      ? `app:${config.auth.appId}:${config.auth.installationId}`
      : `token:${crypto.createHash("sha256").update(config.auth.token).digest("hex").slice(0, 12)}`;
  const cacheKey = `${config.siteSlug}:${authKey}:${config.owner}/${config.repo}:${config.branch}:${config.vaultRoot}`;
  if (!cachedEnvAdapter || cachedEnvAdapter.key !== cacheKey) {
    cachedEnvAdapter = { key: cacheKey, adapter: new GitHubAppRepoAdapter(config) };
  }
  return cachedEnvAdapter.adapter;
}

export function isWikiEditConfiguredForSite(
  siteSlug: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  return getRepoAdapterForSite(siteSlug, env) !== null;
}
