// app/professionals/[id]/ProfileStats.tsx
// app/professionals/[id]/ProfileStats.tsx
import type { PublicProfileStatsDto } from '@/lib/profiles/publicProfileMappers'

type ProfileStatsProps = {
  stats: PublicProfileStatsDto
}

type ProfileStatItem = {
  label: string
  value: string
}

export default function ProfileStats({ stats }: ProfileStatsProps) {
  const items: ProfileStatItem[] = [
    {
      label: 'From',
      value: stats.priceFromLabel ?? '—',
    },
    {
      label: 'Booked',
      value: stats.completedBookingsLabel,
    },
    {
      label: 'Rating',
      value: stats.averageRatingLabel ?? '—',
    },
    {
      label: 'Saved',
      value: stats.favoritesLabel,
    },
  ]

  return (
    <section
      className="brand-profile-divider-strong grid grid-cols-4 px-5 py-4"
      aria-label="Professional profile stats"
    >
      {items.map((item) => (
        <ProfileStat
          key={item.label}
          label={item.label}
          value={item.value}
        />
      ))}
    </section>
  )
}

function ProfileStat({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div>
      <div className="brand-cap mb-1">{label}</div>
      <div className="brand-profile-stat-value">{value}</div>
    </div>
  )
}