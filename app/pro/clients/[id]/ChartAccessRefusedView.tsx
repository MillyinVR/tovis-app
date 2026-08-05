// app/pro/clients/[id]/ChartAccessRefusedView.tsx
//
// W5 follow-up: what the pro sees when the chart refuses them but they DO know
// this client (the CONTACT_ONLY tier).
//
// Until now this page answered that state with `redirect('/pro/clients')`. The
// pro tapped a client they are mid-conversation with and landed silently back
// on a list — no reason, no name, and no way to ask. The refusal was correct;
// the absence of any surface for it was the bug, and it was invisible because a
// redirect looks like navigation rather than a denial.
//
// 🔴 This renders ONLY for canContactClient. A pro with no relationship still
// gets the flat redirect, because a screen that names a client is itself a
// confirmation that the client id exists.

import Link from 'next/link'

import { Card, buttonClassName } from '@/app/_components/ui'
import type { ChartShareState } from '@/lib/clients/chartShare'
import { chartShareRequestBlock } from '@/lib/clients/chartShare'

import RequestChartAccessButton from './RequestChartAccessButton'

type Props = {
  clientId: string
  /** Display name — safe here: the CONTACT tier is exactly "may see who they are". */
  clientName: string
  share: ChartShareState
  /** Back to the conversation, which is where the pro almost always came from. */
  messageHref: string
  now: Date
}

export default function ChartAccessRefusedView({
  clientId,
  clientName,
  share,
  messageHref,
  now,
}: Props) {
  const block = chartShareRequestBlock(share, now)

  return (
    <main className="mx-auto w-full max-w-240 px-4 pb-24 pt-8 text-textPrimary">
      <div className="mb-4">
        <Link
          href="/pro/clients"
          className={buttonClassName({ variant: 'ghost', size: 'sm' })}
        >
          ← Back to clients
        </Link>
      </div>

      <Card variant="glass" padding="lg">
        <div className="grid gap-3">
          <div className="text-[15px] font-black text-textPrimary">
            {clientName} hasn’t shared their chart with you
          </div>

          <div className="text-[13px] font-semibold text-textSecondary">
            Their chart is the private record about them — allergies, formulas,
            notes and consent forms. You can ask them for access, and it opens
            automatically once they book with you.
          </div>

          <div className="pt-1">
            <RequestChartAccessButton clientId={clientId} block={block?.code ?? null} />
          </div>

          <div className="pt-2">
            <Link
              href={messageHref}
              className={buttonClassName({ variant: 'ghost', size: 'sm' })}
            >
              Message {clientName}
            </Link>
          </div>
        </div>
      </Card>
    </main>
  )
}
