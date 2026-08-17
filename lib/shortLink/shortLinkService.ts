// lib/shortLink/shortLinkService.ts

import { prisma } from '@/lib/prisma'
import { isUniqueConstraintError } from '@/lib/prismaErrors'
import { vanityRootDomain } from '@/lib/handles'

import { generateShortLinkCode } from './generateCode'
import { sanitizeShortLinkDestinationPath } from './allowlist'

const CREATE_ATTEMPTS = 10

export type GetOrCreateShortLinkArgs = {
  /** Site-root-relative internal path — validated against the allowlist. */
  destinationPath: string
  /** What minted this link, e.g. "notification_dispatch_href". */
  createdForType: string
  /** Dedupe key within createdForType — a retry reuses the same code. */
  createdForId: string
  /** Mirrors the destination's own token TTL where one exists. */
  expiresAt?: Date | null
}

export class ShortLinkDestinationNotAllowedError extends Error {
  constructor(destinationPath: string) {
    super(`ShortLink destination not allowlisted: ${destinationPath}`)
    this.name = 'ShortLinkDestinationNotAllowedError'
  }
}

async function findByCreatedFor(args: {
  createdForType: string
  createdForId: string
}): Promise<{ code: string } | null> {
  return prisma.shortLink.findUnique({
    where: {
      createdForType_createdForId: {
        createdForType: args.createdForType,
        createdForId: args.createdForId,
      },
    },
    select: { code: true },
  })
}

/**
 * Resolve the short code for (createdForType, createdForId), minting one on
 * first call and reusing it on every later call (a delivery retry, a resend
 * of the same dispatch) — so a retried SMS never advertises a different link
 * than the one already sent. Throws ShortLinkDestinationNotAllowedError if
 * destinationPath is not one of the allowlisted internal paths.
 */
export async function getOrCreateShortLink(
  args: GetOrCreateShortLinkArgs,
): Promise<{ code: string }> {
  const existing = await findByCreatedFor(args)
  if (existing) return existing

  const destinationPath = sanitizeShortLinkDestinationPath(args.destinationPath)
  if (!destinationPath) {
    throw new ShortLinkDestinationNotAllowedError(args.destinationPath)
  }

  for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt++) {
    const code = generateShortLinkCode()

    try {
      return await prisma.shortLink.create({
        data: {
          code,
          destinationPath,
          createdForType: args.createdForType,
          createdForId: args.createdForId,
          expiresAt: args.expiresAt ?? null,
        },
        select: { code: true },
      })
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error

      // Either `code` collided (redraw and retry) or a concurrent caller won
      // the SAME (createdForType, createdForId) race — in that case the row
      // now exists, so return it instead of minting a duplicate.
      const race = await findByCreatedFor(args)
      if (race) return race
    }
  }

  throw new Error(
    `getOrCreateShortLink: failed to generate a unique code after ${CREATE_ATTEMPTS} attempts`,
  )
}

/**
 * The absolute, tappable short URL for a code. Uses the app's vanity root
 * domain (lib/handles.ts — tovis.me in production, already a live Vercel
 * alias for this same deployment) rather than the app's own APP_URL/
 * NEXT_PUBLIC_APP_URL origin, because the whole point is a SHORT link.
 */
export function buildShortLinkUrl(code: string): string {
  return `https://${vanityRootDomain()}/s/${code}`
}
