// tests/integration/social-signin-account-resolution.test.ts
//
// Characterization coverage for lib/auth/findOrCreateGoogleUser.ts and
// lib/auth/findOrCreateAppleUser.ts against the docker test database:
//   pnpm test:integration
//
// These two helpers decide whether a verified Google/Apple identity signs in,
// links onto an existing account, or mints a new one — and until this file they
// had NO test at all. Both route suites (app/api/v1/auth/{google,apple}/route.test.ts)
// mock the helper wholesale, so the branch that hardcodes `role: 'CLIENT'`, the
// account-linking path and the unverified-takeover guard had never once been
// executed by a test.
//
// This file pins TODAY'S behavior — including the bug in the last case. It is
// deliberately written before the two-phase social signup refactor so that
// refactor has a net, and so whatever it changes must change a test here on
// purpose.
//
// Prisma is real. Nothing is mocked but the PII keyring (supplied by
// scripts/with-test-db.mjs) and the env the module graph reads at load.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { PrismaClient, Prisma, Role, ClientClaimStatus, VerificationStatus } from '@prisma/client'

vi.hoisted(() => {
  // lib/auth reads JWT_SECRET at module load, and ESM imports are hoisted above
  // plain statements — so this has to run in vi.hoisted(), not at file scope,
  // or findOrCreateGoogleUser's import chain throws before any test collects.
  //
  // The PII keyring is deliberately NOT set here: scripts/with-test-db.mjs
  // already exports a complete one (email/phone/address/notes AEAD + lookup
  // HMAC), and overriding it with a partial set is what makes the register
  // suite log "encryptedEmailInput failed; storing null envelope" every run.
  process.env.JWT_SECRET ||= 'integration-test-jwt-secret'
  process.env.TOVIS_TOS_VERSION ||= '2026-04'
})

import {
  findOrCreateGoogleUser,
  type FindOrCreateGoogleUserResult,
} from '@/lib/auth/findOrCreateGoogleUser'
import {
  findOrCreateAppleUser,
  type FindOrCreateAppleUserResult,
} from '@/lib/auth/findOrCreateAppleUser'
import { upsertProClient } from '@/lib/clients/upsertProClient'
import { emailLookupHashV2 } from '@/lib/security/crypto/hashLookup'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error(
    'Missing DATABASE_URL. Run this test with: pnpm test:integration',
  )
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

const TAG = `social_res_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
const TOS_VERSION = '2026-04'

let emailCounter = 0
function nextEmail(label: string): string {
  emailCounter += 1
  return `${TAG}_${label}_${emailCounter}@example.com`
}

let subjectCounter = 0
function nextSubject(label: string): string {
  subjectCounter += 1
  return `${TAG}-${label}-${subjectCounter}`
}

let tenantId = ''
let otherTenantId = ''
let professionalId = ''

/**
 * Cleanup is scoped to this run's TAG and this run's pro — never a bare
 * deleteMany({}), and never a shared column: sibling suites share this database.
 *
 * Order is load-bearing, and not the obvious one:
 *   - ClientProfile.user is `onDelete: SetNull`, NOT Cascade. Deleting the user
 *     first does not remove the profile, it ORPHANS it (userId -> null) — and a
 *     socially-created profile carries no plaintext email, only the hash, so
 *     there is then nothing left on the row to find it by. Those invisible
 *     orphans hold a Restrict FK on Tenant and the tenant delete fails.
 *   - ProfessionalProfile.user has no onDelete at all (default Restrict), so
 *     the pro profile must go before the pro user.
 */
async function cleanup() {
  if (!professionalId && !tenantId) return

  const ourUsers = await db.user.findMany({
    where: { email: { contains: TAG } },
    select: { id: true },
  })

  await db.clientProfile.deleteMany({
    where: {
      OR: [
        { userId: { in: ourUsers.map((u) => u.id) } },
        // The unclaimed profile the pro created, which has no user to find.
        ...(professionalId ? [{ createdByProfessionalId: professionalId }] : []),
        // Belt and braces for anything already orphaned by a failed run.
        ...(otherTenantId ? [{ homeTenantId: otherTenantId }] : []),
      ],
    },
  })

  await db.professionalProfile.deleteMany({
    where: { businessName: { contains: TAG } },
  })

  await db.user.deleteMany({ where: { email: { contains: TAG } } })
}

beforeAll(async () => {
  const tenant = await db.tenant.upsert({
    where: { slug: 'tovis-root' },
    update: {},
    create: { slug: 'tovis-root', name: 'TOVIS', isActive: true },
    select: { id: true },
  })
  tenantId = tenant.id

  const otherTenant = await db.tenant.upsert({
    where: { slug: `${TAG}-other` },
    update: {},
    create: { slug: `${TAG}-other`, name: `${TAG} Other`, isActive: true },
    select: { id: true },
  })
  otherTenantId = otherTenant.id

  const proUser = await db.user.create({
    data: {
      email: `${TAG}_owner@example.com`,
      password: 'x',
      role: Role.PRO,
    },
    select: { id: true },
  })

  const professional = await db.professionalProfile.create({
    data: {
      userId: proUser.id,
      homeTenantId: tenantId,
      firstName: 'Social',
      lastName: 'Pro',
      businessName: `${TAG} Studio`,
      timeZone: 'America/Los_Angeles',
      verificationStatus: VerificationStatus.APPROVED,
    },
    select: { id: true },
  })
  professionalId = professional.id
})

afterAll(async () => {
  await cleanup()
  await db.tenant.deleteMany({ where: { slug: `${TAG}-other` } })
  await db.$disconnect()
})

type ResolveInput = {
  subject: string
  email: string
  firstName: string | null
  lastName: string | null
  tenantId: string
  tosVersion: string
}

type ResolveResult =
  | FindOrCreateGoogleUserResult
  | FindOrCreateAppleUserResult

type ProviderCase = {
  label: 'google' | 'apple'
  /** The @unique User column this provider's subject is stored in. */
  idColumn: 'googleUserId' | 'appleUserId'
  resolve: (input: ResolveInput) => Promise<ResolveResult>
}

/**
 * The two helpers are byte-identical apart from the provider name, so they are
 * exercised by the same table rather than a copied describe block. If they ever
 * diverge, that divergence has to be argued for here.
 */
const PROVIDERS: ProviderCase[] = [
  {
    label: 'google',
    idColumn: 'googleUserId',
    resolve: ({ subject, ...rest }) =>
      findOrCreateGoogleUser({ googleUserId: subject, ...rest }),
  },
  {
    label: 'apple',
    idColumn: 'appleUserId',
    resolve: ({ subject, ...rest }) =>
      findOrCreateAppleUser({ appleUserId: subject, ...rest }),
  },
]

// A plain loop rather than describe.each: every email and provider subject is
// already unique per test, so no per-test teardown is needed (and a per-test
// teardown would ORPHAN profiles — see cleanup()). The loop also keeps the
// suite titles readable, which describe.each's $label does not.
for (const { label, idColumn, resolve } of PROVIDERS) {
  describe(`findOrCreate ${label} user (integration)`, () => {
    it('creates a fresh CLIENT account with a client profile, verified email and unverified phone', async () => {
      const email = nextEmail(`${label}_new`)
      const subject = nextSubject(`${label}-new`)

      const result = await resolve({
        subject,
        email,
        firstName: 'Ada',
        lastName: 'Lovelace',
        tenantId,
        tosVersion: TOS_VERSION,
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return

      const row = await db.user.findUnique({
        where: { id: result.user.id },
        select: {
          email: true,
          role: true,
          googleUserId: true,
          appleUserId: true,
          password: true,
          emailVerifiedAt: true,
          phoneVerifiedAt: true,
          phone: true,
          tosVersion: true,
          tosAcceptedAt: true,
          emailHashV2: true,
          clientProfile: {
            select: {
              homeTenantId: true,
              firstName: true,
              lastName: true,
              emailHashV2: true,
              phoneVerifiedAt: true,
              claimStatus: true,
              userId: true,
            },
          },
        },
      })

      expect(row).not.toBeNull()
      if (!row) return

      expect(row.email).toBe(email)
      // 🔴 Hardcoded today: a social signup can only ever be a CLIENT, and the
      // caller has no say. This is §0c of the sign-in handoff.
      expect(row.role).toBe(Role.CLIENT)
      expect(row[idColumn]).toBe(subject)

      // The provider asserts the email; the phone is untouched and unverified,
      // which is why the account is not fully verified after social sign-in.
      expect(row.emailVerifiedAt).toBeInstanceOf(Date)
      expect(row.phoneVerifiedAt).toBeNull()
      expect(row.phone).toBeNull()

      expect(row.tosVersion).toBe(TOS_VERSION)
      expect(row.tosAcceptedAt).toBeInstanceOf(Date)

      // 🔴 No transactional SMS consent is recorded anywhere on this path —
      // there is no phone to consent about yet. §0a.
      const consent = await db.user.findUnique({
        where: { id: result.user.id },
        select: {
          transactionalSmsConsentAt: true,
          transactionalSmsConsentVersion: true,
        },
      })
      expect(consent?.transactionalSmsConsentAt).toBeNull()
      expect(consent?.transactionalSmsConsentVersion).toBeNull()

      // Password column is required, so an unguessable random hash is stored.
      // It must not be empty and must not be the email or the subject.
      expect(row.password.length).toBeGreaterThan(20)
      expect(row.password).not.toContain(email)
      expect(row.password).not.toContain(subject)

      const expectedHash = emailLookupHashV2(email)
      expect(expectedHash).not.toBeNull()
      expect(row.emailHashV2).toBe(expectedHash?.hash)

      expect(row.clientProfile).not.toBeNull()
      expect(row.clientProfile?.homeTenantId).toBe(tenantId)
      expect(row.clientProfile?.firstName).toBe('Ada')
      expect(row.clientProfile?.lastName).toBe('Lovelace')
      expect(row.clientProfile?.emailHashV2).toBe(expectedHash?.hash)
      expect(row.clientProfile?.phoneVerifiedAt).toBeNull()
      expect(row.clientProfile?.userId).toBe(result.user.id)

      // 🔴 Asymmetry with the register route, which writes `email`/`phone`
      // plaintext onto the profile alongside the hashes. The social path writes
      // the hash and the AEAD envelope ONLY, so ClientProfile.email is null.
      // Anything that later looks a social client up by profile plaintext (an
      // admin screen, a support query, a cleanup script) silently finds nothing.
      const plaintext = await db.clientProfile.findUnique({
        where: { userId: result.user.id },
        select: { email: true, phone: true, emailEncrypted: true },
      })
      expect(plaintext?.email).toBeNull()
      expect(plaintext?.phone).toBeNull()
      expect(plaintext?.emailEncrypted).not.toBeNull()
    })

    it('stamps the caller-supplied tenant as the profile home tenant', async () => {
      const result = await resolve({
        subject: nextSubject(`${label}-tenant`),
        email: nextEmail(`${label}_tenant`),
        firstName: 'Grace',
        lastName: 'Hopper',
        tenantId: otherTenantId,
        tosVersion: TOS_VERSION,
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return

      const profile = await db.clientProfile.findUnique({
        where: { userId: result.user.id },
        select: { homeTenantId: true },
      })
      expect(profile?.homeTenantId).toBe(otherTenantId)
    })

    it('writes empty-string names when the provider withholds them', async () => {
      const result = await resolve({
        subject: nextSubject(`${label}-noname`),
        email: nextEmail(`${label}_noname`),
        firstName: null,
        lastName: null,
        tenantId,
        tosVersion: TOS_VERSION,
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return

      const profile = await db.clientProfile.findUnique({
        where: { userId: result.user.id },
        select: { firstName: true, lastName: true },
      })
      // Apple only sends the name on the FIRST authorization, so this is the
      // common repeat case, not an edge case.
      expect(profile?.firstName).toBe('')
      expect(profile?.lastName).toBe('')
    })

    it('returns the already-linked account without creating a second user', async () => {
      const email = nextEmail(`${label}_repeat`)
      const subject = nextSubject(`${label}-repeat`)

      const first = await resolve({
        subject,
        email,
        firstName: 'Ada',
        lastName: 'Lovelace',
        tenantId,
        tosVersion: TOS_VERSION,
      })
      expect(first.ok).toBe(true)
      if (!first.ok) return

      const second = await resolve({
        subject,
        // A different email on the same subject must not fork an account: the
        // provider id is the identity, looked up first.
        email: nextEmail(`${label}_repeat_other`),
        firstName: 'Changed',
        lastName: 'Name',
        tenantId,
        tosVersion: TOS_VERSION,
      })

      expect(second.ok).toBe(true)
      if (!second.ok) return
      expect(second.user.id).toBe(first.user.id)

      const count = await db.user.count({
        where: { [idColumn]: subject },
      })
      expect(count).toBe(1)

      // The repeat call is a pure read — it does not rewrite the name.
      const profile = await db.clientProfile.findUnique({
        where: { userId: first.user.id },
        select: { firstName: true },
      })
      expect(profile?.firstName).toBe('Ada')
    })

    it('links the provider id onto an existing VERIFIED same-email account', async () => {
      const email = nextEmail(`${label}_link`)
      const hash = emailLookupHashV2(email)
      expect(hash).not.toBeNull()
      if (!hash) return

      const existing = await db.user.create({
        data: {
          email,
          password: 'existing-password-hash',
          role: Role.CLIENT,
          emailVerifiedAt: new Date(),
          emailHashV2: hash.hash,
          emailHashKeyVersion: hash.keyVersion,
        },
        select: { id: true },
      })

      const subject = nextSubject(`${label}-link`)
      const result = await resolve({
        subject,
        email,
        firstName: 'Ada',
        lastName: 'Lovelace',
        tenantId,
        tosVersion: TOS_VERSION,
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.user.id).toBe(existing.id)

      const row = await db.user.findUnique({
        where: { id: existing.id },
        select: {
          googleUserId: true,
          appleUserId: true,
          password: true,
          clientProfile: { select: { id: true } },
        },
      })
      expect(row?.[idColumn]).toBe(subject)
      // Linking must not touch the password or mint a second profile.
      expect(row?.password).toBe('existing-password-hash')
      expect(row?.clientProfile).toBeNull()

      const count = await db.user.count({ where: { email } })
      expect(count).toBe(1)
    })

    it('refuses to take over an UNVERIFIED same-email account and leaves it unlinked', async () => {
      const email = nextEmail(`${label}_squat`)
      const hash = emailLookupHashV2(email)
      expect(hash).not.toBeNull()
      if (!hash) return

      const squatted = await db.user.create({
        data: {
          email,
          password: 'squatter-password-hash',
          role: Role.CLIENT,
          emailVerifiedAt: null,
          emailHashV2: hash.hash,
          emailHashKeyVersion: hash.keyVersion,
        },
        select: { id: true },
      })

      const result = await resolve({
        subject: nextSubject(`${label}-squat`),
        email,
        firstName: 'Ada',
        lastName: 'Lovelace',
        tenantId,
        tosVersion: TOS_VERSION,
      })

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.code).toBe('ACCOUNT_EXISTS_UNVERIFIED')

      const row = await db.user.findUnique({
        where: { id: squatted.id },
        select: { googleUserId: true, appleUserId: true, password: true },
      })
      expect(row?.[idColumn]).toBeNull()
      expect(row?.password).toBe('squatter-password-hash')

      // No second account was minted as a consolation prize.
      const count = await db.user.count({ where: { email } })
      expect(count).toBe(1)
    })

    // ───────────────────────────────────────────────────────────────────────
    // 🔴 THE BUG. Pinned as-is; the two-phase social signup refactor must
    // change this test on purpose.
    // ───────────────────────────────────────────────────────────────────────
    it('THROWS an unhandled P2002 when a pro already created an UNCLAIMED profile for that email', async () => {
      const email = nextEmail(`${label}_unclaimed`)

      // Exactly how a client first appears in Tovis: a pro adds them, which
      // writes a ClientProfile with NO user and the same unique emailHashV2.
      const upserted = await upsertProClient({
        professionalId,
        firstName: 'Unclaimed',
        lastName: 'Client',
        email,
        phone: null,
      })
      expect(upserted.ok).toBe(true)
      if (!upserted.ok) return
      expect(upserted.claimStatus).toBe(ClientClaimStatus.UNCLAIMED)
      expect(upserted.userId).toBeNull()

      // Step 2 of the helper looks for an existing USER by email hash. An
      // unclaimed profile has no User, so it misses and falls through to the
      // create — which writes the same ClientProfile.emailHashV2.
      const error = await resolve({
        subject: nextSubject(`${label}-unclaimed`),
        email,
        firstName: 'Real',
        lastName: 'Person',
        tenantId,
        tosVersion: TOS_VERSION,
      }).then(
        () => null,
        (err: unknown) => err,
      )

      expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError)
      if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return

      // Neither helper handles P2002 (grep -c P2002 returns 0 in both), so the
      // route's catch-all turns this into a bare 500 for the client.
      expect(error.code).toBe('P2002')
      expect(JSON.stringify(error.meta?.target)).toContain('emailHashV2')

      // The rollback is total: no half-created account is left behind.
      const users = await db.user.count({ where: { email } })
      expect(users).toBe(0)

      // ...and the pro's unclaimed profile is untouched, still waiting to be
      // adopted by whatever fixes this.
      const profile = await db.clientProfile.findFirst({
        where: { email },
        select: { userId: true, claimStatus: true },
      })
      expect(profile?.userId).toBeNull()
      expect(profile?.claimStatus).toBe(ClientClaimStatus.UNCLAIMED)
    })
  })
}
