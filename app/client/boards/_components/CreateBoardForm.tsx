// app/client/boards/_components/CreateBoardForm.tsx
'use client'

import Link from 'next/link'
import { useFormStatus } from 'react-dom'

import { cn } from '@/lib/utils'

type CreateBoardFormProps = {
  action: (formData: FormData) => void | Promise<void>
  errorMessage?: string | null
  cancelHref?: string | null
  className?: string
}

function SubmitButton() {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(
        'inline-flex min-h-11 items-center justify-center rounded-full border border-white/10 bg-bgPrimary px-4 py-2',
        'text-[12px] font-bold text-textPrimary transition hover:border-white/20',
        'disabled:cursor-not-allowed disabled:opacity-60',
      )}
    >
      {pending ? 'Saving…' : 'Save board'}
    </button>
  )
}

export default function CreateBoardForm({
  action,
  errorMessage = null,
  cancelHref = '/client/me',
  className,
}: CreateBoardFormProps) {
  return (
    <section
      className={cn(
        'rounded-card border border-white/10 bg-bgSecondary p-4',
        className,
      )}
    >
      {errorMessage ? (
        <div className="mb-4 rounded-card border border-red-400/20 bg-red-400/10 px-4 py-3 text-[13px] text-textPrimary">
          {errorMessage}
        </div>
      ) : null}

      <form action={action} className="grid gap-4">
        <div>
          <label
            htmlFor="board-name"
            className="mb-2 block text-[12px] font-bold uppercase tracking-wide text-textSecondary"
          >
            Board name
          </label>
          <input
            id="board-name"
            name="name"
            type="text"
            maxLength={120}
            placeholder="Spring hair inspo"
            autoComplete="off"
            required
            className={cn(
              'w-full rounded-card border border-white/10 bg-bgPrimary px-3 py-3',
              'text-[14px] text-textPrimary outline-none transition',
              'placeholder:text-textMuted focus:border-white/20',
            )}
          />
        </div>

        <div>
          <label
            htmlFor="board-visibility"
            className="mb-2 block text-[12px] font-bold uppercase tracking-wide text-textSecondary"
          >
            Visibility
          </label>

          <select
            id="board-visibility"
            name="visibility"
            defaultValue="PRIVATE"
            className={cn(
              'w-full rounded-card border border-white/10 bg-bgPrimary px-3 py-3',
              'text-[14px] text-textPrimary outline-none transition',
              'focus:border-white/20',
            )}
          >
            <option value="PRIVATE">Private</option>
            <option value="SHARED">Shared</option>
          </select>

          <p className="mt-2 text-[12px] leading-5 text-textSecondary">
            Private boards are just for you. Shared boards can be surfaced later
            when that flow is ready.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-white/10 pt-3">
          <SubmitButton />

          {cancelHref ? (
            <Link
              href={cancelHref}
              className="inline-flex min-h-11 items-center rounded-full border border-transparent px-2 py-2 text-[12px] font-bold text-textSecondary transition hover:text-textPrimary"
            >
              Cancel
            </Link>
          ) : null}
        </div>
      </form>
    </section>
  )
}