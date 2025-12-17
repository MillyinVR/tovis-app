import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

export async function POST(_req: Request, { params }: Ctx) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: professionalId } = await Promise.resolve(params)

  await prisma.professionalFavorite.upsert({
    where: {
      professionalId_userId: { professionalId, userId: user.id },
    },
    create: { professionalId, userId: user.id },
    update: {},
  })

  const count = await prisma.professionalFavorite.count({ where: { professionalId } })
  return NextResponse.json({ favorited: true, count })
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: professionalId } = await Promise.resolve(params)

  await prisma.professionalFavorite.deleteMany({
    where: { professionalId, userId: user.id },
  })

  const count = await prisma.professionalFavorite.count({ where: { professionalId } })
  return NextResponse.json({ favorited: false, count })
}
