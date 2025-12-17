// prisma/seed.cjs
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env') })

const { PrismaClient, Prisma } = require('@prisma/client')
const bcrypt = require('bcrypt')

const prisma = new PrismaClient()


function money(v) {
  // force 2 decimals, stored as Decimal(10,2)
  // allow passing "180", 180, "180.5", etc.
  if (typeof v === 'number') return new Prisma.Decimal(v.toFixed(2))
  const s = String(v).trim()
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error(`Invalid money value: ${v}`)
  const [a, b = ''] = s.split('.')
  const normalized = b.length === 0 ? `${a}.00` : b.length === 1 ? `${a}.${b}0` : `${a}.${b}`
  return new Prisma.Decimal(normalized)
}

async function upsertService({ name, categoryId, description, defaultDurationMinutes, minPrice, allowMobile }) {
  return prisma.service.upsert({
    where: { name },
    update: {
      categoryId,
      description,
      defaultDurationMinutes,
      minPrice: money(minPrice),
      allowMobile,
      isActive: true,
    },
    create: {
      name,
      categoryId,
      description,
      defaultDurationMinutes,
      minPrice: money(minPrice),
      allowMobile,
      isActive: true,
    },
  })
}

async function ensurePermission(serviceId, professionType, stateCode = null) {
  // Prevent duplicates even if you run seed multiple times
  const existing = await prisma.servicePermission.findFirst({
    where: { serviceId, professionType, stateCode },
    select: { id: true },
  })
  if (existing) return existing

  return prisma.servicePermission.create({
    data: { serviceId, professionType, stateCode },
  })
}

async function upsertMediaAsset({ professionalId, url, mediaType, caption }) {
  // If you don't have a unique constraint on url, this will just "find first" then create.
  const existing = await prisma.mediaAsset.findFirst({
    where: { professionalId, url },
    select: { id: true },
  })

  if (existing) {
    return prisma.mediaAsset.update({
      where: { id: existing.id },
      data: {
        mediaType,
        caption,
        visibility: 'PUBLIC',
        isEligibleForLooks: true,
      },
    })
  }

  return prisma.mediaAsset.create({
    data: {
      professionalId,
      url,
      thumbUrl: null,
      mediaType, // 'IMAGE' | 'VIDEO'
      caption,
      visibility: 'PUBLIC',
      isEligibleForLooks: true,
      // If your schema requires these, add them:
      // uploadedByRole: 'PRO',
      // isFeaturedInPortfolio: false,
    },
  })
}

async function main() {
console.log('SEED DATABASE_URL:', process.env.DATABASE_URL)

  // -----------------------------
  // 0) Create test users so you can login
  // -----------------------------
  const proEmail = 'pro@test.com'
  const proPassword = 'Password123!'
  const clientEmail = 'client@test.com'
  const clientPassword = 'Password123!'

  const proHash = await bcrypt.hash(proPassword, 10)
  const clientHash = await bcrypt.hash(clientPassword, 10)

  const proUser = await prisma.user.upsert({
    where: { email: proEmail },
    update: {},
    create: {
      email: proEmail,
      password: proHash,
      role: 'PRO',
      professionalProfile: {
        create: {
          location: 'Los Angeles, CA',
          professionType: 'COSMETOLOGIST',
          licenseState: 'CA',
          isInSalon: true,
        },
      },
    },
    include: { professionalProfile: true },
  })

  await prisma.user.upsert({
    where: { email: clientEmail },
    update: {},
    create: {
      email: clientEmail,
      password: clientHash,
      role: 'CLIENT',
      clientProfile: {
        create: {
          firstName: 'Test',
          lastName: 'Client',
          phone: null,
          avatarUrl: null,
        },
      },
    },
  })
  

  // -----------------------------
  // 1) Root categories
  // -----------------------------
  const hair = await prisma.serviceCategory.upsert({
    where: { slug: 'hair' },
    update: {},
    create: {
      name: 'Hair',
      slug: 'hair',
      description: 'Services related to haircut, color, extensions, and hair treatments.',
    },
  })

  const nails = await prisma.serviceCategory.upsert({
    where: { slug: 'nails' },
    update: {},
    create: {
      name: 'Nails',
      slug: 'nails',
      description: 'Manicures, pedicures, enhancements, and nail art.',
    },
  })

  const makeup = await prisma.serviceCategory.upsert({
    where: { slug: 'makeup' },
    update: {},
    create: {
      name: 'Makeup',
      slug: 'makeup',
      description: 'Makeup application for events, photoshoots, and everyday looks.',
    },
  })

  const massage = await prisma.serviceCategory.upsert({
    where: { slug: 'massage' },
    update: {},
    create: {
      name: 'Massage',
      slug: 'massage',
      description: 'Bodywork, relaxation, and therapeutic massage services.',
    },
  })

  // -----------------------------
  // 2) Subcategories
  // -----------------------------
  const hairColor = await prisma.serviceCategory.upsert({
    where: { slug: 'hair-color' },
    update: {},
    create: {
      name: 'Color',
      slug: 'hair-color',
      description: 'All services involving changing or refreshing hair color.',
      parentId: hair.id,
    },
  })

  const haircut = await prisma.serviceCategory.upsert({
    where: { slug: 'haircut' },
    update: {},
    create: {
      name: 'Haircut',
      slug: 'haircut',
      description: 'Cutting and shaping the hair.',
      parentId: hair.id,
    },
  })

  const hairExtensions = await prisma.serviceCategory.upsert({
    where: { slug: 'hair-extensions' },
    update: {},
    create: {
      name: 'Extensions',
      slug: 'hair-extensions',
      description: 'Installation and maintenance of hair extensions.',
      parentId: hair.id,
    },
  })

  const nailsEnhancements = await prisma.serviceCategory.upsert({
    where: { slug: 'nails-enhancements' },
    update: {},
    create: {
      name: 'Enhancements',
      slug: 'nails-enhancements',
      description: 'Full sets, fills, and structured manicures.',
      parentId: nails.id,
    },
  })

  // -----------------------------
  // 3) Services (Decimal minPrice)
  // -----------------------------
  const balayage = await upsertService({
    name: 'Balayage',
    categoryId: hairColor.id,
    description: 'Hand-painted, lived-in highlights designed to grow out softly and seamlessly.',
    defaultDurationMinutes: 180,
    minPrice: '180.00',
    allowMobile: false,
  })

  const rootTouchUp = await upsertService({
    name: 'Root Touch-Up',
    categoryId: hairColor.id,
    description: 'Covers or refreshes regrowth at the roots to match your existing color.',
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
    description: 'Installation of professional hair extensions. Hair cost may be separate.',
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
    description: 'Camera-ready, soft glam makeup application for events and special occasions.',
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

  // -----------------------------
  // 4) Service permissions (so allowed-services filter works)
  //    Adjust these rules later to match real licensing laws.
  // -----------------------------
  // Cosmetologist (CA) can do hair, nails, makeup in our simplified world
  await ensurePermission(balayage.id, 'COSMETOLOGIST', 'CA')
  await ensurePermission(rootTouchUp.id, 'COSMETOLOGIST', 'CA')
  await ensurePermission(haircutStyle.id, 'COSMETOLOGIST', 'CA')
  await ensurePermission(extensionInstall.id, 'COSMETOLOGIST', 'CA')
  await ensurePermission(gelX.id, 'COSMETOLOGIST', 'CA')
  await ensurePermission(softGlam.id, 'COSMETOLOGIST', 'CA')

  // Massage therapist permission for massage
  await ensurePermission(swedish60.id, 'MASSAGE_THERAPIST', 'CA')

  console.log('✅ Seed complete.')
  console.log('PRO login:', { email: proEmail, password: proPassword })
  console.log('CLIENT login:', { email: clientEmail, password: clientPassword })
  console.log('PRO profile id:', proUser.professionalProfile?.id)

  // -----------------------------
  // 5) Seed Looks feed media (PUBLIC + eligible)
  // -----------------------------
  const proId = proUser.professionalProfile?.id
  if (!proId) throw new Error('Missing pro profile id for seeding media')

  const look1 = await upsertMediaAsset({
    professionalId: proId,
    mediaType: 'IMAGE',
    url: 'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=1080&q=80',
    caption: 'Lived-in balayage with soft money piece ✨',
  })

  const look2 = await upsertMediaAsset({
    professionalId: proId,
    mediaType: 'IMAGE',
    url: 'https://images.unsplash.com/photo-1526045478516-99145907023c?auto=format&fit=crop&w=1080&q=80',
    caption: 'Gel X set with a clean glossy finish 💅',
  })

  const look3 = await upsertMediaAsset({
    professionalId: proId,
    mediaType: 'IMAGE',
    url: 'https://images.unsplash.com/photo-1520975958225-8d92b49a60c1?auto=format&fit=crop&w=1080&q=80',
    caption: 'Soft glam, camera-ready, no flashback allowed.',
  })

  // Attach service tags to looks (JOIN TABLE)
  // ✅ IMPORTANT: your join model name might differ.
  // This assumes a model like MediaAssetServiceTag with fields: mediaAssetId, serviceId
  async function tagLook(mediaAssetId, serviceId) {
    const existing = await prisma.mediaAssetServiceTag.findFirst({
      where: { mediaAssetId, serviceId },
      select: { id: true },
    })
    if (existing) return existing
    return prisma.mediaAssetServiceTag.create({
      data: { mediaAssetId, serviceId },
    })
}


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
