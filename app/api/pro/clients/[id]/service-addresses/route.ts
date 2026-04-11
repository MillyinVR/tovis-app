import { ClientAddressKind } from '@prisma/client'

import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { getProClientVisibility } from '@/lib/clientVisibility'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = {
  params: { id: string } | Promise<{ id: string }>
}

function asTrimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export async function GET(_request: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const params = await Promise.resolve(ctx.params)
    const clientId = asTrimmedString(params?.id)

    if (!clientId) {
      return jsonFail(400, 'Client id is required.', {
        code: 'VALIDATION_ERROR',
      })
    }

    const visibility = await getProClientVisibility(
      auth.professionalId,
      clientId,
    )

    if (!visibility.canViewClient) {
      return jsonFail(403, 'You do not have access to this client.', {
        code: 'FORBIDDEN',
      })
    }

    const addresses = await prisma.clientAddress.findMany({
      where: {
        clientId,
        kind: ClientAddressKind.SERVICE_ADDRESS,
      },
      select: {
        id: true,
        label: true,
        formattedAddress: true,
        isDefault: true,
      },
      orderBy: [
        { isDefault: 'desc' },
        { updatedAt: 'desc' },
        { createdAt: 'asc' },
      ],
    })

    return jsonOk(
      {
        clientId,
        addresses: addresses.map((address) => ({
          id: address.id,
          label:
            typeof address.label === 'string' && address.label.trim()
              ? address.label.trim()
              : 'Service address',
          formattedAddress: address.formattedAddress ?? '',
          isDefault: address.isDefault,
        })),
      },
      200,
    )
  } catch (error) {
    console.error(
      'GET /api/pro/clients/[id]/service-addresses error',
      error,
    )
    return jsonFail(500, 'Internal server error')
  }
}