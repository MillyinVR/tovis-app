// app/pro/calendar/_components/EditScheduleOverlay.tsx
'use client'

import { useEffect, useId } from 'react'
import type { MouseEvent } from 'react'

import WorkingHoursTabs from './WorkingHoursTabs'

import type { BrandProCalendarCopy } from '@/lib/brand/types'
import type { LocationType } from './WorkingHoursForm'

// ─── Types ────────────────────────────────────────────────────────────────────

export type EditScheduleOverlayDevice = 'desktop' | 'tablet' | 'mobile'

type EditScheduleOverlayProps = {
  open: boolean
  device: EditScheduleOverlayDevice
  copy: BrandProCalendarCopy

  canSalon: boolean
  canMobile: boolean

  activeEditorType?: LocationType
  onChangeEditorType?: (next: LocationType) => void
  onSavedAny?: () => void

  onClose: () => void
}

type SheetHandleProps = {
  label: string
}

type CloseButtonProps = {
  label: string
  onClose: () => void
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function shouldShowSheetHandle(device: EditScheduleOverlayDevice): boolean {
  return device === 'tablet' || device === 'mobile'
}

function closeOnBackdropMouseDown(args: {
  event: MouseEvent<HTMLDivElement>
  onClose: () => void
}): void {
  const { event, onClose } = args

  if (event.target !== event.currentTarget) return

  onClose()
}

// ─── Exported component ───────────────────────────────────────────────────────

export function EditScheduleOverlay(props: EditScheduleOverlayProps) {
  const {
    open,
    device,
    copy,
    canSalon,
    canMobile,
    activeEditorType,
    onChangeEditorType,
    onSavedAny,
    onClose,
  } = props

  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    if (!open) return

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose, open])

  useEffect(() => {
    if (!open) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  if (!open) return null

  return (
    <div
      className="brand-pro-calendar-edit-schedule-overlay"
      data-device={device}
      data-open="true"
      role="presentation"
      onMouseDown={(event) =>
        closeOnBackdropMouseDown({
          event,
          onClose,
        })
      }
    >
      <section
        className="brand-pro-calendar-edit-schedule-sheet"
        data-device={device}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {shouldShowSheetHandle(device) ? (
          <SheetHandle label={copy.workingHours.overlay.dragHandleLabel} />
        ) : null}

        <header className="brand-pro-calendar-edit-schedule-header">
          <div className="brand-pro-calendar-edit-schedule-header-copy">
            <p className="brand-pro-calendar-edit-schedule-eyebrow">
              {copy.workingHours.overlay.eyebrow}
            </p>

            <h2
              id={titleId}
              className="brand-pro-calendar-edit-schedule-title"
            >
              {copy.workingHours.overlay.title}
            </h2>

            <p
              id={descriptionId}
              className="brand-pro-calendar-edit-schedule-description"
            >
              {copy.workingHours.overlay.description}
            </p>
          </div>

          <CloseButton
            label={copy.workingHours.actions.close}
            onClose={onClose}
          />
        </header>

        <div className="brand-pro-calendar-edit-schedule-body">
          <WorkingHoursTabs
            copy={copy.workingHours}
            canSalon={canSalon}
            canMobile={canMobile}
            activeEditorType={activeEditorType}
            onChangeEditorType={onChangeEditorType}
            onSavedAny={onSavedAny}
          />
        </div>
      </section>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SheetHandle(props: SheetHandleProps) {
  const { label } = props

  return (
    <div
      className="brand-pro-calendar-edit-schedule-handle-row"
      aria-label={label}
    >
      <span
        className="brand-pro-calendar-edit-schedule-handle"
        aria-hidden="true"
      />
    </div>
  )
}

function CloseButton(props: CloseButtonProps) {
  const { label, onClose } = props

  return (
    <button
      type="button"
      onClick={onClose}
      className="brand-pro-calendar-edit-schedule-close brand-focus"
      aria-label={label}
      title={label}
    >
      ×
    </button>
  )
}