export function commentsFeatureEnabled() {
  return process.env.NEXT_PUBLIC_ENABLE_COMMENTS !== "false";
}
