"use client";

import {
  MarkdownHeadingAnchors as SharedMarkdownHeadingAnchors,
  RoutedAnchorLinks as SharedRoutedAnchorLinks,
  type WikiMarkdownRouteAdapter,
} from "@oncobase/wiki-markdown";
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

const notification = {
  success: (message: string) => toast.success(message),
  error: (message: string) => toast.error(message),
};

function useNextMarkdownRouteAdapter(): WikiMarkdownRouteAdapter {
  const router = useRouter();

  return useMemo(
    () => ({
      push: (href, options) => {
        router.push(href, { scroll: options?.scroll });
      },
    }),
    [router],
  );
}

export function RoutedAnchorLinks({ scopeKey }: { scopeKey?: string }) {
  const routeAdapter = useNextMarkdownRouteAdapter();

  return (
    <SharedRoutedAnchorLinks
      notification={notification}
      routeAdapter={routeAdapter}
      scopeKey={scopeKey}
    />
  );
}

export function MarkdownHeadingAnchors({
  disableAnchors,
  scopeKey,
}: {
  disableAnchors?: boolean;
  scopeKey?: string;
}) {
  const routeAdapter = useNextMarkdownRouteAdapter();

  return (
    <SharedMarkdownHeadingAnchors
      disableAnchors={disableAnchors}
      notification={notification}
      routeAdapter={routeAdapter}
      scopeKey={scopeKey}
    />
  );
}
