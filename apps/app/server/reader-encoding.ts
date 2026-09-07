export function acceptsGzip(header: string | null) {
  return (header ?? "").split(",").some(part => {
    const [name, ...parameters] = part.trim().toLowerCase().split(";");
    if (name !== "gzip") return false;
    const q = parameters.find(p => p.trim().startsWith("q="))?.trim().slice(2);
    return q === undefined || (Number.isFinite(Number(q)) && Number(q) > 0);
  });
}
