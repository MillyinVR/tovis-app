// app/pro/profile/public-profile/_components/ProProfileStats.tsx
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

function ProProfileStat({ stat }: { stat: ProProfileManagementStat }) {
  return (
    <div className="brand-pro-profile-stat">
      <div className="brand-pro-profile-stat-value">{stat.value}</div>
      <div className="brand-pro-profile-stat-label">{stat.label}</div>
    </div>
  )
}