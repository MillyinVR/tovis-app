// lib/twilio/client.ts

import 'server-only'

import twilio from 'twilio'

type TwilioClient = ReturnType<typeof twilio>

let cachedClient: TwilioClient | null = null

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`Missing ${name}`)
  }
  return value
}

export function getTwilioClient(): TwilioClient {
  if (cachedClient) return cachedClient

  cachedClient = twilio(
    requiredEnv('TWILIO_ACCOUNT_SID'),
    requiredEnv('TWILIO_AUTH_TOKEN'),
  )

  return cachedClient
}

export function getTwilioVerifyServiceSid(): string {
  return requiredEnv('TWILIO_VERIFY_SERVICE_SID')
}

export function getTwilioAuthToken(): string {
  return requiredEnv('TWILIO_AUTH_TOKEN')
}