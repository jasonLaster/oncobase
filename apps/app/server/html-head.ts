function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function injectHeadMetadata(
  html: string,
  metadata: {
    title: string;
    description?: string | null;
    canonicalUrl?: string;
    noIndex?: boolean;
    openGraphDescription?: string;
    openGraphTitle?: string;
    openGraphType?: "article" | "website";
    sensitive?: boolean;
    twitterDescription?: string;
    twitterTitle?: string;
  },
) {
  const title = escapeHtml(metadata.title);
  const description = escapeHtml(metadata.description || metadata.title);
  const openGraphTitle = escapeHtml(metadata.openGraphTitle ?? metadata.title);
  const openGraphDescription = escapeHtml(
    metadata.openGraphDescription ?? metadata.description ?? metadata.title,
  );
  const twitterTitle = escapeHtml(metadata.twitterTitle ?? metadata.title);
  const twitterDescription = escapeHtml(
    metadata.twitterDescription ?? metadata.description ?? metadata.title,
  );
  const canonicalUrl = metadata.canonicalUrl
    ? escapeHtml(metadata.canonicalUrl)
    : null;
  const robotsContent =
    metadata.noIndex || metadata.sensitive ? "noindex, nofollow" : "index, follow";
  const tags = [
    canonicalUrl ? `<link rel="canonical" href="${canonicalUrl}" />` : null,
    `<meta name="description" content="${description}" />`,
    `<meta name="robots" content="${robotsContent}" />`,
    `<meta property="og:title" content="${openGraphTitle}" />`,
    `<meta property="og:description" content="${openGraphDescription}" />`,
    canonicalUrl ? `<meta property="og:url" content="${canonicalUrl}" />` : null,
    metadata.openGraphType
      ? `<meta property="og:type" content="${metadata.openGraphType}" />`
      : null,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${twitterTitle}" />`,
    `<meta name="twitter:description" content="${twitterDescription}" />`,
  ]
    .filter((tag): tag is string => tag !== null)
    .join("\n    ");

  return html
    .replace(/<title>.*?<\/title>/, `<title>${title}</title>`)
    .replace("</head>", `    ${tags}\n  </head>`);
}

