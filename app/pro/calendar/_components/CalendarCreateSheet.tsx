// app/pro/calendar/_components/CalendarCreateSheet.tsx
'use client'

import { CalendarOff, CalendarPlus, type LucideIcon } from 'lucide-react'
import { Z } from '@/lib/zIndex'

// ─── Types ────────────────────────────────────────────────────────────────────

type CalendarCreateSheetProps = {
  open: boolean
  onClose: () => void
  heading: string
  appointmentLabel: string
  appointmentHint: string
  blockLabel: string
  blockHint: string
  onAddAppointment: () => void
  onBlockTime: () => void
}

type CreateRowProps = {
  Icon: LucideIcon
  label: string
  hint: string
  onClick: () => void
}

// ─── Exported component ───────────────────────────────────────────────────────

/**
 * Bottom action sheet for the calendar "+": choose between adding an appointment
 * or blocking personal time. Both branches reuse the calendar's existing flows
 * (new-booking route / block modal); this sheet only routes the choice.
 */
export function CalendarCreateSheet(props: CalendarCreateSheetProps) {
  const {
    open,
    onClose,
    heading,
    appointmentLabel,
    appointmentHint,
    blockLabel,
    blockHint,
    onAddAppointment,
    onBlockTime,
  } = props

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={heading}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: Z.modal,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
      }}
    >
      <button
        type="button"
        aria-label={heading}
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgb(var(--shadow-color) / 0.5)',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
        }}
      />

      <div
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 380,
          margin: '0 16px calc(16px + env(safe-area-inset-bottom))',
          background: 'rgb(var(--bg-surface))',
          border: '1px solid var(--line)',
          borderRadius: 18,
          padding: '18px 16px 14px',
          boxShadow: 'var(--shadow-strong)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 4px 12px',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 600,
              fontSize: 15,
              color: 'rgb(var(--text-primary))',
            }}
          >
            {heading}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label={heading}
            className="tap-target"
            style={{
              width: 24,
              height: 24,
              borderRadius: '50%',
              border: '1px solid var(--line)',
              background: 'transparent',
              color: 'rgb(var(--text-muted))',
              fontSize: 13,
              cursor: 'pointer',
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <CreateRow
            Icon={CalendarPlus}
            label={appointmentLabel}
            hint={appointmentHint}
            onClick={onAddAppointment}
          />
          <CreateRow
            Icon={CalendarOff}
            label={blockLabel}
            hint={blockHint}
            onClick={onBlockTime}
          />
        </div>
      </div>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function CreateRow(props: CreateRowProps) {
  const { Icon, label, hint, onClick } = props

  return (
    <button
      type="button"
      onClick={onClick}
      className="tovis-focus"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        textAlign: 'left',
        border: '1px solid var(--line)',
        borderRadius: 12,
        padding: '12px 13px',
        background: 'rgb(var(--bg-secondary))',
        cursor: 'pointer',
      }}
    >
      <span
        style={{
          display: 'grid',
          placeItems: 'center',
          width: 36,
          height: 36,
          borderRadius: '50%',
          background: 'rgb(var(--bg-surface))',
          border: '1px solid var(--line)',
          color: 'rgb(var(--accent-primary))',
        }}
      >
        <Icon size={18} aria-hidden="true" />
      </span>

      <span style={{ flex: 1 }}>
        <span
          style={{
            display: 'block',
            fontFamily: 'var(--font-display)',
            fontWeight: 600,
            fontSize: 14,
            color: 'rgb(var(--text-primary))',
          }}
        >
          {label}
        </span>
        <span
          style={{
            display: 'block',
            fontSize: 12,
            color: 'rgb(var(--text-muted))',
            marginTop: 1,
          }}
        >
          {hint}
        </span>
      </span>

      <span style={{ color: 'rgb(var(--text-muted))', fontSize: 18 }}>›</span>
    </button>
  )
}
