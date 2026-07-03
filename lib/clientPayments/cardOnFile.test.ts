import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  // prisma.clientProfile
  clientFindUnique: vi.fn(),
  clientUpdate: vi.fn(),
  // prisma.clientPaymentMethod
  pmFindMany: vi.fn(),
  pmFindFirst: vi.fn(),
  pmUpdateMany: vi.fn(),
  pmUpsert: vi.fn(),
  pmUpdate: vi.fn(),
  pmDelete: vi.fn(),
  transaction: vi.fn(),
  // stripe
  customersCreate: vi.fn(),
  customersUpdate: vi.fn(),
  setupIntentsCreate: vi.fn(),
  setupIntentsRetrieve: vi.fn(),
  paymentMethodsRetrieve: vi.fn(),
  paymentMethodsDetach: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    clientProfile: {
      findUnique: mocks.clientFindUnique,
      update: mocks.clientUpdate,
    },
    clientPaymentMethod: {
      findMany: mocks.pmFindMany,
      findFirst: mocks.pmFindFirst,
      updateMany: mocks.pmUpdateMany,
      upsert: mocks.pmUpsert,
      update: mocks.pmUpdate,
      delete: mocks.pmDelete,
    },
    $transaction: mocks.transaction,
  },
}))

vi.mock('@/lib/stripe/server', () => ({
  getStripe: () => ({
    customers: { create: mocks.customersCreate, update: mocks.customersUpdate },
    setupIntents: {
      create: mocks.setupIntentsCreate,
      retrieve: mocks.setupIntentsRetrieve,
    },
    paymentMethods: {
      retrieve: mocks.paymentMethodsRetrieve,
      detach: mocks.paymentMethodsDetach,
    },
  }),
}))

import {
  createClientSetupIntent,
  ensureClientStripeCustomer,
  listClientPaymentMethods,
  persistConfirmedClientCard,
  removeClientPaymentMethod,
  toClientPaymentMethodDTO,
} from '@/lib/clientPayments/cardOnFile'

// A transaction stub that runs the callback with the same clientPaymentMethod mocks.
function wireTransactionPassthrough() {
  mocks.transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
    cb({
      clientPaymentMethod: {
        updateMany: mocks.pmUpdateMany,
        upsert: mocks.pmUpsert,
        findFirst: mocks.pmFindFirst,
        update: mocks.pmUpdate,
        delete: mocks.pmDelete,
      },
    }),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  wireTransactionPassthrough()
})

describe('ensureClientStripeCustomer', () => {
  it('reuses an existing customer id without creating a new one', async () => {
    mocks.clientFindUnique.mockResolvedValue({ id: 'c1', stripeCustomerId: 'cus_existing' })

    const id = await ensureClientStripeCustomer({ clientId: 'c1' })

    expect(id).toBe('cus_existing')
    expect(mocks.customersCreate).not.toHaveBeenCalled()
    expect(mocks.clientUpdate).not.toHaveBeenCalled()
  })

  it('creates and persists a customer when none exists', async () => {
    mocks.clientFindUnique.mockResolvedValue({ id: 'c1', stripeCustomerId: null })
    mocks.customersCreate.mockResolvedValue({ id: 'cus_new' })

    const id = await ensureClientStripeCustomer({ clientId: 'c1', email: ' a@b.co ' })

    expect(id).toBe('cus_new')
    expect(mocks.customersCreate).toHaveBeenCalledWith({
      email: 'a@b.co',
      metadata: { clientId: 'c1', kind: 'TOVIS_CLIENT' },
    })
    expect(mocks.clientUpdate).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { stripeCustomerId: 'cus_new' },
    })
  })

  it('throws when the client profile is missing', async () => {
    mocks.clientFindUnique.mockResolvedValue(null)
    await expect(ensureClientStripeCustomer({ clientId: 'missing' })).rejects.toThrow(
      /not found/,
    )
  })
})

describe('createClientSetupIntent', () => {
  it('creates an off-session SetupIntent for the client customer', async () => {
    mocks.clientFindUnique.mockResolvedValue({ id: 'c1', stripeCustomerId: 'cus_1' })
    mocks.setupIntentsCreate.mockResolvedValue({
      id: 'seti_1',
      client_secret: 'seti_1_secret',
    })

    const result = await createClientSetupIntent({ clientId: 'c1' })

    expect(mocks.setupIntentsCreate).toHaveBeenCalledWith({
      customer: 'cus_1',
      usage: 'off_session',
      payment_method_types: ['card'],
      metadata: { clientId: 'c1' },
    })
    expect(result).toEqual({
      clientSecret: 'seti_1_secret',
      setupIntentId: 'seti_1',
      customerId: 'cus_1',
    })
  })

  it('throws when Stripe returns no client secret', async () => {
    mocks.clientFindUnique.mockResolvedValue({ id: 'c1', stripeCustomerId: 'cus_1' })
    mocks.setupIntentsCreate.mockResolvedValue({ id: 'seti_1', client_secret: null })

    await expect(createClientSetupIntent({ clientId: 'c1' })).rejects.toThrow(
      /client secret/,
    )
  })
})

describe('persistConfirmedClientCard', () => {
  const card = {
    id: 'pm_1',
    card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 },
  }

  beforeEach(() => {
    mocks.clientFindUnique.mockResolvedValue({ id: 'c1', stripeCustomerId: 'cus_1' })
    mocks.paymentMethodsRetrieve.mockResolvedValue(card)
    mocks.pmUpsert.mockResolvedValue({
      id: 'row_1',
      brand: 'visa',
      last4: '4242',
      expMonth: 12,
      expYear: 2030,
      isDefault: true,
      createdAt: new Date('2026-07-03T00:00:00.000Z'),
    })
  })

  it('persists a confirmed card as the new default and clears the old default', async () => {
    mocks.setupIntentsRetrieve.mockResolvedValue({
      id: 'seti_1',
      status: 'succeeded',
      customer: 'cus_1',
      payment_method: 'pm_1',
    })

    const dto = await persistConfirmedClientCard({ clientId: 'c1', setupIntentId: 'seti_1' })

    expect(mocks.customersUpdate).toHaveBeenCalledWith('cus_1', {
      invoice_settings: { default_payment_method: 'pm_1' },
    })
    expect(mocks.pmUpdateMany).toHaveBeenCalledWith({
      where: { clientId: 'c1', isDefault: true },
      data: { isDefault: false },
    })
    expect(mocks.pmUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { stripePaymentMethodId: 'pm_1' } }),
    )
    expect(dto).toEqual({
      id: 'row_1',
      brand: 'visa',
      last4: '4242',
      expMonth: 12,
      expYear: 2030,
      isDefault: true,
      createdAt: '2026-07-03T00:00:00.000Z',
    })
  })

  it('rejects a SetupIntent that belongs to another customer', async () => {
    mocks.setupIntentsRetrieve.mockResolvedValue({
      id: 'seti_1',
      status: 'succeeded',
      customer: 'cus_OTHER',
      payment_method: 'pm_1',
    })

    await expect(
      persistConfirmedClientCard({ clientId: 'c1', setupIntentId: 'seti_1' }),
    ).rejects.toThrow(/does not belong/)
    expect(mocks.pmUpsert).not.toHaveBeenCalled()
  })

  it('rejects a SetupIntent that has not succeeded', async () => {
    mocks.setupIntentsRetrieve.mockResolvedValue({
      id: 'seti_1',
      status: 'requires_confirmation',
      customer: 'cus_1',
      payment_method: 'pm_1',
    })

    await expect(
      persistConfirmedClientCard({ clientId: 'c1', setupIntentId: 'seti_1' }),
    ).rejects.toThrow(/not confirmed/)
  })

  it('throws when the client has no Stripe customer yet', async () => {
    mocks.clientFindUnique.mockResolvedValue({ id: 'c1', stripeCustomerId: null })
    await expect(
      persistConfirmedClientCard({ clientId: 'c1', setupIntentId: 'seti_1' }),
    ).rejects.toThrow(/no Stripe customer/)
  })
})

describe('listClientPaymentMethods', () => {
  it('maps rows to DTOs, default first', async () => {
    mocks.pmFindMany.mockResolvedValue([
      {
        id: 'row_1',
        brand: 'visa',
        last4: '4242',
        expMonth: 12,
        expYear: 2030,
        isDefault: true,
        createdAt: new Date('2026-07-03T00:00:00.000Z'),
      },
    ])

    const list = await listClientPaymentMethods('c1')

    expect(mocks.pmFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clientId: 'c1' },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      }),
    )
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: 'row_1', isDefault: true, last4: '4242' })
  })
})

describe('removeClientPaymentMethod', () => {
  it('returns null when the card is not owned by the client', async () => {
    mocks.pmFindFirst.mockResolvedValue(null)

    const result = await removeClientPaymentMethod({
      clientId: 'c1',
      paymentMethodId: 'row_x',
    })

    expect(result).toBeNull()
    expect(mocks.paymentMethodsDetach).not.toHaveBeenCalled()
    expect(mocks.pmDelete).not.toHaveBeenCalled()
  })

  it('detaches, deletes, and promotes a new default when removing the default card', async () => {
    mocks.pmFindFirst
      // ownership lookup
      .mockResolvedValueOnce({
        id: 'row_1',
        stripePaymentMethodId: 'pm_1',
        isDefault: true,
      })
      // promote-next lookup inside the transaction
      .mockResolvedValueOnce({ id: 'row_2' })

    const result = await removeClientPaymentMethod({
      clientId: 'c1',
      paymentMethodId: 'row_1',
    })

    expect(mocks.paymentMethodsDetach).toHaveBeenCalledWith('pm_1')
    expect(mocks.pmDelete).toHaveBeenCalledWith({ where: { id: 'row_1' } })
    expect(mocks.pmUpdate).toHaveBeenCalledWith({
      where: { id: 'row_2' },
      data: { isDefault: true },
    })
    expect(result).toEqual({ removedId: 'row_1' })
  })

  it('survives a Stripe detach failure and still removes the local row', async () => {
    mocks.pmFindFirst.mockResolvedValueOnce({
      id: 'row_1',
      stripePaymentMethodId: 'pm_1',
      isDefault: false,
    })
    mocks.paymentMethodsDetach.mockRejectedValue(new Error('already detached'))

    const result = await removeClientPaymentMethod({
      clientId: 'c1',
      paymentMethodId: 'row_1',
    })

    expect(mocks.pmDelete).toHaveBeenCalledWith({ where: { id: 'row_1' } })
    expect(result).toEqual({ removedId: 'row_1' })
  })
})

describe('toClientPaymentMethodDTO', () => {
  it('serializes createdAt as ISO', () => {
    const dto = toClientPaymentMethodDTO({
      id: 'row_1',
      brand: null,
      last4: null,
      expMonth: null,
      expYear: null,
      isDefault: false,
      createdAt: new Date('2026-07-03T12:34:56.000Z'),
    })
    expect(dto.createdAt).toBe('2026-07-03T12:34:56.000Z')
  })
})
