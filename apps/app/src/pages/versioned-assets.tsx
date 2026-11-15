import { createElement, useContext, useState, type ComponentProps } from "react";
import { versionedFileUrl } from "../wiki-assets";
import { AssetVersionsContext } from "./asset-versions-context";

/**
 * One stable component type for every markdown image (a new type per render
 * would remount images). Reads the hashes from context, so the image and its
 * theater view both request the content-addressed URL (P11).
 *
 * The URL is fixed for the life of the element: the article paints before
 * the manifest (and its asset hashes) arrives, and switching a painted image
 * to its versioned URL would download it twice. Later mounts (a revisit, the
 * theater view) use the versioned URL.
 */
export function VersionedWikiImage({ src, loading = "lazy", decoding = "async", ...props }: ComponentProps<"img">) {
  const hashes = useContext(AssetVersionsContext);
  const resolve = () => ({ raw: src, resolved: typeof src === "string" ? versionedFileUrl(src, hashes) : src });
  const [chosen, setChosen] = useState(resolve);
  // A new source (not new hashes) picks its URL afresh.
  const current = chosen.raw === src ? chosen : resolve();
  if (current !== chosen) setChosen(current);
  return createElement("img", { loading, decoding, ...props, src: current.resolved });
}
