import { useState } from 'react'

interface TokenInputProps {
  token: string
  onTokenChange: (token: string) => void
  onClearToken: () => void
}

export function TokenInput({
  token,
  onTokenChange,
  onClearToken,
}: TokenInputProps) {
  const [showToken, setShowToken] = useState(false)

  return (
    <section className="panel">
      <header className="panel-header">
        <h2>Authentication</h2>
      </header>

      <label className="field-label" htmlFor="github-token">
        GitHub PAT (`public_repo`)
      </label>

      <ol className="token-steps">
        <li>
          Open{' '}
          <a
            href="https://github.com/settings/tokens/new"
            target="_blank"
            rel="noreferrer"
          >
            GitHub classic token settings
          </a>
          .
        </li>
        <li>Select an expiration and enable the `public_repo` scope.</li>
        <li>Generate the token and copy it (GitHub shows it once).</li>
        <li>Paste it here, then run your repo/org search.</li>
      </ol>

      <div className="token-row">
        <input
          id="github-token"
          type={showToken ? 'text' : 'password'}
          value={token}
          autoComplete="off"
          spellCheck={false}
          placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
          onChange={(event) => onTokenChange(event.target.value.trim())}
        />

        <button
          type="button"
          className="ghost"
          onClick={() => setShowToken((current) => !current)}
        >
          {showToken ? 'Hide' : 'Show'}
        </button>

        <button
          type="button"
          className="ghost"
          onClick={onClearToken}
          disabled={!token}
        >
          Clear token
        </button>
      </div>

      <p className="subtle">Stored in memory only. Never saved to local storage.</p>
    </section>
  )
}
