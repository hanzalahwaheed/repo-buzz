import type { RateLimitSnapshot } from '../types/github'

interface RateLimitIndicatorProps {
  restRateLimit?: RateLimitSnapshot
  graphRateLimit?: RateLimitSnapshot
  isAuthenticated: boolean
}

function formatResetTime(resetAt: string): string {
  const date = new Date(resetAt)

  if (Number.isNaN(date.getTime())) {
    return resetAt
  }

  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function renderRateLimitCard(title: string, snapshot?: RateLimitSnapshot) {
  if (!snapshot) {
    return (
      <article className="rate-card">
        <h3>{title}</h3>
        <p className="value">No calls yet</p>
      </article>
    )
  }

  const percentRemaining =
    snapshot.limit > 0
      ? Math.max(0, Math.round((snapshot.remaining / snapshot.limit) * 100))
      : 0

  return (
    <article className="rate-card">
      <h3>{title}</h3>
      <p className="value">
        {snapshot.remaining.toLocaleString()} / {snapshot.limit.toLocaleString()}
      </p>
      <p className="subtle">Resets {formatResetTime(snapshot.resetAt)}</p>
      {snapshot.cost !== undefined ? (
        <p className="subtle">Query cost: {snapshot.cost}</p>
      ) : null}
      <div className="meter-track" aria-hidden>
        <span
          className="meter-fill"
          style={{ width: `${percentRemaining}%` }}
        />
      </div>
      {percentRemaining <= 10 ? (
        <p className="warning">Low quota: below 10% remaining.</p>
      ) : null}
    </article>
  )
}

export function RateLimitIndicator({
  restRateLimit,
  graphRateLimit,
  isAuthenticated,
}: RateLimitIndicatorProps) {
  return (
    <section className="panel">
      <header className="panel-header">
        <h2>Rate limits</h2>
      </header>

      <div className="rate-grid">
        {renderRateLimitCard('REST', restRateLimit)}
        {renderRateLimitCard('GraphQL', graphRateLimit)}
      </div>

      {!isAuthenticated ? (
        <p className="warning">
          No token supplied. Unauthenticated mode is limited to 60 requests/hour.
        </p>
      ) : null}
    </section>
  )
}
