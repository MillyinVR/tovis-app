// lib/clientActions/linkBuilders.ts

import { getClientActionDefinition } from './actionRegistry'
import type {
  ClientActionBuildLinkArgs,
  ClientActionBuildLinkResult,
  ClientActionLinkTarget,
  ClientActionType,
} from './types'

function normalizeRequiredToken(rawToken: string): string {
  if (typeof rawToken !== 'string') {
    throw new Error('clientActions/linkBuilders: rawToken must be a string.')
  }

  const normalized = rawToken.trim()
  if (!normalized) {
    throw new Error('clientActions/linkBuilders: rawToken is required.')
  }

  return normalized
}

function normalizePathPrefix(pathPrefix: string): string {
  if (typeof pathPrefix !== 'string') {
    throw new Error('clientActions/linkBuilders: pathPrefix must be a string.')
  }

  const normalized = pathPrefix.trim()
  if (!normalized.startsWith('/')) {
    throw new Error(
      'clientActions/linkBuilders: pathPrefix must start with "/".',
    )
  }

  return normalized.replace(/\/+$/, '')
}

function appendTokenToPath(pathPrefix: string, rawToken: string): string {
  const normalizedPrefix = normalizePathPrefix(pathPrefix)
  const normalizedToken = normalizeRequiredToken(rawToken)

  return `${normalizedPrefix}/${encodeURIComponent(normalizedToken)}`
}

export function buildClientActionLink(
  args: ClientActionBuildLinkArgs & { pathPrefix: string },
): ClientActionBuildLinkResult {
  const href = appendTokenToPath(args.pathPrefix, args.rawToken)

  return {
    target: args.target,
    href,
    tokenIncluded: true,
  }
}

export function buildClientActionLinkForType(args: {
  actionType: ClientActionType
  rawToken: string
}): ClientActionBuildLinkResult {
  const definition = getClientActionDefinition(args.actionType)

  if (!definition.link.requiresToken) {
    throw new Error(
      `clientActions/linkBuilders: ${args.actionType} does not support tokenized links.`,
    )
  }

  return buildClientActionLink({
    target: definition.link.target,
    pathPrefix: definition.link.pathPrefix,
    rawToken: args.rawToken,
  })
}

export function getClientActionPathPrefix(
  actionType: ClientActionType,
): string {
  return getClientActionDefinition(actionType).link.pathPrefix
}

export function getClientActionLinkTarget(
  actionType: ClientActionType,
): ClientActionLinkTarget {
  return getClientActionDefinition(actionType).link.target
}