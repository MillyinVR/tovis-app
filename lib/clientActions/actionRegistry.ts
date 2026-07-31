import {
  ClientActionTokenKind,
  ContactMethod,
  NotificationEventKey,
  NotificationRecipientKind,
} from '@prisma/client'

import { CONSULTATION_ACTION_TOKEN_EXPIRY_MS } from '@/lib/consultation/clientActionTokens'
import { isRecipientSupportedForEvent } from '@/lib/notifications/eventKeys'

import {
  CLIENT_ACTION_TYPES,
  type ClientActionDefinition,
  type ClientActionType,
} from './types'

/**
 * Central source of truth for client-action rules.
 *
 * Important:
 * CLIENT_CLAIM_INVITE is a client-action type, but not a ClientActionTokenKind.
 * Claim invites use a claim-link token in the URL, but they do not create a
 * ClientActionToken row. New ProClientInvite rows persist tokenHash only; the
 * raw token exists only at creation/delivery time.
 */
export const AFTERCARE_ACCESS_TOKEN_EXPIRY_MS =
  1000 * 60 * 60 * 24 * 7 // 7 days

// K10-B: fallback only — issue sites always pass an expiresAtOverride derived
// from the booking (max(depositDueAt, scheduledFor)).
export const DEPOSIT_PAYMENT_TOKEN_FALLBACK_EXPIRY_MS =
  1000 * 60 * 60 * 24 * 30 // 30 days

// K12: fallback only — the mint site always passes an expiresAtOverride of the
// appointment start (confirming/cancelling from a reminder link is meaningless
// once the appointment has begun).
export const APPOINTMENT_CONFIRMATION_TOKEN_FALLBACK_EXPIRY_MS =
  1000 * 60 * 60 * 24 * 30 // 30 days

const EMAIL_OR_SMS_CONTACT_METHODS: readonly ContactMethod[] = [
  ContactMethod.EMAIL,
  ContactMethod.SMS,
]

function validateClientActionDefinition(
  definition: ClientActionDefinition,
): void {
  if (definition.token.required && definition.token.kind == null) {
    throw new Error(
      `clientActions/actionRegistry: ${definition.type} requires a token kind.`,
    )
  }

  if (!definition.token.required && definition.token.kind != null) {
    throw new Error(
      `clientActions/actionRegistry: ${definition.type} cannot declare a token kind when token.required is false.`,
    )
  }

  const preferred = definition.delivery.preferredContactMethod
  if (
    preferred != null &&
    !definition.delivery.allowedContactMethods.includes(preferred)
  ) {
    throw new Error(
      `clientActions/actionRegistry: ${definition.type} preferred contact method ${preferred} is not allowed.`,
    )
  }

  const eventKey = definition.delivery.notificationEventKey
  if (
    eventKey != null &&
    !isRecipientSupportedForEvent(
      eventKey,
      definition.delivery.notificationRecipientKind,
    )
  ) {
    throw new Error(
      `clientActions/actionRegistry: ${definition.type} recipient ${definition.delivery.notificationRecipientKind} is not supported for event ${eventKey}.`,
    )
  }

  if (!definition.link.pathPrefix.startsWith('/')) {
    throw new Error(
      `clientActions/actionRegistry: ${definition.type} pathPrefix must start with "/".`,
    )
  }
}

function validateClientActionRegistry(
  registry: Record<ClientActionType, ClientActionDefinition>,
): void {
  for (const type of CLIENT_ACTION_TYPES) {
    const definition = registry[type]
    if (!definition) {
      throw new Error(
        `clientActions/actionRegistry: missing registry definition for ${type}.`,
      )
    }

    if (definition.type !== type) {
      throw new Error(
        `clientActions/actionRegistry: definition key ${type} does not match embedded type ${definition.type}.`,
      )
    }

    validateClientActionDefinition(definition)
  }
}

export const CLIENT_ACTION_REGISTRY: Record<
  ClientActionType,
  ClientActionDefinition
> = {
  CLIENT_CLAIM_INVITE: {
    type: 'CLIENT_CLAIM_INVITE',
    token: {
      required: false,
      kind: null,
      singleUse: false,
      expiresInMs: null,
      revokeOutstandingOnResend: false,
    },
    delivery: {
      /**
       * Claim invites are snapshot-based delivery for often-unclaimed clients,
       * so this stays EMAIL/SMS only and intentionally does not default to IN_APP.
       */
      allowedContactMethods: EMAIL_OR_SMS_CONTACT_METHODS,
      preferredContactMethod: null,
      notificationEventKey: NotificationEventKey.CLIENT_CLAIM_INVITE,
      notificationRecipientKind: NotificationRecipientKind.CLIENT,
      createFreshDeliveryOnResend: true,
      // A cold self-serve / orphan claim can be pro-less (no pro in context);
      // the delivery degrades to brand-level copy.
      allowsNullProfessional: true,
    },
    link: {
      target: 'CLAIM',
      pathPrefix: '/claim',
      requiresToken: true,
    },
  },

  AFTERCARE_ACCESS: {
    type: 'AFTERCARE_ACCESS',
    token: {
      required: true,
      kind: ClientActionTokenKind.AFTERCARE_ACCESS,
      singleUse: false,
      expiresInMs: AFTERCARE_ACCESS_TOKEN_EXPIRY_MS,
      revokeOutstandingOnResend: true,
    },
    delivery: {
      /**
       * Email-preferred, SMS fallback. Phone-only (often unclaimed) clients
       * receive the secure aftercare magic link via SMS. Kept in sync with the
       * AFTERCARE_READY notification catalog (CLIENT_ALL_CHANNELS includes SMS)
       * and resolveAllowUnverifiedDestination() in enqueueClientActionDispatch.
       */
      allowedContactMethods: EMAIL_OR_SMS_CONTACT_METHODS,
      preferredContactMethod: ContactMethod.EMAIL,
      notificationEventKey: NotificationEventKey.AFTERCARE_READY,
      notificationRecipientKind: NotificationRecipientKind.CLIENT,
      createFreshDeliveryOnResend: true,
    },
    link: {
      target: 'AFTERCARE',
      pathPrefix: '/client/rebook',
      requiresToken: true,
    },
  },

  DEPOSIT_PAYMENT: {
    type: 'DEPOSIT_PAYMENT',
    token: {
      required: true,
      kind: ClientActionTokenKind.DEPOSIT_PAYMENT,
      // Re-openable like AFTERCARE_ACCESS: the client may open the link, bail
      // out of Stripe Checkout, and come back. Payment completion is enforced
      // by the booking's depositStatus, not by burning the token.
      singleUse: false,
      // Fallback only — every issue site passes an expiresAtOverride tied to
      // the booking (max of the release deadline and the appointment), so a
      // link never outlives the deposit it collects by much.
      expiresInMs: DEPOSIT_PAYMENT_TOKEN_FALLBACK_EXPIRY_MS,
      revokeOutstandingOnResend: true,
    },
    delivery: {
      /**
       * Email-preferred, SMS fallback. Phone-only (often unclaimed) clients
       * receive the secure pay link via SMS. Kept in sync with the
       * DEPOSIT_PAYMENT_LINK notification catalog (CLIENT_EMAIL_SMS_CHANNELS)
       * and resolveAllowUnverifiedDestination() in enqueueClientActionDispatch.
       */
      allowedContactMethods: EMAIL_OR_SMS_CONTACT_METHODS,
      preferredContactMethod: ContactMethod.EMAIL,
      notificationEventKey: NotificationEventKey.DEPOSIT_PAYMENT_LINK,
      notificationRecipientKind: NotificationRecipientKind.CLIENT,
      createFreshDeliveryOnResend: true,
    },
    link: {
      target: 'DEPOSIT',
      pathPrefix: '/client/deposit',
      requiresToken: true,
    },
  },

  APPOINTMENT_CONFIRMATION: {
    type: 'APPOINTMENT_CONFIRMATION',
    token: {
      required: true,
      kind: ClientActionTokenKind.APPOINTMENT_CONFIRMATION,
      // NOT single-use: the client may confirm and later come back through the
      // same message to cancel or reschedule; each action re-validates against
      // the booking's own state, and the token dies at the appointment start.
      singleUse: false,
      expiresInMs: APPOINTMENT_CONFIRMATION_TOKEN_FALLBACK_EXPIRY_MS,
      // Deliberately false, unlike DEPOSIT_PAYMENT: a booking with a 24h and a
      // 2h reminder mints a token per ask, and revoking the earlier one would
      // break the link in the SMS the client is most likely to still have open.
      // All live tokens expire together at the appointment start.
      revokeOutstandingOnResend: false,
    },
    delivery: {
      /**
       * The ask rides the APPOINTMENT_REMINDER notification rail (the reminder
       * cron mints the token and swaps the reminder's href/copy) — it does NOT
       * dispatch through enqueueClientActionDispatch. The event key is recorded
       * here so the registry stays the one place that says which delivery
       * carries which action link (the K10-B AFTERCARE split precedent).
       */
      allowedContactMethods: EMAIL_OR_SMS_CONTACT_METHODS,
      preferredContactMethod: null,
      notificationEventKey: NotificationEventKey.APPOINTMENT_REMINDER,
      notificationRecipientKind: NotificationRecipientKind.CLIENT,
      createFreshDeliveryOnResend: false,
    },
    link: {
      target: 'APPOINTMENT',
      pathPrefix: '/client/appointment',
      requiresToken: true,
    },
  },

  CONSULTATION_ACTION: {
    type: 'CONSULTATION_ACTION',
    token: {
      required: true,
      kind: ClientActionTokenKind.CONSULTATION_ACTION,
      singleUse: true,
      expiresInMs: CONSULTATION_ACTION_TOKEN_EXPIRY_MS,
      revokeOutstandingOnResend: true,
    },
    delivery: {
      /**
       * Email-preferred, SMS fallback. Phone-only (often unclaimed) clients
       * receive the secure consultation magic link via SMS. Kept in sync with
       * the CONSULTATION_PROPOSAL_SENT notification catalog (CLIENT_ALL_CHANNELS
       * includes SMS) and resolveAllowUnverifiedDestination() in
       * enqueueClientActionDispatch.
       */
      allowedContactMethods: EMAIL_OR_SMS_CONTACT_METHODS,
      preferredContactMethod: ContactMethod.EMAIL,
      notificationEventKey: NotificationEventKey.CONSULTATION_PROPOSAL_SENT,
      notificationRecipientKind: NotificationRecipientKind.CLIENT,
      createFreshDeliveryOnResend: true,
    },
    link: {
      target: 'CONSULTATION',
      pathPrefix: '/client/consultation',
      requiresToken: true,
    },
  },
}

validateClientActionRegistry(CLIENT_ACTION_REGISTRY)

export function getClientActionDefinition(
  type: ClientActionType,
): ClientActionDefinition {
  return CLIENT_ACTION_REGISTRY[type]
}

export function listClientActionDefinitions(): ClientActionDefinition[] {
  return CLIENT_ACTION_TYPES.map((type) => CLIENT_ACTION_REGISTRY[type])
}

export function getClientActionTokenKindForType(
  type: ClientActionType,
): ClientActionTokenKind | null {
  return getClientActionDefinition(type).token.kind
}