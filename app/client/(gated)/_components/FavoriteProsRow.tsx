// app/client/(gated)/_components/FavoriteProsRow.tsx
import Link from 'next/link'

import { formatProfessionLabel } from '@/lib/profiles/publicProfileFormatting'
import { Card, buttonClassName } from '@/app/_components/ui'
import ProProfileLink from '@/app/_components/ProProfileLink'
import RemoteImage from '@/app/_components/media/RemoteImage'
import { initialsForName } from '@/lib/initials'

import type { ClientHomeFavoritePro } from '../_data/getClientHomeData'
import { gradientAvatar, professionalName } from './homeVisuals'

type FavoriteProsRowProps = {
  favoritePros: ClientHomeFavoritePro[]
  removeProFavoriteAction: (formData: FormData) => Promise<void>
}

function EmptyPros() {
  return (
    <div>
      <p className="text-[13px] font-semibold text-textPrimary">
        No favorite pros yet.
      </p>
      <p className="mt-1 text-[11.5px] leading-relaxed text-textMuted">
        Favorite pros from Looks or Discover and they&apos;ll show up here.
      </p>
      <Link
        href="/search"
        className={buttonClassName({
          variant: 'ghost',
          size: 'sm',
          shape: 'soft',
          className: 'mt-3.5 hover:border-terra/30 hover:text-terra',
        })}
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
    <div className="relative w-[152px] shrink-0 snap-start overflow-hidden rounded-[15px] border border-textPrimary/10 bg-[rgb(var(--surface-glass)/0.05)]">
      {/* The picture leads the card (Tori, 2026-08-14) — a face is what a client
          recognises their pro by, not a line of text with a thumbnail on it. */}
      <ProProfileLink
        proId={professional.id}
        label={name}
        underline={false}
        className="block"
      >
        <div
          className="grid h-[112px] w-full place-items-center overflow-hidden font-display text-[22px] font-semibold text-onCta"
          style={{ background: gradientAvatar(index) }}
        >
          {professional.avatarUrl ? (
            <RemoteImage
              src={professional.avatarUrl}
              alt={name}
              className="h-full w-full object-cover"
              width={152}
              height={112}
            />
          ) : (
            initialsForName(name)
          )}
        </div>
      </ProProfileLink>

      <form action={removeProFavoriteAction}>
        <input type="hidden" name="professionalId" value={professional.id} />
        <button
          type="submit"
          title="Remove favorite"
          aria-label={`Remove ${name} from favorites`}
          className="absolute right-2 top-2 grid h-[22px] w-[22px] place-items-center rounded-full border border-textPrimary/10 bg-bgPrimary/70 text-[12px] leading-none text-textPrimary backdrop-blur transition hover:text-textSecondary"
        >
          ×
        </button>
      </form>

      <div className="p-3">
        <ProProfileLink
          proId={professional.id}
          label={name}
          underline={false}
          className="block truncate font-display text-[13.5px] font-semibold tracking-[-0.01em] text-textPrimary transition hover:opacity-80"
        />
        <div className="mt-0.5 truncate text-[11px] text-textMuted">{craft}</div>

        <Link
          href={`/professionals/${encodeURIComponent(professional.id)}`}
          className="mt-2.5 flex h-[30px] items-center justify-center rounded-full bg-terra font-display text-[11.5px] font-bold text-onCta transition hover:opacity-95"
        >
          Book
        </Link>
      </div>
    </div>
  )
}

export default function FavoriteProsRow({
  favoritePros,
  removeProFavoriteAction,
}: FavoriteProsRowProps) {
  const pros = favoritePros.slice(0, 12)

  return (
    <Card as="section" className="overflow-hidden">
      <div className="mb-3.5 flex items-end justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-textMuted">
          Favorite pros
          {favoritePros.length > 0 ? ` · ${favoritePros.length}` : ''}
        </span>
        <Link
          href="/search"
          className="font-display text-[12.5px] font-semibold text-terra transition hover:opacity-80"
        >
          Manage
        </Link>
      </div>

      {pros.length === 0 ? (
        <EmptyPros />
      ) : (
        // Scrolls left to right rather than wrapping into a grid: the rail keeps
        // every card the same size however many there are, so a 3rd favourite
        // never leaves a half-empty second row. `-mx-*`/`px-*` lets the first and
        // last card sit flush with the card's padding while the scroll area still
        // runs edge to edge.
        <div className="-mx-[18px] overflow-x-auto px-[18px] pb-1 [scrollbar-width:thin]">
          <div className="flex snap-x snap-mandatory gap-[11px]">
            {pros.map((favorite, index) => (
              <FavoriteProCard
                key={favorite.professional.id}
                favorite={favorite}
                index={index}
                removeProFavoriteAction={removeProFavoriteAction}
              />
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}
