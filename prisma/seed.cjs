// prisma/seed.cjs
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env') })

const {
  PrismaClient,
  Prisma,
  Role,
  AdminPermissionRole,
  MediaType,
  MediaVisibility,
  ProfessionType,
  ProfessionalLocationType,
  VerificationStatus,
} = require('@prisma/client')
const bcrypt = require('bcrypt')

const prisma = new PrismaClient()

const DEFAULT_TIME_ZONE = 'America/Los_Angeles'

function money(v) {
  if (typeof v === 'number') return new Prisma.Decimal(v.toFixed(2))
  const s = String(v).trim()
  if (!/^\d+(\.\d{1,2})?$/.test(s)) {
    throw new Error(`Invalid money value: ${v}`)
  }
  const [a, b = ''] = s.split('.')
  const normalized =
    b.length === 0 ? `${a}.00` : b.length === 1 ? `${a}.${b}0` : `${a}.${b}`
  return new Prisma.Decimal(normalized)
}

function coord(v) {
  if (typeof v === 'number') return new Prisma.Decimal(v.toFixed(7))
  const s = String(v).trim()
  if (!/^-?\d+(\.\d{1,7})?$/.test(s)) {
    throw new Error(`Invalid coordinate value: ${v}`)
  }
  return new Prisma.Decimal(s)
}

function workingHoursJson() {
  return {
    mon: { enabled: true, start: '09:00', end: '17:00' },
    tue: { enabled: true, start: '09:00', end: '17:00' },
    wed: { enabled: true, start: '09:00', end: '17:00' },
    thu: { enabled: true, start: '09:00', end: '17:00' },
    fri: { enabled: true, start: '09:00', end: '17:00' },
    sat: { enabled: true, start: '09:00', end: '15:00' },
    sun: { enabled: false, start: '09:00', end: '17:00' },
  }
}

function makeStoragePath(filename) {
  return `seed/${filename}`
}

async function upsertServiceCategory({ slug, name, description, parentId = null }) {
  return prisma.serviceCategory.upsert({
    where: { slug },
    update: {
      name,
      description,
      parentId,
      isActive: true,
    },
    create: {
      slug,
      name,
      description,
      parentId,
      isActive: true,
    },
  })
}

async function upsertService({
  name,
  categoryId,
  description,
  defaultDurationMinutes,
  minPrice,
  allowMobile,
  isAddOnEligible = false,
  addOnGroup = null,
}) {
  return prisma.service.upsert({
    where: { name },
    update: {
      categoryId,
      description,
      defaultDurationMinutes,
      minPrice: money(minPrice),
      allowMobile,
      isActive: true,
      isAddOnEligible,
      addOnGroup,
    },
    create: {
      name,
      categoryId,
      description,
      defaultDurationMinutes,
      minPrice: money(minPrice),
      allowMobile,
      isActive: true,
      isAddOnEligible,
      addOnGroup,
    },
  })
}

async function ensurePermission(serviceId, professionType, stateCode = null) {
  const existing = await prisma.servicePermission.findFirst({
    where: { serviceId, professionType, stateCode },
    select: { id: true },
  })
  if (existing) return existing

  return prisma.servicePermission.create({
    data: { serviceId, professionType, stateCode },
  })
}

async function upsertAdmin({ email, password }) {
  const adminHash = await bcrypt.hash(password, 10)

  const adminUser = await prisma.user.upsert({
    where: { email },
    update: {
      role: Role.ADMIN,
      password: adminHash,
    },
    create: {
      email,
      password: adminHash,
      role: Role.ADMIN,
    },
    select: { id: true, email: true, role: true },
  })

  const existingPerm = await prisma.adminPermission.findFirst({
    where: {
      adminUserId: adminUser.id,
      role: AdminPermissionRole.SUPER_ADMIN,
      professionalId: null,
      serviceId: null,
      categoryId: null,
    },
    select: { id: true },
  })

  if (!existingPerm) {
    await prisma.adminPermission.create({
      data: {
        adminUserId: adminUser.id,
        role: AdminPermissionRole.SUPER_ADMIN,
        professionalId: null,
        serviceId: null,
        categoryId: null,
      },
    })
  }

  console.log('ADMIN login:', { email, password })
  console.log('ADMIN user id:', adminUser.id)

  return adminUser
}

async function upsertClientUser({ email, password }) {
  const passwordHash = await bcrypt.hash(password, 10)

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      password: passwordHash,
      role: Role.CLIENT,
    },
    create: {
      email,
      password: passwordHash,
      role: Role.CLIENT,
    },
    select: { id: true, email: true, role: true },
  })

  const clientProfile = await prisma.clientProfile.upsert({
    where: { userId: user.id },
    update: {
      firstName: 'Test',
      lastName: 'Client',
      phone: null,
      avatarUrl: null,
    },
    create: {
      userId: user.id,
      firstName: 'Test',
      lastName: 'Client',
      phone: null,
      avatarUrl: null,
    },
  })

  return { user, clientProfile }
}

async function upsertProfessionalUser({ email, password }) {
  const passwordHash = await bcrypt.hash(password, 10)

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      password: passwordHash,
      role: Role.PRO,
    },
    create: {
      email,
      password: passwordHash,
      role: Role.PRO,
    },
    select: { id: true, email: true, role: true },
  })

  const professionalProfile = await prisma.professionalProfile.upsert({
    where: { userId: user.id },
    update: {
      firstName: 'Test',
      lastName: 'Professional',
      businessName: 'TOVIS Test Pro',
      handle: 'tovis-test-pro',
      handleNormalized: 'tovis-test-pro',
      location: 'Los Angeles, CA',
      timeZone: DEFAULT_TIME_ZONE,
      professionType: ProfessionType.COSMETOLOGIST,
      licenseState: 'CA',
      licenseVerified: true,
      verificationStatus: VerificationStatus.APPROVED,
      licenseVerifiedSource: 'SEED',
      licenseStatusCode: 'CURRENT',
    },
    create: {
      userId: user.id,
      firstName: 'Test',
      lastName: 'Professional',
      businessName: 'TOVIS Test Pro',
      handle: 'tovis-test-pro',
      handleNormalized: 'tovis-test-pro',
      location: 'Los Angeles, CA',
      timeZone: DEFAULT_TIME_ZONE,
      professionType: ProfessionType.COSMETOLOGIST,
      licenseState: 'CA',
      licenseVerified: true,
      verificationStatus: VerificationStatus.APPROVED,
      licenseVerifiedSource: 'SEED',
      licenseStatusCode: 'CURRENT',
    },
  })

  return { user, professionalProfile }
}

async function ensureProfessionalLocation(professionalId) {
  const existing = await prisma.professionalLocation.findFirst({
    where: {
      professionalId,
      type: ProfessionalLocationType.SALON,
      name: 'TOVIS Test Salon',
    },
    select: { id: true },
  })

  if (existing) {
    return prisma.professionalLocation.update({
      where: { id: existing.id },
      data: {
        isPrimary: true,
        isBookable: true,
        formattedAddress: '123 Test Salon Ave, Los Angeles, CA 90001',
        addressLine1: '123 Test Salon Ave',
        city: 'Los Angeles',
        state: 'CA',
        postalCode: '90001',
        countryCode: 'US',
        lat: coord('34.0522350'),
        lng: coord('-118.2436830'),
        timeZone: DEFAULT_TIME_ZONE,
        workingHours: workingHoursJson(),
        bufferMinutes: 15,
        stepMinutes: 15,
        advanceNoticeMinutes: 60,
        maxDaysAhead: 60,
      },
    })
  }

  return prisma.professionalLocation.create({
    data: {
      professionalId,
      type: ProfessionalLocationType.SALON,
      name: 'TOVIS Test Salon',
      isPrimary: true,
      isBookable: true,
      formattedAddress: '123 Test Salon Ave, Los Angeles, CA 90001',
      addressLine1: '123 Test Salon Ave',
      city: 'Los Angeles',
      state: 'CA',
      postalCode: '90001',
      countryCode: 'US',
      lat: coord('34.0522350'),
      lng: coord('-118.2436830'),
      timeZone: DEFAULT_TIME_ZONE,
      workingHours: workingHoursJson(),
      bufferMinutes: 15,
      stepMinutes: 15,
      advanceNoticeMinutes: 60,
      maxDaysAhead: 60,
    },
  })
}

async function ensureOffering({
  professionalId,
  serviceId,
  title = null,
  description = null,
  salonPriceStartingAt,
  salonDurationMinutes,
  mobilePriceStartingAt = null,
  mobileDurationMinutes = null,
  offersInSalon = true,
  offersMobile = false,
}) {
  const existing = await prisma.professionalServiceOffering.findFirst({
    where: { professionalId, serviceId },
    select: { id: true },
  })

  if (existing) {
    return prisma.professionalServiceOffering.update({
      where: { id: existing.id },
      data: {
        title,
        description,
        salonPriceStartingAt:
          salonPriceStartingAt == null ? null : money(salonPriceStartingAt),
        salonDurationMinutes,
        mobilePriceStartingAt:
          mobilePriceStartingAt == null ? null : money(mobilePriceStartingAt),
        mobileDurationMinutes,
        offersInSalon,
        offersMobile,
        isActive: true,
      },
    })
  }

  return prisma.professionalServiceOffering.create({
    data: {
      professionalId,
      serviceId,
      title,
      description,
      salonPriceStartingAt:
        salonPriceStartingAt == null ? null : money(salonPriceStartingAt),
      salonDurationMinutes,
      mobilePriceStartingAt:
        mobilePriceStartingAt == null ? null : money(mobilePriceStartingAt),
      mobileDurationMinutes,
      offersInSalon,
      offersMobile,
      isActive: true,
    },
  })
}

async function upsertMediaAsset({
  professionalId,
  url,
  mediaType,
  caption,
  storagePath,
}) {
  const existing = await prisma.mediaAsset.findFirst({
    where: { professionalId, url },
    select: { id: true },
  })

  const baseData = {
    professionalId,
    url,
    thumbUrl: null,
    mediaType,
    caption,
    visibility: MediaVisibility.PUBLIC,
    isEligibleForLooks: true,
    storageBucket: 'media-public',
    storagePath,
    thumbBucket: null,
    thumbPath: null,
  }

  if (existing) {
    return prisma.mediaAsset.update({
      where: { id: existing.id },
      data: baseData,
    })
  }

  return prisma.mediaAsset.create({
    data: baseData,
  })
}

async function tagLook(mediaId, serviceId) {
  const existing = await prisma.mediaServiceTag.findFirst({
    where: { mediaId, serviceId },
    select: { id: true },
  })
  if (existing) return existing

  return prisma.mediaServiceTag.create({
    data: { mediaId, serviceId },
  })
}

async function main() {
  console.log('SEED DATABASE_URL:', process.env.DATABASE_URL)

  const seedPassword = process.env.SEED_TEST_PASSWORD || 'password123'

  const proEmail = 'pro@test.com'
  const proPassword = seedPassword

  const clientEmail = 'client@test.com'
  const clientPassword = seedPassword

  const adminEmail = process.env.ADMIN_EMAIL || 'admin@test.com'
  const adminPassword = seedPassword

  const { professionalProfile } = await upsertProfessionalUser({
    email: proEmail,
    password: proPassword,
  })

  await upsertClientUser({
    email: clientEmail,
    password: clientPassword,
  })

  await upsertAdmin({
    email: adminEmail,
    password: adminPassword,
  })

  await ensureProfessionalLocation(professionalProfile.id)

  const hair = await upsertServiceCategory({
    slug: 'hair',
    name: 'Hair',
    description:
      'Services related to haircut, color, extensions, and hair treatments.',
  })

  const nails = await upsertServiceCategory({
    slug: 'nails',
    name: 'Nails',
    description: 'Manicures, pedicures, enhancements, and nail art.',
  })

  const makeup = await upsertServiceCategory({
    slug: 'makeup',
    name: 'Makeup',
    description:
      'Makeup application for events, photoshoots, and everyday looks.',
  })

  const massage = await upsertServiceCategory({
    slug: 'massage',
    name: 'Massage',
    description: 'Bodywork, relaxation, and therapeutic massage services.',
  })

  const hairColor = await upsertServiceCategory({
    slug: 'hair-color',
    name: 'Color',
    description: 'All services involving changing or refreshing hair color.',
    parentId: hair.id,
  })

  const haircut = await upsertServiceCategory({
    slug: 'haircut',
    name: 'Haircut',
    description: 'Cutting and shaping the hair.',
    parentId: hair.id,
  })

  const hairExtensions = await upsertServiceCategory({
    slug: 'hair-extensions',
    name: 'Extensions',
    description: 'Installation and maintenance of hair extensions.',
    parentId: hair.id,
  })

  const nailsEnhancements = await upsertServiceCategory({
    slug: 'nails-enhancements',
    name: 'Enhancements',
    description: 'Full sets, fills, and structured manicures.',
    parentId: nails.id,
  })

  const balayage = await upsertService({
    name: 'Balayage',
    categoryId: hairColor.id,
    description:
      'Hand-painted, lived-in highlights designed to grow out softly and seamlessly.',
    defaultDurationMinutes: 180,
    minPrice: '180.00',
    allowMobile: false,
  })

  const rootTouchUp = await upsertService({
    name: 'Root Touch-Up',
    categoryId: hairColor.id,
    description:
      'Covers or refreshes regrowth at the roots to match your existing color.',
    defaultDurationMinutes: 90,
    minPrice: '80.00',
    allowMobile: false,
  })

  const haircutStyle = await upsertService({
    name: 'Haircut & Style',
    categoryId: haircut.id,
    description: 'Customized haircut with a blowout or finishing style.',
    defaultDurationMinutes: 60,
    minPrice: '65.00',
    allowMobile: true,
  })

  const extensionInstall = await upsertService({
    name: 'Extension Installation',
    categoryId: hairExtensions.id,
    description:
      'Installation of professional hair extensions. Hair cost may be separate.',
    defaultDurationMinutes: 180,
    minPrice: '250.00',
    allowMobile: false,
  })

  const gelX = await upsertService({
    name: 'Gel X Full Set',
    categoryId: nailsEnhancements.id,
    description: 'Soft gel extension system for lightweight, durable nail length.',
    defaultDurationMinutes: 120,
    minPrice: '100.00',
    allowMobile: false,
  })

  const softGlam = await upsertService({
    name: 'Soft Glam Makeup',
    categoryId: makeup.id,
    description:
      'Camera-ready, soft glam makeup application for events and special occasions.',
    defaultDurationMinutes: 75,
    minPrice: '120.00',
    allowMobile: true,
  })

  const swedish60 = await upsertService({
    name: '60-Minute Swedish Massage',
    categoryId: massage.id,
    description: 'Full-body relaxation massage with light to medium pressure.',
    defaultDurationMinutes: 60,
    minPrice: '100.00',
    allowMobile: true,
  })

  await ensurePermission(balayage.id, ProfessionType.COSMETOLOGIST, 'CA')
  await ensurePermission(rootTouchUp.id, ProfessionType.COSMETOLOGIST, 'CA')
  await ensurePermission(haircutStyle.id, ProfessionType.COSMETOLOGIST, 'CA')
  await ensurePermission(extensionInstall.id, ProfessionType.COSMETOLOGIST, 'CA')
  await ensurePermission(gelX.id, ProfessionType.COSMETOLOGIST, 'CA')
  await ensurePermission(softGlam.id, ProfessionType.COSMETOLOGIST, 'CA')
  await ensurePermission(swedish60.id, ProfessionType.MASSAGE_THERAPIST, 'CA')

  await ensureOffering({
    professionalId: professionalProfile.id,
    serviceId: balayage.id,
    title: 'Balayage',
    description: 'Seeded test offering.',
    salonPriceStartingAt: '180.00',
    salonDurationMinutes: 180,
    offersInSalon: true,
    offersMobile: false,
  })

  await ensureOffering({
    professionalId: professionalProfile.id,
    serviceId: rootTouchUp.id,
    title: 'Root Touch-Up',
    description: 'Seeded test offering.',
    salonPriceStartingAt: '80.00',
    salonDurationMinutes: 90,
    offersInSalon: true,
    offersMobile: false,
  })

  await ensureOffering({
    professionalId: professionalProfile.id,
    serviceId: haircutStyle.id,
    title: 'Haircut & Style',
    description: 'Seeded test offering.',
    salonPriceStartingAt: '65.00',
    salonDurationMinutes: 60,
    mobilePriceStartingAt: '85.00',
    mobileDurationMinutes: 75,
    offersInSalon: true,
    offersMobile: true,
  })

  await ensureOffering({
    professionalId: professionalProfile.id,
    serviceId: extensionInstall.id,
    title: 'Extension Installation',
    description: 'Seeded test offering.',
    salonPriceStartingAt: '250.00',
    salonDurationMinutes: 180,
    offersInSalon: true,
    offersMobile: false,
  })

  await ensureOffering({
    professionalId: professionalProfile.id,
    serviceId: gelX.id,
    title: 'Gel X Full Set',
    description: 'Seeded test offering.',
    salonPriceStartingAt: '100.00',
    salonDurationMinutes: 120,
    offersInSalon: true,
    offersMobile: false,
  })

  await ensureOffering({
    professionalId: professionalProfile.id,
    serviceId: softGlam.id,
    title: 'Soft Glam Makeup',
    description: 'Seeded test offering.',
    salonPriceStartingAt: '120.00',
    salonDurationMinutes: 75,
    mobilePriceStartingAt: '140.00',
    mobileDurationMinutes: 90,
    offersInSalon: true,
    offersMobile: true,
  })

  console.log('✅ Seed core data complete.')
  console.log('PRO login:', { email: proEmail, password: proPassword })
  console.log('CLIENT login:', { email: clientEmail, password: clientPassword })
  console.log('PRO profile id:', professionalProfile.id)

  const look1 = await upsertMediaAsset({
    professionalId: professionalProfile.id,
    mediaType: MediaType.IMAGE,
    url: 'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=1080&q=80',
    caption: 'Lived-in balayage with soft money piece ✨',
    storagePath: makeStoragePath('look-1.jpg'),
  })

  const look2 = await upsertMediaAsset({
    professionalId: professionalProfile.id,
    mediaType: MediaType.IMAGE,
    url: 'https://images.unsplash.com/photo-1526045478516-99145907023c?auto=format&fit=crop&w=1080&q=80',
    caption: 'Gel X set with a clean glossy finish 💅',
    storagePath: makeStoragePath('look-2.jpg'),
  })

  const look3 = await upsertMediaAsset({
    professionalId: professionalProfile.id,
    mediaType: MediaType.IMAGE,
    url: 'https://images.unsplash.com/photo-1520975958225-8d92b49a60c1?auto=format&fit=crop&w=1080&q=80',
    caption: 'Soft glam, camera-ready, no flashback allowed.',
    storagePath: makeStoragePath('look-3.jpg'),
  })

  await tagLook(look1.id, balayage.id)
  await tagLook(look1.id, rootTouchUp.id)
  await tagLook(look2.id, gelX.id)
  await tagLook(look3.id, softGlam.id)

  console.log('✅ Seeded looks feed media:', [look1.id, look2.id, look3.id])
}

main()
  .then(async () => {
    await prisma.$disconnect()
    process.exit(0)
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
