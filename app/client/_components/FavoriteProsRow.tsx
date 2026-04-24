// app/client/_components/FavoriteProsRow.tsx
import Link from 'next/link'

import type { ClientHomeFavoritePro } from '../_data/getClientHomeData'

type FavoriteProsRowProps = {
  favoritePros: ClientHomeFavoritePro[]
  removeProFavoriteAction: (formData: FormData) => Promise<void>
}

function professionalName(professional: {
  businessName: string | null
  handle?: string | null
}): string {
  return (
    professional.businessName ??
    professional.handle ??
    'Professional'
  ).trim()
}

function firstWord(name: string): string {
  return name.split(/\s+/)[0] ?? name
}

function initialsForName(name: string): string {
  const parts = name
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length === 0) return 'P'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase()
}

function ProAvatar({
  src,
  alt,
}: {
  src: string | null
  alt: string
}) {
  return (
    <div className="grid h-14 w-14 place-items-center overflow-hidden rounded-full bg-bgSurface text-sm font-bold text-textMuted">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} className="h-full w-full object-cover" />
      ) : (
        initialsForName(alt)
      )}
    </div>
  )
}

function EmptyProsCard() {
  return (
    <div
      className="overflow-hidden border border-textPrimary/16 bg-bgSecondary"
      style={{ borderRadius: 14 }}
    >
      <div
        className="border-b px-4 py-3"
        style={{ borderColor: 'rgba(224,90,40,0.14)' }}
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-terra">
          ◆ No pros saved yet
        </span>
      </div>
      <div className="p-4">
        <p className="text-[13px] font-semibold text-textPrimary">
          No favorite pros yet.
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-textMuted">
          Favorite pros from Looks or Discover and they&apos;ll show up here.
        </p>
        <Link
          href="/discover"
          className="mt-3.5 inline-flex rounded-[10px] border border-textPrimary/16 px-4 py-2 text-[11px] font-bold text-textSecondary transition hover:border-terra/30 hover:text-terra"
        >
          Find pros
        </Link>
      </div>
    </div>
  )
}

function FavoriteProBubble({
  favorite,
}: {
  favorite: ClientHomeFavoritePro
}) {
  const professional = favorite.professional
  const name = professionalName(professional)
  const label = firstWord(name)

  return (
    <div className="grid w-16 shrink-0 justify-items-center gap-1.5 text-center">
      <Link
        href={`/professionals/${encodeURIComponent(professional.id)}`}
        className="group grid justify-items-center gap-1.5"
      >
        <div
          className="rounded-full transition group-hover:scale-[1.04]"
          style={{ padding: 2, border: '2px solid rgb(var(--terra))' }}
        >
          <ProAvatar src={professional.avatarUrl} alt={name} />
        </div>

        <p className="w-full truncate text-[11px] font-bold text-textSecondary transition group-hover:text-textPrimary">
          {label}
        </p>
      </Link>
    </div>
  )
}

function FindMoreBubble() {
  return (
    <Link
      href="/discover"
      className="group grid w-16 shrink-0 justify-items-center gap-1.5 text-center"
    >
      <div
        className="grid h-14 w-14 place-items-center rounded-full text-xl text-textMuted transition group-hover:border-textPrimary/25 group-hover:text-textSecondary"
        style={{ border: '1.5px dashed rgba(244,239,231,0.16)' }}
      >
        +
      </div>
      <p className="w-full truncate text-[11px] font-bold text-textMuted transition group-hover:text-textSecondary">
        Find more
      </p>
    </Link>
  )
}

export default function FavoriteProsRow({
  favoritePros,
}: FavoriteProsRowProps) {
  return (
    <section className="px-4">
      <div className="mb-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em]">
          <span className="text-terra">◆</span>
          <span className="ml-1.5 text-textMuted">Your Pros</span>
        </span>
      </div>

      {favoritePros.length === 0 ? (
        <EmptyProsCard />
      ) : (
        <div
          className="flex gap-3.5 overflow-x-auto pb-1 looksNoScrollbar"
        >
          {favoritePros.slice(0, 12).map((favorite) => (
            <FavoriteProBubble
              key={favorite.professional.id}
              favorite={favorite}
            />
          ))}
          <FindMoreBubble />
        </div>
      )}
    </section>
  )
}
