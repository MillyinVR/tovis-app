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
 * Phase 1 registry:
 * - central source of truth for client-action rules
 * - no route logic here
 * - no DB writes here
 *
 * Important:
 * CLIENT_CLAIM_INVITE is a client-action type, but not a ClientActionTokenKind.
 * Claim invites currently ride on ProClientInvite.token, so its token.kind is null.
 */

export const AFTERCARE_ACCESS_TOKEN_EXPIRY_MS =
  1000 * 60 * 60 * 24 * 7 // 7 days

const EMAIL_ONLY_CONTACT_METHODS: readonly ContactMethod[] = [
  ContactMethod.EMAIL,
]

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
      allowedContactMethods: EMAIL_OR_SMS_CONTACT_METHODS,
      preferredContactMethod: null,
      notificationEventKey: null,
      notificationRecipientKind: NotificationRecipientKind.CLIENT,
      createFreshDeliveryOnResend: true,
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
       * Kept EMAIL-only for now to stay aligned with the current
       * AFTERCARE_READY notification catalog.
       * If you later add SMS delivery for magic links, update this registry
       * and the notification event/channel rules together.
       */
      allowedContactMethods: EMAIL_ONLY_CONTACT_METHODS,
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
       * Kept EMAIL-only for now to stay aligned with the current
       * CONSULTATION_PROPOSAL_SENT notification catalog.
       * If you later add SMS delivery for magic links, update this registry
       * and the notification event/channel rules together.
       */
      allowedContactMethods: EMAIL_ONLY_CONTACT_METHODS,
      preferredContactMethod: ContactMethod.EMAIL,
      notificationEventKey:
        NotificationEventKey.CONSULTATION_PROPOSAL_SENT,
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