let runtimeHandlerPromise;

async function wikiViteApi(req, res) {
  const { default: runtimeHandler } = await (runtimeHandlerPromise ??= import(
    "../apps/wiki-vite/.vercel-functions/index.mjs"
  ));

  return runtimeHandler(req, res);
}

wikiViteApi.config = {
  maxDuration: 60,
};

module.exports = wikiViteApi;
