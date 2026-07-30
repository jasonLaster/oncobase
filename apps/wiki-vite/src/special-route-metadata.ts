export type SpecialRouteMetadata = {
  description: string;
  openGraphDescription: string;
  openGraphTitle: string;
  openGraphType: "website";
  title: string;
  twitterDescription: string;
  twitterTitle: string;
};

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
