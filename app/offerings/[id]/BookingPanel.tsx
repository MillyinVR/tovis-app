// app/offerings/[id]/BookingPanel.tsx
'use client'

import type { BookingPanelProps } from './_bookingPanel/types'
import { useBookingPanel } from './_bookingPanel/useBookingPanel'

import { PanelShell } from './_bookingPanel/components/PanelShell'
import { ReviewCard } from './_bookingPanel/components/ReviewCard'
import { SuccessActions } from './_bookingPanel/components/SuccessActions'
import { ModeToggle } from './_bookingPanel/components/ModeToggle'
import { MonthPicker } from './_bookingPanel/components/MonthPicker'
import { TimePicker } from './_bookingPanel/components/TimePicker'
import { ConfirmRow } from './_bookingPanel/components/ConfirmRow'
import { InlineNotice } from './_bookingPanel/components/InlineNotice'

export default function BookingPanel(props: BookingPanelProps) {
  const s = useBookingPanel(props)

  return (
    <PanelShell>
      <h2 className="mb-2 text-lg font-black">
        {s.success ? 'You’re booked' : 'Confirm your booking'}
      </h2>

      <ReviewCard
        title={s.success ? 'Confirmed' : 'Review'}
        statusRight={
          s.holdLabel && !s.success ? (
            <span className={s.holdUrgent ? 'text-red-200' : 'text-textPrimary'}>
              Slot held for {s.holdLabel}
            </span>
          ) : s.success ? (
            <span className="text-emerald-200">Done</span>
          ) : (
            <span className="text-textSecondary">Confirm and book</span>
          )
        }
        serviceName={props.serviceName || 'Service'}
        professionalName={props.professionalName || 'Professional'}
        reviewLine={s.reviewLine}
        viewerTimeLine={s.viewerTimeLine}
        footerLine={
          s.success
            ? 'Nice. Future You can’t pretend this never happened.'
            : s.holdLabel
              ? 'Finish booking before the hold expires.'
              : `Times are shown in the appointment timezone: ${s.proTz}.`
        }
        success={Boolean(s.success)}
      />

      {s.success && s.createdBookingId ? (
        <SuccessActions
          calendarHref={s.calendarHref}
          copied={s.copied}
          onCopy={s.copyShareLink}
        />
      ) : (
        <form onSubmit={s.handleSubmit} className="mt-3 grid gap-3">
          {s.showModeToggle ? (
            <ModeToggle
              value={s.locationType}
              disabled={s.loading || s.hasHold}
              onChange={s.onSwitchMode}
            />
          ) : (
            <div className="text-xs text-textSecondary">
              {s.locationType === 'MOBILE' ? 'Mobile appointment' : 'In-salon appointment'}
            </div>
          )}

          {!s.locationType ? (
            <InlineNotice tone="danger">
              This offering has no valid appointment type enabled. (No salon or mobile.)
            </InlineNotice>
          ) : null}

          <MonthPicker
            monthLabel={s.monthLabel}
            disabledAll={s.hasHold}
            disabledPrev={!s.canGoPrevMonth()}
            disabledNext={!s.canGoNextMonth()}
            onPrev={() => s.setMonthStartUtc((d) => s.addMonthsUtc(d, -1))}
            onNext={() => s.setMonthStartUtc((d) => s.addMonthsUtc(d, +1))}
            gridDays={s.gridDays.map((d) => ({ ymd: d.ymd, inMonth: d.inMonth }))}
            selectedYMD={s.selectedYMD}
            ymdWithinRange={s.ymdWithinRange}
            onPick={(ymd) => void s.onPickDate(ymd)}
            todayYMD={s.todayYMD}
            maxYMD={s.maxYMD}
          />

          <div className="text-xs text-textSecondary">
            Booking window: {s.todayYMD} → {s.maxYMD} ({s.proTz})
          </div>

          <TimePicker
            proTz={s.proTz}
            hasHold={s.hasHold}
            loading={s.loading}
            availabilityBusy={s.availabilityBusy}
            availabilityError={s.availabilityError}
            availableSlots={s.availableSlots}
            value={s.selectedSlotISO}
            onChange={s.onChangeSlot}
            formatSlotLabel={s.formatSlotLabel}
          />

          {s.missingHeldScheduledFor ? (
            <InlineNotice tone="danger">
              Hold is present but scheduledFor is missing. Go back and pick a slot again.
            </InlineNotice>
          ) : null}

          <ConfirmRow
            checked={s.confirmChecked}
            setChecked={s.setConfirmChecked}
            disabled={
              !s.reviewLine ||
              s.loading ||
              !s.locationType ||
              (s.hasHold && (!s.holdLabel || s.missingHeldScheduledFor))
            }
          />

          {s.error ? <InlineNotice tone="danger">{s.error}</InlineNotice> : null}
          {s.waitlistSuccess ? <InlineNotice tone="success">{s.waitlistSuccess}</InlineNotice> : null}

          <button
            type="submit"
            disabled={!s.canSubmit}
            className="rounded-xl bg-bgSecondary px-4 py-3 text-sm font-black hover:bg-bgSecondary/70 disabled:cursor-default disabled:opacity-70"
          >
            {s.loading
              ? 'Booking…'
              : s.holdLabel
                ? `Confirm now · Starting at $${s.displayPrice}`
                : `Confirm booking · Starting at $${s.displayPrice}`}
          </button>

          {s.showWaitlistCTA ? (
            <button
              type="button"
              onClick={s.joinWaitlist}
              disabled={s.waitlistBusy || s.loading}
              className="rounded-xl border border-white/10 bg-transparent px-4 py-3 text-sm font-black hover:bg-bgSecondary/40 disabled:cursor-default disabled:opacity-70"
            >
              {s.waitlistBusy ? 'Joining waitlist…' : 'No time works? Join waitlist'}
            </button>
          ) : null}

          {!props.isLoggedInAsClient ? (
            <div className="text-xs text-textSecondary">
              You’ll need to log in as a client to complete your booking.
            </div>
          ) : null}

          <div className="text-xs text-textSecondary">
            {s.holdLabel ? 'If the hold expires, the time might disappear.' : 'Pick a date, pick a time, and you’re done.'}
          </div>
        </form>
      )}
    </PanelShell>
  )
}
