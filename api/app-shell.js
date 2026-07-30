let runtimeHandlerPromise;

async function wikiViteAppShell(req, res) {
  const { default: runtimeHandler } = await (runtimeHandlerPromise ??= import(
    "../apps/wiki-vite/.vercel-functions/root-app-shell.mjs"
  ));

  return runtimeHandler(req, res);
}

wikiViteAppShell.config = {
  maxDuration: 60,
};

module.exports = wikiViteAppShell;
