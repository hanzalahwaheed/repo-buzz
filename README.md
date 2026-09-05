# repoBuzz

**Find your people. Make your first pull request.**

An open-source field guide for developers looking for a community where they can contribute, learn, and grow. Explore an organization, narrow its repositories by language and activity, and open a dedicated repository page to understand the signals behind the code.

## Run locally

Requires Node.js 22.12+ (or a compatible newer version).

```sh
npm install
npm run dev
```

```sh
npm test       # data correctness, persistence, input validation, and mocked API regressions
npm run lint
npm run build
npm run preview
```

## Explore

- Enter a GitHub organization, `owner/repository`, or GitHub URL.
- Connect a fine-grained GitHub token with public repository access; no write permissions are required. Live GraphQL queries require authentication.
- Filter an organization by project name or language; archived projects and forks are hidden by default.
- Open a repository to see issue and PR activity, merge times, commit history, contributor activity, and links to beginner-friendly issues.
- Reopen **Saved explorations** without requesting the data again. Use **Refresh from GitHub** to update the snapshot.
- Try **Take a sample tour** without a token. `fieldnotes/garden` is an explicitly fictional, deterministic example, never saved as real GitHub data.

## Product and design

The interface uses a warm paper-and-sage palette, editorial serif headings, restrained charts, and a field-notes motif. It prioritizes questions new contributors can act on: where to start, whether changes get merged, and who participates. It intentionally avoids presenting a composite health score as a verdict on community quality.

Repository pages use hash URLs (`#/owner/repository`) with browser Back/Forward support. This works on static hosting without server rewrite rules. The chart code loads only when opening a repository or the sample tour. Charts include readable data-table alternatives for a fixed three-month period; the layout adapts to mobile and respects reduced-motion preferences.

## Accuracy and limitations

- Analysis covers the previous **three calendar months in UTC**, ending when fetching starts, with the exact dates displayed. Month-end subtraction is clamped (May 31 → February 28/29).
- Issue and PR connections are paginated in update-date order until the cutoff, without a 100-item or 1,000-search-result cap. Older items merged or closed during the period are included. Duplicate IDs are removed. Failed continuation requests reject the new bundle; incomplete issue/PR data is not saved as complete.
- Charts count creation, latest closure, and merge timestamps inside the period. Repeated close/reopen cycles are not a complete historical event log. GitHub can change while pagination is in progress.
- Merge rate is PRs merged during the period divided by PRs merged or closed without merge during the period. Median merge time uses creation-to-merge duration for that period’s merged PRs, including old PRs. This is not first-response time. Low resolved-PR counts receive a visible caution.
- Bot filtering applies consistently to issue/PR charts, period metrics, and participant counts. Participant counts cover authors of issues opened and PRs opened/merged, not all commenters/reviewers. Stars and available beginner-issue counts remain current repository totals.
- Commit charts clip GitHub daily statistics to the period (boundary days may be partial). Pending/unavailable statistics remain disclosed. The fallback follows commit pages across the same three-month range, and explicitly notes its different merge-commit/author-date semantics.
- Saved analyses keep their original date window. Old 100-item snapshots require an explicit refresh before showing the new analysis.
- Good-first-issue and help-wanted counts are separate: labels may overlap and are not added together.
- Activity is context, not a promise of maintainer responsiveness or a welcoming community.

References: [GitHub repository statistics](https://docs.github.com/en/rest/metrics/statistics), [personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens).

## Privacy and persistence

Tokens are held in React state only, cleared from the input after connecting, and sent directly to `https://api.github.com`. They are never written to local/session storage, query keys, or URLs. Disconnect cancels active queries and clears the query cache; request ETag caches are scoped to their API client instance. Reloading requires reconnecting.

The app queries public organization repositories and rejects private repository details. Public activity snapshots and search history are stored in versioned local-storage keys, bounded to 35 repository versions, 20 organization versions, and 200 history entries. Existing v1 snapshots remain readable. Invalid records and unavailable storage are handled defensively. If a save fails, fetched activity still displays with a warning. Saved explorations can be cleared from the app.

Local storage is device-local, not encrypted or synchronized. Any script running on this origin has the same browser-level access. For an OAuth-based hosted product, use a backend with secure, HttpOnly session cookies; do not persist access tokens in browser storage.

## Stack and verification

React 19, TypeScript, Vite, TanStack Query, Recharts. Regression tests run with Node’s test runner and Vite’s module loader, with mocked GitHub responses and storage. They cover merge-rate arithmetic, snapshot stability, bot filtering, search validation, persistence and quota failures, organization pagination, invalid API responses, and rejection of private repositories.

Live authenticated GitHub fetching requires a user-supplied token; the sample tour and mocked API tests do not verify a particular account’s permissions.
