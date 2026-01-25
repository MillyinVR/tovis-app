// lib/messages.ts
export type MessageContext =
  | { kind: 'BOOKING'; bookingId: string }
  | { kind: 'OFFERING'; offeringId: string }
  | { kind: 'SERVICE'; serviceId: string; professionalId: string }
  | { kind: 'PRO'; professionalId: string }

export function messageStartHref(ctx: MessageContext) {
  const p = new URLSearchParams()
  p.set('kind', ctx.kind)

  if (ctx.kind === 'BOOKING') p.set('bookingId', ctx.bookingId)
  if (ctx.kind === 'OFFERING') p.set('offeringId', ctx.offeringId)
  if (ctx.kind === 'SERVICE') {
    p.set('serviceId', ctx.serviceId)
    p.set('professionalId', ctx.professionalId)
  }
  if (ctx.kind === 'PRO') p.set('professionalId', ctx.professionalId)

  // This goes to an API-backed “resolve thread” page
  return `/messages/start?${p.toString()}`
}
