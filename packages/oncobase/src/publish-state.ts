import { publisherPost } from "./publish-post";
import { publishProfile, type PublishProfile } from "./publish-profile";
import { HASH_FUNCTION_VERSION, type PublishDocument, type PublishAsset } from "./walk-vault";

export type PublishedState = {
  version: 1;
  documents: Array<{ slug: string; exists: boolean; contentHash?: string | null;
    observedHash?: string | null; readerContentConsistent?: boolean | null; hashFunctionVersion?: number; sensitive?: boolean; sensitiveInclude?: string[] }>;
  assets: Array<{ path: string; kind: "pdf" | "file"; exists: boolean; contentHash?: string | null;
    visibilityHash?: string | null; observedVisibilityHash?: string | null;
    hasVisibility?: boolean; hasBlob?: boolean; sizeBytes?: number }>;
};

/** The same bounded read path is used by verification and the benchmark.
 * No fallback to the full content feed or a write endpoint. */
export async function readPublishedState(options: {
  publishUrl: string; token: string; site: string; slugs: string[];
  assets: Array<{ path: string; kind: "pdf" | "file" }>;
  profile?: PublishProfile; signal?: AbortSignal;
}): Promise<PublishedState> {
  const result: PublishedState = { version: 1, documents: [], assets: [] };
  const batches = Math.max(Math.ceil(options.slugs.length / 16), Math.ceil(options.assets.length / 128));
  // Sequential bounded batches keep memory and backend read budgets predictable.
  for (let batch = 0; batch < batches; batch++) {
    const slugs = options.slugs.slice(batch * 16, (batch + 1) * 16);
    const assets = options.assets.slice(batch * 128, (batch + 1) * 128);
    const state = await publisherPost<PublishedState>(`${options.publishUrl}/state`, options.token, {
      siteSlug: options.site, slugs, assets,
    }, { profile: options.profile ?? publishProfile, signal: options.signal ?? AbortSignal.timeout(20_000) });
    if (state.version !== 1 || !Array.isArray(state.documents) || !Array.isArray(state.assets) ||
        state.documents.length !== slugs.length || state.assets.length !== assets.length ||
        state.documents.some((row, i) => row.slug !== slugs[i]) ||
        state.assets.some((row, i) => row.path !== assets[i].path || row.kind !== assets[i].kind)) {
      throw new Error("Invalid or incomplete publish state response");
    }
    result.documents.push(...state.documents);
    result.assets.push(...state.assets);
  }
  return result;
}

export function comparePublishedState(
  state: PublishedState, documents: PublishDocument[], assets: PublishAsset[],
  verification: "content" | "metadata" = "content",
) {
  const remoteDocs = new Map(state.documents.map(doc => [doc.slug, doc]));
  const remoteAssets = new Map(state.assets.map(asset => [`${asset.kind}:${asset.path}`, asset]));
  const documentMismatches = documents.filter(doc => {
    const remote = remoteDocs.get(doc.slug);
    return !remote?.exists || remote.contentHash !== doc.hash ||
      remote.hashFunctionVersion !== HASH_FUNCTION_VERSION ||
      (verification === "content" && (remote.observedHash !== doc.hash || remote.readerContentConsistent !== true)) ||
      remote.sensitive !== doc.sensitive ||
      JSON.stringify(remote.sensitiveInclude) !== JSON.stringify(doc.sensitiveInclude);
  });
  const assetMismatches = assets.filter(asset => {
    const remote = remoteAssets.get(`${asset.kind}:${asset.relativePath}`);
    // This verifies asset registration/visibility, not the remote blob bytes.
    return !remote?.exists || !remote.hasBlob || !remote.hasVisibility || remote.contentHash !== asset.hash ||
      remote.visibilityHash !== asset.visibilityHash || remote.observedVisibilityHash !== asset.visibilityHash ||
      remote.sizeBytes !== asset.sizeBytes;
  });
  return { documentMismatches, assetMismatches };
}
