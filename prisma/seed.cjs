const path = require('path')
const { loadEnvConfig } = require('@next/env')

// Load env in development mode unless explicitly in production, so local/test
// seeds read .env.development.local (local DB) and never pull in
// .env.production.local — which carries the prod DATABASE_URL and VERCEL_ENV.
loadEnvConfig(path.join(__dirname, '..'), process.env.NODE_ENV !== 'production')

const { requireSafeScriptRun } = require('../scripts/_safe-script-guard.cjs')

requireSafeScriptRun({
  scriptName: 'prisma/seed.cjs',
  destructive: true,
  allowEnvVar: 'ALLOW_SEED_SCRIPT',
})

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
  ClientClaimStatus,
  ContactMethod,
  LookPostStatus,
  LookPostVisibility,
  ModerationStatus,
  LooksSocialJobStatus,
  LooksSocialJobType,
} = require('@prisma/client')
const bcrypt = require('bcryptjs')

const prisma = new PrismaClient()

const DEFAULT_TIME_ZONE = 'America/Los_Angeles'

const VERIFIED_PHONE_AT = new Date('2026-04-08T10:00:00.000Z')
const VERIFIED_EMAIL_AT = new Date('2026-04-08T10:05:00.000Z')
const LICENSE_VERIFIED_AT = new Date('2026-04-08T10:10:00.000Z')
const LOOK_PUBLISHED_AT = new Date('2026-04-18T12:00:00.000Z')

function requireSeedPhone(label, value) {
  const normalized = normalizeOptionalPhone(value)

  if (!normalized) {
    throw new Error(`${label} is required`)
  }

  return normalized
}

function getFullyVerifiedUserFields(label, phone) {
  const normalizedPhone = requireSeedPhone(label, phone)

  return {
    phone: normalizedPhone,
    phoneVerifiedAt: VERIFIED_PHONE_AT,
    emailVerifiedAt: VERIFIED_EMAIL_AT,
  }
}

function normalizeEmail(value) {
  if (typeof value !== 'string') {
    throw new Error('Email must be a string')
  }

  const email = value.trim().toLowerCase()
  if (!email) {
    throw new Error('Email is required')
  }

  if (!email.includes('@')) {
    throw new Error(`Invalid email: ${value}`)
  }

  return email
}

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

async function upsertAdmin({
  email,
  password,
  phone = '+15555550102',
}) {
  const normalizedEmail = normalizeEmail(email)
  const adminHash = await bcrypt.hash(password, 10)
  const verifiedAuth = getFullyVerifiedUserFields('Seed admin phone', phone)

  const adminUser = await prisma.user.upsert({
    where: { email: normalizedEmail },
    update: {
      email: normalizedEmail,
      role: Role.ADMIN,
      password: adminHash,
      ...verifiedAuth,
    },
    create: {
      email: normalizedEmail,
      password: adminHash,
      role: Role.ADMIN,
      ...verifiedAuth,
    },
    select: {
      id: true,
      email: true,
      phone: true,
      role: true,
      phoneVerifiedAt: true,
      emailVerifiedAt: true,
    },
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

  console.log('ADMIN login:', {
    email: adminUser.email,
    password,
    phone: adminUser.phone,
    phoneVerifiedAt: adminUser.phoneVerifiedAt,
    emailVerifiedAt: adminUser.emailVerifiedAt,
  })
  console.log('ADMIN user id:', adminUser.id)

  return adminUser
}

async function upsertClientUser({
  email,
  password,
  rootTenantId,
  phone = '+15555550100',
}) {
  const normalizedEmail = normalizeEmail(email)
  const passwordHash = await bcrypt.hash(password, 10)
  const verifiedAuth = getFullyVerifiedUserFields('Seed client phone', phone)

  const user = await prisma.user.upsert({
    where: { email: normalizedEmail },
    update: {
      email: normalizedEmail,
      password: passwordHash,
      role: Role.CLIENT,
      ...verifiedAuth,
    },
    create: {
      email: normalizedEmail,
      password: passwordHash,
      role: Role.CLIENT,
      ...verifiedAuth,
    },
    select: {
      id: true,
      email: true,
      role: true,
      phone: true,
      phoneVerifiedAt: true,
      emailVerifiedAt: true,
    },
  })

  const clientProfile = await prisma.clientProfile.upsert({
    where: { userId: user.id },
    update: {
      firstName: 'Test',
      lastName: 'Client',
      email: normalizedEmail,
      phone: verifiedAuth.phone,
      phoneVerifiedAt: VERIFIED_PHONE_AT,
      claimStatus: ClientClaimStatus.CLAIMED,
      claimedAt: VERIFIED_EMAIL_AT,
      avatarUrl: null,
    },
    create: {
      userId: user.id,
      homeTenantId: rootTenantId,
      firstName: 'Test',
      lastName: 'Client',
      email: normalizedEmail,
      phone: verifiedAuth.phone,
      phoneVerifiedAt: VERIFIED_PHONE_AT,
      claimStatus: ClientClaimStatus.CLAIMED,
      claimedAt: VERIFIED_EMAIL_AT,
      avatarUrl: null,
    },
  })

  return { user, clientProfile }
}

function normalizeOptionalPhone(value) {
  if (value == null) return null
  if (typeof value !== 'string') {
    throw new Error('Phone must be a string')
  }

  const phone = value.trim()
  return phone || null
}

async function upsertUnclaimedClientProfile({
  firstName,
  lastName,
  email = null,
  phone = null,
  preferredContactMethod = null,
  rootTenantId,
}) {
  const normalizedFirstName =
    typeof firstName === 'string' ? firstName.trim() : ''
  const normalizedLastName =
    typeof lastName === 'string' ? lastName.trim() : ''
  const normalizedEmail = email == null ? null : normalizeEmail(email)
  const normalizedPhone = normalizeOptionalPhone(phone)

  if (!normalizedFirstName || !normalizedLastName) {
    throw new Error('Unclaimed client firstName and lastName are required')
  }

  if (!normalizedEmail && !normalizedPhone) {
    throw new Error(
      'Unclaimed client requires either email or phone',
    )
  }

  const existing = normalizedEmail
    ? await prisma.clientProfile.findUnique({
        where: { email: normalizedEmail },
        select: {
          id: true,
          userId: true,
          claimStatus: true,
          email: true,
          phone: true,
        },
      })
    : await prisma.clientProfile.findUnique({
        where: { phone: normalizedPhone },
        select: {
          id: true,
          userId: true,
          claimStatus: true,
          email: true,
          phone: true,
        },
      })

  if (existing) {
    if (existing.userId || existing.claimStatus === ClientClaimStatus.CLAIMED) {
      throw new Error(
        `Refusing to overwrite claimed client profile ${existing.id} with unclaimed seed data.`,
      )
    }

    return prisma.clientProfile.update({
      where: { id: existing.id },
      data: {
        userId: null,
        claimStatus: ClientClaimStatus.UNCLAIMED,
        claimedAt: null,
        firstName: normalizedFirstName,
        lastName: normalizedLastName,
        email: normalizedEmail,
        phone: normalizedPhone,
        preferredContactMethod,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        claimStatus: true,
        preferredContactMethod: true,
      },
    })
  }

  return prisma.clientProfile.create({
    data: {
      userId: null,
      homeTenantId: rootTenantId,
      claimStatus: ClientClaimStatus.UNCLAIMED,
      claimedAt: null,
      firstName: normalizedFirstName,
      lastName: normalizedLastName,
      email: normalizedEmail,
      phone: normalizedPhone,
      preferredContactMethod,
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      claimStatus: true,
      preferredContactMethod: true,
    },
  })
}

async function upsertProfessionalUser({
  email,
  password,
  rootTenantId,
  phone = '+15555550103',
}) {
  const normalizedEmail = normalizeEmail(email)
  const passwordHash = await bcrypt.hash(password, 10)
  const verifiedAuth = getFullyVerifiedUserFields('Seed pro phone', phone)

  const user = await prisma.user.upsert({
    where: { email: normalizedEmail },
    update: {
      email: normalizedEmail,
      password: passwordHash,
      role: Role.PRO,
      ...verifiedAuth,
    },
    create: {
      email: normalizedEmail,
      password: passwordHash,
      role: Role.PRO,
      ...verifiedAuth,
    },
    select: {
      id: true,
      email: true,
      phone: true,
      role: true,
      phoneVerifiedAt: true,
      emailVerifiedAt: true,
    },
  })

  const professionalProfile = await prisma.professionalProfile.upsert({
    where: { userId: user.id },
    update: {
      firstName: 'Test',
      lastName: 'Professional',
      phone: verifiedAuth.phone,
      phoneVerifiedAt: VERIFIED_PHONE_AT,
      businessName: 'TOVIS Test Pro',
      handle: 'tovis-test-pro',
      handleNormalized: 'tovis-test-pro',
      location: 'Los Angeles, CA',
      timeZone: DEFAULT_TIME_ZONE,
      professionType: ProfessionType.COSMETOLOGIST,
      licenseState: 'CA',
      licenseVerified: true,
      verificationStatus: VerificationStatus.APPROVED,
      licenseVerifiedAt: LICENSE_VERIFIED_AT,
      licenseVerifiedSource: 'SEED',
      licenseStatusCode: 'CURRENT',
    },
    create: {
      userId: user.id,
      homeTenantId: rootTenantId,
      firstName: 'Test',
      lastName: 'Professional',
      phone: verifiedAuth.phone,
      phoneVerifiedAt: VERIFIED_PHONE_AT,
      businessName: 'TOVIS Test Pro',
      handle: 'tovis-test-pro',
      handleNormalized: 'tovis-test-pro',
      location: 'Los Angeles, CA',
      timeZone: DEFAULT_TIME_ZONE,
      professionType: ProfessionType.COSMETOLOGIST,
      licenseState: 'CA',
      licenseVerified: true,
      verificationStatus: VerificationStatus.APPROVED,
      licenseVerifiedAt: LICENSE_VERIFIED_AT,
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
  primaryServiceId,
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
    primaryServiceId,
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

async function ensureLookPostAsset({
  lookPostId,
  mediaAssetId,
  sortOrder,
}) {
  const existing = await prisma.lookPostAsset.findFirst({
    where: { lookPostId, mediaAssetId },
    select: { id: true },
  })

  if (existing) {
    return prisma.lookPostAsset.update({
      where: { id: existing.id },
      data: { sortOrder },
    })
  }

  return prisma.lookPostAsset.create({
    data: {
      lookPostId,
      mediaAssetId,
      sortOrder,
    },
  })
}

async function ensurePublishedLookPost({
  professionalId,
  primaryMediaAssetId,
  serviceId = null,
  caption = null,
  priceStartingAt = null,
  publishedAt = LOOK_PUBLISHED_AT,
}) {
  const baseData = {
    professionalId,
    primaryMediaAssetId,
    serviceId,
    caption,
    priceStartingAt:
      priceStartingAt == null ? null : money(priceStartingAt),
    status: LookPostStatus.PUBLISHED,
    visibility: LookPostVisibility.PUBLIC,
    moderationStatus: ModerationStatus.APPROVED,
    publishedAt,
    archivedAt: null,
    removedAt: null,
  }

  const lookPost = await prisma.lookPost.upsert({
    where: { primaryMediaAssetId },
    update: baseData,
    create: baseData,
    select: {
      id: true,
      primaryMediaAssetId: true,
      serviceId: true,
      status: true,
      visibility: true,
      moderationStatus: true,
      publishedAt: true,
    },
  })

  await ensureLookPostAsset({
    lookPostId: lookPost.id,
    mediaAssetId: primaryMediaAssetId,
    sortOrder: 0,
  })

  return lookPost
}

async function enqueueLooksSocialJob({
  type,
  dedupeKey,
  payload,
  runAt = new Date(),
  maxAttempts = 5,
}) {
  return prisma.looksSocialJob.upsert({
    where: { dedupeKey },
    update: {
      type,
      payload,
      status: LooksSocialJobStatus.PENDING,
      runAt,
      claimedAt: null,
      processedAt: null,
      failedAt: null,
      attemptCount: 0,
      maxAttempts,
      lastError: null,
    },
    create: {
      type,
      dedupeKey,
      payload,
      status: LooksSocialJobStatus.PENDING,
      runAt,
      maxAttempts,
    },
    select: {
      id: true,
      type: true,
      dedupeKey: true,
      status: true,
      runAt: true,
      attemptCount: true,
      maxAttempts: true,
    },
  })
}

async function enqueueSeedLookScoringJobs(lookPostId) {
  await Promise.all([
    enqueueLooksSocialJob({
      type: LooksSocialJobType.RECOMPUTE_LOOK_COUNTS,
      dedupeKey: `look:${lookPostId}:recompute-counts`,
      payload: { lookPostId },
    }),
    enqueueLooksSocialJob({
      type: LooksSocialJobType.RECOMPUTE_LOOK_SPOTLIGHT_SCORE,
      dedupeKey: `look:${lookPostId}:recompute-spotlight-score`,
      payload: { lookPostId },
    }),
    enqueueLooksSocialJob({
      type: LooksSocialJobType.RECOMPUTE_LOOK_RANK_SCORE,
      dedupeKey: `look:${lookPostId}:recompute-rank-score`,
      payload: { lookPostId },
    }),
  ])
}

async function main() {
  console.log('SEED DATABASE_URL:', process.env.DATABASE_URL)

  // Reserved root tenant — every seeded row belongs to the TOVIS marketplace.
  // Must match lib/tenant/constants.ts (TOVIS_ROOT_TENANT_SLUG).
  const rootTenant = await prisma.tenant.upsert({
    where: { slug: 'tovis-root' },
    update: {},
    create: { slug: 'tovis-root', name: 'TOVIS', isActive: true },
    select: { id: true },
  })
  const rootTenantId = rootTenant.id

  const seedPassword = process.env.SEED_TEST_PASSWORD || 'password123'

  const proEmail = normalizeEmail('pro@tovis.app')
  const proPassword = seedPassword

  const clientEmail = normalizeEmail('client@tovis.app')
  const clientPassword = seedPassword

  const adminEmail = normalizeEmail(process.env.ADMIN_EMAIL || 'admin@tovis.app')
  const adminPassword = seedPassword

  const { user: proUser, professionalProfile } = await upsertProfessionalUser({
    email: proEmail,
    password: proPassword,
    rootTenantId,
  })

  const { user: clientUser } = await upsertClientUser({
    email: clientEmail,
    password: clientPassword,
    rootTenantId,
  })

  const adminUser = await upsertAdmin({
    email: adminEmail,
    password: adminPassword,
  })

    const unclaimedEmailClient = await upsertUnclaimedClientProfile({
    firstName: 'Email',
    lastName: 'Only',
    email: 'unclaimed-email@tovis.app',
    phone: null,
    preferredContactMethod: ContactMethod.EMAIL,
    rootTenantId,
  })

  const unclaimedPhoneClient = await upsertUnclaimedClientProfile({
    firstName: 'Phone',
    lastName: 'Only',
    email: null,
    phone: '+15555550101',
    preferredContactMethod: ContactMethod.SMS,
    rootTenantId,
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

  // ── Expanded canonical catalog (migration matcher coverage). ───────────────
  // DRAFT minimum prices — see docs/design/canonical-catalog-expansion.md;
  // confirm/adjust before relying on these as platform minimums. Prod catalog is
  // admin-managed, so this only seeds dev / fresh installs.
  const hairTreatment = await upsertServiceCategory({
    slug: 'hair-treatment',
    name: 'Treatment',
    description: 'Smoothing, conditioning, and restorative hair treatments.',
    parentId: hair.id,
  })
  const nailsManicure = await upsertServiceCategory({
    slug: 'nails-manicure',
    name: 'Manicure',
    description: 'Manicures and gel polish.',
    parentId: nails.id,
  })
  const nailsPedicure = await upsertServiceCategory({
    slug: 'nails-pedicure',
    name: 'Pedicure',
    description: 'Pedicures and gel polish.',
    parentId: nails.id,
  })
  const lashes = await upsertServiceCategory({
    slug: 'lashes',
    name: 'Lashes',
    description: 'Lash extensions, fills, and lifts.',
  })
  const brows = await upsertServiceCategory({
    slug: 'brows',
    name: 'Brows',
    description: 'Brow shaping, lamination, and tinting.',
  })
  const skin = await upsertServiceCategory({
    slug: 'skin',
    name: 'Skin',
    description: 'Facials and skin treatments.',
  })
  const waxing = await upsertServiceCategory({
    slug: 'waxing',
    name: 'Waxing',
    description: 'Hair removal by waxing.',
  })
  const hairRemoval = await upsertServiceCategory({
    slug: 'hair-removal',
    name: 'Hair Removal',
    description: 'Permanent hair removal.',
  })
  const permanentMakeup = await upsertServiceCategory({
    slug: 'permanent-makeup',
    name: 'Permanent Makeup',
    description: 'Cosmetic tattooing such as microblading and powder brows.',
  })
  const braiding = await upsertServiceCategory({
    slug: 'braiding',
    name: 'Braiding',
    description: 'Natural hair braiding, twisting, and locking.',
    parentId: hair.id,
  })

  // Data-driven so the list is easy to review/extend. minPrice is DRAFT.
  const expandedCatalog = [
    { name: 'Partial Highlights', categoryId: hairColor.id, minPrice: '120.00', defaultDurationMinutes: 150, allowMobile: false, profession: ProfessionType.COSMETOLOGIST, description: 'Foil highlights through part of the head.' },
    { name: 'Full Highlights', categoryId: hairColor.id, minPrice: '160.00', defaultDurationMinutes: 180, allowMobile: false, profession: ProfessionType.COSMETOLOGIST, description: 'Foil highlights throughout the head.' },
    { name: 'All-Over Color', categoryId: hairColor.id, minPrice: '90.00', defaultDurationMinutes: 90, allowMobile: false, profession: ProfessionType.COSMETOLOGIST, description: 'Single-process all-over color.' },
    { name: 'Toner / Gloss', categoryId: hairColor.id, minPrice: '45.00', defaultDurationMinutes: 45, allowMobile: false, profession: ProfessionType.COSMETOLOGIST, description: 'Refreshes tone and adds shine.' },
    { name: "Men's Cut", categoryId: haircut.id, minPrice: '35.00', defaultDurationMinutes: 30, allowMobile: true, profession: ProfessionType.COSMETOLOGIST, description: "Men's haircut." },
    { name: 'Blowout', categoryId: haircut.id, minPrice: '50.00', defaultDurationMinutes: 45, allowMobile: true, profession: ProfessionType.COSMETOLOGIST, description: 'Wash and blow-dry style.' },
    { name: 'Keratin Smoothing Treatment', categoryId: hairTreatment.id, minPrice: '200.00', defaultDurationMinutes: 150, allowMobile: false, profession: ProfessionType.COSMETOLOGIST, description: 'Smoothing treatment that reduces frizz.' },
    { name: 'Gel Manicure', categoryId: nailsManicure.id, minPrice: '45.00', defaultDurationMinutes: 60, allowMobile: true, profession: ProfessionType.MANICURIST, description: 'Manicure finished with gel polish.' },
    { name: 'Classic Manicure', categoryId: nailsManicure.id, minPrice: '30.00', defaultDurationMinutes: 45, allowMobile: true, profession: ProfessionType.MANICURIST, description: 'Classic manicure with regular polish.' },
    { name: 'Gel Pedicure', categoryId: nailsPedicure.id, minPrice: '55.00', defaultDurationMinutes: 60, allowMobile: false, profession: ProfessionType.MANICURIST, description: 'Pedicure finished with gel polish.' },
    { name: 'Acrylic Full Set', categoryId: nailsEnhancements.id, minPrice: '60.00', defaultDurationMinutes: 90, allowMobile: false, profession: ProfessionType.MANICURIST, description: 'Acrylic nail extensions, full set.' },
    { name: 'Dip Powder', categoryId: nailsEnhancements.id, minPrice: '50.00', defaultDurationMinutes: 60, allowMobile: false, profession: ProfessionType.MANICURIST, description: 'Dip-powder manicure.' },
    { name: 'Classic Lash Full Set', categoryId: lashes.id, minPrice: '120.00', defaultDurationMinutes: 120, allowMobile: false, profession: ProfessionType.ESTHETICIAN, description: 'Classic individual lash extensions, full set.' },
    { name: 'Volume Lash Full Set', categoryId: lashes.id, minPrice: '150.00', defaultDurationMinutes: 150, allowMobile: false, profession: ProfessionType.ESTHETICIAN, description: 'Volume lash extensions, full set.' },
    { name: 'Lash Fill', categoryId: lashes.id, minPrice: '60.00', defaultDurationMinutes: 60, allowMobile: false, profession: ProfessionType.ESTHETICIAN, description: 'Lash extension fill/refill.' },
    { name: 'Lash Lift', categoryId: lashes.id, minPrice: '75.00', defaultDurationMinutes: 60, allowMobile: true, profession: ProfessionType.ESTHETICIAN, description: 'Lifts and curls natural lashes.' },
    { name: 'Brow Lamination', categoryId: brows.id, minPrice: '75.00', defaultDurationMinutes: 60, allowMobile: true, profession: ProfessionType.ESTHETICIAN, description: 'Restructures brow hairs for a fuller look.' },
    { name: 'Brow Wax & Shape', categoryId: brows.id, minPrice: '25.00', defaultDurationMinutes: 20, allowMobile: true, profession: ProfessionType.ESTHETICIAN, description: 'Brow shaping by wax.' },
    { name: 'Classic Facial', categoryId: skin.id, minPrice: '90.00', defaultDurationMinutes: 60, allowMobile: true, profession: ProfessionType.ESTHETICIAN, description: 'Cleansing and hydrating facial.' },
    { name: 'Brazilian Wax', categoryId: waxing.id, minPrice: '55.00', defaultDurationMinutes: 30, allowMobile: false, profession: ProfessionType.ESTHETICIAN, description: 'Brazilian hair removal by wax.' },
    { name: 'Bridal Makeup', categoryId: makeup.id, minPrice: '200.00', defaultDurationMinutes: 90, allowMobile: true, profession: ProfessionType.MAKEUP_ARTIST, description: 'Bridal makeup application.' },
    { name: '60-Minute Deep Tissue', categoryId: massage.id, minPrice: '120.00', defaultDurationMinutes: 60, allowMobile: true, profession: ProfessionType.MASSAGE_THERAPIST, description: 'Deep-tissue massage focusing on tension.' },
    { name: 'Hot Stone Massage', categoryId: massage.id, minPrice: '140.00', defaultDurationMinutes: 90, allowMobile: true, profession: ProfessionType.MASSAGE_THERAPIST, description: 'Massage using heated stones.' },
    // Specialty-license services (Phase 2 licensing scope).
    { name: 'Microblading', categoryId: permanentMakeup.id, minPrice: '350.00', defaultDurationMinutes: 120, allowMobile: false, profession: ProfessionType.PERMANENT_MAKEUP_ARTIST, description: 'Semi-permanent eyebrow tattooing for fuller, defined brows.' },
    { name: 'Box Braids', categoryId: braiding.id, minPrice: '150.00', defaultDurationMinutes: 240, allowMobile: false, profession: ProfessionType.HAIR_BRAIDER, description: 'Protective box braids; hair cost may be separate.' },
    { name: 'Electrolysis', categoryId: hairRemoval.id, minPrice: '60.00', defaultDurationMinutes: 30, allowMobile: false, profession: ProfessionType.ELECTROLOGIST, description: 'Permanent hair removal by electrolysis.' },
  ]

  for (const entry of expandedCatalog) {
    const service = await upsertService({
      name: entry.name,
      categoryId: entry.categoryId,
      description: entry.description,
      defaultDurationMinutes: entry.defaultDurationMinutes,
      minPrice: entry.minPrice,
      allowMobile: entry.allowMobile,
    })
    await ensurePermission(service.id, entry.profession, 'CA')
  }

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
  console.log('PRO login:', { email: proUser.email, password: proPassword })
  console.log('CLIENT login:', {
  email: clientUser.email,
  password: clientPassword,
  phoneVerifiedAt: clientUser.phoneVerifiedAt,
  emailVerifiedAt: clientUser.emailVerifiedAt,
})
  console.log('ADMIN login:', { email: adminUser.email, password: adminPassword })
  console.log('PRO profile id:', professionalProfile.id)
  console.log('UNCLAIMED email client:', unclaimedEmailClient)
  console.log('UNCLAIMED phone client:', unclaimedPhoneClient) 

  const look1 = await upsertMediaAsset({
  professionalId: professionalProfile.id,
  primaryServiceId: balayage.id,
  mediaType: MediaType.IMAGE,
  url: '/seed/look-1.png',
  caption: 'Lived-in balayage with soft money piece ✨',
  storagePath: makeStoragePath('look-1.png'),
})

const look2 = await upsertMediaAsset({
  professionalId: professionalProfile.id,
  primaryServiceId: gelX.id,
  mediaType: MediaType.IMAGE,
  url: '/seed/look-2.png',
  caption: 'Gel X set with a clean glossy finish 💅',
  storagePath: makeStoragePath('look-2.png'),
})

const look3 = await upsertMediaAsset({
  professionalId: professionalProfile.id,
  primaryServiceId: softGlam.id,
  mediaType: MediaType.IMAGE,
  url: '/seed/look-3.png',
  caption: 'Soft glam, camera-ready, no flashback allowed.',
  storagePath: makeStoragePath('look-3.png'),
})

await tagLook(look1.id, balayage.id)
await tagLook(look1.id, rootTouchUp.id)
await tagLook(look2.id, gelX.id)
await tagLook(look3.id, softGlam.id)

const lookPost1 = await ensurePublishedLookPost({
  professionalId: professionalProfile.id,
  primaryMediaAssetId: look1.id,
  serviceId: balayage.id,
  caption: look1.caption,
})

const lookPost2 = await ensurePublishedLookPost({
  professionalId: professionalProfile.id,
  primaryMediaAssetId: look2.id,
  serviceId: gelX.id,
  caption: look2.caption,
})

const lookPost3 = await ensurePublishedLookPost({
  professionalId: professionalProfile.id,
  primaryMediaAssetId: look3.id,
  serviceId: softGlam.id,
  caption: look3.caption,
})

await Promise.all([
  enqueueSeedLookScoringJobs(lookPost1.id),
  enqueueSeedLookScoringJobs(lookPost2.id),
  enqueueSeedLookScoringJobs(lookPost3.id),
])

console.log('✅ Seeded looks feed media:', [look1.id, look2.id, look3.id])
console.log('✅ Seeded canonical LookPosts:', [
  lookPost1.id,
  lookPost2.id,
  lookPost3.id,
])
console.log('✅ Enqueued due LooksSocial jobs for seeded LookPosts')
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