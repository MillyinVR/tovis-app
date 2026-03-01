// app/admin/nfc/page.tsx
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { CopyButton } from './_components/CopyButton'
import { formatShortCode, generateShortCode } from '@/lib/nfcShortCode'
import type { NfcCardType } from '@prisma/client'
import type { ReadonlyHeaders } from 'next/dist/server/web/spec-extension/adapters/headers'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function isAbsoluteBaseUrl(input: string) {
  try {
    const u = new URL(input)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}

function getBaseUrlFromHeaders(h: ReadonlyHeaders) {
  const env =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    ''

  if (env && isAbsoluteBaseUrl(env)) return env.replace(/\/$/, '')

  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? 'https'
  if (!host) return 'https://example.com'
  return `${proto}://${host}`.replace(/\/$/, '')
}

function isAllowedType(v: string): v is NfcCardType | 'UNASSIGNED' {
  return (
    v === 'UNASSIGNED' ||
    v === 'CLIENT_REFERRAL' ||
    v === 'PRO_BOOKING' ||
    v === 'SALON_WHITE_LABEL'
  )
}

async function requireAdmin() {
  const user = await getCurrentUser().catch(() => null)
  if (!user) redirect('/login')
  if (user.role !== 'ADMIN') redirect('/forbidden')
  return user
}

export default async function AdminNfcPage(props: { searchParams?: SearchParams }) {
  await requireAdmin()

  const h = await headers()
  const baseUrl = getBaseUrlFromHeaders(h)

  const sp = (await props.searchParams) ?? {}
  const createdFlag = String(sp.created ?? '') === '1'

  async function createCards(formData: FormData): Promise<void> {
    'use server'

    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'ADMIN') redirect('/forbidden')

    const rawQty = String(formData.get('qty') ?? '').trim()
    const qty = Number(rawQty)
    if (!Number.isFinite(qty) || qty < 1 || qty > 500) {
      redirect('/admin/nfc?error=qty')
    }

    const typeRaw = String(formData.get('type') ?? 'UNASSIGNED').trim().toUpperCase()
    const type = isAllowedType(typeRaw) ? typeRaw : 'UNASSIGNED'

    const isActive = String(formData.get('isActive') ?? 'true') === 'true'
    const salonSlugRaw = String(formData.get('salonSlug') ?? '').trim()
    const salonSlug = salonSlugRaw ? salonSlugRaw : null
    const safeSalonSlug = type === 'SALON_WHITE_LABEL' ? salonSlug : null

    await prisma.$transaction(async (tx) => {
      for (let i = 0; i < qty; i++) {
        let created = false

        for (let attempt = 0; attempt < 10; attempt++) {
          const shortCode = generateShortCode(8)

          try {
            await tx.nfcCard.create({
              data: {
                type: type as any,
                isActive,
                salonSlug: safeSalonSlug,
                claimedAt: null,
                claimedByUserId: null,
                professionalId: null,
                shortCode,
              },
              select: { id: true },
            })
            created = true
            break
          } catch (e: any) {
            // Unique constraint collision on shortCode (rare) — retry.
            if (e?.code === 'P2002') continue
            throw e
          }
        }

        if (!created) {
          throw new Error('Failed to generate a unique short code.')
        }
      }
    })

    // Redirect back so the page re-renders and recent cards include the new batch.
    redirect('/admin/nfc?created=1')
  }

  const recent = await prisma.nfcCard.findMany({
    orderBy: { createdAt: 'desc' },
    take: 30,
    select: {
      id: true,
      shortCode: true,
      type: true,
      isActive: true,
      claimedAt: true,
      createdAt: true,
    },
  })

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <div className="mb-8 flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">NFC Cards</h1>
        <p className="text-sm text-neutral-600">
          Generate cards, program physical tags, and track claim status.
        </p>
        <div className="text-xs text-neutral-500">
          Base URL: <span className="font-mono">{baseUrl}</span>
        </div>

        {createdFlag ? (
          <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            Cards generated. They’ll appear in “Recent cards” below.
          </div>
        ) : null}

        {String(sp.error ?? '') === 'qty' ? (
          <div className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
            Quantity must be between 1 and 500.
          </div>
        ) : null}
      </div>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold">Generate cards</h2>
          <p className="mt-1 text-sm text-neutral-600">
            Recommended: <span className="font-medium">UNASSIGNED</span>. First signup/login claims the card.
          </p>

          <form action={createCards} className="mt-5 grid gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="grid gap-1">
                <span className="text-xs font-medium text-neutral-700">Quantity</span>
                <input
                  name="qty"
                  defaultValue="25"
                  inputMode="numeric"
                  className="h-11 rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-neutral-300"
                />
              </label>

              <label className="grid gap-1 sm:col-span-2">
                <span className="text-xs font-medium text-neutral-700">Type</span>
                <select
                  name="type"
                  defaultValue="UNASSIGNED"
                  className="h-11 rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-neutral-300"
                >
                  <option value="UNASSIGNED">UNASSIGNED (recommended)</option>
                  <option value="CLIENT_REFERRAL">CLIENT_REFERRAL</option>
                  <option value="PRO_BOOKING">PRO_BOOKING</option>
                  <option value="SALON_WHITE_LABEL">SALON_WHITE_LABEL</option>
                </select>
              </label>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="grid gap-1">
                <span className="text-xs font-medium text-neutral-700">Active?</span>
                <select
                  name="isActive"
                  defaultValue="true"
                  className="h-11 rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-neutral-300"
                >
                  <option value="true">Yes (tap works)</option>
                  <option value="false">No (tap goes invalid)</option>
                </select>
              </label>

              <label className="grid gap-1">
                <span className="text-xs font-medium text-neutral-700">Salon slug (only for white label)</span>
                <input
                  name="salonSlug"
                  placeholder="e.g. luxe-la"
                  className="h-11 rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-neutral-300"
                />
              </label>
            </div>

            <button
              type="submit"
              className="mt-1 inline-flex h-11 items-center justify-center rounded-xl bg-neutral-900 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-neutral-800 active:bg-neutral-950"
            >
              Generate
            </button>

            <p className="text-xs text-neutral-500">
              Tip: set <span className="font-mono">NEXT_PUBLIC_APP_URL</span> in production so URLs are always correct.
            </p>
          </form>
        </div>

        <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold">Programming guide</h2>
          <ol className="mt-3 grid gap-2 text-sm text-neutral-700">
            <li className="rounded-xl bg-neutral-50 p-3">1) Generate cards (UNASSIGNED + Active).</li>
            <li className="rounded-xl bg-neutral-50 p-3">
              2) Write the <span className="font-medium">Tap URL</span> to the NFC tag (URL record).
            </li>
            <li className="rounded-xl bg-neutral-50 p-3">
              3) Print the short code (e.g. <span className="font-mono">TOV-8K3D-2QFJ</span>) on the card.
            </li>
            <li className="rounded-xl bg-neutral-50 p-3">
              4) If someone can’t tap, they can use the code URL (<span className="font-mono">/c/&lt;code&gt;</span>).
            </li>
          </ol>

          <div className="mt-4 rounded-xl border border-neutral-200 bg-white p-3">
            <div className="text-xs font-medium text-neutral-700">NFC URL format</div>
            <p className="mt-1 text-xs text-neutral-600">
              Put <span className="font-mono">{baseUrl}/t/&lt;cardId&gt;</span> on the tag.
            </p>
          </div>
        </div>
      </section>

      <section className="mt-10 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-base font-semibold">Recent cards</h2>
            <p className="text-sm text-neutral-600">Last 30 created (most recent first).</p>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto rounded-xl border border-neutral-200">
          <table className="min-w-245 w-full border-collapse text-sm">
            <thead className="bg-neutral-50 text-left">
              <tr>
                <th className="px-3 py-3 font-semibold text-neutral-700">Short code</th>
                <th className="px-3 py-3 font-semibold text-neutral-700">Tap URL (NFC)</th>
                <th className="px-3 py-3 font-semibold text-neutral-700">Code URL (manual/QR)</th>
                <th className="px-3 py-3 font-semibold text-neutral-700">Type</th>
                <th className="px-3 py-3 font-semibold text-neutral-700">Active</th>
                <th className="px-3 py-3 font-semibold text-neutral-700">Claimed</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((c) => {
                const tapUrl = `${baseUrl}/t/${c.id}`
                const codeUrl = `${baseUrl}/c/${c.shortCode}`
                const pretty = formatShortCode(c.shortCode)

                return (
                  <tr key={c.id} className="border-t border-neutral-200">
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-neutral-800">{pretty}</span>
                        <CopyButton value={pretty} />
                      </div>
                      <div className="mt-1 font-mono text-[11px] text-neutral-500">{c.shortCode}</div>
                    </td>

                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-neutral-700">{tapUrl}</span>
                        <CopyButton value={tapUrl} />
                      </div>
                      <div className="mt-1 font-mono text-[11px] text-neutral-500">{c.id}</div>
                    </td>

                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-neutral-700">{codeUrl}</span>
                        <CopyButton value={codeUrl} />
                      </div>
                    </td>

                    <td className="px-3 py-3 text-neutral-800">{String(c.type)}</td>
                    <td className="px-3 py-3 text-neutral-800">{c.isActive ? 'Yes' : 'No'}</td>
                    <td className="px-3 py-3 text-neutral-800">{c.claimedAt ? 'Yes' : 'No'}</td>
                  </tr>
                )
              })}

              {recent.length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-sm text-neutral-600" colSpan={6}>
                    No cards yet. Generate your first batch above.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}
