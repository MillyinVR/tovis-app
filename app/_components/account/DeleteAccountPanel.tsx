// app/_components/account/DeleteAccountPanel.tsx
//
// The one Delete Account surface, rendered from BOTH client settings and the
// pro account section.
//
// Shared rather than written twice on purpose: the copy here makes promises
// about what deletion does (what survives, how long the window is), and two
// copies of that drift into two different promises. The server is the source of
// truth for the grace period and for every blocker message — this component
// renders what /api/v1/me/account-deletion says rather than restating it, so a
// policy change on the server reaches both surfaces without a UI edit.

'use client'

import { useCallback, useEffect, useState } from 'react'

import Button from '@/app/_components/ui/Button'
import { isRecord } from '@/lib/guards'
import { readErrorMessage, safeJson } from '@/lib/http'
import {
  DEFAULT_TIME_ZONE,
  formatInTimeZone,
  getViewerTimeZone,
} from '@/lib/time'

const ENDPOINT = '/api/v1/me/account-deletion'

type Blocker = {
  code: string
  message: string
}

type PendingRequest = {
  id: string
  scheduledFor: string
}

type Status = {
  gracePeriodDays: number
  eligible: boolean
  blockers: Blocker[]
  pendingRequest: PendingRequest | null
}

function parseBlockers(value: unknown): Blocker[] {
  if (!Array.isArray(value)) return []

  const out: Blocker[] = []
  for (const item of value) {
    if (!isRecord(item)) continue
    const code = typeof item.code === 'string' ? item.code : null
    const message = typeof item.message === 'string' ? item.message : null
    // Rendered verbatim: these are the server's own words about the user's
    // obligations, not an error string to be reworded here.
    if (code && message) out.push({ code, message })
  }
  return out
}

function parsePendingRequest(value: unknown): PendingRequest | null {
  if (!isRecord(value)) return null
  const id = typeof value.id === 'string' ? value.id : null
  const scheduledFor =
    typeof value.scheduledFor === 'string' ? value.scheduledFor : null
  return id && scheduledFor ? { id, scheduledFor } : null
}

function parseStatus(payload: unknown): Status | null {
  if (!isRecord(payload) || !isRecord(payload.accountDeletion)) return null
  const raw = payload.accountDeletion
  const eligibility = isRecord(raw.eligibility) ? raw.eligibility : {}

  return {
    gracePeriodDays:
      typeof raw.gracePeriodDays === 'number' ? raw.gracePeriodDays : 14,
    eligible: eligibility.eligible === true,
    blockers: parseBlockers(eligibility.blockers),
    pendingRequest: parsePendingRequest(raw.pendingRequest),
  }
}

/**
 * The scheduled date, in the reader's own zone.
 *
 * Through `@/lib/time` rather than raw `Intl`: the barrel sanitizes the zone
 * and shares its cached formatters, and `getViewerTimeZone()` is the sanctioned
 * way to ask "what zone is this person actually in" for a display-only hint.
 */
function formatScheduledFor(iso: string): string {
  return formatInTimeZone(iso, getViewerTimeZone() ?? DEFAULT_TIME_ZONE, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export default function DeleteAccountPanel() {
  const [status, setStatus] = useState<Status | null>(null)
  const [loading, setLoading] = useState(true)
  const [confirming, setConfirming] = useState(false)
  const [confirmEmail, setConfirmEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(ENDPOINT, { cache: 'no-store' })
      const body = await safeJson(res)
      if (!res.ok) {
        setError(readErrorMessage(body) ?? 'Something went wrong.')
        return
      }
      setStatus(parseStatus(body))
      setError(null)
    } catch {
      setError('Could not load your account settings. Try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function submitDeletion() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmEmail }),
      })
      const body = await safeJson(res)

      if (!res.ok) {
        // A 409 carries the live blockers — show them rather than a generic
        // failure, since they tell the user exactly what to go and do.
        if (isRecord(body) && Array.isArray(body.blockers)) {
          setStatus((prev) =>
            prev
              ? { ...prev, eligible: false, blockers: parseBlockers(body.blockers) }
              : prev,
          )
        }
        setError(readErrorMessage(body) ?? 'Something went wrong.')
        return
      }

      setConfirming(false)
      setConfirmEmail('')
      await load()
    } catch {
      setError('Could not schedule the deletion. Try again.')
    } finally {
      setBusy(false)
    }
  }

  async function cancelDeletion() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(ENDPOINT, { method: 'DELETE' })
      const body = await safeJson(res)
      if (!res.ok) {
        setError(readErrorMessage(body) ?? 'Something went wrong.')
        return
      }
      await load()
    } catch {
      setError('Could not cancel the deletion. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="brand-glass p-5 sm:p-6" id="delete-account">
      <div className="mb-4">
        <div className="text-sm font-black tracking-[var(--ls-caps)] text-textPrimary">
          Delete account
        </div>
        <div className="mt-1 text-xs font-semibold leading-5 text-textSecondary">
          Permanently close your account and remove your personal information.
        </div>
      </div>

      {loading ? (
        <div className="text-xs font-semibold text-textSecondary">Loading…</div>
      ) : status?.pendingRequest ? (
        <ScheduledState
          scheduledFor={status.pendingRequest.scheduledFor}
          busy={busy}
          onCancel={() => void cancelDeletion()}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {status && status.blockers.length > 0 ? (
            <BlockerList blockers={status.blockers} />
          ) : null}

          <p className="text-xs font-semibold leading-5 text-textSecondary">
            Your account closes after {status?.gracePeriodDays ?? 14} days. You
            can sign in and cancel any time before then. Booking and payment
            records are kept for accounting and for the people you booked with,
            with your personal details removed.
          </p>

          {confirming ? (
            <div className="flex flex-col gap-3">
              <label
                className="text-xs font-semibold text-textSecondary"
                htmlFor="delete-account-confirm-email"
              >
                Type your email address to confirm.
              </label>
              <input
                id="delete-account-confirm-email"
                type="email"
                autoComplete="off"
                value={confirmEmail}
                onChange={(event) => setConfirmEmail(event.target.value)}
                className="h-11 rounded-[14px] border border-textPrimary/16 bg-bgSecondary/40 px-4 text-sm font-semibold text-textPrimary outline-none focus:border-textPrimary/30"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="danger"
                  shape="soft"
                  disabled={busy || confirmEmail.trim().length === 0}
                  onClick={() => void submitDeletion()}
                >
                  {busy ? 'Scheduling…' : 'Delete my account'}
                </Button>
                <Button
                  variant="ghost"
                  shape="soft"
                  disabled={busy}
                  onClick={() => {
                    setConfirming(false)
                    setConfirmEmail('')
                    setError(null)
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <Button
                variant="danger"
                shape="soft"
                disabled={status ? !status.eligible : true}
                onClick={() => setConfirming(true)}
              >
                Delete account
              </Button>
            </div>
          )}
        </div>
      )}

      {error ? (
        <div className="mt-3 text-xs font-semibold text-toneDanger">{error}</div>
      ) : null}
    </section>
  )
}

function BlockerList({ blockers }: { blockers: Blocker[] }) {
  return (
    <div className="rounded-[14px] border border-toneWarn/35 bg-toneWarn/10 p-4">
      <div className="text-xs font-black uppercase tracking-[var(--ls-caps)] text-textPrimary">
        Before you can delete
      </div>
      <ul className="mt-2 flex flex-col gap-1.5">
        {blockers.map((blocker) => (
          <li
            key={blocker.code}
            className="text-xs font-semibold leading-5 text-textSecondary"
          >
            {blocker.message}
          </li>
        ))}
      </ul>
    </div>
  )
}

function ScheduledState(props: {
  scheduledFor: string
  busy: boolean
  onCancel: () => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-[14px] border border-toneDanger/35 bg-toneDanger/10 p-4">
        <div className="text-xs font-black uppercase tracking-[var(--ls-caps)] text-textPrimary">
          Deletion scheduled
        </div>
        <div className="mt-1 text-xs font-semibold leading-5 text-textSecondary">
          Your account and personal information will be removed on{' '}
          {formatScheduledFor(props.scheduledFor)}. You can still change your
          mind until then.
        </div>
      </div>

      <div>
        <Button
          variant="ghost"
          shape="soft"
          disabled={props.busy}
          onClick={props.onCancel}
        >
          {props.busy ? 'Cancelling…' : 'Keep my account'}
        </Button>
      </div>
    </div>
  )
}
