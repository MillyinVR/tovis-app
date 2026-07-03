/**
 * Shared identity/recipient routing for Looks social notifications.
 *
 * Every Looks engagement event (comment, reply, like, save) resolves the same
 * two questions: "is this actor the look's author?" (skip self-notifications)
 * and "which inbox does a party receive on?" (pro vs client). Extracted from
 * the A1 comment module so the A2 engagement events reuse it instead of
 * re-spelling the routing rules.
 */

/** A user identity as both inbox routes see it (either profile may be absent). */
export type LookPartyIdentity = {
  userId: string
  clientProfileId: string | null
  professionalProfileId: string | null
}

/** The look's author reference, as stored on LookPost. */
export type LookAuthorRef = {
  professionalId: string
  /** Set for client-shared looks — the client, not the pro, is the author. */
  clientAuthorId: string | null
}

/** Whichever identity should receive a notification (pro or client inbox). */
export type LookNotificationRecipient =
  | { kind: 'pro'; professionalId: string }
  | { kind: 'client'; clientId: string }

/** Whether this identity authored the look (client author wins when set). */
export function isLookAuthorIdentity(
  identity: LookPartyIdentity,
  look: LookAuthorRef,
): boolean {
  return look.clientAuthorId
    ? identity.clientProfileId === look.clientAuthorId
    : identity.professionalProfileId === look.professionalId
}

/** Routes a party to whichever inbox it can receive (pro-first). */
export function toLookNotificationRecipient(
  identity: LookPartyIdentity,
): LookNotificationRecipient | null {
  if (identity.professionalProfileId) {
    return { kind: 'pro', professionalId: identity.professionalProfileId }
  }
  if (identity.clientProfileId) {
    return { kind: 'client', clientId: identity.clientProfileId }
  }
  return null
}

/** The look author's inbox (client author when set, else the pro). */
export function lookAuthorRecipient(
  look: LookAuthorRef,
): LookNotificationRecipient {
  return look.clientAuthorId
    ? { kind: 'client', clientId: look.clientAuthorId }
    : { kind: 'pro', professionalId: look.professionalId }
}
