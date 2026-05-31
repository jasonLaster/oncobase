# API Shim

This directory contains root-level Vercel API metadata used by the repository deployment shape.

The production application code lives in [`../apps/web`](../apps/web/README.md), and the standalone Vite reader builds its Vercel functions from [`../apps/wiki-vite`](../apps/wiki-vite/README.md). Keep new application routes in the owning app unless the root Vercel configuration specifically requires a shim here.
