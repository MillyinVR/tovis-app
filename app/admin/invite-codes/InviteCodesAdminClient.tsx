'use client'

import { useCallback, useEffect, useState } from 'react'

import { safeJsonRecord, readErrorMessage } from '@/lib/http'
import { isRecord } from '@/lib/guards'
import { formatInTimeZone } from '@/lib/time'
import { Role } from '@/lib/prismaEnums'
import type {
  CreatedSignupInviteAdminDTO,
  SignupInviteAdminDTO,
} from '@/lib/dto/signupInvite'

const EXPIRATION_OPTIONS = [1, 3, 7, 14, 30] as const

function parseInvite(value: unknown): SignupInviteAdminDTO | null {
  if (!isRecord(value)) return null
  const createdBy = isRecord(value.createdBy) ? value.createdBy : null
  const usedBy = isRecord(value.usedBy) ? value.usedBy : null
  const role =
    usedBy?.role === Role.CLIENT
      ? Role.CLIENT
      : usedBy?.role === Role.PRO
        ? Role.PRO
        : usedBy?.role === Role.ADMIN
          ? Role.ADMIN
          : null

  if (
    typeof value.id !== 'string' ||
    typeof value.codeHint !== 'string' ||
    typeof value.label !== 'string' ||
    typeof value.expiresAt !== 'string' ||
    typeof value.createdAt !== 'string' ||
    !createdBy ||
    typeof createdBy.id !== 'string' ||
    typeof createdBy.email !== 'string' // pii-plaintext-read-ok: admin-only invite audit history identifies the issuing admin
  ) {
    return null
  }

  const parsedUsedBy =
    usedBy &&
    typeof usedBy.id === 'string' &&
    typeof usedBy.email === 'string' && // pii-plaintext-read-ok: admin-only invite audit history identifies the account that used the code
    role !== null
      ? { id: usedBy.id, email: usedBy.email, role } // pii-plaintext-read-ok: admin-only invite audit history identifies the account that used the code
      : null

  return {
    id: value.id,
    codeHint: value.codeHint,
    label: value.label,
    expiresAt: value.expiresAt,
    usedAt: typeof value.usedAt === 'string' ? value.usedAt : null,
    revokedAt: typeof value.revokedAt === 'string' ? value.revokedAt : null,
    createdAt: value.createdAt,
    createdBy: { id: createdBy.id, email: createdBy.email },
    usedBy: parsedUsedBy,
  }
}

function formatDate(value: string): string {
  return formatInTimeZone(new Date(value), 'UTC', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function inviteStatus(invite: SignupInviteAdminDTO): {
  label: string
  tone: string
} {
  if (invite.usedAt) return { label: 'Used', tone: 'text-toneSuccess' }
  if (invite.revokedAt) return { label: 'Revoked', tone: 'text-toneDanger' }
  if (new Date(invite.expiresAt) <= new Date()) {
    return { label: 'Expired', tone: 'text-toneWarn' }
  }
  return { label: 'Active', tone: 'text-accentPrimary' }
}

export default function InviteCodesAdminClient() {
  const [invites, setInvites] = useState<SignupInviteAdminDTO[]>([])
  const [label, setLabel] = useState('')
  const [expiresInDays, setExpiresInDays] = useState(7)
  const [created, setCreated] = useState<CreatedSignupInviteAdminDTO | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const loadInvites = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/v1/admin/signup-invites', {
        cache: 'no-store',
      })
      const data = await safeJsonRecord(response)
      if (!response.ok) {
        setError(readErrorMessage(data) ?? 'Could not load invite codes.')
        return
      }
      const rows = Array.isArray(data?.invites) ? data.invites : []
      setInvites(rows.map(parseInvite).filter((row): row is SignupInviteAdminDTO => row !== null))
    } catch {
      setError('Could not load invite codes.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadInvites()
  }, [loadInvites])

  async function createInvite(event: React.FormEvent) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setError(null)
    setCreated(null)
    setCopied(false)

    try {
      const response = await fetch('/api/v1/admin/signup-invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, expiresInDays }),
      })
      const data = await safeJsonRecord(response)
      if (!response.ok) {
        setError(readErrorMessage(data) ?? 'Could not create invite code.')
        return
      }

      const inviteRecord = data && isRecord(data.invite) ? data.invite : null
      const parsed = parseInvite(inviteRecord)
      const code = inviteRecord && typeof inviteRecord.code === 'string'
        ? inviteRecord.code
        : null
      if (!parsed || !code) {
        setError('The invite was created, but its code could not be displayed. Revoke it and create another.')
        await loadInvites()
        return
      }

      setCreated({ ...parsed, code })
      setInvites((current) => [parsed, ...current])
      setLabel('')
    } catch {
      setError('Could not create invite code.')
    } finally {
      setSaving(false)
    }
  }

  async function copyCode() {
    if (!created) return
    try {
      await navigator.clipboard.writeText(created.code)
      setCopied(true)
    } catch {
      setError('Could not copy automatically. Select the code and copy it manually.')
    }
  }

  async function revokeInvite(inviteId: string) {
    setError(null)
    try {
      const response = await fetch(
        `/api/v1/admin/signup-invites/${encodeURIComponent(inviteId)}`,
        { method: 'DELETE' },
      )
      const data = await safeJsonRecord(response)
      if (!response.ok) {
        setError(readErrorMessage(data) ?? 'Could not revoke invite code.')
        return
      }
      await loadInvites()
    } catch {
      setError('Could not revoke invite code.')
    }
  }

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-extrabold">Private signup invites</h1>
        <p className="mt-1 text-sm text-textSecondary">
          Create one code per person. Each code expires automatically and can create exactly one account.
        </p>
      </div>

      <form onSubmit={createInvite} className="grid gap-4 rounded-card border border-surfaceGlass/12 bg-bgSecondary p-4">
        <div className="grid gap-1.5">
          <label htmlFor="invite-label" className="text-sm font-black">Who is this for?</label>
          <input
            id="invite-label"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            required
            maxLength={160}
            placeholder="Jane Smith"
            className="rounded-full border border-surfaceGlass/16 bg-bgPrimary/40 px-4 py-2.5 text-sm text-textPrimary outline-none focus:border-accentPrimary/45"
          />
        </div>

        <div className="grid gap-1.5">
          <label htmlFor="invite-expiration" className="text-sm font-black">Expires in</label>
          <select
            id="invite-expiration"
            value={expiresInDays}
            onChange={(event) => setExpiresInDays(Number(event.target.value))}
            className="rounded-full border border-surfaceGlass/16 bg-bgPrimary/40 px-4 py-2.5 text-sm text-textPrimary outline-none focus:border-accentPrimary/45"
          >
            {EXPIRATION_OPTIONS.map((days) => (
              <option key={days} value={days}>{days} {days === 1 ? 'day' : 'days'}</option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="inline-flex w-fit items-center rounded-full border border-accentPrimary/35 bg-accentPrimary/24 px-4 py-2.5 text-sm font-black text-textPrimary transition hover:bg-accentPrimary/30 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? 'Creating…' : 'Create one-time code'}
        </button>
      </form>

      {created ? (
        <div className="rounded-card border border-accentPrimary/35 bg-accentPrimary/10 p-4">
          <div className="text-sm font-black">Code created for {created.label}</div>
          <div className="mt-1 text-xs text-textSecondary">Copy it now. For security, the full code cannot be shown again.</div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <code className="rounded-full border border-surfaceGlass/14 bg-bgPrimary/45 px-4 py-2 text-sm font-black tracking-wide text-textPrimary">
              {created.code}
            </code>
            <button
              type="button"
              onClick={() => void copyCode()}
              className="rounded-full border border-surfaceGlass/16 bg-bgPrimary/40 px-4 py-2 text-sm font-black hover:border-surfaceGlass/24"
            >
              {copied ? 'Copied' : 'Copy code'}
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div role="alert" className="rounded-card border border-toneDanger/30 bg-toneDanger/10 p-3 text-sm font-bold text-toneDanger">
          {error}
        </div>
      ) : null}

      <section className="grid gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-extrabold">Invite history</h2>
          <button type="button" onClick={() => void loadInvites()} className="text-xs font-black text-accentPrimary">Refresh</button>
        </div>

        {loading ? <div className="text-sm text-textSecondary">Loading invite codes…</div> : null}
        {!loading && invites.length === 0 ? (
          <div className="rounded-card border border-surfaceGlass/12 bg-bgSecondary p-4 text-sm text-textSecondary">No invite codes yet.</div>
        ) : null}

        {invites.map((invite) => {
          const status = inviteStatus(invite)
          return (
            <article key={invite.id} className="rounded-card border border-surfaceGlass/12 bg-bgSecondary p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-black text-textPrimary">{invite.label}</div>
                  <div className="mt-1 text-xs text-textSecondary">Code ending in {invite.codeHint} · created {formatDate(invite.createdAt)}</div>
                </div>
                <div className={`text-xs font-black ${status.tone}`}>{status.label}</div>
              </div>
              <div className="mt-3 text-sm text-textSecondary">
                {invite.usedAt && invite.usedBy
                  ? `Used ${formatDate(invite.usedAt)} by ${invite.usedBy.email} as ${invite.usedBy.role.toLowerCase()}.` // pii-plaintext-read-ok: admin-only invite audit history identifies the account that used the code
                  : `Expires ${formatDate(invite.expiresAt)}.`}
              </div>
              {!invite.usedAt && !invite.revokedAt && new Date(invite.expiresAt) > new Date() ? (
                <button
                  type="button"
                  onClick={() => void revokeInvite(invite.id)}
                  className="mt-3 text-xs font-black text-toneDanger hover:underline"
                >
                  Revoke code
                </button>
              ) : null}
            </article>
          )
        })}
      </section>
    </div>
  )
}
