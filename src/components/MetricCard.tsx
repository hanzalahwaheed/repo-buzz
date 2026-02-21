interface MetricCardProps {
  title: string
  value: string
  hint?: string
}

export function MetricCard({ title, value, hint }: MetricCardProps) {
  return (
    <article className="metric-card">
      <h3>{title}</h3>
      <p className="metric-value">{value}</p>
      {hint ? <p className="subtle">{hint}</p> : null}
    </article>
  )
}
