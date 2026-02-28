// app/api/_utils/responses.ts
import { NextResponse } from 'next/server'

type HeadersLike = HeadersInit | undefined

function mergeHeaders(base: HeadersLike, extra: HeadersLike) {
  const out = new Headers(base || {})
  if (extra) {
    const h = new Headers(extra)
    h.forEach((v, k) => out.set(k, v))
  }
  return out
}

export function jsonOk<T extends Record<string, unknown>>(data?: T, init?: number | ResponseInit) {
  const status = typeof init === 'number' ? init : init?.status
  const headersIn = typeof init === 'object' ? init.headers : undefined

  // Never allow callers to override `ok`
  const { ok: _ignored, ...rest } = data ?? ({} as Record<string, unknown>)

  const headers = mergeHeaders({ 'Cache-Control': 'no-store' }, headersIn)

  return NextResponse.json({ ok: true, ...rest }, { status: status ?? 200, headers })
}

export function jsonFail(status: number, error: string, extra?: Record<string, unknown>, init?: ResponseInit) {
  // Never allow callers to override `ok` / `error`
  const { ok: _ignoredOk, error: _ignoredErr, ...rest } = extra ?? {}

  const headers = mergeHeaders({ 'Cache-Control': 'no-store' }, init?.headers)

  return NextResponse.json({ ok: false, error, ...rest }, { status, headers })
}