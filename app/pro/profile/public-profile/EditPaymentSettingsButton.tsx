// app/pro/profile/public-profile/EditPaymentSettingsButton.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { NoShowFeeType } from '@prisma/client'
import { isRecord } from '@/lib/guards'
import { safeJson, readErrorMessage, errorMessageFromUnknown } from '@/lib/http'
import { zClass } from '@/lib/zIndex'
import type {
  ProNoShowSettingsDTO,
  ProNoShowSettingsUpdateRequestDTO,
} from '@/lib/dto/noShowSettings'

export type PaymentCollectionTiming = 'AT_BOOKING' | 'AFTER_SERVICE'
export type DepositType = 'FLAT' | 'PERCENT'
export type DepositScope =
  | 'NEW_DISCOVERY_ONLY'
  | 'ALL_NEW_CLIENTS'
  | 'ALL_CLIENTS'

type TipSuggestionInput = {
  label: string
  percent: number
}

type Props = {
  initial: {
    collectPaymentAt: PaymentCollectionTiming

    depositEnabled: boolean
    depositType: DepositType
    depositFlatAmount: string | null
    depositPercent: number | null
    depositScope: DepositScope

    acceptCash: boolean
    acceptCardOnFile: boolean
    acceptTapToPay: boolean
    acceptVenmo: boolean
    acceptZelle: boolean
    acceptAppleCash: boolean
    acceptPaypal: boolean
    acceptApplePay: boolean

    tipsEnabled: boolean
    allowCustomTip: boolean
    tipSuggestions: TipSuggestionInput[] | null

    venmoHandle: string | null
    zelleHandle: string | null
    appleCashHandle: string | null
    paypalHandle: string | null
    paymentNote: string | null
  } | null

  /**
   * Phase 2 revenue protection flag (server-side `noShowProtectionEnabled()`).
   * When false, the "No-show & late-cancel fees" section is not rendered and the
   * separate no-show endpoints are never touched.
   */
  noShowFeatureEnabled?: boolean
}

// The cancel window is locked to 24h at launch — not an editable field.
const NO_SHOW_CANCEL_WINDOW_HOURS = 24

type TipSuggestionDraft = {
  id: string
  label: string
  percent: string
}

function makeDraftId() {
  return `tip_${Math.random().toString(36).slice(2, 10)}`
}

function normalizeHandleInput(value: string): string {
  return value.trim()
}

function normalizeTipPercentInput(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) return ''
  if (parsed < 0) return '0'
  if (parsed > 100) return '100'
  return String(parsed)
}

function defaultTipSuggestionDrafts(
  input: TipSuggestionInput[] | null | undefined,
): TipSuggestionDraft[] {
  if (Array.isArray(input) && input.length > 0) {
    return input
      .filter(
        (row) =>
          row &&
          typeof row.label === 'string' &&
          row.label.trim() &&
          typeof row.percent === 'number' &&
          Number.isFinite(row.percent),
      )
      .map((row) => ({
        id: makeDraftId(),
        label: row.label.trim(),
        percent: String(row.percent),
      }))
  }

  return [
    { id: makeDraftId(), label: '18%', percent: '18' },
    { id: makeDraftId(), label: '20%', percent: '20' },
    { id: makeDraftId(), label: '25%', percent: '25' },
  ]
}

function parseTipSuggestionsForSave(
  rows: TipSuggestionDraft[],
): TipSuggestionInput[] {
  return rows
    .map((row) => {
      const label = row.label.trim()
      const percent = Number(row.percent.trim())

      if (!label || !Number.isFinite(percent)) return null
      if (percent < 0 || percent > 100) return null

      return {
        label,
        percent,
      }
    })
    .filter((row): row is TipSuggestionInput => row !== null)
}

function extractErrorMessage(data: unknown): string | null {
  if (!isRecord(data)) return readErrorMessage(data)
  const message = data.message
  if (typeof message === 'string' && message.trim()) return message.trim()
  return readErrorMessage(data)
}

function parseNoShowSettings(data: unknown): ProNoShowSettingsDTO | null {
  if (!isRecord(data)) return null

  const settings = data.settings
  if (!isRecord(settings)) return null

  const feeType = settings.feeType
  if (feeType !== 'FLAT' && feeType !== 'PERCENT') return null

  return {
    enabled: settings.enabled === true,
    feeType,
    feeFlatAmount:
      typeof settings.feeFlatAmount === 'string' ? settings.feeFlatAmount : null,
    feePercent:
      typeof settings.feePercent === 'number' ? settings.feePercent : null,
    cancelWindowHours:
      typeof settings.cancelWindowHours === 'number'
        ? settings.cancelWindowHours
        : NO_SHOW_CANCEL_WINDOW_HOURS,
    chargeNoShow: settings.chargeNoShow === true,
    chargeLateCancel: settings.chargeLateCancel === true,
  }
}

export default function EditPaymentSettingsButton({
  initial,
  noShowFeatureEnabled = false,
}: Props) {
  const router = useRouter()
  const closeBtnRef = useRef<HTMLButtonElement | null>(null)

  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [closing, setClosing] = useState(false)

  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [collectPaymentAt, setCollectPaymentAt] =
    useState<PaymentCollectionTiming>(
      initial?.collectPaymentAt ?? 'AFTER_SERVICE',
    )

  const [depositEnabled, setDepositEnabled] = useState(
    initial?.depositEnabled ?? false,
  )
  const [depositType, setDepositType] = useState<DepositType>(
    initial?.depositType ?? 'FLAT',
  )
  const [depositFlatAmount, setDepositFlatAmount] = useState(
    initial?.depositFlatAmount ?? '',
  )
  const [depositPercent, setDepositPercent] = useState(
    initial?.depositPercent != null ? String(initial.depositPercent) : '',
  )
  const [depositScope, setDepositScope] = useState<DepositScope>(
    initial?.depositScope ?? 'NEW_DISCOVERY_ONLY',
  )

  const [acceptCash, setAcceptCash] = useState(initial?.acceptCash ?? true)
  const [acceptCardOnFile, setAcceptCardOnFile] = useState(
    initial?.acceptCardOnFile ?? false,
  )
  const [acceptTapToPay, setAcceptTapToPay] = useState(
    initial?.acceptTapToPay ?? false,
  )
  const [acceptVenmo, setAcceptVenmo] = useState(initial?.acceptVenmo ?? false)
  const [acceptZelle, setAcceptZelle] = useState(initial?.acceptZelle ?? false)
  const [acceptAppleCash, setAcceptAppleCash] = useState(
    initial?.acceptAppleCash ?? false,
  )
  const [acceptPaypal, setAcceptPaypal] = useState(initial?.acceptPaypal ?? false)
  const [acceptApplePay, setAcceptApplePay] = useState(
    initial?.acceptApplePay ?? false,
  )

  const [tipsEnabled, setTipsEnabled] = useState(initial?.tipsEnabled ?? true)
  const [allowCustomTip, setAllowCustomTip] = useState(
    initial?.allowCustomTip ?? true,
  )
  const [tipSuggestions, setTipSuggestions] = useState<TipSuggestionDraft[]>(
    defaultTipSuggestionDrafts(initial?.tipSuggestions),
  )

  const [venmoHandle, setVenmoHandle] = useState(initial?.venmoHandle ?? '')
  const [zelleHandle, setZelleHandle] = useState(initial?.zelleHandle ?? '')
  const [appleCashHandle, setAppleCashHandle] = useState(
    initial?.appleCashHandle ?? '',
  )
  const [paypalHandle, setPaypalHandle] = useState(initial?.paypalHandle ?? '')
  const [paymentNote, setPaymentNote] = useState(initial?.paymentNote ?? '')

  // No-show / late-cancel fees load from + save to their own endpoints, gated on
  // `noShowFeatureEnabled`. The 24h cancel window is fixed and echoed back on save.
  const [noShowEnabled, setNoShowEnabled] = useState(false)
  const [noShowFeeType, setNoShowFeeType] = useState<NoShowFeeType>('FLAT')
  const [noShowFeeFlatAmount, setNoShowFeeFlatAmount] = useState('')
  const [noShowFeePercent, setNoShowFeePercent] = useState('')
  const [chargeNoShow, setChargeNoShow] = useState(true)
  const [chargeLateCancel, setChargeLateCancel] = useState(true)
  const noShowCancelWindowHoursRef = useRef(NO_SHOW_CANCEL_WINDOW_HOURS)

  const busy = saving

  function beginClose() {
    if (busy) return
    setClosing(true)
    window.setTimeout(() => {
      setOpen(false)
      setClosing(false)
      setMounted(false)
      setSavedFlash(false)
      setError(null)
    }, 140)
  }

  useEffect(() => {
    if (!open) return
    setMounted(false)
    const t = window.setTimeout(() => setMounted(true), 10)
    return () => window.clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') beginClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, busy])

  useEffect(() => {
    if (!open) return
    closeBtnRef.current?.focus()
  }, [open])

  // Load the pro's current no-show / late-cancel fee policy when the modal opens.
  // A 404 (flag off) or any failure leaves the section on its defaults.
  useEffect(() => {
    if (!open || !noShowFeatureEnabled) return
    let cancelled = false

    void (async () => {
      try {
        const res = await fetch('/api/v1/pro/no-show-settings', {
          headers: { Accept: 'application/json' },
        })
        if (!res.ok) return
        const data = await safeJson(res)
        const parsed = parseNoShowSettings(data)
        if (!parsed || cancelled) return

        setNoShowEnabled(parsed.enabled)
        setNoShowFeeType(parsed.feeType)
        setNoShowFeeFlatAmount(parsed.feeFlatAmount ?? '')
        setNoShowFeePercent(
          parsed.feePercent != null ? String(parsed.feePercent) : '',
        )
        setChargeNoShow(parsed.chargeNoShow)
        setChargeLateCancel(parsed.chargeLateCancel)
        noShowCancelWindowHoursRef.current = parsed.cancelWindowHours
      } catch {
        // Leave defaults in place — the section still saves cleanly.
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open, noShowFeatureEnabled])

  const acceptedMethodsCount = useMemo(() => {
    return [
      acceptCash,
      acceptCardOnFile,
      acceptTapToPay,
      acceptVenmo,
      acceptZelle,
      acceptAppleCash,
      acceptPaypal,
      acceptApplePay,
    ].filter(Boolean).length
  }, [
    acceptCash,
    acceptCardOnFile,
    acceptTapToPay,
    acceptVenmo,
    acceptZelle,
    acceptAppleCash,
    acceptPaypal,
    acceptApplePay,
  ])

  function updateTipSuggestion(
    id: string,
    patch: Partial<Pick<TipSuggestionDraft, 'label' | 'percent'>>,
  ) {
    setTipSuggestions((current) =>
      current.map((row) =>
        row.id === id
          ? {
              ...row,
              ...patch,
            }
          : row,
      ),
    )
  }

  function removeTipSuggestion(id: string) {
    setTipSuggestions((current) => current.filter((row) => row.id !== id))
  }

  function addTipSuggestion() {
    setTipSuggestions((current) => [
      ...current,
      { id: makeDraftId(), label: '', percent: '' },
    ])
  }

  async function save() {
    try {
      setSaving(true)
      setError(null)

      const payload = {
        collectPaymentAt,

        depositEnabled,
        depositType,
        depositScope,
        depositFlatAmount:
          depositEnabled && depositType === 'FLAT'
            ? depositFlatAmount.trim()
            : null,
        depositPercent:
          depositEnabled && depositType === 'PERCENT'
            ? depositPercent.trim()
            : null,

        acceptCash,
        acceptCardOnFile,
        acceptTapToPay,
        acceptVenmo,
        acceptZelle,
        acceptAppleCash,
        acceptPaypal,
        acceptApplePay,

        tipsEnabled,
        allowCustomTip,
        tipSuggestions: tipsEnabled
          ? parseTipSuggestionsForSave(tipSuggestions)
          : [],

        venmoHandle: acceptVenmo ? normalizeHandleInput(venmoHandle) : '',
        zelleHandle: acceptZelle ? normalizeHandleInput(zelleHandle) : '',
        appleCashHandle: acceptAppleCash
          ? normalizeHandleInput(appleCashHandle)
          : '',
        paypalHandle: acceptPaypal ? normalizeHandleInput(paypalHandle) : '',
        paymentNote: paymentNote.trim(),
      }

      const res = await fetch('/api/v1/pro/payment-settings', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
      })

      const data = await safeJson(res)

      if (!res.ok) {
        throw new Error(
          extractErrorMessage(data) ?? 'Failed to save payment settings.',
        )
      }

      // No-show / late-cancel fees save through their own endpoint — never part
      // of the payment-settings PATCH payload above.
      if (noShowFeatureEnabled) {
        const noShowPayload: ProNoShowSettingsUpdateRequestDTO = {
          enabled: noShowEnabled,
          feeType: noShowFeeType,
          feeFlatAmount:
            noShowEnabled && noShowFeeType === 'FLAT'
              ? noShowFeeFlatAmount.trim()
              : null,
          feePercent:
            noShowEnabled &&
            noShowFeeType === 'PERCENT' &&
            noShowFeePercent.trim()
              ? Number(noShowFeePercent.trim())
              : null,
          cancelWindowHours: noShowCancelWindowHoursRef.current,
          chargeNoShow,
          chargeLateCancel,
        }

        const noShowRes = await fetch('/api/v1/pro/no-show-settings', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(noShowPayload),
        })

        const noShowData = await safeJson(noShowRes)

        if (!noShowRes.ok) {
          throw new Error(
            extractErrorMessage(noShowData) ??
              'Failed to save no-show fee settings.',
          )
        }
      }

      setSavedFlash(true)
      router.refresh()
      window.setTimeout(() => beginClose(), 250)
    } catch (e: unknown) {
      setError(errorMessageFromUnknown(e))
    } finally {
      setSaving(false)
      window.setTimeout(() => setSavedFlash(false), 800)
    }
  }

  const statusText = savedFlash ? 'Saved ✓' : saving ? 'Saving…' : null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full border border-white/10 bg-bgSecondary px-3 py-2 text-[12px] font-black text-textPrimary hover:border-white/20"
      >
        Payment settings
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Edit payment settings"
          className={[
            // Sit above the fixed app footer (z-index 999999 in layout.tsx);
            // otherwise the footer bar overlaps the modal and intercepts taps on
            // the Save button at the bottom. The extra bottom padding keeps the
            // dialog (and its action row) clear of the footer/safe-area zone.
            'fixed inset-0 grid place-items-center p-4',
            zClass.modal,
            'pb-[calc(1.5rem+env(safe-area-inset-bottom))]',
            'bg-black/70 backdrop-blur-sm',
            'transition-opacity duration-150 ease-out',
            mounted && !closing ? 'opacity-100' : 'opacity-0',
          ].join(' ')}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) beginClose()
          }}
        >
          <div
            className={[
              'tovis-glass w-full max-w-180 max-h-[85vh] overflow-y-auto rounded-card border border-white/10 bg-bgSecondary p-4',
              'transform-gpu transition-all duration-150 ease-out',
              mounted && !closing
                ? 'translate-y-0 scale-100 opacity-100'
                : 'translate-y-2 scale-[0.985] opacity-0',
            ].join(' ')}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[13px] font-black text-textPrimary">
                  Payment settings
                </div>
                <div className="mt-1 text-[12px] text-textSecondary">
                  Control checkout timing, accepted methods, and tipping.
                </div>
              </div>

              <button
                ref={closeBtnRef}
                type="button"
                onClick={beginClose}
                className={[
                  'grid h-9 w-9 place-items-center rounded-full border text-[14px] font-black',
                  busy
                    ? 'cursor-not-allowed border-white/10 text-textSecondary opacity-70'
                    : 'border-white/10 text-textPrimary hover:border-white/20',
                ].join(' ')}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 grid gap-5">
              <SectionCard
                title="Collection timing"
                subtitle="Choose when payment is normally collected for this professional."
              >
                <div className="grid gap-2">
                  <RadioRow
                    checked={collectPaymentAt === 'AT_BOOKING'}
                    onChange={() => setCollectPaymentAt('AT_BOOKING')}
                    label="Collect at booking"
                    description="Use this when bookings should be paid up front."
                    disabled={busy}
                  />
                  <RadioRow
                    checked={collectPaymentAt === 'AFTER_SERVICE'}
                    onChange={() => setCollectPaymentAt('AFTER_SERVICE')}
                    label="Collect after service"
                    description="Use this when checkout happens after the booking."
                    disabled={busy}
                  />
                </div>
              </SectionCard>

              <SectionCard
                title="Deposits"
                subtitle="Require a deposit to hold the booking. New clients who find you through the Looks feed or Discovery also pay a one-time booking fee, processed with the deposit through Stripe."
              >
                <div className="grid gap-3">
                  <ToggleRow
                    checked={depositEnabled}
                    onChange={setDepositEnabled}
                    label="Require a deposit"
                    description="Collected up front via card and credited toward the final total."
                    disabled={busy}
                  />

                  {depositEnabled ? (
                    <>
                      <div className="grid gap-2">
                        <div className="text-[12px] font-black text-textSecondary">
                          Deposit amount
                        </div>
                        <div className="grid gap-2 md:grid-cols-2">
                          <RadioRow
                            checked={depositType === 'FLAT'}
                            onChange={() => setDepositType('FLAT')}
                            label="Flat amount"
                            description="A fixed dollar deposit."
                            disabled={busy}
                            name="depositType"
                          />
                          <RadioRow
                            checked={depositType === 'PERCENT'}
                            onChange={() => setDepositType('PERCENT')}
                            label="Percent of price"
                            description="A share of the service price."
                            disabled={busy}
                            name="depositType"
                          />
                        </div>
                      </div>

                      {depositType === 'FLAT' ? (
                        <TextInput
                          label="Deposit amount ($)"
                          value={depositFlatAmount}
                          onChange={setDepositFlatAmount}
                          placeholder="e.g. 20"
                          disabled={busy}
                        />
                      ) : (
                        <TextInput
                          label="Deposit percent (1–100)"
                          value={depositPercent}
                          onChange={setDepositPercent}
                          placeholder="e.g. 25"
                          disabled={busy}
                        />
                      )}

                      <div className="grid gap-2">
                        <div className="text-[12px] font-black text-textSecondary">
                          Who leaves a deposit
                        </div>
                        <RadioRow
                          checked={depositScope === 'NEW_DISCOVERY_ONLY'}
                          onChange={() => setDepositScope('NEW_DISCOVERY_ONLY')}
                          label="New clients from Looks / Discovery only"
                          description="Recommended. Only brand-new clients who found you through the feed."
                          disabled={busy}
                          name="depositScope"
                        />
                        <RadioRow
                          checked={depositScope === 'ALL_NEW_CLIENTS'}
                          onChange={() => setDepositScope('ALL_NEW_CLIENTS')}
                          label="All first-time clients"
                          description="Any client booking with you for the first time."
                          disabled={busy}
                          name="depositScope"
                        />
                        <RadioRow
                          checked={depositScope === 'ALL_CLIENTS'}
                          onChange={() => setDepositScope('ALL_CLIENTS')}
                          label="Every booking"
                          description="Charge a deposit on all bookings."
                          disabled={busy}
                          name="depositScope"
                        />
                      </div>

                      <div className="rounded-card border border-white/10 bg-bgPrimary/60 p-3 text-[11px] text-textSecondary">
                        Deposits require Stripe payouts to be set up. The one-time
                        booking fee applies only to brand-new Looks/Discovery
                        clients — never to your existing clients.
                      </div>
                    </>
                  ) : null}
                </div>
              </SectionCard>

              {noShowFeatureEnabled ? (
                <SectionCard
                  title="No-show & late-cancel fees"
                  subtitle="Protect your time by charging a fee when a client no-shows or cancels at the last minute. Fees are charged to the client's saved card on file."
                >
                  <div className="grid gap-3">
                    <ToggleRow
                      checked={noShowEnabled}
                      onChange={setNoShowEnabled}
                      label="Charge a no-show / late-cancel fee"
                      description="When on, eligible bookings can be charged the fee below."
                      disabled={busy}
                    />

                    {noShowEnabled ? (
                      <>
                        <div className="grid gap-2">
                          <div className="text-[12px] font-black text-textSecondary">
                            Fee amount
                          </div>
                          <div className="grid gap-2 md:grid-cols-2">
                            <RadioRow
                              checked={noShowFeeType === 'FLAT'}
                              onChange={() => setNoShowFeeType('FLAT')}
                              label="Flat amount"
                              description="A fixed dollar fee."
                              disabled={busy}
                              name="noShowFeeType"
                            />
                            <RadioRow
                              checked={noShowFeeType === 'PERCENT'}
                              onChange={() => setNoShowFeeType('PERCENT')}
                              label="Percent of price"
                              description="A share of the booking total."
                              disabled={busy}
                              name="noShowFeeType"
                            />
                          </div>
                        </div>

                        {noShowFeeType === 'FLAT' ? (
                          <TextInput
                            label="Fee amount ($)"
                            value={noShowFeeFlatAmount}
                            onChange={setNoShowFeeFlatAmount}
                            placeholder="e.g. 25"
                            disabled={busy}
                          />
                        ) : (
                          <TextInput
                            label="Fee percent (1–100)"
                            value={noShowFeePercent}
                            onChange={setNoShowFeePercent}
                            placeholder="e.g. 50"
                            disabled={busy}
                          />
                        )}

                        <div className="grid gap-3">
                          <div className="text-[12px] font-black text-textSecondary">
                            When the fee applies
                          </div>
                          <ToggleRow
                            checked={chargeNoShow}
                            onChange={setChargeNoShow}
                            label="No-shows"
                            description="Charge when you mark a booking as a no-show."
                            disabled={busy}
                          />
                          <ToggleRow
                            checked={chargeLateCancel}
                            onChange={setChargeLateCancel}
                            label="Late cancellations"
                            description="Charge when a client cancels within 24 hours of the appointment."
                            disabled={busy}
                          />
                        </div>

                        <div className="rounded-card border border-white/10 bg-bgPrimary/60 p-3 text-[11px] text-textSecondary">
                          Applies to cancellations within 24 hours of the
                          appointment. Charging a fee requires the client to have
                          a saved card on file.
                        </div>
                      </>
                    ) : null}
                  </div>
                </SectionCard>
              ) : null}

              <SectionCard
                title="Accepted methods"
                subtitle={`Currently enabled: ${acceptedMethodsCount}`}
              >
                <div className="grid gap-3">
                  <ToggleRow
                    checked={acceptCash}
                    onChange={setAcceptCash}
                    label="Cash"
                    description="Show cash as an accepted payment method."
                    disabled={busy}
                  />

                  <ToggleRow
                    checked={acceptCardOnFile}
                    onChange={setAcceptCardOnFile}
                    label="Card on file"
                    description="Show saved card payment as accepted."
                    disabled={busy}
                  />

                  <ToggleRow
                    checked={acceptTapToPay}
                    onChange={setAcceptTapToPay}
                    label="Tap to pay"
                    description="Show in-person tap to pay as accepted."
                    disabled={busy}
                  />

                  <ToggleRow
                    checked={acceptVenmo}
                    onChange={setAcceptVenmo}
                    label="Venmo"
                    description="Show Venmo as accepted."
                    disabled={busy}
                  />

                  {acceptVenmo ? (
                    <TextInput
                      label="Venmo handle"
                      value={venmoHandle}
                      onChange={setVenmoHandle}
                      placeholder="@yourhandle"
                      disabled={busy}
                    />
                  ) : null}

                  <ToggleRow
                    checked={acceptZelle}
                    onChange={setAcceptZelle}
                    label="Zelle"
                    description="Show Zelle as accepted."
                    disabled={busy}
                  />

                  {acceptZelle ? (
                    <TextInput
                      label="Zelle handle or contact"
                      value={zelleHandle}
                      onChange={setZelleHandle}
                      placeholder="email or phone"
                      disabled={busy}
                    />
                  ) : null}

                  <ToggleRow
                    checked={acceptAppleCash}
                    onChange={setAcceptAppleCash}
                    label="Apple Cash"
                    description="Show Apple Cash as accepted."
                    disabled={busy}
                  />

                  {acceptAppleCash ? (
                    <TextInput
                      label="Apple Cash handle or contact"
                      value={appleCashHandle}
                      onChange={setAppleCashHandle}
                      placeholder="phone, email, or handle"
                      disabled={busy}
                    />
                  ) : null}

                  <ToggleRow
                    checked={acceptPaypal}
                    onChange={setAcceptPaypal}
                    label="PayPal"
                    description="Show PayPal as accepted."
                    disabled={busy}
                  />

                  {acceptPaypal ? (
                    <TextInput
                      label="PayPal link or handle"
                      value={paypalHandle}
                      onChange={setPaypalHandle}
                      placeholder="paypal.me/you or @handle"
                      disabled={busy}
                    />
                  ) : null}

                  <ToggleRow
                    checked={acceptApplePay}
                    onChange={setAcceptApplePay}
                    label="Apple Pay"
                    description="Show Apple Pay as accepted (in person)."
                    disabled={busy}
                  />
                </div>
              </SectionCard>

              <SectionCard
                title="Tips"
                subtitle="Tip applies to services only, not product purchases."
              >
                <div className="grid gap-3">
                  <ToggleRow
                    checked={tipsEnabled}
                    onChange={setTipsEnabled}
                    label="Enable tips"
                    description="Allow clients to add a tip during checkout."
                    disabled={busy}
                  />

                  {tipsEnabled ? (
                    <>
                      <ToggleRow
                        checked={allowCustomTip}
                        onChange={setAllowCustomTip}
                        label="Allow custom tip"
                        description="Clients can enter a custom tip amount."
                        disabled={busy}
                      />

                      <div className="grid gap-2">
                        <div className="text-[12px] font-black text-textSecondary">
                          Suggested tip options
                        </div>

                        {tipSuggestions.map((row) => (
                          <div
                            key={row.id}
                            className="grid gap-2 rounded-card border border-white/10 bg-bgPrimary p-3 md:grid-cols-[1fr_120px_auto]"
                          >
                            <div>
                              <div className="mb-1 text-[11px] font-black text-textSecondary">
                                Label
                              </div>
                              <input
                                value={row.label}
                                onChange={(e) =>
                                  updateTipSuggestion(row.id, {
                                    label: e.target.value,
                                  })
                                }
                                className="w-full rounded-xl border border-white/10 bg-bgSecondary px-3 py-3 text-[13px] text-textPrimary placeholder:text-textSecondary focus:outline-none focus:ring-2 focus:ring-accentPrimary/40"
                                placeholder="e.g. 20%"
                                disabled={busy}
                              />
                            </div>

                            <div>
                              <div className="mb-1 text-[11px] font-black text-textSecondary">
                                Percent
                              </div>
                              <input
                                value={row.percent}
                                onChange={(e) =>
                                  updateTipSuggestion(row.id, {
                                    percent: normalizeTipPercentInput(
                                      e.target.value,
                                    ),
                                  })
                                }
                                className="w-full rounded-xl border border-white/10 bg-bgSecondary px-3 py-3 text-[13px] text-textPrimary placeholder:text-textSecondary focus:outline-none focus:ring-2 focus:ring-accentPrimary/40"
                                placeholder="20"
                                inputMode="decimal"
                                disabled={busy}
                              />
                            </div>

                            <div className="flex items-end">
                              <button
                                type="button"
                                onClick={() => removeTipSuggestion(row.id)}
                                disabled={busy || tipSuggestions.length <= 1}
                                className={[
                                  'rounded-card border px-3 py-3 text-[12px] font-black transition',
                                  busy || tipSuggestions.length <= 1
                                    ? 'cursor-not-allowed border-white/10 bg-bgSecondary text-textSecondary opacity-70'
                                    : 'border-white/10 bg-bgSecondary text-textPrimary hover:border-white/20',
                                ].join(' ')}
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        ))}

                        <div>
                          <button
                            type="button"
                            onClick={addTipSuggestion}
                            disabled={busy}
                            className={[
                              'rounded-card border px-3 py-2 text-[12px] font-black transition',
                              busy
                                ? 'cursor-not-allowed border-white/10 bg-bgPrimary text-textSecondary opacity-70'
                                : 'border-white/10 bg-bgPrimary text-textPrimary hover:border-white/20',
                            ].join(' ')}
                          >
                            Add tip option
                          </button>
                        </div>
                      </div>
                    </>
                  ) : null}
                </div>
              </SectionCard>

              <SectionCard
                title="Client note"
                subtitle="Optional note shown with payment methods during checkout."
              >
                <textarea
                  value={paymentNote}
                  onChange={(e) => setPaymentNote(e.target.value)}
                  rows={4}
                  className="w-full resize-y rounded-xl border border-white/10 bg-bgPrimary px-3 py-3 text-[13px] text-textPrimary placeholder:text-textSecondary focus:outline-none focus:ring-2 focus:ring-accentPrimary/40"
                  placeholder="Example: Please have payment ready after your booking."
                  disabled={busy}
                />
              </SectionCard>

              {error ? (
                <div className="text-[12px] text-toneDanger">{error}</div>
              ) : null}

              <div className="mt-1 flex items-center justify-end gap-3">
                {statusText ? (
                  <div className="text-[12px] font-black text-textSecondary">
                    {statusText}
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={beginClose}
                  disabled={busy}
                  className={[
                    'rounded-card border px-4 py-3 text-[13px] font-black transition',
                    busy
                      ? 'cursor-not-allowed border-white/10 bg-bgPrimary text-textSecondary opacity-70'
                      : 'border-white/10 bg-bgPrimary text-textPrimary hover:border-white/20',
                  ].join(' ')}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={save}
                  disabled={busy}
                  className={[
                    'rounded-card border px-4 py-3 text-[13px] font-black transition',
                    busy
                      ? 'cursor-not-allowed border-white/10 bg-bgPrimary text-textSecondary opacity-70'
                      : 'border-accentPrimary/60 bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover',
                  ].join(' ')}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

function SectionCard(props: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-card border border-white/10 bg-bgPrimary/40 p-4">
      <div className="min-w-0">
        <div className="text-[12px] font-black text-textPrimary">
          {props.title}
        </div>
        {props.subtitle ? (
          <div className="mt-1 text-[11px] text-textSecondary">
            {props.subtitle}
          </div>
        ) : null}
      </div>

      <div className="mt-3">{props.children}</div>
    </section>
  )
}

function ToggleRow(props: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  description?: string
  disabled?: boolean
}) {
  return (
    <label className="flex items-start gap-3 rounded-card border border-white/10 bg-bgPrimary p-3">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
        disabled={props.disabled}
        className="mt-1 h-4 w-4 rounded border-white/20 bg-bgSecondary text-accentPrimary focus:ring-accentPrimary/40"
      />

      <div className="min-w-0">
        <div className="text-[13px] font-black text-textPrimary">
          {props.label}
        </div>
        {props.description ? (
          <div className="mt-1 text-[12px] text-textSecondary">
            {props.description}
          </div>
        ) : null}
      </div>
    </label>
  )
}

function RadioRow(props: {
  checked: boolean
  onChange: () => void
  label: string
  description?: string
  disabled?: boolean
  name?: string
}) {
  return (
    <label className="flex items-start gap-3 rounded-card border border-white/10 bg-bgPrimary p-3">
      <input
        type="radio"
        name={props.name ?? 'collectPaymentAt'}
        checked={props.checked}
        onChange={props.onChange}
        disabled={props.disabled}
        className="mt-1 h-4 w-4 border-white/20 bg-bgSecondary text-accentPrimary focus:ring-accentPrimary/40"
      />

      <div className="min-w-0">
        <div className="text-[13px] font-black text-textPrimary">
          {props.label}
        </div>
        {props.description ? (
          <div className="mt-1 text-[12px] text-textSecondary">
            {props.description}
          </div>
        ) : null}
      </div>
    </label>
  )
}

function TextInput(props: {
  label: string
  value: string
  onChange: (next: string) => void
  placeholder?: string
  disabled?: boolean
}) {
  return (
    <label className="grid gap-2">
      <div className="text-[12px] font-black text-textSecondary">
        {props.label}
      </div>
      <input
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="w-full rounded-xl border border-white/10 bg-bgPrimary px-3 py-3 text-[13px] text-textPrimary placeholder:text-textSecondary focus:outline-none focus:ring-2 focus:ring-accentPrimary/40"
        placeholder={props.placeholder}
        disabled={props.disabled}
      />
    </label>
  )
}