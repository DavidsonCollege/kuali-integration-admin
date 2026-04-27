# Kuali Integration Admin — Workspace Context

## Read this first
**`TODO.md`** is the authoritative list of what's done and what's next. Re-read it at the start of every session.

This project is the **integration management dashboard** for the Kuali Days 2026 talk. It's the talk's tooling centerpiece — proof that atomic integrations need atomic tooling. See `../EXECUTION_PLAN.md` §4 for how it fits into the talk.

## What this app is
A client-side-rendered Nuxt 3 app for browsing and analyzing Kuali Build integrations and the apps that consume them. The user enters a Kuali API token on first load (stored in localStorage), then drills down: integrations list → integration detail (apps using it) → app detail → introspect.

All UI runs in the browser. There's a thin Nitro server route (`server/api/graphql.post.js`) that proxies GraphQL calls to Kuali — this exists only because Kuali Build's GraphQL endpoint doesn't return CORS headers for browser origins, so the SPA can't call it directly. The proxy is request-shaped and stateless: no caching, no transformation, just origin-laundering.

## What this app is *not*
- Not a dashboard. No charts, no global metrics, no "fleet view." Drill-down only.
- Not a bulk downloader. The 2022 `kuali-build-report` repo pre-cached *everything*. This one fetches on demand. Don't reintroduce that pattern.
- Not server-rendered. SSR is disabled — pages render client-side. The Nitro proxy is the only server-side code, and it only forwards GraphQL.
- Not statically deployable as a pure HTML/JS bundle. The Nitro proxy needs a runtime (Node, Cloudflare Workers, Netlify Functions, etc.). For the demo we run `npm run dev` locally, which is enough.
- Not authenticated. The user supplies their own API token; nothing leaves the browser except calls relayed through the proxy to *their* Kuali instance.

## Architecture decisions (don't relitigate)
- **Nuxt 3 + Vue 3 Composition API + Tailwind 3.** Modern stack; no migration debt.
- **Client-side rendering (`ssr: false`) + a Nitro GraphQL proxy.** Pages render in the browser; the only server-side code is `server/api/graphql.post.js`, which exists strictly to dodge Kuali's CORS posture. If Kuali ever enables browser-origin CORS, the proxy can be deleted and the client can call Kuali directly.
- **Theme tokens via `theme.config.js`.** Semantic colors (`accent`, `ink`, `muted`, `subtle`, `rule`, `surface`) and font-family strings live in one file at the project root. Tailwind reads them via `tailwind.config.js`; Nuxt reads `googleFontsHref` from the same file. Components reach for `text-accent` / `text-muted` / `bg-surface` / `font-serif`, never raw hex codes. Defaults are Davidson College's palette but the abstraction is brand-agnostic.
- **`graphql-request` for API calls.** Same library the 2022 report used. Lightweight, no caching layer (deliberate — see "on demand" rule).
- **No global state library.** `useState` + composables are enough. If a feature genuinely needs Pinia, raise it for discussion before adding.

## Stack
| Layer | Choice | Why |
|-------|--------|-----|
| Framework | Nuxt 3 | First-class Vue 3, file-based routing, Nitro server routes when we need them (we needed exactly one) |
| UI | Tailwind 3 + semantic theme tokens | One config file (`theme.config.js`) drives colors + fonts; Davidson values are the defaults |
| Data | `graphql-request` | Tiny, no schema generation, fits "on-demand" pattern |
| State | Nuxt `useState` + composables | Sufficient for this scope |
| TS/JS | JavaScript | Lower friction; convert later if needed |

## Project structure

```
kuali-integration-admin/
├── CLAUDE.md                  ← You are here
├── TODO.md                    ← Read second; what's done and what's next
├── README.md                  ← End-user setup instructions
├── nuxt.config.ts             ← Nuxt config; SSR off, fonts loaded
├── tailwind.config.js         ← Reads tokens from theme.config.js
├── theme.config.js            ← Semantic colors + fonts (override here to rebrand)
├── package.json
├── .env.example               ← Default Kuali base URL only
├── app.vue                    ← Root component (just NuxtLayout/NuxtPage)
├── layouts/
│   └── default.vue            ← Header (with disconnect), main, footer
├── pages/
│   ├── index.vue              ← API key entry + integrations list
│   ├── integrations/
│   │   └── [id].vue           ← Integration detail; apps using it
│   └── apps/
│       └── [id].vue           ← App detail; introspect button
├── composables/
│   ├── useApiKey.js           ← localStorage-backed API key + base URL
│   ├── useGraphQL.js          ← `request(query, vars)` — POSTs to /api/graphql
│   └── useAppIntrospection.js ← Walks form schema (and eventually workflow) for integration uses
├── graphql/
│   └── queries.js             ← All GraphQL queries (adapted from kuali-build-report)
├── server/
│   └── api/
│       └── graphql.post.js    ← Nitro proxy: forwards GraphQL to Kuali (CORS workaround)
└── assets/
    └── css/
        └── main.css           ← Tailwind layers + base typography
```

## Useful references
- `../kuali-build-introspectionSchema.json` — full schema (type names only; field details require live introspection)
- `../kuali-bridge/knowledge/graphql-api.md` — known queries and mutation signatures
- `../EXECUTION_PLAN.md` — Kuali Days talk plan; §4 explains where this app sits
- `../gen-ai-collaboration-notes.md` — running log of API quirks, schema gotchas, GraphQL patterns; mine it for query shapes you can reuse

## How Claude should help

### Default posture
- **On-demand wins.** Fetch only what the current view needs, and only when the user has asked for it (page load, click, search). No background loaders, no speculative pre-fetching. Caching is allowed once a user has triggered a fetch — but only with explicit refresh control (button + visible "last refreshed" indicator) so staleness is never invisible. Currently: the integrations list page caches its fan-out result in `useState`, keyed by `baseUrl + apiKey`, and exposes a Refresh button.
- **Stay drill-down.** This app is a navigation tool, not a status page. If a feature feels dashboard-y, push back.
- **Keep selections lean.** GraphQL responses can grow large fast. Default to the smallest selection that answers the question; expand only when a feature needs it.
- **Theme tokens only.** New components reach for `text-accent`, `text-muted`, `bg-surface`, `font-serif`, etc. — not raw hex codes and not direct Tailwind defaults like `text-red-700`. If a needed role isn't in the token set (`accent` / `ink` / `muted` / `subtle` / `rule` / `surface`), surface it for discussion before adding a new token.

### When adding a new query
- Drop it in `graphql/queries.js` with a comment explaining what it answers
- If it takes pagination, follow the `{limit, skip, sort, query}` shape
- Test in the playground first; paste the response shape into a comment if it's non-obvious

### When adding a new page
- File-based routing — match the URL structure to the data model (`/integrations/[id]`, `/apps/[id]`, etc.)
- Bounce to `/` when no API key is present (see existing pages for the pattern)
- Use the `card`, `btn-primary`, `btn-secondary` component classes in `assets/css/main.css` rather than re-inventing styles

### When working on introspection
- The "introspect" feature on the app detail page is currently a stub
- Walk `app.formContainer.schema` for field references to integration output keys, and `app.workflow` for steps that consume integration responses
- See TODO.md for the implementation plan

### When in doubt
- Check `../gen-ai-collaboration-notes.md` for whether we've already learned something about the schema or API
- Check the Kuali playground for shape confirmation
- Don't guess at field names — half the entries in the gen-ai notes are about Claude guessing wrong

## File output conventions
- Save work in this folder. The whole project is portable.
- Don't commit `.env`, `.nuxt/`, `node_modules/`, `dist/`.
- No brand logos as image files in this project. Color + typography tokens via `theme.config.js` are the entire branding surface.
