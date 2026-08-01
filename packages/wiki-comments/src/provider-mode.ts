export type LiveblocksProviderMode = "auth" | "public" | "unavailable";

export function resolveLiveblocksProviderMode({
  authConfigured,
  publicApiKey,
}: {
  authConfigured: boolean;
  publicApiKey: string | null;
}): LiveblocksProviderMode {
  if (authConfigured) return "auth";
  return publicApiKey ? "public" : "unavailable";
}
