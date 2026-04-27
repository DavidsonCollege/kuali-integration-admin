# Kuali Integration Admin

A client-side dashboard for browsing and analyzing Kuali Build integrations and the apps that consume them.

## What it does

Drill-down navigation, on demand:

1. **Connect** — paste your Kuali Build URL and a personal API token. Both stay in `localStorage`; nothing leaves the browser except calls relayed through a thin local proxy to your own Kuali instance.
2. **Browse integrations** — searchable list aggregated across every space your token can read. Cached after the first fetch, with a manual Refresh button and a "last refreshed" indicator so staleness stays visible.
3. **Inspect an integration** — see which apps use it, how it's shared, what space it lives in.
4. **Inspect an app** — see published status, submission counts, last-touched dates, and run an introspection that walks the form schema and workflow JSON for integration uses.

## Setup

```bash
npm install
npm run dev
```

Dev server runs at `http://localhost:3000`. On first load you'll be asked for your Kuali tenant URL (e.g. `https://your-tenant.kualibuild.com`) and an API token.

### Generating an API token

In Kuali Build: profile settings → API Tokens. Create a personal token with read-only scopes for the data this app shows. Revoke it from Kuali if you suspect it's leaked.

## Theming

Colors and fonts are configured in a single file at the project root:

- **`theme.config.js`** — semantic color tokens (`accent`, `ink`, `muted`, `subtle`, `rule`, `surface`) and font-family strings. Defaults are Davidson College's palette and typography; override any field to rebrand. The file is commented; restart the dev server after editing because Tailwind reads it at build time.

To drop the Google Fonts dependency entirely, set `googleFontsHref: null` in `theme.config.js` and use system font stacks (e.g. `'system-ui, sans-serif'`) in `fonts.*`.

## Architecture notes

- **Client-rendered (`ssr: false`).** All UI runs in the browser; pages don't render server-side.
- **Nitro proxy** at `server/api/graphql.post.js` forwards GraphQL calls to Kuali. It exists strictly because Kuali Build's GraphQL endpoint doesn't return CORS headers for browser origins. If your tenant ever does, the proxy can be removed and the client can call Kuali directly.
- **No backend state.** The proxy is stateless — it forwards the user's bearer token and target endpoint, validates the host is `*.kualibuild.com`, and returns the response.

Because of the Nitro proxy this app needs a runtime to deploy (Node, Cloudflare Workers, Netlify Functions, etc.). It is not deployable as pure static HTML/JS without removing the proxy or moving the GraphQL call elsewhere.

## Project structure

See [CLAUDE.md](CLAUDE.md) for the architectural decisions and [TODO.md](TODO.md) for what's left to build.
