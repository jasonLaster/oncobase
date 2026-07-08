import path from "path";

export function diagnosticsRootCandidates() {
  const envRoots = [
    process.env.DIANA_DIAGNOSTICS_PATH,
    process.env.ONCOBASE_DICOM_ROOT,
    process.env.DICOM_VIEWER_ROOT,
  ]
    .flatMap((value) => (value ? value.split(":") : []))
    .map((value) => value.trim())
    .filter(Boolean);

  const cwd = process.cwd();
  return [
    ...new Set([
      ...envRoots,
      path.resolve(cwd, "../diana-tnbc/diagnostics"),
      path.resolve(cwd, "../../diana-tnbc/diagnostics"),
      path.resolve(cwd, "../../../diana-tnbc/diagnostics"),
      path.resolve(cwd, "../../../../diana-tnbc/diagnostics"),
    ]),
  ];
}
