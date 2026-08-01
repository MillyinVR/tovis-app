#!/usr/bin/env node
// scripts/w8-thread-merge.mjs
//
// W8 phase 2 — merge the pro↔client threads that ALREADY forked.
//
// Phase 1 (shipped in `lib/messagesResolve.ts`) stopped the bleeding: no pair
// gains a second thread from here on. This cleans up the ones that exist.
//
// 🔴🔴 IRREVERSIBLE, AND IT REWRITES LIVE CONVERSATIONS. There is no undo. Read
// the dry run, have Tori approve the counts, take a database snapshot, and only
// then pass --apply.
//
//   node scripts/w8-thread-merge.mjs           # dry run (default)
//   node scripts/w8-thread-merge.mjs --apply   # rewrites data
//
// WHAT A MERGE DOES, per (clientId, professionalId) pair with >1 thread:
//
//   survivor = the OLDEST thread — "the message thread the client already
//              started with the pro", which is what the report asks us to
//              continue.
//
//   1. Re-parent every Message from the losers onto the survivor. Ordering is
//      by the message's own createdAt, so the merged conversation reads
//      chronologically whichever thread each message came from.
//   2. Union the participants. A participant present on a loser but not the
//      survivor is inserted.
//   3. lastReadAt per participant takes the EARLIEST of their rows. Taking the
//      latest would silently mark messages read that the user never saw — the
//      one outcome a merge must not produce.
//   4. Recompute lastMessageAt / lastMessagePreview from the survivor's newest
//      message after re-parenting.
//   5. Re-point Quotes at the survivor.
//   6. Delete the emptied loser threads.
//
// ⚠️ KNOWN CONSTRAINT, and why this is not simply "run it":
//
// `MessageThread.bookingId` and `.waitlistEntryId` are `@unique`. A survivor can
// hold at most ONE of each, so merging a pair that has (say) two BOOKING threads
// means the second booking's pointer CANNOT move to the survivor and is dropped.
// Those pointers feed the inbox eyebrow and the thread-page context nav, so the
// merged thread will show the survivor's context, not both. That is the intended
// end state of "one thread per pair" — but it is a real, visible loss of the
// per-context deep link, and it is listed here rather than discovered later.
//
// The dry run reports exactly how many pointers would be dropped, per kind.

import { PrismaClient } from '@prisma/client'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const urlArg = args.find((a) => a.startsWith('--url='))
const url = urlArg ? urlArg.slice('--url='.length) : process.env.DIRECT_URL

if (!url) {
  console.error('No database URL. Set DIRECT_URL or pass --url=postgresql://…')
  process.exit(1)
}

function hostOf(connectionString) {
  try {
    return new URL(connectionString).host
  } catch {
    return '(unparseable)'
  }
}

const prisma = new PrismaClient({ datasources: { db: { url } } })

async function main() {
  console.log(`\nW8 thread merge`)
  console.log(`  host : ${hostOf(url)}`)
  console.log(`  mode : ${APPLY ? '🔴 APPLY (IRREVERSIBLE)' : 'dry run (no writes)'}\n`)

  const pairs = await prisma.$queryRawUnsafe(`
    select "clientId", "professionalId", count(*)::int as thread_count
    from "MessageThread"
    group by 1, 2
    having count(*) > 1
    order by count(*) desc, "professionalId", "clientId"
  `)

  const totals = await prisma.$queryRawUnsafe(`
    select
      (select count(*)::int from "MessageThread") as threads,
      (select count(*)::int from "Message")       as messages,
      (select count(*)::int from (
        select distinct "clientId", "professionalId" from "MessageThread") x) as pairs
  `)

  const t = totals[0] ?? { threads: 0, messages: 0, pairs: 0 }
  const threadsInMultiPairs = pairs.reduce((sum, row) => sum + row.thread_count, 0)
  const threadsRemoved = threadsInMultiPairs - pairs.length

  console.log(`Corpus`)
  console.log(`  threads total       : ${t.threads}`)
  console.log(`  messages total      : ${t.messages}`)
  console.log(`  distinct pairs      : ${t.pairs}`)
  console.log(`\nMerge`)
  console.log(`  pairs with >1 thread: ${pairs.length}`)
  console.log(`  threads involved    : ${threadsInMultiPairs}`)
  console.log(`  threads DELETED     : ${threadsRemoved}`)
  console.log(`  threads after       : ${t.threads - threadsRemoved}`)

  if (pairs.length > 0) {
    console.log(`\n  Worst pairs:`)
    for (const row of pairs.slice(0, 15)) {
      console.log(
        `    ${row.thread_count} threads  pro=${row.professionalId}  client=${row.clientId}`,
      )
    }
    if (pairs.length > 15) console.log(`    …and ${pairs.length - 15} more`)
  }

  // How many context pointers cannot survive the unique constraints.
  const droppable = await prisma.$queryRawUnsafe(`
    with ranked as (
      select
        id,
        "clientId",
        "professionalId",
        "bookingId",
        "waitlistEntryId",
        row_number() over (
          partition by "clientId", "professionalId" order by "createdAt" asc, id asc
        ) as rn
      from "MessageThread"
      where ("clientId", "professionalId") in (
        select "clientId", "professionalId" from "MessageThread"
        group by 1, 2 having count(*) > 1
      )
    )
    select
      count(*) filter (where rn > 1 and "bookingId" is not null)::int       as booking_pointers_dropped,
      count(*) filter (where rn > 1 and "waitlistEntryId" is not null)::int as waitlist_pointers_dropped
    from ranked
  `)

  const d = droppable[0] ?? {
    booking_pointers_dropped: 0,
    waitlist_pointers_dropped: 0,
  }

  console.log(`\n  ⚠️ Context pointers that CANNOT move to the survivor`)
  console.log(`     (bookingId / waitlistEntryId are @unique on MessageThread):`)
  console.log(`       bookingId dropped      : ${d.booking_pointers_dropped}`)
  console.log(`       waitlistEntryId dropped: ${d.waitlist_pointers_dropped}`)
  console.log(
    `     Those threads lose their per-context deep link. The conversation and\n` +
      `     every message survive; only the inbox eyebrow / context nav changes.`,
  )

  if (!APPLY) {
    console.log(`\nDry run — nothing written.`)
    console.log(`Have Tori approve these counts and take a snapshot before --apply.\n`)
    return
  }

  if (pairs.length === 0) {
    console.log(`\nNothing to merge.\n`)
    return
  }

  let mergedPairs = 0
  let movedMessages = 0
  let deletedThreads = 0

  for (const pair of pairs) {
    // One transaction PER PAIR. A failure isolates to that pair instead of
    // poisoning the whole run, and a caught error inside one shared transaction
    // would abort every merge after it (25P02).
    const result = await prisma.$transaction(async (tx) => {
      const threads = await tx.messageThread.findMany({
        where: { clientId: pair.clientId, professionalId: pair.professionalId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true },
      })

      if (threads.length < 2) return { moved: 0, deleted: 0 }

      const survivor = threads[0]
      const loserIds = threads.slice(1).map((thread) => thread.id)

      const moved = await tx.message.updateMany({
        where: { threadId: { in: loserIds } },
        data: { threadId: survivor.id },
      })

      await tx.quote.updateMany({
        where: { threadId: { in: loserIds } },
        data: { threadId: survivor.id },
      })

      // Union participants, taking the EARLIEST lastReadAt per user. Later would
      // mark unseen messages read.
      const loserParticipants = await tx.messageThreadParticipant.findMany({
        where: { threadId: { in: loserIds } },
        select: { userId: true, role: true, lastReadAt: true },
      })

      for (const participant of loserParticipants) {
        const survivorRow = await tx.messageThreadParticipant.findUnique({
          where: {
            threadId_userId: { threadId: survivor.id, userId: participant.userId },
          },
          select: { id: true, lastReadAt: true },
        })

        if (!survivorRow) {
          await tx.messageThreadParticipant.create({
            data: {
              threadId: survivor.id,
              userId: participant.userId,
              role: participant.role,
              lastReadAt: participant.lastReadAt,
            },
          })
          continue
        }

        const earliest =
          survivorRow.lastReadAt == null || participant.lastReadAt == null
            ? null
            : survivorRow.lastReadAt < participant.lastReadAt
              ? survivorRow.lastReadAt
              : participant.lastReadAt

        await tx.messageThreadParticipant.update({
          where: { id: survivorRow.id },
          data: { lastReadAt: earliest },
        })
      }

      // Participants are ON DELETE CASCADE from the thread, so deleting the
      // losers cleans them up. Messages and quotes have already moved.
      const deleted = await tx.messageThread.deleteMany({
        where: { id: { in: loserIds } },
      })

      const newest = await tx.message.findFirst({
        where: { threadId: survivor.id },
        orderBy: { createdAt: 'desc' },
        select: { body: true, createdAt: true },
      })

      await tx.messageThread.update({
        where: { id: survivor.id },
        data: {
          lastMessageAt: newest?.createdAt ?? null,
          lastMessagePreview: newest?.body?.slice(0, 140) ?? null,
        },
      })

      return { moved: moved.count, deleted: deleted.count }
    })

    mergedPairs += 1
    movedMessages += result.moved
    deletedThreads += result.deleted
  }

  console.log(`\n✅ Applied.`)
  console.log(`   pairs merged     : ${mergedPairs}`)
  console.log(`   messages moved   : ${movedMessages}`)
  console.log(`   threads deleted  : ${deletedThreads}\n`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
