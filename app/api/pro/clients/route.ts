import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import crypto from 'crypto'

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()

    if (!user || user.role !== 'PRO' || !user.professionalProfile) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
    }

    const db: any = prisma
    const body = await request.json()

    const { firstName, lastName, email, phone } = body as {
      firstName?: string
      lastName?: string
      email?: string
      phone?: string | null
    }

    if (!firstName || !lastName || !email) {
      return NextResponse.json(
        { error: 'First name, last name, and email are required.' },
        { status: 400 },
      )
    }

    const normalizedEmail = String(email).toLowerCase().trim()

    // Check if user already exists
    let clientUser = await db.user.findUnique({
      where: { email: normalizedEmail },
    })

    if (clientUser && clientUser.role !== 'CLIENT') {
      return NextResponse.json(
        { error: 'This email is already used by a non-client account.' },
        { status: 400 },
      )
    }

    if (!clientUser) {
      // Create a "shadow" client user with random password
      const randomPassword = crypto.randomBytes(16).toString('hex')

      clientUser = await db.user.create({
        data: {
          email: normalizedEmail,
          password: randomPassword, // later we can migrate them to real login / reset
          role: 'CLIENT',
        },
      })
    }

    // Check if they already have a client profile
    let clientProfile = await db.clientProfile.findUnique({
      where: { userId: clientUser.id },
    })

    if (!clientProfile) {
      clientProfile = await db.clientProfile.create({
  data: {
    userId: clientUser.id,
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    phone: phone ? String(phone).trim() : null,
  },
})

    } else {
      // Update profile + ensure it's linked to this pro
      clientProfile = await db.clientProfile.update({
  where: { id: clientProfile.id },
  data: {
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    phone: phone ? String(phone).trim() : null,
  },
})

    }

    return NextResponse.json(
      {
        id: clientProfile.id,
        userId: clientUser.id,
        email: clientUser.email,
      },
      { status: 201 },
    )
  } catch (error) {
    console.error('Create client error', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
