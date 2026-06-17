// lib/migration/priceRamp.ts
//
// Canonical price-grace ramp math — the single source for the per-step formula,
// the policy floor, the ramp lifecycle (create + advance), and quote-time
// resolution. Pure (no Prisma, no React) so the UI calculator and the server
// both build on the exact same rules. Works in whole-number money (the DB
// stores Decimal; callers convert at the boundary).

export type RaiseStepMode = 'PCT' | 'USD'

// Policy floor (contract: 10% every 10 weeks — not a per-pro setting). A pro may
// go faster (bigger step / shorter cadence), never gentler.
export const RAISE_FLOOR_PCT = 10
export const RAISE_FLOOR_WEEKS = 10

// Smallest step allowed by the floor for the given mode + current price.
export function floorStepValue(mode: RaiseStepMode, currentPrice: number): number {
  return mode === 'PCT'
    ? RAISE_FLOOR_PCT
    : Math.max(1, Math.round((currentPrice * RAISE_FLOOR_PCT) / 100))
}

// Clamp a pro-chosen step so it's never gentler than the floor (faster is fine).
export function clampStepValue(
  mode: RaiseStepMode,
  value: number,
  currentPrice: number,
): number {
  return Math.max(floorStepValue(mode, currentPrice), Math.round(value))
}

// Clamp cadence so it's never slower than the floor (fewer weeks = faster = ok).
export function clampCadenceWeeks(weeks: number): number {
  return Math.min(RAISE_FLOOR_WEEKS, Math.max(1, Math.round(weeks)))
}

// THE canonical single step: one increase from `price` toward `target`, clamped
// so it always makes progress and never overshoots the target (catalog minimum).
export function nextStepPrice(
  price: number,
  mode: RaiseStepMode,
  value: number,
  target: number,
): number {
  if (price >= target) return target
  let next = mode === 'PCT' ? Math.round(price * (1 + value / 100)) : Math.round(price + value)
  if (next <= price) next = price + 1 // guarantee progress (e.g. value 0)
  if (next >= target) next = target
  return next
}

export function addWeeks(from: Date, weeks: number): Date {
  const out = new Date(from.getTime())
  out.setDate(out.getDate() + weeks * 7)
  return out
}

export function needsRamp(grandfatheredPrice: number, minPrice: number): boolean {
  return Math.round(grandfatheredPrice) < Math.round(minPrice)
}

export type RampValues = {
  targetPrice: number
  currentPrice: number
  stepMode: RaiseStepMode
  stepValue: number
  cadenceWeeks: number
  startedAt: Date
  nextStepAt: Date
  completedAt: Date | null
}

// Initial persisted ramp values for a below-minimum offering price.
export function buildInitialRamp(args: {
  grandfatheredPrice: number
  minPrice: number
  stepMode: RaiseStepMode
  stepValue: number
  cadenceWeeks: number
  startedAt: Date
}): RampValues {
  const targetPrice = Math.round(args.minPrice)
  const currentPrice = Math.round(args.grandfatheredPrice)
  const cadenceWeeks = clampCadenceWeeks(args.cadenceWeeks)
  const stepValue = clampStepValue(args.stepMode, args.stepValue, currentPrice)
  const alreadyThere = currentPrice >= targetPrice
  return {
    targetPrice,
    currentPrice,
    stepMode: args.stepMode,
    stepValue,
    cadenceWeeks,
    startedAt: args.startedAt,
    nextStepAt: addWeeks(args.startedAt, cadenceWeeks),
    completedAt: alreadyThere ? args.startedAt : null,
  }
}

export type RampState = {
  currentPrice: number
  targetPrice: number
  stepMode: RaiseStepMode
  stepValue: number
  cadenceWeeks: number
  nextStepAt: Date
  completedAt: Date | null
}

// Advance a ramp to `now`, applying every step whose time has passed (so a
// missed cron tick catches up). Returns the fields the step job persists.
export function advanceRamp(
  state: RampState,
  now: Date,
): { currentPrice: number; nextStepAt: Date; completedAt: Date | null } {
  if (state.completedAt) {
    return {
      currentPrice: state.currentPrice,
      nextStepAt: state.nextStepAt,
      completedAt: state.completedAt,
    }
  }
  let price = state.currentPrice
  let nextStepAt = state.nextStepAt
  let completedAt: Date | null = null
  let guard = 0
  while (price < state.targetPrice && nextStepAt.getTime() <= now.getTime() && guard < 200) {
    guard += 1
    price = nextStepPrice(price, state.stepMode, state.stepValue, state.targetPrice)
    nextStepAt = addWeeks(nextStepAt, state.cadenceWeeks)
  }
  if (price >= state.targetPrice) completedAt = now
  return { currentPrice: price, nextStepAt, completedAt }
}

// Quote-time price for one client + offering mode. `ramp` is present only when
// the offering's price is below the catalog minimum. New clients always pay the
// minimum (targetPrice); existing clients pay the current ramped price.
export function effectiveUnitPrice(args: {
  listPrice: number
  minPrice: number
  ramp: { currentPrice: number; targetPrice: number } | null
  isExistingClient: boolean
}): number {
  if (!args.ramp) return Math.max(args.listPrice, args.minPrice)
  return args.isExistingClient ? args.ramp.currentPrice : args.ramp.targetPrice
}
