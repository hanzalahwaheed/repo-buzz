import type { FormEvent } from 'react'

import { GITHUB_TOKEN_REGEX } from '../hooks/useRepoBuzzQueries'

interface SearchBarProps {
  value: string
  onChange: (value: string) => void
  onSubmit: (value: string) => void
  onLoadSaved: (value: string) => void
  onTokenDetected: (token: string) => void
  loading: boolean
}

export function SearchBar({
  value,
  onChange,
  onSubmit,
  onLoadSaved,
  onTokenDetected,
  loading,
}: SearchBarProps) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = value.trim()

    if (!trimmed) {
      return
    }

    if (GITHUB_TOKEN_REGEX.test(trimmed)) {
      onTokenDetected(trimmed)
      return
    }

    onSubmit(trimmed)
  }

  return (
    <section className="panel">
      <header className="panel-header">
        <h2>Target</h2>
      </header>

      <form className="search-form" onSubmit={handleSubmit}>
        <input
          type="text"
          value={value}
          spellCheck={false}
          autoComplete="off"
          placeholder="org-name or owner/repo"
          onChange={(event) => onChange(event.target.value)}
        />

        <button type="submit" disabled={loading}>
          {loading ? 'Loading...' : 'Fetch activity'}
        </button>
        <button
          type="button"
          className="ghost"
          disabled={!value.trim()}
          onClick={() => onLoadSaved(value)}
        >
          Load saved
        </button>
      </form>

      <p className="subtle">
        Org mode returns ranked repo cards. Repo mode loads full issue/PR/contributor metrics.
      </p>
    </section>
  )
}
