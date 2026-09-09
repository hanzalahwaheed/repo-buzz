import { useSyncExternalStore } from 'react'

const TOKEN_KEY = 'repobuzz.githubToken.v1'
const TOKEN_EVENT = 'repobuzz:token'

/** GitHub issues tokens made only of letters, digits and underscores. */
export const TOKEN_SHAPE = /^[A-Za-z0-9_]{20,255}$/

function hasStorage(): boolean {
  try {
    return typeof window !== 'undefined' && Boolean(window.localStorage)
  } catch {
    return false
  }
}

export function readPersonalToken(): string {
  if (!hasStorage()) return ''
  try {
    return window.localStorage.getItem(TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}

function announce() {
  window.dispatchEvent(new Event(TOKEN_EVENT))
}

export function savePersonalToken(token: string): boolean {
  if (!hasStorage()) return false
  try {
    window.localStorage.setItem(TOKEN_KEY, token)
    announce()
    return true
  } catch {
    return false
  }
}

export function forgetPersonalToken(): void {
  if (!hasStorage()) return
  try {
    window.localStorage.removeItem(TOKEN_KEY)
    announce()
  } catch {
    // Nothing to forget when storage is unavailable.
  }
}

/** Shows only the last four characters, so a screen never carries the whole token. */
export function maskToken(token: string): string {
  return token.length > 8 ? `${'•'.repeat(12)}${token.slice(-4)}` : '••••••••'
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(TOKEN_EVENT, onChange)
  // A change in another tab arrives as a storage event.
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(TOKEN_EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}

export function usePersonalToken(): string {
  return useSyncExternalStore(subscribe, readPersonalToken, () => '')
}
