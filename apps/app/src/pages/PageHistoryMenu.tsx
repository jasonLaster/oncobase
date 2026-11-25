import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@oncobase/ui/menu";
import { ToolbarButton } from "@oncobase/ui/toolbar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@oncobase/ui/tooltip";
import { History } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "react-router";
import { formatVersionDate, usePageVersions, VERSION_PARAM, versionIdFromSearch } from "./page-history";

function hrefWithVersion(pathname: string, search: string, id: string | null) {
  const params = new URLSearchParams(search);
  if (id) params.set(VERSION_PARAM, id);
  else params.delete(VERSION_PARAM);
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ""}`;
}

/** The page's history: the live version first, then past versions, newest first. */
export function PageHistoryMenu({ slug }: { slug: string }) {
  const location = useLocation();
  const [opened, setOpened] = useState(false);
  const history = usePageVersions(slug, opened);
  const selected = versionIdFromSearch(location.search);

  return (
    <Menu onOpenChange={open => { if (open) setOpened(true); }}>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={<ToolbarButton aria-label="Page history" className="wiki-shell-page-action page-action" data-test-id="page-history-trigger" />}
            >
              <History size={16} />
            </MenuTrigger>
          }
        />
        <TooltipContent className="reader-tooltip">Page history</TooltipContent>
      </Tooltip>
      <MenuContent align="end" aria-label="Page history" className="page-history-menu" data-test-id="page-history-menu" side="bottom" sideOffset={6}>
        {history.status === "loading" ? (
          <MenuItem className="wiki-shell-actions-item" disabled>Loading…</MenuItem>
        ) : history.status !== "ready" ? (
          <MenuItem className="wiki-shell-actions-item" disabled>History unavailable</MenuItem>
        ) : (
          <>
            <MenuItem
              className="wiki-shell-actions-item page-history-item"
              data-current={selected === null || undefined}
              data-test-id="page-history-current"
              render={<Link to={hrefWithVersion(location.pathname, location.search, null)} />}
            >
              <span className="page-history-label">Current version</span>
              <span className="page-history-meta">{formatVersionDate(history.data.current.updatedAt)}</span>
            </MenuItem>
            {history.data.versions.length ? <MenuSeparator className="wiki-shell-actions-separator" /> : null}
            {history.data.versions.map(version => (
              <MenuItem
                className="wiki-shell-actions-item page-history-item"
                data-current={selected === version.id || undefined}
                data-test-id="page-history-version"
                key={version.id}
                render={<Link to={hrefWithVersion(location.pathname, location.search, version.id)} />}
              >
                <span className="page-history-label">{formatVersionDate(version.versionAt)}</span>
                {version.commitMessage || version.title !== history.data.current.title ? (
                  <span className="page-history-meta">{version.commitMessage ?? version.title}</span>
                ) : null}
              </MenuItem>
            ))}
            {history.data.versions.length === 0 ? (
              <MenuItem className="wiki-shell-actions-item" disabled data-test-id="page-history-empty">No earlier versions</MenuItem>
            ) : null}
          </>
        )}
      </MenuContent>
    </Menu>
  );
}

export default PageHistoryMenu;
