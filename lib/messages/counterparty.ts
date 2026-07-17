// lib/messages/counterparty.ts
//
// Single source of truth for resolving a message thread's counterparty — the
// participant the viewer is NOT — into a display title + avatar. Shared by the
// inbox list and the thread header so the two never drift (they previously each
// inlined the same branch + their own `formatPersonName`).
//
// The viewer/counterparty split is decided by `viewerIsThreadPro`, which callers
// derive from the viewer's *user id* (`thread.professional.userId === viewerId`),
// never their acting role — so a dual-role user (a pro who also books as a
// client) and admins always see the other party, never their own name.

import type { ProNameDisplay } from '@prisma/client'

import { formatProfessionalPublicDisplayName } from '@/lib/privacy/professionalDisplayName'

function isPresentString(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/** First + last name, trimmed; empty string when neither is present. */
export function formatPersonName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string {
  return [firstName, lastName].filter(isPresentString).join(' ').trim()
}

type CounterpartyClient = {
  firstName?: string | null
  lastName?: string | null
  avatarUrl?: string | null
}

type CounterpartyProfessional = {
  businessName?: string | null
  firstName?: string | null
  lastName?: string | null
  handle?: string | null
  nameDisplay?: ProNameDisplay | null
  avatarUrl?: string | null
}

/**
 * Resolve the counterparty's display title + avatar for a thread. When the
 * viewer is the pro, that's the client (person name, fallback "Client"); when
 * the viewer is the client, that's the pro — resolved through the toggle-aware
 * public display-name rule (honors `nameDisplay`: business name / real name /
 * @handle), fallback "Professional".
 */
export function resolveThreadCounterparty(args: {
  viewerIsThreadPro: boolean
  client: CounterpartyClient | null | undefined
  professional: CounterpartyProfessional | null | undefined
}): { title: string; avatarUrl: string | null } {
  const { viewerIsThreadPro, client, professional } = args

  if (viewerIsThreadPro) {
    return {
      title: formatPersonName(client?.firstName, client?.lastName) || 'Client',
      avatarUrl: client?.avatarUrl ?? null,
    }
  }

  return {
    title: formatProfessionalPublicDisplayName(
      {
        businessName: professional?.businessName,
        firstName: professional?.firstName,
        lastName: professional?.lastName,
        handle: professional?.handle,
        nameDisplay: professional?.nameDisplay,
      },
      'Professional',
    ),
    avatarUrl: professional?.avatarUrl ?? null,
  }
}
