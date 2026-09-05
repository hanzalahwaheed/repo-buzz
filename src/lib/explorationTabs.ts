/** Open immediately from the user gesture so the result loads in its own tab. */
export function openExplorationTab(target: string): boolean {
  const url = new URL(window.location.href)
  url.search = ''
  url.hash = `/${target}`
  const child = window.open(url.href, '_blank')
  if (!child) return false
  child.opener = null
  return true
}
