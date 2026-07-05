// GET /api/v1/pro/referrals — the native "Referral activity" surface (web
// /pro/referral-rewards viewer parity, PR #500). Who-referred-whom + conversion
// / reward state for referrals credited to the authed pro, via the shared
// loader. Scoped to Referral.professionalId (set only at conversion), so every
// row is at least CONVERTED — pending client↔client referrals never surface.
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requirePro } from '@/app/api/_utils/auth/requirePro'
import { loadProReferralActivity } from '@/lib/referral/proReferralActivity'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const activity = await loadProReferralActivity({
      professionalId: auth.professionalId,
    })

    // Dates → ISO strings for a stable JSON contract (the loader returns Date).
    return jsonOk({
      summary: activity.summary,
      rows: activity.rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
        convertedAt: row.convertedAt ? row.convertedAt.toISOString() : null,
      })),
    })
  } catch (error) {
    console.error('GET /api/v1/pro/referrals error', error)
    return jsonFail(500, 'Internal server error')
  }
}
