// app/pro/calendar/_components/ManagementModal.tsx

'use client'

import type { CalendarStats, ManagementKey, ManagementLists } from '../_types'

function formatHoursFromMinutes(mins: number) {
  const hours = mins / 60
  const rounded = Math.round(hours * 10) / 10
  return `${rounded}h`
}

export function ManagementStrip(props: {
  stats: CalendarStats
  management: ManagementLists
  blockedMinutesToday: number
  showHoursForm: boolean
  setShowHoursForm: (v: (prev: boolean) => boolean) => void
  autoAccept: boolean
  savingAutoAccept: boolean
  onToggleAutoAccept: (next: boolean) => void
  onOpenManagement: (key: ManagementKey) => void
}) {
  const { stats, management, blockedMinutesToday, showHoursForm, setShowHoursForm, autoAccept, savingAutoAccept, onToggleAutoAccept, onOpenManagement } = props

  return (
    <section className="mb-4 rounded-2xl border border-white/10 bg-bgPrimary p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-base font-semibold">Calendar management</div>
          <div className="text-sm text-textSecondary">Manage availability and appointments.</div>
        </div>

        <button
          type="button"
          onClick={() => setShowHoursForm((v) => !v)}
          className={[
            'rounded-full border px-3 py-1.5 text-xs font-semibold',
            showHoursForm ? 'border-white/10 bg-bgSecondary' : 'border-white/10 bg-transparent hover:bg-bgSecondary/40',
          ].join(' ')}
        >
          {showHoursForm ? 'Hide schedule editor' : 'Edit working hours'}
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <button
          type="button"
          onClick={() => onOpenManagement('todaysBookings')}
          className="rounded-xl border border-white/10 bg-bgSecondary p-3 text-left hover:bg-bgSecondary/70"
        >
          <div className="text-xs text-textSecondary">Today’s bookings</div>
          <div className="mt-1 text-2xl font-bold">{stats?.todaysBookings ?? management.todaysBookings.length ?? 0}</div>
          <div className="mt-1 text-xs text-textSecondary">View list</div>
        </button>

        <button
          type="button"
          onClick={() => onOpenManagement('waitlistToday')}
          className="rounded-xl border border-white/10 bg-bgSecondary p-3 text-left hover:bg-bgSecondary/70"
        >
          <div className="text-xs text-textSecondary">Waitlist (today)</div>
          <div className="mt-1 text-2xl font-bold">{management.waitlistToday.length}</div>
          <div className="mt-1 text-xs text-textSecondary">View list</div>
        </button>

        <button
          type="button"
          onClick={() => onOpenManagement('pendingRequests')}
          className="rounded-xl border border-white/10 bg-bgSecondary p-3 text-left hover:bg-bgSecondary/70"
        >
          <div className="text-xs text-textSecondary">Pending requests</div>
          <div className="mt-1 text-2xl font-bold">{stats?.pendingRequests ?? management.pendingRequests.length ?? 0}</div>
          <div className="mt-1 text-xs text-textSecondary">Review</div>
        </button>

        <button
          type="button"
          onClick={() => onOpenManagement('blockedToday')}
          className="rounded-xl border border-white/10 bg-bgSecondary p-3 text-left hover:bg-bgSecondary/70"
        >
          <div className="text-xs text-textSecondary">Blocked time (today)</div>
          <div className="mt-1 text-2xl font-bold">{formatHoursFromMinutes(blockedMinutesToday)}</div>
          <div className="mt-1 text-xs text-textSecondary">View list</div>
        </button>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-bgSecondary p-3">
        <div className="min-w-0">
          <div className="text-sm font-extrabold">Auto-accept bookings</div>
          <div className="mt-0.5 text-sm text-textSecondary">
            When enabled, new client requests go straight to <span className="font-semibold">Accepted</span>.
          </div>
        </div>

        <button
          type="button"
          onClick={() => onToggleAutoAccept(!autoAccept)}
          disabled={savingAutoAccept}
          className={[
            'shrink-0 rounded-full border px-3 py-2 text-xs font-black',
            autoAccept ? 'border-white/10 bg-bgPrimary' : 'border-white/10 bg-transparent hover:bg-bgPrimary/30',
            savingAutoAccept ? 'opacity-70' : '',
          ].join(' ')}
        >
          {savingAutoAccept ? 'Saving…' : autoAccept ? 'On' : 'Off'}
        </button>
      </div>
    </section>
  )
}
