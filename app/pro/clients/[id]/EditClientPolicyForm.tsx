'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import type { OfferingPrepayScope } from '@prisma/client'

export type ClientPolicyValue = {
  requireDeposit: boolean
  prepayScope: OfferingPrepayScope | null
  requireCardOnFile: boolean
  blockSelfServeBooking: boolean
}

type Props = {
  clientId: string
  initialPolicy: ClientPolicyValue | null
  /**
   * Whether the save-card rail is live (ENABLE_NO_SHOW_PROTECTION). Passed from
   * the server so the control matches what the write route will accept: while
   * the rail is dark the route 409s a card-on-file requirement, and a switch the
   * server refuses must not look available here.
   */
  cardOnFileRailEnabled: boolean
}

const EMPTY: ClientPolicyValue = {
  requireDeposit: false,
  prepayScope: null,
  requireCardOnFile: false,
  blockSelfServeBooking: false,
}

// K16 — per-client booking requirements. Switches only, deliberately: this
// records what a booking must satisfy, never a judgement about the person. The
// pro's prose about a client lives in the do-not-rebook note next to this.
export default function EditClientPolicyForm({
  clientId,
  initialPolicy,
  cardOnFileRailEnabled,
}: Props) {
  const router = useRouter()
  const [value, setValue] = useState<ClientPolicyValue>(initialPolicy ?? EMPTY)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const active =
    value.requireDeposit ||
    value.prepayScope != null ||
    value.requireCardOnFile ||
    value.blockSelfServeBooking

  const busy = saving || pending

  async function save(next: ClientPolicyValue) {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/pro/clients/${clientId}/policy`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        // The 409s here are the route REFUSING a requirement this pro cannot
        // back (no deposit amount configured, payments not connected, saved
        // cards not available). Surface the server's own sentence — it names the
        // setting that fixes it — rather than a generic failure.
        setError((data as { error?: string }).error || 'Failed to save.')
        return
      }
      setValue(next)
      setEditing(false)
      // Hold the buttons disabled until the refreshed server render commits, so
      // the control cannot be re-driven against stale state (the K13-web fix).
      startTransition(() => router.refresh())
    } catch (err) {
      console.error(err)
      setError('Network error.')
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <div>
        {active ? (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 10px',
              borderRadius: 999,
              background: 'rgb(var(--tone-warn) / 0.12)',
              border: '1px solid rgb(var(--tone-warn) / 0.35)',
              fontSize: 12,
              color: 'rgb(var(--tone-warn))',
              fontWeight: 700,
            }}
          >
            <span aria-hidden>🔒</span> Booking requirements set
          </div>
        ) : null}

        <div style={{ marginTop: active ? 6 : 0 }}>
          <button
            type="button"
            onClick={() => setEditing(true)}
            style={{
              fontSize: 11,
              padding: '4px 10px',
              borderRadius: 999,
              border: '1px solid rgb(var(--text-primary) / 0.10)',
              background: 'rgb(var(--text-primary) / 0.04)',
              cursor: 'pointer',
            }}
          >
            {active ? 'Edit booking requirements' : 'Set booking requirements'}
          </button>
        </div>
      </div>
    )
  }

  const draft = value

  function toggle(patch: Partial<ClientPolicyValue>) {
    setValue((current) => ({ ...current, ...patch }))
  }

  return (
    <div style={{ maxWidth: 380 }}>
      <div style={{ display: 'grid', gap: 10 }}>
        <Switch
          label="Require a deposit"
          hint="Takes your usual deposit from this client on every booking, whatever your account-wide deposit setting says."
          checked={draft.requireDeposit}
          disabled={busy}
          onChange={(checked) => toggle({ requireDeposit: checked })}
        />

        <Switch
          label="Require prepayment"
          hint="This client pays up front."
          checked={draft.prepayScope != null}
          disabled={busy}
          onChange={(checked) =>
            toggle({ prepayScope: checked ? 'ENTIRE_BOOKING' : null })
          }
        />

        {draft.prepayScope != null ? (
          <div style={{ paddingLeft: 26, display: 'grid', gap: 4 }}>
            <label style={{ fontSize: 11, color: 'rgb(var(--text-muted))' }}>
              What prepayment covers
            </label>
            <select
              value={draft.prepayScope}
              disabled={busy}
              onChange={(e) =>
                toggle({ prepayScope: e.target.value as OfferingPrepayScope })
              }
              style={{
                fontSize: 12,
                padding: '6px 8px',
                borderRadius: 8,
                border: '1px solid rgb(var(--text-primary) / 0.12)',
                background: 'rgb(var(--surface-1))',
                color: 'rgb(var(--text-primary))',
              }}
            >
              <option value="ENTIRE_BOOKING">
                The whole booking, including add-ons
              </option>
              <option value="SERVICE_ONLY">The main service only</option>
            </select>
          </div>
        ) : null}

        <Switch
          label="Require a card on file"
          hint={
            cardOnFileRailEnabled
              ? 'This client saves a card before they can finish booking. Nothing is charged when they save it.'
              : 'Saved cards aren’t available yet, so this can’t be required.'
          }
          checked={draft.requireCardOnFile}
          disabled={busy || !cardOnFileRailEnabled}
          onChange={(checked) => toggle({ requireCardOnFile: checked })}
        />

        <Switch
          label="No online booking"
          hint="This client can’t book a new appointment themselves — you book them. They can still reschedule an appointment they already have."
          checked={draft.blockSelfServeBooking}
          disabled={busy}
          onChange={(checked) => toggle({ blockSelfServeBooking: checked })}
        />
      </div>

      <div
        style={{
          fontSize: 11,
          color: 'rgb(var(--text-muted))',
          marginTop: 10,
          lineHeight: 1.4,
        }}
      >
        Private to you — never shown to the client or to other pros. The client
        sees only the requirement itself when they book, never that you set it.
      </div>

      {error ? (
        <div
          role="alert"
          style={{
            fontSize: 11,
            color: 'rgb(var(--tone-danger))',
            marginTop: 8,
            lineHeight: 1.4,
          }}
        >
          {error}
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button
          type="button"
          disabled={busy}
          onClick={() => void save(draft)}
          style={{
            fontSize: 12,
            padding: '6px 12px',
            borderRadius: 999,
            border: '1px solid rgb(var(--text-primary) / 0.10)',
            background: 'rgb(var(--text-primary) / 0.06)',
            cursor: busy ? 'default' : 'pointer',
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setValue(initialPolicy ?? EMPTY)
            setError(null)
            setEditing(false)
          }}
          style={{
            fontSize: 12,
            padding: '6px 12px',
            borderRadius: 999,
            border: '1px solid rgb(var(--text-primary) / 0.10)',
            background: 'transparent',
            cursor: busy ? 'default' : 'pointer',
            opacity: busy ? 0.6 : 1,
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function Switch({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label
      style={{
        display: 'grid',
        gridTemplateColumns: '18px 1fr',
        gap: 8,
        alignItems: 'start',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: 2 }}
      />
      <span>
        <span style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
        <span
          style={{
            display: 'block',
            fontSize: 11,
            color: 'rgb(var(--text-muted))',
            lineHeight: 1.4,
          }}
        >
          {hint}
        </span>
      </span>
    </label>
  )
}
