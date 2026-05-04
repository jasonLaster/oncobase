This is a Next.js 16 app-router project managed with Bun.

## Getting Started

Install dependencies from the workspace root:

```bash
cd ..
bun install
cd web
```

Run the development server:

```bash
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

By default, the dev app reads from the production Convex deployment
(`https://youthful-cricket-560.convex.cloud`) so local UI iteration uses the
same data shape as production. To point at a different Convex deployment, set
`NEXT_PUBLIC_CONVEX_URL`. To fully disable Convex reads, set
`NEXT_PUBLIC_USE_PROD_CONVEX=0`.

If you need to run the local Convex dev deployment as well:

```bash
bun run dev:local-convex
```

## Testing

Run the local Playwright suite:

```bash
bun run test
```

Run the same suite on Endform:

```bash
bun x endform login
bun run test:endform
```

Endform currently requires Node 22+.

`bun run test:endform` uses the Playwright `webServer` config, so Endform can automatically proxy your local `http://localhost:3000` app to the remote runners.

To target a deployed preview instead of a local server:

```bash
TEST_ENV=prod PROD_URL=https://your-preview-url.vercel.app bun run test:endform
```

The GitHub preview workflow now expects these repository secrets:

- `ENDFORM_API_KEY`
- `VERCEL_AUTOMATION_BYPASS_SECRET`

You can start editing the app in `src/app`. The page auto-updates as you edit the file.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
