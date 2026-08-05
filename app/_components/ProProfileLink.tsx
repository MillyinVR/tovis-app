// app/_components/ProProfileLink.tsx
//
// Single source of truth for making a pro's IDENTITY — their name, their avatar,
// or both — tap through to their public profile. Every client-facing surface that
// renders a pro routes through this, so "is the pro clickable here?" is one
// decision in one place instead of an ad-hoc <Link> (or a forgotten one) per card.
//
// Mirrors ClientProfileLink (the pro-side equivalent, which links a client's
// identity to their chart or their public profile). Both render through the
// shared ProfileIdentityLink; the only thing each owns is how it works out the
// destination. Here that is `proPublicProfilePath`: a missing id renders inert
// text with NO href in the DOM, never a link to `/professionals/`.
//
// Nested-link note: several client cards are one big <Link> to a booking/thread.
// An <a> inside an <a> is invalid HTML and the inner one silently loses its click,
// so those cards use <CardLinkOverlay> + `pointer-events-auto` on this link rather
// than nesting. See app/_components/ui/CardLinkOverlay.tsx.
import { proPublicProfilePath } from '@/lib/routes'
import ProfileIdentityLink, {
  type ProfileIdentityLinkProps,
} from './ProfileIdentityLink'

export type ProProfileLinkProps = Omit<
  ProfileIdentityLinkProps,
  'fallbackLabel' | 'href'
> & {
  /** The pro's id. Blank/missing → inert (no href in the DOM). */
  proId?: string | null
}

/** Links a pro's name/avatar to their public profile; inert when the id is missing. */
export default function ProProfileLink({
  proId,
  ...rest
}: ProProfileLinkProps) {
  return (
    <ProfileIdentityLink
      {...rest}
      href={proPublicProfilePath(proId)}
      fallbackLabel="Professional"
    />
  )
}
