'use client'

import { useCallback, useSyncExternalStore } from 'react'

const noop = () => () => {}

/** False while prerendering and hydrating, true once running in the browser. */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  )
}

// --- localStorage as an external store ----------------------------------------------------------

const EVENT = 'otel-demo:storage'

function subscribeStorage(callback: () => void) {
  window.addEventListener(EVENT, callback)
  window.addEventListener('storage', callback)
  return () => {
    window.removeEventListener(EVENT, callback)
    window.removeEventListener('storage', callback)
  }
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null // storage blocked: behave as if empty
  }
}

/**
 * A JSON value kept in localStorage for this browser only. Returns the parsed value (or the
 * fallback) and a setter. Nothing is ever sent anywhere.
 */
export function useStoredState<T>(key: string, fallback: T): [T, (value: T) => void] {
  const raw = useSyncExternalStore(
    subscribeStorage,
    () => readStorage(key),
    () => null,
  )
  let value = fallback
  if (raw !== null) {
    try {
      value = { ...fallback, ...JSON.parse(raw) }
    } catch {
      value = fallback
    }
  }
  const setValue = useCallback(
    (next: T) => {
      try {
        localStorage.setItem(key, JSON.stringify(next))
      } catch {
        // Not remembered, still works for this page view.
      }
      window.dispatchEvent(new Event(EVENT))
    },
    [key],
  )
  return [value, setValue]
}

// --- the theme attribute on <html> ---------------------------------------------------------------

function subscribeTheme(callback: () => void) {
  const observer = new MutationObserver(callback)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => observer.disconnect()
}

export function useTheme(): 'light' | 'dark' | null {
  return useSyncExternalStore(
    subscribeTheme,
    () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'),
    () => null,
  )
}
