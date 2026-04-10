const path = require('path')
const { loadEnvConfig } = require('@next/env')

const projectRoot = path.join(__dirname, '..', '..')
loadEnvConfig(projectRoot)

const {
  PrismaClient,
  Role,
  ClientAddressKind,
  ClientIntentType,
  WaitlistStatus,
  WaitlistPreferenceType,
} = require('@prisma/client')
const bcrypt = require('bcrypt')

const prisma = new PrismaClient()

const TEST_PASSWORD = 'password123'
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K']

function requireEnv(name) {
  const value = process.env[name]
  if (!value || !value.trim()) {
    throw new Error(`Missing required env var: ${name}`)
  }
  return value.trim()
}

function optionalEnv(name) {
  const value = process.env[name]
  if (!value || !value.trim()) return null
  return value.trim()
}

function parseNumberEnv(name, fallback = null) {
  const raw = optionalEnv(name)
  if (raw == null) return fallback
  const n = Number(raw)
  if (!Number.isFinite(n)) {
    throw new Error(`Env var ${name} must be a finite number`)
  }
  return n
}

function normalizeEmail(value) {
  if (typeof value !== 'string') {
    throw new Error('Email must be a string')
  }

  const email = value.trim().toLowerCase()
  if (!email) {
    throw new Error('Email is required')
  }

  return email
}

function emailFor(letter) {
  const normalizedLetter = String(letter ?? '').trim().toLowerCase()
  if (!normalizedLetter) {
    throw new Error('letter is required')
  }

  return normalizeEmail(`client${normalizedLetter}@test.com`)
}

function buildClientSeed(letter) {
  return {
    email: emailFor(letter),
    firstName: 'Client',
    lastName: String(letter ?? '').trim().toUpperCase(),
  }
}

async function getPasswordHash() {
  return bcrypt.hash(TEST_PASSWORD, 10)
}

async function upsertClient(prismaClient, { email, firstName, lastName, passwordHash }) {
  const normalizedEmail = normalizeEmail(email)

  const user = await prismaClient.user.upsert({
    where: { email: normalizedEmail },
    update: {
      email: normalizedEmail,
      password: passwordHash,
      role: Role.CLIENT,
    },
    create: {
      email: normalizedEmail,
      password: passwordHash,
      role: Role.CLIENT,
    },
    select: {
      id: true,
      email: true,
    },
  })

  const profile = await prismaClient.clientProfile.upsert({
    where: { userId: user.id },
    update: {
      firstName,
      lastName,
    },
    create: {
      userId: user.id,
      firstName,
      lastName,
    },
    select: {
      id: true,
      userId: true,
      firstName: true,
      lastName: true,
    },
  })

  await prismaClient.clientNotificationSettings.upsert({
    where: { clientId: profile.id },
    update: {
      lastMinuteEnabled: true,
      maxLastMinutePerDay: 2,
      aftercareEnabled: true,
      maxAftercarePerDay: 5,
    },
    create: {
      clientId: profile.id,
      lastMinuteEnabled: true,
      maxLastMinutePerDay: 2,
      aftercareEnabled: true,
      maxAftercarePerDay: 5,
    },
  })

  return { user, profile }
}

async function getClientByLetter(prismaClient, letter) {
  const email = emailFor(letter)

  const user = await prismaClient.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      clientProfile: {
        select: {
          id: true,
          userId: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  })

  if (!user || !user.clientProfile) {
    throw new Error(`Missing seeded client for letter ${letter} (${email})`)
  }

  return {
    userId: user.id,
    email: user.email,
    clientId: user.clientProfile.id,
    firstName: user.clientProfile.firstName,
    lastName: user.clientProfile.lastName,
  }
}

async function upsertSearchArea(prismaClient, { clientId, label, lat, lng, radiusMiles }) {
  const existing = await prismaClient.clientAddress.findFirst({
    where: {
      clientId,
      kind: ClientAddressKind.SEARCH_AREA,
      label,
    },
    select: { id: true },
  })

  if (existing) {
    return prismaClient.clientAddress.update({
      where: { id: existing.id },
      data: {
        isDefault: true,
        formattedAddress: label,
        lat: String(lat),
        lng: String(lng),
        radiusMiles,
      },
      select: { id: true },
    })
  }

  return prismaClient.clientAddress.create({
    data: {
      clientId,
      kind: ClientAddressKind.SEARCH_AREA,
      label,
      isDefault: true,
      formattedAddress: label,
      lat: String(lat),
      lng: String(lng),
      radiusMiles,
    },
    select: { id: true },
  })
}

async function createIntentEvent(prismaClient, data) {
  return prismaClient.clientIntentEvent.create({
    data,
    select: { id: true },
  })
}

async function upsertWaitlistEntry(prismaClient, data) {
  const existing = await prismaClient.waitlistEntry.findFirst({
    where: {
      clientId: data.clientId,
      professionalId: data.professionalId,
      serviceId: data.serviceId,
      status: WaitlistStatus.ACTIVE,
    },
    select: { id: true },
  })

  if (existing) {
    return prismaClient.waitlistEntry.update({
      where: { id: existing.id },
      data: {
        preferenceType: data.preferenceType ?? WaitlistPreferenceType.ANY_TIME,
        specificDate: data.specificDate ?? null,
        timeOfDay: data.timeOfDay ?? null,
        windowStartMin: data.windowStartMin ?? null,
        windowEndMin: data.windowEndMin ?? null,
        notes: data.notes ?? null,
        status: WaitlistStatus.ACTIVE,
      },
      select: { id: true },
    })
  }

  return prismaClient.waitlistEntry.create({
    data: {
      clientId: data.clientId,
      professionalId: data.professionalId,
      serviceId: data.serviceId,
      status: WaitlistStatus.ACTIVE,
      preferenceType: data.preferenceType ?? WaitlistPreferenceType.ANY_TIME,
      specificDate: data.specificDate ?? null,
      timeOfDay: data.timeOfDay ?? null,
      windowStartMin: data.windowStartMin ?? null,
      windowEndMin: data.windowEndMin ?? null,
      notes: data.notes ?? null,
    },
    select: { id: true },
  })
}

async function upsertProfessionalFavorite(prismaClient, { professionalId, userId }) {
  return prismaClient.professionalFavorite.upsert({
    where: {
      professionalId_userId: {
        professionalId,
        userId,
      },
    },
    update: {},
    create: {
      professionalId,
      userId,
    },
    select: { id: true },
  })
}

async function upsertServiceFavorite(prismaClient, { serviceId, userId }) {
  return prismaClient.serviceFavorite.upsert({
    where: {
      serviceId_userId: {
        serviceId,
        userId,
      },
    },
    update: {},
    create: {
      serviceId,
      userId,
    },
    select: { id: true },
  })
}

async function createPastBooking(
  prismaClient,
  { clientId, professionalId, serviceId, offeringId, locationId, locationType, scheduledFor },
) {
  return prismaClient.booking.create({
    data: {
      clientId,
      professionalId,
      serviceId,
      offeringId,
      locationId,
      locationType,
      scheduledFor,
      status: 'COMPLETED',
      subtotalSnapshot: '100.00',
      totalDurationMinutes: 60,
      source: 'REQUESTED',
    },
    select: { id: true },
  })
}

async function createFutureBooking(
  prismaClient,
  { clientId, professionalId, serviceId, offeringId, locationId, locationType, scheduledFor },
) {
  return prismaClient.booking.create({
    data: {
      clientId,
      professionalId,
      serviceId,
      offeringId,
      locationId,
      locationType,
      scheduledFor,
      status: 'ACCEPTED',
      subtotalSnapshot: '100.00',
      totalDurationMinutes: 60,
      source: 'REQUESTED',
    },
    select: { id: true },
  })
}

async function disconnect() {
  await prisma.$disconnect()
}

module.exports = {
  prisma,
  LETTERS,
  TEST_PASSWORD,
  normalizeEmail,
  emailFor,
  buildClientSeed,
  getPasswordHash,
  upsertClient,
  getClientByLetter,
  upsertSearchArea,
  createIntentEvent,
  upsertWaitlistEntry,
  upsertProfessionalFavorite,
  upsertServiceFavorite,
  createPastBooking,
  createFutureBooking,
  requireEnv,
  optionalEnv,
  parseNumberEnv,
  disconnect,
  ClientIntentType,
  WaitlistPreferenceType,
}