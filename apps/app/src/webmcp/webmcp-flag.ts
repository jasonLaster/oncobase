const env = import.meta.env as Record<string, string | undefined>;
/** Kill switch: VITE_WEBMCP_ENABLED=false turns every WebMCP tool off. */
export const webMcpEnabled = env.VITE_WEBMCP_ENABLED !== "false";

/** True when this browser exposes WebMCP. Tool modules load only then, so
 * other browsers never download them. */
export function webMcpAvailable() {
  if (!webMcpEnabled || typeof document === "undefined") return false;
  return "modelContext" in document || (typeof navigator !== "undefined" && "modelContext" in navigator);
}
