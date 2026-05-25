export function readFlag(args: string[], name: string) {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

export function hasFlag(args: string[], name: string) {
  return args.includes(name);
}

export function requireFlag(args: string[], name: string, usage: string) {
  const value = readFlag(args, name);
  if (!value) {
    console.error(usage);
    process.exit(1);
  }
  return value;
}

export function siteTokenEnvName(site: string) {
  return `WIKI_PUBLISH_TOKEN_${site.toUpperCase().replace(/-/g, "_")}`;
}

