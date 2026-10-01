import { PathologyViewer } from "@oncobase/diagnostics/pathology";
import { SpecialRouteMetadata } from "../shell/SpecialRouteMetadata";

export function PathologyViewerPage() {
  return <><SpecialRouteMetadata /><PathologyViewer /></>;
}
