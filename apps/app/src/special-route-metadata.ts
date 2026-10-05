export type SpecialRouteMetadata = {
  description: string;
  openGraphDescription: string;
  /** Public path; servers make it absolute for link previews. */
  openGraphImage?: string;
  openGraphTitle: string;
  openGraphType: "website";
  title: string;
  twitterDescription: string;
  twitterTitle: string;
};

export const LANDING_TITLE = "Diana TNBC Knowledge Base";
export const SIGN_IN_TITLE = `Sign in — ${LANDING_TITLE}`;
const LANDING_DESCRIPTION =
  "Diana’s records, scans, and research in one knowledge base, so everyone helping with her triple-negative breast cancer care can work from the same page.";

/** What a shared link to the landing page shows in chats and social apps. */
export function landingRouteMetadata(): SpecialRouteMetadata {
  return {
    description: LANDING_DESCRIPTION,
    openGraphDescription: LANDING_DESCRIPTION,
    openGraphImage: "/landing/og-image.jpg",
    openGraphTitle: "It takes a village",
    openGraphType: "website",
    title: LANDING_TITLE,
    twitterDescription: LANDING_DESCRIPTION,
    twitterTitle: "It takes a village",
  };
}

const FEATURES_DESCRIPTION =
  "Everything Oncobase can do: a searchable reader with an outline and file palette, smart tables, an AI chat and semantic search over your own records, role-based privacy with inline redaction, clinical viewers, and an open-source publishing pipeline built for people and agents.";

/** What a shared link to the features page shows in chats and social apps. */
export function featuresRouteMetadata(): SpecialRouteMetadata {
  return {
    description: FEATURES_DESCRIPTION,
    openGraphDescription: FEATURES_DESCRIPTION,
    openGraphImage: "/landing/og-image.jpg",
    openGraphTitle: "Everything Oncobase can do",
    openGraphType: "website",
    title: "Oncobase features — open-source tools for taking control of your care",
    twitterDescription: FEATURES_DESCRIPTION,
    twitterTitle: "Everything Oncobase can do",
  };
}

const COMPARE_DESCRIPTION =
  "An honest comparison of Oncobase with Notion, Obsidian, Yuga Bio, Citizen Health, Mere Medical, and Medplum: which to use for your family, and what you can reuse if you’re building your own.";

/** What a shared link to the comparison page shows in chats and social apps. */
export function compareRouteMetadata(): SpecialRouteMetadata {
  return {
    description: COMPARE_DESCRIPTION,
    openGraphDescription: COMPARE_DESCRIPTION,
    openGraphImage: "/landing/og-image.jpg",
    openGraphTitle: "How Oncobase compares",
    openGraphType: "website",
    title: "How Oncobase compares with Notion, Obsidian, and other health tools",
    twitterDescription: COMPARE_DESCRIPTION,
    twitterTitle: "How Oncobase compares",
  };
}

type RouteDefinition = {
  description?: string;
  openGraphTitle?: string;
  routeTitle: string;
};

function routeDefinition(pathname: string): RouteDefinition | null {
  if (pathname === "/terms-and-conditions") {
    return {
      routeTitle: "Terms and Conditions",
      description: "Terms and conditions for the Diana TNBC Knowledge Base.",
      openGraphTitle: "Terms and Conditions",
    };
  }
  if (pathname === "/comments") {
    return {
      routeTitle: "Comments",
      description: "Recent comments and discussions",
      openGraphTitle: "Comments",
    };
  }
  if (pathname === "/chat" || pathname.startsWith("/chat/")) {
    return {
      routeTitle: "Chat",
      description: "Ask questions about TNBC research and treatment",
      openGraphTitle: "Chat",
    };
  }
  if (pathname === "/diagnostics") {
    return { routeTitle: "Diagnostics" };
  }
  if (pathname === "/diagnostics/imaging") {
    return { routeTitle: "Diagnostic Imaging" };
  }
  if (pathname === "/tools/dicom-viewer") {
    return { routeTitle: "DICOM Viewer" };
  }
  if (pathname === "/tools/pathology-viewer") {
    return { routeTitle: "H&E Slide Viewer" };
  }
  if (pathname === "/tools/dicom-compare") {
    return { routeTitle: "DICOM Comparison" };
  }
  if (pathname === "/tools/medical-deduction") {
    return { routeTitle: "Medical Expense Deduction Calculator" };
  }
  if (pathname === "/admin/pages" || pathname === "/admin/access") {
    return { routeTitle: "Admin Pages" };
  }
  if (pathname === "/admin/users" || pathname === "/access") {
    return { routeTitle: "Admin Users" };
  }
  if (pathname === "/admin/roles") {
    return { routeTitle: "Admin Roles" };
  }
  if (pathname === "/admin") {
    return { routeTitle: "Admin" };
  }
  return null;
}

export function specialRouteMetadata({
  defaultDescription,
  pathname,
  siteName,
}: {
  defaultDescription: string;
  pathname: string;
  siteName: string;
}): SpecialRouteMetadata | null {
  if (pathname === "/login") return landingRouteMetadata();
  if (pathname === "/features") return featuresRouteMetadata();
  if (pathname === "/compare") return compareRouteMetadata();
  if (pathname === "/sign-in") {
    return { ...landingRouteMetadata(), title: SIGN_IN_TITLE };
  }
  const definition = routeDefinition(pathname);
  if (!definition) return null;

  const description = definition.description ?? defaultDescription;
  return {
    description,
    openGraphDescription: definition.description ?? defaultDescription,
    openGraphTitle: definition.openGraphTitle ?? siteName,
    openGraphType: "website",
    title: `${definition.routeTitle} — ${siteName}`,
    twitterDescription: defaultDescription,
    twitterTitle: siteName,
  };
}
