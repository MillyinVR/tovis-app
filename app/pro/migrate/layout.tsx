// app/pro/migrate/layout.tsx
//
// Gates the whole migration flow behind the ENABLE_PRO_MIGRATION flag while it's
// still being built. Off (prod default) → redirect away so nothing half-built is
// reachable, even by direct URL.

import { redirect } from 'next/navigation'

import { isProMigrationEnabled } from '@/lib/migration/featureFlag'

export default function ProMigrateLayout({
  children,
}: {
  children: React.ReactNode
}) {
  if (!isProMigrationEnabled()) {
    redirect('/pro/dashboard')
  }
  return <>{children}</>
}
