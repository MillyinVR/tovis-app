'use client'

export function SuccessActions(props: {
  calendarHref: string | null
  copied: boolean
  onCopy: () => void
}) {
  const { calendarHref, copied, onCopy } = props

  return (
    <div className="mt-3 grid gap-2">
      <a href="/client" className="rounded-xl bg-bgSecondary px-4 py-2 text-center text-sm font-extrabold hover:bg-bgSecondary/70">
        View my bookings
      </a>

      {calendarHref ? (
        <a
          href={calendarHref}
          className="rounded-xl border border-white/10 bg-transparent px-4 py-2 text-center text-sm font-extrabold hover:bg-bgSecondary/40"
        >
          Add to calendar
        </a>
      ) : null}

      <button
        type="button"
        onClick={onCopy}
        className="rounded-xl border border-white/10 bg-transparent px-4 py-2 text-sm font-extrabold hover:bg-bgSecondary/40"
      >
        {copied ? 'Link copied' : 'Copy booking link'}
      </button>

      <div className="text-xs text-textSecondary">You’ll thank yourself later.</div>
    </div>
  )
}
