// lib/search/services.ts
import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { proDiscoveryVisibilityFilter } from '@/lib/tenant'
import type { TenantContext } from '@/lib/tenant'
import {
  SearchRequestError,
  type SearchServicesResponseDto,
  decodeIdCursor,
  normalizeOptionalId,
  paginateByCursor,
  parseLimit,
  pickNonEmptyString,
} from './contracts'

export type SearchServicesParams = {
  q: string | null
  categoryId: string | null
  cursorId: string | null
  limit: number
}

export function parseSearchServicesParams(
  searchParams: URLSearchParams,
): SearchServicesParams {
  const rawCursor = pickNonEmptyString(searchParams.get('cursor'))
  const cursorId = rawCursor ? decodeIdCursor(rawCursor) : null

  if (rawCursor && !cursorId) {
    throw new SearchRequestError(400, 'Invalid services search cursor.')
  }

  return {
    q: pickNonEmptyString(searchParams.get('q')),
    categoryId: normalizeOptionalId(searchParams.get('categoryId')),
    cursorId,
    limit: parseLimit(searchParams.get('limit'), {
      defaultValue: 40,
      max: 40,
    }),
  }
}

/**
 * White-label tenants must only see service types that one of THEIR pros
 * actually offers — otherwise the global service taxonomy (and, by inference,
 * other tenants' offerings) leaks through the typeahead. tovis-root is the
 * marketplace and sees the full active catalog. Mirrors the asymmetric tenant
 * rule every other discovery surface uses (proDiscoveryVisibilityFilter).
 */
function tenantServiceFilter(
  tenantContext: TenantContext,
): Prisma.ServiceWhereInput {
  if (tenantContext.isRoot) return {}

  return {
    offerings: {
      some: {
        isActive: true,
        professional: proDiscoveryVisibilityFilter(tenantContext),
      },
    },
  }
}

export async function searchServices(
  params: SearchServicesParams,
  tenantContext: TenantContext,
): Promise<SearchServicesResponseDto> {
  const rows = await prisma.service.findMany({
    where: {
      isActive: true,
      ...tenantServiceFilter(tenantContext),
      ...(params.categoryId ? { categoryId: params.categoryId } : {}),
      ...(params.q
        ? {
            OR: [
              {
                name: {
                  contains: params.q,
                  mode: 'insensitive',
                },
              },
              {
                category: {
                  name: {
                    contains: params.q,
                    mode: 'insensitive',
                  },
                },
              },
            ],
          }
        : {}),
    },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      name: true,
      category: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
    },
  })

  const items = rows.map((service) => ({
    id: service.id,
    name: service.name,
    categoryId: service.category?.id ?? null,
    categoryName: service.category?.name ?? null,
    categorySlug: service.category?.slug ?? null,
  }))

  return paginateByCursor(items, {
    cursorId: params.cursorId,
    limit: params.limit,
  })
}