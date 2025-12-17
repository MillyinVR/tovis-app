import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is not set in environment variables')
}

type Role = 'CLIENT' | 'PRO' | 'ADMIN'

type JwtPayload = {
  userId: string
  role: Role
}


export async function hashPassword(password: string): Promise<string> {
  const saltRounds = 10
  return bcrypt.hash(password, saltRounds)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

export function createToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET!, {
    expiresIn: '7d',
  })
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET!) as JwtPayload
  } catch {
    return null
  }
}
