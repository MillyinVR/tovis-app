// app/pro/profile/public-profile/_components/ProProfileActions.tsx
import Link from 'next/link'

import type { ProProfileManagementRoutes } from '../_data/proProfileManagementTypes'

type ProProfileActionsProps = {
  routes: ProProfileManagementRoutes
}

export default function ProProfileActions({ routes }: ProProfileActionsProps) {
  return (
    <section
      className="brand-pro-profile-quick-actions"
      aria-label="Professional profile quick actions"
    >
      <Link
        href={`${routes.proPublicProfile}?tab=services&add=1`}
        className="brand-pro-profile-quick-action brand-focus"
        data-tone="accent"
      >
        + Add services
      </Link>

      <Link
        href={routes.messages}
        className="brand-pro-profile-quick-action brand-focus"
      >
        Messages
      </Link>

      <Link
        href={routes.proMediaNew}
        className="brand-pro-profile-quick-action brand-focus"
        data-align="end"
      >
        + Upload
      </Link>
    </section>
  )
}