// app/(main)/looks/[id]/page.tsx
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'

import { parseLooksDetailResponse } from '@/lib/looks/mappers'
import LookDetailClient from './LookDetailClient'

export const dynamic = 'force-dynamic'

type Params = { id: string }

function pickString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readErrorMessage(raw: unknown): string {
  if (isRecord(raw)) {
    const error = pickString(raw.error)
    if (error) return error
  }

  return 'Couldn’t load that look. Try again.'
}

async function getBaseUrl(): Promise<string> {
  const h = await headers()
  const proto = h.get('x-forwarded-proto') ?? 'http'
  const host = h.get('x-forwarded-host') ?? h.get('host')

  if (!host) {
    throw new Error('Missing request host while loading look detail.')
  }

  return `${proto}://${host}`
}

async function fetchLookDetail(lookPostId: string) {
  const baseUrl = await getBaseUrl()

  const res = await fetch(
    `${baseUrl}/api/looks/${encodeURIComponent(lookPostId)}`,
    {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
      },
    },
  )

  if (res.status === 404) {
    notFound()
  }

  const raw: unknown = await res.json().catch(() => null)

  if (!res.ok) {
    throw new Error(readErrorMessage(raw))
  }

  const item = parseLooksDetailResponse(raw)
  if (!item) {
    throw new Error('Invalid look detail response shape.')
  }

  return item
}

export default async function LookDetailPage({
  params,
}: {
  params: Promise<Params>
}) {
  const resolved = await params
  const lookPostId = pickString(resolved.id)

  if (!lookPostId) {
    notFound()
  }

  const item = await fetchLookDetail(lookPostId)
  return <LookDetailClient initialItem={item} />
}