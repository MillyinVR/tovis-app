import { redirect } from 'next/navigation'

import { PRO_PUBLIC_PROFILE_PATH } from '@/lib/routes'

export default function ProProfilePage() {
  redirect(PRO_PUBLIC_PROFILE_PATH)
}