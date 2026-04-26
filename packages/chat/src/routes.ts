export interface ChatRouteConfig {
  basePath?: string;
  newChatPath?: string;
  archivedPath?: string;
  conversationPath?: (conversationId: string) => string;
  conversationUrl?: (conversationId: string, origin: string) => string;
  matchConversationId?: (pathname: string) => string | null;
}

export interface ChatRoutes {
  basePath: string;
  newChatPath: string;
  archivedPath: string;
  conversationPath: (conversationId: string) => string;
  conversationUrl: (conversationId: string, origin: string) => string;
  matchConversationId: (pathname: string) => string | null;
  isNewChatPath: (pathname: string) => boolean;
  isArchivedPath: (pathname: string) => boolean;
}

function normalizePath(path: string): string {
  const withLeadingSlash = path.startsWith("/") ? path : `/${path}`;
  if (withLeadingSlash.length === 1) return withLeadingSlash;
  return withLeadingSlash.replace(/\/+$/, "");
}

function pathOnly(pathname: string): string {
  return normalizePath(pathname.split(/[?#]/)[0] || "/");
}

function joinPath(base: string, segment: string): string {
  if (base === "/") return normalizePath(`/${segment}`);
  return normalizePath(`${base}/${segment}`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function createChatRoutes(config: ChatRouteConfig = {}): ChatRoutes {
  const basePath = normalizePath(config.basePath ?? "/chat");
  const newChatPath = normalizePath(config.newChatPath ?? basePath);
  const archivedPath = normalizePath(
    config.archivedPath ?? joinPath(basePath, "archived")
  );
  const defaultConversationPath = (conversationId: string) =>
    joinPath(basePath, encodeURIComponent(conversationId));
  const conversationPath =
    config.conversationPath ?? defaultConversationPath;
  const conversationUrl =
    config.conversationUrl ??
    ((conversationId: string, origin: string) =>
      `${origin.replace(/\/+$/, "")}${conversationPath(conversationId)}`);
  const defaultMatcher = (pathname: string) => {
    const current = pathOnly(pathname);
    if (current === newChatPath || current === archivedPath) return null;
    const escapedBase = escapeRegExp(basePath);
    const match =
      basePath === "/"
        ? current.match(/^\/([^/]+)$/)
        : current.match(new RegExp(`^${escapedBase}/([^/]+)$`));
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  };
  const matchConversationId =
    config.matchConversationId ?? defaultMatcher;

  return {
    basePath,
    newChatPath,
    archivedPath,
    conversationPath,
    conversationUrl,
    matchConversationId,
    isNewChatPath: (pathname: string) => pathOnly(pathname) === newChatPath,
    isArchivedPath: (pathname: string) => pathOnly(pathname) === archivedPath,
  };
}
