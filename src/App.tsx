import { lazy, Suspense, useEffect, useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toUserMessage } from "./lib/githubError";
import { parseSearchTarget, GITHUB_TOKEN_REGEX } from "./lib/search";
import {
  listSearchHistory,
  appendSearchHistory,
  clearAllPersistedData,
} from "./lib/localStore";
import { openExplorationTab } from "./lib/explorationTabs";
import { fetchExploration, fetchLibraryStatus } from "./lib/libraryApi";
import { OrgView } from "./components/OrgView";
import { RateLimitIndicator } from "./components/RateLimitIndicator";
const RepositoryPage = lazy(() => import("./components/RepositoryPage"));

function routeTarget() {
  try {
    return decodeURIComponent(window.location.hash.slice(1)).replace(/^\//, "");
  } catch {
    return "invalid/route/value";
  }
}
function go(target: string) {
  window.location.hash = `/${target}`;
}

export default function App() {
  const [route, setRoute] = useState(routeTarget);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [history, setHistory] = useState(listSearchHistory);
  const status = useQuery({
    queryKey: ["library-status"],
    queryFn: ({ signal }) => fetchLibraryStatus(signal),
    refetchInterval: 60000,
    staleTime: 30000,
    refetchOnWindowFocus: true,
    retry: false,
  });
  useEffect(() => {
    const updateHistory = () => setHistory(listSearchHistory());
    const updateRoute = () => {
      setRoute(routeTarget());
      setError("");
      updateHistory();
      window.scrollTo(0, 0);
    };
    window.addEventListener("storage", updateHistory);
    window.addEventListener("focus", updateHistory);
    window.addEventListener("hashchange", updateRoute);
    return () => {
      window.removeEventListener("storage", updateHistory);
      window.removeEventListener("focus", updateHistory);
      window.removeEventListener("hashchange", updateRoute);
    };
  }, []);
  const openExploration = (target: string) => {
    if (!openExplorationTab(target)) go(target);
  };
  const recent = history.length
    ? history
        .filter(
          (entry, index) =>
            history.findIndex((other) => other.target === entry.target) ===
            index,
        )
        .slice(0, 4)
    : (status.data?.recent ?? []).slice(0, 4);
  const submit = (value: string) => {
    if (GITHUB_TOKEN_REGEX.test(value.trim())) {
      setSearch("");
      setError(
        "No personal token needed. Enter an organization or repository instead.",
      );
      return;
    }
    const parsed = parseSearchTarget(value);
    if (!parsed) {
      setError("Enter a GitHub organization, owner/repository, or GitHub URL.");
      return;
    }
    setError("");
    openExploration(
      parsed.type === "repo"
        ? `${parsed.value.owner}/${parsed.value.repo}`
        : parsed.value.org,
    );
  };
  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        Skip to content
      </a>
      <header className="topbar">
        <a className="brand" href="#/" aria-label="repoBuzz home">
          <span className="brand-mark">
            b<span>↗</span>
          </span>
          repo<span>Buzz</span>
          <small>THE OPEN-SOURCE FIELD GUIDE</small>
        </a>
        <nav aria-label="Main navigation">
          <a className={!route ? "nav-active" : ""} href="#/">
            Explore
          </a>
          <a className={route === "saved" ? "nav-active" : ""} href="#/saved">
            Saved explorations
          </a>
          <span className="connection">
            <i className={status.data?.configured ? "connected" : ""} />
            Shared library · {status.data?.cachedExplorations ?? "…"}{" "}
            explorations
          </span>
        </nav>
      </header>
      <main id="main-content" tabIndex={-1}>
        {!route ? (
          <>
            {
              <section className="connected-overview">
                <div>
                  <h1>Where will you contribute next?</h1>
                  <p>Explore once, learn together.</p>
                </div>
                <RateLimitIndicator
                  restRateLimit={status.data?.rates.rest}
                  graphRateLimit={status.data?.rates.graphql}
                  isAuthenticated={!!status.data?.configured}
                />
              </section>
            }
            <section className="hero hero-connected">
              <div className="hero-copy">
                <form
                  className="discovery-search"
                  onSubmit={(event) => {
                    event.preventDefault();
                    submit(search);
                  }}
                >
                  <label htmlFor="search">
                    Where are you curious to contribute?
                  </label>
                  <div>
                    <span aria-hidden="true">⌕</span>
                    <input
                      id="search"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Organization, owner/repo, or GitHub URL"
                      autoComplete="off"
                      spellCheck={false}
                      required
                    />
                    <button>
                      Find the buzz <span aria-hidden="true">↗</span>
                    </button>
                  </div>
                </form>
              </div>
            </section>
            {status.error && (
              <p className="notice">
                The shared library is temporarily unavailable. You can still
                take the <a href="#/demo">sample tour</a>.
              </p>
            )}
            {error && (
              <p className="notice" role="alert">
                {error}
              </p>
            )}
            {
              <section className="recent-explorations">
                <header className="section-heading">
                  <div>
                    <h2>
                      {history.length
                        ? "Recently explored"
                        : "From the shared library"}
                    </h2>
                  </div>
                  <a href="#/saved">View your history →</a>
                </header>
                {recent.length ? (
                  <div className="recent-grid">
                    {recent.map((entry) => (
                      <a
                        key={entry.target}
                        href={`#/${entry.target}`}
                        target="_blank"
                        onClick={(event) => {
                          event.preventDefault();
                          openExploration(entry.target);
                        }}
                      >
                        <span className="eyebrow">
                          {entry.kind === "repo"
                            ? "REPOSITORY"
                            : "ORGANIZATION"}
                        </span>
                        <h3>{entry.target} ↗</h3>
                        <p>
                          Explored{" "}
                          {new Date(entry.fetchedAt).toLocaleDateString()}
                        </p>
                      </a>
                    ))}
                  </div>
                ) : (
                  <p className="subtle">
                    Your explorations will appear here. Search above or choose a
                    suggestion below.
                  </p>
                )}
              </section>
            }
            <section className="discovery-section">
              <header className="section-heading">
                <div>
                  <h2>A few places to start</h2>
                </div>
                <p>Pick an ecosystem. Explore its community.</p>
              </header>
              <div className="ecosystem-grid">
                {[
                  [
                    "01",
                    "withastro",
                    "Build for the web",
                    "Frameworks, documentation, and the tools behind better websites.",
                    "ASTRO / WEB DEVELOPMENT",
                    "↗",
                  ],
                  [
                    "02",
                    "pallets",
                    "Make Python useful",
                    "Small, focused libraries powering a world of Python applications.",
                    "PALLETS / PYTHON",
                    "⌘",
                  ],
                  [
                    "03",
                    "cli",
                    "Craft developer tools",
                    "Explore the command line and the tools developers use every day.",
                    "GITHUB CLI / TOOLING",
                    ">_",
                  ],
                ].map(([n, org, title, description, tag, icon]) => (
                  <a
                    className="ecosystem-card"
                    key={org}
                    href={`#/${org}`}
                    target="_blank"
                    onClick={(event) => {
                      event.preventDefault();
                      openExploration(org);
                    }}
                  >
                    <div className="ecosystem-top">
                      <span>{n}</span>
                      <span>{icon}</span>
                    </div>
                    <p className="eyebrow">{tag}</p>
                    <h3>{title}</h3>
                    <p>{description}</p>
                    <span className="text-link">
                      Explore {org} <b>↗</b>
                    </span>
                  </a>
                ))}
              </div>
            </section>
            <section className="reading-guide">
              <p className="eyebrow">LOOK BEYOND THE STAR COUNT</p>
              <div>
                <article>
                  <h3>Is the project moving?</h3>
                  <p>
                    Look for consistent activity and recent merged pull
                    requests.
                  </p>
                </article>
                <article>
                  <h3>Where can you help?</h3>
                  <p>
                    Start with good first issues and read the contribution
                    guidelines.
                  </p>
                </article>
                <article>
                  <h3>Who will you learn with?</h3>
                  <p>
                    Explore contributors, then read conversations to understand
                    the culture.
                  </p>
                </article>
              </div>
            </section>
          </>
        ) : route === "saved" ? (
          <SavedPage onOpen={openExploration} />
        ) : (
          <ExplorePage key={route} route={route} onOpen={openExploration} />
        )}
      </main>
      <footer>
        <a className="brand" href="#/">
          repo<span>Buzz</span>
        </a>
        <p>Find a community. Start small. Keep showing up.</p>
        <a href="#/demo">How to read the signals ↗</a>
      </footer>
    </div>
  );
}

function SavedPage({ onOpen }: { onOpen: (target: string) => void }) {
  const [history, setHistory] = useState(listSearchHistory);
  const queryClient = useQueryClient();
  const seen = new Set<string>();
  const unique = history.filter((entry) => {
    if (seen.has(entry.target)) return false;
    seen.add(entry.target);
    return true;
  });
  return (
    <section className="page-section">
      <p className="eyebrow">YOUR FIELD NOTES</p>
      <div className="section-heading">
        <h1>Saved explorations</h1>
        <button
          className="ghost"
          disabled={!history.length}
          onClick={() => {
            clearAllPersistedData();
            queryClient.clear();
            setHistory([]);
          }}
        >
          Clear my history
        </button>
      </div>
      <p className="subtle">
        Your history stays on this device. Activity comes from the shared
        database; clearing history does not delete community snapshots.
      </p>
      {unique.length ? (
        <div className="saved-list">
          {unique.map((entry) => (
            <a
              key={entry.target}
              href={`#/${entry.target}`}
              target="_blank"
              onClick={(event) => {
                event.preventDefault();
                onOpen(entry.target);
              }}
            >
              <span>
                <small>
                  {entry.kind === "repo" ? "REPOSITORY" : "ORGANIZATION"}
                </small>
                <strong>{entry.target}</strong>
              </span>
              <time>{new Date(entry.fetchedAt).toLocaleString()}</time>
              <span>Open exploration ↗</span>
            </a>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <span>⌑</span>
          <h2>Your next discovery belongs here.</h2>
          <p>
            Explore a repository or organization to save your first snapshot.
          </p>
          <a className="button-link" href="#/">
            Explore communities ↗
          </a>
        </div>
      )}
    </section>
  );
}

function ExplorePage({
  route,
  onOpen,
}: {
  route: string;
  onOpen: (target: string) => void;
}) {
  const target = parseSearchTarget(route);
  const isRepo = target?.type === "repo";
  const isDemo = route === "demo";
  const [showForks, setShowForks] = useState(false);
  const refreshRequested = useRef(false);
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["exploration", route],
    enabled: !isDemo && !!target,
    staleTime: 60000,
    retry: false,
    queryFn: async ({ signal }) => {
      const refresh = refreshRequested.current;
      refreshRequested.current = false;
      const result = await fetchExploration(route, signal, refresh);
      const data = result.data;
      appendSearchHistory({
        kind: data.kind,
        target: data.target,
        snapshotId: data.id,
        fetchedAt: data.fetchedAt,
        source: "network",
      });
      void queryClient.invalidateQueries({ queryKey: ["library-status"] });
      return result;
    },
  });
  const data = query.data?.data;
  if (!target && !isDemo)
    return (
      <div className="empty-state">
        <h1>That exploration could not be found.</h1>
        <a href="#/">Return to explore</a>
      </div>
    );
  return (
    <section className="page-section">
      <div className="breadcrumb">
        <a href="#/">Explore</a>
        <span>/</span>
        <span>{isDemo ? "Sample exploration" : route}</span>
      </div>
      <div className="page-toolbar">
        <span className="eyebrow">
          {isDemo
            ? "ILLUSTRATIVE DATA · NOT A LIVE REPOSITORY"
            : isRepo
              ? "REPOSITORY FIELD NOTES"
              : "ORGANIZATION FIELD NOTES"}
        </span>
        {!isDemo && (
          <button
            className="ghost"
            disabled={query.isFetching}
            onClick={() => {
              refreshRequested.current = true;
              void query.refetch();
            }}
          >
            {query.isFetching ? "Fetching activity…" : "Refresh activity ↻"}
          </button>
        )}
      </div>
      {!isDemo && data && (
        <p className="freshness">
          {query.data?.source === "github"
            ? "Freshly fetched and saved to the shared library"
            : query.data?.source === "stale"
              ? "Last saved shared snapshot"
              : "Loaded from the shared database · no GitHub fetch needed"}{" "}
          · Fetched {new Date(data.fetchedAt).toLocaleString()}. Automatic
          refresh after {new Date(query.data!.expiresAt).toLocaleString()}.
          Manual refresh available after{" "}
          {new Date(query.data!.refreshAfter).toLocaleTimeString()}.
        </p>
      )}
      {query.data?.warning && <p className="notice">{query.data.warning}</p>}
      {query.error && (
        <div className="notice" role="alert">
          <p>{toUserMessage(query.error, { target: route })}</p>
          <a href="#/">Back to explorations</a> ·{" "}
          <a href="#/demo">Try the sample tour</a>
        </div>
      )}
      {query.isFetching && !query.data && (
        <div className="empty-state" role="status">
          <div className="loading-bar" />
          <h2>Listening for the buzz…</h2>
          <p>
            Checking the shared library, then collecting any needed GitHub
            activity for the past three months. Busy projects can take longer.
            GitHub may take a moment to prepare statistics.
          </p>
        </div>
      )}
      {(isRepo || isDemo) && (data?.kind === "repo" || isDemo) && (
        <Suspense fallback={<p role="status">Opening field notes…</p>}>
          <RepositoryPage
            bundle={data?.kind === "repo" ? data.bundle : undefined}
          />
        </Suspense>
      )}
      {!isRepo && !isDemo && data?.kind === "org" && (
        <OrgView
          orgName={route}
          repos={
            showForks ? data.repos : data.repos.filter((repo) => !repo.isFork)
          }
          loading={false}
          fetching={query.isFetching}
          progress={null}
          showForks={showForks}
          onToggleForks={setShowForks}
          selectedRepo={null}
          onSelectRepo={(repo) => onOpen(repo.nameWithOwner)}
        />
      )}
    </section>
  );
}
