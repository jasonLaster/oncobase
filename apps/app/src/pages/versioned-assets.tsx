import { createContext, createElement, useContext, useRef, type ComponentProps } from "react";
import { versionedFileUrl } from "../wiki-assets";

/** Manifest asset hashes for the page being read (P11). */
export const AssetVersionsContext = createContext<ReadonlyMap<string, string>>(new Map());

/**
 * One stable component type for every markdown image (a new type per render
 * would remount images). Reads the hashes from context, so the image and its
 * theater view both request the content-addressed URL.
 *
 * The URL is fixed for the life of the element: the article paints before
 * the manifest (and its asset hashes) arrives, and switching a painted image
 * to its versioned URL would download it twice. Later mounts (a revisit, the
 * theater view) use the versioned URL.
 */
export function VersionedWikiImage({ src, loading = "lazy", decoding = "async", ...props }: ComponentProps<"img">) {
  const hashes = useContext(AssetVersionsContext);
  const chosen = useRef<{ raw: unknown; resolved: typeof src } | null>(null);
  if (!chosen.current || chosen.current.raw !== src) {
    chosen.current = { raw: src, resolved: typeof src === "string" ? versionedFileUrl(src, hashes) : src };
  }
  return createElement("img", { loading, decoding, ...props, src: chosen.current.resolved });
}
