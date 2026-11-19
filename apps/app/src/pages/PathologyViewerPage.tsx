import { PathologyViewer } from "@oncobase/diagnostics/pathology";
import "./pathology-styles";
import { SpecialRouteMetadata } from "../shell/SpecialRouteMetadata";

export function PathologyViewerPage() {
  return <><SpecialRouteMetadata /><PathologyViewer /></>;
}
