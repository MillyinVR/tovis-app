// app/(auth)/_components/social/socialSignupHandoff.ts
//
// How the signup ticket gets from the provider button to the completion form.
//
// It goes through sessionStorage and NOT through the URL. The ticket is a
// credential — `<id>.<secret>`, single-use, and the only proof that a provider
// vouched for this email — and a URL is the one place a credential leaks by
// default: it lands in history, in a shared link, and in the Referer header
// sent to every third-party script the next page loads (this app's own
// completion screen has none, but that is a property of today's page, not of
// the mechanism). sessionStorage is per-tab, survives the navigation and a
// refresh, and never leaves the browser.
//
// It is deliberately NOT cleared on read: a person who refreshes the
// completion form mid-typing still has a live ticket, and taking it away would
// send them back through the provider for nothing. It is cleared when the
// ticket is actually spent, or when the server says it is dead.

'use client'

import { isRecord } from '@/lib/guards'
import { readStringField } from '@/lib/http'
import type { SocialProvider, SocialSignupTicket } from './submitSocialToken'

const STORAGE_KEY = 'tovis:social-signup-ticket'

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    // Private modes and "block site data" throw on access, not on use.
    return null
  }
}

function readProvider(value: string | null): SocialProvider | null {
  return value === 'google' || value === 'apple' ? value : null
}

/** Stash a ticket for the completion form. False when storage is unavailable. */
export function stashSocialSignup(ticket: SocialSignupTicket): boolean {
  const store = storage()
  if (!store) return false

  try {
    store.setItem(STORAGE_KEY, JSON.stringify(ticket))
    return true
  } catch {
    return false
  }
}

/**
 * The stashed ticket, or null when there is none, it is unreadable, or its own
 * expiry has already passed. An expired one is dropped on the way out — the
 * completion form must never post a ticket the server is certain to refuse.
 */
export function readSocialSignup(now: Date = new Date()): SocialSignupTicket | null {
  const store = storage()
  if (!store) return null

  let raw: string | null = null
  try {
    raw = store.getItem(STORAGE_KEY)
  } catch {
    return null
  }
  if (!raw) return null

  let parsed: unknown = null
  try {
    parsed = JSON.parse(raw)
  } catch {
    clearSocialSignup()
    return null
  }

  if (!isRecord(parsed)) {
    clearSocialSignup()
    return null
  }

  const provider = readProvider(readStringField(parsed, 'provider'))
  const signupTicket = readStringField(parsed, 'signupTicket')
  const ticketExpiresAt = readStringField(parsed, 'ticketExpiresAt')
  const prefill = isRecord(parsed.prefill) ? parsed.prefill : null
  const email = readStringField(prefill, 'email')

  if (!provider || !signupTicket || !ticketExpiresAt || !email) {
    clearSocialSignup()
    return null
  }

  const expiresAt = Date.parse(ticketExpiresAt)
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) {
    clearSocialSignup()
    return null
  }

  return {
    provider,
    signupTicket,
    ticketExpiresAt,
    prefill: {
      email,
      firstName: readStringField(prefill, 'firstName'),
      lastName: readStringField(prefill, 'lastName'),
    },
  }
}

export function clearSocialSignup(): void {
  const store = storage()
  if (!store) return
  try {
    store.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to do — the ticket is single-use server-side either way.
  }
}
