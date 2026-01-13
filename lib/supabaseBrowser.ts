// lib/supabaseBrowser.ts
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY // fallback if you still reference this

if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is required')
if (!key) throw new Error('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required')

export const supabaseBrowser = createClient(url, key)
