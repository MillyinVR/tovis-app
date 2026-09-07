import { Badge } from '@/app/_components/ui'
import type { ProConsultPrepStatusDTO } from '@/lib/consult/proPrepStatus'

/**
 * P7a-4 — "prep incomplete", with the actual missing items, on the pro's
 * booking.
 *
 * Renders NOTHING when the badge is insignificant (no consult attached), which
 * is most bookings. A section that says "nothing to prepare" on every
 * appointment is a section the pro learns to scroll past.
 *
 * 🔴 The questions are shown in the CLIENT's words, not as keys. A pro reading
 * `henna_plant_dye_history` has been shown a field name; a pro reading "When
 * did you last use henna or another plant-based hair dye?" can act on it —
 * including by simply asking the client herself, which is the point.
 *
 * 🔴 Nothing here blocks anything. The handoff is explicit that an unanswered
 * safety question is a reason for the pro to reach out, not a gate on the
 * appointment, so this is a panel and never a barrier.
 */
export default function ProConsultPrepStatus({
  prep,
}: {
  prep: ProConsultPrepStatusDTO
}) {
  if (!prep.badge.significant) return null

  const answered = prep.requiredCount - prep.missing.length

  return (
    <section className="tovis-glass mb-3.5 rounded-card border border-surfaceGlass/10 bg-bgSecondary p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-[14px] font-bold text-textPrimary">
          Client prep
        </h2>
        <Badge tone={prep.badge.tone} size="sm" fill="soft">
          {prep.badge.label}
        </Badge>
      </div>

      <p className="mt-1 text-[12px] text-textMuted">{prep.badge.description}</p>

      {prep.deadlineLabel ? (
        <p className="mt-1 text-[12px] text-textMuted">
          {prep.badge.kind === 'OVERDUE'
            ? `These were due ${prep.deadlineLabel}.`
            : `Due ${prep.deadlineLabel}.`}
        </p>
      ) : null}

      {prep.missing.length ? (
        <>
          <p className="mt-3 text-[12px] font-semibold text-textPrimary">
            Still to answer ({answered} of {prep.requiredCount} in)
          </p>
          <ul className="mt-1.5 grid gap-1.5">
            {prep.missing.map((item) => (
              <li
                key={item.questionKey}
                className="text-[12px] leading-snug text-textSecondary"
              >
                {item.question}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  )
}
