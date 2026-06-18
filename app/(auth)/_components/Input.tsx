import { cn } from '@/lib/utils'

/**
 * Shared text input for the auth forms (login, signup, reset). Keeps the field
 * styling identical across every auth screen.
 */
export default function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        'w-full rounded-card border px-3 py-2 text-sm outline-none transition',
        'border-surfaceGlass/10 bg-bgSecondary/35 text-textPrimary',
        'placeholder:text-textSecondary/70',
        'hover:border-surfaceGlass/16',
        'focus:border-accentPrimary/35 focus:ring-2 focus:ring-accentPrimary/15',
        props.disabled && 'opacity-70',
        props.className ?? '',
      )}
    />
  )
}
