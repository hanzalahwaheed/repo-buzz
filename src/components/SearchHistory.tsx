import type { PersistedSearchHistoryEntry } from '../types/storage'

interface SearchHistoryProps {
  history: PersistedSearchHistoryEntry[]
  onOpen: (entry: PersistedSearchHistoryEntry) => void
  onRemove: (entryId: string) => void
  onClear: () => void
  onClearAllPersistedData: () => void
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function SearchHistory({
  history,
  onOpen,
  onRemove,
  onClear,
  onClearAllPersistedData,
}: SearchHistoryProps) {
  return (
    <section className="panel">
      <header className="panel-header">
        <h2>Search history</h2>
        <div className="header-actions">
          <button
            type="button"
            className="ghost"
            onClick={onClear}
            disabled={history.length === 0}
          >
            Clear list
          </button>
          <button
            type="button"
            className="ghost"
            onClick={onClearAllPersistedData}
          >
            Clear stored snapshots
          </button>
        </div>
      </header>

      {history.length === 0 ? (
        <p className="subtle">No searches yet.</p>
      ) : (
        <div className="history-list">
          {history.map((entry) => (
            <article key={entry.id} className="history-item">
              <div>
                <p className="history-target">{entry.target}</p>
                <p className="subtle">
                  {entry.kind.toUpperCase()} | searched {formatDate(entry.searchedAt)} | version {formatDate(entry.fetchedAt)}
                  {' '}| source {entry.source}
                </p>
              </div>
              <div className="history-actions">
                <button type="button" onClick={() => onOpen(entry)}>
                  Open in new tab
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => onRemove(entry.id)}
                >
                  Remove
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
