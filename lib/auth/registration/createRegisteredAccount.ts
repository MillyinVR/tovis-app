// lib/auth/registration/createRegisteredAccount.ts
//
// The one transaction that turns a validated signup into an account: the User,
// its ClientProfile or ProfessionalProfile, the claim-invite adoption, and the
// handle lock — committed together or not at all.
//
// Extracted verbatim from app/api/v1/auth/register/route.ts so a second entry
// point (social signup completion) can create an account that is byte-for-byte
// the same as a password signup, instead of the parallel, thinner creation that
// lib/auth/findOrCreate{Google,Apple}User.ts does today.
//
// This module owns the WRITE only. Everything upstream of it — body parsing,
// password policy, bot gate, rate limits, licence resolution, the self-serve
// claim refusal — stays with the caller, because each caller gates differently.

import { ContactMethod, Prisma, type Role } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import {
  buildClientProfileContactLookupData,
  buildUserContactLookupData,
} from '@/lib/security/contactLookup'
import { buildEmailEncryptionWriteData } from '@/lib/security/emailPrivacy'
import { buildPhoneEncryptionWriteData } from '@/lib/security/phonePrivacy'
import { adoptClaimInviteDuringRegistration } from '@/lib/clients/claimAdoption'
import {
  buildProfessionalProfileCreateData,
  claimHandle,
  type ResolvedProProfileSetup,
} from '@/lib/pro/proProfileSetup'
import type { SignupLocation } from './signupLocation'

const CREATED_USER_SELECT = {
  id: true,
  email: true, // pii-plaintext-read-ok: auth-response identity, parity with login
  role: true,
  phone: true, // pii-plaintext-read-ok: handed straight to the OTP send
  authVersion: true,
} satisfies Prisma.UserSelect

export type CreatedAccountUser = Prisma.UserGetPayload<{
  select: typeof CREATED_USER_SELECT
}>

export type CreateRegisteredAccountArgs = {
  /** Already normalized via normalizeEmail. */
  email: string
  /** Already normalized via normalizePhone; null only where a caller allows it. */
  phone: string | null
  /** Already hashed — this module never sees a plaintext password. */
  passwordHash: string
  role: Role
  firstName: string
  lastName: string
  /** The tenant whose domain served the signup; the profile's permanent home. */
  tenantId: string
  tosVersion: string
  /** Validated IANA zone; only read for a PRO's first location. */
  timeZone: string
  location: SignupLocation
  /** Resolved licence/handle/radius state for a PRO; null for a CLIENT. */
  proSetup: ResolvedProProfileSetup | null
  transactionalSmsConsent: {
    version: string
    /**
     * Where the consent was collected. The caller knows this and the write path
     * cannot infer it — a pro upgrading is not a pro signing up.
     */
    source: string
    ip: string | null
    userAgent: string | null
  }
  /**
   * Claim-link signup: adopt the pro's existing UNCLAIMED ClientProfile (with
   * its bookings, aftercare, addresses and contact) instead of minting a
   * duplicate that collides on the unique contact hashes and dead-ends with
   * ACCOUNT_EXISTS. When true the User is created with NO nested profile and
   * the profile is adopted-or-created explicitly.
   */
  attemptClaimAdopt: boolean
  claimInviteToken: string | null
  /** Channel proven by the claim link's marker, or null when it did not validate. */
  claimVerifiedChannel: ContactMethod | null
}

export type CreateRegisteredAccountResult = {
  user: CreatedAccountUser
  /**
   * The channel a claim click already proved, so the caller can skip that
   * channel's verification send entirely. Null unless a claim was adopted.
   */
  adoptionVerifiedChannel: ContactMethod | null
}

export async function createRegisteredAccount(
  args: CreateRegisteredAccountArgs,
): Promise<CreateRegisteredAccountResult> {
  const {
    email,
    phone,
    passwordHash,
    role,
    firstName,
    lastName,
    tenantId,
    tosVersion,
    timeZone,
    location,
    proSetup,
    transactionalSmsConsent,
    attemptClaimAdopt,
    claimInviteToken,
    claimVerifiedChannel,
  } = args

  const clientProfileCreateData = {
    homeTenantId: tenantId,
    firstName,
    lastName,
    phone,
    ...buildClientProfileContactLookupData({ email, phone }),
    ...buildEmailEncryptionWriteData({ email }),
    ...buildPhoneEncryptionWriteData({ phone }),
    phoneVerifiedAt: null,
  } satisfies Prisma.ClientProfileUncheckedCreateWithoutUserInput

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        phone,
        ...buildUserContactLookupData({ email, phone }),
        ...buildEmailEncryptionWriteData({ email }),
        ...buildPhoneEncryptionWriteData({ phone }),
        phoneVerifiedAt: null,
        emailVerifiedAt: null,
        password: passwordHash,
        role,
        tosAcceptedAt: new Date(),
        tosVersion,
        transactionalSmsConsentAt: new Date(),
        transactionalSmsConsentVersion: transactionalSmsConsent.version,
        transactionalSmsConsentSource: transactionalSmsConsent.source,
        transactionalSmsConsentIp: transactionalSmsConsent.ip,
        transactionalSmsConsentUserAgent: transactionalSmsConsent.userAgent,

        clientProfile:
          role === 'CLIENT' && !attemptClaimAdopt
            ? { create: clientProfileCreateData }
            : undefined,

        professionalProfile:
          role === 'PRO' && proSetup && location.kind !== 'CLIENT_ZIP'
            ? {
                create: buildProfessionalProfileCreateData({
                  resolved: proSetup,
                  identity: { firstName, lastName, phone },
                  tenantId,
                  timeZone,
                  location,
                }),
              }
            : undefined,
      },
      select: CREATED_USER_SELECT,
    })

    let adoptionVerifiedChannel: ContactMethod | null = null

    if (role === 'CLIENT' && attemptClaimAdopt) {
      const adoption = await adoptClaimInviteDuringRegistration({
        tx,
        token: claimInviteToken,
        userId: user.id,
        registeredEmail: email,
        registeredPhone: phone,
        verifiedChannel: claimVerifiedChannel,
        now: new Date(),
      })

      // Contact mismatch / invalid / already-claimed invite: fall back to a
      // fresh profile so signup still succeeds (degrades to today's behavior).
      if (!adoption.adopted) {
        await tx.clientProfile.create({
          data: { userId: user.id, ...clientProfileCreateData },
        })
      } else {
        adoptionVerifiedChannel = adoption.verifiedChannelApplied
      }
    }

    // Lock the handle in the same transaction that creates the profile
    // holding it. The pre-check upstream is advisory; this is what actually
    // refuses a handle a client (or another pro) took in the meantime, and it
    // rolls the whole signup back rather than half-creating an account.
    if (role === 'PRO' && proSetup?.normalizedHandle) {
      const created = await tx.professionalProfile.findUniqueOrThrow({
        where: { userId: user.id },
        select: { id: true },
      })
      await claimHandle(tx, proSetup.normalizedHandle, {
        kind: 'PRO',
        professionalId: created.id,
      })
    }

    return { user, adoptionVerifiedChannel }
  })
}
