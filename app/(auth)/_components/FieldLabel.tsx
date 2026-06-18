/** Field label shared across the auth forms. */
export default function FieldLabel({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <span className="text-xs font-black tracking-wide text-textSecondary">
      {children}
    </span>
  )
}
