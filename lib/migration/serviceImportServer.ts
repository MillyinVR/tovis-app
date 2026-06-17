// lib/migration/serviceImportServer.ts
//
// Server side of the service-menu import. Preview matches a pro's competitor
// menu names against the canonical catalog (reusing the service matcher) and
// returns dropdown options. Commit creates offerings via the shared writeOffering
// and attaches an OfferingPriceRamp (price grace) for any below-minimum price —
// so nothing is rejected; new clients are protected at quote time.

import { Prisma, ServiceLocationType } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { writeOffering } from '@/lib/offerings/writeOffering'
import { loadAllowedServices } from '@/lib/services/allowedServices'

import {
  buildInitialRamp,
  needsRamp,
  type RaiseStepMode,
} from './priceRamp'
import {
  isConfident,
  suggestServices,
  type MatchCatalogEntry,
} from './serviceMatch'

export type CatalogOption = {
  id: string
  name: string
  categoryName: string | null
  minPrice: number
  allowMobile: boolean
}

export type ServiceSuggestionDto = {
  serviceId: string
  name: string
  categoryName: string | null
  score: number
}

export type ServicePreviewRow = {
  index: number
  sourceName: string
  sourcePrice: number | null
  sourceDurationMinutes: number | null
  suggestions: ServiceSuggestionDto[]
  bestServiceId: string | null // top suggestion when confident enough to pre-select
}

export type ServiceMenuInputRow = {
  name: string
  price: number | null
  durationMinutes: number | null
}

export type ServiceImportPreview = {
  catalog: CatalogOption[]
  rows: ServicePreviewRow[]
}

async function loadCatalogOptions(professionalId: string): Promise<CatalogOption[]> {
  const allowed = await loadAllowedServices(professionalId)
  return allowed.map((s) => ({
    id: s.id,
    name: s.name,
    categoryName: s.categoryName,
    minPrice: s.minPrice ? Number(s.minPrice) : 0,
    allowMobile: s.allowMobile,
  }))
}

export async function previewServiceImport(args: {
  professionalId: string
  rows: ServiceMenuInputRow[]
}): Promise<ServiceImportPreview> {
  const catalog = await loadCatalogOptions(args.professionalId)
  const entries: MatchCatalogEntry[] = catalog.map((c) => ({
    id: c.id,
    name: c.name,
    categoryName: c.categoryName ?? undefined,
  }))

  const rows: ServicePreviewRow[] = args.rows.map((row, index) => {
    const suggestions = suggestServices(row.name, entries, { limit: 4 })
    const top = suggestions[0] ?? null
    return {
      index,
      sourceName: row.name,
      sourcePrice: row.price,
      sourceDurationMinutes: row.durationMinutes,
      suggestions: suggestions.map((s) => ({
        serviceId: s.entry.id,
        name: s.entry.name,
        categoryName: s.entry.categoryName ?? null,
        score: s.score,
      })),
      bestServiceId: isConfident(top) ? top!.entry.id : null,
    }
  })

  return { catalog, rows }
}

// One confirmed mapping the pro is committing.
export type ServiceImportDecision = {
  serviceId: string
  offersInSalon: boolean
  offersMobile: boolean
  salonPrice: number | null
  salonDurationMinutes: number | null
  mobilePrice: number | null
  mobileDurationMinutes: number | null
  // ramp settings, applied to whichever enabled mode is below minimum
  ramp: { stepMode: RaiseStepMode; stepValue: number; cadenceWeeks: number }
}

export type ServiceCommitRowResult =
  | { serviceId: string; ok: true; offeringId: string; ramps: number }
  | { serviceId: string; ok: false; code: string; error: string }

export type ServiceImportCommitResult = {
  rows: ServiceCommitRowResult[]
  summary: { attempted: number; created: number; skipped: number; rampsCreated: number }
}

function dec(n: number): Prisma.Decimal {
  return new Prisma.Decimal(n)
}

export async function commitServiceImport(args: {
  professionalId: string
  decisions: ServiceImportDecision[]
}): Promise<ServiceImportCommitResult> {
  const catalog = await loadCatalogOptions(args.professionalId)
  const minByService = new Map(catalog.map((c) => [c.id, c.minPrice]))

  const results: ServiceCommitRowResult[] = []
  let created = 0
  let skipped = 0
  let rampsCreated = 0
  let attempted = 0

  for (const d of args.decisions) {
    const minPrice = minByService.get(d.serviceId)
    if (minPrice === undefined) {
      skipped += 1
      results.push({
        serviceId: d.serviceId,
        ok: false,
        code: 'NOT_ALLOWED',
        error: 'Service is not in your allowed catalog.',
      })
      continue
    }
    if (!d.offersInSalon && !d.offersMobile) {
      skipped += 1
      results.push({
        serviceId: d.serviceId,
        ok: false,
        code: 'NO_MODE',
        error: 'Enable at least salon or mobile.',
      })
      continue
    }

    attempted += 1
    try {
      const outcome = await prisma.$transaction(async (tx) => {
        const offering = await writeOffering({
          tx,
          professionalId: args.professionalId,
          serviceId: d.serviceId,
          offersInSalon: d.offersInSalon,
          offersMobile: d.offersMobile,
          salonPrice: d.offersInSalon && d.salonPrice !== null ? dec(d.salonPrice) : null,
          salonDurationMinutes: d.salonDurationMinutes,
          mobilePrice: d.offersMobile && d.mobilePrice !== null ? dec(d.mobilePrice) : null,
          mobileDurationMinutes: d.mobileDurationMinutes,
        })

        let ramps = 0
        const now = new Date()
        const modes: Array<{ mode: ServiceLocationType; price: number | null }> = [
          { mode: ServiceLocationType.SALON, price: d.offersInSalon ? d.salonPrice : null },
          { mode: ServiceLocationType.MOBILE, price: d.offersMobile ? d.mobilePrice : null },
        ]
        for (const m of modes) {
          if (m.price === null || !needsRamp(m.price, minPrice)) continue
          const r = buildInitialRamp({
            grandfatheredPrice: m.price,
            minPrice,
            stepMode: d.ramp.stepMode,
            stepValue: d.ramp.stepValue,
            cadenceWeeks: d.ramp.cadenceWeeks,
            startedAt: now,
          })
          await tx.offeringPriceRamp.create({
            data: {
              offeringId: offering.id,
              mode: m.mode,
              grandfatheredPrice: dec(r.currentPrice),
              targetPrice: dec(r.targetPrice),
              currentPrice: dec(r.currentPrice),
              stepMode: r.stepMode,
              stepValue: dec(r.stepValue),
              cadenceWeeks: r.cadenceWeeks,
              startedAt: r.startedAt,
              nextStepAt: r.nextStepAt,
              completedAt: r.completedAt,
            },
          })
          ramps += 1
        }
        return { offeringId: offering.id, ramps }
      })

      created += 1
      rampsCreated += outcome.ramps
      results.push({
        serviceId: d.serviceId,
        ok: true,
        offeringId: outcome.offeringId,
        ramps: outcome.ramps,
      })
    } catch (error: unknown) {
      // Already on the pro's menu → unique [professionalId, serviceId].
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        skipped += 1
        results.push({
          serviceId: d.serviceId,
          ok: false,
          code: 'ALREADY_ADDED',
          error: 'Already on your menu.',
        })
        continue
      }
      throw error
    }
  }

  return {
    rows: results,
    summary: { attempted, created, skipped, rampsCreated },
  }
}
