import path from "node:path";

export function normalizeFilePath(value: string) {
  return path.normalize(value).replace(/^(\.\.(\/|\\|$))+/, "");
}

export function blobRequestHeaders(request: Request) {
  const range = request.headers.get("Range");
  return range ? { Range: range } : undefined;
}

export function publicSessionUser(user: { email: string; isAdmin?: boolean; name?: string | null }) {
  return {
    email: user.email,
    ...(user.isAdmin === undefined ? {} : { isAdmin: user.isAdmin }),
    name: user.name ?? null,
  };
}
