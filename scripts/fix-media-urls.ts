import { prisma } from '@/lib/prisma'

async function main() {
  const bad = await prisma.mediaAsset.findMany({
    where: {
      OR: [
        { url: { startsWith: 'supabase://' } },
        { thumbUrl: { startsWith: 'supabase://' } },
      ],
    },
    select: { id: true, url: true, thumbUrl: true, storageBucket: true, storagePath: true },
    take: 5000,
  })

  console.log(`Found ${bad.length} media rows with supabase:// urls`)

  // 1) Clear url
  const clearUrl = await prisma.mediaAsset.updateMany({
    where: { url: { startsWith: 'supabase://' } },
    data: { url: null },
  })

  // 2) Clear thumbUrl
  const clearThumb = await prisma.mediaAsset.updateMany({
    where: { thumbUrl: { startsWith: 'supabase://' } },
    data: { thumbUrl: null },
  })

  console.log(`Cleared url on ${clearUrl.count} rows`)
  console.log(`Cleared thumbUrl on ${clearThumb.count} rows`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })