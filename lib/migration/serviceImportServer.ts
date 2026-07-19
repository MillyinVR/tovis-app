// lib/migration/serviceImportServer.ts
//
// Server side of the service-menu import. Preview matches a pro's competitor
// menu names against the canonical catalog (reusing the service matcher) and
// returns dropdown options. Commit creates offerings via the shared writeOffering
// and attaches an OfferingPriceRamp (price grace) for any below-minimum price —
// so nothing is rejected; new clients are protected at quote time.

import { Prisma, ServiceLocationType } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import {
  OfferingAlreadyActiveError,
  writeOffering,
} from '@/lib/offerings/writeOffering'
import { loadAllowedServices } from '@/lib/services/allowedServices'

import {
  buildInitialRamp,
  needsRamp,
  type RaiseStepMode,
  type RampValues,
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
  defaultDurationMinutes: number
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
    defaultDurationMinutes: s.defaultDurationMinutes,
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
      const now = new Date()
      // Build each enabled mode's ramp up front (pure). When the pro's price is
      // below the catalog minimum we ramp it; the offering's *stored* price is
      // then the ramp target (catalog min) — so the menu + availability screen
      // advertise the minimum (what a new client pays) while existing clients
      // keep their grandfathered price via the ramp at quote time.
      const buildModeRamp = (enabled: boolean, price: number | null) =>
        enabled && price !== null && needsRamp(price, minPrice)
          ? buildInitialRamp({
              grandfatheredPrice: price,
              minPrice,
              stepMode: d.ramp.stepMode,
              stepValue: d.ramp.stepValue,
              cadenceWeeks: d.ramp.cadenceWeeks,
              startedAt: now,
            })
          : null

      const salonRamp = buildModeRamp(d.offersInSalon, d.salonPrice)
      const mobileRamp = buildModeRamp(d.offersMobile, d.mobilePrice)

      const storedPrice = (
        enabled: boolean,
        price: number | null,
        ramp: ReturnType<typeof buildInitialRamp> | null,
      ): Prisma.Decimal | null => {
        if (!enabled || price === null) return null
        return dec(ramp ? ramp.targetPrice : price)
      }

      const outcome = await prisma.$transaction(async (tx) => {
        const offering = await writeOffering({
          tx,
          professionalId: args.professionalId,
          serviceId: d.serviceId,
          offersInSalon: d.offersInSalon,
          offersMobile: d.offersMobile,
          salonPrice: storedPrice(d.offersInSalon, d.salonPrice, salonRamp),
          salonDurationMinutes: d.salonDurationMinutes,
          mobilePrice: storedPrice(d.offersMobile, d.mobilePrice, mobileRamp),
          mobileDurationMinutes: d.mobileDurationMinutes,
        })

        let ramps = 0
        const modeRamps: Array<{ mode: ServiceLocationType; ramp: RampValues | null }> = [
          { mode: ServiceLocationType.SALON, ramp: salonRamp },
          { mode: ServiceLocationType.MOBILE, ramp: mobileRamp },
        ]
        for (const { mode, ramp } of modeRamps) {
          if (!ramp) continue
          const rampFields = {
            grandfatheredPrice: dec(ramp.currentPrice),
            targetPrice: dec(ramp.targetPrice),
            currentPrice: dec(ramp.currentPrice),
            stepMode: ramp.stepMode,
            stepValue: dec(ramp.stepValue),
            cadenceWeeks: ramp.cadenceWeeks,
            startedAt: ramp.startedAt,
            nextStepAt: ramp.nextStepAt,
            completedAt: ramp.completedAt,
          }
          // Upsert, not create: writeOffering can now REVIVE a previously
          // removed offering, and that offering may still carry a ramp from an
          // earlier import. `@@unique([offeringId, mode])` would make a plain
          // create throw P2002 — inside this transaction, that would roll the
          // revive back and report the row as "Already on your menu" while
          // nothing actually changed. This import's decision is the newer one,
          // so it wins.
          await tx.offeringPriceRamp.upsert({
            where: { offeringId_mode: { offeringId: offering.id, mode } },
            create: { offeringId: offering.id, mode, ...rampFields },
            update: rampFields,
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
      // Already on the pro's menu AND live. A service the pro previously
      // REMOVED no longer lands here — writeOffering revives that row and the
      // import counts it as created, which is what "import my menu" means. Only
      // a genuine live duplicate is skipped. P2002 stays as the race fallback.
      if (
        error instanceof OfferingAlreadyActiveError ||
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002')
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

// ── request parsing (shared by the preview + commit routes; no casts) ─────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

export function parseServiceMenuRows(body: unknown): ServiceMenuInputRow[] | null {
  if (!isRecord(body) || !Array.isArray(body.rows)) return null
  return body.rows.filter(isRecord).flatMap((r) => {
    const name = asString(r.name).trim()
    if (!name) return []
    return [{ name, price: asNumber(r.price), durationMinutes: asNumber(r.durationMinutes) }]
  })
}

export function parseServiceDecisions(body: unknown): ServiceImportDecision[] | null {
  if (!isRecord(body) || !Array.isArray(body.decisions)) return null
  return body.decisions.filter(isRecord).flatMap((d) => {
    const serviceId = asString(d.serviceId)
    if (!serviceId) return []
    const rampIn = isRecord(d.ramp) ? d.ramp : {}
    const decision: ServiceImportDecision = {
      serviceId,
      offersInSalon: asBool(d.offersInSalon, false),
      offersMobile: asBool(d.offersMobile, false),
      salonPrice: asNumber(d.salonPrice),
      salonDurationMinutes: asNumber(d.salonDurationMinutes),
      mobilePrice: asNumber(d.mobilePrice),
      mobileDurationMinutes: asNumber(d.mobileDurationMinutes),
      ramp: {
        stepMode: rampIn.stepMode === 'USD' ? 'USD' : 'PCT',
        stepValue: asNumber(rampIn.stepValue) ?? 10,
        cadenceWeeks: asNumber(rampIn.cadenceWeeks) ?? 10,
      },
    }
    return [decision]
  })
}
