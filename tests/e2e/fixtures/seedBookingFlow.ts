import {
  Prisma,
  PrismaClient,
  Role,
  ClientAddressKind,
  ProfessionalLocationType,
  ServiceLocationType,
  VerificationStatus,
} from '@prisma/client'
import { hashPassword } from '@/lib/auth'
import { normalizeEmail } from '@/app/api/_utils/email'

export type SeedBookingFlowOptions = {
  withSavedAddress?: boolean
  withAddOn?: boolean
  offersInSalon?: boolean
  offersMobile?: boolean
  professionalPassword?: string
}

export type SeedBookingFlowResult = {
  tag: string

  credentials: {
    client: {
      email: string
      password: string
      userId: string
      clientId: string
      managedBySeed: false
    }
    professional: {
      email: string
      password: string
      userId: string
      professionalId: string
      managedBySeed: true
    }
  }

  category: {
    id: string
    slug: string
  }

  services: {
    base: {
      id: string
      name: string
    }
    addOn: {
      id: string
      name: string
      offeringAddOnId: string
    } | null
  }

  offering: {
    id: string
    title: string | null
    offersInSalon: boolean
    offersMobile: boolean
  }

  locations: {
    salon: {
      id: string
    }
    mobileBase: {
      id: string
    } | null
  }

  clientAddress: {
    id: string
  } | null
}

type SeedDeps = {
  prisma: PrismaClient
}

const DEFAULT_PROFESSIONAL_PASSWORD = 'TestPassword123!'
const FIXED_CLIENT_EMAIL = 'client@tovis.app'
const FIXED_CLIENT_PASSWORD = 'password123'
const DEFAULT_TIME_ZONE = 'America/Los_Angeles'
const DEFAULT_OFFERING_TITLE = 'E2E Base Offering'

function requireNormalizedEmail(value: unknown, label: string): string {
  const email = normalizeEmail(value)
  if (!email) {
    throw new Error(`Invalid ${label}`)
  }
  return email
}

function makeTag(): string {
  return `e2e_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function money(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value)
}

function coord(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value)
}

function workingHoursJson(): Prisma.InputJsonValue {
  return {
    mon: { enabled: true, start: '00:00', end: '23:59' },
    tue: { enabled: true, start: '00:00', end: '23:59' },
    wed: { enabled: true, start: '00:00', end: '23:59' },
    thu: { enabled: true, start: '00:00', end: '23:59' },
    fri: { enabled: true, start: '00:00', end: '23:59' },
    sat: { enabled: true, start: '00:00', end: '23:59' },
    sun: { enabled: true, start: '00:00', end: '23:59' },
  }
}

export async function seedBookingFlow(
  deps: SeedDeps,
  options: SeedBookingFlowOptions = {},
): Promise<SeedBookingFlowResult> {
  const prisma = deps.prisma

  const withSavedAddress = options.withSavedAddress ?? true
  const withAddOn = options.withAddOn ?? true
  const offersInSalon = options.offersInSalon ?? true
  const offersMobile = options.offersMobile ?? true
  const professionalPassword =
    options.professionalPassword ?? DEFAULT_PROFESSIONAL_PASSWORD

  const tag = makeTag()
  const approvedAt = new Date()

  const categorySlug = `${tag}-category`
  const professionalEmail = requireNormalizedEmail(
    `${tag}_pro@example.com`,
    'professional email',
  )
  const professionalHandle = `${tag}-pro`

  const existingClientUser = await prisma.user.findUnique({
    where: { email: FIXED_CLIENT_EMAIL },
    select: {
      id: true,
      email: true,
      role: true,
      clientProfile: {
        select: {
          id: true,
        },
      },
    },
  })

  if (!existingClientUser) {
    throw new Error(
      `Expected existing test client ${FIXED_CLIENT_EMAIL} to exist before running browser E2E.`,
    )
  }

  if (existingClientUser.role !== Role.CLIENT) {
    throw new Error(
      `Expected ${FIXED_CLIENT_EMAIL} to have role CLIENT, got ${existingClientUser.role}.`,
    )
  }

  const existingClientEmail = requireNormalizedEmail(
    existingClientUser.email,
    'existing client email',
  )

  const clientProfile =
    existingClientUser.clientProfile ??
    (await prisma.clientProfile.create({
      data: {
        userId: existingClientUser.id,
        firstName: 'Test',
        lastName: 'Client',
      },
      select: {
        id: true,
      },
    }))

  const clientAddress = withSavedAddress
    ? await prisma.clientAddress.create({
        data: {
          clientId: clientProfile.id,
          kind: ClientAddressKind.SERVICE_ADDRESS,
          label: `E2E ${tag}`,
          isDefault: false,
          formattedAddress: `${tag} Client Ave, San Diego, CA 92101`,
          addressLine1: `${tag} Client Ave`,
          city: 'San Diego',
          state: 'CA',
          postalCode: '92101',
          countryCode: 'US',
          lat: coord('32.7157000'),
          lng: coord('-117.1611000'),
        },
        select: {
          id: true,
        },
      })
    : null

  const professionalPasswordHash = await hashPassword(professionalPassword)

  const professionalUser = await prisma.user.create({
    data: {
      email: professionalEmail,
      password: professionalPasswordHash,
      role: Role.PRO,
    },
    select: {
      id: true,
      email: true,
    },
  })

  const professionalUserEmail = requireNormalizedEmail(
    professionalUser.email,
    'professional user email',
  )

  const professionalProfile = await prisma.professionalProfile.create({
    data: {
      userId: professionalUser.id,
      firstName: 'E2E',
      lastName: 'Professional',
      businessName: 'E2E Test Pro',
      handle: professionalHandle,
      handleNormalized: professionalHandle,
      location: 'San Diego, CA',
      timeZone: DEFAULT_TIME_ZONE,
      licenseVerified: true,
      verificationStatus: VerificationStatus.APPROVED,
      licenseVerifiedAt: approvedAt,
      licenseVerifiedSource: 'E2E_SEED',
      licenseStatusCode: 'CURRENT',
    },
    select: {
      id: true,
    },
  })

  const category = await prisma.serviceCategory.create({
    data: {
      name: `${tag} Category`,
      slug: categorySlug,
      isActive: true,
    },
    select: {
      id: true,
      slug: true,
    },
  })

  const baseService = await prisma.service.create({
    data: {
      name: `${tag} Base Service`,
      categoryId: category.id,
      defaultDurationMinutes: 60,
      minPrice: money('100.00'),
      allowMobile: offersMobile,
      isActive: true,
      isAddOnEligible: false,
    },
    select: {
      id: true,
      name: true,
    },
  })

  const addOnService = withAddOn
    ? await prisma.service.create({
        data: {
          name: `${tag} Add-On Service`,
          categoryId: category.id,
          defaultDurationMinutes: 15,
          minPrice: money('20.00'),
          allowMobile: offersMobile,
          isActive: true,
          isAddOnEligible: true,
          addOnGroup: 'Enhancements',
        },
        select: {
          id: true,
          name: true,
        },
      })
    : null

  const salonLocation = await prisma.professionalLocation.create({
    data: {
      professionalId: professionalProfile.id,
      type: ProfessionalLocationType.SALON,
      name: 'E2E Salon',
      isPrimary: true,
      isBookable: true,
      formattedAddress: '123 Salon St, San Diego, CA 92101',
      addressLine1: '123 Salon St',
      city: 'San Diego',
      state: 'CA',
      postalCode: '92101',
      countryCode: 'US',
      lat: coord('32.7157000'),
      lng: coord('-117.1611000'),
      timeZone: DEFAULT_TIME_ZONE,
      workingHours: workingHoursJson(),
      bufferMinutes: 15,
      stepMinutes: 15,
      advanceNoticeMinutes: 150,
      maxDaysAhead: 30,
    },
    select: {
      id: true,
    },
  })

  const mobileBase = offersMobile
    ? await prisma.professionalLocation.create({
        data: {
          professionalId: professionalProfile.id,
          type: ProfessionalLocationType.MOBILE_BASE,
          name: 'E2E Mobile Base',
          isPrimary: false,
          isBookable: true,
          formattedAddress: '999 Mobile Base, San Diego, CA 92101',
          addressLine1: '999 Mobile Base',
          city: 'San Diego',
          state: 'CA',
          postalCode: '92101',
          countryCode: 'US',
          lat: coord('32.7165000'),
          lng: coord('-117.1625000'),
          timeZone: DEFAULT_TIME_ZONE,
          workingHours: workingHoursJson(),
          bufferMinutes: 15,
          stepMinutes: 15,
          advanceNoticeMinutes: 150,
          maxDaysAhead: 30,
        },
        select: {
          id: true,
        },
      })
    : null

  const offering = await prisma.professionalServiceOffering.create({
    data: {
      professionalId: professionalProfile.id,
      serviceId: baseService.id,
      title: DEFAULT_OFFERING_TITLE,
      description: 'Seeded offering for browser E2E.',
      salonPriceStartingAt: offersInSalon ? money('100.00') : null,
      salonDurationMinutes: offersInSalon ? 60 : null,
      mobilePriceStartingAt: offersMobile ? money('120.00') : null,
      mobileDurationMinutes: offersMobile ? 75 : null,
      offersInSalon,
      offersMobile,
      isActive: true,
    },
    select: {
      id: true,
      title: true,
      offersInSalon: true,
      offersMobile: true,
    },
  })

  await prisma.professionalServiceOffering.findUniqueOrThrow({
    where: { id: offering.id },
  })

  const offeringAddOn = addOnService
    ? await prisma.offeringAddOn.create({
        data: {
          offeringId: offering.id,
          addOnServiceId: addOnService.id,
          isActive: true,
          sortOrder: 0,
          isRecommended: true,
          priceOverride: money('25.00'),
          durationOverrideMinutes: 15,
          locationType: offersInSalon
            ? ServiceLocationType.SALON
            : offersMobile
              ? ServiceLocationType.MOBILE
              : null,
        },
        select: {
          id: true,
        },
      })
    : null

  return {
    tag,
    credentials: {
      client: {
        email: existingClientEmail,
        password: FIXED_CLIENT_PASSWORD,
        userId: existingClientUser.id,
        clientId: clientProfile.id,
        managedBySeed: false,
      },
      professional: {
        email: professionalUserEmail,
        password: professionalPassword,
        userId: professionalUser.id,
        professionalId: professionalProfile.id,
        managedBySeed: true,
      },
    },
    category: {
      id: category.id,
      slug: category.slug,
    },
    services: {
      base: {
        id: baseService.id,
        name: baseService.name,
      },
      addOn:
        addOnService && offeringAddOn
          ? {
              id: addOnService.id,
              name: addOnService.name,
              offeringAddOnId: offeringAddOn.id,
            }
          : null,
    },
    offering: {
      id: offering.id,
      title: offering.title,
      offersInSalon: offering.offersInSalon,
      offersMobile: offering.offersMobile,
    },
    locations: {
      salon: {
        id: salonLocation.id,
      },
      mobileBase: mobileBase
        ? {
            id: mobileBase.id,
          }
        : null,
    },
    clientAddress: clientAddress
      ? {
          id: clientAddress.id,
        }
      : null,
  }
}