// app/api/_utils/responses.ts
import { NextResponse } from 'next/server'

export function jsonOk<T extends Record<string, unknown>>(data: T = {} as T, init?: number | ResponseInit) {
  const status = typeof init === 'number' ? init : init?.status
  const headers = typeof init === 'object' ? init.headers : undefined
  return NextResponse.json({ ok: true, ...data }, { status: status ?? 200, headers })
}

export function jsonFail(status: number, error: string, extra?: Record<string, unknown>, init?: ResponseInit) {
  const body = extra ? { ok: false, error, ...extra } : { ok: false, error }
  const headers = init?.headers
  return NextResponse.json(body, { status, headers })
}
