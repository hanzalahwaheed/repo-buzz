export interface AnalysisWindow {
  version: 2
  start: string
  end: string
}

/** Three calendar months, clamped at month ends, in UTC. */
export function threeMonthWindow(end: string): AnalysisWindow {
  const start = new Date(end)
  const day = start.getUTCDate()
  start.setUTCDate(1)
  start.setUTCMonth(start.getUTCMonth() - 3)
  const lastDay = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0),
  ).getUTCDate()
  start.setUTCDate(Math.min(day, lastDay))
  return { version: 2, start: start.toISOString(), end }
}

export function inWindow(
  value: string | null,
  window: AnalysisWindow,
): boolean {
  if (!value) return false
  const time = Date.parse(value)
  return time >= Date.parse(window.start) && time <= Date.parse(window.end)
}
