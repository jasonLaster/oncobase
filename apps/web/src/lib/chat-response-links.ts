const SCHEME_PATTERN = /^[a-z][a-z\d+.-]*:/i;

export function resolveChatResponseHref(href: string | undefined): string | undefined {
  if (!href) return href;

  if (
    href.startsWith("#") ||
    href.startsWith("/") ||
    href.startsWith("//") ||
    SCHEME_PATTERN.test(href)
  ) {
    return href;
  }

  const rootPath = href.replace(/^(?:\.{1,2}\/)+/, "");
  return `/${rootPath}`;
}

export function isInternalChatResponseHref(href: string | undefined): href is string {
  return Boolean(href?.startsWith("/") && !href.startsWith("//"));
}
