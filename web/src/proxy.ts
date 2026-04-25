import { NextRequest, NextResponse } from "next/server";

const PASSWORDS = ["wallify", "diana"];
const SHOW_PII_QUERY_PARAM = "showPII";
const SHOW_PII_TRUTHY_VALUES = new Set(["1", "true", "yes", "on"]);
const CANONICAL_PATHS = new Map([["/about/index", "/about/Index"]]);
const LINK_PREVIEW_BOT_RE =
  /\b(slackbot|twitterbot|facebookexternalhit|facebot|linkedinbot|discordbot|whatsapp|telegrambot|skypeuripreview|microsoftpreview|teamsbot|pinterest|redditbot|applebot)\b/i;

export function proxy(request: NextRequest) {
  const canonicalPath = CANONICAL_PATHS.get(request.nextUrl.pathname);
  if (canonicalPath) {
    const canonicalUrl = request.nextUrl.clone();
    canonicalUrl.pathname = canonicalPath;
    return NextResponse.redirect(canonicalUrl);
  }

  const isAuthed = request.cookies.get("authed")?.value === "true";
  const isLoginPage = request.nextUrl.pathname === "/login";
  const isSharePreviewRequest =
    (request.method === "GET" || request.method === "HEAD") &&
    LINK_PREVIEW_BOT_RE.test(request.headers.get("user-agent") ?? "");

  // Magic link: ?token=<password> on any page auto-logs in and strips the param
  const token = request.nextUrl.searchParams.get("token");
  if (token && PASSWORDS.includes(token)) {
    const clean = new URL(request.url);
    clean.searchParams.delete("token");
    const response = NextResponse.redirect(clean);
    response.cookies.set("authed", "true", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return response;
  }

  if (isLoginPage) {
    if (isAuthed) {
      const redirect = request.nextUrl.searchParams.get("redirect") || "/";
      return NextResponse.redirect(new URL(redirect, request.url));
    }
    return NextResponse.next();
  }

  if (!isAuthed && isSharePreviewRequest) {
    const previewUrl = new URL("/api/share-preview", request.url);
    previewUrl.searchParams.set("path", request.nextUrl.pathname);
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-share-preview-path", request.nextUrl.pathname);
    return NextResponse.rewrite(previewUrl, {
      request: { headers: requestHeaders },
    });
  }

  if (!isAuthed) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (
    shouldRevealPii(request.nextUrl.searchParams.get(SHOW_PII_QUERY_PARAM)) &&
    !request.nextUrl.pathname.startsWith("/api/") &&
    !request.nextUrl.pathname.startsWith("/pii-view")
  ) {
    const piiUrl = request.nextUrl.clone();
    piiUrl.pathname =
      request.nextUrl.pathname === "/"
        ? "/pii-view/index"
        : `/pii-view${request.nextUrl.pathname}`;
    return NextResponse.rewrite(piiUrl);
  }

  return NextResponse.next();
}

function shouldRevealPii(value: string | null) {
  if (!value) {
    return false;
  }

  return SHOW_PII_TRUTHY_VALUES.has(value.toLowerCase());
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|api/auth|api/login|api/share-preview|api/liveblocks|api/post-deploy|api/file|\\.well-known/workflow).*)",
  ],
};
