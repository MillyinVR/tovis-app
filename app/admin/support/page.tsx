// app/admin/support/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

async function requireAdmin() {
  const user = await getCurrentUser().catch(() => null)
  if (!user) redirect('/login')
  if (user.role !== 'ADMIN') redirect('/forbidden')
  return user
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function pickStatus(v: unknown) {
  const s = typeof v === 'string' ? v.toUpperCase() : ''
  if (s === 'OPEN' || s === 'IN_PROGRESS' || s === 'CLOSED') return s as any
  return 'OPEN' as any
}

export default async function AdminSupportPage(props: { searchParams?: SearchParams }) {
  await requireAdmin()

  const sp = (await props.searchParams) ?? {}
  const status = pickStatus(sp.status)

  const tickets = await prisma.supportTicket.findMany({
    where: { status },
    orderBy: { createdAt: 'desc' },
    take: 80,
    select: {
      id: true,
      createdAt: true,
      createdByRole: true,
      createdByUserId: true,
      subject: true,
      message: true,
      status: true,
    },
  })

  function tabHref(s: 'OPEN' | 'IN_PROGRESS' | 'CLOSED') {
    return `/admin/support?status=${encodeURIComponent(s)}`
  }

  const tabBase =
    'inline-flex items-center rounded-full border px-3 py-2 text-[12px] font-black transition active:scale-[0.98]'
  const tabOn = 'border-accentPrimary/40 bg-bgPrimary/70 text-textPrimary'
  const tabOff = 'border-white/10 bg-bgPrimary/35 text-textSecondary hover:border-white/18 hover:bg-bgPrimary/55'

  return (
    <main className="mx-auto w-full max-w-1100px px-4 py-6 text-textPrimary">
      <div className="mb-5 flex flex-col gap-2">
        <h1 className="text-[22px] font-black">Support / Issues</h1>
        <p className="text-[13px] text-textSecondary">Incoming reports from clients and professionals.</p>

        <div className="mt-2 flex flex-wrap gap-2">
          <Link href={tabHref('OPEN')} className={[tabBase, status === 'OPEN' ? tabOn : tabOff].join(' ')}>
            Open
          </Link>
          <Link
            href={tabHref('IN_PROGRESS')}
            className={[tabBase, status === 'IN_PROGRESS' ? tabOn : tabOff].join(' ')}
          >
            In progress
          </Link>
          <Link href={tabHref('CLOSED')} className={[tabBase, status === 'CLOSED' ? tabOn : tabOff].join(' ')}>
            Closed
          </Link>
        </div>
      </div>

      {tickets.length === 0 ? (
        <div className="rounded-card border border-white/10 bg-bgSecondary p-4 text-[13px] text-textSecondary">
          Nothing here. Either everything is perfect… or everyone gave up. (Let’s assume perfect.)
        </div>
      ) : (
        <div className="grid gap-3">
          {tickets.map((t) => (
            <div key={t.id} className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[13px] font-black">{t.subject}</div>
                  <div className="mt-1 text-[11px] text-textSecondary">
                    {t.createdByRole ?? 'UNKNOWN'} • {new Date(t.createdAt).toLocaleString()}
                    {t.createdByUserId ? ` • user:${t.createdByUserId}` : ''}
                  </div>
                </div>

                <Link
                  href={`/admin/support/${encodeURIComponent(t.id)}`}
                  className="inline-flex items-center rounded-full border border-white/12 bg-bgPrimary/55 px-3 py-2 text-[12px] font-black hover:border-white/22 hover:bg-bgPrimary/70"
                >
                  View
                </Link>
              </div>

              <div className="mt-3 whitespace-pre-wrap text-[13px] text-textSecondary">
                {t.message.length > 320 ? `${t.message.slice(0, 320)}…` : t.message}
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  )
}
