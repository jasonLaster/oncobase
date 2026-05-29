const appDir = new URL("..", import.meta.url).pathname;

const outdir = `${appDir}/dist/.vercel-functions`;
const result = await Bun.build({
  entrypoints: [
    `${appDir}/api-runtime/index.ts`,
    `${appDir}/api-runtime/app-shell.ts`,
    `${appDir}/api-runtime/root-app-shell.ts`,
  ],
  outdir,
  target: "node",
  format: "esm",
  sourcemap: "external",
});

for (const log of result.logs) {
  const level = log.level === "error" ? "error" : "warn";
  console[level](log.message);
}

if (!result.success) {
  process.exit(1);
}

for (const name of ["index", "app-shell", "root-app-shell"]) {
  const source = `${outdir}/${name}.js`;
  const target = `${outdir}/${name}.mjs`;
  await Bun.write(target, Bun.file(source));
}
