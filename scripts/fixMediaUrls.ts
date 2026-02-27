import { prisma } from '@/lib/prisma'

function isBadSupabaseUrl(u: unknown) {
  return typeof u === 'string' && u.startsWith('supabase://')
}

async function main() {
  // Detect whether `url` is nullable at runtime by trying to write null in a safe way.
  // We can't introspect Prisma schema easily at runtime, so we do a conservative approach:
  // attempt an update on a single row in a transaction and roll back on failure.
  const sample = await prisma.mediaAsset.findFirst({
    where: { OR: [{ url: { startsWith: 'supabase://' } }, { thumbUrl: { startsWith: 'supabase://' } }] },
    select: { id: true },
  })

  const urlCanBeNull = await (async () => {
    if (!sample) return false
    try {
      await prisma.$transaction(async (tx) => {
        await tx.mediaAsset.update({
          where: { id: sample.id },
          data: { url: null as any }, // probe
        })
        // Throw to force rollback so we don't actually mutate anything in this probe
        throw new Error('__ROLLBACK_PROBE__')
      })
      return false
    } catch (e: any) {
      // If rollback probe triggered, null worked
      if (String(e?.message || '').includes('__ROLLBACK_PROBE__')) return true
      // If Prisma complained about null, then it is not nullable
      return false
    }
  })()

  const replacementForUrl = urlCanBeNull ? (null as any) : ''

  console.log('url nullable?', urlCanBeNull)
  console.log('fixing url ->', urlCanBeNull ? 'null' : "''")

  const bad = await prisma.mediaAsset.findMany({
    where: {
      OR: [{ url: { startsWith: 'supabase://' } }, { thumbUrl: { startsWith: 'supabase://' } }],
    },
    select: { id: true, url: true, thumbUrl: true },
    take: 10_000,
  })

  console.log('found bad rows:', bad.length)

  let fixed = 0

  // Batch updates (simple loop is fine here; you can optimize later)
  for (const row of bad) {
    const data: any = {}

    if (isBadSupabaseUrl(row.url)) data.url = replacementForUrl
    if (isBadSupabaseUrl(row.thumbUrl)) data.thumbUrl = null // thumbUrl is already nullable in your schema

    if (Object.keys(data).length === 0) continue

    await prisma.mediaAsset.update({
      where: { id: row.id },
      data,
    })

    fixed++
  }

  console.log('fixed rows:', fixed)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })