// app/pro/clients/ClientsList.tsx
'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'

import ClientNameLink from '@/app/_components/ClientNameLink'
import EmptyState from '@/app/_components/boundaries/EmptyState'
import { Card, buttonClassName } from '@/app/_components/ui'

// One already-visible client, flattened server-side into display + search
// strings so this client component can filter the loaded list without any extra
// fetch. Raw PII fields stay server-side (in page.tsx); this row carries only
// pre-rendered display text and a lowercased search haystack.
export type ProClientRow = {
  id: string
  displayName: string
  contactLine: string
  /** Lowercased "name email phone" haystack, precomputed server-side. */
  searchText: string
  lastBookingLabel: string
  messageHref: string
}

function matchesQuery(client: ProClientRow, query: string): boolean {
  if (!query) return true

  // Every whitespace-separated term must appear, so "ada gmail" narrows by both.
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => client.searchText.includes(term))
}

export default function ClientsList({ clients }: { clients: ProClientRow[] }) {
  const [query, setQuery] = useState('')

  const trimmedQuery = query.trim()
  const filtered = useMemo(
    () => clients.filter((client) => matchesQuery(client, trimmedQuery)),
    [clients, trimmedQuery],
  )

  const field =
    'w-full rounded-xl border border-white/10 bg-bgPrimary px-3 py-3 text-[13px] text-textPrimary placeholder:text-textSecondary/70 focus:outline-none focus:ring-2 focus:ring-accentPrimary/40'

  return (
    <section className="grid gap-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-black text-textPrimary">
            Client list
          </h2>
          <div className="mt-1 text-[12px] font-semibold text-textSecondary">
            Only clients with active access are shown here.
          </div>
        </div>

        <div className="text-[12px] font-semibold text-textSecondary">
          {clients.length
            ? trimmedQuery
              ? `${filtered.length} of ${clients.length}`
              : `${clients.length} visible`
            : ''}
        </div>
      </div>

      {clients.length === 0 ? (
        <EmptyState
          title="No clients with active visibility right now."
          description="Only clients with active access appear here. Share your booking link to bring clients on."
          action={{ label: 'View profile', href: '/pro/profile' }}
        />
      ) : (
        <>
          <label htmlFor="client-search" className="sr-only">
            Search clients
          </label>
          <input
            id="client-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, email, or phone"
            className={field}
            autoComplete="off"
          />

          {filtered.length === 0 ? (
            <div className="rounded-card border border-white/10 bg-bgSecondary px-4 py-6 text-center text-[13px] font-semibold text-textSecondary">
              No clients match “{trimmedQuery}”.
            </div>
          ) : (
            <div className="grid gap-3">
              {filtered.map((client) => (
                <Card key={client.id} variant="glass" padding="md">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <ClientNameLink canLink={true} clientId={client.id}>
                          {client.displayName}
                        </ClientNameLink>
                      </div>

                      <div className="mt-1 text-[12px] font-semibold text-textSecondary">
                        {client.contactLine}
                      </div>

                      <div className="mt-2 text-[11px] font-semibold text-textSecondary/80">
                        {client.lastBookingLabel}
                      </div>
                    </div>

                    <div className="shrink-0">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <Link
                          href={client.messageHref}
                          className={buttonClassName({
                            variant: 'ghost',
                            size: 'sm',
                          })}
                        >
                          Message
                        </Link>

                        <Link
                          href={`/pro/clients/${encodeURIComponent(client.id)}`}
                          className={buttonClassName({
                            variant: 'ghost',
                            size: 'sm',
                          })}
                        >
                          View chart
                        </Link>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}
