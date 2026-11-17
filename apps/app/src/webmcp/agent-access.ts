import { safeLocalStorage } from "@oncobase/safe-storage";
import { emit } from "../reader-bus";

/** Per-device consent for WebMCP tools to return private (sensitive) page
 * content. Being allowed to see a page is not consent to have an AI agent in
 * this browser forward it to a model, so this defaults to off. */
const ALLOW_PRIVATE_KEY = "oncobase:webmcp:allow-private";

export function agentsMayReadPrivatePages() {
  return safeLocalStorage.getItem(ALLOW_PRIVATE_KEY) === "true";
}

export function setAgentsMayReadPrivatePages(allowed: boolean) {
  if (allowed) safeLocalStorage.setItem(ALLOW_PRIVATE_KEY, "true");
  else safeLocalStorage.removeItem(ALLOW_PRIVATE_KEY);
  emit("agent-access-change");
}
