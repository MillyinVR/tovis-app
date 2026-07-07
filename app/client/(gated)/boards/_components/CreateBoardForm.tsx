// app/client/boards/_components/CreateBoardForm.tsx
'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useFormStatus } from 'react-dom'
import { BoardType } from '@prisma/client'

import { cn } from '@/lib/utils'
import {
  BOARD_QUESTION_SETS,
  BOARD_TYPE_LABELS,
  BOARD_TYPE_VALUES,
  boardTypeWantsEventDate,
} from '@/lib/boards/context'

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

const CHIP_BASE_CLASS = cn(
  'inline-flex min-h-9 items-center rounded-full border px-3 py-1.5',
  'text-[12px] font-bold transition',
)

function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        CHIP_BASE_CLASS,
        selected
          ? 'border-white/40 bg-bgPrimary text-textPrimary'
          : 'border-white/10 bg-bgPrimary/60 text-textSecondary hover:border-white/20 hover:text-textPrimary',
      )}
    >
      {children}
    </button>
  )
}

export default function CreateBoardForm({
  action,
  errorMessage = null,
  cancelHref = '/client/me',
  className,
}: CreateBoardFormProps) {
  // Creation-context capture (personalization spec §7): a board type chip row,
  // an event date for bridal/prom, and 2–3 chip questions per type. Everything
  // is skippable, and chips toggle off on a second tap. Values ride the form
  // as hidden inputs so the server action stays a plain-form submit.
  const [boardType, setBoardType] = useState<BoardType>(BoardType.GENERAL)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [eventDate, setEventDate] = useState('')

  const questions = BOARD_QUESTION_SETS[boardType]
  const wantsEventDate = boardTypeWantsEventDate(boardType)

  function selectBoardType(next: BoardType) {
    setBoardType(next)
    // Answers and the date belong to the type that asked for them.
    setAnswers({})
    setEventDate('')
  }

  function toggleAnswer(key: string, value: string) {
    setAnswers((current) => {
      const next = { ...current }
      if (next[key] === value) {
        delete next[key]
      } else {
        next[key] = value
      }
      return next
    })
  }

  return (
    <section
      className={cn(
        'rounded-card border border-white/10 bg-bgSecondary p-4',
        className,
      )}
    >
      {errorMessage ? (
        <div className="mb-4 rounded-card border border-toneDanger/20 bg-toneDanger/10 px-4 py-3 text-[13px] text-textPrimary">
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
          <div className="mb-2 text-[12px] font-bold uppercase tracking-wide text-textSecondary">
            What&apos;s this board for?
          </div>
          <div className="flex flex-wrap gap-2">
            {BOARD_TYPE_VALUES.map((type) => (
              <Chip
                key={type}
                selected={boardType === type}
                onClick={() => selectBoardType(type)}
              >
                {BOARD_TYPE_LABELS[type]}
              </Chip>
            ))}
          </div>
          <input type="hidden" name="type" value={boardType} />
        </div>

        {wantsEventDate ? (
          <div>
            <label
              htmlFor="board-event-date"
              className="mb-2 block text-[12px] font-bold uppercase tracking-wide text-textSecondary"
            >
              {boardType === BoardType.BRIDAL ? 'Wedding date' : 'Prom date'}
              <span className="ml-2 font-normal normal-case tracking-normal text-textMuted">
                optional
              </span>
            </label>
            <input
              id="board-event-date"
              name="eventDate"
              type="date"
              value={eventDate}
              onChange={(event) => setEventDate(event.target.value)}
              className={cn(
                'w-full rounded-card border border-white/10 bg-bgPrimary px-3 py-3',
                'text-[14px] text-textPrimary outline-none transition',
                'focus:border-white/20',
              )}
            />
            <p className="mt-2 text-[12px] leading-5 text-textSecondary">
              We&apos;ll count down with you and time suggestions around the big
              day. You can change or clear it anytime.
            </p>
          </div>
        ) : null}

        {questions.map((question) => (
          <div key={question.key}>
            <div className="mb-2 text-[12px] font-bold uppercase tracking-wide text-textSecondary">
              {question.label}
              <span className="ml-2 font-normal normal-case tracking-normal text-textMuted">
                optional
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {question.options.map((option) => (
                <Chip
                  key={option.value}
                  selected={answers[question.key] === option.value}
                  onClick={() => toggleAnswer(question.key, option.value)}
                >
                  {option.label}
                </Chip>
              ))}
            </div>
            {answers[question.key] ? (
              <input
                type="hidden"
                name={`answer.${question.key}`}
                value={answers[question.key]}
              />
            ) : null}
          </div>
        ))}

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
            Private boards are just for you. Shared boards get a public link you
            can send anyone — they’ll see the looks and can book the pros. You
            can change this anytime.
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