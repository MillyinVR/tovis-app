// lib/clients/claimLinkChannel.ts
//
// Channel attribution for claim links. The same claim token is delivered by
// BOTH email and SMS, so a bare click proves control of *one* of the two
// on-file contacts without saying which. These helpers stamp each delivered
// link with the channel it went out on — `?via=email|sms&vsig=<hmac>` — so a
// click can count as verification of THAT channel and nothing else.
//
// The signature is what makes the marker trustworthy: it is an HMAC-SHA256
// over (token, channel) keyed by JWT_SECRET with a domain-separation prefix
// (the same stateless pattern as lib/calendar/bookingInvite's ICS token).
// Someone holding the SMS variant cannot forge `via=email` — they'd need the
// email variant's signature, which only ever existed inside the email message.
// Rotating the token invalidates all prior signatures with it.
//
// An invalid or missing marker is never an error: verification credit is an
// upgrade on top of the claim flow, so verifiers return null and the claim
// proceeds without a stamp.

import { createHmac, timingSafeEqual } from 'node:crypto'

import { ContactMethod } from '@prisma/client'

import { requireEnv } from '@/lib/env'

const CLAIM_CHANNEL_SIG_VERSION = 'v1'

export const CLAIM_CHANNEL_VIA_PARAM = 'via'
export const CLAIM_CHANNEL_SIG_PARAM = 'vsig'

type ClaimChannelViaValue = 'email' | 'sms'

function viaValueForChannel(channel: ContactMethod): ClaimChannelViaValue {
  return channel === ContactMethod.EMAIL ? 'email' : 'sms'
}

function channelForViaValue(value: string): ContactMethod | null {
  if (value === 'email') return ContactMethod.EMAIL
  if (value === 'sms') return ContactMethod.SMS
  return null
}

function claimChannelSignature(rawToken: string, via: ClaimChannelViaValue): string {
  return createHmac('sha256', requireEnv('JWT_SECRET'))
    .update(`claim-channel:${CLAIM_CHANNEL_SIG_VERSION}:${via}:${rawToken}`)
    .digest('base64url')
}

export function signClaimLinkChannel(
  rawToken: string,
  channel: ContactMethod,
): { via: ClaimChannelViaValue; sig: string } {
  const via = viaValueForChannel(channel)
  return { via, sig: claimChannelSignature(rawToken, via) }
}

/**
 * Validate a `via` + `vsig` pair against the claim token it arrived with.
 * Returns the proven delivery channel, or null for anything missing, unknown,
 * or tampered — never throws.
 */
export function verifyClaimLinkChannel(args: {
  rawToken: string | null
  via: string | null
  sig: string | null
}): ContactMethod | null {
  const rawToken = args.rawToken?.trim()
  const via = args.via?.trim().toLowerCase()
  const sig = args.sig?.trim()

  if (!rawToken || !via || !sig) return null

  const channel = channelForViaValue(via)
  if (!channel) return null

  const expected = Buffer.from(
    claimChannelSignature(rawToken, viaValueForChannel(channel)),
  )
  const provided = Buffer.from(sig)
  if (expected.length !== provided.length) return null
  if (!timingSafeEqual(expected, provided)) return null

  return channel
}

/**
 * Stamp a claim link's internal href with the channel it is about to be
 * delivered on. Anything that isn't a `/claim/<token>` path, or a channel
 * that isn't EMAIL/SMS, passes through untouched — safe to apply to every
 * outbound delivery href.
 */
export function appendClaimChannelParams(
  href: string,
  channel: ContactMethod | null,
): string {
  if (!channel) return href
  if (channel !== ContactMethod.EMAIL && channel !== ContactMethod.SMS) {
    return href
  }

  const match = /^\/claim\/([^/?#]+)$/.exec(href)
  const encodedToken = match?.[1]
  if (!encodedToken) return href

  let rawToken: string
  try {
    rawToken = decodeURIComponent(encodedToken)
  } catch {
    return href
  }
  if (!rawToken.trim()) return href

  const { via, sig } = signClaimLinkChannel(rawToken, channel)
  const params = new URLSearchParams()
  params.set(CLAIM_CHANNEL_VIA_PARAM, via)
  params.set(CLAIM_CHANNEL_SIG_PARAM, sig)

  return `${href}?${params.toString()}`
}
