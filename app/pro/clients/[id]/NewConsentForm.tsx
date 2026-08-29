'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ClientConsentKind,
  ConsentProofMethod,
  PatchTestResult,
} from '@/lib/prismaEnums'

import type { ConsentFormOption } from '@/lib/consentForms/loader'
import {
  CONSENT_KINDS,
  CONSENT_KIND_LABELS,
} from '@/lib/consentForms/kindLabels'

type Props = { clientId: string; forms: ConsentFormOption[] }

const inputStyle: React.CSSProperties = {
  width: '100%',
  borderRadius: 8,
  border: '1px solid rgb(var(--text-primary) / 0.10)',
  padding: 8,
  fontSize: 13,
  fontFamily: 'inherit',
  background: 'rgb(var(--bg-primary))',
}

/**
 * 🔴 K15 (closing K14-B): CLIENT_TOKEN is deliberately ABSENT.
 *
 * K14 shipped this control offering "Client link" with no link flow behind it,
 * so a pro could record "the client signed via a link" when no link was ever
 * sent — an [[existing-control-can-still-be-lying]], worse than the dormant enum
 * the card described. K15 gives that proof method a real producer (the signing
 * route behind /client/consent/<token>), and the price of it MEANING something
 * is that only that route may write it. The pro's route now refuses it too, so
 * this is not merely a hidden option.
 *
 * These two remain because a pro genuinely does witness them: a form signed in
 * front of them, or a paper one already in the drawer.
 */
const PROOF_LABELS: Record<
  Exclude<ConsentProofMethod, 'CLIENT_TOKEN'>,
  string
> = {
  IN_PERSON: 'In person',
  PAPER_ON_FILE: 'Paper on file',
}

export default function NewConsentForm({ clientId, forms }: Props) {
  const router = useRouter()
  const [kind, setKind] = useState<ClientConsentKind>(
    ClientConsentKind.GENERAL_CONSENT,
  )
  const [formVersionId, setFormVersionId] = useState('')
  const [serviceScope, setServiceScope] = useState('')
  const [proofMethod, setProofMethod] = useState<ConsentProofMethod | ''>('')
  const [signedAt, setSignedAt] = useState('')
  const [patchResult, setPatchResult] = useState<PatchTestResult | ''>('')
  const [validUntil, setValidUntil] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isPatch = kind === ClientConsentKind.PATCH_TEST

  // A form's kind is part of what it says, and the write route refuses a
  // mismatch — so only ever offer the forms that fit the record being written.
  const availableForms = forms.filter((f) => f.kind === kind)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/pro/clients/${clientId}/consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          formVersionId: formVersionId || null,
          serviceScope: serviceScope.trim() || null,
          proofMethod: proofMethod || null,
          signedAt: signedAt || null,
          notes: notes.trim() || null,
          patchTestResult: isPatch ? patchResult || null : null,
          validUntil: isPatch ? validUntil || null : null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError((data as { error?: string }).error || 'Failed to save.')
        return
      }
      setFormVersionId('')
      setServiceScope('')
      setProofMethod('')
      setSignedAt('')
      setPatchResult('')
      setValidUntil('')
      setNotes('')
      router.refresh()
    } catch (err) {
      console.error(err)
      setError('Network error.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      style={{
        borderRadius: 10,
        border: '1px solid rgb(var(--text-primary) / 0.10)',
        padding: 12,
        background: 'rgb(var(--text-primary) / 0.04)',
        display: 'grid',
        gap: 8,
      }}
    >
      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr' }}>
        <select
          value={kind}
          disabled={loading}
          onChange={(e) => {
            setKind(e.target.value as ClientConsentKind)
            // The chosen form belonged to the OLD kind; keeping it selected
            // would post a pairing the route refuses.
            setFormVersionId('')
          }}
          style={inputStyle}
          aria-label="Consent kind"
        >
          {CONSENT_KINDS.map((k) => (
            <option key={k} value={k}>
              {CONSENT_KIND_LABELS[k]}
            </option>
          ))}
        </select>
        <input
          value={serviceScope}
          disabled={loading}
          onChange={(e) => setServiceScope(e.target.value)}
          placeholder="Service scope (e.g. color)"
          style={inputStyle}
        />
        <select
          value={proofMethod}
          disabled={loading}
          onChange={(e) =>
            setProofMethod(e.target.value as ConsentProofMethod | '')
          }
          style={inputStyle}
          aria-label="Proof method"
        >
          <option value="">Proof method…</option>
          {Object.entries(PROOF_LABELS).map(([m, label]) => (
            <option key={m} value={m}>
              {label}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={signedAt}
          disabled={loading}
          onChange={(e) => setSignedAt(e.target.value)}
          aria-label="Signed date"
          style={inputStyle}
        />
      </div>

      {availableForms.length > 0 ? (
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 11, color: 'rgb(var(--text-secondary))' }}>
            Form signed (optional — pins this record to that exact text)
          </span>
          <select
            value={formVersionId}
            disabled={loading}
            onChange={(e) => setFormVersionId(e.target.value)}
            style={inputStyle}
          >
            <option value="">No form (free-text record)</option>
            {availableForms.map((f) => (
              <option key={f.versionId} value={f.versionId}>
                {f.title} (v{f.version})
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {isPatch ? (
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr' }}>
          <select
            value={patchResult}
            disabled={loading}
            onChange={(e) => setPatchResult(e.target.value as PatchTestResult | '')}
            style={inputStyle}
            aria-label="Patch test result"
          >
            <option value="">Result…</option>
            <option value="PASS">Pass</option>
            <option value="FAIL">Fail</option>
            <option value="INCONCLUSIVE">Inconclusive</option>
          </select>
          <input
            type="date"
            value={validUntil}
            disabled={loading}
            onChange={(e) => setValidUntil(e.target.value)}
            aria-label="Valid until"
            style={inputStyle}
          />
        </div>
      ) : null}

      <textarea
        value={notes}
        disabled={loading}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        placeholder="Notes (encrypted)"
        style={{ ...inputStyle, resize: 'vertical' }}
      />
      {error ? (
        <div style={{ fontSize: 12, color: 'rgb(var(--tone-danger))' }}>{error}</div>
      ) : null}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="submit"
          disabled={loading}
          style={{
            padding: '6px 14px',
            borderRadius: 999,
            border: 'none',
            background: 'rgb(var(--text-primary))',
            color: 'rgb(var(--bg-primary))',
            fontSize: 13,
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Saving…' : 'Add record'}
        </button>
      </div>
    </form>
  )
}
