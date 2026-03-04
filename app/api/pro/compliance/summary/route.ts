// app/api/pro/compliance/summary/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { ProfessionType, VerificationStatus, VerificationDocumentType, } from '@prisma/client'

export const dynamic = 'force-dynamic'

const CA_BBC_LICENSE_REQUIRED: readonly ProfessionType[] = [
  ProfessionType.COSMETOLOGIST,
  ProfessionType.BARBER,
  ProfessionType.ESTHETICIAN,
  ProfessionType.MANICURIST,
  ProfessionType.HAIRSTYLIST,
  ProfessionType.ELECTROLOGIST,
] as const

function requiresCaBbcLicense(p: ProfessionType | null) {
  if (!p) return false
  return CA_BBC_LICENSE_REQUIRED.includes(p)
}

function daysUntil(date: Date) {
  const ms = date.getTime() - Date.now()
  // ceil so “0.2 days” shows as 1 day remaining
  return Math.ceil(ms / (24 * 60 * 60_000))
}

type BannerKind = 'MISSING_DOC' | 'PENDING_REVIEW' | 'EXPIRING_SOON' | 'EXPIRED'

export async function GET() {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const proId = auth.professionalId

    const pro = await prisma.professionalProfile.findUnique({
      where: { id: proId },
      select: {
        id: true,
        professionType: true,
        verificationStatus: true,
        licenseVerified: true,
        licenseExpiry: true,
        verificationDocs: {
          where: { type: VerificationDocumentType.LICENSE },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { status: true },
        },
      },
    })

    if (!pro) return jsonFail(404, 'Professional profile not found.')

    const licenseRequired = requiresCaBbcLicense(pro.professionType)
    const latestDocStatus = pro.verificationDocs[0]?.status ?? null

    let kind: BannerKind | null = null
    let expiresInDays: number | null = null

    // Expiry warnings (even if approved)
    if (licenseRequired && pro.licenseExpiry) {
      const d = daysUntil(pro.licenseExpiry)
      expiresInDays = d
      if (d < 0) kind = 'EXPIRED'
      else if (d <= 30) kind = 'EXPIRING_SOON'
    }

    // Missing/pending docs when not approved
    if (!kind && licenseRequired && pro.verificationStatus !== VerificationStatus.APPROVED) {
      if (!latestDocStatus) kind = 'MISSING_DOC'
      else if (latestDocStatus === VerificationStatus.PENDING) kind = 'PENDING_REVIEW'
      else kind = 'MISSING_DOC'
    }

    return jsonOk(
      {
        professionalId: pro.id,
        kind,
        expiresInDays,
      },
      200,
    )
  } catch (e) {
    console.error('GET /api/pro/compliance/summary error', e)
    return jsonFail(500, 'Internal server error')
  }
}