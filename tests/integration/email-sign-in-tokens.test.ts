// tests/integration/email-sign-in-tokens.test.ts
//
// Real-Postgres coverage for the passwordless email sign-in token lifecycle
// (OPEN-WORK item 58, lib/auth/emailSignIn.ts).
//   node scripts/with-test-db.mjs npx vitest run \
//     tests/integration/email-sign-in-tokens.test.ts \
//     --config vitest.integration.config.mts
//
// ── Why this has to be an integration test ─────────────────────────────────
//
// Every security property this feature claims is a property of the DATABASE,
// not of the TypeScript around it:
//
//   * "single-use, atomically" is a conditional UPDATE whose WHERE clause is
//     evaluated by Postgres under a row lock. A mocked Prisma returns whatever
//     count the test author decided it returns, so a mock can prove the code
//     CALLS updateMany — it can never prove that two concurrent redemptions
//     produce exactly one winner. That is the whole claim, so it is tested by
//     actually racing them.
//   * "expired" and "already used" are enforced by that same predicate, not by
//     the `if` statements above it.
//   * the per-row attempts cap is an atomic increment.
//   * the new `EMAIL_SIGN_IN` enum value has to exist in the database type.
//
// ── What is NOT exercised here, deliberately ──────────────────────────────
//
// `sendEmailSignInEmail` / `issueAndSendEmailSignIn` are never called. This
// suite runs with the developer's real `.env.test.local`, which carries a REAL
// Postmark server token — a test that reached the send path would mail actual
// people. The token lifecycle is the subject; delivery is not.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AuthVerificationPurpose, PrismaClient, Role } from '@prisma/client'

const {
  EMAIL_SIGN_IN_MAX_CODE_ATTEMPTS,
  burnOutstandingEmailSignInTokens,
  consumeEmailSignInCode,
  consumeEmailSignInLinkToken,
  createEmailSignInToken,
  generateEmailSignInCode,
} = await import('@/lib/auth/emailSignIn')

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL. Run with the test DB harness.')
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

const TAG = `esi_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

let emailCounter = 0
const nextEmail = () => `${TAG}_${(emailCounter += 1)}@example.com`

const createdUserIds: string[] = []

async function makeUser(): Promise<{ id: string; email: string }> {
  const email = nextEmail()
  const user = await db.user.create({
    data: { email, role: Role.CLIENT },
    select: { id: true, email: true },
  })
  createdUserIds.push(user.id)
  return user
}

beforeAll(async () => {
  await db.$connect()
})

afterAll(async () => {
  // Scoped teardown: delete only the rows THIS run created, by id. Never a
  // deleteMany on a shared column — a broad predicate in a probe is how a
  // sibling run's data disappears.
  if (createdUserIds.length > 0) {
    await db.emailVerificationToken.deleteMany({
      where: { userId: { in: createdUserIds } },
    })
    await db.user.deleteMany({ where: { id: { in: createdUserIds } } })
  }
  await db.$disconnect()
})

describe('email sign-in token lifecycle (real Postgres)', () => {
  it('stores the new EMAIL_SIGN_IN purpose and a code hash, and never the raw credentials', async () => {
    const user = await makeUser()
    const issued = await createEmailSignInToken({
      userId: user.id,
      email: user.email,
    })

    const row = await db.emailVerificationToken.findUniqueOrThrow({
      where: { id: issued.id },
      select: {
        purpose: true,
        tokenHash: true,
        codeHash: true,
        email: true,
        usedAt: true,
        attempts: true,
      },
    })

    expect(row.purpose).toBe(AuthVerificationPurpose.EMAIL_SIGN_IN)
    expect(row.usedAt).toBeNull()
    expect(row.attempts).toBe(0)
    expect(row.codeHash).toBeTruthy()

    // The credentials that went in the email must not be recoverable from the
    // row. Both are stored only as hashes.
    expect(issued.token).toContain('.')
    expect(row.tokenHash).not.toContain(issued.token)
    expect(row.codeHash).not.toContain(issued.code)
    expect(JSON.stringify(row)).not.toContain(issued.code)
  })

  it('mints a 6-digit code', async () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateEmailSignInCode()).toMatch(/^\d{6}$/)
    }
  })

  it('redeems a link token once, and refuses the second attempt', async () => {
    const user = await makeUser()
    const issued = await createEmailSignInToken({
      userId: user.id,
      email: user.email,
    })

    const first = await consumeEmailSignInLinkToken({ rawToken: issued.token })
    expect(first).toEqual({
      ok: true,
      tokenId: issued.id,
      userId: user.id,
    })

    const second = await consumeEmailSignInLinkToken({ rawToken: issued.token })
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.reason).toBe('already_used')
  })

  it('redeems the 6-digit code from the SAME row the link would have used', async () => {
    const user = await makeUser()
    const issued = await createEmailSignInToken({
      userId: user.id,
      email: user.email,
    })

    const byCode = await consumeEmailSignInCode({
      email: user.email,
      code: issued.code,
    })
    expect(byCode).toEqual({ ok: true, tokenId: issued.id, userId: user.id })

    // One email, one credential-pair, one redemption: burning it by code must
    // also kill the link that arrived in the same message.
    const byLink = await consumeEmailSignInLinkToken({ rawToken: issued.token })
    expect(byLink.ok).toBe(false)
    if (!byLink.ok) expect(byLink.reason).toBe('already_used')
  })

  it('lets exactly ONE of two concurrent redemptions win', async () => {
    const user = await makeUser()
    const issued = await createEmailSignInToken({
      userId: user.id,
      email: user.email,
    })

    // The headline claim. Racing these is the only way to prove the conditional
    // update — not the `if` above it — is what makes the token single-use.
    const results = await Promise.all([
      consumeEmailSignInLinkToken({ rawToken: issued.token }),
      consumeEmailSignInLinkToken({ rawToken: issued.token }),
    ])

    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.filter((r) => !r.ok)).toHaveLength(1)
  })

  it('refuses an expired token, and does NOT mark it used', async () => {
    const user = await makeUser()
    const issued = await createEmailSignInToken({
      userId: user.id,
      email: user.email,
    })

    await db.emailVerificationToken.update({
      where: { id: issued.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })

    const result = await consumeEmailSignInLinkToken({ rawToken: issued.token })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('expired')

    const row = await db.emailVerificationToken.findUniqueOrThrow({
      where: { id: issued.id },
      select: { usedAt: true },
    })
    expect(row.usedAt).toBeNull()
  })

  it('refuses a wrong secret WITHOUT burning the live token', async () => {
    const user = await makeUser()
    const issued = await createEmailSignInToken({
      userId: user.id,
      email: user.email,
    })

    const [tokenId] = issued.token.split('.')
    const forged = `${tokenId}.${'0'.repeat(64)}`

    const bad = await consumeEmailSignInLinkToken({ rawToken: forged })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.reason).toBe('secret_mismatch')

    // A wrong guess must not be a denial of service against the real owner.
    const good = await consumeEmailSignInLinkToken({ rawToken: issued.token })
    expect(good.ok).toBe(true)
  })

  it('refuses an EMAIL_VERIFY token presented to the sign-in path', async () => {
    const user = await makeUser()
    const issued = await createEmailSignInToken({
      userId: user.id,
      email: user.email,
    })

    await db.emailVerificationToken.update({
      where: { id: issued.id },
      data: { purpose: AuthVerificationPurpose.EMAIL_VERIFY },
    })

    const result = await consumeEmailSignInLinkToken({ rawToken: issued.token })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('wrong_purpose')
  })

  it('counts wrong codes on the row and refuses past the cap', async () => {
    const user = await makeUser()
    const issued = await createEmailSignInToken({
      userId: user.id,
      email: user.email,
    })

    const wrongCode = issued.code === '000000' ? '111111' : '000000'

    for (let i = 0; i < EMAIL_SIGN_IN_MAX_CODE_ATTEMPTS; i += 1) {
      const r = await consumeEmailSignInCode({
        email: user.email,
        code: wrongCode,
      })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toBe('secret_mismatch')
    }

    const row = await db.emailVerificationToken.findUniqueOrThrow({
      where: { id: issued.id },
      select: { attempts: true },
    })
    expect(row.attempts).toBe(EMAIL_SIGN_IN_MAX_CODE_ATTEMPTS)

    // Past the cap the RIGHT code is refused too — otherwise the cap only
    // slows an attacker down rather than stopping them.
    const correctButCapped = await consumeEmailSignInCode({
      email: user.email,
      code: issued.code,
    })
    expect(correctButCapped.ok).toBe(false)
    if (!correctButCapped.ok) {
      expect(correctButCapped.reason).toBe('too_many_attempts')
    }
  })

  it('issuing again burns the previous token, so one live link exists per user', async () => {
    const user = await makeUser()
    const first = await createEmailSignInToken({
      userId: user.id,
      email: user.email,
    })
    const second = await createEmailSignInToken({
      userId: user.id,
      email: user.email,
    })

    const stale = await consumeEmailSignInLinkToken({ rawToken: first.token })
    expect(stale.ok).toBe(false)
    if (!stale.ok) expect(stale.reason).toBe('already_used')

    const fresh = await consumeEmailSignInLinkToken({ rawToken: second.token })
    expect(fresh.ok).toBe(true)

    const live = await db.emailVerificationToken.count({
      where: {
        userId: user.id,
        purpose: AuthVerificationPurpose.EMAIL_SIGN_IN,
        usedAt: null,
      },
    })
    expect(live).toBe(0)
  })

  it('burns every outstanding sign-in token — what a password reset calls', async () => {
    const user = await makeUser()
    const issued = await createEmailSignInToken({
      userId: user.id,
      email: user.email,
    })

    const burned = await burnOutstandingEmailSignInTokens({ userId: user.id })
    expect(burned).toBe(1)

    // Tori's decision 2: a reset must kill the link already sitting in the
    // inbox. Both credentials from that email have to be dead, not just one.
    const byLink = await consumeEmailSignInLinkToken({ rawToken: issued.token })
    expect(byLink.ok).toBe(false)

    const byCode = await consumeEmailSignInCode({
      email: user.email,
      code: issued.code,
    })
    expect(byCode.ok).toBe(false)
  })

  it('does not touch another user’s tokens when burning', async () => {
    const victim = await makeUser()
    const bystander = await makeUser()

    const bystanderToken = await createEmailSignInToken({
      userId: bystander.id,
      email: bystander.email,
    })
    await createEmailSignInToken({ userId: victim.id, email: victim.email })

    await burnOutstandingEmailSignInTokens({ userId: victim.id })

    const stillGood = await consumeEmailSignInLinkToken({
      rawToken: bystanderToken.token,
    })
    expect(stillGood.ok).toBe(true)
  })

  it('refuses a malformed token and an unknown row without throwing', async () => {
    for (const rawToken of [null, undefined, '', 'nonsense', 'a.b']) {
      const result = await consumeEmailSignInLinkToken({ rawToken })
      expect(result.ok).toBe(false)
    }

    const unknown = await consumeEmailSignInCode({
      email: `${TAG}_never_existed@example.com`,
      code: '123456',
    })
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) expect(unknown.reason).toBe('not_found')
  })
})
