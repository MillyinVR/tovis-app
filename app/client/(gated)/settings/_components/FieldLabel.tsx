import { FieldLabel as KitFieldLabel } from '@/app/_components/ui'

/**
 * Field label shared across the client settings forms.
 *
 * A preset over the kit's `FieldLabel` — same size, weight and colour, plus the
 * caps tracking these screens set. Two settings files had declared this
 * separately; the tracking is all either one was adding.
 *
 * `--ls-caps` is the brand's own caps-label spacing, so it stays rather than
 * being flattened onto the kit's default. Three label spacings are in the tree
 * (none in the kit, `tracking-wide` in the auth preset, `--ls-caps` here) and
 * choosing one is a design call, not a cleanup.
 */
export default function FieldLabel({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <KitFieldLabel as="span" className="tracking-[var(--ls-caps)]">
      {children}
    </KitFieldLabel>
  )
}
