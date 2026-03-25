// app/api/client/bookings/[id]/checkout/route.test.ts
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingCheckoutStatus,
  PaymentMethod,
  Prisma,
} from '@prisma/client'

const mocks = vi.hoisted(() => ({
  requireClient: vi.fn(),
  jsonOk: vi.fn(),
  jsonFail: vi.fn(),

  getBookingFailPayload: vi.fn(),
  isBookingError: vi.fn(),

  updateClientBookingCheckout: vi.fn(),

  prismaBookingFindUnique: vi.fn(),
  prismaProfessionalPaymentSettingsFindUnique: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  requireClient: mocks.requireClient,
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
}))

vi.mock('@/lib/booking/errors', () => ({
  getBookingFailPayload: mocks.getBookingFailPayload,
  isBookingError: mocks.isBookingError,
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  updateClientBookingCheckout: mocks.updateClientBookingCheckout,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: {
      findUnique: mocks.prismaBookingFindUnique,
    },
    professionalPaymentSettings: {
      findUnique: mocks.prismaProfessionalPaymentSettingsFindUnique,
    },
  },
}))

import { POST } from './route'

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  })
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest(
    'http://localhost/api/client/bookings/booking_1/checkout',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  )
}

describe('POST /api/client/bookings/[id]/checkout', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.jsonOk.mockImplementation((body: unknown, status = 200) =>
      makeJsonResponse(body, status),
    )

    mocks.jsonFail.mockImplementation(
      (status: number, message: string, extra?: Record<string, unknown>) =>
        makeJsonResponse(
          {
            error: message,
            ...(extra ?? {}),
          },
          status,
        ),
    )

    mocks.requireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
    })

    mocks.isBookingError.mockImplementation(
      (error: unknown) =>
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        typeof (error as { code?: unknown }).code === 'string',
    )

    mocks.getBookingFailPayload.mockImplementation(
      (
        code: string,
        overrides?: {
          message?: string
          userMessage?: string
        },
      ) => ({
        httpStatus: 403,
        userMessage: overrides?.userMessage ?? `booking error: ${code}`,
        extra: {
          code,
        },
      }),
    )

    mocks.prismaBookingFindUnique.mockResolvedValue({
      id: 'booking_1',
      professionalId: 'pro_1',
      selectedPaymentMethod: null,
    })

    mocks.prismaProfessionalPaymentSettingsFindUnique.mockResolvedValue({
      acceptCash: true,
      acceptCardOnFile: true,
      acceptTapToPay: true,
      acceptVenmo: true,
      acceptZelle: true,
      acceptAppleCash: true,
      tipsEnabled: true,
    })
  })

  it('returns 400 when booking id is missing', async () => {
    const response = await POST(makeRequest({}), {
      params: Promise.resolve({ id: '   ' }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Missing booking id.',
    })

    expect(mocks.updateClientBookingCheckout).not.toHaveBeenCalled()
  })

  it('returns 400 for an unsupported payment method', async () => {
    const response = await POST(
      makeRequest({
        selectedPaymentMethod: 'paypal',
        confirmPayment: false,
      }),
      {
        params: Promise.resolve({ id: 'booking_1' }),
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error:
        'selectedPaymentMethod must be one of: cash, card on file, tap to pay, Venmo, Zelle, Apple Cash.',
    })

    expect(mocks.updateClientBookingCheckout).not.toHaveBeenCalled()
  })

  it('returns 400 when confirming payment without any payment method', async () => {
    mocks.prismaBookingFindUnique.mockResolvedValueOnce({
      id: 'booking_1',
      professionalId: 'pro_1',
      selectedPaymentMethod: null,
    })

    const response = await POST(
      makeRequest({
        tipAmount: '10.00',
        confirmPayment: true,
      }),
      {
        params: Promise.resolve({ id: 'booking_1' }),
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Choose a payment method before confirming payment.',
    })

    expect(mocks.updateClientBookingCheckout).not.toHaveBeenCalled()
  })

  it('forwards a valid payload to updateClientBookingCheckout and returns the booking payload', async () => {
    mocks.updateClientBookingCheckout.mockResolvedValueOnce({
      booking: {
        id: 'booking_1',
        checkoutStatus: BookingCheckoutStatus.PAID,
        selectedPaymentMethod: PaymentMethod.CASH,
        serviceSubtotalSnapshot: new Prisma.Decimal(100),
        productSubtotalSnapshot: new Prisma.Decimal(20),
        subtotalSnapshot: new Prisma.Decimal(100),
        tipAmount: new Prisma.Decimal(15),
        taxAmount: new Prisma.Decimal(0),
        discountAmount: new Prisma.Decimal(0),
        totalAmount: new Prisma.Decimal(135),
        paymentAuthorizedAt: new Date('2026-03-25T16:00:00.000Z'),
        paymentCollectedAt: new Date('2026-03-25T16:00:00.000Z'),
      },
      meta: {
        mutated: true,
        noOp: false,
      },
    })

    const response = await POST(
      makeRequest({
        tipAmount: '15.00',
        selectedPaymentMethod: 'cash',
        confirmPayment: true,
      }),
      {
        params: Promise.resolve({ id: 'booking_1' }),
      },
    )

    expect(mocks.updateClientBookingCheckout).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      clientId: 'client_1',
      tipAmount: '15.00',
      selectedPaymentMethod: PaymentMethod.CASH,
      checkoutStatus: BookingCheckoutStatus.PAID,
      markPaymentAuthorized: true,
      markPaymentCollected: true,
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      booking: {
        id: 'booking_1',
        checkoutStatus: BookingCheckoutStatus.PAID,
        selectedPaymentMethod: PaymentMethod.CASH,
        serviceSubtotalSnapshot: '100',
        productSubtotalSnapshot: '20',
        subtotalSnapshot: '100',
        tipAmount: '15',
        taxAmount: '0',
        discountAmount: '0',
        totalAmount: '135',
        paymentAuthorizedAt: '2026-03-25T16:00:00.000Z',
        paymentCollectedAt: '2026-03-25T16:00:00.000Z',
      },
      meta: {
        mutated: true,
        noOp: false,
      },
    })
  })

  it('rejects a positive tip when tips are disabled for the provider', async () => {
    mocks.prismaProfessionalPaymentSettingsFindUnique.mockResolvedValueOnce({
      acceptCash: true,
      acceptCardOnFile: true,
      acceptTapToPay: true,
      acceptVenmo: true,
      acceptZelle: true,
      acceptAppleCash: true,
      tipsEnabled: false,
    })

    const response = await POST(
      makeRequest({
        tipAmount: '12.00',
        selectedPaymentMethod: 'cash',
        confirmPayment: false,
      }),
      {
        params: Promise.resolve({ id: 'booking_1' }),
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Tips are not enabled for this provider.',
    })

    expect(mocks.updateClientBookingCheckout).not.toHaveBeenCalled()
  })

  it('maps booking errors through bookingJsonFail', async () => {
    mocks.updateClientBookingCheckout.mockRejectedValueOnce({
      code: 'FORBIDDEN',
      message: 'Nope',
      userMessage: 'Blocked',
    })

    const response = await POST(
      makeRequest({
        tipAmount: '5.00',
        selectedPaymentMethod: 'cash',
        confirmPayment: false,
      }),
      {
        params: Promise.resolve({ id: 'booking_1' }),
      },
    )

    expect(mocks.getBookingFailPayload).toHaveBeenCalledWith('FORBIDDEN', {
      message: 'Nope',
      userMessage: 'Blocked',
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Blocked',
      code: 'FORBIDDEN',
    })
  })

  it('returns auth response when requireClient fails', async () => {
    mocks.requireClient.mockResolvedValueOnce({
      ok: false,
      res: makeJsonResponse({ error: 'Unauthorized' }, 401),
    })

    const response = await POST(makeRequest({}), {
      params: Promise.resolve({ id: 'booking_1' }),
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      error: 'Unauthorized',
    })

    expect(mocks.updateClientBookingCheckout).not.toHaveBeenCalled()
  })
})