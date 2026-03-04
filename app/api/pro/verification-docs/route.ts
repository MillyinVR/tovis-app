// app/api/pro/verification-docs/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { VerificationStatus, VerificationDocumentType } from '@prisma/client'

export const dynamic = 'force-dynamic'

type Body = {
  type?: unknown
  url?: unknown
  label?: unknown
}

function pickString(v: unknown) {
  return typeof v === 'string' ? v.trim() : ''
}

function parseDocType(v: unknown): VerificationDocumentType | null {
  const s = pickString(v).toUpperCase()
  if (s === 'LICENSE') return VerificationDocumentType.LICENSE
  if (s === 'ID') return VerificationDocumentType.ID_CARD
  if (s === 'OTHER') return VerificationDocumentType.MAKEUP_PRIMARY
  return null
}

function parseSupabaseRef(input: string): { bucket: string; path: string } | null {
  const s = input.trim()
  if (!s.startsWith('supabase://')) return null
  const rest = s.slice('supabase://'.length)
  const idx = rest.indexOf('/')
  if (idx <= 0) return null
  const bucket = rest.slice(0, idx).trim()
  const path = rest.slice(idx + 1).trim()
  if (!bucket || !path) return null
  return { bucket, path }
}

export async function POST(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const proId = auth.professionalId

    const body = (await req.json().catch(() => ({}))) as Body

    const type = parseDocType(body.type)
    if (!type) return jsonFail(400, 'Invalid document type.')

    const url = pickString(body.url)
    if (!url) return jsonFail(400, 'Missing url.')

    const labelRaw = pickString(body.label)
    const label = labelRaw ? labelRaw : null

    const ref = parseSupabaseRef(url)
    if (!ref) return jsonFail(400, 'Invalid document url (expected supabase://bucket/path).')

    // Safety: verification docs should be private
    if (ref.bucket !== 'media-private') {
      return jsonFail(400, 'Invalid document bucket (must be media-private).')
    }

    const created = await prisma.$transaction(async (tx) => {
      const doc = await tx.verificationDocument.create({
        data: {
          professionalId: proId,
          type,
          label,
          url,
          status: VerificationStatus.PENDING,
        },
        select: { id: true },
      })

      // If the pro was rejected/needs-info, uploading new docs should move them back to pending.
      const pro = await tx.professionalProfile.findUnique({
        where: { id: proId },
        select: { verificationStatus: true },
      })

      if (pro?.verificationStatus === VerificationStatus.REJECTED || pro?.verificationStatus === VerificationStatus.NEEDS_INFO) {
        await tx.professionalProfile.update({
          where: { id: proId },
          data: { verificationStatus: VerificationStatus.PENDING },
          select: { id: true },
        })
      }

      return doc
    })

    return jsonOk({ id: created.id }, 201)
  } catch (e) {
    console.error('POST /api/pro/verification-docs error', e)
    return jsonFail(500, 'Internal server error')
  }
}