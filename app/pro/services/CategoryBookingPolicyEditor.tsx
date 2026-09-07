'use client'

import { useCallback, useEffect, useState } from 'react'

import { cn } from '@/lib/utils'

/**
 * P7a-5 — "When clients can book", per service category, plus that category's
 * deposit.
 *
 * It lives on the SERVICES page, beside the menu it is about, rather than on a
 * new screen (Tori, 2026-09-07). A pro thinking about her colour work is
 * thinking about it here.
 *
 * 🔴 The label is deliberately NOT "book instantly". `Professional.autoAccept-
 * Bookings` already means something different and adjacent (request vs
 * auto-confirm), and two settings called the same thing in two screens is a
 * trap the pro pays for, not us.
 *
 * The deposit half is only offered when the account switch is on and Stripe is
 * ready — the server refuses to store an amount otherwise, so an input that
 * accepted one would be a lie about what was saved.
 */

type CategoryRow = {
  serviceCategoryId: string
  categoryName: string
  bookingGate: 'INSTANT' | 'AFTER_PREP'
  depositType: 'FLAT' | 'PERCENT' | null
  depositFlatAmount: string | null
  depositPercent: number | null
}

type AccountDeposit = {
  depositEnabled: boolean
  depositType: 'FLAT' | 'PERCENT' | null
  depositFlatAmount: string | null
  depositPercent: number | null
  stripeReady: boolean
}

type LoadedState = {
  categories: CategoryRow[]
  accountDeposit: AccountDeposit
  depositBlocker: string | null
}

const ENDPOINT = '/api/v1/pro/category-booking-policy'

/** What a category inherits when it states nothing of its own. */
function inheritedLabel(account: AccountDeposit): string {
  if (!account.depositEnabled) return 'No deposit'
  if (account.depositType === 'PERCENT' && account.depositPercent) {
    return `Your usual ${account.depositPercent}%`
  }
  if (account.depositType === 'FLAT' && account.depositFlatAmount) {
    return `Your usual $${account.depositFlatAmount}`
  }
  return 'Your usual deposit'
}

export default function CategoryBookingPolicyEditor() {
  const [state, setState] = useState<LoadedState | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(ENDPOINT)
      const body = (await res.json().catch(() => null)) as
        | (LoadedState & { ok?: boolean })
        | null
      if (!res.ok || !body?.ok) {
        setError('Could not load your category settings.')
        return
      }
      setState({
        categories: body.categories ?? [],
        accountDeposit: body.accountDeposit,
        depositBlocker: body.depositBlocker ?? null,
      })
      setError(null)
    } catch {
      setError('Could not load your category settings.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const patch = useCallback(
    async (serviceCategoryId: string, body: Record<string, unknown>) => {
      setSavingId(serviceCategoryId)
      setStatus(null)
      setError(null)
      try {
        const res = await fetch(ENDPOINT, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serviceCategoryId, ...body }),
        })
        const parsed = (await res.json().catch(() => null)) as
          | { ok?: boolean; error?: string; message?: string }
          | null
        if (!res.ok || !parsed?.ok) {
          // The server's own sentence, not a generic one: its refusals name the
          // setting that fixes them, and replacing that with "Couldn't save"
          // would throw away the only actionable part.
          setError(parsed?.error ?? parsed?.message ?? 'Could not save that.')
          return
        }
        setStatus('Saved')
        await load()
      } catch {
        setError('Could not save that.')
      } finally {
        setSavingId(null)
      }
    },
    [load],
  )

  return (
    <section
      className="rounded-card border border-textPrimary/10 bg-bgPrimary p-4"
      data-testid="category-booking-policy"
    >
      <h3 className="text-[14px] font-black text-textPrimary">
        When clients can book
      </h3>
      <p className="mt-1 text-[12px] leading-[1.5] text-textSecondary">
        Per category. <strong>Right away</strong> is how booking works today.{' '}
        <strong>After they finish prep</strong> keeps your slot free until the
        client has answered the safety questions — worth it for big-ticket work
        you would not start without them.
      </p>

      {loading ? (
        <p className="mt-3 text-[12px] font-semibold text-textSecondary">Loading…</p>
      ) : !state || state.categories.length === 0 ? (
        <p className="mt-3 text-[12px] font-semibold text-textSecondary">
          Add a service to your menu and its category shows up here.
        </p>
      ) : (
        <>
          {state.depositBlocker ? (
            <p className="mt-3 rounded-[10px] border border-toneWarn/30 px-3 py-2 text-[11px] font-semibold text-textPrimary">
              {state.depositBlocker}
            </p>
          ) : null}

          <ul className="mt-3 flex flex-col gap-3">
            {state.categories.map((row) => (
              <CategoryCard
                key={row.serviceCategoryId}
                row={row}
                account={state.accountDeposit}
                depositLocked={state.depositBlocker != null}
                busy={savingId === row.serviceCategoryId}
                onPatch={patch}
              />
            ))}
          </ul>

          <div className="mt-3 flex items-center gap-3">
            {status ? (
              <span role="status" className="text-[12px] font-semibold text-toneSuccess">
                {status}
              </span>
            ) : null}
            {error ? (
              <span role="status" className="text-[12px] font-semibold text-toneDanger">
                {error}
              </span>
            ) : null}
          </div>
        </>
      )}
    </section>
  )
}

function CategoryCard(props: {
  row: CategoryRow
  account: AccountDeposit
  depositLocked: boolean
  busy: boolean
  onPatch: (id: string, body: Record<string, unknown>) => Promise<void>
}) {
  const { row, account, depositLocked, busy, onPatch } = props
  const [flat, setFlat] = useState(row.depositFlatAmount ?? '')
  const [percent, setPercent] = useState(
    row.depositPercent != null ? String(row.depositPercent) : '',
  )

  const gateName = `gate-${row.serviceCategoryId}`
  const depositName = `deposit-${row.serviceCategoryId}`

  return (
    <li className="rounded-[12px] border border-textPrimary/10 p-3">
      <div className="text-[13px] font-black text-textPrimary">{row.categoryName}</div>

      <fieldset className="mt-2 grid gap-1" disabled={busy}>
        <legend className="text-[11px] font-black text-textSecondary">
          When clients can book
        </legend>
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ['INSTANT', 'Right away'],
              ['AFTER_PREP', 'After they finish prep'],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="cursor-pointer">
              <input
                type="radio"
                name={gateName}
                className="peer sr-only"
                checked={row.bookingGate === value}
                disabled={busy}
                onChange={() => void onPatch(row.serviceCategoryId, { bookingGate: value })}
              />
              <span
                className={cn(
                  'grid h-8 place-items-center rounded-full border px-3 text-[11px] font-black transition',
                  'peer-focus-visible:ring-2 peer-focus-visible:ring-accentPrimary/60 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-bgSecondary',
                  row.bookingGate === value
                    ? 'border-accentPrimary bg-accentPrimary/15 text-textPrimary'
                    : 'border-surfaceGlass/10 bg-bgPrimary/60 text-textSecondary hover:border-surfaceGlass/20',
                )}
              >
                {label}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-3 grid gap-1" disabled={busy || depositLocked}>
        <legend className="text-[11px] font-black text-textSecondary">
          Deposit for this category
        </legend>
        <div className="flex flex-wrap items-center gap-2">
          <label className="cursor-pointer">
            <input
              type="radio"
              name={depositName}
              className="peer sr-only"
              checked={row.depositType == null}
              disabled={busy || depositLocked}
              onChange={() => void onPatch(row.serviceCategoryId, { depositType: null })}
            />
            <span
              className={cn(
                'grid h-8 place-items-center rounded-full border px-3 text-[11px] font-black transition',
                row.depositType == null
                  ? 'border-accentPrimary bg-accentPrimary/15 text-textPrimary'
                  : 'border-surfaceGlass/10 bg-bgPrimary/60 text-textSecondary',
              )}
            >
              {inheritedLabel(account)}
            </span>
          </label>

          <label className="flex items-center gap-1">
            <input
              type="radio"
              name={depositName}
              checked={row.depositType === 'FLAT'}
              disabled={busy || depositLocked}
              onChange={() =>
                void onPatch(row.serviceCategoryId, {
                  depositType: 'FLAT',
                  depositFlatAmount: flat,
                })
              }
              aria-label={`Flat deposit for ${row.categoryName}`}
            />
            <span className="text-[11px] font-bold text-textSecondary">$</span>
            <input
              type="text"
              inputMode="decimal"
              value={flat}
              onChange={(e) => setFlat(e.target.value)}
              onBlur={() => {
                if (row.depositType === 'FLAT' && flat !== (row.depositFlatAmount ?? '')) {
                  void onPatch(row.serviceCategoryId, {
                    depositType: 'FLAT',
                    depositFlatAmount: flat,
                  })
                }
              }}
              placeholder="25"
              disabled={busy || depositLocked}
              className="w-16 rounded-[10px] border border-textPrimary/15 bg-transparent px-2 py-1 text-[12px] text-textPrimary outline-none focus:border-accentPrimary"
            />
          </label>

          <label className="flex items-center gap-1">
            <input
              type="radio"
              name={depositName}
              checked={row.depositType === 'PERCENT'}
              disabled={busy || depositLocked}
              onChange={() =>
                void onPatch(row.serviceCategoryId, {
                  depositType: 'PERCENT',
                  depositPercent: percent,
                })
              }
              aria-label={`Percentage deposit for ${row.categoryName}`}
            />
            <input
              type="text"
              inputMode="numeric"
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
              onBlur={() => {
                if (
                  row.depositType === 'PERCENT' &&
                  percent !== (row.depositPercent != null ? String(row.depositPercent) : '')
                ) {
                  void onPatch(row.serviceCategoryId, {
                    depositType: 'PERCENT',
                    depositPercent: percent,
                  })
                }
              }}
              placeholder="20"
              disabled={busy || depositLocked}
              className="w-14 rounded-[10px] border border-textPrimary/15 bg-transparent px-2 py-1 text-[12px] text-textPrimary outline-none focus:border-accentPrimary"
            />
            <span className="text-[11px] font-bold text-textSecondary">%</span>
          </label>
        </div>
        <p className="mt-1 text-[11px] text-textSecondary/70">
          Taken when the client books and credited against the total. A client who
          cancels more than 24 hours ahead gets it back; inside 24 hours it is
          yours. Whether a deposit applies at all still follows your payment
          settings — this only changes the amount for this category.
        </p>
      </fieldset>
    </li>
  )
}
