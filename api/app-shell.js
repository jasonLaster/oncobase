let runtimeHandlerPromise;

async function wikiViteAppShell(req, res) {
  const { default: runtimeHandler } = await (runtimeHandlerPromise ??= import(
    "../apps/app/.vercel-functions/root-app-shell.mjs"
  ));

  return runtimeHandler(req, res);
}

wikiViteAppShell.config = {
  maxDuration: 60,
};

module.exports = wikiViteAppShell;
