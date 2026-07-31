// app/pro/bookings/[id]/session/_components/UnsignedConsentBanner.tsx
//
// K15: what the pro sees at session start when this appointment's service
// requires a form the client has not signed.
//
// 🔴 It WARNS. There is no "you cannot start" here and no disabled control —
// blocking a real appointment over an unsigned waiver on the day a pro sets
// their first requirement is exactly what the card refused. The pro decides:
// send the link now, take it on paper, or carry on.
//
// Rendered on the PRE-SERVICE screens only. Once the visit is over, a warning
// about signing beforehand is a fact nobody can act on — the same call the
// badge helper makes with `significant`.

import { SendConsentLinkButton } from './SendConsentLinkButton'

type Props = {
  bookingId: string
  clientId: string
  /** The forms this appointment needs that the client has not signed. */
  unsigned: readonly { formId: string; title: string; kindLabel: string }[]
}

export function UnsignedConsentBanner({ bookingId, clientId, unsigned }: Props) {
  if (unsigned.length === 0) return null

  return (
    <div className="mx-auto w-full max-w-[900px] px-4 pt-4">
      <div className="rounded-card border border-toneWarn/25 bg-toneWarn/5 p-4">
        <div className="text-[13px] font-black text-textPrimary">
          {unsigned.length === 1
            ? 'A form for this service is unsigned'
            : `${unsigned.length} forms for this service are unsigned`}
        </div>

        <ul className="mt-2 grid gap-1">
          {unsigned.map((form) => (
            <li
              key={form.formId}
              className="flex flex-wrap items-center gap-2 text-[12px] text-textSecondary"
            >
              <span className="font-black text-textPrimary">{form.title}</span>
              <span className="opacity-70">· {form.kindLabel}</span>
              <SendConsentLinkButton
                clientId={clientId}
                bookingId={bookingId}
                formId={form.formId}
                formTitle={form.title}
              />
            </li>
          ))}
        </ul>

        <div className="mt-3 text-[11px] text-textSecondary/75">
          You can start the appointment either way — this is a reminder, not a
          block.
        </div>
      </div>
    </div>
  )
}
