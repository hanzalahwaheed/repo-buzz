import { useEffect, useRef, useState } from 'react'
import { checkPersonalToken } from '../lib/libraryApi'
import {
  forgetPersonalToken,
  maskToken,
  savePersonalToken,
  TOKEN_SHAPE,
  usePersonalToken,
} from '../lib/personalToken'
import type { LibraryStatus, TokenCheck } from '../types/api'
import { RateLimitIndicator } from './RateLimitIndicator'

interface SettingsPageProps {
  status?: LibraryStatus
}

export function SettingsPage({ status }: SettingsPageProps) {
  const token = usePersonalToken()
  const [draft, setDraft] = useState('')
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [check, setCheck] = useState<TokenCheck | null>(null)
  // Remembers which token the quota on screen belongs to.
  const checked = useRef('')

  useEffect(() => {
    if (!token) {
      checked.current = ''
      setCheck(null)
      return
    }
    if (checked.current === token) return
    checked.current = token
    const controller = new AbortController()
    checkPersonalToken(token, controller.signal)
      .then(setCheck)
      .catch((problem: unknown) => {
        if (controller.signal.aborted) return
        setCheck(null)
        setError(
          problem instanceof Error
            ? problem.message
            : 'GitHub could not check your saved token.',
        )
      })
    return () => controller.abort()
  }, [token])

  const connect = async (value: string) => {
    const candidate = value.trim()
    if (!TOKEN_SHAPE.test(candidate)) {
      setError(
        'That does not look like a GitHub token. Copy the whole token and try again.',
      )
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await checkPersonalToken(candidate)
      if (!savePersonalToken(candidate)) {
        setError(
          'This browser refused to store the token. Check your privacy settings and try again.',
        )
        return
      }
      checked.current = candidate
      setCheck(result)
      setDraft('')
      setVisible(false)
    } catch (problem) {
      setError(
        problem instanceof Error
          ? problem.message
          : 'GitHub could not check this token.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="page-section">
      <p className="eyebrow">YOUR GITHUB CONNECTION</p>
      <div className="section-heading">
        <h1>Settings</h1>
      </div>
      <p className="subtle">
        repoBuzz explores public repositories with a shared GitHub connection.
        Nothing here is required.
      </p>
      <div className="settings-layout">
        <section className="panel token-panel">
          <p className="eyebrow">
            {token ? 'YOUR TOKEN IS IN USE' : 'OPTIONAL'}
          </p>
          <h2>Personal access token</h2>
          {!token && (
            <p>
              The shared connection covers ordinary use. Add a token only if you
              hit its limits, or if you would rather explore on your own quota.
            </p>
          )}
          {token ? (
            <>
              <p className="token-state">
                <i className="connected" />
                <code>{maskToken(token)}</code>
              </p>
              <p>
                Every exploration you start now runs on your token. It is
                preferred over the shared connection, and it does not spend the
                shared refresh budget.
              </p>
            </>
          ) : (
            <p className="subtle">
              Use a fine-grained token with public repository access and a short
              expiration. No write permissions are needed.
            </p>
          )}
          <a
            href="https://github.com/settings/personal-access-tokens/new"
            target="_blank"
            rel="noreferrer"
          >
            Create a fine-grained token ↗
          </a>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void connect(draft)
            }}
          >
            <label className="field-label" htmlFor="github-token">
              {token ? 'Replace your token' : 'Paste your token'}
            </label>
            <div className="token-row">
              <input
                id="github-token"
                type={visible ? 'text' : 'password'}
                value={draft}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="github_pat_…"
                required
                onChange={(event) => {
                  setDraft(event.target.value)
                  setError('')
                }}
              />
              <button
                type="button"
                className="ghost"
                aria-pressed={visible}
                onClick={() => setVisible((current) => !current)}
              >
                {visible ? 'Hide' : 'Show'}
              </button>
              <button disabled={busy || !draft.trim()}>
                {busy ? 'Checking…' : 'Check and save'}
              </button>
            </div>
          </form>
          {error && (
            <p className="notice" role="alert">
              {error}
            </p>
          )}
          <p className="subtle">
            Kept in this browser until you remove it. It travels to repoBuzz on
            each exploration, which forwards it to api.github.com and never
            writes it down.
          </p>
          {token && (
            <button
              className="ghost"
              onClick={() => {
                forgetPersonalToken()
                setDraft('')
                setVisible(false)
                setError('')
              }}
            >
              Forget this token
            </button>
          )}
        </section>
        <div className="settings-side">
          <RateLimitIndicator
            title={token ? 'Your GitHub limits' : 'Shared GitHub limits'}
            restRateLimit={token ? check?.rates.rest : status?.rates.rest}
            graphRateLimit={
              token ? check?.rates.graphql : status?.rates.graphql
            }
            isAuthenticated={token ? Boolean(check) : Boolean(status?.configured)}
            unauthenticatedNote={
              token
                ? 'Your token has not answered yet. Check it again, or remove it to use the shared connection.'
                : 'The shared connection is not configured. Add your own token above to explore live.'
            }
          />
          <section className="panel">
            <header className="panel-header">
              <h2>Which connection runs</h2>
            </header>
            <ol className="connection-order">
              <li className={token ? 'chosen' : ''}>
                <strong>Your token</strong>
                <span>Your own quota. No shared budget spent.</span>
              </li>
              <li className={!token ? 'chosen' : ''}>
                <strong>The shared connection</strong>
                <span>A small hourly budget, spread across everyone.</span>
              </li>
            </ol>
            <p className="subtle">
              Explorations are saved to the shared library either way, so the
              next visitor reads yours without a new GitHub request. Only public
              repositories are ever fetched or stored.
            </p>
          </section>
        </div>
      </div>
    </section>
  )
}
