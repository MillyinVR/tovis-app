// lib/messages.ts

export type MessageContext =
  | { kind: 'BOOKING'; bookingId: string }
  | { kind: 'OFFERING'; offeringId: string }
  | { kind: 'SERVICE'; serviceId: string; professionalId: string }
  | { kind: 'PRO_PROFILE'; professionalId: string } // client -> pro
  | { kind: 'PRO_PROFILE_AS_PRO'; professionalId: string; clientId: string } // pro -> client

type ResolvePayload = {
  contextType: 'BOOKING' | 'OFFERING' | 'SERVICE' | 'PRO_PROFILE'
  contextId: string
  professionalId?: string
  clientId?: string
}

export function toResolvePayload(ctx: MessageContext): ResolvePayload {
  switch (ctx.kind) {
    case 'BOOKING':
      return { contextType: 'BOOKING', contextId: ctx.bookingId }
    case 'OFFERING':
      return { contextType: 'OFFERING', contextId: ctx.offeringId }
    case 'SERVICE':
      return {
        contextType: 'SERVICE',
        contextId: ctx.serviceId,
        professionalId: ctx.professionalId,
      }
    case 'PRO_PROFILE':
      return {
        contextType: 'PRO_PROFILE',
        contextId: ctx.professionalId,
      }
    case 'PRO_PROFILE_AS_PRO':
      return {
        contextType: 'PRO_PROFILE',
        contextId: ctx.professionalId,
        clientId: ctx.clientId,
      }
  }
}

export function messageStartHref(ctx: MessageContext) {
  const p = new URLSearchParams()
  const payload = toResolvePayload(ctx)

  p.set('contextType', payload.contextType)
  p.set('contextId', payload.contextId)
  if (payload.professionalId) p.set('professionalId', payload.professionalId)
  if (payload.clientId) p.set('clientId', payload.clientId)

  return `/messages/start?${p.toString()}`
}
