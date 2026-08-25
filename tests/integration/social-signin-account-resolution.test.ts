// tests/integration/social-signin-account-resolution.test.ts
//
// Real-Postgres coverage for lib/auth/resolveSocialAccount.ts against the
// docker test database:
//   pnpm test:integration
//
// This file began as characterization coverage for findOrCreateGoogleUser.ts
// and findOrCreateAppleUser.ts — two byte-identical helpers that had no test at
// all, because both route suites mocked them wholesale. It pinned what they did
// INCLUDING the bug in the last case, deliberately, so that the two-phase
// signup refactor would have a net and would have to change these assertions on
// purpose rather than by accident.
//
// That refactor has now landed, and this file changed with it. What the module
// under test does is narrower than before: it RESOLVES an identity and no
// longer creates anything. The three cases that asserted the shape of the
// account it minted are gone, because there is no longer a create here to
// describe — creation moved to POST /api/v1/auth/social/complete and is covered
// end-to-end, against real rows, in social-signup-completion.test.ts.
//
// 🔴 The last case is the one to read. It used to assert an unhandled P2002 —
// a bare 500 for the most ordinary new client there is. It now asserts that the
// same setup resolves cleanly to NEEDS_SIGNUP and writes nothing; the
// completion suite is where the pro's unclaimed profile is proved to be adopted
// rather than collided with.
//
// Prisma is real. Nothing is mocked but the PII keyring (supplied by
// scripts/with-test-db.mjs) and the env the module graph reads at load.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  PrismaClient,
  Role,
  ClientClaimStatus,
  VerificationStatus,
  type SocialAuthProvider,
} from '@prisma/client'

vi.hoisted(() => {
  // lib/auth reads JWT_SECRET at module load, and ESM imports are hoisted above
  // plain statements — so this has to run in vi.hoisted(), not at file scope,
  // or resolveSocialAccount's import chain throws before any test collects.
  //
  // The PII keyring is deliberately NOT set here: scripts/with-test-db.mjs
  // already exports a complete one (email/phone/address/notes AEAD + lookup
  // HMAC), and overriding it with a partial set is what makes the register
  // suite log "encryptedEmailInput failed; storing null envelope" every run.
  process.env.JWT_SECRET ||= 'integration-test-jwt-secret'
  process.env.TOVIS_TOS_VERSION ||= '2026-04'
})

import {
  resolveSocialAccount,
  type ResolvedSocialAccount,
} from '@/lib/auth/resolveSocialAccount'
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

type ProviderCase = {
  label: 'google' | 'apple'
  provider: SocialAuthProvider
  /** The @unique User column this provider's subject is stored in. */
  idColumn: 'googleUserId' | 'appleUserId'
}

/**
 * One table, two providers. The helper is now literally one function taking a
 * `provider` — the two byte-identical copies it replaced are gone — so this
 * table proves the parameterization picks the right COLUMN for each, which is
 * the only thing that can now differ between them.
 */
const PROVIDERS: ProviderCase[] = [
  { label: 'google', provider: 'GOOGLE', idColumn: 'googleUserId' },
  { label: 'apple', provider: 'APPLE', idColumn: 'appleUserId' },
]

// A plain loop rather than describe.each: every email and provider subject is
// already unique per test, so no per-test teardown is needed (and a per-test
// teardown would ORPHAN profiles — see cleanup()). The loop also keeps the
// suite titles readable, which describe.each's $label does not.
for (const { label, provider, idColumn } of PROVIDERS) {
  const resolve = (input: {
    subject: string
    email: string
  }): Promise<ResolvedSocialAccount> =>
    resolveSocialAccount({ provider, ...input })

  describe(`resolveSocialAccount — ${label} (integration)`, () => {
    it('reports NEEDS_SIGNUP for an unknown identity and writes NOTHING', async () => {
      const email = nextEmail(`${label}_new`)
      const subject = nextSubject(`${label}-new`)

      const result = await resolve({ subject, email })

      expect(result.outcome).toBe('NEEDS_SIGNUP')

      // 🔴 The whole point of the refactor, asserted as an absence. This used
      // to mint a User + ClientProfile on the spot — hardcoded to CLIENT, with
      // no phone, no SMS consent, no location and no chance to adopt a claim
      // invite. An identity is not a signup; the caller now issues a ticket and
      // the account is created by the completion route with the rest of what a
      // signup owes.
      const users = await db.user.count({ where: { email } })
      expect(users).toBe(0)

      const byProvider = await db.user.count({ where: { [idColumn]: subject } })
      expect(byProvider).toBe(0)

      const hash = emailLookupHashV2(email)
      expect(hash).not.toBeNull()
      const profiles = await db.clientProfile.count({
        where: { emailHashV2: hash?.hash },
      })
      expect(profiles).toBe(0)
    })

    it('returns the already-linked account without creating a second user', async () => {
      const email = nextEmail(`${label}_repeat`)
      const subject = nextSubject(`${label}-repeat`)

      // An account already linked to this subject. Created directly rather
      // than through the resolver, which no longer creates anything.
      const linked = await db.user.create({
        data: {
          email,
          password: 'existing-password-hash',
          role: Role.CLIENT,
          emailVerifiedAt: new Date(),
          [idColumn]: subject,
          clientProfile: {
            create: { homeTenantId: tenantId, firstName: 'Ada', lastName: 'Lovelace' },
          },
        },
        select: { id: true },
      })

      const first = await resolve({ subject, email })
      expect(first.outcome).toBe('SIGNED_IN')
      if (first.outcome !== 'SIGNED_IN') return
      expect(first.user.id).toBe(linked.id)

      const second = await resolve({
        subject,
        // A different email on the same subject must not fork an account: the
        // provider id is the identity, looked up first.
        email: nextEmail(`${label}_repeat_other`),
      })

      expect(second.outcome).toBe('SIGNED_IN')
      if (second.outcome !== 'SIGNED_IN') return
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
      const result = await resolve({ subject, email })

      expect(result.outcome).toBe('SIGNED_IN')
      if (result.outcome !== 'SIGNED_IN') return
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

      const result = await resolve({ subject: nextSubject(`${label}-squat`), email })

      expect(result.outcome).toBe('ACCOUNT_EXISTS_UNVERIFIED')

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
    // 🔴 THE BUG THAT WAS. This case asserted an unhandled P2002 — a bare 500
    // for the single most common way a client first appears in Tovis. It is
    // rewritten here, in the commit that fixes it, and the rewrite is the
    // point: if this had still passed unchanged, the bug would still be there.
    //
    // The fix is not a caught exception. It is that nothing at THIS layer
    // writes any more, so there is no longer a colliding insert to fail. What
    // happens to the pro's unclaimed profile afterwards — adoption, or a claim
    // link and a refusal — belongs to the completion route, and is proved
    // against rows in social-signup-completion.test.ts.
    // ───────────────────────────────────────────────────────────────────────
    it('resolves to NEEDS_SIGNUP — not P2002 — when a pro already created an UNCLAIMED profile for that email', async () => {
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

      // Step 2 still misses — an unclaimed profile has no User to find by email
      // hash — but the fall-through is now a report, not an insert.
      const result = await resolve({
        subject: nextSubject(`${label}-unclaimed`),
        email,
      })

      expect(result.outcome).toBe('NEEDS_SIGNUP')

      // No account, half-created or otherwise.
      const users = await db.user.count({ where: { email } })
      expect(users).toBe(0)

      // The pro's unclaimed profile is untouched, still waiting to be adopted.
      const profile = await db.clientProfile.findFirst({
        where: { email },
        select: { userId: true, claimStatus: true },
      })
      expect(profile?.userId).toBeNull()
      expect(profile?.claimStatus).toBe(ClientClaimStatus.UNCLAIMED)

      // And exactly one profile holds that email hash — the pro's. The old
      // behavior tried to insert a second and is what raised P2002.
      const hash = emailLookupHashV2(email)
      expect(hash).not.toBeNull()
      const profiles = await db.clientProfile.count({
        where: { emailHashV2: hash?.hash },
      })
      expect(profiles).toBe(1)
    })
  })
}
