// lib/migration/serviceImportServer.ts
//
// Server side of the service-menu import. Preview matches a pro's competitor
// menu names against the canonical catalog (reusing the service matcher) and
// returns dropdown options. Commit creates offerings via the shared writeOffering
// and attaches an OfferingPriceRamp (price grace) for any below-minimum price —
// so nothing is rejected; new clients are protected at quote time.

import { Prisma, ServiceLocationType } from '@prisma/client'

import { isRecord } from '@/lib/guards'
import { prisma } from '@/lib/prisma'
import {
  defaultOfferingModes,
  loadProLocationCapability,
  type ProLocationCapability,
} from '@/lib/offerings/locationCapability'
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
  /**
   * W6: which modes this pro can ACTUALLY be booked in, from their bookable
   * locations. Same field, same shape, same helper as
   * `GET /api/v1/pro/services/catalog` ships to the Add-service form — the
   * import wizard is the second consumer, not a second derivation.
   */
  locationCapability: ProLocationCapability
  /**
   * The Salon/Mobile pair the commit route would itself pick for a row that
   * states neither, so the wizard can SHOW the modes it is about to import as.
   * Both clients used to hardcode salon-on/mobile-off here, which is how a
   * mobile-only pro's whole imported menu claimed in-salon.
   */
  defaultOfferingModes: { offersInSalon: boolean; offersMobile: boolean }
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
  const [catalog, locationCapability] = await Promise.all([
    loadCatalogOptions(args.professionalId),
    loadProLocationCapability(args.professionalId),
  ])
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

  return {
    catalog,
    rows,
    locationCapability,
    defaultOfferingModes: defaultOfferingModes(locationCapability),
  }
}

// One confirmed mapping the pro is committing.
export type ServiceImportDecision = {
  serviceId: string
  /**
   * W6: `null` means the caller did NOT state this mode, and commit derives it
   * from the pro's bookable locations. Distinct from a stated `false`, which
   * turns the mode off however capable the pro is.
   *
   * An absent flag used to parse as `false`; both clients therefore hardcoded
   * the pair rather than trip the NO_MODE refusal, and a mobile-only pro's
   * every imported service was written salon-only.
   */
  offersInSalon: boolean | null
  offersMobile: boolean | null
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

  // W6: when a row leaves a mode unstated, DERIVE it from the locations the pro
  // actually has — the same helper and the same seed rule
  // `POST /api/v1/pro/offerings` applies, so an imported offering and a
  // hand-added one cannot disagree about a mobile-only pro.
  //
  // Derived once per COMMIT, not per row: capability is a property of the pro,
  // and one import is 50+ decisions. Only paid for when something was actually
  // left unstated — a caller that states every flag makes no extra query.
  const capability: ProLocationCapability = args.decisions.every(
    (d) => typeof d.offersInSalon === 'boolean' && typeof d.offersMobile === 'boolean',
  )
    ? { salon: false, mobile: false }
    : await loadProLocationCapability(args.professionalId)
  const derivedModes = defaultOfferingModes(capability)

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
    // Resolve BEFORE the refusal: a row that states nothing must get its chance
    // to resolve via capability. `defaultOfferingModes` never yields neither
    // mode, so NO_MODE now only fires on an explicit both-off decision.
    const offersInSalon = d.offersInSalon ?? derivedModes.offersInSalon
    const offersMobile = d.offersMobile ?? derivedModes.offersMobile

    if (!offersInSalon && !offersMobile) {
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

      const salonRamp = buildModeRamp(offersInSalon, d.salonPrice)
      const mobileRamp = buildModeRamp(offersMobile, d.mobilePrice)

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
          offersInSalon,
          offersMobile,
          salonPrice: storedPrice(offersInSalon, d.salonPrice, salonRamp),
          salonDurationMinutes: d.salonDurationMinutes,
          mobilePrice: storedPrice(offersMobile, d.mobilePrice, mobileRamp),
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
          // Upsert, not create, as a belt-and-braces guard on
          // `@@unique([offeringId, mode])`. writeOffering can REVIVE a
          // previously removed offering, and it clears that row's old ramps as
          // it does so — so in practice nothing is here to collide with. If
          // that ever stops being true, a plain create would throw P2002 inside
          // this transaction, rolling the revive back and reporting the row as
          // "Already on your menu" while nothing actually changed. Upserting
          // fails safe instead: this import's decision is the newer one.
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

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * A mode flag the caller either STATED or left out.
 *
 * Same `hasOwnProperty` distinction `POST /api/v1/pro/offerings` makes, so the
 * two write paths agree on what "unstated" means. Where that route 400s on a
 * present-but-non-boolean, this one has no per-row error channel, so a garbage
 * value degrades to `null` (derive) rather than the old silent `false` — it can
 * never switch a mode ON that the pro's locations cannot host.
 */
function asStatedBool(record: Record<string, unknown>, key: string): boolean | null {
  if (!Object.prototype.hasOwnProperty.call(record, key)) return null
  const value = record[key]
  return typeof value === 'boolean' ? value : null
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
      offersInSalon: asStatedBool(d, 'offersInSalon'),
      offersMobile: asStatedBool(d, 'offersMobile'),
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
