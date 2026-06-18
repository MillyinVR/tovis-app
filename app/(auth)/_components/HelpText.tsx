/** Small helper/hint text shared across the auth forms. */
export default function HelpText({
  children,
}: {
  children: React.ReactNode
}) {
  return <span className="text-xs text-textSecondary/80">{children}</span>
}
