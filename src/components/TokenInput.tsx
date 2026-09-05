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
  const [draft, setDraft] = useState('')
  const [visible, setVisible] = useState(false)
  return (
    <section className="panel token-panel">
      <p className="eyebrow">PRIVATE BY DESIGN</p>
      <h2>GitHub connection</h2>
      <p>
        Use a fine-grained token with public repository access and a short
        expiration. No write permissions needed.
      </p>
      <a
        href="https://github.com/settings/personal-access-tokens/new"
        target="_blank"
        rel="noreferrer"
      >
        Create a fine-grained token ↗
      </a>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onTokenChange(draft.trim())
          setDraft('')
          setVisible(false)
        }}
      >
        <label className="field-label" htmlFor="github-token">
          {token ? 'Replace your token' : 'Personal access token'}
        </label>
        <div className="token-row">
          <input
            id="github-token"
            autoFocus
            type={visible ? 'text' : 'password'}
            value={draft}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="github_pat_…"
            required
            onChange={(e) => setDraft(e.target.value)}
          />
          <button
            type="button"
            className="ghost"
            aria-pressed={visible}
            onClick={() => setVisible((v) => !v)}
          >
            {visible ? 'Hide' : 'Show'}
          </button>
          <button disabled={!draft.trim()}>Connect</button>
        </div>
      </form>
      <p className="subtle">
        Sent directly to api.github.com. Kept only in this tab’s memory;
        reloading disconnects it. Fetched data is saved on this device.
      </p>
      {token && (
        <button
          className="ghost"
          onClick={() => {
            onClearToken()
            setDraft('')
            setVisible(false)
          }}
        >
          Disconnect and forget token
        </button>
      )}
    </section>
  )
}
