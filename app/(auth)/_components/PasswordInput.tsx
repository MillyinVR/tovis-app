'use client'

import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

import { cn } from '@/lib/utils'
import Input from './Input'

type PasswordInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type'
>

/**
 * Password field with a built-in show/hide eye toggle. Wraps the shared auth
 * Input so it drops into login, signup, and reset without style divergence.
 */
export default function PasswordInput({
  className,
  ...props
}: PasswordInputProps) {
  const [show, setShow] = useState(false)

  return (
    <div className="relative">
      <Input
        {...props}
        type={show ? 'text' : 'password'}
        className={cn('pr-10', className ?? '')}
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        aria-label={show ? 'Hide password' : 'Show password'}
        aria-pressed={show}
        className={cn(
          'absolute inset-y-0 right-0 flex items-center px-3',
          'text-textSecondary/70 transition hover:text-textPrimary',
          'focus:outline-none focus-visible:text-textPrimary',
        )}
      >
        {show ? (
          <EyeOff className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Eye className="h-4 w-4" aria-hidden="true" />
        )}
      </button>
    </div>
  )
}
