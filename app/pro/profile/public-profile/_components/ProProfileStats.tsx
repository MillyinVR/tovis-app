// app/pro/profile/public-profile/_components/ProProfileStats.tsx
import Link from 'next/link'

import type { ProProfileManagementStat } from '../_data/proProfileManagementTypes'

type ProProfileStatsProps = {
  stats: ProProfileManagementStat[]
}

export default function ProProfileStats({ stats }: ProProfileStatsProps) {
  return (
    <section
      className="brand-pro-profile-stat-grid"
      aria-label="Professional profile stats"
    >
      {stats.map((stat) => (
        <ProProfileStat key={stat.key} stat={stat} />
      ))}
    </section>
  )
}

/**
 * A tile with an `href` is a link to the surface that explains the number —
 * today only Looks, which opens the pro's creator analytics. That link replaced
 * a "Your Looks performance" row in the account list below, and it is now the
 * only navigation into `/pro/dashboard` anywhere in the product, so it must
 * stay a link even as the tile styling changes.
 */
function ProProfileStat({ stat }: { stat: ProProfileManagementStat }) {
  const body = (
    <>
      <div className="brand-pro-profile-stat-value">{stat.value}</div>
      <div className="brand-pro-profile-stat-label">{stat.label}</div>
    </>
  )

  if (!stat.href) {
    return <div className="brand-pro-profile-stat">{body}</div>
  }

  return (
    <Link
      href={stat.href}
      className="brand-pro-profile-stat brand-focus"
      aria-label={`${stat.label}: ${stat.value} — see how they are performing`}
    >
      {body}
    </Link>
  )
}
