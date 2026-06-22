// app/api/pro/profile/handle-available/route.ts
//
// Live availability check for a pro vanity handle. Fast feedback for the claim UI;
// the PATCH /api/pro/profile route stays the authoritative writer (race-safe via the
// handleNormalized unique constraint). Shares format/reserved rules with lib/handles.
import { prisma } from '@/lib/prisma'
import { jsonOk, requirePro } from '@/app/api/_utils'
import {
  handleFormatError,
  handleFormatMessage,
  normalizeHandle,
  suggestHandles,
} from '@/lib/handles'
import { platformCrossTenantProVisibilityFilter } from '@/lib/tenant'

export const dynamic = 'force-dynamic'

type HandleStatus = 'available' | 'taken' | 'reserved' | 'invalid' | 'yours'

export async function GET(req: Request) {
  const auth = await requirePro()
  if (!auth.ok) return auth.res

  const url = new URL(req.url)
  const raw = url.searchParams.get('handle') ?? ''
  const normalized = normalizeHandle(raw)

  const formatError = handleFormatError(normalized)
  if (formatError) {
    // 'reserved' is its own user-facing status; everything else is a format issue.
    const status: HandleStatus = formatError === 'reserved' ? 'reserved' : 'invalid'
    return jsonOk({
      ok: true,
      handle: normalized,
      status,
      message: handleFormatMessage(formatError),
    })
  }

  const existing = await prisma.professionalProfile.findUnique({
    where: { handleNormalized: normalized },
    select: { id: true },
  })

  if (existing && existing.id === auth.professionalId) {
    return jsonOk({
      ok: true,
      handle: normalized,
      status: 'yours' satisfies HandleStatus,
      message: 'This is already your handle.',
    })
  }

  if (existing) {
    return jsonOk({
      ok: true,
      handle: normalized,
      status: 'taken' satisfies HandleStatus,
      message: 'That handle is taken.',
      suggestions: await filterAvailableSuggestions(normalized),
    })
  }

  return jsonOk({
    ok: true,
    handle: normalized,
    status: 'available' satisfies HandleStatus,
    message: `${normalized}.tovis.me is available.`,
  })
}

/** Keep only suggestions that are themselves free (caps DB work to a small list). */
async function filterAvailableSuggestions(base: string): Promise<string[]> {
  const candidates = suggestHandles(base)
  if (candidates.length === 0) return []

  const taken = await prisma.professionalProfile.findMany({
    // Handles are globally unique across the whole platform (they map to subdomains),
    // so availability is an intentional cross-tenant read, not a discovery surface.
    where: {
      ...platformCrossTenantProVisibilityFilter(),
      handleNormalized: { in: candidates },
    },
    select: { handleNormalized: true },
  })
  const takenSet = new Set(taken.map((row) => row.handleNormalized))

  return candidates.filter((c) => !takenSet.has(c)).slice(0, 3)
}
