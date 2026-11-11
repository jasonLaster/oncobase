type BackendRelease = {
  tag_name: string;
  assets: Array<{ name: string; browser_download_url: string }>;
};

/** Authenticate only the public release metadata request, never the asset URL. */
export async function backendReleases(
  token = process.env.GH_TOKEN,
  fetchMetadata: (url: string, init?: RequestInit) => Promise<Response> = fetch,
): Promise<BackendRelease[]> {
  const response = await fetchMetadata(
    "https://api.github.com/repos/get-convex/convex-backend/releases?per_page=20",
    { headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "oncobase-local-stack",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    } },
  );
  if (!response.ok) {
    throw new Error(`Convex backend release metadata request failed (HTTP ${response.status})`);
  }
  let releases: unknown;
  try { releases = await response.json(); }
  catch { throw new Error("Convex backend release metadata was not valid JSON"); }
  if (!Array.isArray(releases) || releases.some(release =>
    !release || typeof release.tag_name !== "string" || !Array.isArray(release.assets) ||
    release.assets.some((asset: Record<string, unknown>) =>
      !asset || typeof asset.name !== "string" || typeof asset.browser_download_url !== "string"))) {
    throw new Error("Convex backend release metadata was not a release list");
  }
  return releases;
}
