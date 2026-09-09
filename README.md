# repoBuzz

**Find your people. Make your first pull request.**

A field guide for new open-source contributors. Discover organizations, inspect three months of activity, and find a community where you can learn and grow.

## Start locally

Requires **Node.js 22.13+**; Node 24 LTS is recommended. SQLite uses Node’s built-in `node:sqlite` module.

```sh
npm install
cp .env.example .env
# Set GITHUB_TOKEN in .env (server-side only), then:
npm run dev
```

The app runs at `http://localhost:5173`. The shared API runs at `http://127.0.0.1:3001`, proxied through Vite so browser requests stay on the app’s origin. The SQLite database is created automatically at `data/repobuzz.sqlite`.

The site owner configures one fine-grained GitHub token with public repository access and no write permissions. Restart the API after changing `.env`. Without the owner token, the sample tour and existing database entries remain available; uncached requests explain that a token is needed.

### Visitor tokens

A visitor may add their own fine-grained token on the settings page. The server prefers it over the shared token for that visitor's explorations, so those requests spend the visitor's quota and skip the shared refresh budget entirely. A visitor token also makes the site usable when the owner has configured no token at all.

The token is kept in the visitor's browser under `repobuzz.githubToken.v1` until they remove it. It is sent to the API in an `X-GitHub-Token` header, one request at a time, and forwarded to `api.github.com`. The server never logs it, never stores it, and builds a throwaway client per request so a visitor's rate limits stay out of the shared status. Header values are accepted only as `[A-Za-z0-9_]{20,255}`, the character set GitHub issues.

Visitor tokens cannot widen what the library stores. Every repository query rejects private repositories, and both organization queries are pinned to `privacy: PUBLIC`, so a visitor with broader access still cannot pull private data into the shared database.

```sh
npm test        # analytics, pagination, real SQLite persistence, shared caching, HTTP API
npm run lint
npm run build
npm start       # API and built frontend together, default port 3001
```

`npm run dev:web` and `npm run dev:api` can also run separately. `npm run preview` previews the built frontend and still requires the API process.

## Experience

- The homepage is an exploration desk: shared GitHub limits, recent explorations, and suggested communities. There is no visitor token form.
- Searches, suggestions, saved explorations, and organization repository selections open a new tab immediately. The new tab fetches from the shared API. If the browser blocks the tab, the current tab opens the exploration instead.
- Personal exploration history stays in local storage. Public activity is stored in the shared database. Clearing personal history does not remove shared data.
- The **sample tour** is a clearly labeled fictional dataset and is never inserted into the shared database.
- Repository pages show the data source, original fetch date, and refresh availability. The layout supports mobile, keyboard navigation, reduced motion, and chart data-table alternatives.

## Shared database and request savings

`ExplorationStore` in `server/database.ts` is the persistence boundary. Two stores implement it:

- `ExplorationDatabase` (`server/database.ts`) uses a local SQLite file. It is the default for local work and for the Docker image.
- `PostgresExplorationDatabase` (`server/postgresDatabase.ts`) uses Neon Postgres. It is selected when `DATABASE_URL` is set.

Both stores create:

- `organizations`: one row per normalized GitHub login, including repository-list JSON and fetch timestamp.
- `repositories`: one row per normalized `owner/repository`, including the complete analysis bundle and fetch timestamp, indexed by owner.

Primary keys are case insensitive. SQLite uses `COLLATE NOCASE`; Postgres stores the keys in lower case and compares with `lower()`. Inserts use parameterized statements; later fetches **upsert the same row**, rather than append duplicate records. The payload schema version prevents incompatible cache formats from being reused. WAL mode supports concurrent reads while updates are committed in SQLite.

`server/library.ts` checks this database before GitHub:

1. **Fresh row:** serve it immediately without fetching activity from GitHub.
2. **Missing or expired row:** fetch complete activity, upsert the row, then serve the persisted result.
3. **Simultaneous requests:** one in-flight fetch per target is shared across visitors.
4. **Refresh failure:** preserve the old row and return it with an explicit stale warning. Failed first-time fetches never create a complete-looking snapshot. Detected removed/private repositories are evicted instead of served stale.

Defaults are a **6-hour cache lifetime** and **5-minute manual-refresh cooldown**. Both are configurable in `.env`. An upstream refresh has a five-minute timeout. Two different explorations can fetch concurrently; the queue is bounded. A per-process hourly budget permits 50 upstream explorations globally and 10 per client address, while cached reads remain available. Repeated failed targets back off for one minute. Server restarts reset these in-memory protections; run one API instance with this SQLite configuration. Requests behind a reverse proxy share its client-address budget unless trusted-proxy handling is added deliberately.

The server retrieves only the commit statistics used by the UI, avoiding unused participation, code-frequency, and contributor-statistics requests. Rate-limit status is cached for five minutes independently of activity.

## Analysis window and limits

- Analysis covers the preceding **three calendar months in UTC**, ending at fetch start. Month-end subtraction is clamped. Saved results retain that window until refreshed.
- Issues and PRs are paginated by update date until the cutoff, with no 100-item or search-result cap. Older items closed or merged inside the period are included. Failed continuation pages reject the new bundle.
- Charts count creation, latest closure, and merge timestamps within the period. Repeated close/reopen cycles are not a full event log, and GitHub data can change during pagination.
- Merge rate is merged PRs divided by all PRs resolved in the period. Median merge time is creation-to-merge duration for those merged PRs, not first-response time. Low-volume results carry a caution.
- Bot filtering applies consistently to issue/PR metrics and participants. Participants are authors of issues opened and PRs opened/merged, not all reviewers or commenters. Current stars and beginner-issue counts retain their original scope.
- Commit statistics use default-branch daily buckets; boundary days can be partial. A disclosed fallback can use paginated three-month commit history with different merge-commit and author-date semantics.
- Activity is evidence to investigate, not a verdict on community quality.

## Deploy as one shared service

Build the frontend and run `npm start` on a Node server with persistent storage. Set `HOST=0.0.0.0` when required by your host, and route traffic to `PORT`. Keep `GITHUB_TOKEN` in your host’s secret environment configuration, never in a `VITE_` variable.

A Docker recipe is included:

```sh
docker build -t repobuzz .
docker run --env-file .env -e HOST=0.0.0.0 -e DATABASE_PATH=/data/repobuzz.sqlite \
  -p 3001:3001 -v repobuzz-data:/data repobuzz
```

Use a persistent disk/volume and back up the database with a SQLite-aware backup tool. An ephemeral filesystem loses the shared cache across restarts.

## Deploy on Vercel with Neon

The `api/` directory holds the same three endpoints as Vercel functions. They use the Postgres store, because a Vercel function has an ephemeral filesystem.

```sh
vercel login
vercel link
vercel integration add neon    # sets the connection string on the project
vercel env add GITHUB_TOKEN    # production, preview, development
vercel deploy --prod
```

The connection string is read from `DATABASE_URL`, or from `POSTGRES_URL` if the first is absent. The Neon integration sets both names.

Relative imports in `api/`, `server/`, `src/lib/`, and `src/types/` carry an explicit `.js` extension. Vercel transpiles each function file separately instead of bundling it, and this package is an ES module, so Node needs the extension to resolve the import at runtime. Vite and `tsx` accept either form. Do not remove these extensions.

The store creates its tables on first use, so no migration step is needed. To run the same setup locally, put the connection string in `.env` and start the server as usual; `npm run dev` then uses Neon instead of SQLite.

Note one behavior change. The in-memory protections in `server/library.ts` — the hourly request budget, the failure back-off, and in-flight deduplication — are per instance. One Node server shares them across all visitors. Vercel runs several instances, so each instance keeps its own budget and the effective global limit rises with instance count. The shared database cache still works across all instances, which is what saves most GitHub requests.

The server serves static files only from `dist`; `.env`, source, and database files are not exposed. Visitors cannot upload arbitrary snapshots or supply a GitHub token to the API. Public data is shared across users; no private repositories are intentionally cached. A previously public repository can remain cached until revalidation discovers an access change.

## API

- `GET /api/status`: cache count, recent shared entries, connection availability, and cached API limits. Never returns credentials.
- `GET /api/explorations?target=owner/repo`: read-through cached exploration (organization names also accepted).
- `POST /api/explorations?target=owner/repo`: refresh subject to cooldown, with `Content-Type: application/json`. No request body is needed. Cross-site browser requests are rejected.
- `POST /api/token-check`: checks the `X-GitHub-Token` header against GitHub and returns the quota it carries. No request body is needed.

Both `/api/explorations` methods accept an optional `X-GitHub-Token` header. When present, it replaces the shared token for that request.

## Verification

Tests use real temporary SQLite databases and mocked GitHub responses. They cover date boundaries, pagination beyond 100 items, bot filtering, cache hits across visitors, concurrency deduplication, refresh/cooldown behavior, stale fallback, private-data eviction, persistence across reopening, request budgets, and the HTTP interface. Live GitHub verification requires the owner’s server token.

References: [Node SQLite](https://nodejs.org/api/sqlite.html), [GitHub pagination](https://docs.github.com/en/graphql/guides/using-pagination-in-the-graphql-api), [GitHub statistics](https://docs.github.com/en/rest/metrics/statistics).
