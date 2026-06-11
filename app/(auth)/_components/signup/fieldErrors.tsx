// app/(auth)/_components/signup/fieldErrors.tsx
'use client'

export function FieldErrorText({
  id,
  message,
}: {
  id: string
  message: string | undefined
}) {
  if (!message) return null

  return (
    <span id={id} role="alert" className="text-xs font-bold text-toneDanger">
      {message}
    </span>
  )
}

export function fieldErrorDescribedBy(
  fieldId: string,
  message: string | undefined,
): { 'aria-invalid': boolean; 'aria-describedby': string | undefined } {
  return {
    'aria-invalid': Boolean(message),
    'aria-describedby': message ? `${fieldId}-error` : undefined,
  }
}

export function focusFieldById(id: string): void {
  if (typeof document === 'undefined') return
  document.getElementById(id)?.focus()
}
