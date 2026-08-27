// scripts/publish-consult-agreement-versions.ts
//
// Publishes the canonical consult legal-agreement versions to the database the
// current environment points at. Publication is operational (agreement wording
// is never seeded by migrations); this script makes it reproducible and
// idempotent: for each kind, if the latest published body/title already equals
// the canonical text below, nothing is written — otherwise the next version
// number is inserted, which makes every client re-accept before continuing.
//
// Run with the target environment's DATABASE_URL:
//   npx tsx scripts/publish-consult-agreement-versions.ts          # dry run
//   npx tsx scripts/publish-consult-agreement-versions.ts --write  # publish
//
// 2026-08-26 (full-analysis launch): SENSITIVE_DATA_CONSENT v2 covers the face
// views the full analysis adds and the default-on but optional chart copy.

import { loadEnvConfig } from '@next/env'

loadEnvConfig(process.cwd(), true)

import { ConsultAgreementKind, PrismaClient } from '@prisma/client'

const CANONICAL_AGREEMENTS: ReadonlyArray<{
  kind: ConsultAgreementKind
  title: string
  body: string
}> = [
  {
    kind: ConsultAgreementKind.SENSITIVE_DATA_CONSENT,
    title: 'Photo & analysis consent',
    body: [
      'This consult asks for photos of your hair (back, left, right, crown) and your face (front, profile, and a close-up of your eyes and brows), plus your questionnaire answers.',
      'Your photos and answers are analyzed by an AI service to prepare styling observations and directions — covering hair color, cut, bangs, brows, lashes, makeup, and your color palette — for you and your booked professional to discuss. They are processed only to run your consult and are not used to train the AI.',
      'The raw photos are temporary: after your analysis completes, they are deleted from processing storage, and the deletion is verified.',
      'Separately, you can choose to keep a copy of these photos on your chart with your professional, so future appointments can refer back to them. This choice is on by default, it is visible and optional during the photo step, and you can turn it off any time before the analysis runs. Chart photos are private to you and your professional and can be deleted on request.',
      'The written results of your consult (your answers, the observations, and the directions) are kept so you and your professional can use them.',
      'You can revoke this consent at any time; revoking stops any further collection and analysis.',
    ].join('\n\n'),
  },
  {
    kind: ConsultAgreementKind.ADULT_18_PLUS_ATTESTATION,
    title: 'Age confirmation',
    body: 'I confirm that I am 18 years of age or older. This consult is only available to adults.',
  },
]

async function main(): Promise<void> {
  const write = process.argv.includes('--write')
  const prisma = new PrismaClient()
  try {
    for (const agreement of CANONICAL_AGREEMENTS) {
      const latest = await prisma.consultAgreementVersion.findFirst({
        where: {
          kind: agreement.kind,
          publishedAt: { lte: new Date() },
        },
        orderBy: { version: 'desc' },
        select: { version: true, title: true, body: true },
      })
      if (
        latest &&
        latest.title === agreement.title &&
        latest.body === agreement.body
      ) {
        console.log(`${agreement.kind}: up to date (v${latest.version}).`)
        continue
      }
      const nextVersion = (latest?.version ?? 0) + 1
      if (!write) {
        console.log(
          `${agreement.kind}: would publish v${nextVersion} (dry run — pass --write).`,
        )
        continue
      }
      await prisma.consultAgreementVersion.create({
        data: {
          kind: agreement.kind,
          version: nextVersion,
          title: agreement.title,
          body: agreement.body,
          publishedAt: new Date(),
        },
      })
      console.log(`${agreement.kind}: published v${nextVersion}.`)
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error('Publish failed:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
