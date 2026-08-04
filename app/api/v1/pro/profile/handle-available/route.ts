// app/api/v1/pro/profile/handle-available/route.ts
//
// Live availability check for a pro vanity handle. Fast feedback for the claim UI;
// PATCH /api/v1/pro/profile stays the authoritative writer (race-safe via the
// HandleRegistration primary key). Shares format/reserved rules with lib/handles.
//
// Reads HandleRegistration, not ProfessionalProfile: handles are one namespace
// shared with ClientProfile (see lib/handles/registry.ts), so a handle a CLIENT
// holds is taken, and telling a pro it was "available" here would only hand them
// a 409 on save. The registry is inherently platform-wide — it has no tenant
// column — which is the same intentional cross-tenant read this route always
// made, now expressed by the table itself.
import { jsonOk, requirePro } from '@/app/api/_utils'
import {
  handleFormatError,
  handleFormatMessage,
  normalizeHandle,
  suggestHandles,
} from '@/lib/handles'
import { filterAvailableHandles, isHandleAvailable } from '@/lib/handles/registry'
import { prisma } from '@/lib/prisma'

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

  const existing = await prisma.handleRegistration.findUnique({
    where: { handleNormalized: normalized },
    select: { professionalId: true },
  })

  if (existing && existing.professionalId === auth.professionalId) {
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

  // Defensive: a handle with no registry row is free. Kept as an explicit call
  // so this route and the writer agree on one definition of "available".
  const available = await isHandleAvailable(normalized, {
    kind: 'PRO',
    professionalId: auth.professionalId,
  })

  return jsonOk({
    ok: true,
    handle: normalized,
    status: (available ? 'available' : 'taken') satisfies HandleStatus,
    message: available
      ? `${normalized}.tovis.me is available.`
      : 'That handle is taken.',
  })
}

/** Keep only suggestions that are themselves free (caps DB work to a small list). */
async function filterAvailableSuggestions(base: string): Promise<string[]> {
  const candidates = suggestHandles(base)
  if (candidates.length === 0) return []

  const free = await filterAvailableHandles(candidates)
  return free.slice(0, 3)
}
