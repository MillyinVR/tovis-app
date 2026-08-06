// app/pro/clients/ClientsList.tsx
'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'

import ClientProfileLink from '@/app/_components/ClientProfileLink'
import EmptyState from '@/app/_components/boundaries/EmptyState'
import Badge from '@/app/_components/ui/Badge'
import { Card, buttonClassName } from '@/app/_components/ui'
import type { ProClientRequirement } from '@/lib/proClientPolicy/summary'

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
  /**
   * Where this client's name leads, resolved server-side by THE one rule
   * (resolveClientProfileHref): the chart when this pro may open it, else the
   * client's public /u/[handle], else nothing.
   */
  profileHref: string | null
  /**
   * The chart link for the "View chart" button, or null when this pro may not
   * open this client — the SAME answer `/pro/clients/[id]` will give.
   *
   * 🔴 Its own field, not `client.id` interpolated here. This button used to
   * build `/pro/clients/{id}` itself, which is a SECOND door onto a decision the
   * server had already made: once booking-less claims widen the roster past the
   * visibility window, that hardcoded href sent the pro to a page that just
   * redirects back here.
   */
  chartHref: string | null
  /**
   * K16-B — the booking requirements this pro has set for this client, from
   * `summarizeProClientPolicy`. Empty for every client when the technical-record
   * gate is off, because the control that sets them is gated the same way.
   */
  requirements: ProClientRequirement[]
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
  const [onlyWithRequirements, setOnlyWithRequirements] = useState(false)

  const trimmedQuery = query.trim()

  // K16-B — how many clients carry booking requirements. Zero when the
  // technical-record gate is off, which also hides the filter entirely.
  const withRequirementsCount = useMemo(
    () => clients.filter((client) => client.requirements.length > 0).length,
    [clients],
  )

  const filtered = useMemo(
    () =>
      clients.filter(
        (client) =>
          matchesQuery(client, trimmedQuery) &&
          (!onlyWithRequirements || client.requirements.length > 0),
      ),
    [clients, trimmedQuery, onlyWithRequirements],
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
            {/* Derived from the rows, not from a flag: the moment the roster
                carries a client whose chart this pro cannot open, the old
                sentence is a lie sitting directly above the counter-example. */}
            {clients.some((client) => client.chartHref === null)
              ? 'Clients you added appear here too — their chart opens once you have a booking, or they share it.'
              : 'Only clients with active access are shown here.'}
          </div>
        </div>

        <div className="text-[12px] font-semibold text-textSecondary">
          {clients.length
            ? // Any narrowing — search OR the requirements filter — must move
              // this count, or the header contradicts the list under it.
              trimmedQuery || onlyWithRequirements
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

          {withRequirementsCount > 0 ? (
            <label className="flex items-center gap-2 text-[12px] font-semibold text-textSecondary">
              <input
                type="checkbox"
                checked={onlyWithRequirements}
                onChange={(e) => setOnlyWithRequirements(e.target.checked)}
                className="size-4 accent-accentPrimary"
              />
              Only clients with booking requirements ({withRequirementsCount})
            </label>
          ) : null}

          {filtered.length === 0 ? (
            <div className="rounded-card border border-white/10 bg-bgSecondary px-4 py-6 text-center text-[13px] font-semibold text-textSecondary">
              {/* Always query-driven: the requirements filter only renders when
                  at least one client has them, so it cannot empty the list on
                  its own. */}
              No clients match “{trimmedQuery}”.
            </div>
          ) : (
            <div className="grid gap-3">
              {filtered.map((client) => (
                <Card key={client.id} variant="glass" padding="md">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <ClientProfileLink
                          href={client.profileHref}
                          label={client.displayName}
                          className="font-black text-textPrimary"
                          inertClassName="font-black text-textPrimary"
                        />
                      </div>

                      <div className="mt-1 text-[12px] font-semibold text-textSecondary">
                        {client.contactLine}
                      </div>

                      <div className="mt-2 text-[11px] font-semibold text-textSecondary/80">
                        {client.lastBookingLabel}
                      </div>

                      {client.requirements.length > 0 ? (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {client.requirements.map((requirement) => (
                            <Badge
                              key={requirement.key}
                              tone={requirement.inactive ? 'neutral' : 'warn'}
                              size="sm"
                              title={
                                requirement.inactive
                                  ? `${requirement.label} — set, but not enforced yet`
                                  : requirement.label
                              }
                            >
                              {requirement.label}
                              {requirement.inactive ? ' (not active)' : ''}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
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

                        {client.chartHref ? (
                          <Link
                            href={client.chartHref}
                            className={buttonClassName({
                              variant: 'ghost',
                              size: 'sm',
                            })}
                          >
                            View chart
                          </Link>
                        ) : null}
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
