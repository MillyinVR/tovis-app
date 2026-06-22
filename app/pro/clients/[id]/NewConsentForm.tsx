'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ClientConsentKind,
  ConsentProofMethod,
  PatchTestResult,
} from '@prisma/client'

type Props = { clientId: string }

const inputStyle: React.CSSProperties = {
  width: '100%',
  borderRadius: 8,
  border: '1px solid rgb(var(--text-primary) / 0.10)',
  padding: 8,
  fontSize: 13,
  fontFamily: 'inherit',
  background: 'rgb(var(--bg-primary))',
}

const CONSENT_KIND_LABELS: Record<ClientConsentKind, string> = {
  GENERAL_CONSENT: 'General consent',
  SERVICE_WAIVER: 'Service waiver',
  PATCH_TEST: 'Patch test',
}

const PROOF_LABELS: Record<ConsentProofMethod, string> = {
  IN_PERSON: 'In person',
  CLIENT_TOKEN: 'Client link',
  PAPER_ON_FILE: 'Paper on file',
}

export default function NewConsentForm({ clientId }: Props) {
  const router = useRouter()
  const [kind, setKind] = useState<ClientConsentKind>(
    ClientConsentKind.GENERAL_CONSENT,
  )
  const [serviceScope, setServiceScope] = useState('')
  const [proofMethod, setProofMethod] = useState<ConsentProofMethod | ''>('')
  const [signedAt, setSignedAt] = useState('')
  const [patchResult, setPatchResult] = useState<PatchTestResult | ''>('')
  const [validUntil, setValidUntil] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isPatch = kind === ClientConsentKind.PATCH_TEST

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/pro/clients/${clientId}/consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
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
          onChange={(e) => setKind(e.target.value as ClientConsentKind)}
          style={inputStyle}
          aria-label="Consent kind"
        >
          {(Object.keys(CONSENT_KIND_LABELS) as ClientConsentKind[]).map((k) => (
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
          {(Object.keys(PROOF_LABELS) as ConsentProofMethod[]).map((m) => (
            <option key={m} value={m}>
              {PROOF_LABELS[m]}
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
