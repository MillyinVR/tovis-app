// app/pro/calendar/_components/BookingOverrideConfirmModal.tsx
'use client'

import { useEffect } from 'react'

import type {
  BookingOverridePrompt,
  BookingOverridePromptIntent,
} from '@/lib/booking/overridePrompts'

// ─── Types ────────────────────────────────────────────────────────────────────

type BookingOverrideConfirmModalProps = {
  open: boolean
  prompt: BookingOverridePrompt | null
  busy: boolean
  reason: string
  intent?: BookingOverridePromptIntent
  onChangeReason: (value: string) => void
  onCancel: () => void
  onConfirm: () => void
}

type ButtonTone = 'primary' | 'ghost'

type ModalCopy = {
  title: string
  body: string
  confirmLabel: string
  busyLabel: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_OVERRIDE_REASON_LENGTH = 280

const MODAL_COPY: Record<BookingOverridePromptIntent, ModalCopy> = {
  accept: {
    title: 'Accept anyway?',
    body: 'Clients cannot normally book this slot. You can still accept it — the override is recorded, and you can optionally add a note for your client.',
    confirmLabel: 'Accept anyway',
    busyLabel: 'Accepting…',
  },
  edit: {
    title: 'Save anyway?',
    body: 'Clients cannot normally book this slot. You can still save this change — the override is recorded, and you can optionally add a note for your client.',
    confirmLabel: 'Save anyway',
    busyLabel: 'Saving…',
  },
  create: {
    title: 'Book anyway?',
    body: 'Clients cannot normally book this slot. You can still book it — the override is recorded, and you can optionally add a note for your client.',
    confirmLabel: 'Book anyway',
    busyLabel: 'Booking…',
  },
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function buttonClassName(tone: ButtonTone = 'ghost') {
  const base = [
    'rounded-full px-4 py-2 font-mono text-[11px] font-black uppercase tracking-[0.08em]',
    'transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentPrimary/40',
    'disabled:cursor-not-allowed disabled:opacity-60',
  ].join(' ')

  if (tone === 'primary') {
    return [
      base,
      'border border-accentPrimary/30 bg-accentPrimary text-ink hover:bg-accentPrimaryHover',
    ].join(' ')
  }

  return [
    base,
    'border border-[var(--line)] bg-transparent text-paperMute',
    'hover:bg-paper/5 hover:text-paper',
  ].join(' ')
}

function textareaClassName() {
  return [
    'w-full resize-none rounded-2xl border border-[var(--line)] bg-ink2 px-3 py-2',
    'text-sm font-semibold text-paper placeholder:text-paperMute',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentPrimary/40',
    'disabled:cursor-not-allowed disabled:opacity-60',
  ].join(' ')
}

function lockBodyScroll(open: boolean) {
  if (!open) return

  const previousOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'

  return () => {
    document.body.style.overflow = previousOverflow
  }
}

function closeOnEscape(args: {
  open: boolean
  busy: boolean
  onCancel: () => void
}) {
  const { open, busy, onCancel } = args

  if (!open) return

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !busy) {
      onCancel()
    }
  }

  window.addEventListener('keydown', onKeyDown)

  return () => window.removeEventListener('keydown', onKeyDown)
}

// ─── Exported component ───────────────────────────────────────────────────────

export function BookingOverrideConfirmModal(
  props: BookingOverrideConfirmModalProps,
) {
  const {
    open,
    prompt,
    busy,
    reason,
    intent = 'accept',
    onChangeReason,
    onCancel,
    onConfirm,
  } = props

  const copy = MODAL_COPY[intent]

  useEffect(() => lockBodyScroll(open), [open])

  useEffect(
    () =>
      closeOnEscape({
        open,
        busy,
        onCancel,
      }),
    [open, busy, onCancel],
  )

  if (!open || !prompt) return null

  const confirmDisabled = busy

  function cancel() {
    if (busy) return
    onCancel()
  }

  return (
    <div
      className="fixed inset-0 z-[1300] flex items-end justify-center bg-black/75 p-0 backdrop-blur-md sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="booking-override-title"
      onMouseDown={cancel}
    >
      <div
        className={[
          'flex max-h-[94vh] w-full flex-col overflow-hidden rounded-t-[24px]',
          'border border-[var(--line-strong)] bg-ink',
          'shadow-[0_28px_90px_rgb(0_0_0_/_0.62)]',
          'sm:max-w-[34rem] sm:rounded-[24px]',
        ].join(' ')}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="border-b border-[var(--line-strong)] bg-ink/95 px-4 py-4 backdrop-blur-xl sm:px-5">
          <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-paper/20 sm:hidden" />

          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-[10px] font-black uppercase tracking-[0.16em] text-terraGlow">
                ◆ Booking rule override
              </p>

              <h2
                id="booking-override-title"
                className="mt-1 font-display text-3xl font-semibold italic tracking-[-0.05em] text-paper"
              >
                {copy.title}
              </h2>

              <p className="mt-1 text-sm leading-6 text-paperDim">
                {prompt.question}
              </p>
            </div>

            <button
              type="button"
              onClick={cancel}
              disabled={busy}
              className={buttonClassName('ghost')}
            >
              Close
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
          <section className="rounded-2xl border border-toneWarn/25 bg-toneWarn/10 p-4">
            <p className="font-mono text-[10px] font-black uppercase tracking-[0.14em] text-toneWarn">
              Override needed
            </p>

            <p className="mt-2 text-sm leading-6 text-paperDim">
              {copy.body}
            </p>
          </section>

          <section className="mt-4">
            <label htmlFor="booking-override-reason">
              <span className="mb-1 block font-mono text-[9px] font-black uppercase tracking-[0.12em] text-paperMute">
                Reason (optional — shared with your client)
              </span>

              <textarea
                id="booking-override-reason"
                value={reason}
                onChange={(event) => onChangeReason(event.target.value)}
                rows={4}
                maxLength={MAX_OVERRIDE_REASON_LENGTH}
                placeholder={prompt.reasonPlaceholder}
                className={textareaClassName()}
                disabled={busy}
              />
            </label>

            <div className="mt-1 flex items-center justify-between gap-3 font-mono text-[9px] font-black uppercase tracking-[0.08em] text-paperMute">
              <span>Optional</span>
              <span>
                {reason.length}/{MAX_OVERRIDE_REASON_LENGTH}
              </span>
            </div>
          </section>
        </div>

        <footer className="border-t border-[var(--line-strong)] bg-ink/95 px-4 py-4 backdrop-blur-xl sm:px-5">
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={cancel}
              disabled={busy}
              className={buttonClassName('ghost')}
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={onConfirm}
              disabled={confirmDisabled}
              className={buttonClassName('primary')}
            >
              {busy ? copy.busyLabel : copy.confirmLabel}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
