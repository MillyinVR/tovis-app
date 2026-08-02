// app/_components/ui/CardLinkOverlay.tsx
//
// Makes a whole card tappable WITHOUT wrapping it in a <Link>, so the card can
// still contain its own links (a pro's name/avatar linking to their profile).
// `<a>` inside `<a>` is invalid HTML — React renders it, the browser un-nests it,
// and the inner link silently stops working. That's exactly how client cards ended
// up with dead pro names.
//
// Usage — three parts, all required:
//   <Card className="relative">                     ← positions the overlay
//     <CardLinkOverlay href={…} label="…" />
//     <div className="relative z-10 pointer-events-none">   ← content sits above…
//       <ProProfileLink … className="pointer-events-auto" />  ← …but only the real
//     </div>                                                   links take clicks;
//   </Card>                                                    the rest falls
//                                                              through to the
//                                                              overlay.
//
// The overlay carries the card's accessible name, so the inner links are the only
// other tab stops in the row.
import Link from 'next/link'

import { cn } from '@/lib/utils'

export type CardLinkOverlayProps = {
  href: string
  /** Accessible name for the card as a whole, e.g. "Balayage on Fri, Aug 8". */
  label: string
  className?: string
}

/** Full-bleed anchor covering its positioned parent. Parent needs `relative`. */
export default function CardLinkOverlay({
  href,
  label,
  className,
}: CardLinkOverlayProps) {
  return (
    <Link
      href={href}
      aria-label={label}
      className={cn(
        'absolute inset-0 z-0 rounded-[inherit] outline-none',
        'focus-visible:ring-2 focus-visible:ring-accentPrimary/40',
        className,
      )}
    />
  )
}
