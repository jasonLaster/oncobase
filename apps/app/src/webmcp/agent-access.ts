import { safeLocalStorage } from "../safe-storage";

/** Per-device consent for WebMCP tools to return private (sensitive) page
 * content. Being allowed to see a page is not consent to have an AI agent in
 * this browser forward it to a model, so this defaults to off. */
const ALLOW_PRIVATE_KEY = "oncobase:webmcp:allow-private";
export const AGENT_ACCESS_CHANGE_EVENT = "oncobase:webmcp:access-change";

export function agentsMayReadPrivatePages() {
  return safeLocalStorage.getItem(ALLOW_PRIVATE_KEY) === "true";
}

export function setAgentsMayReadPrivatePages(allowed: boolean) {
  if (allowed) safeLocalStorage.setItem(ALLOW_PRIVATE_KEY, "true");
  else safeLocalStorage.removeItem(ALLOW_PRIVATE_KEY);
  window.dispatchEvent(new Event(AGENT_ACCESS_CHANGE_EVENT));
}
