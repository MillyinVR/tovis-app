// app/admin/nfc/page.tsx
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { getRootTenantId } from '@/lib/tenant/resolveTenant'
import { CopyButton } from './_components/CopyButton'
import { formatShortCode, generateShortCode } from '@/lib/nfcShortCode'
import { NfcCardType, Prisma } from '@prisma/client'
import type { ReadonlyHeaders } from 'next/dist/server/web/spec-extension/adapters/headers'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function firstParam(v: string | string[] | undefined): string {
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v[0] ?? ''
  return ''
}

function isAbsoluteBaseUrl(input: string) {
  try {
    const u = new URL(input)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}

function getBaseUrlFromHeaders(h: ReadonlyHeaders): string | null {
  const env =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    ''

  if (env && isAbsoluteBaseUrl(env)) return env.replace(/\/$/, '')

  const forwardedHost = (h.get('x-forwarded-host') ?? '').split(',')[0]?.trim()
  const host = forwardedHost || (h.get('host') ?? '').split(',')[0]?.trim()

  const forwardedProto = (h.get('x-forwarded-proto') ?? '').split(',')[0]?.trim()
  const proto = forwardedProto || 'https'

  if (!host) return null
  if (proto !== 'https' && proto !== 'http') return null

  return `${proto}://${host}`.replace(/\/$/, '')
}

function parseNfcCardType(raw: unknown): NfcCardType {
  const v = typeof raw === 'string' ? raw.trim().toUpperCase() : ''
  if (v === NfcCardType.UNASSIGNED) return NfcCardType.UNASSIGNED
  if (v === NfcCardType.CLIENT_REFERRAL) return NfcCardType.CLIENT_REFERRAL
  if (v === NfcCardType.PRO_BOOKING) return NfcCardType.PRO_BOOKING
  if (v === NfcCardType.SALON_WHITE_LABEL) return NfcCardType.SALON_WHITE_LABEL
  return NfcCardType.UNASSIGNED
}

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
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
  const createdFlag = firstParam(sp.created) === '1'
  const errorFlag = firstParam(sp.error)

  async function createCards(formData: FormData): Promise<void> {
    'use server'

    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'ADMIN') redirect('/forbidden')

    const rawQty = String(formData.get('qty') ?? '').trim()
    const qty = Number(rawQty)
    if (!Number.isFinite(qty) || qty < 1 || qty > 500) {
      redirect('/admin/nfc?error=qty')
    }

    const type = parseNfcCardType(formData.get('type'))
    const isActive = String(formData.get('isActive') ?? 'true') === 'true'

    // Issuing tenant: white-label cards belong to the tenant named in the
    // form; every other card type is issued by the root tenant.
    let tenantId: string

    if (type === NfcCardType.SALON_WHITE_LABEL) {
      const tenantSlug = String(formData.get('tenantSlug') ?? '')
        .trim()
        .toLowerCase()

      if (!tenantSlug) {
        redirect('/admin/nfc?error=tenantSlug')
      }

      const tenant = await prisma.tenant.findUnique({
        where: { slug: tenantSlug },
        select: { id: true, isActive: true },
      })

      if (!tenant || !tenant.isActive) {
        redirect('/admin/nfc?error=tenantSlug')
      }

      tenantId = tenant.id
    } else {
      tenantId = await getRootTenantId()
    }

    await prisma.$transaction(async (tx) => {
      for (let i = 0; i < qty; i++) {
        let created = false

        for (let attempt = 0; attempt < 10; attempt++) {
          const shortCode = generateShortCode(8)

          try {
            await tx.nfcCard.create({
              data: {
                type,
                isActive,
                tenantId,
                claimedAt: null,
                claimedByUserId: null,
                professionalId: null,
                shortCode,
              },
              select: { id: true },
            })
            created = true
            break
          } catch (e: unknown) {
            if (isUniqueConstraintError(e)) continue
            throw e
          }
        }

        if (!created) throw new Error('Failed to generate a unique short code.')
      }
    })

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

  const baseUrlMissing = !baseUrl

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <div className="mb-8 flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">NFC Cards</h1>
        <p className="text-sm text-textSecondary">Generate cards, program physical tags, and track claim status.</p>

        <div className="text-xs text-textSecondary">
          Base URL:{' '}
          {baseUrl ? (
            <span className="font-mono">{baseUrl}</span>
          ) : (
            <span className="font-mono text-toneDanger">MISSING (set NEXT_PUBLIC_APP_URL)</span>
          )}
        </div>

        {baseUrlMissing ? (
          <div className="mt-2 rounded-xl border border-toneDanger/30 bg-toneDanger/10 px-3 py-2 text-sm text-toneDanger">
            Base URL could not be derived from headers. Set <span className="font-mono">NEXT_PUBLIC_APP_URL</span> so you
            don’t accidentally program tags with the wrong URL.
          </div>
        ) : null}

        {createdFlag ? (
          <div className="mt-2 rounded-xl border border-toneSuccess/30 bg-toneSuccess/10 px-3 py-2 text-sm text-toneSuccess">
            Cards generated. They’ll appear in “Recent cards” below.
          </div>
        ) : null}

        {errorFlag === 'qty' ? (
          <div className="mt-2 rounded-xl border border-toneDanger/30 bg-toneDanger/10 px-3 py-2 text-sm text-toneDanger">
            Quantity must be between 1 and 500.
          </div>
        ) : null}

        {errorFlag === 'tenantSlug' ? (
          <div className="mt-2 rounded-xl border border-toneDanger/30 bg-toneDanger/10 px-3 py-2 text-sm text-toneDanger">
            An active tenant slug is required for <span className="font-mono">SALON_WHITE_LABEL</span> cards.
          </div>
        ) : null}
      </div>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-surfaceGlass/10 bg-bgSecondary p-5 shadow-sm">
          <h2 className="text-base font-semibold">Generate cards</h2>
          <p className="mt-1 text-sm text-textSecondary">
            Recommended: <span className="font-medium">{NfcCardType.UNASSIGNED}</span>. First signup/login claims the card.
          </p>

          <form action={createCards} className="mt-5 grid gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="grid gap-1">
                <span className="text-xs font-medium text-textSecondary">Quantity</span>
                <input
                  name="qty"
                  defaultValue="25"
                  inputMode="numeric"
                  className="h-11 rounded-xl border border-white/15 bg-bgPrimary px-3 text-sm text-textPrimary outline-none focus:border-white/30"
                />
              </label>

              <label className="grid gap-1 sm:col-span-2">
                <span className="text-xs font-medium text-textSecondary">Type</span>
                <select
                  name="type"
                  defaultValue={NfcCardType.UNASSIGNED}
                  className="h-11 rounded-xl border border-white/15 bg-bgPrimary px-3 text-sm text-textPrimary outline-none focus:border-white/30"
                >
                  <option value={NfcCardType.UNASSIGNED}>UNASSIGNED (recommended)</option>
                  <option value={NfcCardType.CLIENT_REFERRAL}>CLIENT_REFERRAL</option>
                  <option value={NfcCardType.PRO_BOOKING}>PRO_BOOKING</option>
                  <option value={NfcCardType.SALON_WHITE_LABEL}>SALON_WHITE_LABEL</option>
                </select>
              </label>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="grid gap-1">
                <span className="text-xs font-medium text-textSecondary">Active?</span>
                <select
                  name="isActive"
                  defaultValue="true"
                  className="h-11 rounded-xl border border-white/15 bg-bgPrimary px-3 text-sm text-textPrimary outline-none focus:border-white/30"
                >
                  <option value="true">Yes (tap works)</option>
                  <option value="false">No (tap goes invalid)</option>
                </select>
              </label>

              <label className="grid gap-1">
                <span className="text-xs font-medium text-textSecondary">Tenant slug (only for white label)</span>
                <input
                  name="tenantSlug"
                  placeholder="e.g. luxe-la"
                  className="h-11 rounded-xl border border-white/15 bg-bgPrimary px-3 text-sm text-textPrimary outline-none focus:border-white/30"
                />
              </label>
            </div>

            <button
              type="submit"
              className="mt-1 inline-flex h-11 items-center justify-center rounded-xl bg-accentPrimary px-4 text-sm font-semibold text-bgPrimary shadow-sm transition hover:bg-accentPrimaryHover active:bg-accentPrimaryHover"
            >
              Generate
            </button>

            <p className="text-xs text-textSecondary">
              Tip: set <span className="font-mono">NEXT_PUBLIC_APP_URL</span> in production so URLs are always correct.
            </p>
          </form>
        </div>

        <div className="rounded-2xl border border-surfaceGlass/10 bg-bgSecondary p-5 shadow-sm">
          <h2 className="text-base font-semibold">Programming guide</h2>
          <ol className="mt-3 grid gap-2 text-sm text-textSecondary">
            <li className="rounded-xl bg-bgPrimary p-3">1) Generate cards (UNASSIGNED + Active).</li>
            <li className="rounded-xl bg-bgPrimary p-3">
              2) Write the <span className="font-medium">Tap URL</span> to the NFC tag (URL record).
            </li>
            <li className="rounded-xl bg-bgPrimary p-3">
              3) Print the short code (e.g. <span className="font-mono">TOV-8K3D-2QFJ</span>) on the card.
            </li>
            <li className="rounded-xl bg-bgPrimary p-3">
              4) If someone can’t tap, they can use the code URL (<span className="font-mono">/c/&lt;code&gt;</span>).
            </li>
          </ol>

          <div className="mt-4 rounded-xl border border-surfaceGlass/10 bg-bgPrimary p-3">
            <div className="text-xs font-medium text-textSecondary">NFC URL format</div>
            <p className="mt-1 text-xs text-textSecondary">
              {baseUrl ? (
                <>
                  Put <span className="font-mono">{baseUrl}/t/&lt;cardId&gt;</span> on the tag.
                </>
              ) : (
                <>
                  Set <span className="font-mono">NEXT_PUBLIC_APP_URL</span> to display the exact tag URL format.
                </>
              )}
            </p>
          </div>
        </div>
      </section>

      <section className="mt-10 rounded-2xl border border-surfaceGlass/10 bg-bgSecondary p-5 shadow-sm">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-base font-semibold">Recent cards</h2>
            <p className="text-sm text-textSecondary">Last 30 created (most recent first).</p>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto rounded-xl border border-surfaceGlass/10">
          <table className="min-w-245 w-full border-collapse text-sm">
            <thead className="bg-bgPrimary text-left">
              <tr>
                <th className="px-3 py-3 font-semibold text-textSecondary">Short code</th>
                <th className="px-3 py-3 font-semibold text-textSecondary">Tap URL (NFC)</th>
                <th className="px-3 py-3 font-semibold text-textSecondary">Code URL (manual/QR)</th>
                <th className="px-3 py-3 font-semibold text-textSecondary">Type</th>
                <th className="px-3 py-3 font-semibold text-textSecondary">Active</th>
                <th className="px-3 py-3 font-semibold text-textSecondary">Claimed</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((c) => {
                const pretty = formatShortCode(c.shortCode)

                const tapUrl = baseUrl ? `${baseUrl}/t/${c.id}` : null
                const codeUrl = baseUrl ? `${baseUrl}/c/${c.shortCode}` : null

                return (
                  <tr key={c.id} className="border-t border-surfaceGlass/10">
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-textPrimary">{pretty}</span>
                        <CopyButton value={pretty} />
                      </div>
                      <div className="mt-1 font-mono text-[11px] text-textSecondary">{c.shortCode}</div>
                    </td>

                    <td className="px-3 py-3">
                      {tapUrl ? (
                        <>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs text-textSecondary">{tapUrl}</span>
                            <CopyButton value={tapUrl} />
                          </div>
                          <div className="mt-1 font-mono text-[11px] text-textSecondary">{c.id}</div>
                        </>
                      ) : (
                        <div className="text-xs text-textSecondary">Set NEXT_PUBLIC_APP_URL to show tap URLs</div>
                      )}
                    </td>

                    <td className="px-3 py-3">
                      {codeUrl ? (
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-textSecondary">{codeUrl}</span>
                          <CopyButton value={codeUrl} />
                        </div>
                      ) : (
                        <div className="text-xs text-textSecondary">Set NEXT_PUBLIC_APP_URL to show code URLs</div>
                      )}
                    </td>

                    <td className="px-3 py-3 text-textPrimary">{c.type}</td>
                    <td className="px-3 py-3 text-textPrimary">{c.isActive ? 'Yes' : 'No'}</td>
                    <td className="px-3 py-3 text-textPrimary">{c.claimedAt ? 'Yes' : 'No'}</td>
                  </tr>
                )
              })}

              {recent.length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-sm text-textSecondary" colSpan={6}>
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