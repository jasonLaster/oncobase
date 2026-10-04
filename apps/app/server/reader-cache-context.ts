export const READER_CONTEXT_HEADER = "x-wiki-reader-context";
export const READER_VERSION_HEADER = "x-wiki-reader-version";

export function isInternalReaderPath(pathname: string) {
  try { return decodeURIComponent(pathname).toLowerCase().startsWith("/__reader/"); }
  catch { return true; }
}
