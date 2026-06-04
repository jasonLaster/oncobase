import { describe, expect, test } from "bun:test";
import { getFunctionName, type FunctionReference } from "convex/server";
import JSZip from "jszip";
import { createWikiApiHandler } from "./wiki-api";

type FakeUser = {
  _id: string;
  email: string;
  name: string | null;
  passwordHash: string;
  passwordSalt: string;
};

type FakeSession = {
  tokenHash: string;
  userId: string;
  expiresAt: number;
};

type FakePage = {
  slug: string;
  title: string;
  content: string;
  tags: string[];
  sensitive?: boolean;
};

function request(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Host", "127.0.0.1");
  return new Request(`http://127.0.0.1${path}`, {
    ...init,
    headers,
  });
}

function cookieFrom(response: Response) {
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  expect(cookie).toBeTruthy();
  return cookie!;
}

function createFakeConvexClient() {
  const users = new Map<string, FakeUser>();
  const sessions = new Map<string, FakeSession>();
  const pages: FakePage[] = [
    {
      slug: "wiki/public",
      title: "Public",
      tags: ["public"],
      content: "# Public\n\nPublic wiki body.",
    },
    {
      slug: "private/plan",
      title: "Private Plan",
      tags: ["private"],
      content: "# Private Plan\n\nSensitive note for Diana Laster and MRN 88855655.",
      sensitive: true,
    },
  ];

  return {
    async query(ref: FunctionReference<"query">, args: Record<string, unknown>) {
      switch (getFunctionName(ref)) {
        case "sites:getBySlug":
          return { slug: args.slug, config: { passwordGate: true } };
        case "users:getByEmailForAuth":
          return users.get(String(args.email)) ?? null;
        case "users:getSessionUser": {
          const session = sessions.get(String(args.tokenHash));
          if (!session || session.expiresAt <= Date.now()) return null;
          const user = [...users.values()].find((candidate) => candidate._id === session.userId);
          return user
            ? {
                _id: user._id,
                email: user.email,
                name: user.name,
                createdAt: Date.now(),
              }
            : null;
        }
        case "documents:listPageWithContent": {
          const includeSensitive = args.includeSensitive === true;
          const visiblePages = pages.filter((page) => includeSensitive || !page.sensitive);
          return {
            page: visiblePages.map((page) => ({
              ...page,
              description: null,
              contentHash: page.slug,
              sensitive: page.sensitive === true,
            })),
            isDone: true,
            continueCursor: null,
          };
        }
        case "documents:listPdfAssets":
          return [
            {
              path: "sources/public/source.pdf",
              blobUrl: "data:application/pdf;base64,JVBERi0xLjQKJUVPRgo=",
            },
          ];
        case "documents:listFileAssets": {
          const includeSensitive = args.includeSensitive === true;
          return [
            {
              path: "biopsy/raw/dicom.zip",
              blobUrl: "data:application/zip;base64,UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==",
            },
            ...(includeSensitive
              ? [
                  {
                    path: "private/plan.zip",
                    blobUrl: "data:application/zip;base64,UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==",
                  },
                ]
              : []),
          ];
        }
        default:
          throw new Error(`Unexpected query ${getFunctionName(ref)}`);
      }
    },
    async mutation(ref: FunctionReference<"mutation">, args: Record<string, unknown>) {
      switch (getFunctionName(ref)) {
        case "users:create": {
          const email = String(args.email);
          if (users.has(email)) throw new Error("An account with that email already exists");
          const user: FakeUser = {
            _id: `user_${users.size + 1}`,
            email,
            name: typeof args.name === "string" ? args.name : null,
            passwordHash: String(args.passwordHash),
            passwordSalt: String(args.passwordSalt),
          };
          users.set(email, user);
          return user._id;
        }
        case "users:createSession": {
          sessions.set(String(args.tokenHash), {
            tokenHash: String(args.tokenHash),
            userId: String(args.userId),
            expiresAt: Number(args.expiresAt),
          });
          return `session_${sessions.size}`;
        }
        case "users:deleteSession": {
          const deleted = sessions.delete(String(args.tokenHash));
          return { deleted };
        }
        default:
          throw new Error(`Unexpected mutation ${getFunctionName(ref)}`);
      }
    },
  };
}

describe("wiki Vite API auth and scoped archive behavior", () => {
  test("signs up, reads the session, rejects bad sign-in, and signs out without live Convex writes", async () => {
    const handler = createWikiApiHandler(createFakeConvexClient() as never);
    const email = "reader@example.com";
    const password = "correct horse battery";

    const signup = await handler(
      request("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name: "Reader", password }),
      }),
    );
    expect(signup?.status).toBe(200);
    const cookie = cookieFrom(signup!);
    expect(await signup!.json()).toEqual({
      ok: true,
      user: { email, name: "Reader" },
    });

    const session = await handler(request("/api/auth/session", { headers: { Cookie: cookie } }));
    expect(session?.status).toBe(200);
    expect(await session!.json()).toEqual({ user: { email, name: "Reader" } });

    const badSignin = await handler(
      request("/api/auth/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "wrong-password" }),
      }),
    );
    expect(badSignin?.status).toBe(401);

    const signout = await handler(
      request("/api/auth/signout", {
        method: "POST",
        headers: { Cookie: cookie },
      }),
    );
    expect(signout?.status).toBe(200);
    expect(signout!.headers.get("set-cookie")).toContain("Max-Age=0");

    const afterSignout = await handler(request("/api/auth/session", { headers: { Cookie: cookie } }));
    expect(await afterSignout!.json()).toEqual({ user: null });
  });

  test("keeps public and session zip archives scoped and redacted", async () => {
    const handler = createWikiApiHandler(createFakeConvexClient() as never);
    const signup = await handler(
      request("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "archive-reader@example.com",
          password: "correct horse battery",
        }),
      }),
    );
    const cookie = cookieFrom(signup!);

    const publicArchive = await handler(request("/api/download?type=markdown&scope=public"));
    expect(publicArchive?.status).toBe(200);
    expect(publicArchive!.headers.get("x-wiki-cache-scope")).toBe("public");
    const publicZip = await JSZip.loadAsync(await publicArchive!.arrayBuffer());
    expect(Object.keys(publicZip.files)).toContain("wiki/public.md");
    expect(Object.keys(publicZip.files)).not.toContain("private/plan.md");

    const sessionArchive = await handler(
      request("/api/download?type=markdown&scope=session", {
        headers: { Cookie: cookie },
      }),
    );
    expect(sessionArchive?.status).toBe(200);
    expect(sessionArchive!.headers.get("x-wiki-cache-scope")).toBe("session");
    expect(sessionArchive!.headers.get("cache-control")).toContain("private");
    const sessionZip = await JSZip.loadAsync(await sessionArchive!.arrayBuffer());
    expect(Object.keys(sessionZip.files)).toContain("private/plan.md");
    const privateBody = await sessionZip.file("private/plan.md")!.async("string");
    expect(privateBody).not.toContain("Diana Laster");
    expect(privateBody).not.toContain("88855655");

    const fullArchive = await handler(request("/api/download?type=full&scope=public&limit=1"));
    const fullZip = await JSZip.loadAsync(await fullArchive!.arrayBuffer());
    expect(Object.keys(fullZip.files)).toContain("sources/public/source.pdf");
    expect(Object.keys(fullZip.files)).toContain("biopsy/raw/dicom.zip");
    expect(Object.keys(fullZip.files)).not.toContain("private/plan.zip");

    const sessionFullArchive = await handler(
      request("/api/download?type=full&scope=session&limit=1", {
        headers: { Cookie: cookie },
      }),
    );
    const sessionFullZip = await JSZip.loadAsync(await sessionFullArchive!.arrayBuffer());
    expect(Object.keys(sessionFullZip.files)).toContain("private/plan.zip");
  });
});
