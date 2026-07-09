function readCommentsEnabledFlag() {
  const viteEnv = (import.meta as { env?: Record<string, string | undefined> }).env;
  return viteEnv?.VITE_NEXT_PUBLIC_ENABLE_COMMENTS ?? viteEnv?.VITE_ENABLE_COMMENTS;
}

export const commentsEnabled = readCommentsEnabledFlag() !== "false";
