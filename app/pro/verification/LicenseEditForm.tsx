// app/pro/verification/LicenseEditForm.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { US_STATES } from '@/lib/usStates'
import {
  safeJsonRecord,
  readErrorMessage,
  errorMessageFromUnknown,
} from '@/lib/http'

type Props = {
  initialState: string
  initialNumber: string
  initialExpiry: string // YYYY-MM-DD or ''
}

// Pro self-edit of license number / state / expiration. Saving sends the
// profile back for admin re-review (it does NOT change verification status or
// cut access — see /api/v1/pro/license).
export default function LicenseEditForm({
  initialState,
  initialNumber,
  initialExpiry,
}: Props) {
  const router = useRouter()
  const [state, setState] = useState(initialState)
  const [licenseNumber, setLicenseNumber] = useState(initialNumber)
  const [expiry, setExpiry] = useState(initialExpiry)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const dirty =
    state !== initialState ||
    licenseNumber !== initialNumber ||
    expiry !== initialExpiry

  async function save() {
    if (busy) return
    setBusy(true)
    setErr(null)
    setSaved(false)
    try {
      const res = await fetch('/api/v1/pro/license', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          licenseState: state,
          licenseNumber,
          licenseExpiry: expiry,
        }),
      })
      const data = await safeJsonRecord(res)
      if (!res.ok) {
        throw new Error(readErrorMessage(data) ?? `Save failed (${res.status}).`)
      }
      setSaved(true)
      router.refresh()
    } catch (e: unknown) {
      setErr(errorMessageFromUnknown(e, 'Save failed.'))
    } finally {
      setBusy(false)
    }
  }

  const field =
    'w-full rounded-lg border border-white/10 bg-bgPrimary/40 px-2 py-1.5 text-sm text-textPrimary'

  return (
    <div className="rounded-card border border-white/10 bg-bgPrimary/30 p-4">
      <div className="text-xs font-extrabold text-textSecondary">License</div>

      <div className="mt-3 grid gap-3">
        <label className="grid gap-1">
          <span className="text-[11px] font-black text-textSecondary">State</span>
          <select className={field} value={state} onChange={(e) => setState(e.target.value)}>
            <option value="">Select state…</option>
            {US_STATES.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1">
          <span className="text-[11px] font-black text-textSecondary">License / registration number</span>
          <input
            className={field}
            value={licenseNumber}
            onChange={(e) => setLicenseNumber(e.target.value)}
            placeholder="e.g. 123456"
            autoCapitalize="characters"
          />
        </label>

        <label className="grid gap-1">
          <span className="text-[11px] font-black text-textSecondary">Expiration date</span>
          <input
            className={field}
            type="date"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
          />
        </label>

        <button
          type="button"
          disabled={busy || !dirty}
          onClick={save}
          className={[
            'inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-black transition',
            'border border-accentPrimary/35 bg-accentPrimary/26 text-textPrimary',
            busy || !dirty ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-accentPrimary/30',
          ].join(' ')}
        >
          {busy ? 'Saving…' : 'Save license info'}
        </button>

        {saved ? (
          <div className="text-[12px] text-toneSuccess">
            Saved — sent to admin for re-review. Your access isn’t affected.
          </div>
        ) : null}
        {err ? <div className="text-[12px] text-toneDanger">{err}</div> : null}
      </div>
    </div>
  )
}
