// app/client/(gated)/_components/FavoriteProsRow.tsx
import Link from 'next/link'

import { initialsForName } from '@/lib/initials'
import { formatProfessionLabel } from '@/lib/profiles/publicProfileFormatting'
import RemoteImage from '@/app/_components/media/RemoteImage'

import type { ClientHomeFavoritePro } from '../_data/getClientHomeData'
import { gradientAvatar, professionalName } from './homeVisuals'

type FavoriteProsRowProps = {
  favoritePros: ClientHomeFavoritePro[]
  removeProFavoriteAction: (formData: FormData) => Promise<void>
}

function EmptyProsCard() {
  return (
    <div className="rounded-card border border-textPrimary/10 bg-bgSurface p-[18px]">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-textMuted">
        Favorite pros
      </div>
      <p className="text-[13px] font-semibold text-textPrimary">
        No favorite pros yet.
      </p>
      <p className="mt-1 text-[11.5px] leading-relaxed text-textMuted">
        Favorite pros from Looks or Discover and they&apos;ll show up here.
      </p>
      <Link
        href="/discover"
        className="mt-3.5 inline-flex rounded-[12px] border border-textPrimary/16 px-4 py-2 text-[11.5px] font-bold text-textSecondary transition hover:border-terra/30 hover:text-terra"
      >
        Find pros
      </Link>
    </div>
  )
}

function FavoriteProCard({
  favorite,
  index,
  removeProFavoriteAction,
}: {
  favorite: ClientHomeFavoritePro
  index: number
  removeProFavoriteAction: (formData: FormData) => Promise<void>
}) {
  const professional = favorite.professional
  const name = professionalName(professional)
  const craft = formatProfessionLabel(professional.professionType)

  return (
    <div className="relative min-w-0 rounded-[15px] border border-textPrimary/10 bg-[rgb(var(--surface-glass)/0.05)] p-[13px]">
      <form action={removeProFavoriteAction}>
        <input type="hidden" name="professionalId" value={professional.id} />
        <button
          type="submit"
          title="Remove favorite"
          aria-label={`Remove ${name} from favorites`}
          className="absolute right-2.5 top-2.5 grid h-[22px] w-[22px] place-items-center rounded-full border border-textPrimary/10 bg-bgSurface text-[12px] leading-none text-textMuted transition hover:text-textSecondary"
        >
          ×
        </button>
      </form>

      <div
        className="mb-2.5 grid h-10 w-10 place-items-center overflow-hidden rounded-full text-[11px] font-bold text-onCta"
        style={{ background: gradientAvatar(index) }}
      >
        {professional.avatarUrl ? (
          <RemoteImage
            src={professional.avatarUrl}
            alt={name}
            className="h-full w-full object-cover"
            width={40}
            height={40}
          />
        ) : (
          initialsForName(name)
        )}
      </div>

      <div className="truncate font-display text-[13.5px] font-semibold tracking-[-0.01em] text-textPrimary">
        {name}
      </div>
      <div className="mt-0.5 truncate text-[11px] text-textMuted">{craft}</div>

      <Link
        href={`/professionals/${encodeURIComponent(professional.id)}`}
        className="mt-2.5 flex h-[30px] items-center justify-center rounded-full bg-terra font-display text-[11.5px] font-bold text-onCta transition hover:opacity-95"
      >
        Book
      </Link>
    </div>
  )
}

export default function FavoriteProsRow({
  favoritePros,
  removeProFavoriteAction,
}: FavoriteProsRowProps) {
  if (favoritePros.length === 0) return <EmptyProsCard />

  const pros = favoritePros.slice(0, 6)

  return (
    <section className="rounded-card border border-textPrimary/10 bg-bgSurface p-[18px]">
      <div className="mb-3.5 flex items-end justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-textMuted">
          Favorite pros · {favoritePros.length}
        </span>
        <Link
          href="/discover"
          className="font-display text-[12.5px] font-semibold text-terra transition hover:opacity-80"
        >
          Manage
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-[11px]">
        {pros.map((favorite, index) => (
          <FavoriteProCard
            key={favorite.professional.id}
            favorite={favorite}
            index={index}
            removeProFavoriteAction={removeProFavoriteAction}
          />
        ))}
      </div>
    </section>
  )
}
