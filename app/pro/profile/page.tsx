// app/pro/profile/page.tsx
import { redirect } from 'next/navigation'

export default async function ProProfilePage() {
  redirect('/pro/public-profile')
}
