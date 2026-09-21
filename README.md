# Links

A personal read-it-later app built entirely on Cloudflare's infrastructure. Save URLs, read clean article extracts, and get AI-generated summaries — all running serverless at the edge.

## Features

- **Save links** via the web UI, the `/add` bookmarklet endpoint, or the MCP API
- **JS-rendered extraction** — uses [Kitesurf](https://developers.cloudflare.com/browser-run/kitesurf/) (Cloudflare Browser Run) to fetch fully-rendered HTML, so SPAs and JS-heavy pages work correctly
- **Clean article view** — `AI.toMarkdown` with CSS selector scoping strips nav/menus/footers; noise filter removes link-only blocks before storage
- **AI summaries** — Llama 3.3 70B via Workers AI produces a one-sentence TL;DR + key takeaways
- **Metadata extraction** — Open Graph, Twitter Card, favicon, author, publication date via `HTMLRewriter`
- **Reading time** estimates (prose at 238 WPM, code at 80 WPM)
- **Tags, starring, bulk actions** — select multiple links and mark read, star, re-summarize, or delete
- **Search & filters** — full-text search across title, URL, summary, and tags; filter by status, starred, failed
- **MCP endpoint** at `/mcp` — expose your library to any MCP-compatible AI agent
- **PWA** — installable on iOS and Android, offline shell via service worker
- **Dark/light mode** with system preference detection

## Stack

| Layer | Technology |
|---|---|
| Runtime | Cloudflare Workers (TypeScript) |
| Frontend | React 19, Tailwind CSS v4, `@cloudflare/kumo` |
| Database | Cloudflare D1 (SQLite) |
| AI | Cloudflare Workers AI (`llama-3.3-70b-instruct-fp8-fast`, `AI.toMarkdown`) |
| Browser | Cloudflare Browser Run / Kitesurf |
| Queue | Cloudflare Queues |
| Assets | Cloudflare Static Assets |
| MCP | `@modelcontextprotocol/server` v2 via `agents` SDK |

## Project structure

```
├── src/                    # Worker (backend)
│   ├── index.ts            # Entry point — routing, queue consumer
│   ├── mcp.ts              # MCP server (6 tools)
│   ├── routes/
│   │   └── links.ts        # REST API handlers
│   ├── services/
│   │   ├── processor.ts    # Orchestrates fetch → extract → summarize → store
│   │   ├── metadata.ts     # HTMLRewriter-based OG/meta extraction
│   │   ├── scraper.ts      # AI.toMarkdown with selector scoping + noise filter
│   │   └── summarizer.ts   # Llama summarization + prepareArticle noise filter
│   └── utils/
│       ├── constants.ts
│       ├── html.ts
│       └── reading-time.ts
├── web/                    # Frontend (React SPA — built into public/)
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   └── lib/
│   └── index.html
├── public/                 # Static assets served by Cloudflare
│   ├── index.html
│   ├── manifest.json
│   ├── sw.js               # Service worker (offline shell)
│   ├── favicon.svg / .ico
│   └── *.png               # App icons (192, 512, apple-touch)
├── migrations/             # D1 SQL migrations
├── scripts/
│   └── resummarize-all.mjs # Admin script: bulk re-summarize via Queues API
├── wrangler.toml
└── package.json
```

## Local development

### Prerequisites

- Node.js 20+
- A Cloudflare account with Workers, D1, Queues, Workers AI, and Browser Run enabled
- `wrangler` CLI authenticated (`npx wrangler login`)

### First-time setup

```bash
# Install dependencies
npm install

# Create the D1 database
npm run db:create
# Copy the database_id printed to wrangler.toml

# Apply migrations locally
npm run db:migrate

# Create the processing queue
npm run queue:create
```

### Running locally

```bash
npm run dev
```

This builds the frontend with Vite and starts `wrangler dev`. The app is available at `http://localhost:8787`.

> **Note:** Browser Run (Kitesurf) and Workers AI always run remotely even in local dev. The `[browser]` binding has `remote = true` in `wrangler.toml` for this reason.

### Local secrets

Create `.dev.vars` (not committed) for any local overrides:

```
ENVIRONMENT=development
```

## Deployment

### First-time

```bash
# Apply migrations to the remote database
npm run db:migrate:remote

# Build and deploy
npm run deploy
```

### Subsequent deploys

```bash
npm run deploy
```

## Configuration

All infrastructure is declared in `wrangler.toml`. Before deploying to your own account:

1. Replace `database_id` under `[[d1_databases]]` with your own D1 database ID
2. Update `[[routes]]` with your own domain (or remove it to use the `.workers.dev` subdomain and set `workers_dev = true`)
3. Remove or update `[env.development]` as needed

No secrets or API tokens are needed in config — authentication is delegated to Cloudflare Access at the network level.

## API

All endpoints are under `/api/` and are CORS-enabled.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/links` | List links — params: `status`, `search`, `tag`, `starred`, `failed`, `limit`, `offset` |
| `POST` | `/api/links` | Save a new link `{ url, title? }` |
| `GET` | `/api/links/:id` | Get a single link |
| `PUT` | `/api/links/:id` | Update `{ status?, title?, starred?, tags? }` |
| `DELETE` | `/api/links/:id` | Delete a link |
| `POST` | `/api/links/:id/reprocess` | Re-fetch and reprocess a link |
| `POST` | `/api/links/bulk` | Bulk action on multiple IDs |
| `GET` | `/api/tags` | List tags with usage counts |
| `GET` | `/api/stats` | Aggregate counts |
| `GET` | `/api/export` | Download all links as JSON |

### Bookmarklet endpoint

`GET /add?url=<encoded-url>` — saves a link and returns a self-closing HTML confirmation page. Useful as a browser bookmarklet:

```javascript
javascript:void(window.open('https://your-domain.com/add?url='+encodeURIComponent(location.href)))
```

## MCP endpoint

The app exposes an MCP server at `/mcp` (Streamable HTTP transport) using [`@modelcontextprotocol/server`](https://www.npmjs.com/package/@modelcontextprotocol/server) v2.

### Tools

| Tool | Description |
|---|---|
| `search_links` | Full-text search + filter by status, tag, starred |
| `get_link` | Fetch a link with full article markdown and AI summary |
| `save_link` | Save a new URL (triggers background processing) |
| `list_tags` | List all tags with usage counts |
| `update_link` | Mark read/unread, star/unstar, replace tags |
| `delete_link` | Permanently delete a link |

### Connecting

Add to your MCP client config (e.g. Claude Desktop, OpenCode):

```json
{
  "mcp": {
    "links": {
      "type": "http",
      "url": "https://your-domain.com/mcp"
    }
  }
}
```

The endpoint is protected by Cloudflare Access. Desktop MCP clients that cannot complete the browser OAuth flow will need a [Cloudflare Access service token](https://developers.cloudflare.com/cloudflare-one/identity/service-tokens/) passed as `CF-Access-Client-Id` / `CF-Access-Client-Secret` headers.

## Processing pipeline

```
User saves URL
  └─ D1 INSERT (status = unread)
  └─ LINK_QUEUE.send({ linkId })
        │
        ▼  (Cloudflare Queue consumer, up to 3 concurrent)
  processor.ts
    ├─ Browser Run / Kitesurf → fully JS-rendered HTML
    ├─ [parallel]
    │   ├─ HTMLRewriter → OG/meta/favicon extraction
    │   └─ AI.toMarkdown (article selector → fallback full page)
    │       └─ prepareArticle() noise filter
    ├─ Llama 3.3 70B → AI summary
    ├─ calculateReadingTime()
    └─ D1 batch update
```

## Database schema

See [`migrations/`](migrations/) for the full SQL. Key tables:

- **`links`** — all link data including extracted content and AI summary
- **`link_tags`** — many-to-many tag associations
- **`processing_queue`** — tracks async job status and retry count

## Admin scripts

```bash
# Re-summarize all links that have article content (uses Queues API directly)
npm run resummarize
```

## License

MIT
