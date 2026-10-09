'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { API_URL, IS_STATIC_SITE, LAB_URL } from './site'

export class LabError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

async function request<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${base}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    })
  } catch {
    throw new LabError('The lab is not reachable. Is `docker compose up` running?', 0)
  }
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const message = body?.message ?? body?.detail ?? `HTTP ${response.status}`
    throw new LabError(typeof message === 'string' ? message : JSON.stringify(message), response.status)
  }
  return body as T
}

export const lab = {
  get: <T>(path: string) => request<T>(LAB_URL, path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(LAB_URL, path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) => request<T>(LAB_URL, path, { method: 'PUT', body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(LAB_URL, path, { method: 'DELETE' }),
}

export type CheckoutResult = { status: number; traceId: string | null; body: unknown; ms: number }

/** One real checkout through the gateway. Returns the trace id from the X-Trace-Id header. */
export async function sendCheckout(): Promise<CheckoutResult> {
  const started = performance.now()
  const response = await fetch(`${API_URL}/api/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: 'user-browser',
      items: [
        { product_id: 'prod-001', quantity: 1 },
        { product_id: 'prod-005', quantity: 2 },
      ],
    }),
  })
  return {
    status: response.status,
    traceId: response.headers.get('X-Trace-Id'),
    body: await response.json().catch(() => null),
    ms: Math.round(performance.now() - started),
  }
}

/**
 * Fetch a lab endpoint, optionally on an interval. While a refetch is in flight the previous data
 * stays on screen (no flashing skeletons); `error` is set when the lab cannot answer.
 */
export function usePoll<T>(path: string | null, intervalMs = 0) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  // Each request gets a number; only the newest one may update state, so a slow response for
  // an old filter can never overwrite a newer one.
  const latest = useRef(0)

  const refresh = useCallback(async () => {
    if (!path || IS_STATIC_SITE) return
    const request = ++latest.current
    setLoading(true)
    try {
      const result = await lab.get<T>(path)
      if (request === latest.current) {
        setData(result)
        setError(null)
      }
    } catch (err) {
      if (request === latest.current) setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (request === latest.current) setLoading(false)
    }
  }, [path])

  useEffect(() => {
    if (!path) return
    // Start on the next tick: the effect subscribes to an external source, it does not set
    // state itself.
    const first = window.setTimeout(() => void refresh(), 0)
    const timer = intervalMs
      ? window.setInterval(() => {
          if (document.visibilityState === 'visible') void refresh()
        }, intervalMs)
      : undefined
    return () => {
      window.clearTimeout(first)
      window.clearInterval(timer)
    }
  }, [path, intervalMs, refresh])

  return { data, error, loading, refresh }
}
