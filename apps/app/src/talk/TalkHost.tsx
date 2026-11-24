import { lazy, Suspense, useEffect, useRef } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@oncobase/ui/tooltip";
import { useLocation } from "react-router";
import { isTalkRoute } from "../shell/document-routes";
import { PhoneIcon } from "./PhoneIcon";
import { closeTalk, loadTalkPanel, openTalk, useTalkState } from "./talk-store";

const TalkPanel = lazy(() => loadTalkPanel().then(module => ({ default: module.TalkPanel })));

/** Lives in the reader shell, so a call survives client-side page changes.
 * Desktop gets a round call button in the bottom-right corner; on phones the launcher
 * sits in the floating button group beside Ask wiki (see MobileNav). */
export function TalkHost() {
  const { open } = useTalkState();
  const { pathname } = useLocation();
  const launcher = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  // Closing the call hands focus back to the launcher.
  useEffect(() => {
    if (!open && wasOpen.current) launcher.current?.focus();
    wasOpen.current = open;
  }, [open]);
  if (open) {
    return <Suspense fallback={null}><TalkPanel onClose={closeTalk} /></Suspense>;
  }
  if (!isTalkRoute(pathname)) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={<button
          type="button"
          className="wiki-vite-talk-launcher"
          data-test-id="talk-launcher"
          aria-label="Talk with the page"
          ref={launcher}
          onClick={openTalk}
          onPointerEnter={() => void loadTalkPanel()}
          onFocus={() => void loadTalkPanel()}
        />}
      >
        <PhoneIcon />
      </TooltipTrigger>
      <TooltipContent className="reader-tooltip" side="left">Talk with the page</TooltipContent>
    </Tooltip>
  );
}
