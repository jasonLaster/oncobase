export function canAccessWithoutProtectedRule({
  documentExists,
  sensitive,
}: {
  documentExists: boolean;
  sensitive: boolean;
}) {
  return documentExists && !sensitive;
}
