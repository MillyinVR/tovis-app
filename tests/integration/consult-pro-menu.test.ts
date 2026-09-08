import { randomUUID } from 'node:crypto'
import { ConsultServiceFamily, Prisma, PrismaClient, ProfessionalLocationType, Role } from '@prisma/client'
import { afterAll, describe, expect, it } from 'vitest'
import { loadConsultProMenu } from '@/lib/consult/proMenu'

const db = new PrismaClient()
afterAll(() => db.$disconnect())

async function withMenu(check: (tx: Prisma.TransactionClient, fixture: Awaited<ReturnType<typeof seedMenu>>) => Promise<void>) {
  const rollback = new Error('menu fixture complete')
  try {
    await db.$transaction(async tx => {
      await check(tx, await seedMenu(tx))
      throw rollback
    }, { timeout: 15_000 })
  } catch (error) {
    if (error !== rollback) throw error
  }
}

async function seedMenu(tx: Prisma.TransactionClient) {
  const tag = `p8-menu-${randomUUID()}`
  const tenant = await tx.tenant.create({ data: { name: tag, slug: tag } })
  const user = await tx.user.create({ data: { email: `${tag}@example.test`, role: Role.PRO } })
  const pro = await tx.professionalProfile.create({ data: { userId: user.id, homeTenantId: tenant.id } })
  await tx.professionalLocation.create({ data: {
    professionalId: pro.id, type: ProfessionalLocationType.SALON,
    name: 'Test salon', timeZone: 'America/Los_Angeles', workingHours: {}, isBookable: true,
  } })
  const otherUser = await tx.user.create({ data: { email: `${tag}-other@example.test`, role: Role.PRO } })
  const otherPro = await tx.professionalProfile.create({ data: { userId: otherUser.id, homeTenantId: tenant.id } })
  const category = (name: string, family: ConsultServiceFamily, isActive = true) =>
    tx.serviceCategory.create({ data: { name, slug: `${tag}-${name}`, consultFamily: family, isActive } })
  const extensions = await category('extensions', ConsultServiceFamily.HAIR)
  const color = await category('color', ConsultServiceFamily.HAIR)
  const cut = await category('cut', ConsultServiceFamily.HAIR)
  const nails = await category('nails', ConsultServiceFamily.NAILS)
  const retired = await category('retired', ConsultServiceFamily.HAIR, false)
  const offer = async (name: string, categoryId: string, options: { active?: boolean; serviceActive?: boolean; professionalId?: string } = {}) => {
    const service = await tx.service.create({ data: {
      name, categoryId, isActive: options.serviceActive ?? true,
      minPrice: new Prisma.Decimal(50), defaultDurationMinutes: 45,
    } })
    await tx.professionalServiceOffering.create({ data: {
      professionalId: options.professionalId ?? pro.id, serviceId: service.id,
      isActive: options.active ?? true, offersInSalon: true, offersMobile: true,
      salonPriceStartingAt: new Prisma.Decimal(50), salonDurationMinutes: 45,
      mobilePriceStartingAt: new Prisma.Decimal(60), mobileDurationMinutes: 45,
    } })
  }
  await offer('Extensions', extensions.id)
  await offer('Color', color.id)
  await offer('Layers', cut.id)
  await offer('Nails', nails.id)
  await offer('Inactive offering', color.id, { active: false })
  await offer('Inactive service', color.id, { serviceActive: false })
  await offer('Retired category', retired.id)
  await offer('Other pro color', color.id, { professionalId: otherPro.id })
  return { professionalId: pro.id, extensions, nails, retired }
}

describe('the menu follows the client’s hair goal', () => {
  it('makes color and cuts visible from an extensions reference while preserving historical scope and actual location modes', async () => {
    await withMenu(async (tx, fixture) => {
      const scope = { professionalId: fixture.professionalId, serviceCategoryId: fixture.extensions.id }
      const historical = await loadConsultProMenu(tx, scope)
      expect(historical.offerings.map(item => item.service.name)).toEqual(['Extensions'])
      const current = await loadConsultProMenu(tx, { ...scope, menuScope: 'HAIR_FAMILY' })
      expect(current.offerings.map(item => item.service.name).sort()).toEqual(['Color', 'Extensions', 'Layers'])
      expect(current.offerings.every(item => item.offersInSalon && !item.offersMobile)).toBe(true)
    })
  })

  it('does not widen non-hair consultations or revive an inactive starting category', async () => {
    await withMenu(async (tx, fixture) => {
      const nails = await loadConsultProMenu(tx, {
        professionalId: fixture.professionalId, serviceCategoryId: fixture.nails.id, menuScope: 'HAIR_FAMILY',
      })
      expect(nails.offerings.map(item => item.service.name)).toEqual(['Nails'])
      const retired = await loadConsultProMenu(tx, {
        professionalId: fixture.professionalId, serviceCategoryId: fixture.retired.id, menuScope: 'HAIR_FAMILY',
      })
      expect(retired.offerings).toEqual([])
    })
  })
})
