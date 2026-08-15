import { FieldLabel as KitFieldLabel } from '@/app/_components/ui'

/**
 * Field label shared across the auth forms.
 *
 * A preset over the kit's `FieldLabel`: same size, weight and colour, plus the
 * `tracking-wide` the auth screens set. The tracking is the ONLY thing this adds
 * — it is kept rather than converged because three label spacings are in the tree
 * (none in the kit, `tracking-wide` here, `--ls-caps` in client settings) and
 * picking one is a design call, not a cleanup.
 */
export default function FieldLabel({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <KitFieldLabel as="span" className="tracking-wide">
      {children}
    </KitFieldLabel>
  )
}
