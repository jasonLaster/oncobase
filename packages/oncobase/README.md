# `@oncobase/oncobase`

Official Oncobase CLI for syncing, checking, and publishing Obsidian vaults.

```sh
npm install --save-dev @oncobase/oncobase
```

Configure a vault once:

```sh
npx oncobase init --site acme --vault . --publish-url https://wiki.example.com/api/publish
```

Then run the publish workflow from the vault:

```sh
npx oncobase sync --site acme
npx oncobase check --site acme
npx oncobase publish --site acme
```

The publish token can be provided with `WIKI_PUBLISH_TOKEN_<SITE>`, `WIKI_PUBLISH_TOKEN`, or `~/.config/wiki/<site>.token`.
