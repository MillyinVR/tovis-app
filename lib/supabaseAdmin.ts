// lib/supabaseAdmin.ts
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is required')
if (!key) throw new Error('SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) is required')

export const supabaseAdmin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
})
