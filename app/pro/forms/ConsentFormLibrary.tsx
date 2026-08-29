'use client'

// app/pro/forms/ConsentFormLibrary.tsx
//
// K14 — the pro's consent form library. The one idea this surface has to get
// across: there is no editing. Saving a change PUBLISHES a new version, and
// every record already signed keeps the words it was signed against. So the
// edit button says so, and a form that has been signed says how many times.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ClientConsentKind } from '@/lib/prismaEnums'

import { Badge, Button } from '@/app/_components/ui'
import {
  CONSENT_FORM_BODY_MAX,
  CONSENT_FORM_TITLE_MAX,
} from '@/lib/consentForms/formText'
import {
  CONSENT_KINDS,
  CONSENT_KIND_LABELS,
} from '@/lib/consentForms/kindLabels'
import type { ConsentFormView } from '@/lib/consentForms/loader'

type Props = {
  forms: ConsentFormView[]
  templates: (ConsentFormView & { adopted: boolean })[]
}

const fieldClass =
  'w-full rounded-card border border-surfaceGlass/10 bg-bgPrimary p-2 text-[13px] font-semibold text-textPrimary'

export default function ConsentFormLibrary({ forms, templates }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [creating, setCreating] = useState(false)
  const [newKind, setNewKind] = useState<ClientConsentKind>(
    ClientConsentKind.SERVICE_WAIVER,
  )
  const [newTitle, setNewTitle] = useState('')
  const [newBody, setNewBody] = useState('')

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editBody, setEditBody] = useState('')

  // Buttons stay disabled until router.refresh() has actually committed —
  // otherwise the surface re-enables over stale data and the next click acts on
  // a version number the server has already moved past.
  const locked = busy || pending

  async function send(
    url: string,
    init: RequestInit,
    onDone?: () => void,
  ): Promise<void> {
    if (locked) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(url, {
        ...init,
        headers: { 'Content-Type': 'application/json' },
      })
      const data: unknown = await res.json().catch(() => ({}))
      if (!res.ok) {
        const message =
          typeof data === 'object' && data !== null && 'error' in data
            ? String((data as { error: unknown }).error)
            : 'Something went wrong.'
        setError(message)
        return
      }
      onDone?.()
      startTransition(() => router.refresh())
    } catch (e) {
      console.error(e)
      setError('Network error.')
    } finally {
      setBusy(false)
    }
  }

  function beginEdit(form: ConsentFormView) {
    setEditingId(form.id)
    setEditTitle(form.currentVersion?.title ?? '')
    setEditBody(form.currentVersion?.body ?? '')
    setError(null)
  }

  return (
    <div className="grid gap-4">
      {error ? (
        <div
          role="alert"
          className="rounded-card border border-surfaceGlass/10 bg-bgPrimary p-3 text-[12px] font-black text-toneDanger"
        >
          {error}
        </div>
      ) : null}

      <section className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[13px] font-black text-textPrimary">Your forms</h2>
          <Button
            size="sm"
            variant="ghost"
            disabled={locked}
            onClick={() => {
              setCreating((v) => !v)
              setError(null)
            }}
          >
            {creating ? 'Cancel' : 'New form'}
          </Button>
        </div>

        {creating ? (
          <form
            className="grid gap-2 rounded-card border border-surfaceGlass/10 bg-bgSecondary p-3"
            onSubmit={(e) => {
              e.preventDefault()
              void send(
                '/api/v1/pro/consent-forms',
                {
                  method: 'POST',
                  body: JSON.stringify({
                    kind: newKind,
                    title: newTitle,
                    body: newBody,
                  }),
                },
                () => {
                  setCreating(false)
                  setNewTitle('')
                  setNewBody('')
                },
              )
            }}
          >
            <select
              className={fieldClass}
              value={newKind}
              disabled={locked}
              aria-label="Form kind"
              onChange={(e) => setNewKind(e.target.value as ClientConsentKind)}
            >
              {CONSENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {CONSENT_KIND_LABELS[k]}
                </option>
              ))}
            </select>
            <input
              className={fieldClass}
              value={newTitle}
              disabled={locked}
              maxLength={CONSENT_FORM_TITLE_MAX}
              placeholder="Form title (e.g. Corrective colour waiver)"
              aria-label="Form title"
              onChange={(e) => setNewTitle(e.target.value)}
            />
            <textarea
              className={`${fieldClass} resize-y`}
              value={newBody}
              disabled={locked}
              maxLength={CONSENT_FORM_BODY_MAX}
              rows={8}
              placeholder="The text the client agrees to."
              aria-label="Form text"
              onChange={(e) => setNewBody(e.target.value)}
            />
            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={locked}>
                {locked ? 'Saving…' : 'Publish v1'}
              </Button>
            </div>
          </form>
        ) : null}

        {forms.length === 0 ? (
          <p className="rounded-card border border-surfaceGlass/10 bg-bgPrimary p-3 text-[12px] font-semibold text-textSecondary">
            No forms yet. Write your own, or add one of the templates below.
          </p>
        ) : (
          forms.map((form) => (
            <article
              key={form.id}
              className="grid gap-2 rounded-card border border-surfaceGlass/10 bg-bgPrimary p-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="grid gap-1">
                  <span className="text-[13px] font-black text-textPrimary">
                    {form.currentVersion?.title ?? 'Untitled form'}
                  </span>
                  <span className="text-[11px] font-semibold text-textSecondary">
                    {CONSENT_KIND_LABELS[form.kind]} · {form.originLabel} ·
                    {form.currentVersion
                      ? ` v${form.currentVersion.version} of ${form.versionCount}`
                      : ' no text published'}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {form.signatureCount > 0 ? (
                    <Badge tone="info" size="sm">
                      {form.signatureCount} signed
                    </Badge>
                  ) : null}
                  <Badge tone={form.isActive ? 'success' : 'neutral'} size="sm">
                    {form.isActive ? 'In use' : 'Retired'}
                  </Badge>
                </div>
              </div>

              {form.currentVersion ? (
                <details className="rounded-card border border-surfaceGlass/10 bg-bgSecondary p-2">
                  <summary className="cursor-pointer text-[11px] font-black text-textSecondary">
                    Current text
                  </summary>
                  <div className="mt-2 whitespace-pre-wrap text-[12px] font-semibold text-textSecondary">
                    {form.currentVersion.body}
                  </div>
                </details>
              ) : null}

              {editingId === form.id ? (
                <form
                  className="grid gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void send(
                      `/api/v1/pro/consent-forms/${form.id}/versions`,
                      {
                        method: 'POST',
                        body: JSON.stringify({
                          title: editTitle,
                          body: editBody,
                        }),
                      },
                      () => setEditingId(null),
                    )
                  }}
                >
                  <input
                    className={fieldClass}
                    value={editTitle}
                    disabled={locked}
                    maxLength={CONSENT_FORM_TITLE_MAX}
                    aria-label="Form title"
                    onChange={(e) => setEditTitle(e.target.value)}
                  />
                  <textarea
                    className={`${fieldClass} resize-y`}
                    value={editBody}
                    disabled={locked}
                    maxLength={CONSENT_FORM_BODY_MAX}
                    rows={10}
                    aria-label="Form text"
                    onChange={(e) => setEditBody(e.target.value)}
                  />
                  <p className="text-[11px] font-semibold text-textSecondary/80">
                    Saving publishes v{(form.currentVersion?.version ?? 0) + 1}.
                    {form.signatureCount === 0
                      ? ' Nothing has been signed against this form yet.'
                      : form.signatureCount === 1
                        ? ' The record already signed against this form keeps its own version.'
                        : ` The ${form.signatureCount} records already signed against this form keep their own versions.`}
                  </p>
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={locked}
                      onClick={() => setEditingId(null)}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" size="sm" disabled={locked}>
                      {locked ? 'Publishing…' : 'Publish new version'}
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={locked}
                    onClick={() =>
                      void send(`/api/v1/pro/consent-forms/${form.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ isActive: !form.isActive }),
                      })
                    }
                  >
                    {form.isActive ? 'Retire' : 'Put back in use'}
                  </Button>
                  <Button
                    size="sm"
                    disabled={locked}
                    onClick={() => beginEdit(form)}
                  >
                    Edit text
                  </Button>
                </div>
              )}
            </article>
          ))
        )}
      </section>

      <section className="grid gap-2">
        <h2 className="text-[13px] font-black text-textPrimary">Templates</h2>
        {templates.length === 0 ? (
          <p className="rounded-card border border-surfaceGlass/10 bg-bgPrimary p-3 text-[12px] font-semibold text-textSecondary">
            No templates are available yet.
          </p>
        ) : (
          templates.map((template) => (
            <article
              key={template.id}
              className="grid gap-2 rounded-card border border-surfaceGlass/10 bg-bgPrimary p-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="grid gap-1">
                  <span className="text-[13px] font-black text-textPrimary">
                    {template.currentVersion?.title ?? 'Untitled template'}
                  </span>
                  <span className="text-[11px] font-semibold text-textSecondary">
                    {CONSENT_KIND_LABELS[template.kind]}
                    {template.currentVersion
                      ? ` · v${template.currentVersion.version}`
                      : ''}
                  </span>
                </div>
                {template.adopted ? (
                  <Badge tone="neutral" size="sm">
                    Added
                  </Badge>
                ) : (
                  <Button
                    size="sm"
                    disabled={locked}
                    onClick={() =>
                      void send('/api/v1/pro/consent-forms', {
                        method: 'POST',
                        body: JSON.stringify({ sourceTemplateId: template.id }),
                      })
                    }
                  >
                    Add to my forms
                  </Button>
                )}
              </div>
              {template.currentVersion ? (
                <details className="rounded-card border border-surfaceGlass/10 bg-bgSecondary p-2">
                  <summary className="cursor-pointer text-[11px] font-black text-textSecondary">
                    Read the text
                  </summary>
                  <div className="mt-2 whitespace-pre-wrap text-[12px] font-semibold text-textSecondary">
                    {template.currentVersion.body}
                  </div>
                </details>
              ) : null}
            </article>
          ))
        )}
      </section>
    </div>
  )
}
