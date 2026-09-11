'use client'

// C2-4 — "Ask a follow-up", on the Brief.
//
// The pro types one question in plain words and two to six answers the client
// can tap. It lands in the client's consult thread as a card with the pro's
// name on it (web and iOS alike — same card, same answer route as the model's
// follow-ups), and the client gets a gentle notification. Nothing here is
// clever: no translation yet, no free-text answers, no photo asks. Those are
// later slices, and this control says nothing that promises them.

import { useState } from 'react'

import { Button, FieldLabel, Textarea, TextInput, ToggleChip } from '@/app/_components/ui'
import { consultProFollowUpCopy as copy } from '@/lib/brand/consultProFollowUpCopy'
import type {
  ConsultProFollowUpDTO,
  ConsultProFollowUpPriorityDTO,
} from '@/lib/dto/consult'

const MAX_OPEN = 3
const MAX_TEXT = 300
const MAX_LABEL = 120
const MIN_OPTIONS = 2
const MAX_OPTIONS = 6
const PRIORITIES: readonly ConsultProFollowUpPriorityDTO[] = [
  'NEED_BEFORE_APPOINTMENT',
  'HELPFUL_FOR_PREP',
]

function isQuestionList(value: unknown): value is { questions: ConsultProFollowUpDTO[] } {
  return (
    !!value &&
    typeof value === 'object' &&
    'questions' in value &&
    Array.isArray((value as { questions: unknown }).questions)
  )
}

export default function ProConsultAskFollowUp({
  consultId,
  initialQuestions,
}: {
  consultId: string
  initialQuestions: ConsultProFollowUpDTO[]
}) {
  const [questions, setQuestions] = useState(initialQuestions)
  const [text, setText] = useState('')
  const [priority, setPriority] = useState<ConsultProFollowUpPriorityDTO>('HELPFUL_FOR_PREP')
  const [options, setOptions] = useState<string[]>(['', ''])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const openCount = questions.filter((question) => question.selectedValue === null).length
  const atOpenCap = openCount >= MAX_OPEN
  const trimmedOptions = options.map((option) => option.trim()).filter(Boolean)
  const canSubmit =
    !pending &&
    !atOpenCap &&
    text.trim().length > 0 &&
    trimmedOptions.length >= MIN_OPTIONS &&
    new Set(trimmedOptions.map((option) => option.toLowerCase())).size === trimmedOptions.length

  async function submit() {
    if (!canSubmit) {
      setError(copy.invalid)
      return
    }
    setPending(true)
    setError(null)
    try {
      const response = await fetch(
        `/api/v1/pro/consults/${encodeURIComponent(consultId)}/follow-up`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ priority, text: text.trim(), options: trimmedOptions }),
        },
      )
      const payload: unknown = await response.json().catch(() => null)
      if (!response.ok || !isQuestionList(payload)) {
        const message =
          payload && typeof payload === 'object' && 'error' in payload &&
          typeof (payload as { error: unknown }).error === 'string'
            ? (payload as { error: string }).error
            : copy.failed
        throw new Error(message)
      }
      setQuestions(payload.questions)
      setText('')
      setOptions(['', ''])
      setPriority('HELPFUL_FOR_PREP')
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : copy.failed)
    } finally {
      setPending(false)
    }
  }

  return (
    <section aria-labelledby="pro-consult-ask-follow-up" className="grid gap-4">
      <div>
        <h3 id="pro-consult-ask-follow-up" className="text-[13px] font-bold text-textPrimary">
          {copy.title}
        </h3>
        <p className="mt-1 text-[12px] leading-5 text-textSecondary">{copy.intro}</p>
      </div>

      <div>
        <div className="text-[11px] font-bold uppercase tracking-wide text-textMuted">
          {copy.askedList}
        </div>
        {questions.length === 0 ? (
          <p className="mt-1 text-[12px] text-textSecondary">{copy.none}</p>
        ) : (
          <ul className="mt-2 grid gap-2">
            {questions.map((question) => (
              <li
                key={question.id}
                className="rounded-xl border border-surfaceGlass/10 bg-bgPrimary px-3 py-2.5"
                data-testid="pro-consult-follow-up"
                data-answered={question.selectedValue ? 'true' : 'false'}
              >
                <div className="text-[13px] font-semibold text-textPrimary">{question.text}</div>
                <div className="mt-1 text-[12px] text-textSecondary">
                  {copy.priority[question.priority].label}
                  {' · '}
                  {question.selectedLabel ? (
                    <span className="font-semibold text-textPrimary">
                      {copy.answered}: {question.selectedLabel}
                    </span>
                  ) : (
                    copy.waiting
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <div className="grid gap-1">
          <FieldLabel as="label" htmlFor="pro-consult-follow-up-text">
            {copy.textLabel}
          </FieldLabel>
          <Textarea
            id="pro-consult-follow-up-text"
            value={text}
            maxLength={MAX_TEXT}
            rows={3}
            placeholder={copy.textPlaceholder}
            disabled={pending || atOpenCap}
            onChange={(event) => setText(event.target.value)}
          />
          <p className="text-[11px] text-textMuted">{copy.textHint}</p>
        </div>

        <div className="grid gap-1">
          <FieldLabel>{copy.optionsLabel}</FieldLabel>
          <div className="grid gap-2">
            {options.map((option, index) => (
              <div key={index} className="flex items-center gap-2">
                <TextInput
                  aria-label={copy.optionPlaceholder(index)}
                  value={option}
                  maxLength={MAX_LABEL}
                  placeholder={copy.optionPlaceholder(index)}
                  disabled={pending || atOpenCap}
                  onChange={(event) =>
                    setOptions((current) =>
                      current.map((entry, at) => (at === index ? event.target.value : entry)),
                    )
                  }
                />
                {options.length > MIN_OPTIONS ? (
                  <button
                    type="button"
                    className="text-[12px] font-semibold text-textSecondary underline-offset-2 hover:underline"
                    disabled={pending}
                    onClick={() =>
                      setOptions((current) => current.filter((_, at) => at !== index))
                    }
                  >
                    {copy.removeOption}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          {options.length < MAX_OPTIONS ? (
            <button
              type="button"
              className="justify-self-start text-[12px] font-semibold text-textPrimary underline-offset-2 hover:underline"
              disabled={pending || atOpenCap}
              onClick={() => setOptions((current) => [...current, ''])}
            >
              {copy.addOption}
            </button>
          ) : null}
          <p className="text-[11px] text-textMuted">{copy.optionsHint}</p>
        </div>

        <div className="grid gap-1">
          <FieldLabel>{copy.priorityLabel}</FieldLabel>
          <div className="flex flex-wrap gap-2">
            {PRIORITIES.map((value) => (
              <ToggleChip
                key={value}
                selected={priority === value}
                disabled={pending || atOpenCap}
                onClick={() => setPriority(value)}
              >
                {copy.priority[value].label}
              </ToggleChip>
            ))}
          </div>
          <p className="text-[11px] text-textMuted">{copy.priority[priority].hint}</p>
        </div>

        {atOpenCap ? (
          <p className="text-[12px] text-textSecondary">{copy.openLimit(MAX_OPEN)}</p>
        ) : null}
        {error ? (
          <p className="text-[12px] font-semibold text-toneDanger" role="alert">
            {error}
          </p>
        ) : null}

        <Button type="submit" disabled={!canSubmit}>
          {pending ? copy.sending : copy.submit}
        </Button>
      </form>
    </section>
  )
}
